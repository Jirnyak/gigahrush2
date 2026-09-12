#!/usr/bin/env python3
"""Generate src/game/economy_table.cpp from data/economy.csv.

Sibling of tools/gen_item_table.py and deliberately the same shape: the catalog is
data ([economy.h]), so retuning a band is one CSV cell plus a regenerate, never an
edit to engine code. Not wired into CMake — the generated .cpp is committed, so the
build needs no Python — and it hard-fails on an unknown token rather than mapping it
to a default, because silently defaulting is how a content table rots.

    python tools/gen_economy_table.py

ONE ROW KIND today: the E0..E4 depth bands say what money means at a depth. The
`kind` discriminator column stays — a second kind (the WEALTH net-worth tiers
lived here until 2026-08-27, cut by owner verdict: test-only readers) would be
new rows plus an array in economy.h, not a new file.

Cross-checks this generator performs, all of them against numbers that live
somewhere else in the tree (a generator that only validates itself validates
nothing):

  * exactly 5 BAND rows, in order and in ascending order;
  * BAND `loot_cap` must equal `kLootValueCap[band]` in src/game/item_table.h,
    parsed out of that header — the two are the same authored number and the
    reference authors it once (economics.ts ECONOMY_MONEY_BANDS[].lootValueCap);
  * BAND `lo`/`hi` brackets must be contiguous, start at 0, end at 127, and match
    the `economy_band()` thresholds compiled into src/game/item_table.cpp;
  * `deposit_bp < loan_bp` on every band — a bank that pays more than it charges is
    a money press, and integer roubles will not save it.
"""

import csv
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, "data", "economy.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "economy_table.cpp")
ITEM_HDR = os.path.join(REPO, "src", "game", "item_table.h")
ITEM_SRC = os.path.join(REPO, "src", "game", "item_table.cpp")

EXPECTED_BANDS = 5

BAND_IDS = ["E0", "E1", "E2", "E3", "E4"]


def die(msg):
    sys.stderr.write("gen_economy_table: %s\n" % msg)
    sys.exit(1)


def cell(row, col):
    return (row.get(col) or "").strip()


def num(row, col, i, lo, hi):
    text = cell(row, col)
    if not text:
        die("row %d (%s): %s is empty and this kind requires it"
            % (i, row["id"], col))
    if not re.fullmatch(r"-?[0-9]+", text):
        die("row %d (%s): %s = %r is not an integer. Roubles are integers here — "
            "there is no float currency in this game and adding one would drift "
            "across a save boundary." % (i, row["id"], col, text))
    v = int(text)
    if not (lo <= v <= hi):
        die("row %d (%s): %s = %d out of [%d, %d]" % (i, row["id"], col, v, lo, hi))
    return v


def cpp_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def loot_caps_from_item_table():
    """`kLootValueCap` as item_table.h authors it, so drift is a build failure.

    Parsed rather than duplicated: this is the one number that already exists in
    two places by design (the reference authors it once, on its own money band),
    and a second hand-typed copy is a copy that will be retuned alone.
    """
    with open(ITEM_HDR, encoding="utf-8") as fh:
        text = fh.read()
    m = re.search(r"kLootValueCap\s*\[\s*kEconomyBands\s*\]\s*=\s*\{([^}]*)\}", text)
    if not m:
        die("could not find kLootValueCap in %s — the header's shape changed, so "
            "this cross-check is now blind. Fix the regex rather than deleting it."
            % ITEM_HDR)
    caps = [int(t) for t in re.findall(r"-?[0-9]+", m.group(1))]
    if len(caps) != EXPECTED_BANDS:
        die("kLootValueCap has %d entries, expected %d" % (len(caps), EXPECTED_BANDS))
    return caps


def band_thresholds_from_item_table():
    """The `|floor| <= N` ladder `economy_band()` is compiled from.

    Returns the inclusive upper bound of each band, with the last one open-ended and
    reported as 127 (`kFloorSlots` runs -127..127, [floor_registry.h]).
    """
    with open(ITEM_SRC, encoding="utf-8") as fh:
        text = fh.read()
    body = text[text.find("std::uint8_t economy_band("):]
    body = body[:body.find("\n}")]
    hi = [int(t) for t in re.findall(r"if\s*\(a\s*<=\s*([0-9]+)\s*\)", body)]
    if len(hi) != EXPECTED_BANDS - 1:
        die("economy_band() in %s has %d '<=' thresholds, expected %d — the "
            "function's shape changed and this cross-check is now blind."
            % (ITEM_SRC, len(hi), EXPECTED_BANDS - 1))
    return hi + [127]


def main():
    with open(CSV_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    bands = [r for r in rows if cell(r, "kind") == "BAND"]
    unknown = [cell(r, "kind") for r in rows if cell(r, "kind") != "BAND"]
    if unknown:
        die("unknown kind(s) %s — add the kind here AND an array for it in "
            "src/game/economy.h; a row nothing emits is a row that reads as "
            "authored and is not." % sorted(set(unknown)))
    if len(bands) != EXPECTED_BANDS:
        die("expected %d BAND rows, got %d — if the table really changed, update "
            "EXPECTED_BANDS here AND kEconomyRows in economy.h (the source_rules "
            "gate reads that literal)" % (EXPECTED_BANDS, len(bands)))
    if [cell(r, "id") for r in bands] != BAND_IDS:
        die("BAND ids must be exactly %s in order, got %s"
            % (BAND_IDS, [cell(r, "id") for r in bands]))

    for i, r in enumerate(rows):
        if not cell(r, "name_ru"):
            die("row %d (%s) has no name_ru" % (i, r["id"]))

    caps = loot_caps_from_item_table()
    hi_bounds = band_thresholds_from_item_table()

    band_out, band_names = [], []
    prev_lo = -1
    for i, r in enumerate(bands):
        lo = num(r, "lo", i, 0, 127)
        hi = num(r, "hi", i, 0, 127)
        if lo > hi:
            die("band %s: lo %d > hi %d" % (r["id"], lo, hi))
        if lo != prev_lo + 1:
            die("band %s starts at |floor| %d but the previous band ended at %d — "
                "the brackets must be contiguous or some depth has no band"
                % (r["id"], lo, prev_lo))
        prev_lo = hi
        if hi != hi_bounds[i]:
            die("band %s: hi = %d but economy_band() in %s brackets it at %d. The "
                "CSV and the compiled function must agree or the table describes a "
                "depth the game does not put there."
                % (r["id"], hi, ITEM_SRC, hi_bounds[i]))

        loot = num(r, "loot_cap", i, 1, 2000000000)
        if loot != caps[i]:
            die("band %s: loot_cap = %d but kLootValueCap[%d] = %d in %s. Same "
                "authored number, two homes — retune both or neither."
                % (r["id"], loot, i, caps[i], ITEM_HDR))

        dep = num(r, "deposit_bp", i, 0, 10000)
        loan = num(r, "loan_bp", i, 0, 10000)
        if dep >= loan:
            die("band %s: deposit_bp %d >= loan_bp %d. A bank that pays at least "
                "what it charges is a money press: borrow at the limit, deposit the "
                "proceeds, and the account grows with no expedition. The reference's "
                "own spread is 0.010 deposit / 0.015 loan." % (r["id"], dep, loan))

        band_out.append(
            "    // [%d] %s  |floor| %d..%d\n"
            "    BankTerms{ %d, %d, %d, %d, %d,\n"
            "               %d, %d, %d, %d, {0, 0} },"
            % (i, r["id"], lo, hi,
               loot,
               num(r, "cash_cap", i, 1, 2000000000),
               num(r, "quest_cap", i, 1, 2000000000),
               num(r, "quest_rate", i, 1, 2000000000),
               num(r, "credit_limit", i, 0, 2000000000),
               dep, loan, lo, hi))
        band_names.append("    %s," % cpp_string(cell(r, "name_ru")))

    if [cell(r, "lo") for r in bands][0] != "0":
        die("the first band must start at |floor| 0")

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER)
        fh.write("const std::array<BankTerms, kEconomyBands> kBankTerms = {{\n")
        fh.write("\n".join(band_out))
        fh.write("\n}};\n\n")
        fh.write("const std::array<const char*, kEconomyBands> kBandNames = {{\n")
        fh.write("\n".join(band_names))
        fh.write("\n}};\n\n")
        fh.write(FOOTER)

    sys.stderr.write("gen_economy_table: wrote %d band rows to %s\n"
                     % (len(bands), OUT_PATH))


HEADER = """// GENERATED by tools/gen_economy_table.py from data/economy.csv — do not hand-edit.
// Edit the CSV and re-run the generator; see [economy.h].
//
// This file carries Cyrillic string literals (the band and wealth-tier names), which
// is what makes /utf-8 load-bearing on MSVC rather than merely defensive.
#include "game/economy.h"

namespace giga::game {

"""

FOOTER = """} // namespace giga::game
"""

if __name__ == "__main__":
    main()
