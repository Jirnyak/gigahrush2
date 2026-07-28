// Monster behaviour dispatch, wave 1 — the stateless half.
//
// The mob table carries 47 `MobBehaviour` values and until now **nothing read a
// single one of them**. Every one of the 69 kinds walked straight at you and hit you.
// The data was ported faithfully and then ignored, which is the failure mode the
// table's own comment warns about: a column nothing reads is a column that rots.
//
// This wave deliberately implements only the behaviours that need **no per-monster
// state and no new world system**. That constraint is what makes it one increment
// instead of five: every function here is pure, so each is testable without a world,
// a registry, or a tick, and none of them can desynchronise from anything.
//
// Reconnaissance against the reference produced three findings that shaped this file
// more than any spec did:
//
//   * **`foodBait` — the flag carried by the most kinds (10) — is read by nothing in
//     the reference either.** Its bait attraction is gated by a hand-written kind
//     list that DISAGREES with the flag for 6 kinds. So the CSV column is a faithful
//     copy of a field the source ignores. Not implemented, and that is the correct
//     outcome rather than a gap.
//   * **`WeakWallBreach` (Betonoed) has no AI implementation to port** — only a
//     one-off scripted floor encounter. Also impossible here: destructible geometry
//     would invalidate the per-floor baked flow fields.
//   * **`Melee` (Gnome) is a no-op** — zero readers anywhere. It is `Plain` under
//     another name.
//
// Four behaviours are therefore formally dead, and saying so is worth more than
// specifying them: `Melee`, `WeakWallBreach`, `RangedClause` (one line, a scan
// cooldown), `SourceSwarm` (a spawner subsystem keyed on stage, not the flag).
#pragma once

#include <cstdint>

#include "core/math.h"
#include "game/mob_table.h"

namespace giga::game {

// ---------------------------------------------------------------------------
// Pursuit offset — the encirclement steer
// ---------------------------------------------------------------------------
// The single highest change-in-feel per line in the whole behaviour set, and it
// costs zero bytes of state.
//
// Today every aggroed monster steers at the victim's exact position, so a group
// converges into one cell and reads as a conga line. Both of the reference's
// group-positioning behaviours are *pure functions of entity ids*, so the fix is to
// steer at `victimPos + pursuit_offset(...)` and nothing else changes:
//
//   GarbageSurround (Помойный Рой) — a deterministic slot on a ring of 8 around the
//     victim at 1.65 m. Encirclement, not a queue.
//   GreenDogPack (Зелёный Пёс) — flank: offset perpendicular to the approach by
//     1.7 m, side chosen by the low bit of the id, with one dog in four cutting
//     1.2 m behind instead.
//
// Returned in metres, in world XY. `dirX/dirY` is the normalized approach direction,
// needed for the perpendicular; pass zeros and the flank degrades to no offset
// rather than to a division by zero.
struct PursuitOffset {
    float x = 0.0f;
    float y = 0.0f;
};
PursuitOffset pursuit_offset(MobBehaviour b, std::uint32_t mobId,
                             std::uint32_t victimId, float dirX, float dirY);

// ---------------------------------------------------------------------------
// Detect radius — the two behaviours that let you walk away
// ---------------------------------------------------------------------------
// Every monster currently aggros at the same `kAggroRadius` of 20 m, so there is no
// such thing as sneaking past one. Two kinds are authored to have a much shorter
// leash until they notice you, and both are a single number:
//
//   DeadEcho (Безэхий)   7.5 m until revealed — it is deaf and half-blind
//   CloseReveal (Нелюдь) 6.0 m — a mimic; the "reveal" in the reference is only a
//                        message and an event, so mechanically it IS a short radius
//
// Returns the default when a behaviour has no override, so the caller is one `min`
// and never a switch.
float behaviour_aggro_radius(MobBehaviour b, float defaultRadius);

// ---------------------------------------------------------------------------
// WeepingAngel — and a live instakill this fixes
// ---------------------------------------------------------------------------
// Sculpture freezes while it is being looked at: within 25 m and inside a +/-45 deg
// cone of the viewer's facing. The reference also requires a clear line of sight;
// there is no LOS system here, so that test is dropped, and the behaviour degrades
// gracefully — it freezes slightly more often than authored, which is the safe
// direction for a monster this lethal.
//
// This is a bug fix wearing a behaviour's clothes. Sculpture's table row is 8.5
// cells/s and **1000 damage** — authored on the assumption it can only close the
// distance while unobserved. With the behaviour unimplemented it simply sprinted at
// the player and one-shot them from full health, with no counterplay whatsoever.
//
// `yaw` is the viewer's heading in radians, matching CameraTag. Cone half-angle is
// compared by cosine so there is no trig per monster beyond the viewer's own
// forward vector, which the caller computes once.
inline constexpr float kGazeRange = 25.0f;
inline constexpr float kGazeCosHalfAngle = 0.7071068f;   // cos(45 deg)

// True when the monster must hold perfectly still. `fwdX/fwdY` is the viewer's
// normalized forward; `dx/dy` the toroidal delta from viewer to monster.
bool frozen_by_gaze(MobBehaviour b, float fwdX, float fwdY, float dx, float dy);

// ---------------------------------------------------------------------------
// Wall bias — 4 kinds, one world query, no state
// ---------------------------------------------------------------------------
// `AiFlag::WallBias` is carried by 4 kinds (Тварь, Шовник, Арматура, Бетоноед) and
// read by nothing. In the reference a wall-adjacent carrier moves x1.18 and hits
// x1.2 (Тварь x1.22); in the open it moves x0.92. That is the whole mechanic, and it
// makes corridors and doorways genuinely worse places to be caught than rooms —
// which is free level design, extracted from geometry that already exists.
//
// `adjacentWall` is the caller's cardinal-neighbour test; keeping the query out of
// here is what keeps these functions pure and testable.
inline constexpr float kWallBiasSpeedNear = 1.18f;
inline constexpr float kWallBiasSpeedOpen = 0.92f;
inline constexpr float kWallBiasDamage = 1.20f;

float wall_bias_speed(std::uint32_t aiFlags, bool adjacentWall);
float wall_bias_damage(std::uint32_t aiFlags, bool adjacentWall);

// ---------------------------------------------------------------------------
// Dead behaviours, named so nobody specs them twice
// ---------------------------------------------------------------------------
// True for the four confirmed to have no implementation to port. Kept as a function
// rather than a comment so the fact is compiled, greppable, and testable.
bool behaviour_is_dead(MobBehaviour b);

} // namespace giga::game
