#!/usr/bin/env python3
"""Generate src/game/ranged_table.cpp from data/weapons_ranged.csv.

Fourth sibling of gen_mob_table.py / gen_item_table.py / gen_weapon_table.py, same
contract: data is the truth, the generated .cpp is committed so the build needs no
Python, and an unknown token is a hard error rather than a silent default.

    python tools/gen_ranged_table.py

Scope: the 29 `ProjType.NORMAL` weapons out of the reference's 48 ranged rows. The
other 19 are grenades, flamers, BFG and beams, which need detonation, burn statuses,
area damage or hitscan — none of which exist. Porting their numbers without those
systems would be a table nothing reads, which is the mistake the mob behaviour column
made and took a separate commit to undo.

Two things this generator does that gen_weapon_table.py does not:

  * It resolves `ammo_item` to a 1-based ItemId at BUILD time. That is what dissolves
    the "ammo_id needs interned string ids" deferral recorded in item_table.h — the
    requirement was never string interning, it was an integer in a table that is not
    the 20-byte ItemDef.
  * It checks the resolved ammo item is actually `category == AMMO`, so pointing a
    weapon at a tin of stew is a build failure rather than an unloadable gun.

Fields the reference does NOT have, and which are therefore absent here rather than
invented: `range` (zero on every ranged row — effective range is emergent from speed
and gravity), `reloadTime` (never set on a ranged weapon; every firearm falls through
to a flat 1.0 s, which is recorded in the CSV honestly instead of hidden as a magic
number in code), `durability` (zero on every ranged row — firearms never wear), and
`damageType` (set on zero physical weapons, so a shotgun does Kinetic in the
reference, not Buckshot).
"""

import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RANGED_CSV = os.path.join(REPO, "data", "weapons_ranged.csv")
ITEMS_CSV = os.path.join(REPO, "data", "items.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "ranged_table.cpp")

EXPECTED_ROWS = 29        # ProjType.NORMAL only
EXPECTED_ITEM_ROWS = 442  # must agree with kItemCount


def die(msg):
    sys.stderr.write("gen_ranged_table: %s\n" % msg)
    sys.exit(1)


def fixed(row, col, scale, lo, hi):
    text = (row.get(col) or "").strip()
    v = 0 if not text else int(round(float(text) * scale))
    if not (lo <= v <= hi):
        die("%r: %s = %r -> %d out of [%d, %d]"
            % (row["item_id"], col, text, v, lo, hi))
    return v


def main():
    with open(RANGED_CSV, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    with open(ITEMS_CSV, encoding="utf-8", newline="") as fh:
        items = list(csv.DictReader(fh))

    if len(rows) != EXPECTED_ROWS:
        die("expected %d ranged rows, got %d — update EXPECTED_ROWS here AND "
            "kRangedCount in ranged_table.h" % (EXPECTED_ROWS, len(rows)))
    if len(items) != EXPECTED_ITEM_ROWS:
        die("items.csv has %d rows, expected %d — the item table moved; the "
            "kRangedByItem index width depends on it"
            % (len(items), EXPECTED_ITEM_ROWS))

    item_index = {r["id"]: i + 1 for i, r in enumerate(items)}
    item_cat = {r["id"]: (r.get("category") or "").strip().upper() for r in items}

    by_item = [0] * (EXPECTED_ITEM_ROWS + 1)
    out = []
    for i, r in enumerate(rows):
        name = r["item_id"].strip()
        if not name:
            die("row %d has an empty item_id; unlike melee there is no unarmed "
                "ranged fallback" % i)
        if name not in item_index:
            die("ranged weapon %r has no matching id in items.csv — a rename "
                "orphaned its stats" % name)
        iid = item_index[name]
        if by_item[iid]:
            die("item %r already mapped to ranged index %d"
                % (name, by_item[iid] - 1))
        # +1, NOT i: 0 in this map means "not a ranged weapon", and index
        # 0 here is makarov, a real gun. The melee table gets away with a
        # raw index only because fists deliberately occupy slot 0.
        by_item[iid] = i + 1

        ammo = (r.get("ammo_item") or "").strip()
        if ammo not in item_index:
            die("%r: ammo_item %r is not an id in items.csv" % (name, ammo))
        if item_cat.get(ammo) != "AMMO":
            die("%r: ammo_item %r has category %r, expected AMMO — a weapon "
                "pointed at a non-ammo item is an unloadable gun"
                % (name, ammo, item_cat.get(ammo)))
        ammoId = item_index[ammo]

        pellets = fixed(r, "pellets", 1, 1, 255)
        out.append(
            "    // [%2d] %-24s %s x%d\n"
            "    RangedDef{ %d, %d, %d, %d, %d, %d, %d, %d, 0, 0 }," % (
                i, name, ammo, pellets,
                fixed(r, "dmg", 1, 1, 4000),
                fixed(r, "cooldown_s", 1000, 20, 20000),
                fixed(r, "proj_speed_cells", 1000, 1000, 65000),
                # 1e-4 rad, NOT milliradians: ptrs_liquidator is 0.0015 rad, which
                # milliradians would round to 2 (a 33% error). Microradians would
                # overflow uint16 at 0.0655 rad and granit4u needs 0.46.
                fixed(r, "spread_rad", 10000, 0, 65535),
                fixed(r, "reload_s", 1000, 0, 20000),
                ammoId,
                pellets,
                fixed(r, "magazine", 1, 1, 255)))

    mapped = sum(1 for v in by_item if v)
    if mapped != EXPECTED_ROWS:
        die("mapped %d items but expected %d — every ranged row must be reachable "
            "by its own item id" % (mapped, EXPECTED_ROWS))

    idx = []
    for i in range(0, len(by_item), 24):
        idx.append("    " + ", ".join(str(v) for v in by_item[i:i + 24]) + ",")

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER)
        fh.write("const std::array<RangedDef, kRangedCount> kRangedTable = {{\n")
        fh.write("\n".join(out))
        fh.write("\n}};\n\n")
        fh.write("// Index by ItemId, ONE-BASED: 0 means \"not a ranged weapon\" and N\n"
                 "// means kRangedTable[N-1]. Unlike the melee table there is no\n"
                 "// unarmed row to park at slot 0, so a raw index would make the very\n"
                 "// first weapon in the table permanently unreachable.\n")
        fh.write("const std::array<std::uint8_t, kItemCount + 1> kRangedByItem = {{\n")
        fh.write("\n".join(idx))
        fh.write("\n}};\n\n")
        fh.write(FOOTER)

    sys.stderr.write("gen_ranged_table: wrote %d ranged rows to %s\n"
                     % (len(rows), OUT_PATH))


HEADER = """// GENERATED by tools/gen_ranged_table.py from data/weapons_ranged.csv — do not
// hand-edit. Edit the CSV and re-run the generator; see [items.md].
#include "game/ranged_table.h"

namespace giga::game {

"""

FOOTER = """} // namespace giga::game
"""

if __name__ == "__main__":
    main()
