#!/usr/bin/env python3
"""Generate src/game/speech_table.cpp from data/speech_lines.csv.

Sibling of tools/gen_item_table.py and deliberately the same shape: the crowd's
voice is content ([speech.h]), so adding a line is one CSV row plus a regenerate,
never an edit to engine code. Not wired into CMake — the generated .cpp is
committed, so the build needs no Python — and it hard-fails on an unknown token
rather than mapping it to a default, because silently defaulting is how a content
table rots.

    python tools/gen_speech_table.py

What this generator does that gen_item_table does not: it BAKES THE INDEX. The
rows are sorted by (situation, faction slot) with the wildcard slot last, so every
(situation, faction) pair becomes two contiguous ranges and the runtime pick needs
no materialised index list — two array reads and a hash. That is the "bake at
load, tick in O(1)" rule applied at build time instead, which is strictly better:
the bake is free and the table is const.

It also enforces the content gates the reference's markov.md specifies for its own
corpus, because a text bank with no audit is how a tone violation or a fabricated
number ships:

  * every situation MUST have at least one wildcard line — that is what makes
    "no speaker is ever mute" a property of the data rather than a hope;
  * NO DIGITS in any line. Numbers are checkable claims and belong to
    [rumour.h]; this is the mechanical half of the two-systems-one-job firewall;
  * the reference's tone blacklist (markov.md "Тон И Запреты") is rejected
    outright, as is its internal-reveal blacklist (seed / toroid / dimensions);
  * no duplicate line text, no empty cell, and a byte-length cap so a line
    cannot silently truncate in the HUD.
"""

import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, "data", "speech_lines.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "speech_table.cpp")

EXPECTED_ROWS = 285

# Order MUST match `enum class SpeechSituation` in src/game/speech.h: it is the
# generated bucket table's major index.
SITUATIONS = [
    "AMBIENT", "HUNGER", "THIRST", "SLEEP", "RELIEF", "WOUNDED", "FEAR",
    "COMBAT", "HIDE", "FOG", "AFTER", "SOCIAL", "WORK",
]
SITUATION_ENUM = {
    "AMBIENT": "Ambient", "HUNGER": "Hunger", "THIRST": "Thirst",
    "SLEEP": "Sleep", "RELIEF": "Relief", "WOUNDED": "Wounded",
    "FEAR": "Fear", "COMBAT": "Combat", "HIDE": "Hide", "FOG": "Fog",
    "AFTER": "After", "SOCIAL": "Social", "WORK": "Work",
}

# Order MUST match `enum class Faction` in src/game/faction.h. ANY is the wildcard
# slot and sorts LAST within a situation, which is what lets the runtime treat
# (specific, wildcard) as two ranges in a fixed order.
FACTIONS = ["CITIZENS", "LIQUIDATORS", "CULTISTS", "SCIENTISTS", "WILD"]
ANY_SLOT = len(FACTIONS)

# Longest line the HUD renders without truncating; `rumour_text` documents 160 as
# the floor on its own buffer and speech shares that surface.
MAX_LINE_BYTES = 140

# markov.md "Тон И Запреты" — the smooth-trailer-poetry register the reference
# bans outright, plus its chosen-one vocabulary. Lowercase substring match on the
# decoded text.
TONE_BLACKLIST = [
    "вечность", "бездна", "мироздание", "память бетона", "дом выбрал",
    "геометрия жаждет", "алгоритм страдания", "избранный", "пророк",
    "спаситель",
]
# markov.md's internal-reveal list: a player-facing line must never leak the
# engine. English tokens, matched case-insensitively.
INTERNAL_BLACKLIST = ["seed", "toroid", "layerid", "1024", "128", "voxel"]


def die(msg):
    sys.stderr.write("gen_speech_table: %s\n" % msg)
    sys.exit(1)


def cpp_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    with open(CSV_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    if len(rows) != EXPECTED_ROWS:
        die("expected %d rows, got %d — if the bank really changed, update "
            "EXPECTED_ROWS here AND kSpeechLineCount in src/game/speech.h"
            % (EXPECTED_ROWS, len(rows)))

    seen_text = {}
    parsed = []
    for i, r in enumerate(rows):
        line_no = i + 2  # 1-based, past the header
        sit = (r.get("situation") or "").strip()
        fac = (r.get("faction") or "").strip()
        text = (r.get("text_ru") or "").strip()

        if sit not in SITUATIONS:
            die("line %d: unknown situation %r — add it to SITUATIONS here AND to "
                "SpeechSituation in src/game/speech.h" % (line_no, sit))
        if fac != "ANY" and fac not in FACTIONS:
            die("line %d: unknown faction %r — expected ANY or one of %s"
                % (line_no, fac, "|".join(FACTIONS)))
        if not text:
            die("line %d: empty text_ru" % line_no)

        nbytes = len(text.encode("utf-8"))
        if nbytes > MAX_LINE_BYTES:
            die("line %d: %d bytes, cap is %d — a longer line truncates in the HUD"
                % (line_no, nbytes, MAX_LINE_BYTES))
        if any(ch.isdigit() for ch in text):
            die("line %d: contains a digit. A speech line must never state a "
                "checkable number — that is [rumour.h]'s job, and mixing the two "
                "is what turns two channels into two systems for one job." % line_no)
        if '"' in text:
            die("line %d: contains a double quote; use the Russian angle quotes "
                "instead so the CSV stays trivially quotable" % line_no)

        low = text.lower()
        for bad in TONE_BLACKLIST:
            if bad in low:
                die("line %d: tone blacklist hit %r (markov.md 'Тон И Запреты')"
                    % (line_no, bad))
        for bad in INTERNAL_BLACKLIST:
            if bad in low:
                die("line %d: internal-reveal blacklist hit %r — a player-facing "
                    "line must not leak the engine" % (line_no, bad))

        if text in seen_text:
            die("line %d: duplicate of line %d. A duplicate silently doubles one "
                "line's odds and makes the anti-repeat guarantee a lie."
                % (line_no, seen_text[text]))
        seen_text[text] = line_no

        slot = ANY_SLOT if fac == "ANY" else FACTIONS.index(fac)
        parsed.append((SITUATIONS.index(sit), slot, text, sit, fac))

    # Stable sort by (situation, faction slot): the CSV's authored order survives
    # inside a bucket, so a content author controls which line a given seed hits.
    parsed.sort(key=lambda t: (t[0], t[1]))

    # Bake the buckets. row-major [situation][slot].
    buckets = {}
    for idx, (si, slot, _text, _sit, _fac) in enumerate(parsed):
        b = buckets.setdefault((si, slot), [idx, 0])
        b[1] += 1
        if idx < b[0]:
            b[0] = idx

    # The gate that makes "no speaker is ever mute" a property of the data.
    for si, sit in enumerate(SITUATIONS):
        if (si, ANY_SLOT) not in buckets:
            die("situation %s has no ANY line. Every situation needs a wildcard "
                "register, or a faction with no authored line for it goes MUTE."
                % sit)
        n_any = buckets[(si, ANY_SLOT)][1]
        for slot, fac in enumerate(FACTIONS):
            total = buckets.get((si, slot), [0, 0])[1] + n_any
            if total < 2:
                die("situation %s x faction %s can draw from %d line(s). Under two, "
                    "speech_say cannot honour 'never the same line twice in a row'."
                    % (sit, fac, total))

    # --- emit ---------------------------------------------------------------
    text_rows = []
    for si, slot, text, sit, fac in parsed:
        text_rows.append("    /* %-7s %-11s */ %s," % (sit, fac, cpp_string(text)))

    bucket_rows = []
    for si, sit in enumerate(SITUATIONS):
        cells = []
        for slot in range(ANY_SLOT + 1):
            first, count = buckets.get((si, slot), [0, 0])
            cells.append("{%3d,%3d}" % (first, count))
        bucket_rows.append("    // %-7s   %s\n    %s,"
                           % (sit,
                              "  ".join("%-9s" % f for f in FACTIONS + ["ANY"]),
                              ", ".join(cells)))

    name_rows = []
    for sit in SITUATIONS:
        name_rows.append('    "%s",' % sit.lower())

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER % (len(parsed), len(SITUATIONS), ANY_SLOT + 1))
        fh.write("const std::array<const char*, kSpeechLineCount> kSpeechText = {{\n")
        fh.write("\n".join(text_rows))
        fh.write("\n}};\n\n")
        fh.write("const std::array<SpeechBucket, kSpeechSituationCount * "
                 "kSpeechFactionSlots>\n    kSpeechBuckets = {{\n")
        fh.write("\n".join(bucket_rows))
        fh.write("\n}};\n\n")
        fh.write("namespace {\n"
                 "// ASCII, parallel to SpeechSituation — HUD labels and test messages.\n"
                 "constexpr std::array<const char*, kSpeechSituationCount> "
                 "kSituationName = {{\n")
        fh.write("\n".join(name_rows))
        fh.write("\n}};\n} // namespace\n\n")
        fh.write(FOOTER)

    cyr = sum(1 for b in open(OUT_PATH, "rb").read() if b in (0xD0, 0xD1))
    sys.stderr.write(
        "gen_speech_table: wrote %d lines (%d situations x %d slots) to %s; "
        "%d UTF-8 Cyrillic lead bytes\n"
        % (len(parsed), len(SITUATIONS), ANY_SLOT + 1, OUT_PATH, cyr))


HEADER = """// GENERATED by tools/gen_speech_table.py from data/speech_lines.csv — do not
// hand-edit. Edit the CSV and re-run the generator; see [speech.h].
//
// %d lines, sorted by (situation, faction slot) with the wildcard slot last, so
// every one of the %d x %d (situation, faction) pairs is two contiguous ranges and
// the runtime pick needs no index list. The bucket table below IS the baked index.
//
// This file carries Cyrillic string literals (the lines themselves), which is what
// makes /utf-8 load-bearing on MSVC rather than merely defensive — same reason as
// item_table.cpp and mob_table.cpp.
#include "game/speech.h"

namespace giga::game {

"""

FOOTER = """const SpeechBucket& speech_bucket(SpeechSituation s, std::uint8_t factionSlot) {
    // Bounds-tolerant, mirroring `item_def`: a bad index answers Ambient/ANY rather
    // than reading off the end, because a generic line is a recoverable content bug
    // and an out-of-bounds read is not.
    const std::size_t si = static_cast<std::size_t>(s);
    const std::size_t fi = factionSlot;
    if (si >= kSpeechSituationCount || fi >= kSpeechFactionSlots)
        return kSpeechBuckets[kSpeechAnySlot];
    return kSpeechBuckets[si * kSpeechFactionSlots + fi];
}

const char* speech_situation_name(SpeechSituation s) {
    const std::size_t si = static_cast<std::size_t>(s);
    return si < kSpeechSituationCount ? kSituationName[si] : "?";
}

} // namespace giga::game
"""

if __name__ == "__main__":
    main()
