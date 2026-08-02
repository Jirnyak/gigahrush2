#!/usr/bin/env python3
"""Generate src/game/mob_table.cpp from data/mobs.csv.

The mob catalog is data ([monsters.md]): adding a monster is one CSV row plus a
regenerate, never an edit to engine code. This script is the regenerate.

    python tools/gen_mob_table.py

It is deliberately NOT wired into CMake. The generated .cpp is committed, so the
build needs no Python; the script exists so the table stays reproducible from its
source data and so a bad row fails loudly here instead of silently shipping.

Fractional reference values are converted to fixed point (millis / tenths) so the
emitted table is integral and bit-identical across builds and platforms.
"""

import csv
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(REPO, "data", "mobs.csv")
OUT_PATH = os.path.join(REPO, "src", "game", "mob_table.cpp")

EXPECTED_ROWS = 68

# CSV token -> C++ enumerator. Any token missing from these maps is a hard error:
# silently mapping an unknown behaviour to Plain is exactly how content rots.
TIER = {
    "TRASH": "Trash", "LIGHT": "Light", "MEDIUM": "Medium",
    "HEAVY": "Heavy", "ELITE": "Elite", "BOSS": "Boss",
}
PACK = {"loner": "Loner", "crowd": "Crowd", "territorial": "Territorial",
        "roamer": "Roamer"}
PROJ = {"": "Bullet", "WEB": "Web"}
ROOM = {
    "CORRIDOR": "Corridor", "COMMON": "Common", "STORAGE": "Storage",
    "KITCHEN": "Kitchen", "BATHROOM": "Bathroom", "LIVING": "Living",
    "OFFICE": "Office", "MEDICAL": "Medical", "PRODUCTION": "Production",
    "SMOKING": "Smoking", "HQ": "Hq",
}
FLOOR = {"-50": "ZMinus50", "-36": "ZMinus36", "-26": "ZMinus26",
         "0": "Z0", "14": "ZPlus14", "30": "ZPlus30"}
SHARED = {"foodBait": "FoodBait", "wallBias": "WallBias",
          "flying": "Flying", "waterStrider": "WaterStrider"}

# MobBehaviour enumerators, in declaration order — must match mob_table.h exactly.
# Checked both ways at the end of main(): an unmapped CSV value is an error, and
# so is an enumerator the data never uses.
BEHAVIOURS = [
    "Plain",
    "WeakWallBreach", "DebrisLurker", "LampPowered", "LightLock",
    "DocumentHunter", "DocumentScent", "DrainArmor", "WaterPressureLine",
    "RangedClause", "CloseReveal", "WallBrace", "FogOffset", "ScentOvercommit",
    "GarbageSurround", "SourceSwarm", "SlimeScavenger", "SlimeStrider",
    "WeepingAngel", "MeatGrowth", "BlackWaterWake", "RootedPlant",
    "RoomBoundAberration", "LastSoundBeam", "MeatWorm", "ScrapWake", "BaitLine",
    "SecondBeat", "OfficeField", "HostParasite", "ProtocolPressure",
    "CrowdShove", "NetPossessor", "DeadEcho", "FalsePatrol", "DefensiveNeutral",
    "WebSpitter", "FalsePhase", "WetLineShot", "GreenDogPack", "FogSwimmer",
    "ParasiteLeader", "RootHive", "FractureSprint", "LurkingFurniture",
    "LightFollower", "Melee",
]

# CSV behaviour token -> enumerator. Identity for all but the one merge: GREEN_DOG
# is the only kind carrying two singleton aiFlags (packHowl + noiseFear), and they
# are two halves of one dog design — share targets on sight, break off from loud
# metal — so they collapse to a single behaviour rather than needing two slots.
BEHAVIOUR = {name: name for name in BEHAVIOURS}
BEHAVIOUR[""] = "Plain"
BEHAVIOUR["PackHowl+NoiseFear"] = "GreenDogPack"


def die(msg):
    sys.stderr.write("gen_mob_table: %s\n" % msg)
    sys.exit(1)


def fixed(value, scale, field, row_idx, lo=0, hi=65535):
    """Round a fractional CSV value to fixed point, range-checked."""
    text = (value or "").strip()
    n = 0 if not text else int(round(float(text) * scale))
    if not (lo <= n <= hi):
        die("row %d: %s = %r -> %d out of range [%d, %d]"
            % (row_idx, field, value, n, lo, hi))
    return n


def fixed_nonzero(value, scale, field, row_idx, lo=0, hi=65535):
    """`fixed`, but a non-zero authored value may never quantize to zero.

    This exists because the quantization silently DELETED a monster. `spawn_weight`
    is stored in tenths (MobDef::spawnWeightX10), so the smallest weight the table
    can express is 0.1. SCULPTURE was authored at 0.05 — deliberately the rarest row
    in the catalog, below BETONOED's 0.12 — and 0.05 * 10 = 0.5, which Python 3
    rounds half-to-EVEN, i.e. to 0. mob_spawn.cpp:162 skips any row with
    `spawnWeightX10 == 0`, so the row cost a table slot, a name, a behaviour
    enumerator and 36 bytes, and no floor could ever roll it. Its WeepingAngel
    behaviour is the only one `frozen_by_gaze` (mob_behaviour.cpp:69) answers for and
    is dispatched live in wander.cpp:256, so the quantization also took an
    implemented, unit-tested mechanic offline.

    Zero stays legal: `spawn_weight == 0` is an authored opt-out of random spawning
    (CREATOR, PSEUDOLIFT), and the generator must not second-guess it. What is
    rejected is the ONE case that cannot be distinguished from that opt-out by
    reading the table: the author asked for "very rare" and got "never".
    """
    n = fixed(value, scale, field, row_idx, lo, hi)
    if n == 0 and (value or "").strip() not in ("", "0"):
        die("row %d: %s = %r quantizes to 0 at scale %d, which mob_spawn.cpp reads "
            "as 'never spawns' — indistinguishable from an authored 0. The smallest "
            "expressible non-zero value is %s; either use it or set the cell to 0 "
            "to mean never."
            % (row_idx, field, value, scale, repr(1.0 / scale)))
    return n


def mask(value, table, cpp_enum, field, row_idx):
    """OR together a '|'-separated token list into a C++ bitmask expression."""
    text = (value or "").strip()
    if not text:
        return "0"
    bits = []
    for tok in text.split("|"):
        tok = tok.strip()
        if not tok:
            continue
        if tok not in table:
            die("row %d: %s has unknown token %r" % (row_idx, field, tok))
        bits.append("u16(%s::%s)" % (cpp_enum, table[tok])
                    if cpp_enum == "RoomBit" else
                    "u8(%s::%s)" % (cpp_enum, table[tok]))
    return " | ".join(bits) if bits else "0"


def cpp_string(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    with open(CSV_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    if len(rows) != EXPECTED_ROWS:
        die("expected %d rows, got %d — if the catalog really changed, update "
            "EXPECTED_ROWS here AND MobKind/kMobKindCount in mob_table.h"
            % (EXPECTED_ROWS, len(rows)))

    out, names, tokens, used_behaviours = [], [], [], set()
    for i, r in enumerate(rows):
        if int(r["idx"]) != i:
            die("row %d has idx %s — the CSV must stay in enum order" % (i, r["idx"]))

        flags = []
        for tok in (r["shared_flags"] or "").split("|"):
            tok = tok.strip()
            if tok:
                if tok not in SHARED:
                    die("row %d: unknown shared flag %r" % (i, tok))
                flags.append("f(AiFlag::%s)" % SHARED[tok])
        if r["is_ranged"] == "1":
            flags.append("f(AiFlag::Ranged)")
        if r["is_boss"] == "1":
            flags.append("f(AiFlag::Boss)")
        if r["rare"] == "1":
            flags.append("f(AiFlag::Rare)")
        # Immobile is derived, not authored: speed 0 means turret/plant/carpet.
        if float(r["speed_cps"] or 0) == 0.0:
            flags.append("f(AiFlag::Immobile)")

        beh = (r["behaviour"] or "").strip()
        if beh not in BEHAVIOUR:
            die("row %d (%s): unknown behaviour %r — add it to BEHAVIOURS here "
                "and to MobBehaviour in mob_table.h" % (i, r["id"], beh))
        used_behaviours.add(BEHAVIOUR[beh])

        tier = (r["tier_derived"] or "").strip()
        if tier not in TIER:
            die("row %d: unknown tier %r" % (i, tier))
        pack = (r["pack_mode"] or "loner").strip()
        if pack not in PACK:
            die("row %d: unknown pack_mode %r" % (i, pack))
        proj = (r["proj_type"] or "").strip()
        if proj not in PROJ:
            die("row %d: unknown proj_type %r" % (i, proj))

        out.append("""    // [{idx}] {rid}
    MobDef{{ {flags},
             {hp}, {dmg}, {spd}, {cd}, {reach},
             {pspd}, {sw}, static_cast<std::uint16_t>({rooms}),
             {shot}, {minr}, {wind},
             u8(MobKind::{kind}), u8(MobTier::{tier}),
             u8(MobBehaviour::{beh}), u8(ProjType::{proj}),
             {samo}, static_cast<std::uint8_t>({floors}),
             u8(MobPackMode::{pack}), {pmin}, {pmax}, {pspread} }},"""
            .format(
                idx=i, rid=r["id"],
                flags=" | ".join(flags) if flags else "0u",
                hp=fixed(r["hp"], 1, "hp", i, 1),
                dmg=fixed(r["dmg"], 1, "dmg", i),
                spd=fixed(r["speed_cps"], 1000, "speed_cps", i),
                cd=fixed(r["attack_cd_s"], 1000, "attack_cd_s", i),
                reach=fixed(r["melee_reach_cells"], 1000, "melee_reach_cells", i),
                pspd=fixed(r["proj_speed_cps"], 1000, "proj_speed_cps", i),
                sw=fixed_nonzero(r["spawn_weight"], 10, "spawn_weight", i),
                rooms=mask(r["rooms"], ROOM, "RoomBit", "rooms", i),
                shot=fixed(r["shot_range_cells"], 1000, "shot_range_cells", i),
                minr=fixed(r["min_range_cells"], 1000, "min_range_cells", i),
                wind=fixed(r["windup_s"], 1000, "windup_s", i),
                kind=cpp_kind(r["id"], i),
                tier=TIER[tier], beh=BEHAVIOUR[beh], proj=PROJ[proj],
                samo=fixed(r["min_samosbor"], 1, "min_samosbor", i, 0, 99),
                floors=mask(r["floors_z"], FLOOR, "FloorBit", "floors_z", i),
                pack=PACK[pack],
                pmin=fixed(r["pack_min"], 1, "pack_min", i, 0, 8),
                pmax=fixed(r["pack_max"], 1, "pack_max", i, 0, 16),
                pspread=fixed(r["pack_spread"], 1, "pack_spread", i, 0, 10)))
        names.append("    %s," % cpp_string(r["name_ru"]))
        # Latin console token: the CSV id lowercased. ASCII by construction (the
        # id column doubles as the enumerator map key), so a console can match it
        # without any Cyrillic input; parallel to kMobTable like kMobNames.
        tokens.append("    %s," % cpp_string(r["id"].lower()))

    # An enumerator no row uses is dead weight in a jump table — and far more
    # often a sign the CSV column drifted from the enum than a real gap.
    unused = [b for b in BEHAVIOURS if b not in used_behaviours]
    if unused:
        die("MobBehaviour values used by no row: %s — remove them from the enum "
            "or fix the CSV" % ", ".join(unused))

    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(HEADER)
        fh.write("const std::array<MobDef, kMobKindCount> kMobTable = {{\n")
        fh.write("\n".join(out))
        fh.write("\n}};\n\n")
        fh.write("const std::array<const char*, kMobKindCount> kMobNames = {{\n")
        fh.write("\n".join(names))
        fh.write("\n}};\n\n")
        fh.write("const std::array<const char*, kMobKindCount> kMobTokens = {{\n")
        fh.write("\n".join(tokens))
        fh.write("\n}};\n\n")
        fh.write(FOOTER)

    sys.stderr.write("gen_mob_table: wrote %d rows to %s\n" % (len(rows), OUT_PATH))


# MobKind enumerator names, in CSV order. Kept explicit rather than derived from
# the CSV `id` column so a renamed id cannot silently reorder the enum.
KINDS = [
    "Sborka", "Tvar", "Polzun", "Betonnik", "Zombie", "Eye", "Nightmare",
    "Shadow", "Rebar", "Matka", "Idol", "Mancobus", "Herald", "Creator",
    "Spirit", "Robot", "Shovnik", "Lampovy", "Pechateed",
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


def cpp_kind(csv_id, idx):
    if idx >= len(KINDS):
        die("row %d (%s): no MobKind name — extend KINDS and MobKind" % (idx, csv_id))
    return KINDS[idx]


HEADER = """// GENERATED by tools/gen_mob_table.py from data/mobs.csv — do not hand-edit.
// Edit the CSV and re-run the generator; see [monsters.md].
#include "game/mob_table.h"

#include <cmath>

namespace giga::game {
namespace {
constexpr std::uint8_t u8(MobKind v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint8_t u8(MobTier v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint8_t u8(MobBehaviour v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint8_t u8(ProjType v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint8_t u8(MobPackMode v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint8_t u8(FloorBit v) { return static_cast<std::uint8_t>(v); }
constexpr std::uint16_t u16(RoomBit v) { return static_cast<std::uint16_t>(v); }
constexpr std::uint32_t f(AiFlag v) { return static_cast<std::uint32_t>(v); }
} // namespace

"""

FOOTER = """// --- Per-floor budgets: the V-shape --------------------------------------
// These are the reference's shipped formulas (population_profiles.ts:285-306,
// design_floor_population.ts:2067-2071), not a reinvention.

namespace {
constexpr float kThemeMult[static_cast<std::size_t>(FloorTheme::Count)] = {
    0.80f,  // Living      — the hub, deliberately emptiest
    0.86f,  // Kvartiry
    1.00f,  // Ministry
    1.12f,  // Maintenance
    1.28f,  // Hell
    1.36f,  // Void
};
} // namespace

float mob_depth01(int floorZ) {
    int a = floorZ < 0 ? -floorZ : floorZ;
    if (a >= kFloorZSpan) return 1.0f;
    return static_cast<float>(a) / static_cast<float>(kFloorZSpan);
}

int mob_count_for_floor(int floorZ, std::uint8_t danger, FloorTheme theme) {
    const float d = mob_depth01(floorZ);
    // Head-count is driven by |floor| alone; theme and danger only trim it.
    const float base = 100.0f + (static_cast<float>(kMobBudgetCap) - 100.0f) *
                                    (1.0f - std::exp(-3.1f * std::pow(d, 2.35f)));
    float share = (base < 100.0f ? 100.0f : base) /
                  static_cast<float>(kMobBudgetCap);
    if (share > 0.96f) share = 0.96f;

    const std::uint8_t dg = danger < 1 ? 1 : (danger > 5 ? 5 : danger);
    const float dangerMult = 0.92f + static_cast<float>(dg) * 0.045f;
    const std::size_t ti = static_cast<std::size_t>(theme) <
                                   static_cast<std::size_t>(FloorTheme::Count)
                               ? static_cast<std::size_t>(theme)
                               : static_cast<std::size_t>(FloorTheme::Ministry);

    const float n = static_cast<float>(kMobBudgetCap) * share *
                    kThemeMult[ti] * dangerMult;
    const int r = static_cast<int>(n + 0.5f);
    return r < 0 ? 0 : (r > kMobBudgetCap ? kMobBudgetCap : r);
}

std::uint8_t mob_level_for_floor(int floorZ, std::uint8_t danger) {
    const std::uint8_t dg = danger < 1 ? 1 : (danger > 5 ? 5 : danger);
    const float lv = 1.0f + mob_depth01(floorZ) * 8.0f +
                     (static_cast<float>(dg) - 1.0f) * 0.55f;
    int base = static_cast<int>(lv + 0.5f);
    if (base < 1) base = 1;
    if (base > 12) base = 12;
    // A high-danger shallow floor is never weaker than its authored danger.
    return static_cast<std::uint8_t>(base < dg ? dg : base);
}

std::uint16_t mob_hp_at_level(std::uint16_t baseHp, std::uint8_t level) {
    const std::uint8_t lv = level < 1 ? 1 : (level > 12 ? 12 : level);
    const float hp = static_cast<float>(baseHp) *
                     (1.0f + 0.12f * (static_cast<float>(lv) - 1.0f));
    const int r = static_cast<int>(hp + 0.5f);
    return static_cast<std::uint16_t>(r < 1 ? 1 : (r > 65535 ? 65535 : r));
}

} // namespace giga::game
"""

if __name__ == "__main__":
    main()
