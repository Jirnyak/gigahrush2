#!/usr/bin/env python3
"""Generate src/game/status_table.cpp from data/status.csv.

Sibling of gen_economy_table.py / gen_item_table.py, same contract: the CSV is the
truth, the generated .cpp is committed so the build needs no Python, and an unknown
token is a hard error rather than a silent default.

    python tools/gen_status_table.py

WHY THIS TABLE EXISTS. src/game/combat.h carries `Slowed`, a hand-ported one-off of
exactly ONE of the six statuses the reference authors — paupsina_web. The other five
had numbers in the reference and no home here. A per-status row subsumes the one-off
and gives the other five somewhere to live.

Fixed-point, and the scale is stated because a reader cannot guess it: every
multiplier is stored x1000 (`_e3`), so 0.54 is 540 and 1.65 is 1650. Integer, because
this tree pins bit-exact digests in tests and a float multiplier chain is not
guaranteed identical between MSVC and Clang.

The two-column duration/multiplier shape (`duration_ms` + `alt_duration_ms`) is the
reference's own: zhelemish is 180 s raw and 150 s treated, spore_haze is 4.8 s bare
and 2.2 s through an IP-4, and paupsina's move multiplier is 0.54 walking and 0.22
while rooted. One row per status with an alternate, not two rows, because the ALT is
selected by a condition at runtime and is not a separate status the player can hold.
"""

import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUS_CSV = os.path.join(REPO, "data", "status.csv")
ITEMS_CSV = os.path.join(REPO, "data", "items.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "status_table.cpp")

EXPECTED_ROWS = 6         # must agree with kStatusCount in status.h
EXPECTED_ITEM_ROWS = 443  # must agree with kItemCount


def die(msg):
    sys.stderr.write("gen_status_table: %s\n" % msg)
    sys.exit(1)


def num(row, col, lo, hi):
    text = (row.get(col) or "").strip()
    v = 0 if not text else int(text)
    if not (lo <= v <= hi):
        die("%r: %s = %r out of [%d, %d]" % (row["id"], col, text, lo, hi))
    return v


def main():
    with open(STATUS_CSV, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    with open(ITEMS_CSV, encoding="utf-8", newline="") as fh:
        items = list(csv.DictReader(fh))

    if len(rows) != EXPECTED_ROWS:
        die("expected %d status rows, got %d — update EXPECTED_ROWS here AND "
            "kStatusCount in status.h" % (EXPECTED_ROWS, len(rows)))
    if len(items) != EXPECTED_ITEM_ROWS:
        die("items.csv has %d rows, expected %d — the item table moved and the "
            "gate_item resolution depends on it"
            % (len(items), EXPECTED_ITEM_ROWS))

    item_index = {r["id"]: i + 1 for i, r in enumerate(items)}

    defs = []
    names = []
    for r in rows:
        sid = (r.get("id") or "").strip()
        if not sid:
            die("a row has an empty id")
        name = (r.get("name") or "").strip()
        if not name:
            die("%r has an empty display name" % sid)

        # An empty gate_item means "no item changes this status", which is 0 —
        # kInvalidItem. A NON-empty one that is not in items.csv is a hard error and
        # not a silent 0: a typo'd gate would read at runtime as "never protected",
        # which looks like a balance decision instead of a broken lookup.
        gate = (r.get("gate_item") or "").strip()
        gateId = 0
        if gate:
            if gate not in item_index:
                die("%r: gate_item %r is not an id in items.csv — a rename "
                    "orphaned it" % (sid, gate))
            gateId = item_index[gate]

        names.append((sid, name))
        defs.append(
            "    // [%d] %s\n"
            "    StatusDef{ %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d, %d }," % (
                len(defs), sid,
                num(r, "duration_ms", 1, 3600000),
                num(r, "alt_duration_ms", 1, 3600000),
                num(r, "move_mult_e3", 1, 4000),
                num(r, "alt_move_mult_e3", 1, 4000),
                num(r, "aim_mult_e3", 1, 8000),
                num(r, "alt_aim_mult_e3", 1, 8000),
                num(r, "root_ms", 0, 60000),
                num(r, "melee_mult_e3", 1, 4000),
                num(r, "heal_mult_e3", 1, 4000),
                num(r, "water_drain_e3", 0, 1000),
                gateId,
                num(r, "stacks", 0, 1)))

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER)
        fh.write("const std::array<StatusDef, kStatusCount> kStatusTable = {{\n")
        fh.write("\n".join(defs))
        fh.write("\n}};\n\n")
        fh.write("// Display names. Cyrillic, and never printed by a test: this host's\n"
                 "// console is CP1251 and would emit mojibake. Suites assert non-empty\n"
                 "// and count 0xD0/0xD1 lead bytes instead.\n")
        fh.write("const std::array<const char*, kStatusCount> kStatusNames = {{\n")
        for sid, name in names:
            fh.write("    \"%s\",  // %s\n" % (name, sid))
        fh.write("}};\n\n")
        fh.write(FOOTER)

    sys.stderr.write("gen_status_table: wrote %d status rows to %s\n"
                     % (len(rows), OUT_PATH))


HEADER = """// GENERATED by tools/gen_status_table.py from data/status.csv — do not
// hand-edit. Edit the CSV and re-run the generator.
#include "game/status.h"

namespace giga::game {

"""

FOOTER = """} // namespace giga::game
"""

if __name__ == "__main__":
    main()
