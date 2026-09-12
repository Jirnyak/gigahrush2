#!/usr/bin/env python3
"""Generate src/game/prop_table.h + prop_table.cpp from data/props.csv.

Sibling of gen_status_table.py / gen_weapon_table.py. CSV is the truth; the
generated files are committed so the build needs no Python. Unknown tokens are
hard errors, never silent defaults.

    python tools/gen_prop_table.py

WHY THIS TABLE EXISTS. seed_wall_interactables / seed_ceiling_lights / padic
stair lamps hardcode PropShape ordinals, emissive, matId and RGB in .cpp.
That violates jirnyak.md data-driven content rules (same as items/mobs). One
row per authored prop id; spawn sites look up by PropId / string id hash and
never embed shape/emissive literals.

shape is the PropShape ordinal from render/prop_mesh.h (0..28). game never
includes render headers — the ordinal is a plain uint8 shared contract.
fall_mode / interact are enum token names matching prop_system.h.
color_*_e3 are fixed-point RGB x1000 (0..2000) so the table stays integral.
"""

import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROPS_CSV = os.path.join(REPO, "data", "props.csv")
OUT_H = os.path.join(REPO, "src", "game", "prop_table.h")
OUT_CPP = os.path.join(REPO, "src", "game", "prop_table.cpp")

# Must stay in lockstep with enum class PropShape in render/prop_mesh.h.
VALID_SHAPES = {
    "Box": 0, "CylinderX": 1, "CylinderY": 2, "CylinderZ": 3,
}
SHAPE_MAX = 3

FALL_MODES = {"SimpleFall": 0, "RagdollRoll": 1, "GpuHandoff": 2}

# The interact ordinals come from data/interactables.csv (the generated
# InteractKind enum) — a prop names an interactive by its cpp_name and this
# generator refuses a name the table does not carry. "None" = 255.
def _load_interacts():
    import csv as _csv
    path = os.path.join(REPO, "data", "interactables.csv")
    with open(path, encoding="utf-8", newline="") as fh:
        rows = list(_csv.DictReader(fh))
    m = {r["cpp_name"].strip(): i for i, r in enumerate(rows)}
    m["None"] = 255
    return m

INTERACTS = _load_interacts()

# FlickerProfile ordinals — lockstep с src/game/flicker.h и shaders/flicker.glsl.
FLICKER = {"none": 0, "mains": 1, "arc": 2, "pulse": 3, "crt": 4}

# ChargeTrigger ordinals — lockstep с enum class ChargeTrigger в prop_table.h
# (эмитится этим же генератором ниже). none = проп не детонирует сам (заряд
# может быть взведён извне — фитиль гранаты взводит бросающий); damage =
# детонация вместо детача, когда проп сбивают выстрелом/ударом (бочка).
CHARGE_TRIGGERS = {"none": 0, "damage": 1}

VERBS_CSV = os.path.join(REPO, "data", "verbs.csv")


def load_verbs():
    """Словарь глаголов (CANON S12.3): токен -> ординал, K = число строк.
    Единственный источник — data/verbs.csv; опечатка в колонке verbs пропа
    обязана быть жёсткой ошибкой, а не молчаливым нулём (решение владельца:
    свободные хеш-теги отвергнуты именно за это)."""
    with open(VERBS_CSV, encoding="utf-8", newline="") as fh:
        return {r["id"].strip(): i for i, r in enumerate(csv.DictReader(fh))}


def parse_verbs(sid, text, verbs):
    """'sleep:17|eat:4' -> vector[K]. Что проп ПРЕДОСТАВЛЯЕТ (возможность,
    не тратится) — слагаемое ОСНАЩЕНИЕ предложения комнаты (S12.4)."""
    vec = [0] * len(verbs)
    text = (text or "").strip()
    if not text:
        return vec
    for pair in text.split("|"):
        tok, _, val = pair.partition(":")
        tok = tok.strip()
        if tok not in verbs:
            die("%r: unknown verb %r in verbs column (want one of %s)"
                % (sid, tok, ", ".join(sorted(verbs))))
        try:
            v = int(val)
        except ValueError:
            die("%r: verb %s amount %r is not an integer" % (sid, tok, val))
        if not (-32768 <= v <= 32767):
            die("%r: verb %s amount %d out of i16" % (sid, tok, v))
        if vec[verbs[tok]] != 0:
            die("%r: verb %s listed twice" % (sid, tok))
        vec[verbs[tok]] = v
    return vec


def die(msg):
    sys.stderr.write("gen_prop_table: %s\n" % msg)
    sys.exit(1)


def num(row, col, lo, hi):
    text = (row.get(col) or "").strip()
    try:
        v = int(text)
    except ValueError:
        die("%r: %s = %r not an int" % (row.get("id"), col, text))
    if not (lo <= v <= hi):
        die("%r: %s = %r out of [%d, %d]" % (row.get("id"), col, text, lo, hi))
    return v


def parse_shape(row):
    text = (row.get("shape") or "").strip()
    if not text:
        die("%r: empty shape" % row.get("id"))
    if text.isdigit() or (text.startswith("-") and text[1:].isdigit()):
        v = int(text)
        if not (0 <= v <= SHAPE_MAX):
            die("%r: shape ordinal %d out of [0, %d]" % (row.get("id"), v, SHAPE_MAX))
        return v
    if text not in VALID_SHAPES:
        die("%r: unknown shape token %r" % (row.get("id"), text))
    return VALID_SHAPES[text]


def camel(sid):
    parts = [p for p in sid.replace("-", "_").split("_") if p]
    if not parts:
        die("empty id")
    return "".join(p[:1].upper() + p[1:] for p in parts)


def main():
    with open(PROPS_CSV, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        die("props.csv has no data rows")

    verbs = load_verbs()
    verb_vecs = []
    seen = set()
    defs = []
    names = []
    enum_lines = []
    for i, r in enumerate(rows):
        sid = (r.get("id") or "").strip()
        if not sid:
            die("row %d has empty id" % i)
        if sid in seen:
            die("duplicate id %r" % sid)
        seen.add(sid)
        name = (r.get("name") or "").strip()
        if not name:
            die("%r has empty display name" % sid)

        fall = (r.get("fall_mode") or "").strip()
        if fall not in FALL_MODES:
            die("%r: unknown fall_mode %r (want %s)"
                % (sid, fall, ", ".join(sorted(FALL_MODES))))
        interact = (r.get("interact") or "").strip()
        if interact not in INTERACTS:
            die("%r: unknown interact %r (want %s)"
                % (sid, interact, ", ".join(sorted(INTERACTS))))

        shape = parse_shape(r)
        emissive = num(r, "emissive", 0, 255)
        mat_id = num(r, "mat_id", 0, 255)
        cr = num(r, "color_r_e3", 0, 2000)
        cg = num(r, "color_g_e3", 0, 2000)
        cb = num(r, "color_b_e3", 0, 2000)
        reach = num(r, "reach_mm", 0, 10000)
        light_radius = num(r, "light_radius_mm", 0, 65535)
        light_intensity = num(r, "light_intensity_e3", 0, 65535)
        light_cone = num(r, "light_cone_deg", 0, 89)
        flicker = (r.get("flicker") or "").strip()
        if flicker not in FLICKER:
            die("%r: unknown flicker %r (want %s)"
                % (sid, flicker, ", ".join(sorted(FLICKER))))
        if (light_radius == 0) != (light_intensity == 0):
            die("%r: light_radius_mm and light_intensity_e3 must be both zero "
                "or both set" % sid)
        explosive = num(r, "explosive_g", 0, 65535)
        trigger = (r.get("charge_trigger") or "").strip()
        if trigger not in CHARGE_TRIGGERS:
            die("%r: unknown charge_trigger %r (want %s)"
                % (sid, trigger, ", ".join(sorted(CHARGE_TRIGGERS))))
        # Триггер без взрывчатки — заряд, который сработает нулём: молчаливый
        # обман того же сорта, что blastDm без fuseDs у оружейной таблицы.
        if CHARGE_TRIGGERS[trigger] != 0 and explosive == 0:
            die("%r: charge_trigger %r requires explosive_g > 0" % (sid, trigger))

        enum_name = camel(sid)
        enum_lines.append("    %s = %d," % (enum_name, i))
        names.append((sid, name))
        verb_vecs.append(parse_verbs(sid, r.get("verbs"), verbs))
        # GRAMS, read as an integer and never scaled here. The column used to be
        # `mass_kg` and was multiplied on the way in, which put a unit conversion
        # between what the author wrote and what the engine stored — the same seam
        # that let props mean grams and mobs mean kg x10 for months. One unit, one
        # name, no arithmetic: what is in the cell is what lands in the row.
        mass_raw = (r.get("mass_g") or "").strip()
        if not mass_raw.isdigit():
            die("row %d: mass_g %r must be a whole number of grams" % (i, mass_raw))
        massG = int(mass_raw)
        sizes = tuple(int(round(float(r.get(c) or "1.0") * 1000.0))
                      for c in ("size_x_m", "size_y_m", "size_z_m"))
        for v in sizes:
            if not (0 < v <= 65535):
                die("row %d: size out of range" % i)
        # GRAMS in a uint32, the one mass unit in the tree (see PropDef's comment).
        # Zero is REFUSED rather than defaulted: a massless prop silently drops out
        # of every E = m*v^2/2 law, and "authored as 0" is indistinguishable from
        # "nobody filled this column in" — measured, that is exactly what had
        # happened to 45 of 69 rows in data/mobs.csv.
        if not (0 < massG <= 4294967295):
            die("row %d: mass_g %r out of range (1..2^32-1, and a prop may not be "
                "massless)" % (i, mass_raw))
        # Layout: massG (uint32), 6 uint8 (shape..cone), 9 uint16, flicker,
        # chargeTrigger (бывший pad0_), explosiveG (бывший pad1_).
        defs.append(
            "    // [%d] %s\n"
            "    PropDef{ %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d }," % (
                i, sid,
                massG,
                shape,
                FALL_MODES[fall],
                INTERACTS[interact],
                emissive,
                mat_id,
                light_cone,
                cr, cg, cb,
                reach,
                sizes[0], sizes[1], sizes[2],
                light_radius, light_intensity,
                FLICKER[flicker],
                CHARGE_TRIGGERS[trigger],
                explosive))

    count = len(rows)

    with open(OUT_H, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER_H % count)
        fh.write("enum class PropId : std::uint16_t {\n")
        for line in enum_lines:
            fh.write(line + "\n")
        fh.write("};\n\n")
        fh.write(BODY_H)
        fh.write("} // namespace giga::game\n")

    with open(OUT_CPP, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER_CPP)
        fh.write("const std::array<PropDef, kPropCount> kPropTable = {{\n")
        fh.write("\n".join(defs))
        fh.write("\n}};\n\n")
        fh.write("// Display names. Cyrillic; suites assert non-empty / lead bytes.\n")
        fh.write("const std::array<const char*, kPropCount> kPropNames = {{\n")
        for sid, name in names:
            # Escape backslash and quote in name.
            esc = name.replace("\\", "\\\\").replace('"', '\\"')
            fh.write('    "%s",  // %s\n' % (esc, sid))
        fh.write("}};\n\n")
        fh.write("const std::array<const char*, kPropCount> kPropIds = {{\n")
        for sid, _name in names:
            fh.write('    "%s",\n' % sid)
        fh.write("}};\n\n")
        fh.write("// Глаголы пропа (S12.3, колонка verbs) — что предоставляет.\n")
        fh.write("const std::array<std::array<std::int16_t, kVerbCount>, "
                 "kPropCount> kPropVerbs = {{\n")
        for (sid, _name), vec in zip(names, verb_vecs):
            fh.write("    {{%s}},  // %s\n" % (", ".join(str(v) for v in vec), sid))
        fh.write("}};\n\n")
        fh.write(FOOTER_CPP)

    # Мёртвый глагол в пропах — не ошибка (его может нести предмет или
    # объявление), но молчать нельзя (гейт B verbs-table): печатаем вслух.
    provided = {tok for tok, k in verbs.items()
                if any(vec[k] != 0 for vec in verb_vecs)}
    dead = sorted(set(verbs) - provided)
    if dead:
        sys.stderr.write("gen_prop_table: verbs with no providing prop yet: %s\n"
                         % ", ".join(dead))

    sys.stderr.write("gen_prop_table: wrote %d prop rows to %s + %s\n"
                     % (count, OUT_H, OUT_CPP))


HEADER_H = """// GENERATED by tools/gen_prop_table.py from data/props.csv — do not
// hand-edit kPropCount or the PropId enum. Edit the CSV and re-run the generator.
// Hand-maintained helpers below the GENERATED marker are allowed only if the
// generator is updated to emit them; today the whole header is generated.
#pragma once

#include <array>
#include <cstdint>
#include <cstring>
#include <type_traits>

#include "core/math.h"
#include "game/verb_table.h"  // kVerbCount — вектор глаголов пропа (S12.3)

namespace giga::game {

inline constexpr std::size_t kPropCount = %d;

// Row order is data/props.csv row order and is load-bearing: a PropId is an
// index into the generated table. Append only — never reorder or insert.
"""

BODY_H = """// POD row. shape is the PropShape ordinal (render/prop_mesh.h); game never
// includes render headers. fallMode / interactKind are ordinals matching
// PropFallMode and Interactable::Kind in prop_system.h (255 = no interact).
// color*E3 are RGB x1000 (1000 = 1.0). reachMm is Interactable.reachM * 1000.
//
// MASS IS GRAMS IN A uint32, AND IT IS THE SAME UNIT EVERYWHERE — MobDef carries
// the identical field, and any future ItemDef weight will too. It used to be grams
// in a uint16 here and kg x10 in a uint16 there: the same 16 bits with two
// different meanings, which is [problems.md] §20's class exactly, and it was not
// theoretical — data/mobs.csv already carried 900 kg, fourteen times this table's
// old 65.5 kg ceiling, so a stove had to be authored at 65 kg instead of 80.
//
// The widening COST NOTHING: this row already carried `pad0_` and `pad1_`, so the
// four bytes came out of padding and the row is still exactly 24. Range is now
// 1 g .. 4294 tonnes, which brackets a 9 mm cartridge and a lift cabin with one
// encoding and no per-table conversion to misremember.
//
// СВЕТ — ИЗ ЭТОЙ ЖЕ СТРОКИ ([ddalight.md]): lightRadiusMm != 0 означает «проп
// излучает», и коллектор света видит ЛЮБОЙ такой проп — спец-случаев
// «лампочка» в коде нет. Радиус в мм, как reachMm — одна единица на таблицу.
// lightConeDeg — ПОЛУугол конуса, 0 = омни (занял бывший pad0_).
//
// Layout is explicit: 1 x uint32, 6 x uint8, 9 x uint16, 1 x uint32 pad = 32 bytes.
struct PropDef {
    std::uint32_t massG;            // 0  universal mass, GRAMS ([ecs] Mass)
    std::uint8_t  shape;            // 4  PropShape ordinal
    std::uint8_t  fallMode;         // 5  PropFallMode ordinal
    std::uint8_t  interactKind;     // 6  Interactable::Kind or 255
    std::uint8_t  emissive;         // 7  0..255 PropPass emissive
    std::uint8_t  matId;            // 8
    std::uint8_t  lightConeDeg;     // 9  полуугол конуса света, 0 = омни
    std::uint16_t colorRE3;         // 10 RGB x1000
    std::uint16_t colorGE3;         // 12
    std::uint16_t colorBE3;         // 14
    std::uint16_t reachMm;          // 16 Interactable reach in millimetres
    std::uint16_t sizeXMm;          // 18 authored mesh size, millimetres — the
    std::uint16_t sizeYMm;          // 20 unit shape is scaled to exactly this,
    std::uint16_t sizeZMm;          // 22 so a bulb is a bulb and not a 1 m drum
    std::uint16_t lightRadiusMm;    // 24 0 = не светит
    std::uint16_t lightIntensityE3; // 26 интенсивность x1000
    std::uint8_t  flickerProfile;   // 28 FlickerProfile ([game/flicker.h]):
                                    //    свет И emissive носителя, синхронно
    // ЗАРЯД ([combat.h] Charge, решение владельца 2026-08-21: «пропы в целом
    // могут взрываться»). explosiveG — масса ВВ в граммах, 0 = не заряд;
    // урон и радиус детонации ВЫВОДЯТСЯ из неё (S11), не назначаются.
    // Оба поля заняли бывшие pad0_/pad1_ — строка осталась 32 байта.
    std::uint8_t  chargeTrigger;    // 29 ChargeTrigger ниже
    std::uint16_t explosiveG;       // 30 масса ВВ, граммы
};
static_assert(sizeof(PropDef) == 32, "PropDef must stay a tight 32-byte row");
static_assert(alignof(PropDef) == 4);
static_assert(std::is_trivially_copyable_v<PropDef>);

// Как заряд срабатывает. none — сам не детонирует (взводится извне: фитиль
// гранаты взводит бросающий, [combat.h] spawn_grenade); damage — детонация
// вместо детача, когда проп сбивают выстрелом (бочка, баллон).
// Lockstep с CHARGE_TRIGGERS генератора.
enum class ChargeTrigger : std::uint8_t { None = 0, Damage = 1 };

// Строка — заряд? Выводится из массы ВВ, не объявляется отдельным флагом.
inline bool prop_is_charge(const PropDef& d) { return d.explosiveG > 0; }


// Generated from data/props.csv by tools/gen_prop_table.py.
extern const std::array<PropDef, kPropCount> kPropTable;
extern const std::array<const char*, kPropCount> kPropNames;
extern const std::array<const char*, kPropCount> kPropIds;

// Глаголы, которые проп ПРЕДОСТАВЛЯЕТ (CANON S12.3: возможность, не
// тратится) — колонка verbs в props.csv, вектор длины K из data/verbs.csv.
// Слагаемое ОСНАЩЕНИЕ предложения комнаты (S12.4). Живёт параллельной
// таблицей, не полем POD: PropDef — ровно 32 байта по контракту.
extern const std::array<std::array<std::int16_t, kVerbCount>, kPropCount>
    kPropVerbs;

inline bool prop_valid(PropId id) {
    return static_cast<std::size_t>(id) < kPropCount;
}

inline const PropDef& prop_def(PropId id) {
    return kPropTable[static_cast<std::size_t>(id)];
}

inline const char* prop_name(PropId id) {
    return prop_valid(id) ? kPropNames[static_cast<std::size_t>(id)] : "";
}

inline const char* prop_id_str(PropId id) {
    return prop_valid(id) ? kPropIds[static_cast<std::size_t>(id)] : "";
}

// O(n) string lookup for tools/console — never call in the hot tick.
// Returns kPropCount-sized invalid sentinel when missing (check prop_valid).
inline PropId prop_id_by_string(const char* id) {
    if (!id || !*id) return static_cast<PropId>(kPropCount);
    for (std::size_t i = 0; i < kPropCount; ++i) {
        if (std::strcmp(kPropIds[i], id) == 0)
            return static_cast<PropId>(i);
    }
    return static_cast<PropId>(kPropCount);
}

// Строка светит? Радиус и интенсивность обязаны идти парой — одинокий ноль
// в любой из колонок означает «не источник».
inline bool prop_emits_light(const PropDef& d) {
    return d.lightRadiusMm != 0 && d.lightIntensityE3 != 0;
}

// Color as vec3 in 0..2 range (e3 / 1000).
inline vec3 prop_color(const PropDef& d) {
    return vec3{
        static_cast<float>(d.colorRE3) * 0.001f,
        static_cast<float>(d.colorGE3) * 0.001f,
        static_cast<float>(d.colorBE3) * 0.001f,
    };
}

inline vec3 prop_color(PropId id) {
    return prop_color(prop_def(id));
}
"""

HEADER_CPP = """// GENERATED by tools/gen_prop_table.py from data/props.csv — do not
// hand-edit. Edit the CSV and re-run the generator.
#include "game/prop_table.h"

namespace giga::game {

"""

FOOTER_CPP = """} // namespace giga::game
"""

if __name__ == "__main__":
    main()
