// Per-floor generator — builds a floor MODULE's 128^3 World as a pure function
// of (seed, floor number, FloorSpec).
//
// floors.md / macrosim.md: a floor is a self-contained module whose geometry is
// fully determined by its number and the world seed. That determinism is what
// lets a streamed-out floor be torn down and regenerated bit-for-bit on return
// (increment #9), so nothing about a floor's layout has to be persisted.
//
// The floor's *character* (its FloorKind, carried in the FloorSpec) selects a
// geometry PROFILE — room pitch, storey height, doorway size, and decay (broken
// walls, collapsed slabs, rubble). Different kinds therefore build measurably
// different interiors from the same seed: dense residential warrens, open
// commercial halls, sparse industrial plates on pillars, broken derelict mazes.
// The profile is a data table (one row per kind), never a code branch.
//
// Pure game-layer + core: no SDL/Vulkan/ImGui, headless-testable in game_test.
#pragma once

#include <cstdint>
#include <vector>

#include "game/floor_spec.h"

namespace giga {
class World;
}

namespace giga::game {

// Build `world`'s grid into the floor labelled `number`, themed by `spec`.
//
// The world is cleared to air first, so the result depends only on
// (number, spec.kind, seed) and NOT on any prior contents of `world` — call it
// again with the same arguments (even on a recycled World slot) and you get an
// identical grid. `number` is the in-game floor label (signed, floors.md); it is
// mixed into the RNG so two floors of the same kind still differ.
void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed);

// The X/Y room-lattice pitch this kind builds on, in macro cells. A "room" is the
// (stride-1)^2 interior between four wall lines; the wall lines themselves sit on
// every cell whose x or y is a multiple of the stride.
//
// Exported rather than copied because the mob spawner places packs BY ROOM and has
// to agree with the generator exactly. A duplicated stride table would keep
// compiling and start placing "rooms" straddling wall lines the day a row in the
// generator's geometry profile is retuned — a silent, seed-dependent drift.
// Out-of-range kinds fall back to row 0, the same clamp generate_floor uses.
int floor_room_stride(FloorKind kind);

// One opening this generator punches through an interior wall — the cell a DOOR
// occupies ([door.h]). Positions are macro cells, so a byte each.
//
// `axis` says which wall line the opening is IN, which is the only thing a
// consumer cannot re-derive from the cell alone once the wall has decayed:
//   0 -> the wall line x == cx, so the jambs are at (cx, cy+-1)
//   1 -> the wall line y == cy, so the jambs are at (cx+-1, cy)
struct Doorway {
    std::uint8_t cx = 0;   // opening cell, X
    std::uint8_t cy = 0;   // opening cell, Y
    std::uint8_t cz = 0;   // BOTTOM cell of the opening
    std::uint8_t h = 0;    // opening height in cells, >= 1
    std::uint8_t axis = 0; // which wall line holds it (see above)
};

// Enumerate every doorway `generate_floor(world, number, spec, seed)` punches,
// appending to `out`; returns how many were added. Empty for a pillar-mode kind
// (an open plate has no wall segments to open).
//
// Exported for the same reason floor_room_stride is: a second consumer has to
// agree with the generator EXACTLY. door.cpp needs the doorway cells at floor
// load, and the two ways to get them are both traps —
//
//   * re-deriving them from the finished grid guesses, and guesses wrong on a
//     Derelict floor, where `gapPct` has knocked 38% of the wall out and a
//     collapsed hole is indistinguishable from an architectural opening;
//   * replaying the generator's xorshift stream couples the replay to the ORDER
//     every other loop in generate_floor draws numbers in — the same silent,
//     seed-dependent drift the note above warns about for the stride table.
//
// So the offset of an opening inside its wall segment is a pure HASH of
// (seed, number, storey, room, axis), and this function and the generator call
// the same one. A hash has no order to get wrong.
std::uint32_t floor_doorways(int number, const FloorSpec& spec, unsigned seed,
                             std::vector<Doorway>& out);

} // namespace giga::game
