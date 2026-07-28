// AI — the utility brain for embodied NPCs ([ai.md]). Pure game-layer over the
// ECS: needs decay as SoA columns, a pure scorer ranks intents, argmax +
// hysteresis commits one, and steering writes Controller::wishDir — the SAME
// locomotion path as the player ([controller.md] -> [physics.md]; the player is
// not privileged, [npcs.md]). It runs ONLY on the embodied slice of the live
// floor; the cold pool is the macro tick's abstract job ([macrosim.md]). Because
// it is pure game-layer over EnTT + NpcPool (no SDL/Vulkan) it is exercised
// headless by game_test, exactly like the macro tick.
//
// This file currently implements increment #12a — the NEEDS layer only: the
// decaying 0..100 drive columns and their single linear update pass, ported
// verbatim from the reference `needs.ts` (rates, spawn ranges, the pee/poo
// digestion model and the STR/AGI/INT decay scaling are the frozen table). The
// utility scorer + selection FSM (#12b) and the stagger + baked-nav steering
// (#12c) build on top of this same component set.
#pragma once

#include <array>
#include <cstdint>

#include "core/rng.h" // giga::hash3, rand01 (deterministic, stateless seed)
#include "ecs/registry.h"

namespace giga::game {

class NpcPool; // decl only; needs_step reads the character-sheet attribute block

// ---------------------------------------------------------------------------
// Needs — the embodied drives ([ai.md] §1, reference `needs.ts`).
//
// A fixed, extensible block of 0..100 needs, ONE row per embodied agent, stored
// as an ECS component so EnTT keeps them as a packed SoA column that updates in a
// single linear pass — never a per-object update method. Cold records carry no
// fine needs (the macro tick models their lives abstractly); needs materialise
// on embodiment and fold away on de-embodiment, like every other transient
// ([npcs.md]: hp/inventory stay canonical, only transient state folds).
//
// Two flavours share one block, distinguished by INDEX, not a type tag:
//   * RESERVES  (food/water/sleep) start high and DECAY toward 0 = crisis, each
//     slowed by a governing attribute (a hardier NPC hungers slower);
//   * PRESSURES (pee/poo) start low and rise toward 100 = failure, but ONLY by
//     digesting a pending pool the eat intent fills — they do not climb on their
//     own (reference: pee/poo rise only while pendingPee/pendingPoo > 0).
// ---------------------------------------------------------------------------

enum NeedId : std::uint8_t {
    NeedFood = 0,  // reserve: 100 sated -> 0 starving (HP damage at 0)
    NeedWater,     // reserve: 100 hydrated -> 0 parched
    NeedSleep,     // reserve: 100 rested -> 0 exhausted
    NeedPee,       // pressure: 0 empty -> 100 failure; rises via digestion
    NeedPoo,       // pressure: 0 empty -> 100 failure; rises via digestion
    kNeedCount
};

// Reserves occupy [0, kFirstPressure); pressures occupy [kFirstPressure,
// kNeedCount). The split is the one place the two mechanisms diverge in step().
inline constexpr std::uint8_t kFirstPressure = NeedPee;

inline constexpr float kNeedMin = 0.0f;
inline constexpr float kNeedMax = 100.0f;

// The component. A flat float block addressed by NeedId, plus the two digestion
// buffers. Float (not byte) because the per-tick delta is fractional (~0.08/s *
// ~8 ms) and byte truncation would quantise it to zero; a handful of floats over
// the ~16k embodied set is negligible ([performance.md]).
struct Needs {
    std::array<float, kNeedCount> v{};
    float pendingPee = 0.0f; // eating fills it; it digests into NeedPee over time
    float pendingPoo = 0.0f; // eating fills it; it digests into NeedPoo over time
};

// Per-need rate in units per SECOND (reference `needs.ts`, verbatim). For
// reserves this is the decay rate; for pressures it is the DIGESTION rate
// (pending pool -> pressure). DATA, not code — retuning the society is a table
// edit, never a code change.
//   FOOD_RATE 0.08  WATER_RATE 0.12  SLEEP_RATE 0.05  PEE_DIGEST 0.10  POO_DIGEST 0.06
inline constexpr float kNeedRatePerSec[kNeedCount] = {
    0.08f, // food   decay
    0.12f, // water  decay (fastest reserve)
    0.05f, // sleep  decay (slowest reserve)
    0.10f, // pee    digestion (pendingPee -> pee)
    0.06f, // poo    digestion (pendingPoo -> poo)
};

// Attribute-scaled reserve decay (reference: `rate /= (1 + 0.1 * stat)`, so a
// higher stat drains the reserve slower). The reference scales food by STR, water
// by AGI, sleep by INT; pee/poo digestion is NOT attribute-scaled. gigahrush2's
// generic 8-slot attribute block ([npcs.md]) has no named stats — fixing slots
// 0/1/2 = STR/AGI/INT here (the reference RPGStats order) IS the slot->meaning
// data decision `population.cpp` defers. kNeedAttrSlot[n] < 0 disables scaling.
inline constexpr int kNeedAttrSlot[kNeedCount] = {0, 1, 2, -1, -1};
inline constexpr float kNeedAttrPerPoint = 0.1f; // reference 0.1 per stat point

// Deterministic spawn bands per need, matching the reference `freshNeeds()`:
//   food 70..100  water 70..100  sleep 60..100  pee 0..30  poo 0..20
// so a freshly embodied crowd starts out of crisis with per-agent spread.
inline constexpr float kNeedSeedLo[kNeedCount] = {70.0f, 70.0f, 60.0f, 0.0f, 0.0f};
inline constexpr float kNeedSeedHi[kNeedCount] = {100.0f, 100.0f, 100.0f, 30.0f, 20.0f};

// Salt for the deterministic need seed, distinct from every other hash stream
// (worldgen / macro tick) so seeds are uncorrelated with them.
inline constexpr std::uint32_t kSaltNeedSeed = 0x0'11ee'd50u;

// Deterministically seed one agent's needs from its stable id. Same id -> same
// starting needs, every run: reproducible embodiment, zero stored RNG state
// ([ARCHITECTURE.md] §Determinism). Each need draws an independent hash stream so
// they are uncorrelated. The pending pools start empty (fresh gut).
inline void seed_needs(Needs& needs, std::uint32_t id) {
    for (std::uint8_t n = 0; n < kNeedCount; ++n) {
        const float u = rand01(hash3(id, n, kSaltNeedSeed));
        needs.v[n] = kNeedSeedLo[n] + (kNeedSeedHi[n] - kNeedSeedLo[n]) * u;
    }
    needs.pendingPee = 0.0f;
    needs.pendingPoo = 0.0f;
}

// Advance every embodied agent's needs by one sim tick, in a single linear pass
// over the packed Needs column ([ai.md] §Data-oriented): reserves decay
// (attribute-slowed, clamped at 0), pressures digest their pending pool (clamped
// at 100). O(n) over the live set, no search, no per-object dispatch. `pool`
// supplies the attribute block for the reserve scaling; it reads each entity's
// NpcRef to find its row.
void needs_step(Registry& reg, NpcPool& pool, float dt);

} // namespace giga::game
