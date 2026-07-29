// Global monster catalog — every mob kind as one flat DATA table ([monsters.md]).
//
// The same data-oriented stance as the item catalog ([item_table.h]) and
// FloorSpec ([floors.md]): a mob's stats, behaviour and spawn weight are POD rows
// in a static table, never code branches. The join key is the numeric MobKind
// (array index IS the kind), exactly as an ItemId indexes the item table.
//
// Mobs are NOT alife records — they never live in NpcPool ([npcs.md]). They are
// spawned per-floor from this table into ephemeral ECS entities and vanish when
// the floor de-embodies (#13d). So a MobDef is a *template*: base stats that the
// per-level scaling below multiplies at spawn time.
//
// Ported from the reference (`../gigahrush`): stats from `src/entities/*.ts`
// (MonsterDef), spawn/rarity from `src/data/monster_ecology.ts` (MonsterEcologyDef).
// A faithful representative span of the 69 kinds today — every behaviour archetype
// (trash-swarm / fast-fragile / ranged / control / pack / positional-bruiser /
// immobile-turret / tanky-elite / boss / oddball) — grown toward the full set by
// pure data edits.
#pragma once

#include <cstdint>

namespace giga::game {

// ---------------------------------------------------------------------------
// Projectile behaviour for ranged kinds (reference ProjType). Melee kinds set
// `ranged = false` and ignore this (ProjNormal is the harmless default).
// ---------------------------------------------------------------------------
enum ProjType : std::uint8_t {
    ProjNormal = 0, // straight shot
    ProjGrenade,    // lobbed, arcs
    ProjFlame,      // short-range flame
    ProjBfg,        // heavy energy orb
    ProjBeam,       // instant beam
    ProjWeb,        // bounded slow/root (Paupsina)
};

// ---------------------------------------------------------------------------
// Behaviour tags — a bitmask compressing the reference's 52-flag `aiFlags` union
// into the structural families the mob AI will branch on. A kind ORs the tags it
// carries; extend by adding a bit. (This is a faithful compression, not the full
// 52-flag set — per-flag fidelity grows as the mob-AI systems that consume each
// flag land.)
// ---------------------------------------------------------------------------
enum MobAiFlag : std::uint32_t {
    AiNone         = 0,
    AiMelee        = 1u << 0,  // plain chase-and-bite
    AiFlying       = 1u << 1,  // airborne, ignores ground collision
    AiPhasing      = 1u << 2,  // moves through walls
    AiRanged       = 1u << 3,  // attacks from range (see ranged/projType)
    AiPack         = 1u << 4,  // coordinates / surges in groups
    AiSwarm        = 1u << 5,  // large low-hp group spawn
    AiRooted       = 1u << 6,  // immobile (speed 0) turret / plant
    AiAmbush       = 1u << 7,  // strikes from concealment / thresholds
    AiWallBias     = 1u << 8,  // stronger adjacent to walls
    AiFoodBait     = 1u << 9,  // drawn to food / bait / govnyak
    AiWaterStrider = 1u << 10, // empowered on wet / water cells
    AiArmored      = 1u << 11, // damage-reduction mechanic
    AiHost         = 1u << 12, // parasite / body-stealer
    AiSpawner      = 1u << 13, // spawns more monsters (matka / hive)
    AiGrowth       = 1u << 14, // grows stronger from combat / kills
    AiLightLock    = 1u << 15, // targets along lit lines
    AiWeepingAngel = 1u << 16, // only moves when unobserved
    AiBoss         = 1u << 17, // boss telegraph / phases
};

// ---------------------------------------------------------------------------
// One catalog row — a spawn template. POD aggregate; field order matches the
// catalog rows in mob_table.cpp (same convention as ItemDef / FloorSpec). Stats
// are BASE values (level 1); the scaling helpers below apply the per-level curve.
// ---------------------------------------------------------------------------
struct MobDef {
    const char* name;       // reference kind key (transliterated), e.g. "gnome"
    std::int16_t hp;        // base hit points (pre-level-scale)
    std::int16_t dmg;       // base attack damage
    float speed;            // move speed, cells/sec (0 = immobile)
    float attackRate;       // seconds between attacks (cooldown, not a rate)
    bool ranged;            // shoots projectiles instead of melee
    float projSpeed;        // projectile speed, cells/sec (0 if melee)
    ProjType projType;      // projectile behaviour (ignored if !ranged)
    std::uint32_t aiFlags;  // MobAiFlag bitmask — the behaviour driver
    std::uint16_t spawnW;   // base spawn weight (0 = never from the weighted pool)
    std::uint8_t minSamosbor; // wave gate: min samosbor count to be eligible
    bool rare;              // rare/elite/boss gating (director/event spawn)
};

// Numeric kind ids. Array index IS the kind (no reserved 0 sentinel — kind 0 is a
// real mob, the weakest). Keep in lock-step with the catalog rows in mob_table.cpp
// (a static_assert there guards against drift).
enum MobKind : std::uint16_t {
    // trash / swarm
    MobSborka = 0, MobSwarm, MobKrysnozhka,
    // fast / fragile melee
    MobDikiyMertvyak, MobGnome, MobZombie,
    // pack
    MobFogShark, MobGreenDog,
    // flying
    MobEye, MobSpirit,
    // ranged / control
    MobPaupsina, MobParagraph, MobLampoglaz, MobSlepoglaz, MobRobot,
    // positional / host
    MobTvar, MobHeadSlug,
    // immobile turret / plant
    MobBorshchevik, MobBloodPlant, MobKantselyarskiyIdol, MobIdol,
    // positional bruiser
    MobPanelnik, MobRebar,
    // tanky elite
    MobPolzun, MobSafeguard, MobZakalennayaArmatura, MobSobrannyy,
    // oddball
    MobSculpture,
    // bosses / spawners
    MobHerald, MobMancobus, MobMatka, MobCreator, MobBetonnik,
    kMobKindCount,
};

// Read a mob's template by kind. Bounds-tolerant: any kind >= kMobKindCount
// returns a static inert "none" row (hp 1, immobile, no behaviour) rather than
// indexing past the catalog — the same defensive lookup as item_def / attitude.
const MobDef& mob_def(std::uint16_t kind);

// Resolve a reference kind key ("gnome") to its MobKind, or kMobKindCount if
// unknown. Linear scan — a cold path (loot/spawn authoring), never the hot tick.
std::uint16_t mob_kind(const char* name);

// True if a def carries a behaviour tag.
inline bool mob_has_flag(const MobDef& def, MobAiFlag flag) {
    return (def.aiFlags & static_cast<std::uint32_t>(flag)) != 0;
}

// ---------------------------------------------------------------------------
// Per-level stat scaling (reference `rpg.ts` scaleMonster*, verbatim):
//   hp    *= 1 + 0.12*(level-1)   (+12% / level)
//   dmg   *= 1 + 0.10*(level-1)   (+10% / level)
//   speed *= 1 + 0.02*(level-1)   (+2%  / level)
// level is 1-based (level 1 = base). These take the BASE stat from a MobDef and
// return the spawn-time value; #13d picks the level from floor depth + danger
// (the confirmed V-shape tier formula, master_prompt §4). Rounding matches the
// reference Math.round; done without <cmath> (stats are non-negative).
// ---------------------------------------------------------------------------
inline int mob_level_clamp(int level) { return level < 1 ? 1 : level; }

inline std::int16_t mob_scaled_hp(std::int16_t baseHp, int level) {
    const float v = static_cast<float>(baseHp) *
                    (1.0f + 0.12f * static_cast<float>(mob_level_clamp(level) - 1));
    return static_cast<std::int16_t>(v + 0.5f);
}
inline std::int16_t mob_scaled_dmg(std::int16_t baseDmg, int level) {
    const float v = static_cast<float>(baseDmg) *
                    (1.0f + 0.10f * static_cast<float>(mob_level_clamp(level) - 1));
    return static_cast<std::int16_t>(v + 0.5f);
}
inline float mob_scaled_speed(float baseSpeed, int level) {
    return baseSpeed * (1.0f + 0.02f * static_cast<float>(mob_level_clamp(level) - 1));
}

} // namespace giga::game
