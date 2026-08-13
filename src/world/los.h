// Line of sight — is the straight segment between two points clear of solid cells?
//
// THE FIRST LOS PRIMITIVE IN THE TREE, and it is in `src/world` rather than in
// combat because it is a question about GEOMETRY, not about fighting.
// [mob_behaviour.h] records the cost of not having it: the reference requires a
// clear line of sight before a monster may see you through a wall, "there is no LOS
// system here, so that test is dropped, and the behaviour degrades". That test now
// has something to call.
//
// **Cell-level, not sub-voxel, and that is consistency rather than laziness.** A
// bullet stops on the first solid CELL ([combat.cpp] projectile_step) and a grenade
// bounces off a cell FACE — asking a finer question here would mean a fragment could
// thread a half-carved cell that stops the bullet fired at it. One granularity for
// everything that travels in a straight line.
//
// **O(cells on the segment), and it must stay off the per-tick path.** [samosbor.h]
// refuses "a raycast per mob per fog tick" by name, and that refusal stands: this is
// for events — a detonation, a decision taken once — not for a sweep over 600
// monsters every tick. If a per-tick consumer ever appears it needs a baked
// visibility field, not this function called more often.
#pragma once

#include "core/math.h"

namespace giga {

class MacroGrid;

// True when nothing solid stands between `a` and `b`.
//
// **The cells CONTAINING the endpoints do not block.** A grenade resting in a carved
// pocket, or a body whose centre sits inside a doorway cell, would otherwise be
// shielded by the geometry it is standing in — which reads as "the blast did
// nothing" and is the wrong answer to the right question. Only what is genuinely
// BETWEEN them counts.
//
// Toroidal on x/y: the segment is walked toward `b`'s nearest image, so a blast at
// x = 1 and a body at x = 255 are two metres apart and see each other, exactly as
// every other distance in the game already measures ([core/wrap.h] wrap_delta_f).
// z does not wrap, matching the projectile integrator; a segment leaving the stack
// vertically is BLOCKED rather than wrapped, because there is nothing above the top
// layer to see through.
//
// Degenerate input (a and b in the same cell) is clear by definition: there is no
// cell between them.
bool los_clear(const MacroGrid& grid, const vec3& a, const vec3& b);

// How many solid cells stand between `a` and `b`. `los_clear` is `== 0`, and this is
// the form to use when a caller wants to attenuate rather than block outright — a
// future pressure model, or a noise occlusion pass. Same endpoint rule.
int los_blockers(const MacroGrid& grid, const vec3& a, const vec3& b);

} // namespace giga
