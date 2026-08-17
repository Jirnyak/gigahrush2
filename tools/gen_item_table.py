#!/usr/bin/env python3
"""Generate src/game/item_table.cpp from data/items.csv.

Sibling of tools/gen_mob_table.py and deliberately the same shape: the catalog is
data ([items.md]), so adding an item is one CSV row plus a regenerate, never an
edit to engine code. Not wired into CMake — the generated .cpp is committed, so
the build needs no Python — and it hard-fails on an unknown token rather than
mapping it to a default, because silently defaulting is how a content table rots.

    python tools/gen_item_table.py
"""

import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, "data", "items.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "item_table.cpp")

EXPECTED_ROWS = 443

CATEGORY = {
    "MISC": "Misc", "WEAPON": "Weapon", "FOOD": "Food", "MEDICINE": "Medicine",
    "AMMO": "Ammo", "TOOL": "Tool", "DRINK": "Drink", "KEY": "Key", "NOTE": "Note",
}
# FlickerProfile ordinals — lockstep с src/game/flicker.h / gen_prop_table.py.
FLICKER = {"none": 0, "mains": 1, "arc": 2, "pulse": 3, "crt": 4}

EQUIP = {"None": "None", "": "None", "Weapon": "Weapon", "Armor": "Armor",
         "Tool": "Tool"}
USE = {
    "None": "None", "": "None",
    "Heal": "Heal", "HealPsi": "HealPsi", "Feed": "Feed", "FeedPsi": "FeedPsi",
    "FeedRisky": "FeedRisky", "Drink": "Drink", "DrinkStim": "DrinkStim",
    "Painkiller": "Painkiller", "Antiemetic": "Antiemetic",
    "SleepingPills": "SleepingPills", "PsiSurge": "PsiSurge",
    "TechnicalSpirit": "TechnicalSpirit", "Unpack": "Unpack",
    "UnsealSample": "UnsealSample", "RedeemCoupon": "RedeemCoupon",
}
ROOM = {
    "CORRIDOR": "Corridor", "COMMON": "Common", "STORAGE": "Storage",
    "KITCHEN": "Kitchen", "BATHROOM": "Bathroom", "LIVING": "Living",
    "OFFICE": "Office", "MEDICAL": "Medical", "PRODUCTION": "Production",
    "SMOKING": "Smoking", "HQ": "Hq",
}
RESIST_COLS = ["resist_kinetic", "resist_buckshot", "resist_energy",
               "resist_fire", "resist_psi"]


def die(msg):
    sys.stderr.write("gen_item_table: %s\n" % msg)
    sys.exit(1)


def num(row, col, i, lo, hi, scale=1):
    text = (row.get(col) or "").strip()
    v = 0 if not text else int(round(float(text) * scale))
    if not (lo <= v <= hi):
        die("row %d (%s): %s = %r -> %d out of [%d, %d]"
            % (i, row["id"], col, text, v, lo, hi))
    return v


def spawn_weight(row, i):
    """`spawn_w_milli`, with the one rounding case that silently deletes an item.

    `spawnWeight == 0` means "never spawns randomly" — item_table.cpp's
    `item_weight_on_floor` returns 0 outright, which removes the row from all three
    weighted paths (loot.cpp:91, container.cpp:119, contract.cpp:65). That is a
    legitimate authored state and stays legal.

    What is rejected is a non-zero cell that ROUNDS to zero, because this column's
    unit differs from the reference's by 1000x: the TypeScript source authors
    `spawnW: 0.35` and this CSV stores 350. Paste the reference's number into the
    cell unconverted and `int(round(0.35))` is 0 — the item is not rare, it is gone,
    and nothing downstream can tell that apart from an authored opt-out. Measured
    2026-07-29: 0 of 446 rows are currently in that state and none carries a
    fractional cell, so this is a tripwire on a live hazard, not a fix.

    The sibling generator hit exactly this class of bug for real: mobs.csv authored
    SCULPTURE at spawn_weight 0.05 into a tenths field and lost the row. See
    gen_mob_table.fixed_nonzero.
    """
    text = (row.get("spawn_w_milli") or "").strip()
    v = num(row, "spawn_w_milli", i, 0, 65535)
    if v == 0 and text not in ("", "0"):
        die("row %d (%s): spawn_w_milli = %r rounds to 0, which reads as 'never "
            "spawns'. This column is MILLI-weight (the reference's spawnW * 1000): "
            "0.35 there is 350 here. Write the milli value, or 0 to mean never."
            % (i, row["id"], text))
    return v


def room_mask(row, i):
    text = (row.get("spawn_rooms") or "").strip()
    if not text:
        return "0"
    bits = []
    for tok in text.split("|"):
        tok = tok.strip()
        if not tok:
            continue
        if tok not in ROOM:
            die("row %d (%s): unknown room %r" % (i, row["id"], tok))
        bits.append("u16(RoomBit::%s)" % ROOM[tok])
    return " | ".join(bits) if bits else "0"


def cpp_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def pick(table, row, col, i, what):
    tok = (row.get(col) or "").strip()
    if tok not in table:
        die("row %d (%s): unknown %s %r — add it to the map here AND to the enum "
            "in item_table.h" % (i, row["id"], what, tok))
    return table[tok]


def item_mass_g(row, i):
    """Grams for one item, straight out of the row's own `mass_g` column.

    THE COLUMN IS THE SOURCE, exactly as it is for props and mobs — one shape for
    all three catalogs, an item's weight sitting beside its value and its stack cap
    where anyone reading the row will see it.

    It was briefly resolved from a rule table (data/item_mass.csv) instead, which is
    how these 442 values were AUTHORED — writing "документ весит 20 г" once is how
    75 bureaucratic MISC rows got an honest weight rather than 442 blind guesses.
    That table did its job and was migrated into this column; the reasoning survives
    in items.md, and the values are now plain data with no indirection to resolve.

    Empty or zero is legal and means "not a physical object": a psi technique is a
    thing you know, not a thing in your pack, and 20 rows are exactly that. It is
    NOT a licence for an unfilled column — the CSV carries a value on every row and
    `source_rules` counts them — which is why the prop and mob tables, where 0 would
    be indistinguishable from unfilled, refuse it outright.
    """
    raw = (row.get("mass_g") or "").strip()
    if not raw.isdigit():
        die("row %d (%s): mass_g %r must be a whole number of grams — every item "
            "has a weight" % (i, row["id"], raw))
    g = int(raw)
    if g > 4294967295:
        die("row %d (%s): %d g exceeds uint32" % (i, row["id"], g))
    return g


def main():
    with open(CSV_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    if len(rows) != EXPECTED_ROWS:
        die("expected %d rows, got %d — if the catalog really changed, update "
            "EXPECTED_ROWS here AND kItemCount in item_table.h"
            % (EXPECTED_ROWS, len(rows)))

    seen, out, names, descs = set(), [], [], []
    used_cat, used_use = set(), set()
    resolved = []
    for i, r in enumerate(rows):
        if r["id"] in seen:
            die("duplicate id %r at row %d" % (r["id"], i))
        seen.add(r["id"])
        if not (r.get("name_ru") or "").strip():
            die("row %d (%s) has no name" % (i, r["id"]))

        cat = pick(CATEGORY, r, "category", i, "category")
        eq = pick(EQUIP, r, "equip_slot", i, "equip slot")
        ue = pick(USE, r, "use_effect", i, "use effect")
        used_cat.add(cat)
        used_use.add(ue)

        resists = [num(r, c, i, -128, 127) for c in RESIST_COLS]

        massG = item_mass_g(r, i)
        resolved.append((r["id"], massG))

        flicker = (r.get("flicker") or "none").strip()
        if flicker not in FLICKER:
            die("row %d (%s): unknown flicker %r" % (i, r["id"], flicker))
        light_radius = num(r, "light_radius_mm", i, 0, 65535)
        light_intensity = num(r, "light_intensity_e3", i, 0, 65535)
        light_cone = num(r, "light_cone_deg", i, 0, 89)
        if (light_radius == 0) != (light_intensity == 0):
            die("row %d (%s): light_radius_mm and light_intensity_e3 must be "
                "both zero or both set" % (i, r["id"]))

        out.append(
            "    // [%d] id %d  %s  (%d g)\n"
            "    ItemDef{ %d, %d, %d, static_cast<std::uint16_t>(%s), %d, %d,\n"
            "             u8(ItemCategory::%s), u8(EquipSlot::%s),\n"
            "             u8(UseEffect::%s), {%s}, %d, %d, %d, %d, %d },"
            % (i, i + 1, r["id"], massG,
               num(r, "value_rub", i, 0, 2000000000),
               massG,
               spawn_weight(r, i),
               room_mask(r, i),
               num(r, "use_a", i, -32768, 32767),
               # stack_max is u16 since the ruble row (money stacks to the
               # honest u16 ceiling); field order follows ItemDef, where the
               # width move re-slotted it beside the other u16s.
               num(r, "stack_max", i, 1, 65535),
               cat, eq,
               ue,
               ", ".join(str(x) for x in resists),
               # durability: USES until ruined; empty column = 0 = never wears.
               num(r, "durability", i, 0, 65535),
               light_radius, light_intensity, light_cone, FLICKER[flicker]))
        names.append("    %s," % cpp_string(r["name_ru"].strip()))
        # Authored flavour text — all 442 rows carry one. The inventory card
        # ([inventory.md]) is its consumer; an empty cell would be a CSV defect.
        d = (r.get("desc_ru") or "").strip()
        if not d:
            die("row %d (%s) has no desc_ru" % (i, r["id"]))
        descs.append("    %s," % cpp_string(d))

    # THE MASS SUMMARY, printed every run. A number nobody can see is a number
    # nobody can argue with: this is what lets the owner spot "справка весит 2 кг"
    # without reading 442 rows of a wide CSV or of generated C++.
    heavy = sorted(resolved, key=lambda t: -t[1])[:6]
    light = sorted((t for t in resolved if t[1] > 0), key=lambda t: t[1])[:6]
    total = sum(t[1] for t in resolved)
    sys.stderr.write(
        "gen_item_table: mass on %d items, %.1f kg if you carried one of each\n"
        % (len(resolved), total / 1000.0))
    sys.stderr.write("    heaviest: %s\n"
                     % ", ".join("%s %.1f kg" % (t[0], t[1] / 1000.0) for t in heavy))
    sys.stderr.write("    lightest: %s\n"
                     % ", ".join("%s %d g" % (t[0], t[1]) for t in light))
    zero = [t[0] for t in resolved if t[1] == 0]
    if zero:
        sys.stderr.write("    weightless (not physical objects): %d — %s\n"
                         % (len(zero), ", ".join(zero[:4]) + " ..."))

    # An enumerator no row uses is either dead weight or a sign the CSV drifted.
    for name, used, table in (("ItemCategory", used_cat, CATEGORY),
                              ("UseEffect", used_use, USE)):
        unused = sorted(set(table.values()) - used)
        if unused:
            sys.stderr.write("gen_item_table: NOTE %s values unused by any row: %s\n"
                             % (name, ", ".join(unused)))

    # The money row is load-bearing for the barter economy ([item_table.h]
    # kItemRuble): refuse a catalog without it rather than emitting a table the
    # cash-roll paths cannot index.
    ids = [r["id"] for r in rows]
    # Named ids the code addresses directly. Each is load-bearing for a system
    # (money for barter, dice for the conversation game row) — refuse a catalog
    # without them rather than emitting a table those systems cannot index.
    named = {}
    for key in ("ruble", "dice_bone"):
        if key not in ids:
            die("no '%s' row — a named-id consumer depends on it" % key)
        named[key] = ids.index(key) + 1   # ids are 1-based row indices

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER)
        fh.write("const ItemId kItemRuble = %d;\n" % named["ruble"])
        fh.write("const ItemId kItemDiceBone = %d;\n\n" % named["dice_bone"])
        fh.write("const std::array<ItemDef, kItemCount> kItemTable = {{\n")
        fh.write("\n".join(out))
        fh.write("\n}};\n\n")
        fh.write("const std::array<const char*, kItemCount> kItemNames = {{\n")
        fh.write("\n".join(names))
        fh.write("\n}};\n\n")
        fh.write("const std::array<const char*, kItemCount> kItemDescs = {{\n")
        fh.write("\n".join(descs))
        fh.write("\n}};\n\n")
        fh.write("// CSV id strings, parallel to kItemTable — the console's `give`\n"
                 "// resolves items by these ([item_table.h] item_by_string).\n")
        fh.write("const std::array<const char*, kItemCount> kItemIdStrs = {{\n")
        for iid in ids:
            fh.write('    "%s",\n' % iid)
        fh.write("}};\n\n")
        fh.write(FOOTER)

    sys.stderr.write("gen_item_table: wrote %d rows to %s\n" % (len(rows), OUT_PATH))


HEADER = """// GENERATED by tools/gen_item_table.py from data/items.csv — do not hand-edit.
// Edit the CSV and re-run the generator; see [items.md].
//
// This file carries Cyrillic string literals (the item names), which is what makes
// /utf-8 load-bearing on MSVC rather than merely defensive.
#include "game/item_table.h"

#include <cmath>

#include "game/combat.h"   // DamageChannel, to pin the resist width

namespace giga::game {

static_assert(kItemResistChannels == kDamageChannels,
              "item resist width must match the damage channel count");

namespace {
constexpr std::uint8_t u8(ItemCategory v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint8_t u8(EquipSlot v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint8_t u8(UseEffect v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint16_t u16(RoomBit v) { return static_cast<std::uint16_t>(v); }
} // namespace

"""

FOOTER = """// --- Depth gating ---------------------------------------------------------

std::uint8_t economy_band(int floorZ) {
    const int a = floorZ < 0 ? -floorZ : floorZ;
    // Bands widen with depth: the hub and its neighbours are E0, and only the
    // extremes reach E4. Thresholds follow the reference's |z| brackets.
    if (a <= 3) return 0;
    if (a <= 10) return 1;
    if (a <= 22) return 2;
    if (a <= 38) return 3;
    return 4;
}

std::uint32_t item_weight_on_floor(ItemId id, int floorZ, std::uint16_t roomMask) {
    if (!item_valid(id)) return 0;
    const ItemDef& d = item_def(id);
    if (d.spawnWeight == 0) return 0;                    // never spawns randomly
    if (roomMask != 0 && (d.roomMask & roomMask) == 0) return 0;  // wrong room

    const std::int32_t cap = kLootValueCap[economy_band(floorZ)];
    if (d.value <= cap) return d.spawnWeight;

    // Over the band cap: exponential decay rather than a hard cut, so a shallow
    // floor CAN yield something absurd, just rarely. That rare payout is the greed
    // loop; a hard cut would replace "worth the risk" with "not on this floor".
    const float over = static_cast<float>(d.value) / static_cast<float>(cap);
    const float decay = std::exp(-(over - 1.0f) * 3.0f);
    const std::uint32_t w =
        static_cast<std::uint32_t>(static_cast<float>(d.spawnWeight) * decay);
    return w;   // may legitimately reach 0 for something wildly out of band
}

} // namespace giga::game
"""

if __name__ == "__main__":
    main()
