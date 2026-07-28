// Predation — monsters hunting the crowd, at a rate that still leaves a crowd.
//
// [combat.h] and [wander.h] both deferred this with the same sentence, and the
// reason was correct rather than an excuse: "faking it with 'attack the nearest
// body' would make a residential floor a bloodbath on load." The arithmetic is
// decisive. A Residential floor at |z|=15 carries **420 residents and 600
// monsters** (floor_spec.cpp, mob_count_for_floor). A monster has a ~2 m reach and
// swings roughly once a second; 600 of them against 378 huntable bodies (one tenth
// of the crowd is Cultist and exempt, below) empty the floor in well under a
// minute. Any design in which a large FRACTION of the roster hunts wipes the
// population, whatever the radius — 600 monsters is simply too many mouths.
//
// So the restraint is not a radius and not a cooldown. It is scarcity of HUNTERS:
//
//   1. **The player outranks the crowd.** A monster with the camera holder inside
//      kHuntRadius does not look at the locals at all, so nothing about the
//      player's experience of being hunted changes.
//   2. **A much shorter radius.** kHuntRadius is 6 m against the 20 m player
//      aggro — roughly "the same room", not "down the corridor".
//   3. **Only ~1 monster in kHuntShare is hunting at any moment**, chosen by the
//      identity-hash stagger already used for wander scheduling and pack
//      cohesion. This is the actual rate control; 1 and 2 only shape it.
//   4. **A hunting window is finite.** Interest lasts kHuntEpochTicks and then
//      passes to a different cohort, so a body that survives its window is left
//      alone — fights are interruptible without any per-monster state.
//
// Everything here is a PURE function of (entity id, tick) or a read-only query.
// There is no hunt state, no budget object, no per-monster target field, and
// therefore nothing that can desynchronise between the two consumers: wander_step
// steers at the same body mob_attack_step swings at because both recompute the
// same rule from the same inputs, exactly as `pack_target_node` does.
//
// **Rejected, with the reason, because both were suggested and both are wrong
// here:**
//   * *Prey that flees.* Measured against data/mobs.csv: the 23 kinds eligible for a
//     |z|=15 floor move at 1.6 to 6.3 m/s while a resident walks at 1.35
//     (wander.cpp kNpcWalkSpeed), so the SLOWEST monster on that roster still closes
//     on a sprinting civilian. Fleeing cannot break contact. And spreading damage
//     over more bodies does not lower the death toll — it delays it, and leaves a
//     floor of half-dead residents, because nothing heals a crowd body ([needs.h]
//     ticks the camera holder's row alone).
//   * *A per-monster post-kill cooldown.* 600 monsters at one kill per C seconds is
//     600/C kills per second; holding the toll near 100 per ten minutes would need
//     C ≈ 50 minutes, which is not a cooldown, it is a disabled feature.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "core/tick.h"
#include "ecs/registry.h"
#include "game/npc_pool.h"
#include "world/level_stack.h"   // LayerId

namespace giga::game {

// How close a body has to be before a hunting monster will take it, metres.
//
// Deliberately far shorter than wander.cpp's 20 m player aggro: predation is
// opportunistic — something in the room — while the player is stalked. It is also
// never LARGER than the smallest behaviour aggro radius (CloseReveal, 6.0 m), which
// is what makes "the player wins inside kHuntRadius" a strict rule rather than an
// approximate one: any body close enough to be prey is close enough that the
// camera holder in the same spot would have been chased instead.
inline constexpr float kHuntRadius = 6.0f;

// Sim ticks a hunting cohort holds its licence. 2400 is 20 s at the 120 Hz step.
//
// Sized against the fight and not against feel, and the fight is slower than it
// looks: across the |z|=15 roster, weighted by spawn weight, a level-3 monster needs
// **13.8 s** of uninterrupted swinging to take a 100 HP resident down (median dmg 13,
// median attackCd 1.55 s, x1.24 for level 3). Twenty seconds is that plus the couple
// of seconds it takes to cover 6 m.
//
// Erring short is worse than erring long, which is why this is not tuned down to
// taste: an abandoned half-kill leaves a wounded body that the NEXT cohort finishes
// in half the time, and nothing ever heals it, so short windows convert a flat
// casualty rate into an accelerating one.
//
// KNOWN DRIFT, deliberately not fixed here — read this before "correcting" the value.
// 2400 was 20 s at the old 120 Hz step. core/tick.h now runs the sim at 125 Hz, so this
// window is 19.2 s, which errs short in exactly the direction the paragraph above
// forbids: the margin over the 13.8 s time-to-kill fell from 6.2 s to 5.4 s and nobody
// decided that. The sibling epochs in wander.h and rumour.h were repaired in place by
// deriving them from kSimHz; this one was not, and the reason is measured rather than
// cautious.
//
// Changing it to 20u * kSimHz (2500) was tried and reverted. It shifts the phase of the
// identity-staggered epoch, which changes WHICH cohort holds a licence during any given
// tick window — and tests/suite_noise.inl's gunshot demo depends on that alignment: its
// mob stops firing inside the 300-tick window and three checks fail (shotsFired == 1,
// soundSteers > 0, noise.live() == 1). Bisected: 4 failures with the change, 1 without,
// and that remaining 1 is present at HEAD with all of my edits stashed, so it is not
// from this work.
//
// The fix therefore has to move the test's window with the constant, and suite_noise.inl
// is being edited by another session right now — its failing line moved from :440 to
// :457 between two runs of mine. Deferred rather than forced, because a phase-shifted
// epoch silently changing a noise test is precisely the class of breakage this file's
// own comments warn about.
inline constexpr std::uint64_t kHuntEpochTicks = 2400;

// One monster in this many is hunting at any given moment.
//
// THE tuning knob, and the only number here with no derivation — it was MEASURED.
// `test_hunt_all` runs floor 15 (420 residents, 593 monsters at level 3) for a
// simulated ten minutes at the 120 Hz tick and counts who is left:
//
//   share   hunters   dead / 10 min   survivors   deaths in minute 1   tail
//     96      6.3       31  (7.4%)       389              7           1-2/min
//     32     17.7       59 (14.0%)       361             14           ~3/min
//     16     36.6       97 (23.1%)       323             34           2-3/min
//
// Two things in that table decided the value, and neither was guessable:
//
//   * **The tail rate barely moves.** 1-3 deaths a minute at every setting, because
//     after the initially co-located bodies are eaten predation is limited by how
//     often a monster and a resident MEET, not by how many monsters are licensed.
//     So this knob mostly sets how hard the FIRST minute bites.
//   * **Which is exactly the load spike the feature was deferred over.** 34 deaths
//     in the first minute at share 16 is the "bloodbath on load" in miniature. 32
//     keeps it to 14 — visible, not a massacre — for 18 hunts running concurrently
//     on the floor, which is enough that the player has one in view a third of the
//     time and 86% of the crowd is still standing after ten minutes.
//
// Raise it for a safer floor, lower it for a deadlier one, and re-run that test
// rather than reasoning about it: the response is sublinear (3x the hunters bought
// 1.9x the deaths) because hunters double up on the same body.
inline constexpr std::uint32_t kHuntShare = 32;

// Is this monster licensed to hunt the crowd right now?
//
// Pure, O(1), stateless. The epoch is offset by the monster's own identity so
// cohorts turn over smoothly instead of the whole floor swapping licences on one
// tick — and so every monster gets a FULL window rather than whatever remained of
// a globally aligned one.
bool mob_hunts_npcs(std::uint32_t mobId, std::uint64_t tick);

// The nearest body a monster may eat, or a null entity.
struct Prey {
    Entity e = entt::null;
    vec3 pos{0, 0, 0};
};

// Nearest embodied, hostile-to-monsters, not-already-dying record within `radius`
// of `from` on `layer`. The camera holder is EXCLUDED: it is the caller's separate,
// longer-ranged target and would otherwise be picked up twice under two different
// rules.
//
// The faction gate is `mob_hostile_to`, which resolves through `body_row` and not
// `rel_row` — a monster ignores a Cultist resident for exactly the reason it ignores
// a Cultist player, because it cares what body is in front of it and not who is
// driving ([faction_relations.h]). On the default Residential mix that exempts one
// resident in ten by construction.
//
// Read-only: it takes a const Registry and touches no component that could be
// created, so it is safe to call from inside another view's iteration — which is
// exactly how both consumers use it.
Prey nearest_prey(const Registry& reg, const NpcPool& pool, LayerId layer,
                  const vec3& from, float radius);

} // namespace giga::game
