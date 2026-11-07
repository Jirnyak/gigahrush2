// Floor rule-set — a floor's *character* as data ([floors.md]).
//
// The vision: each floor is its own module/sub-game — somewhere dense and
// residential/safe, somewhere near-empty and dangerous. That character is NOT
// code branches; it is a small table of weights the seeder (and, later, the mob
// and loot systems) read. A FloorSpec never forks the global tables — it only
// says how much of each thing this floor gets: how many people, how they split
// across factions, how hostile it is, which ages live here.
//
// This is the population/spawn rule-set only. It is deliberately independent of
// which storage layer holds the floor and of the floor's in-game number — those
// are separate identities per [floors.md] (LayerId != ModuleId != floor number).
#pragma once

#include <cstddef>
#include <cstdint>

#include "game/faction.h"
#include "game/prop_table.h" // PropId — полосы настенных устройств этажа

namespace giga::game {

// Coarse archetypes a floor can take. The enum is just an index into the
// catalog; the *data* is what matters (a Residential floor is "dense + safe +
// all ages", not a special code path).
enum class FloorKind : std::uint8_t {
    Residential, // dense, safe, families — many civilians, all ages
    Commercial,  // mixed crowd, moderate density and danger
    Industrial,  // sparse, working-age adults
    Derelict,    // near-empty and dangerous (high monster weight)
    Padic,       // 4D spectrum fractal geometry
    Blame,       // megastructure void — vertical technodemo geometry
    Khrushi,     // open microdistrict — street plan + ten-storey blocks
    Count,
};

// ПОЛОСА НАСТЕННЫХ УСТРОЙСТВ — политика расстановки как ДАННЫЕ СТРОКИ ЭТАЖА
// (решение владельца 2026-11-07: «политика расстановки в общем коде — дефект,
// ставит МОДУЛЬ»; глобальная сеялка с литералами wsel<7/<11 была ровно таким
// дефектом). Вес per2000 — доля кандидатных клеток у стены из 2000 (та же
// арифметика spatial_hash % 2000, что жила литералом): щиток 7/2000 ≈ 0.35%.
// per2000 == 0 — пустой слот полосы. Механика скана стен остаётся агностичным
// примитивом ([game/prop_system.h] seed_wall_interactables) и читает ЭТУ
// таблицу, не ветвится по этажам.
struct WallDeviceBand {
    PropId prop;            // что ставить — строка props.csv
    std::uint16_t per2000;  // сколько из 2000 кандидатов достаётся этой полосе
};
inline constexpr std::size_t kMaxWallDeviceBands = 4;

// A floor's rule-set. POD aggregate: field order matches the catalog rows in
// floor_spec.cpp. Weights are relative/multiplier semantics, never absolutes
// that shadow a global table.
struct FloorSpec {
    FloorKind kind;
    const char* name;            // static label for HUD/debug
    std::uint32_t population;     // how many alife records to seed here
    // Relative weights of the five factions (any scale). FIVE, not four: an
    // earlier four-slot version silently folded Wild onto Citizens.
    std::uint8_t factionMix[kFactionCount];
    float hostility;             // 0..1 monster spawn-weight multiplier (used once mobs land)
    std::uint8_t minAge;         // demographic window: youngest resident...
    std::uint8_t maxAge;         // ...and oldest
    // Настенные устройства ЭТОГО этажа — порядок полос значим (первая полоса
    // забирает младшие остатки хеша; менять порядок = передвинуть устройства).
    WallDeviceBand wallDevices[kMaxWallDeviceBands];
};

// Read a floor's rule-set by archetype. Returns a reference into a static
// catalog (stable for the process lifetime).
const FloorSpec& floor_spec(FloorKind kind);

// Pick a rule-set for a SIGNED floor NUMBER (0 = hub; + up / − down). The KIND
// half of the V-shape ([floors.md] §danger, master_prompt §4): symmetric about
// the hub (a floor and its mirror share a character), the hub always safe, the
// deep extremes trending derelict. Deterministic — reproduces exactly across
// runs. Floor number is the mutable in-game label, not a storage slot; a stopgap
// until the per-module registry assigns specs explicitly. (danger / count / tier
// are the OTHER half — floor_danger / floor_mob_count / floor_mob_tier below.)
const FloorSpec& floor_spec_for(int floor);

// ---------------------------------------------------------------------------
// The V-shape spawn math (master_prompt §4, memory `floor-module-architecture`).
//
// Monster COUNT and TIER rise with DEPTH away from the hub and with a per-floor
// DANGER rating; ported VERBATIM from the reference population model
// (`population_profiles.ts` + `procedural_floors.ts`, extracted 2026-07-29). All
// pure functions of the signed floor number + the floor's character (its
// FloorSpec), so a whole stack gets a faithful danger gradient with NO
// hand-authored per-floor table — the universal, data-oriented path.
// ---------------------------------------------------------------------------

// The per-floor LIVE monster budget — this engine's analog of the reference's
// DEFAULT_ACTIVE_ACTOR_SOFT_LIMIT (4096, sized for the whole active region),
// rescaled for a SINGLE live floor's O(n) tick ([performance.md]). Data — retune.
inline constexpr int kMobSoftCap = 384;

// Depth scalar 0..1 for a signed floor number (0 = hub). The reference keys off
// route-z (roof +50 … hub 0 … void −50) at ~2 z per floor, so |floor|/25 ==
// |z|/50 (reference populationDepth01). Drives both share (count) and tier.
float floor_depth01(int floor);

// Danger rating 1..5, ported from the procedural routeDangerScore: a V about the
// hub, ASYMMETRIC — descending (−) is deadlier than ascending (+). Feeds count
// (as a multiplier) and tier (as an additive term + a floor).
int floor_danger(int floor);

// Target LIVE monster count for a floor of character `spec`: the confirmed
// V-shape — kMobSoftCap · share(depth) · dangerTerm · kindMult, where share is
// the reference's stretched-exponential monster share, dangerTerm = 1+0.06·
// (danger−1), and kindMult = 0.7+hostility folds the floor's own character (safe
// Residential sparse → deadly Derelict dense). Clamped to [0, kMobSoftCap].
int floor_mob_count(int floor, const FloorSpec& spec);

// Monster tier/level 1..12 for a floor: clamp(round(1 + 8·depth + 0.55·
// (danger−1)), 1, 12) then floored at `danger` (reference populationLevelForRouteZ
// + the design max(danger, baseLevel)). Scales a mob's base stats through the
// mob_scaled_* helpers ([monsters.md]).
int floor_mob_tier(int floor);

} // namespace giga::game
