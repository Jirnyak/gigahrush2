#!/usr/bin/env python3
"""Generate src/game/quest_table.cpp from data/quests.csv.

Sibling of tools/gen_item_table.py and deliberately the same shape: the quest
catalog is CONTENT, so adding a quest is one CSV row plus a regenerate, never an
edit to engine code. Not wired into CMake -- the generated .cpp is committed, so
the build needs no Python -- and it hard-fails on an unknown token rather than
mapping it to a default, because silently defaulting is how a content table rots.

    python tools/gen_quest_table.py

WHY THIS GENERATOR VALIDATES SO MUCH MORE THAN ITS SIBLINGS
-----------------------------------------------------------
gen_item_table.py checks ranges. This one checks REACHABILITY, and that is the
entire argument for authoring quests in a table instead of rolling them from a
hash. `contract_offer` (src/game/contract.cpp) cannot author anything: it is
guaranteed-completable BY CONSTRUCTION, because it only ever names an item
`item_weight_on_floor` can produce at this depth and a monster kind the spawn
roster can actually roll. An authored row has no such construction, so the
guarantee has to be re-earned somewhere -- and the only place it can be earned
cheaply is at generate time, where every table is on disk and a bad row is a
build failure instead of a quest the player can never finish.

The reference (../gigahrush) ships the counter-example this file is aimed at: a
VISIT quest that can never complete, which is why contract.cpp names it in a
comment. Nothing in its pipeline could have caught it.

Three tables are cross-read for that reason: data/quests.csv (the content),
data/items.csv (does the Fetch target exist and can it spawn) and data/mobs.csv
(does the Hunt target exist, can it be rolled, and does it live where the quest
is offered). Two engine rules are MIRRORED here in Python, and both mirrors are a
drift hazard worth naming out loud:

  * `economy_band` + `kLootValueCap`, from src/game/item_table.h /
    tools/gen_item_table.py's FOOTER. Depth gates VALUE, so a Fetch target worth
    more than the shallowest band in the quest's offer range decays toward a zero
    spawn weight and the errand becomes unfinishable at the shallow end.
  * `anchor_for_floor`, from src/game/mob_spawn.cpp. A monster's habitat is a
    bitmask over SIX signed anchors, not over floor numbers, so "does this kind
    live where this quest is offered" is a question about the nearest anchor.

If either engine rule is retuned and this file is not, the symptom is a quest that
passes the gate and cannot be completed. There is no way to import a C++ constexpr
into Python, so the mitigation is that tests/suite_quest.inl re-checks the SAME
properties against the real engine functions -- the mirror is the fast feedback,
the test is the authority.

CSV CONVENTIONS
---------------
`subject` is an ID STRING, never a row index. Row indices are what the save format
already has to defend against ([save.h]: insert one item into items.csv and every
saved id above it names a different object); putting a raw index in hand-authored
content would add a third place that silently reinterprets on a content edit.

`limit_s` is a deadline in SIM SECONDS, and 0 means the quest has no deadline. See
src/game/quest.h for which clock that is and why. The legal band is the
reference's own: quest_deadlines.ts authors MIN_URGENT_MINUTES = 60 through
MAX_QUEST_MINUTES = 5*24*60 = 7200 in-fiction minutes, and its main.ts advances
`clock.totalMinutes += dt` with dt in real seconds -- its own comment says "1 real
second = 1 game minute" -- so that band is 60..7200 REAL seconds and ports across
unscaled.

`prereq` must name a row EARLIER in the file. That is what makes a chain readable
top-down and makes a cycle inexpressible rather than merely rejected.
"""

import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, "data", "quests.csv")
ITEMS_PATH = os.path.join(REPO, "data", "items.csv")
MOBS_PATH = os.path.join(REPO, "data", "mobs.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "quest_table.cpp")

EXPECTED_ROWS = 19

# ObjectiveKind, reused from src/game/contract.h rather than redeclared. Quests do
# not invent a fourth objective: each of these three is already measured by a system
# that exists, which is the same reason contract.h gives for having exactly these.
KIND = {"FETCH": "Fetch", "HUNT": "Hunt", "DESCEND": "Descend"}

# MIRROR of src/game/item_table.h kLootValueCap / kEconomyBands.
LOOT_VALUE_CAP = [90, 450, 4000, 80000, 250000]

# MIRROR of src/game/mob_spawn.cpp anchor_for_floor: the six signed habitat anchors
# in the order that function iterates them, because ties break on iteration order
# (its loop takes a strictly smaller distance, so the FIRST anchor at a tied
# distance wins). Floor 22 is exactly 8 from both +14 and +30 and resolves to +14.
FLOOR_ANCHORS = [-50, -36, -26, 0, 14, 30]

# MIRROR of src/game/mob_table.h kFloorZSpan: the |z| at which every depth curve
# saturates, and the deepest |z| main.cpp's demo stack reaches. A Descend objective
# past it could never be satisfied by any floor in the building.
FLOOR_Z_SPAN = 50

# MIRROR of src/game/floor_registry.h kMinFloor / kMaxFloor. Also the exact range of
# the int8 the generated row stores a floor bound in.
MIN_FLOOR, MAX_FLOOR = -127, 127

# The reference's own deadline band, in sim seconds. See the module docstring.
MIN_LIMIT_S, MAX_LIMIT_S = 60, 7200


def die(msg):
    sys.stderr.write("gen_quest_table: %s\n" % msg)
    sys.exit(1)


def economy_band(floor_z):
    """MIRROR of economy_band in tools/gen_item_table.py's FOOTER (which is the body
    compiled into src/game/item_table.cpp). Keyed on |z|, like every depth budget."""
    a = -floor_z if floor_z < 0 else floor_z
    if a <= 3:
        return 0
    if a <= 10:
        return 1
    if a <= 22:
        return 2
    if a <= 38:
        return 3
    return 4


def anchor_for_floor(floor_z):
    """MIRROR of anchor_for_floor in src/game/mob_spawn.cpp. Returns the anchor's
    floor number, which is also its token in data/mobs.csv's `floors_z` column."""
    best, best_d = FLOOR_ANCHORS[0], None
    for a in FLOOR_ANCHORS:
        d = floor_z - a
        if d < 0:
            d = -d
        if best_d is None or d < best_d:
            best_d, best = d, a
    return best


def num(row, col, i, lo, hi):
    text = (row.get(col) or "").strip()
    v = 0 if not text else int(round(float(text)))
    if not (lo <= v <= hi):
        die("row %d (%s): %s = %r -> %d out of [%d, %d]"
            % (i, row["id"], col, text, v, lo, hi))
    return v


def cpp_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def load_items():
    """items.csv as {id: (ItemId, row)}. ItemId is **1-based**: `ItemSlot::item == 0`
    already means "empty slot", so id N is table row N-1 ([item_table.h])."""
    with open(ITEMS_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    return {r["id"]: (i + 1, r) for i, r in enumerate(rows)}


def load_mobs():
    """mobs.csv as {id: (MobKind, row)}. MobKind is a **0-based** row index and
    `MobDef::kind` re-states it for a load-time assert ([mob_table.h])."""
    with open(MOBS_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    for i, r in enumerate(rows):
        if int(r["idx"]) != i:
            die("data/mobs.csv row %d declares idx %s -- the id -> MobKind mapping "
                "this generator resolves against is the ROW ORDER, so a disagreeing "
                "idx column means one of the two is wrong" % (i, r["idx"]))
    return {r["id"]: (i, r) for i, r in enumerate(rows)}


def band_floors(lo, hi):
    return list(range(lo, hi + 1))


def check_fetch(r, i, items, lo, hi):
    """A Fetch target must be an item that can actually be FOUND across the whole
    offer band. Two failure modes, both silent without this gate."""
    tok = (r.get("subject") or "").strip()
    if tok not in items:
        die("row %d (%s): FETCH subject %r is not an id in data/items.csv"
            % (i, r["id"], tok))
    item_id, ir = items[tok]

    # spawn_w_milli == 0 means "never spawns randomly" -- item_weight_on_floor
    # returns 0 outright, which removes the row from every weighted loot path. A
    # Fetch quest naming one is unfinishable unless the player already happens to
    # hold it. (Measured: ammo_9mm and ammo_shells are both in this state today.)
    if int(round(float((ir.get("spawn_w_milli") or "0").strip() or 0))) == 0:
        die("row %d (%s): FETCH target %r has spawn_w_milli = 0, i.e. it never "
            "spawns randomly, so the errand cannot be completed by playing. Pick a "
            "target with a non-zero weight." % (i, r["id"], tok))

    # Depth gates VALUE, not availability: item_weight_on_floor decays the weight
    # exponentially once an item's value passes the band cap. Check the SHALLOWEST
    # floor in the offer band, because that is where the cap is tightest.
    shallowest = min(band_floors(lo, hi), key=lambda z: abs(z))
    cap = LOOT_VALUE_CAP[economy_band(shallowest)]
    value = int(round(float((ir.get("value_rub") or "0").strip() or 0)))
    if value > cap:
        die("row %d (%s): FETCH target %r is worth %d rub but floor %d in the offer "
            "band [%d, %d] is economy band E%d, whose loot cap is %d. Past the cap "
            "item_weight_on_floor decays the spawn weight exponentially, so the "
            "target gets rare exactly where the quest is offered. Narrow floor_lo / "
            "floor_hi to deeper floors, or pick a cheaper target."
            % (i, r["id"], tok, value, shallowest, lo, hi,
               economy_band(shallowest), cap))
    return item_id


def check_hunt(r, i, mobs, lo, hi):
    """A Hunt target must be a monster that can be rolled AND that lives where the
    quest is offered. The first two tests are the pair contract.cpp:115 applies; the
    third is the one an authored row can afford and a procedural roll cannot."""
    tok = (r.get("subject") or "").strip()
    if tok not in mobs:
        die("row %d (%s): HUNT subject %r is not an id in data/mobs.csv"
            % (i, r["id"], tok))
    kind, mr = mobs[tok]

    if int(round(float((mr.get("dmg") or "0").strip() or 0))) == 0:
        die("row %d (%s): HUNT target %r deals 0 damage -- do not send anyone to "
            "hunt scenery (contract.cpp:89 refuses the same thing)."
            % (i, r["id"], tok))

    # Same quantization the sibling generator's fixed_nonzero documents: spawn_weight
    # is stored in TENTHS, and mob_spawn.cpp never rolls a row whose tenths are 0.
    if int(round(float((mr.get("spawn_weight") or "0").strip() or 0) * 10)) == 0:
        die("row %d (%s): HUNT target %r has spawn_weight quantizing to 0 tenths, "
            "which mob_spawn.cpp reads as 'never rolled' -- the kind cannot appear "
            "by any path. (CREATOR and PSEUDOLIFT are both in this state.)"
            % (i, r["id"], tok))

    habitat = [t.strip() for t in (mr.get("floors_z") or "").split("|") if t.strip()]
    if not habitat:
        die("row %d (%s): HUNT target %r has an empty floors_z, which the mob table "
            "generator emits as floorMask 0, and a mask naming no anchor matches no "
            "floor." % (i, r["id"], tok))
    habitat = set(int(t) for t in habitat)

    # EVERY floor in the offer band, not just the ends: a habitat is a set of
    # anchors and a band can straddle a boundary. This is STRICTLY stronger than
    # contract.cpp, which deliberately tests habitat globally -- see the long note
    # at contract.cpp:104-114 for the variety that per-floor gating costs a
    # procedural roll. An authored row pays that cost once, at generate time, and
    # gets an offer that is never absurd where it is made.
    for z in band_floors(lo, hi):
        a = anchor_for_floor(z)
        if a not in habitat:
            die("row %d (%s): HUNT target %r is offered on floor %d, whose habitat "
                "anchor is %+d, but its floors_z is {%s}. anchor_for_floor snaps a "
                "floor to the NEAREST of %s, so this kind never spawns near where "
                "the quest is handed out."
                % (i, r["id"], tok, z, a,
                   ", ".join("%+d" % h for h in sorted(habitat)),
                   ", ".join("%+d" % h for h in FLOOR_ANCHORS)))
    return kind


def check_descend(r, i, lo, hi):
    """A Descend objective is measured against `RunLedger::deepestFloor` in |z|, so
    `target` is a DEPTH and not a signed floor label. See quest.h for why the sign is
    deliberately not compared."""
    if (r.get("subject") or "").strip():
        die("row %d (%s): DESCEND takes no subject -- the objective is a depth, and a "
            "stray subject would be silently ignored" % (i, r["id"]))
    depth = num(r, "target", i, 1, FLOOR_Z_SPAN)
    reach = max(abs(lo), abs(hi))
    if depth <= reach:
        die("row %d (%s): DESCEND target depth %d is not past floor %+d in its own "
            "offer band [%d, %d]. quest_accept refuses a descent already behind the "
            "run (the same guard contract_accept applies), so a quest offered at or "
            "below its own target is one the player can never take."
            % (i, r["id"], depth, reach if hi >= 0 else -reach, lo, hi))
    return depth


def main():
    with open(CSV_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    if len(rows) != EXPECTED_ROWS:
        die("expected %d rows, got %d -- if the catalog really changed, update "
            "EXPECTED_ROWS here AND kQuestCount in src/game/quest.h. Note that quests "
            "is NOT yet one of the CSV/header pairs registered in Rule 7 of "
            "tools/check_source_rules.cmake, so nothing but this line and the "
            "std::array size will hold you to it -- and neither fires if you edit the "
            "CSV and never run this generator" % (EXPECTED_ROWS, len(rows)))
    if len(rows) > 255:
        die("kQuestCount must stay <= 255: QuestDef::prereq is a QuestId in a "
            "std::uint8_t, and 0 is reserved for kInvalidQuest")

    items = load_items()
    mobs = load_mobs()

    # id -> 1-based QuestId, built before the row loop so `prereq` can be resolved.
    # The forward-reference BAN is enforced separately, below.
    ids = {}
    for i, r in enumerate(rows):
        if r["id"] in ids:
            die("duplicate id %r at row %d" % (r["id"], i))
        ids[r["id"]] = i + 1

    out, names, briefs = [], [], []
    used_kind = set()
    with_deadline = 0
    for i, r in enumerate(rows):
        if not (r.get("name_ru") or "").strip():
            die("row %d (%s) has no name_ru" % (i, r["id"]))
        if not (r.get("brief_ru") or "").strip():
            die("row %d (%s) has no brief_ru -- an authored quest with no sentence "
                "in it is a procedural contract with extra steps" % (i, r["id"]))

        tok = (r.get("kind") or "").strip()
        if tok not in KIND:
            die("row %d (%s): unknown kind %r -- add it to KIND here AND to "
                "ObjectiveKind in src/game/contract.h, and give it a measurement "
                "in quest_step" % (i, r["id"], tok))
        kind = KIND[tok]
        used_kind.add(kind)

        lo = num(r, "floor_lo", i, MIN_FLOOR, MAX_FLOOR)
        hi = num(r, "floor_hi", i, MIN_FLOOR, MAX_FLOOR)
        if lo > hi:
            die("row %d (%s): floor_lo %d > floor_hi %d" % (i, r["id"], lo, hi))

        target = num(r, "target", i, 1, 2000000000)
        subject = 0
        if kind == "Fetch":
            subject = check_fetch(r, i, items, lo, hi)
        elif kind == "Hunt":
            subject = check_hunt(r, i, mobs, lo, hi)
        else:
            target = check_descend(r, i, lo, hi)

        limit_s = num(r, "limit_s", i, 0, MAX_LIMIT_S)
        if limit_s != 0 and limit_s < MIN_LIMIT_S:
            die("row %d (%s): limit_s = %d is below the reference's own urgent floor "
                "of %d s (quest_deadlines.ts MIN_URGENT_MINUTES, which is real "
                "seconds there). Use 0 to mean 'no deadline'."
                % (i, r["id"], limit_s, MIN_LIMIT_S))
        if limit_s != 0:
            with_deadline += 1

        reward = num(r, "reward_rub", i, 1, 2000000000)

        reward_item, reward_count = 0, 0
        rtok = (r.get("reward_item") or "").strip()
        rcount = num(r, "reward_count", i, 0, 255)
        if rtok:
            if rtok not in items:
                die("row %d (%s): reward_item %r is not an id in data/items.csv"
                    % (i, r["id"], rtok))
            reward_item, ir = items[rtok]
            stack_max = int(round(float((ir.get("stack_max") or "1").strip() or 1)))
            if not (1 <= rcount <= stack_max):
                die("row %d (%s): reward_count %d for %r is outside [1, stack_max=%d]"
                    " -- quest_reward_item hands out ONE stack, so a count past the "
                    "stack ceiling would silently be truncated"
                    % (i, r["id"], rcount, rtok, stack_max))
            reward_count = rcount
        elif rcount != 0:
            die("row %d (%s): reward_count %d with no reward_item"
                % (i, r["id"], rcount))

        prereq = 0
        ptok = (r.get("prereq") or "").strip()
        if ptok:
            if ptok not in ids:
                die("row %d (%s): prereq %r is not a quest id in this file"
                    % (i, r["id"], ptok))
            prereq = ids[ptok]
            if prereq >= i + 1:
                die("row %d (%s): prereq %r is row %d, at or after this one. A "
                    "prerequisite must name an EARLIER row -- that is what makes a "
                    "cycle inexpressible instead of merely rejected, and what makes "
                    "a chain readable top-down." % (i, r["id"], ptok, prereq))

        out.append(
            "    // [%d] QuestId %d  %s\n"
            "    QuestDef{ %du, %d, %d, %d, %d,\n"
            "              %d, u8(ObjectiveKind::%s), %d, %d, %d, {0, 0, 0} },"
            % (i, i + 1, r["id"],
               limit_s * 1000, target, reward, subject, reward_item,
               reward_count, kind, prereq, lo, hi))
        names.append("    %s," % cpp_string(r["name_ru"].strip()))
        briefs.append("    %s," % cpp_string(r["brief_ru"].strip()))

    unused = sorted(set(KIND.values()) - used_kind)
    if unused:
        sys.stderr.write("gen_quest_table: NOTE ObjectiveKind values unused by any "
                         "row: %s\n" % ", ".join(unused))

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER)
        fh.write("const std::array<QuestDef, kQuestCount> kQuestTable = {{\n")
        fh.write("\n".join(out))
        fh.write("\n}};\n\n")
        fh.write("const std::array<const char*, kQuestCount> kQuestNames = {{\n")
        fh.write("\n".join(names))
        fh.write("\n}};\n\n")
        fh.write("const std::array<const char*, kQuestCount> kQuestBriefs = {{\n")
        fh.write("\n".join(briefs))
        fh.write("\n}};\n\n")
        fh.write(FOOTER)

    sys.stderr.write("gen_quest_table: wrote %d rows (%d with a deadline) to %s\n"
                     % (len(rows), with_deadline, OUT_PATH))


HEADER = """// GENERATED by tools/gen_quest_table.py from data/quests.csv -- do not hand-edit.
// Edit the CSV and re-run the generator.
//
// This file carries Cyrillic string literals (quest names and briefs), which is what
// makes /utf-8 load-bearing on MSVC rather than merely defensive -- the same reason
// item_table.cpp and mob_table.cpp need it ([AGENTS.md] section Build).
//
// Every row here was checked at generate time against data/items.csv and
// data/mobs.csv: a Fetch target can spawn at the shallowest floor it is offered on,
// a Hunt target can be rolled and lives at every habitat anchor in its offer band,
// and a Descend target is past the band it is offered in. See the generator's
// docstring for why that validation is the whole reason quests are a table.
#include "game/quest.h"

namespace giga::game {

namespace {
constexpr std::uint8_t u8(ObjectiveKind v) { return static_cast<std::uint8_t>(v); }
} // namespace

"""

FOOTER = """} // namespace giga::game
"""

if __name__ == "__main__":
    main()
