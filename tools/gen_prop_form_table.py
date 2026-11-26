#!/usr/bin/env python3
"""Generate src/game/prop_form_table.h from data/prop_forms.csv.

ФОРМА — ДАННЫЕ (решение владельца 2026-08-21, [markoaudit/plans/ragdoll.md]
фундамент §9). Словарь движка замкнут — сфера и бокс, — а СОСТАВНОЕ тело
(труп, люстра на тросе, многосегментная мебель) описывается строками: сегмент,
его родитель, примитив, офсет и габарит В ДОЛЯХ габарита носителя, доля массы
и вид связи. Ядро агностично: получает N тел и M линков и не знает слова
«труп».

Доли, а не метры: одна строка формы обслуживает и ребёнка, и громилу — тело
масштабируется своим габаритом (S11 — константа выводится из свойств объекта).
Оси долей — КАДР ТЕЛА, а не мира (CANON S28): x — перёд, y — лево, z — верх
(против гравитации). ox/oy/jx/jy и sx/sy — доли ШИРИНЫ тела (W), oz/jz и sz —
доли РОСТА (H); у сферы sx — доля роста для радиуса, sy/sz игнорируются.

ТЕЛО ИЗ ЧАСТЕЙ (CANON S28, 2026-11-25): у части есть РОЛЬ из закрытого словаря
(корень, торс, голова, рука, нога, звено цепи) — по ней водитель позы решает,
что делать с частью; вида тела («собака», «паук») движок не знает. jx/jy/jz —
ТОЧКА СУСТАВА (в долях, от центра корня): там часть висит на родителе, туда и
крепится связь рычагом с обеих сторон. У корня сустава нет — ячейки пустые.

Row order is ABI within a form: segment index is the link parent reference.

    python tools/gen_prop_form_table.py
"""
import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, "data", "prop_forms.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "prop_form_table.h")

PRIMS = {"sphere": 0, "box": 1}
# Закрытый словарь ролей (CANON S28.2). Порядок = ординал FormRole.
ROLES = ["root", "torso", "head", "arm", "leg", "chain"]


def flt(v):
    """CSV cell -> a valid C++ float literal. `0` must become `0.0f`, not the
    ill-formed `0f`; formatting through float() also rejects a typo'd cell."""
    return "%.6ff" % float(v.strip())


def die(msg):
    sys.stderr.write("gen_prop_form_table: %s\n" % msg)
    sys.exit(1)


def main():
    with open(CSV_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        die("no rows")

    forms = []           # [(name, [row, ...]), ...] in first-seen order
    index = {}
    for r in rows:
        f = r["form"].strip()
        if f not in index:
            index[f] = len(forms)
            forms.append((f, []))
        forms[index[f]][1].append(r)

    # Parent must be a segment of the SAME form, declared earlier: a форма is a
    # tree built top-down, and a forward reference would mean linking a body
    # that does not exist yet.
    for name, segs in forms:
        seen = {}
        for i, r in enumerate(segs):
            seg = r["seg"].strip()
            if seg in seen:
                die("form %s: duplicate segment %s" % (name, seg))
            parent = r["parent"].strip()
            if i == 0:
                if parent:
                    die("form %s: root segment must have no parent" % name)
            elif parent not in seen:
                die("form %s: segment %s references unknown parent %s"
                    % (name, seg, parent))
            seen[seg] = i
            if r["prim"].strip() not in PRIMS:
                die("form %s: unknown prim %s" % (name, r["prim"]))
            role = r["role"].strip()
            if role not in ROLES:
                die("form %s: segment %s has unknown role %s"
                    % (name, seg, role))
            # Корень — ровно первая строка формы: на нём лут и сейв, и
            # водитель позы держит его капсулой тела.
            if (i == 0) != (role == "root"):
                die("form %s: role root must be exactly the first segment "
                    "(segment %s is %s)" % (name, seg, role))
            joint = [r[k].strip() for k in ("jx", "jy", "jz")]
            if i == 0:
                if any(joint):
                    die("form %s: root segment has no joint" % name)
            elif not all(joint):
                die("form %s: segment %s needs a joint point jx/jy/jz"
                    % (name, seg))
            # ЧАСТЬ ВНУТРИ СИЛУЭТА (ревью плана тел 2026-11-25): силуэт — AABB
            # живого тела, его полугабарит в долях есть 0.5 по каждой оси, и
            # часть, вышедшая за него, родилась бы в стене, которую капсула
            # живого не задевала. Ноги до подошвы — равенство, а не зазор;
            # допуск — только округление десятичной записи ячеек.
            o = [abs(float(r[k])) for k in ("ox", "oy", "oz")]
            h = [float(r[k]) for k in ("sx", "sy", "sz")]
            if r["prim"].strip() == "sphere":
                # Радиус сферы — доля РОСТА: сравним он только с вертикалью.
                # Поперёк сравнить его с долями ширины без пропорций тела
                # нельзя — там проверяется центр (нюанс назван, не залечен).
                h = [0.0, 0.0, h[0]]
            for ax, nm in enumerate("xyz"):
                if o[ax] + h[ax] > 0.5 + 1e-9:
                    die("form %s: segment %s leaves the silhouette on %s "
                        "(|o|+s = %.4f > 0.5)" % (name, seg, nm, o[ax] + h[ax]))

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write('''// GENERATED by tools/gen_prop_form_table.py from data/prop_forms.csv — do
// not hand-edit. Edit the CSV and re-run the generator; the `source_rules`
// ctest fails on drift.
//
// ФОРМА СОСТАВНОГО ТЕЛА КАК ДАННЫЕ ([markoaudit/plans/ragdoll.md] §9, решение
// владельца 2026-08-21). Словарь движка замкнут — сфера и бокс; составное тело
// (труп, люстра на тросе, многосегментная мебель) — это строки: сегмент, его
// родитель, примитив, офсет и габарит В ДОЛЯХ габарита носителя, доля массы,
// вид связи. Новая форма = строки таблицы, не код.
//
// Доли, а не метры: одна строка обслуживает и ребёнка, и громилу — тело
// масштабируется собственным габаритом (S11). ox/oy и sx/sy — доли ШИРИНЫ
// тела, oz/sz — доли РОСТА; у сферы sx — доля роста для радиуса. Оси — КАДР
// ТЕЛА (CANON S28): x — перёд, y — лево, z — верх против гравитации.
#pragma once

#include <cstdint>

namespace giga::game {

enum class FormPrim : std::uint8_t { Sphere = 0, Box = 1 };

// Роль части — закрытый словарь (CANON S28.2): по ней водитель позы решает,
// что делать с частью. Вида тела движок не знает.
enum class FormRole : std::uint8_t {
    Root = 0, Torso = 1, Head = 2, Arm = 3, Leg = 4, Chain = 5, Count
};

// Индекс родителя внутри формы; 0xFF — корень (носитель сам).
inline constexpr std::uint8_t kFormNoParent = 0xFFu;

struct FormSegDef {
    const char* seg;        // CSV slug, для диагностики
    std::uint8_t parent;    // индекс сегмента-родителя, kFormNoParent у корня
    FormPrim prim;
    FormRole partRole;      // роль части — её читает водитель позы (И2)
    float ox, oy, oz;       // офсет от КОРНЯ в долях (W, W, H), кадр тела
    float jx, jy, jz;       // точка сустава с родителем, те же доли; корень — 0
    float sx, sy, sz;       // полугабарит в долях (W, W, H); сфера — sx от H
    float massFrac;         // доля полной массы тела
    std::uint8_t rope;      // 1 — связь только тянет (верёвка), 0 — штанга
};

struct FormDef {
    const char* id;
    std::uint16_t first;    // индекс первого сегмента в kFormSegs
    std::uint16_t count;
};

''')
        fh.write("inline constexpr std::uint16_t kFormCount = %du;\n"
                 % len(forms))
        total = sum(len(s) for _, s in forms)
        fh.write("inline constexpr std::uint16_t kFormSegCount = %du;\n"
                 % total)
        # Самая длинная форма таблицы — предел буфера сборщика: он выведен из
        # ДАННЫХ, а не назначен, и растёт вместе с CSV.
        fh.write("// Длина самой большой формы — предел буфера сборщика "
                 "(выведен из таблицы).\n"
                 "inline constexpr std::uint16_t kMaxFormSegs = %du;\n\n"
                 % max(len(s2) for _, s2 in forms))

        fh.write("// Ordinals — GENERATED, CSV order.\nenum class FormId : "
                 "std::uint16_t {\n")
        for i, (name, _) in enumerate(forms):
            fh.write("    %s = %d,\n"
                     % (name[0].upper() + name[1:], i))
        fh.write("    Count\n};\n\n")

        fh.write("inline constexpr FormSegDef kFormSegs[kFormSegCount] = {\n")
        for name, segs in forms:
            seen = {}
            for i, r in enumerate(segs):
                parent = r["parent"].strip()
                pidx = "kFormNoParent" if not parent else str(seen[parent])
                seen[r["seg"].strip()] = i
                role = r["role"].strip()
                fh.write('    {"%s", %s, FormPrim::%s, FormRole::%s, '
                         '%s, %s, %s, %s, %s, %s, '
                         '%s, %s, %s, %s, %s},  // %s\n'
                         % (r["seg"].strip(), pidx,
                            "Sphere" if r["prim"].strip() == "sphere" else "Box",
                            role[0].upper() + role[1:],
                            flt(r["ox"]), flt(r["oy"]), flt(r["oz"]),
                            flt(r["jx"] or "0"), flt(r["jy"] or "0"),
                            flt(r["jz"] or "0"),
                            flt(r["sx"]), flt(r["sy"]), flt(r["sz"]),
                            flt(r["mass_frac"]),
                            str(int(r["rope"].strip())),
                            # Провенанс строки — комментарием у сегмента:
                            # автор видит в таблице, откуда число.
                            r["note"].strip()))
        fh.write("};\n\ninline constexpr FormDef kFormTable[kFormCount] = {\n")
        first = 0
        for name, segs in forms:
            fh.write('    {"%s", %d, %d},\n' % (name, first, len(segs)))
            first += len(segs)
        fh.write('''};

inline const FormDef& form_def(FormId f) {
    const std::uint16_t i = static_cast<std::uint16_t>(f);
    return kFormTable[i < kFormCount ? i : 0];
}

} // namespace giga::game
''')
    sys.stderr.write("gen_prop_form_table: wrote %d forms / %d segments to %s\n"
                     % (len(forms), total, OUT_PATH))


if __name__ == "__main__":
    main()
