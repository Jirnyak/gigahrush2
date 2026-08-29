// Hunt — prey selection: what a monster is going after, and why.
//
// Before this file, "what a monster is going after" had exactly one answer:
// whoever holds the camera, if it is within `kAggroRadius`. Distance was the whole
// model, so a monster 25 m away in a silent corridor and a monster 25 m away
// standing in the middle of a firefight behaved identically. This adds the second
// answer — a monster that HEARD something recently goes and looks at it — which is
// the reference's shared noise-investigation branch (`tryFollowNoise`), and the
// first consumer of [noise.h].
//
// ---------------------------------------------------------------------------
// Why this is an OVERRIDE on top of wander_step, not a rewrite of it
// ---------------------------------------------------------------------------
// The SEEN half still lives in [wander.cpp], where the sight-aggro pursuit,
// `pursuit_offset` encirclement, the gaze freeze and the wall-bias speed all
// already work. This pass runs AFTER `wander_step` and rewrites the horizontal
// velocity of the mobs that heard something and are not already in sight-aggro.
//
// That is a deliberate choice about blast radius, not laziness. Hoisting the seen
// half up here would be a refactor of the one steering path that is proven, inside
// a change whose actual job is to add a missing primitive — and the two would then
// have to be verified together instead of separately. As an override, `investigate_step`
// is purely additive: delete the call and the game is exactly what it was.
//
// The honest cost of that shape: two passes over the mobs on the layer instead of
// one. It is paid only when something is making a noise — `investigate_step` returns on
// `NoiseField::quiet()`, which is true on almost every tick, before it looks at a
// single entity. The stagger predicate is deliberately IDENTICAL to
// `wander_step`'s, so a mob's hearing decision lands on the same tick as the
// velocity it is overriding rather than one visit behind it.
//
// ---------------------------------------------------------------------------
// Sight beats sound
// ---------------------------------------------------------------------------
// A monster that can see you does not wander off toward a crate lid. The sight
// test here mirrors `wander_step`'s exactly, faction gate included — if the two
// ever disagree, a mob gets steered twice per tick by two systems that each think
// they own it, and the symptom is a monster that vibrates between a target and a
// sound. Same reason the faction gate had to be duplicated into `mob_attack_step`.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "ecs/registry.h"
#include "game/mob_table.h"     // MobBehaviour
#include "game/noise.h"
#include "game/npc_pool.h"
#include "world/level_stack.h"

namespace giga::game {

// ---------------------------------------------------------------------------
// The investigation branch's own numbers, from the reference
// ---------------------------------------------------------------------------
// `findNoiseInvestigationTarget` is `findNoiseForActor` with minSeverity 2,
// scanInterval 1.0 s and hearingMult 1.12. Two of the three port directly; the
// scan interval does not, and the difference is worth stating: the reference gives
// each actor a private randomised re-scan timer plus a "stay interested in this
// record" window, held in a per-actor map. Here the identity-hash stagger already
// spreads the scans (`kWanderPeriod` = 8 ticks = ~15 scans/s per mob, far finer
// than the reference's 1 Hz), and the noise's own fading TTL provides the
// persistence its `hotUntil` window provided. So there is no per-mob state at all
// in this pass, which is what keeps it allocation-free: it writes only `Velocity`,
// a component already in the view it iterates, and emplaces nothing.
inline constexpr std::uint8_t kInvestigateMinSeverity = 2;
inline constexpr float kInvestigateHearing = 1.12f;

// Metres from the sound at which a mob stops walking and mills about. Without it
// an investigating monster overshoots and oscillates across the point every visit,
// which reads as a bug rather than as searching.
inline constexpr float kInvestigateArriveRadius = 1.5f;

// Two hearing multipliers the reference authors for behaviours this file does NOT
// implement, kept here so the numbers are compiled, greppable and testable rather
// than living in a comment that will be re-derived from the reference next time.
// [noise.h] lists what each behaviour still needs beyond the primitive.
inline constexpr float kBeamHearing = 1.45f;   // Slepoglaz, LastSoundBeam
inline constexpr float kDogHearing = 1.25f;    // Green Dog, the noiseFear half
inline constexpr float kDogFearRadius = 18.0f; // ...and its fear radius, metres

// What a mob heard, or `heard == false`. Pure: no registry, no world, no state, so
// a test can pin the decision without building a floor.
struct InvestigateHeard {
    bool heard = false;
    float dx = 0.0f;             // toroidal delta from the mob TO the noise, metres
    float dy = 0.0f;
    float dist = 0.0f;           // full 3D distance, metres
    std::uint32_t noiseId = 0;   // monotonic; what a one-shot behaviour remembers
    std::uint8_t severity = 0;
};

// Should this mob go and look at something? Answers no for a behaviour that is
// authored deaf, and no when nothing audible passes the severity gate.
//
// `mobId` is the mob's own `entt::to_integral`, so it cannot investigate a noise it
// made itself (13 of the 69 kinds shoot).
// `ac` (G, S20.1): акустика на скелете — стены глушат; nullptr = прямолинейно.
InvestigateHeard investigate_hear(const NoiseField& field, MobBehaviour beh, LayerId layer,
                    const vec3& mobPos, std::uint32_t mobId,
                    const NoiseAcoustics* ac = nullptr);

// One staggered investigation pass. Overwrites horizontal velocity for every mob on
// `layer` that heard something and is not in sight-aggro; leaves every other mob
// exactly as `wander_step` left it. Returns the number of mobs steered by sound.
//
// Belongs immediately AFTER `wander_step` and BEFORE `physics_step`: after, because
// it overrides; before, because physics is what turns the velocity into movement.
//
// `pool` is read only to resolve the camera holder's faction, for the same reason
// `wander_step` reads it — the sight test must be the same test.
std::uint32_t investigate_step(Registry& reg, const NoiseField& field, NpcPool& pool,
                        LayerId layer, std::uint64_t tick,
                        const NoiseAcoustics* ac = nullptr);

} // namespace giga::game
