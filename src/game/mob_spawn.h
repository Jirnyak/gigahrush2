// Monster spawning — turns the global mob table into live ECS entities on a
// floor ([monsters.md]).
//
// Mobs are deliberately NOT alife records ([npcs.md]): they have no macro
// existence, no relationships, no cold pool. They are spawned when a floor is
// entered and destroyed when it is left. That is why this file talks to the
// Registry and the World directly and never touches NpcPool.
//
// The whole per-floor mix comes from data: the head-count and level from the
// V-shape budgets in mob_table.h, the roster from each row's spawn weight and
// floor mask, the GROUPING from each row's packMode/packMin/packMax/packSpread.
// A floor supplies only its danger rating, theme and geometry kind — never a
// hand-written spawn list, and never a redefined stat row.
//
// Placement is per-PACK, not per-monster: a room is drawn from the generator's own
// wall lattice, one kind is rolled for it, and that kind's authored pack size is
// placed inside that room. Placing each head at an independent random cell (which
// is what this used to do) salt-sprinkles a floor — a rat swarm and a lone
// sentinel become indistinguishable in space, and every packMode column in
// mob_table.h reads as decoration.
#pragma once

#include <cstddef>
#include <cstdint>

#include "core/math.h"          // vec3
#include "core/tick.h"          // kSimHz — the fog cadence is stated in ticks
#include "ecs/registry.h"
#include "game/floor_spec.h"
#include "game/mob_table.h"
#include "game/samosbor.h"      // SamosborState/Transition, ThreatCensus, the budget
#include "world/level_stack.h"  // LayerId
#include "world/types.h"

namespace giga {
class World;
}

namespace giga::game {

// A live monster instance. Small and POD: the table row holds everything
// static, so an instance only carries what differs per spawn.
struct MobRef {
    std::uint8_t kind;   // MobKind — index into kMobTable
    std::uint8_t level;  // 1..12, from mob_level_for_floor
    std::int16_t hp;     // current, level-scaled
    std::int16_t maxHp;  // level-scaled base
    std::uint8_t pack = 0;   // spawn group, 1..255; 0 = never grouped
};

// `pack` is LAST on purpose. Several call sites write `MobRef{kind, level, hp,
// maxHp}` and rely on the remainder zero-initialising; a field inserted before `hp`
// would shift them silently — `pack` would take hp's value and maxHp would become
// 0, which is a monster that is already dead. Pinned so it cannot happen quietly.
// The `= 0` default member initializer makes that reliance EXPLICIT: it keeps the
// four-field aggregate init well-formed and silences Clang's -Wmissing-field-
// initializers (MSVC never warned, so the build-win-verified merge left it firing
// on macOS) without changing a single byte — pack was already value-initialized.
static_assert(offsetof(MobRef, hp) == 2,
              "MobRef{kind,level,hp,maxHp} call sites would shift");

// Pack ids are one byte and a floor's budget reaches 4096 heads, so the id wraps
// every 255 packs. Two packs sharing an id is harmless: it only means they choose
// the same wander destination (of 64), which un-grouped agents already do by
// chance. It is NOT a correctness constraint anywhere — nothing looks a pack up by
// id, so a collision cannot merge two packs' state.
inline constexpr std::uint32_t kPackIdSpan = 255;

// A floor's theme drives the head-count multiplier. Derived from its archetype
// rather than authored twice.
FloorTheme theme_for_kind(FloorKind kind);

// FloorSpec stores hostility as 0..1; the budgets want danger 1..5.
std::uint8_t danger_for_hostility(float hostility);

// Spawn a floor's monster population into `reg` on `layer`, one PACK at a time.
//
// Deterministic in (floorNumber, seed, geometry): the same floor re-entered with
// the same seed produces the same roster in the same places, which is what lets a
// floor be unloaded and reloaded without the world visibly changing.
//
// `cap` bounds the spawn regardless of what the budget asks for (0 = no cap).
// The budget saturates at 4096 on the deepest floors, which is a lot of entities
// to add in one frame; callers that care about frame time should pass a cap.
//
// `kind` supplies the ROOM PITCH, via floor_room_stride. It cannot be recovered
// from `theme`: theme_for_kind collapses two of its inputs onto FloorTheme::Ministry
// (Commercial, plus the out-of-range default), so inverting it would be right today
// and silently wrong the first time a fifth FloorKind is themed. It is last with a
// default only so the existing call sites keep compiling; the default's stride is 8,
// which is correct for Residential and Derelict and WRONG for Commercial (16) and
// Industrial (32) — pass the real kind.
//
// Returns the number of heads actually spawned, which is lower than the budget only
// when rooms have too few standable cells.
std::uint32_t spawn_floor_mobs(Registry& reg, const World& world,
                               int floorNumber, std::uint8_t danger,
                               FloorTheme theme, LayerId layer,
                               std::uint32_t seed, std::uint32_t cap = 0,
                               FloorKind kind = FloorKind::Residential);

// Spawn ONE mob of `kind` at macro cell (cx, cy) on `layer` — the console's
// `spawn` command and any scripted encounter. Same emplace path as the floor
// spawner (full component set: physics, combat, staggered cooldown), so a
// console-spawned monster is indistinguishable from an authored one. `level` is
// clamped 1..12; `salt` staggers colour + initial cooldown between calls.
// Returns the entity (never null for a valid kind; entt::null otherwise).
Entity spawn_mob_at(Registry& reg, LayerId layer, MobKind kind,
                    std::uint8_t level, int cx, int cy, std::uint32_t salt);

// Destroy every mob on `layer`. Called when a floor is unloaded — mobs do not
// fold back into anything, they simply cease to exist ([monsters.md]).
std::uint32_t despawn_layer_mobs(Registry& reg, LayerId layer);

// How many mobs are currently live on a layer (HUD / tests).
std::uint32_t count_layer_mobs(const Registry& reg, LayerId layer);

// ---------------------------------------------------------------------------
// Fog spawn — the samosbor's spawn pressure, wired
// ---------------------------------------------------------------------------

// Marks a monster that arrived OUT OF THE FOG rather than with the floor.
//
// The tag is what makes the fog population bounded, and that is a correctness
// property rather than tidiness. Fog spawn is gated on local density around the
// player, not on a floor total, so the gates stop refusing the moment the player
// walks 40 m: at the 2 s cadence and up to 4 heads an attempt, a 15-minute samosbor
// at |z| = 50 can add on the order of 1800 heads to a floor whose authored budget is
// 194. Nothing would ever remove them, and the shared 4096-actor pool
// (`kMobBudgetCap`) is two samosbors away. `samosbor_fog_tick` therefore destroys
// every tagged mob on `activeEnded` — fog mobs leave with the fog.
//
// An empty type on purpose: EnTT stores no per-entity payload for one, so the tag
// costs a bitset and `reg.view<const FogSpawn>()` is the whole query.
struct FogSpawn {};

// Sim ticks between fog spawn attempts. 2 s at kSimHz (125), so 250.
//
// **A design gate first, a perf gate second.** The threat budget allows up to
// `kThreatBackoffNear` (4) new heads per attempt, so at one attempt per tick a fog
// samosbor fills its 7-head near-player quota in two ticks — 16 ms — which reads as
// monsters materialising in front of you. At 2 s the same budget takes ~4 s to fill
// and reads as pressure arriving. The perf saving is real but small and is stated
// honestly on `samosbor_census` in [samosbor.h]: an estimated ~20 us sweep at the
// demo's 600-head cap, so per-tick census would have cost ~0.25% of a core.
//
// Derived from kSimHz rather than written as 250, because a 250 that does not move
// when the tick rate does is the exact drift core/tick.h exists to kill.
inline constexpr std::uint64_t kFogSpawnPeriodTicks =
    2u * static_cast<std::uint64_t>(kSimHz);
// The INVARIANT, not the value: 2 s of sim time, whatever the tick rate becomes. A
// `== 250` here would be the same hardcoded-tick-rate mistake one line lower down.
static_assert(kFogSpawnPeriodTicks * static_cast<std::uint64_t>(kSimStepMs) == 2000u,
              "the fog cadence must be exactly 2 s of sim time");

// Danger rating at which a floor counts as "high risk" and the threat band lifts
// from `kThreatPressureMax` (7) to `kThreatSpikeMax` (10) — the "rare spike 8..10"
// of `balance.md:510`.
//
// 4, and that is one FloorKind: `danger_for_hostility` maps the catalog's four
// hostility values (0.05 / 0.20 / 0.35 / 0.90) onto danger 1 / 2 / 2 / 5, so only
// Derelict clears the bar. Deliberate — the spike should be a floor character, not a
// depth effect, because depth already moves the target through `mob_depth01`.
inline constexpr std::uint8_t kFogHighRiskDanger = 4;

// The kinds a fog samosbor may draw from on one floor, plus the weighted-draw
// prefix sums, resolved once per fog tick.
//
// Pointer-free and passed by value: ~360 B built by a 69-row scan of a
// permanently-cache-resident 2,484 B table, at 0.5 Hz. Not worth caching, and
// caching it would need somewhere to hang the cache that survives a floor ride.
struct FogRoster {
    std::uint8_t kind[kMobKindCount] = {};        // MobKind ids, in table order
    std::uint32_t cumWeight[kMobKindCount] = {};  // running spawnWeightX10, parallel to kind
    std::uint32_t n = 0;                          // rows used
    std::uint32_t total = 0;                      // cumWeight[n-1]; 0 when n == 0
    std::uint16_t effCount = 0;                   // the count the gate was evaluated at
    bool relaxed = false;                         // effCount != the count asked for
};

// Build the fog roster for a floor at a samosbor count.
//
// Three filters, in order: habitat (`floorMask` against `anchor_for_floor`), rollable
// (`spawnWeightX10 > 0`, which excludes CREATOR and PSEUDOLIFT by design and
// SCULPTURE by a rounding accident — see the SCULPTURE note in [samosbor.h]), and the
// samosbor unlock (`samosbor_allows_kind`).
//
// **The unlock filter can empty the roster, and does, on five of six anchors at count
// 0** — the measured table is in [samosbor.h] on SamosborState. So when the gated
// roster comes out empty this relaxes `effCount` to the *habitat roster's own minimum*
// `minSamosbor` and rebuilds, sets `relaxed`, and reports the count it actually used.
// That keeps `minSamosbor` a real monotone unlock (a higher count never admits fewer
// kinds) while making an empty fog roster impossible, and it does it from the data
// rather than from a hardcoded default — the reference's "default to 1" does not
// clear ZMinus50 at all.
//
// The 99 sentinel ("never") survives relaxation on every real floor: it is only ever
// the minimum if a floor's whole habitat roster is sentinels, and the one row that
// carries it (CREATOR) has spawn weight 0 and is filtered out one step earlier.
FogRoster samosbor_fog_roster(int floorNumber, std::uint16_t samosborCount);

// What one fog tick did. Every field is an observation, so a HUD or a test can see
// why nothing spawned without re-deriving the decision.
struct FogTickReport {
    ThreatCensus census{};        // the sweep around the anchor; withLos is still 0
    std::uint32_t spawned = 0;    // heads added
    std::uint32_t despawned = 0;  // tagged heads removed (activeEnded / warningBegan)
    std::uint32_t wandering = 0;  // agents wander_init gave a destination to
    std::uint8_t target = 0;      // samosbor_threat_target for this floor + variant
    std::uint8_t headroom = 0;    // samosbor_threat_headroom at entry
    std::uint8_t wanted = 0;      // min(target - withinOuter, headroom)
    std::uint8_t rosterN = 0;     // kinds the unlock left available
    std::uint16_t effCount = 0;   // FogRoster::effCount
    bool relaxed = false;         // FogRoster::relaxed
    bool censused = false;        // the O(n) sweep ran (i.e. this tick was on cadence)
};

// **THE ENTRY POINT. One call per sim tick, and it owns the whole decision.**
//
// Call it once, unconditionally, from the same braced block as `samosbor_step` — it
// needs that step's transition and it must run before `wander_step` and
// `physics_step` so a fresh head is steered and settled in the tick it appears
// ([samosbor.h] states the ordering and why). Everything is gated internally:
//
//   1. `tr.activeEnded` -> despawn every FogSpawn on the layer. Fog mobs leave with
//      the fog, which is what bounds the population (see FogSpawn).
//   2. `tr.warningBegan` -> despawn them again. A safety net, not a duplicate: it
//      guarantees the invariant "a FogSpawn exists only inside an Active phase" from
//      the other side, so a cycle cannot inherit stragglers from one whose
//      `activeEnded` was dropped by `samosbor_step`'s four-crossing clamp, from a
//      loaded save, or from a ride taken mid-samosbor.
//   3. `!samosbor_active(st)` -> return. No pressure outside the Active phase.
//   4. Off-cadence -> return, unless `tr.activeBegan`, which forces the first attempt
//      onto the exact tick the fog arrives instead of up to 2 s later.
//   5. `samosbor_census` around `anchor`, `samosbor_threat_target` for the floor and
//      variant, `samosbor_threat_headroom` for the census. Spawn
//      `min(target - withinOuter, headroom)` heads, re-testing
//      `samosbor_fog_spawn_allowed` after each one.
//
// `anchor` is the entity the pressure is measured around — the camera holder in
// practice, but nothing here knows that ("the player is not special"). An invalid
// anchor, or one on another layer, is a silent no-op, so the call site needs no
// guard.
//
// `danger` is the floor's 1..5 rating, i.e. `danger_for_hostility(spec.hostility)`.
// It drives the monster level exactly as `spawn_floor_mobs` does and decides
// `highRisk` at `kFogHighRiskDanger`.
//
// No allocation on a tick that spawns nothing. On a tick that does spawn, one
// `std::vector` inside `wander_init` — see the note on that call in the .cpp for why
// a fog mob without a WanderTarget is a statue.
FogTickReport samosbor_fog_tick(Registry& reg, const World& world,
                                const SamosborState& st,
                                const SamosborTransition& tr, LayerId layer,
                                Entity anchor, int floorNumber,
                                std::uint8_t danger, std::uint64_t simTick);

// Same, with the pressure anchor given as a world position instead of an entity.
// This is the form the tests drive; the entity form is a Transform lookup on top.
FogTickReport samosbor_fog_tick_at(Registry& reg, const World& world,
                                   const SamosborState& st,
                                   const SamosborTransition& tr, LayerId layer,
                                   vec3 around, int floorNumber,
                                   std::uint8_t danger, std::uint64_t simTick);

// Destroy every FOG-spawned mob on `layer`, leaving the floor's authored population
// alone. Returns how many went.
std::uint32_t despawn_layer_fog_mobs(Registry& reg, LayerId layer);

// How many fog-spawned mobs are live on a layer (HUD / tests).
std::uint32_t count_layer_fog_mobs(const Registry& reg, LayerId layer);

} // namespace giga::game
