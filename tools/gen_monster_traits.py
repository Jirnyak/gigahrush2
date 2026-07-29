#!/usr/bin/env python3
"""Generate src/game/monster_traits_table.cpp from data/monster_traits.csv.

Sibling of tools/gen_item_table.py and tools/gen_mob_table.py, deliberately the same
shape: per-kind monster traits are data ([monsters.md]), so authoring one is a CSV row
plus a regenerate, never an edit to engine code. Not wired into CMake — the generated
.cpp is committed, so the build needs no Python — and it hard-fails on an unknown token
rather than mapping it to a default, because silently defaulting is how a content table
rots.

    python tools/gen_monster_traits.py

Two things it does that the siblings do not, both because this table is SPARSE:

  * it reads data/mobs.csv to resolve `id` -> row index, instead of carrying its own
    copy of the 69 monster names. That is what makes "a row for a monster that does not
    exist" a hard error rather than a mockup that reads as content, and it means a
    renamed monster fails here instead of silently landing on the wrong row;
  * it emits a DENSE 69-entry table anyway. The engine reads it by kind index, and
    `AGENTS.md` is explicit that dense beats sparse — a 1,656 B array is cache-resident
    and an O(1) read, where a sorted-and-searched 22-row table would be neither. The
    unauthored 47 entries are the default row, marked `authored = 0`.
"""

import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, "data", "monster_traits.csv")
MOBS_PATH = os.path.join(REPO, "data", "mobs.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "monster_traits_table.cpp")

# Authored rows. Must equal kMonsterTraitRows in src/game/monster_traits.h, which is
# also what tools/check_source_rules.cmake rule 7 regexes for.
EXPECTED_ROWS = 22
# The dense table width. Must equal kMobKindCount, which mob_table.h static_asserts.
EXPECTED_KINDS = 69

TERRAIN = {"ANY": "Any", "WET": "Wet"}

# DamageChannel, in combat.h declaration order. The enumerator VALUE is what lands in
# the row (MonsterTraits::vulnChannel is a raw u8 so this header stays free of
# combat.h), so the order here is load-bearing and is asserted from C++ in
# tests/suite_monster.inl against DamageChannel itself.
CHANNEL = {
    "KINETIC": 0, "BUCKSHOT": 1, "ENERGY": 2, "FIRE": 3, "PSI": 4,
}
NO_CHANNEL = 0xFF

# BaitBit, from src/game/monster_traits.h. Copied from the reference's
# BAIT_TRAITS_BY_ECOLOGY_TAG trait strings (monster_bait.ts:70) with the `bait_`
# prefix dropped.
BAIT = {
    "food": "Food", "meat": "Meat", "fungal": "Fungal", "govnyak": "Govnyak",
    "document": "Document", "starch": "Starch", "sugar": "Sugar",
    "stale": "Stale", "wet": "Wet", "risky": "Risky",
}

RESIST_COLS = ["resist_kinetic", "resist_buckshot", "resist_energy",
               "resist_fire", "resist_psi"]

# Every x100 multiplier column, with the band each is allowed to land in. The bands are
# not decoration: a pace multiplier outside 0.10..3.00 is a typo in the CSV or a unit
# confusion, and both ship silently otherwise. The widest authored value in the whole
# reference is Трескотник's x3.25 sprint, which lives in mob_behaviour.h and not here.
MULT_COLS = [
    ("wet_move", "wetMoveX100", 10, 300),
    ("dry_move", "dryMoveX100", 10, 300),
    ("wet_dmg", "wetDmgX100", 10, 300),
    ("dry_dmg", "dryDmgX100", 10, 300),
    ("wet_incoming", "wetIncomingX100", 5, 300),
]


def die(msg):
    sys.stderr.write("gen_monster_traits: %s\n" % msg)
    sys.exit(1)


def num(row, col, i, lo, hi, scale=1):
    text = (row.get(col) or "").strip()
    v = 0 if not text else int(round(float(text) * scale))
    if not (lo <= v <= hi):
        die("row %d (%s): %s = %r -> %d out of [%d, %d]"
            % (i, row["id"], col, text, v, lo, hi))
    return v


def mult(row, col, i, lo, hi):
    """An x100 multiplier, with the one rounding case that silently deletes a mechanic.

    The column stores a multiplier x100, so the smallest expressible non-zero value is
    0.01. A non-empty cell that rounds to 0 would make the monster stand perfectly
    still or take zero damage — indistinguishable from an authored freeze by reading the
    generated table, and the sibling generator hit exactly this class of bug for real
    (see gen_mob_table.fixed_nonzero, where SCULPTURE's 0.05 spawn weight quantized to
    0 and took the row offline).

    An EMPTY cell means "no change" and yields 100, not 0. That is the difference
    between this and the sibling: there, an empty numeric cell legitimately means zero.
    """
    text = (row.get(col) or "").strip()
    if not text:
        return 100
    v = int(round(float(text) * 100))
    if v == 0:
        die("row %d (%s): %s = %r rounds to 0, which reads as a permanent freeze / "
            "total immunity. Leave the cell EMPTY to mean 'no change' (100), or write "
            "a value of at least 0.01." % (i, row["id"], col, text))
    if not (lo <= v <= hi):
        die("row %d (%s): %s = %r -> x%.2f out of [x%.2f, x%.2f]"
            % (i, row["id"], col, text, v / 100.0, lo / 100.0, hi / 100.0))
    return v


def bait_mask(row, i):
    text = (row.get("bait") or "").strip()
    if not text:
        return "0"
    bits, seen = [], set()
    for tok in text.split("|"):
        tok = tok.strip()
        if not tok:
            continue
        if tok not in BAIT:
            die("row %d (%s): unknown bait class %r — add it to BAIT here AND to "
                "BaitBit in monster_traits.h" % (i, row["id"], tok))
        if tok in seen:
            die("row %d (%s): bait class %r listed twice" % (i, row["id"], tok))
        seen.add(tok)
        bits.append("b(BaitBit::%s)" % BAIT[tok])
    return " | ".join(bits)


def vuln(row, i):
    tok = (row.get("vuln_channel") or "").strip().upper()
    pct = num(row, "vuln_floor_pct", i, 0, 255)
    if not tok:
        if pct != 0:
            die("row %d (%s): vuln_floor_pct = %d with no vuln_channel — a floor with "
                "no channel can never fire" % (i, row["id"], pct))
        return NO_CHANNEL, 0
    if tok not in CHANNEL:
        die("row %d (%s): unknown vuln_channel %r — one of %s"
            % (i, row["id"], tok, "/".join(sorted(CHANNEL))))
    if pct == 0:
        die("row %d (%s): vuln_channel %s with vuln_floor_pct 0 — a 0%% floor is a "
            "no-op that reads as authored counterplay" % (i, row["id"], tok))
    return CHANNEL[tok], pct


def load_kind_index():
    """id -> row index, straight from data/mobs.csv. The mob catalog is the authority."""
    with open(MOBS_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    if len(rows) != EXPECTED_KINDS:
        die("data/mobs.csv has %d rows, expected %d — if the catalog really changed, "
            "update EXPECTED_KINDS here, kMobKindCount in mob_table.h and re-check "
            "every idx in data/monster_traits.csv" % (len(rows), EXPECTED_KINDS))
    index, names = {}, []
    for i, r in enumerate(rows):
        if int(r["idx"]) != i:
            die("data/mobs.csv row %d has idx %s — it must stay in enum order"
                % (i, r["idx"]))
        index[r["id"].strip()] = i
        names.append(r["id"].strip())
    return index, names


def main():
    kind_index, kind_names = load_kind_index()

    with open(CSV_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    if len(rows) != EXPECTED_ROWS:
        die("expected %d rows, got %d — if the trait set really changed, update "
            "EXPECTED_ROWS here AND kMonsterTraitRows in monster_traits.h"
            % (EXPECTED_ROWS, len(rows)))

    authored = {}
    last_idx = -1
    for i, r in enumerate(rows):
        mob_id = (r.get("id") or "").strip()
        if mob_id not in kind_index:
            die("row %d: id %r is not a monster in data/mobs.csv. A trait row for a "
                "monster that does not exist is a mockup — it compiles, it reads as "
                "content, and no kind can ever resolve to it." % (i, mob_id))
        idx = kind_index[mob_id]
        declared = (r.get("idx") or "").strip()
        if declared == "" or int(declared) != idx:
            die("row %d (%s): idx column says %r but data/mobs.csv puts %s at %d — "
                "fix the CSV, do not fix the generator" % (i, mob_id, declared,
                                                           mob_id, idx))
        if idx in authored:
            die("row %d: duplicate id %r" % (i, mob_id))
        if idx <= last_idx:
            die("row %d (%s): idx %d is not greater than the previous row's %d — the "
                "CSV must stay in ascending kind order so a diff is readable"
                % (i, mob_id, idx, last_idx))
        last_idx = idx

        terrain_tok = (r.get("terrain") or "ANY").strip().upper()
        if terrain_tok not in TERRAIN:
            die("row %d (%s): unknown terrain %r — one of %s"
                % (i, mob_id, terrain_tok, "/".join(sorted(TERRAIN))))

        resists = [num(r, c, i, -100, 95) for c in RESIST_COLS]
        mults = {name: mult(r, col, i, lo, hi) for col, name, lo, hi in MULT_COLS}
        vch, vpct = vuln(r, i)
        # HP/s * 1000. 65.535 HP/s is the ceiling and the one authored value is 1.35.
        regen = num(r, "wet_regen_hps", i, 0, 65535, scale=1000)

        # A row that authors NOTHING is worse than no row: it costs a CSV line, it
        # counts against kMonsterTraitRows, and every reader returns the default for
        # it — so it reads as content and behaves as absence.
        interesting = (any(resists) or terrain_tok != "ANY" or vch != NO_CHANNEL or
                       regen != 0 or bait_mask(r, i) != "0" or
                       any(v != 100 for v in mults.values()))
        if not interesting:
            die("row %d (%s): every column is the default, so this row changes "
                "nothing. Delete it (and decrement EXPECTED_ROWS plus "
                "kMonsterTraitRows) or author a trait." % (i, mob_id))

        authored[idx] = {
            "id": mob_id,
            "resists": resists,
            "terrain": TERRAIN[terrain_tok],
            "vch": vch,
            "vpct": vpct,
            "regen": regen,
            "bait": bait_mask(r, i),
            "ref": (r.get("ref") or "").strip(),
            **mults,
        }

    out = []
    for k in range(EXPECTED_KINDS):
        a = authored.get(k)
        if a is None:
            out.append(
                "    // [%d] %s  (default row)\n"
                "    MonsterTraits{ {0, 0, 0, 0, 0}, t(TerrainPref::Any),\n"
                "                   kNoVulnChannel, 0, 100, 100, 100, 100, 100, 0, 0,\n"
                "                   u8(MobKind::%s), 0 },"
                % (k, kind_names[k], CPP_KIND[k]))
            continue
        out.append(
            "    // [%d] %s  %s\n"
            "    MonsterTraits{ {%s}, t(TerrainPref::%s),\n"
            "                   %s, %d, %d, %d, %d, %d, %d, %d,\n"
            "                   static_cast<std::uint16_t>(%s),\n"
            "                   u8(MobKind::%s), 1 },"
            % (k, a["id"], a["ref"],
               ", ".join(str(x) for x in a["resists"]),
               a["terrain"],
               "kNoVulnChannel" if a["vch"] == NO_CHANNEL else str(a["vch"]),
               a["vpct"],
               a["wetMoveX100"], a["dryMoveX100"], a["wetDmgX100"], a["dryDmgX100"],
               a["wetIncomingX100"], a["regen"],
               a["bait"],
               CPP_KIND[k]))

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER % (len(authored), EXPECTED_KINDS))
        fh.write("const std::array<MonsterTraits, kMobKindCount> kMonsterTraits = {{\n")
        fh.write("\n".join(out))
        fh.write("\n}};\n\n")
        fh.write(FOOTER)

    sys.stderr.write("gen_monster_traits: wrote %d authored rows (%d dense entries) "
                     "to %s\n" % (len(authored), EXPECTED_KINDS, OUT_PATH))


# MobKind enumerator names, in CSV order — the same list gen_mob_table.py carries, and
# for the same reason: kept explicit rather than derived from the CSV `id` column so a
# renamed id cannot silently reorder the enum. The generator cross-checks its LENGTH
# against data/mobs.csv, so the two cannot drift in count without failing here.
CPP_KIND = [
    "Sborka", "Tvar", "Polzun", "Betonnik", "Zombie", "Eye", "Nightmare",
    "Shadow", "Rebar", "Matka", "Idol", "Mancobus", "Herald", "Creator",
    "Spirit", "Robot", "Shovnik", "Lampovy", "Pechateed", "TubeEel",
    "Paragraph", "Nelyud", "Krysnozhka", "Kostorez", "Safeguard",
    "BlackLiquidator", "KhorovayaMatka", "Slimevik", "Sobrannyy",
    "ZhornayaTvar", "Bezekhiy", "Pseudolift", "Slepoglaz", "Olgoy",
    "VodyanoyKoshmar", "Lampoglaz", "Tumannik", "Chernosliz", "Rzhavnik",
    "Betonoed", "Panelnik", "Paupsina", "Borshchevik", "Obzhivalshchik",
    "HeadSlug", "Protokolnik", "DikiyMertvyak", "Kontorshchik", "TonkayaTen",
    "KantselyarskiyIdol", "LozhnyyDukh", "ChervieAvatar", "PomoynyRoy",
    "Sculpture", "TrubnyyAvtomat", "Lotochnik", "Treskotnik",
    "ZakalennayaArmatura", "GlubinnayaTen", "GreenDog", "SlimeWoman",
    "Gnilushka", "MukhozhukHost", "FogShark", "BloodPlant", "Swarm",
    "SporeCarpet", "Lishennyy", "Gnome",
]

if len(CPP_KIND) != EXPECTED_KINDS:
    die("CPP_KIND has %d names, EXPECTED_KINDS is %d"
        % (len(CPP_KIND), EXPECTED_KINDS))


HEADER = """// GENERATED by tools/gen_monster_traits.py from data/monster_traits.csv — do not
// hand-edit. Edit the CSV and re-run the generator; see [monsters.md] and the long
// note in game/monster_traits.h.
//
// %d authored rows expanded to a DENSE %d-entry table, one per MobKind in kMobTable
// order. The unauthored entries are the default row (every multiplier 100, no resist,
// no vulnerability, no bait) and carry `authored = 0` so a reader can tell "this kind
// has no trait" from "this kind's trait happens to be neutral".
#include "game/monster_traits.h"

namespace giga::game {
namespace {
constexpr std::uint8_t u8(MobKind v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint8_t t(TerrainPref v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint16_t b(BaitBit v) { return static_cast<std::uint16_t>(v); }
} // namespace

"""

FOOTER = """// Every row's `kind` must equal its index, or `monster_traits(k)` silently returns
// another monster's traits and nothing fails — the exact hazard kMobTable's own `kind`
// column exists to catch.
//
// NOT a static_assert, and the reason is worth stating so nobody "fixes" it back:
// `kMonsterTraits` is a runtime `const std::array` with external linkage, matching
// `kMobTable` and `kItemTable`, so a constexpr function may not read it (MSVC C2131 —
// measured, not guessed). Making the array `constexpr` to win the compile-time check
// would push 1,656 B of table into every translation unit that includes the header, to
// verify something the suite verifies in 69 comparisons at startup. So it is a runtime
// predicate that tests/suite_monster.inl asserts, which makes it a ctest failure rather
// than a compile failure — mechanical either way.
bool monster_traits_rows_indexed() {
    for (std::size_t i = 0; i < kMobKindCount; ++i)
        if (kMonsterTraits[i].kind != static_cast<std::uint8_t>(i)) return false;
    return true;
}

} // namespace giga::game
"""

if __name__ == "__main__":
    main()
