#!/usr/bin/env python3
"""Generate src/game/action_table.h from data/actions.csv.

ЕДИНАЯ СИСТЕМА ДЕЙСТВИЙ (CANON S22, решение владельца 2026-11-08): любое
действие над миром или над собой занимает ВРЕМЯ (частный случай 0), и агностично
— игрок, моб и NPC проходят одну дверь. Таблица — словарь действий: что бывает
и ПО КАКОЙ ПРИЧИНЕ это можно сорвать.

Тот же договор, что у gen_verb_table.py: CSV — правда, сгенерированный
заголовок коммитится (сборке питон не нужен), неизвестный/дублированный токен —
жёсткая ошибка, а `source_rules` сверяет число строк CSV с kActionCount.

Ids — порядок строк CSV и СТАБИЛЬНЫ ПО КОНТРАКТУ: id действия едет в сейв
внутри компонента `Acting`, поэтому строку ДОПИСЫВАЮТ, а не вставляют (тот же
закон, что у materials.csv и verbs.csv).

КОЛОНКА ДЛИНЫ `dur_ms` ПРИЕХАЛА 2026-11-08 ВМЕСТЕ СО СВОИМ ВЫЗЫВАЮЩИМ (CANON
S24, цикл нужд). Прежняя шапка обещала ровно это: «колонка появится вместе с
первым действием, чья длина авторская ИМЕННО ЗДЕСЬ, и тем же коммитом, что его
вызывающий». У деяния нужды носителя-оружия нет — кровать не несёт темпа, как
ствол, — поэтому длину назначает строка действия. У шести боевых строк здесь
НОЛЬ, и это ЗНАЧЕНИЕ, а не пустота: «длину мне назначает строка носителя».
Читатель колонки — `serve_begin` ([game/serve.h]).

КОЛОНКИ `apply_ms` НЕТ, и это то же решение в другую сторону: у всех четырёх
деяний нужды эффект падает В КОНЦЕ окна (съел — наелся), то есть колонка была бы
побитовой КОПИЕЙ `dur_ms`. Контактный кадр деяния нужды = `dur_ms` одной
строкой кода в `serve_begin`; колонка приедет с первым деянием, у которого
контакт РАНЬШЕ конца.

КОЛОНКА `verb` — ЗАЧЕМ ЭТО ДЕЛАЮТ, и она же мост «нужда → действие». Словарь
глаголов (S12.3) связывает предмет, проп, комнату и агента; теперь к ним
подшивается ДЕЙСТВИЕ: строка говорит, какой глагол она обслуживает, и
генератор эмитит ОБРАТНЫЙ индекс `kVerbAction` сам — поэтому «какое действие
утоляет сон» и «какой глагол утоляет сон» не могут разъехаться. Два действия на
один глагол — жёсткая ошибка: это была бы развилка без правила выбора.

    python tools/gen_action_table.py
"""

import csv
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACTIONS_CSV = os.path.join(REPO, "data", "actions.csv")
VERBS_CSV = os.path.join(REPO, "data", "verbs.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "action_table.h")

EXPECTED_COLS = ["id", "name", "verb", "dur_ms", "break_mask", "note"]

# Окно не длиннее u16 тиков ([game/action.h]: 65536 тиков = вахта лестницы
# S15, а действие длиной в вахту уже не действие, а занятие). Предел проверяется
# ЗДЕСЬ, в мс, — иначе авторское число молча клампилось бы в `acting_begin`.
#
# ЧИТАЕТСЯ ИЗ `core/tick.h`, а не копируется: частота сим-тика названа там
# (`kSimHz`), и вторая её копия в генераторе разъехалась бы молча. Граница —
# САМЫЕ БОЛЬШИЕ мс, у которых `ms_to_ticks` (он округляет ВВЕРХ) ещё укладывается
# в u16, то есть floor-деление здесь верно: ceil(ms·Гц/1000) ≤ 65535.
TICK_HZ = int(re.search(r"kSimHz\s*=\s*(\d+)",
                        open(os.path.join(REPO, "src", "core", "tick.h"),
                             encoding="utf-8").read()).group(1))
MAX_DUR_MS = 65535 * 1000 // TICK_HZ

# ПРИЧИНЫ ОБРЫВА — словарь, и он живёт ЗДЕСЬ ОДИН РАЗ. Биты эмитятся в
# заголовок из этой же карты, поэтому C++ не повторяет её и разъехаться им
# нечем. Порядок = номер бита и СТАБИЛЕН: маска едет в сгенерированной таблице,
# а не в сейве, но причина, сменившая бит, молча поменяла бы смысл строк CSV.
#
# Из четырёх причин, названных владельцем (урон, смерть, смена руки, выход с
# этажа), здесь ДВЕ — ровно те, у которых есть вызывающий: смена руки (она же
# смена ствола, рвёт перезарядку) и уход цели (рвёт мобий замах до контакта).
# Остальные приедут со своими вызывающими; бит без того, кто его ставит, был бы
# такой же ложью, как столбец без читателя.
BREAK_BITS = [
    ("hand", "смена предмета в руке — ствол сменили, перезарядка этой руки незаконна"),
    ("target", "цель ушла из полосы досягаемости — замах срывается ДО контактного кадра"),
    ("threat", "тело забрала угроза — бегство старше дела, деяние нужды срывается"),
]


def die(msg):
    sys.stderr.write("gen_action_table: %s\n" % msg)
    sys.exit(1)


def load_verbs():
    """Словарь глаголов (CANON S12.3): токен -> ординал. Единственный источник —
    data/verbs.csv, как у gen_prop_table.py: опечатка в колонке обязана быть
    жёсткой ошибкой, а не молчаливым нулём."""
    with open(VERBS_CSV, encoding="utf-8", newline="") as fh:
        return {r["id"].strip(): i for i, r in enumerate(csv.DictReader(fh))}


def camel(ident):
    return "".join(p.capitalize() for p in ident.split("_"))


def main():
    with open(ACTIONS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != EXPECTED_COLS:
            die("actions.csv columns %r != expected %r"
                % (reader.fieldnames, EXPECTED_COLS))
        rows = list(reader)
    if not rows:
        die("actions.csv has no data rows")

    verbs = load_verbs()
    bit_of = {tok: 1 << i for i, (tok, _) in enumerate(BREAK_BITS)}
    seen = set()
    masks = []
    verb_of = []   # ординал глагола строки, len(verbs) = «строка ничего не обслуживает»
    durs = []
    served_by = {} # глагол -> id строки: развилка «два действия на один глагол» незаконна
    for row in rows:
        aid = (row["id"] or "").strip()
        if not re.fullmatch(r"[a-z][a-z0-9_]*", aid):
            die("bad id %r — lowercase snake_case only" % aid)
        # ШИРИНА СТРОКИ СУДИТСЯ, А НЕ ТОЛЬКО ШАПКА. `csv.DictReader` молча
        # кладёт лишние поля в ключ None, и НЕЗАКАВЫЧЕННАЯ ЗАПЯТАЯ в `note`
        # обрезала провенанс на полуслове — это нашёл аудит, и нашёл сразу в
        # ЧЕТЫРЁХ строках (три легаси-боевые плюс свежая `rest`). Пустых полей
        # сверх шапки тоже не бывает: `restval` молчит о недостающих.
        if row.get(None):
            die("%r: полей БОЛЬШЕ, чем столбцов — незакавыченная запятая в "
                "note? хвост: %r" % (aid, row[None]))
        for col in EXPECTED_COLS:
            if row.get(col) is None:
                die("%r: полей МЕНЬШЕ, чем столбцов — нет %r" % (aid, col))
        if aid in seen:
            die("duplicate id %r — молчаливая перезапись строки действия есть "
                "ровно тот дефект, от которого словарь и существует" % aid)
        seen.add(aid)
        if not (row["name"] or "").strip():
            die("%r: empty display name" % aid)
        mask = 0
        raw = (row["break_mask"] or "").strip()
        if raw:
            for tok in raw.split("|"):
                tok = tok.strip()
                if tok not in bit_of:
                    die("%r: unknown break reason %r — словарь причин живёт в "
                        "BREAK_BITS этого генератора; новая причина приезжает "
                        "ВМЕСТЕ со своим вызывающим" % (aid, tok))
                if mask & bit_of[tok]:
                    die("%r: break reason %r listed twice" % (aid, tok))
                mask |= bit_of[tok]
        masks.append(mask)

        vtok = (row["verb"] or "").strip()
        if vtok and vtok not in verbs:
            die("%r: unknown verb %r — словарь живёт в data/verbs.csv (S12.3), "
                "и глагол действия обязан быть ИЗ него" % (aid, vtok))
        if vtok:
            if vtok in served_by:
                die("%r: verb %r уже обслуживает строка %r — развилка без "
                    "правила выбора; обратный индекс kVerbAction от неё и "
                    "защищает" % (aid, vtok, served_by[vtok]))
            served_by[vtok] = aid
        verb_of.append(verbs[vtok] if vtok else len(verbs))

        raw_dur = (row["dur_ms"] or "").strip()
        if not re.fullmatch(r"[0-9]+", raw_dur):
            die("%r: dur_ms %r — целое число мс; 0 = «длину назначает строка "
                "носителя»" % (aid, raw_dur))
        dur = int(raw_dur)
        if dur > MAX_DUR_MS:
            die("%r: dur_ms %d > %d — окно не длиннее u16 тиков "
                "([game/action.h])" % (aid, dur, MAX_DUR_MS))
        # ЖЕНИТЬБА ДВУХ КОЛОНОК В ОБЕ ПОЛЯРНОСТИ (приём gen_prop_table.py):
        # деяние с глаголом обязано нести свою длину, а боевая строка — не
        # нести. Иначе первая не началась бы вовсе (окно нулевой длины), а
        # вторая получила бы ДВА хозяина длины: строку носителя и эту.
        if vtok and dur == 0:
            die("%r: обслуживает глагол %r, но dur_ms = 0 — окно нулевой длины "
                "означает «слот свободен», то есть деяние не началось бы "
                "никогда" % (aid, vtok))
        if not vtok and dur != 0:
            die("%r: глагола нет, а dur_ms = %d — у боевой строки хозяин длины "
                "СТРОКА НОСИТЕЛЯ (оружие, моб), и второй хозяин ей запрещён"
                % (aid, dur))
        durs.append(dur)

    lines = []
    w = lines.append
    w("// GENERATED by tools/gen_action_table.py from data/actions.csv — do not")
    w("// hand-edit. Edit the CSV and re-run the generator; the `source_rules`")
    w("// ctest fails on drift.")
    w("//")
    w("// СЛОВАРЬ ДЕЙСТВИЙ (CANON S22). Любое действие над миром или над собой")
    w("// занимает ВРЕМЯ (частный случай 0) и агностично: игрок = моб = NPC.")
    w("//")
    w("// ДВА ХОЗЯИНА ДЛИНЫ, И ОНИ НЕ ПЕРЕСЕКАЮТСЯ (генератор женит колонки в")
    w("// обе полярности): у боевой строки длину назначает СТРОКА НОСИТЕЛЯ")
    w("// (оружие, моб) и `kActionDurMs` = 0; у деяния нужды носителя нет, и")
    w("// длина авторская ЗДЕСЬ. Глагол строки (`kActionVerb`) есть ЗАЧЕМ")
    w("// деяния, обратный индекс `kVerbAction` эмитится отсюда же.")
    w("//")
    w("// Id — порядок строк CSV, СТАБИЛЕН ПО КОНТРАКТУ: он едет в сейве внутри")
    w("// `Acting`, поэтому строку ДОПИСЫВАЮТ, а не вставляют.")
    w("#pragma once")
    w("")
    w("#include <cstddef>")
    w("#include <cstdint>")
    w("")
    w("#include \"game/verb_table.h\" // VerbId / kVerbCount — словарь S12.3, не литерал")
    w("")
    w("namespace giga::game {")
    w("")
    w("// Ординал строки действия. 0 — ЗАКОННОЕ ДЕЙСТВИЕ, а не «ничего»:")
    w("// пустоту слота несёт нулевая ДЛИНА окна, а не нулевой id (ноль —")
    w("// значение, не отсутствие; [game/action.h]).")
    w("using ActionId = std::uint8_t;")
    w("")
    for i, row in enumerate(rows):
        aid = row["id"].strip()
        note = (row["note"] or "").strip()
        comment = ("  // %s" % note) if note else ""
        w("inline constexpr ActionId kAct%s = %d;%s" % (camel(aid), i, comment))
    w("")
    w("inline constexpr std::size_t kActionCount = %d;" % len(rows))
    w("")
    w("// ПРИЧИНЫ ОБРЫВА — словарь из генератора, не вторая копия в C++.")
    for i, (tok, why) in enumerate(BREAK_BITS):
        w("// %s: %s" % (tok, why))
        w("inline constexpr std::uint8_t kBreak%s = 1u << %d;" % (camel(tok), i))
    w("")
    w("// Маска законных причин обрыва по строке. Причина ВНЕ маски действие НЕ")
    w("// рвёт — это и есть «одна дверь обрыва, и она по данным».")
    w("inline constexpr std::uint8_t kActionBreakMask[kActionCount] = {")
    for row, mask in zip(rows, masks):
        w("    0x%02X,  // %s" % (mask, row["id"].strip()))
    w("};")
    w("")
    w("// ЗАЧЕМ ЭТО ДЕЛАЮТ — глагол строки (S12.3). kVerbCount = «ни за чем»:")
    w("// боевое действие не утоляет нужды, и это ЗНАЧЕНИЕ, а не дыра.")
    w("inline constexpr VerbId kActionVerb[kActionCount] = {")
    for row, v in zip(rows, verb_of):
        tok = (row["verb"] or "").strip() or "—"
        w("    %d,  // %s: %s" % (v, row["id"].strip(), tok))
    w("};")
    w("")
    w("// ОБРАТНЫЙ ИНДЕКС: какое действие утоляет глагол. kActionCount =")
    w("// «утолить этот глагол деянием нельзя» — именно так сегодня отвечают")
    w("// шестнадцать глаголов из двадцати, и это данные, а не недоделка.")
    w("// Эмитится генератором из той же колонки, поэтому прямой и обратный")
    w("// ответ разъехаться не могут.")
    w("inline constexpr ActionId kVerbAction[kVerbCount] = {")
    for vi, vtok in enumerate(sorted(verbs, key=lambda t: verbs[t])):
        aidx = next((i for i, v in enumerate(verb_of) if v == vi), len(rows))
        who = rows[aidx]["id"].strip() if aidx < len(rows) else "—"
        w("    %d,  // %s: %s" % (aidx, vtok, who))
    w("};")
    w("")
    w("// ДЛИНА ОКНА В АВТОРСКИХ МС. 0 = «длину назначает строка носителя»")
    w("// (оружие, моб) — см. шапку. Перевод в тики один, ВВЕРХ: ms_to_ticks.")
    w("inline constexpr std::uint32_t kActionDurMs[kActionCount] = {")
    for row, d in zip(rows, durs):
        w("    %d,  // %s" % (d, row["id"].strip()))
    w("};")
    w("")
    w("// CSV tokens — для отладочного вывода и сверок соседних генераторов.")
    w("inline constexpr const char* kActionIds[kActionCount] = {")
    for row in rows:
        w("    \"%s\"," % row["id"].strip())
    w("};")
    w("")
    w("// Display names — текст для человека, никогда не ключ поиска (S13.9).")
    w("inline constexpr const char* kActionNames[kActionCount] = {")
    for row in rows:
        w("    \"%s\"," % row["name"].strip())
    w("};")
    w("")
    w("} // namespace giga::game")
    w("")

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print("gen_action_table: wrote %s (%d actions)" % (OUT_PATH, len(rows)))


if __name__ == "__main__":
    main()
