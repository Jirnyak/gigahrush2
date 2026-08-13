// Encumbrance — the ONE place carried weight turns into consequences.
//
// ===========================================================================
// WHY THIS IS NOT "A SPEED MULTIPLIER FOR BEING OVER THE LIMIT"
// ===========================================================================
// The tree already contains three universal laws that SHOULD have been reading
// the load and were not, and the honest overload penalty is mostly those laws
// finally seeing it rather than a new rule bolted beside them:
//
//   * `E = m*v^2/2` — [impact.cpp] charges fall damage from the `Mass` component,
//     and a body's Mass was `22*h^2` ([embody.cpp]), the BODY alone. Sixty kilos
//     of loot made a fall hurt exactly as much as none.
//   * `p = m*v` — knockback pushed every body by the same 2.5 m/s ([combat.cpp]),
//     so a loaded liquidator and an empty child flew equally.
//   * the noise field — a footstep published a fixed 6 m radius, and mobs walk at
//     the sound ([investigate.cpp]). What you were carrying never mattered.
//
// Feeding the load into those means weight matters ALWAYS and CONTINUOUSLY, with
// no cliff at the threshold: one more magazine is one more magazine, not nothing
// until a line is crossed and then a penalty. That is what makes it a physical
// property rather than a rule.
//
// On top of that sit the two penalties that need a THRESHOLD to make sense, and
// the threshold is the character's, never a constant: `carry_capacity_g`
// ([rpg.h]) = 64 kg + 4 kg per point of Strength. Strength is what a player
// spends to carry more, so every number here keys off it.
//
//   * SPEED, with a free band. At or under capacity, nothing. Over, the scale is
//     capacity/carried — at double capacity you walk at half pace. Continuous,
//     no cliff at the edge, and it MULTIPLIES into the existing chain beside
//     hunger, exhaustion and status ([needs.h] needs_speed_scale), instead of
//     becoming a second system that fights it.
//   * FATIGUE. Overload burns sleep faster. You can carry it, and the bill comes
//     later — and `sleep < 10` already halves speed on its own ([needs.h]), so
//     the emergent shape is "hauling a full load home is a decision about how
//     long the trip can be", which is exactly what the survival clock exists for.
//
// ===========================================================================
// COST, and why the sweep is staggered
// ===========================================================================
// Carried weight changes only when someone picks something up, which is rare
// against 125 Hz, while summing it is 64 slot reads per body. Visiting the whole
// crowd every tick would be 420 x 64 = 27k reads per tick for an answer that is
// almost always yesterday's. So bodies are visited 1-in-`kEncumbrancePeriod` by
// identity, exactly like `wander_step`'s stagger ([wander.h] kWanderPeriod): the
// same amortised O(n), a stable phase per body, and no scheduling state.
//
// The consequence to know: a body's `Mass` can lag its inventory by up to
// `kEncumbrancePeriod` ticks (~64 ms). Nothing in the tree reads Mass on a
// deadline that tight — impacts happen on landings, not on pickups.
#pragma once

#include <cstdint>

#include "ecs/registry.h"
#include "game/npc_pool.h"
#include "world/level_stack.h"

namespace giga::game {

// Stagger period, in ticks. A power of two so the phase is a mask, and small
// enough that a pickup is reflected inside ~64 ms at kSimHz.
inline constexpr std::uint32_t kEncumbrancePeriod = 8;

// The slowest a fully buried body may walk. Without a floor the scale approaches
// zero as the load grows and a player who over-packs is not slowed but FROZEN,
// which is a soft lock rather than a penalty.
inline constexpr float kEncumbranceMinScale = 0.35f;

// Extra sleep drained per second at exactly double capacity, on top of the
// baseline `kSleepDrainPerSec`. Scales linearly with the overload fraction, so
// 1.5x capacity costs half of it. DATA, retune freely.
inline constexpr float kOverloadSleepDrainPerSec = 0.10f;

// How much louder a full load is. The footstep radius is multiplied by
// 1 + kNoiseLoadGain * (carried / capacity), so an empty body is unchanged and a
// body at its limit is heard 60 % further out. It is keyed on the RATIO and not
// on raw kilogrammes, so a strong character carrying its own larger budget is not
// punished for the strength it paid for.
inline constexpr float kNoiseLoadGain = 0.6f;

// What one body's load costs it. All three numbers are pure functions of
// (carried, capacity) so they can be unit-tested without a registry.
struct EncumbranceEffect {
    float speedScale = 1.0f;    // multiply into Controller::moveSpeed
    float extraSleepPerSec = 0.0f;
    float noiseMult = 1.0f;     // multiply into a footstep's radius
    bool overloaded = false;
};

// PURE. `capacityG` of 0 is treated as "no budget known" and yields no penalty
// rather than an infinite one — a body with no character sheet must not be
// crushed by a division.
EncumbranceEffect encumbrance_of(std::uint32_t carriedG, std::uint32_t capacityG);

// What one sweep did. `playerEffect` is the camera holder's, so the app can fold
// it into the Controller without a second lookup.
struct EncumbranceTick {
    std::uint32_t visited = 0;    // bodies whose turn it was this tick
    std::uint32_t overloaded = 0; // of those, over their own capacity
    std::uint32_t carriedG = 0;   // the camera holder's load
    std::uint32_t capacityG = 0;  // ... and its budget, from its own Strength
    EncumbranceEffect playerEffect;
    bool sawPlayer = false;
};

struct NoiseField;

// One staggered sweep over the embodied bodies on `layer`.
//
// Writes `Mass` (body + load) on every body it visits, and charges the fatigue to
// the pool's `Needs` row. Does NOT touch Velocity or Controller: the speed scale
// is REPORTED, because the app already owns one place where every movement
// multiplier is folded together and a second writer there is how two systems
// start fighting over a body's pace.
//
// With a non-null `noiseField`, crowd bodies it visits also publish a Footstep
// into the noise field — but only MOVING ones (velocity gate): a body parked on
// a chair is not walking, and eff.noiseMult already scales the loud-when-loaded
// half. The camera holder never publishes here; the player's own noise is the
// input bridge's business.
//
// Runs anywhere in the tick before movement is resolved. No allocation.
EncumbranceTick encumbrance_step(Registry& reg, NpcPool& pool, LayerId layer,
                                 float dt, std::uint64_t tick,
                                 NoiseField* noiseField = nullptr);

} // namespace giga::game
