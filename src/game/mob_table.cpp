// Monster catalog data + lookups ([mob_table.h]).
//
// The rows below are the DATA — one MobDef per MobKind, in enum order so array
// index == kind. Stats (hp/speed/dmg/attackRate/ranged/projSpeed) are ported
// verbatim from the reference bestiary (`../gigahrush`, src/entities/*.ts); spawn
// weight / rarity / samosbor gate from src/data/monster_ecology.ts. aiFlags are
// the reference `aiFlags` compressed into the MobAiFlag families. A faithful
// representative span of the 69 kinds; extending toward the full set is data-only.
#include "game/mob_table.h"

#include <cstring>

namespace giga::game {

namespace {

// Field order: name, hp, dmg, speed, attackRate, ranged, projSpeed, projType,
// aiFlags, spawnW, minSamosbor, rare. Row index MUST equal the MobKind enum
// value (static_assert below guards it).
const MobDef kMobTable[] = {
    // --- trash / swarm -------------------------------------------------------
    {"sborka", 8, 3, 3.15f, 0.65f, false, 0.0f, ProjNormal, AiFoodBait, 8, 0, false},
    {"swarm", 12, 2, 2.75f, 0.24f, false, 0.0f, ProjNormal, AiFoodBait | AiSwarm, 6, 0, false},
    {"krysnozhka", 14, 3, 2.45f, 0.65f, false, 0.0f, ProjNormal, AiFoodBait | AiMelee, 7, 0, false},

    // --- fast / fragile melee ------------------------------------------------
    {"dikiy_mertvyak", 22, 7, 2.55f, 1.05f, false, 0.0f, ProjNormal, AiMelee | AiPack, 5, 0, false},
    {"gnome", 25, 8, 2.8f, 0.8f, false, 0.0f, ProjNormal, AiMelee, 5, 0, false},
    {"zombie", 35, 8, 1.4f, 1.5f, false, 0.0f, ProjNormal, AiMelee, 5, 0, false},

    // --- pack ----------------------------------------------------------------
    {"fog_shark", 18, 12, 2.85f, 0.78f, false, 0.0f, ProjNormal, AiPack, 4, 0, false},
    {"green_dog", 34, 9, 2.55f, 0.82f, false, 0.0f, ProjNormal, AiPack | AiFoodBait, 4, 0, false},

    // --- flying --------------------------------------------------------------
    {"eye", 20, 14, 2.2f, 2.5f, true, 8.0f, ProjNormal, AiFlying | AiRanged, 4, 0, false},
    {"spirit", 40, 15, 2.0f, 1.5f, false, 0.0f, ProjNormal, AiFlying | AiPhasing, 3, 0, false},

    // --- ranged / control ----------------------------------------------------
    {"paupsina", 32, 0, 2.25f, 2.65f, true, 9.5f, ProjWeb, AiRanged, 3, 0, false},
    {"paragraph", 46, 15, 1.05f, 2.35f, true, 6.5f, ProjNormal, AiRanged, 3, 0, false},
    {"lampoglaz", 44, 10, 0.28f, 1.9f, true, 13.0f, ProjBeam, AiRanged | AiLightLock, 3, 0, false},
    {"slepoglaz", 52, 24, 0.62f, 3.4f, false, 0.0f, ProjNormal, AiAmbush, 2, 0, false},
    {"robot", 65, 18, 1.8f, 1.8f, true, 9.0f, ProjBfg, AiRanged, 2, 0, false},

    // --- positional / host ---------------------------------------------------
    {"tvar", 54, 13, 1.65f, 1.15f, false, 0.0f, ProjNormal, AiFoodBait | AiWallBias, 4, 0, false},
    {"head_slug", 58, 6, 1.48f, 1.15f, false, 0.0f, ProjNormal, AiHost, 3, 0, false},

    // --- immobile turret / plant (speed 0 -> AiRooted) -----------------------
    {"borshchevik", 62, 12, 0.0f, 1.45f, false, 0.0f, ProjNormal, AiRooted, 3, 0, false},
    {"blood_plant", 96, 19, 0.0f, 2.85f, false, 0.0f, ProjNormal, AiRooted | AiSpawner, 2, 0, false},
    {"kantselyarskiy_idol", 72, 18, 0.0f, 2.9f, true, 7.2f, ProjNormal, AiRooted | AiRanged, 2, 1, false},
    {"idol", 100, 30, 0.0f, 2.0f, true, 12.0f, ProjBfg, AiRooted | AiRanged, 2, 1, false},

    // --- positional bruiser --------------------------------------------------
    {"panelnik", 96, 16, 1.08f, 1.45f, false, 0.0f, ProjNormal, AiWallBias | AiArmored, 3, 0, false},
    {"rebar", 210, 24, 0.82f, 2.4f, false, 0.0f, ProjNormal, AiWallBias | AiAmbush, 2, 1, false},

    // --- tanky elite ---------------------------------------------------------
    {"polzun", 168, 22, 0.85f, 2.25f, false, 0.0f, ProjNormal, AiFoodBait, 2, 1, false},
    {"safeguard", 185, 24, 2.15f, 2.4f, false, 0.0f, ProjNormal, AiMelee, 2, 1, false},
    {"zakalennaya_armatura", 265, 31, 0.62f, 2.9f, false, 0.0f, ProjNormal, AiArmored, 1, 2, true},
    {"sobrannyy", 260, 24, 1.18f, 3.1f, false, 0.0f, ProjNormal, AiGrowth, 1, 1, false},

    // --- oddball (weeping-angel one-shot) ------------------------------------
    {"sculpture", 250, 1000, 8.5f, 0.25f, false, 0.0f, ProjNormal, AiWeepingAngel, 1, 0, true},

    // --- bosses / spawners (rare; director/event spawn, spawnW 0) ------------
    {"herald", 250, 30, 1.4f, 2.0f, true, 7.0f, ProjNormal, AiBoss | AiRanged, 0, 2, true},
    {"mancobus", 400, 40, 0.7f, 3.0f, true, 6.0f, ProjGrenade, AiBoss | AiRanged, 0, 2, true},
    {"matka", 350, 12, 0.4f, 3.5f, false, 0.0f, ProjNormal, AiSpawner, 1, 2, true},
    {"creator", 520, 44, 1.05f, 2.35f, true, 7.5f, ProjBfg, AiBoss | AiRanged, 0, 2, true},
    {"betonnik", 1000, 35, 0.8f, 3.0f, false, 0.0f, ProjNormal, AiMelee | AiArmored, 0, 2, true},
};

static_assert(sizeof(kMobTable) / sizeof(kMobTable[0]) == kMobKindCount,
              "mob_table rows must stay in lock-step with the MobKind enum");

// Inert fallback for out-of-range kinds — 1 hp, immobile, no behaviour.
const MobDef kMobNone = {"none", 1, 0, 0.0f, 1.0f, false, 0.0f, ProjNormal, AiNone, 0, 0, false};

} // namespace

const MobDef& mob_def(std::uint16_t kind) {
    if (kind >= kMobKindCount) return kMobNone;
    return kMobTable[kind];
}

std::uint16_t mob_kind(const char* name) {
    if (name == nullptr) return kMobKindCount;
    for (std::uint16_t i = 0; i < kMobKindCount; ++i) {
        if (std::strcmp(kMobTable[i].name, name) == 0) return i;
    }
    return kMobKindCount;
}

} // namespace giga::game
