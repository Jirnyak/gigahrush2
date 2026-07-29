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

#include <cstddef>
#include <cstdint>
#include <vector>

#include "game/floor_spec.h"
#include "game/mob_table.h"  // RoomBit — the generator names rooms in the shared taxonomy

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

// ---------------------------------------------------------------------------
// Room taxonomy — what KIND of room a lattice cell is
// ---------------------------------------------------------------------------
// `RoomBit` ([mob_table.h]) is authored on all 69 mob rows (`rooms`) and on 356 of the
// 446 item rows (`spawn_rooms`) — and measured, those 356 are EXACTLY the rows with a
// non-zero spawn weight, so a room filter can never drop a rollable item for want of
// authoring. Until this existed **nothing read either column**: every caller of
// `item_weight_on_floor` passed a mask of 0, and `MobDef::roomMask` had no reader at
// all. The generator is the only thing that can close that, because it is the only
// thing that knows a room's identity — it lays the lattice, so room (rx, ry) is a
// place before anything is spawned into it.
//
// One BIT per room, not a set: a room is a kitchen or a store room, and a room that
// is both filters like neither. Which bits a kind may produce is a per-FloorKind
// weight table in the .cpp, so retuning a floor family's character is a row edit.
//
// Keyed on (kind, number, rx, ry) and deliberately NOT on the world seed. Every
// consumer must agree about what room 5 is, and the two live consumers are handed
// DIFFERENT seeds by main.cpp (0xC0FFEE-derived for containers, 0xB0B5EED-derived for
// mobs) while neither is handed the worldgen seed. Keying on a seed would therefore
// have made the container system and the mob system disagree about the same room —
// the exact silent, per-consumer drift the note on floor_room_stride above warns
// about. The cost is that a floor label's taxonomy repeats across runs; the layout it
// is stamped onto does not.
//
// Returns a single-bit mask, never 0.
std::uint16_t floor_room_mask(FloorKind kind, int number, int rx, int ry);

// How many bits RoomBit defines (Corridor .. Hq). Lives here rather than in
// mob_table.h so the generated-table header stays untouched; the static_assert in
// floor_gen.cpp pins it against the enum.
inline constexpr std::size_t kFloorRoomBits = 11;

// Index of a single-bit room mask, 0..kFloorRoomBits-1, or -1 for 0 / out of range.
// Consumers use it to key a per-room-kind lookup table without a switch.
int floor_room_bit_index(std::uint16_t mask);

// ---------------------------------------------------------------------------
// Standing water
// ---------------------------------------------------------------------------
// Industrial and Derelict floors seed the fluid field ([sim/fluid.h]) with walled
// SUMPS on the ground storey — a burst pipe's outfall, a flooded pit. Before this the
// field was seeded only by the maze test bed, so the cellular fluid sim was compiled
// and tested and could not be reached in the mode the game runs.
//
// Water goes in a KERBED basin rather than a bare puddle, and that is a cost decision
// with a measured number behind it, not decoration. An open puddle bleeds 6.25% of its
// edge gradient per step into the surrounding room forever: it is invisible within
// ~50 steps and still creeping thousands of steps later, and every moving step
// invalidates the cube pass's instance cache at 28.6 ms a rebuild
// ([render/cube_pass.h]) — so settle time IS frame time. A basin whose four lateral
// neighbours and floor are solid cannot leak at all, so it levels out and then costs
// nothing for the rest of the run: measured on fluid.cpp's exact transfer rule, 27
// steps to zero motion for a 3x3 basin and 41 for a 5x5, mass conserved exactly.
//
// The basin cells are PARTIALLY carved — four solid sub-voxel layers of eight — and
// that is what makes the liquid VISIBLE rather than merely present. cube_pass emits
// only cells with a non-empty sub-mask, so fluid in an AIR cell tints nothing at all;
// the maze test bed's two seeded puddles have never rendered for the same reason. Half
// solid leaves 0.5 of a unit of capacity, is drawn, is tinted, and keeps the basin
// floor 1.0 m below the kerb's top face — inside the 1.27 m apex `Jump` gives, so a
// body that falls in through a Derelict slab hole can get out again. This is the first
// partial sub-mask anything in the tree writes.
//
// Cells of water this kind seeds when every sump finds a home, i.e. the ceiling. A
// sump whose draws all collide with a lattice lobby or an already-placed basin is
// dropped instead of placed; simulated over 399 seeds x 8 floor numbers per kind, all
// 4 Industrial and all 12 Derelict basins were placed every time.
std::uint32_t floor_sump_cells(FloorKind kind);

// The level water SETTLES to inside a sump, in cell-fractions — the authored number,
// with the seed derived from it (the outfall cell starts at double its share, so the
// solver has work to do). 8x the render's 0.05 tint threshold, under the 0.5 capacity
// a half-solid basin cell has, and far above kFluidMinFlow so a settled basin reads as
// water rather than as rounding. Measured settle: 27 steps for a 3x3 basin, 41 for a
// 5x5, ending at 0.400000 per cell in both with mass conserved exactly.
inline constexpr float kFloorSumpLevel = 0.40f;

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
