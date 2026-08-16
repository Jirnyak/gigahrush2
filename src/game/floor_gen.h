// Per-floor generator — builds a floor MODULE's 128^3 World as a pure function
// of (seed, floor number, FloorSpec).
//
// floors.md / macrosim.md: a floor is a self-contained module whose geometry is
// fully determined by its number and the world seed. That determinism is what
// lets a streamed-out floor be torn down and regenerated bit-for-bit on return
// (increment #9), so nothing about a floor's layout has to be persisted.
//
// GEOMETRY COMES FROM MODULES ([floors.md] — the folder is the module). This
// file is only the dispatch seam (kind -> module generator row) plus the room
// TAXONOMY the content tables key on. The floor's *character* (its FloorKind,
// carried in the FloorSpec) themes CONTENT — population, mobs, loot, room mix —
// never geometry branches.
//
// Pure game-layer + core: no SDL/Vulkan/ImGui, headless-testable in game_test.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "game/floor_spec.h"
#include "world/gravity.h" // GravityRegime — the module's declared frame

namespace giga {
class World;
class MacroGrid;
}

namespace giga::game {

// Build `world`'s grid into the floor labelled `number`, themed by `spec`.
//
// The world is cleared to air first, so the result depends only on
// (number, spec.kind, seed) and NOT on any prior contents of `world` — call it
// again with the same arguments (even on a recycled World slot) and you get an
// identical grid. `number` is the in-game floor label (signed, floors.md); it is
// mixed into the RNG so two floors of the same kind still differ.
// A FLOOR ENTRY IS THREE STEPS, NOT ONE. Generation and rules used to be fused
// inside the module generator; splitting them is what lets a VISITED floor come
// back from its snapshot instead of being rebuilt ([floors.md], [problems.md] §42):
//
//   1. floor_declare_rules  — the module's LAWS. Gravity frame, registries.
//                             ALWAYS, before any geometry exists. The frame is a
//                             property of the MODULE, never of the saved bytes,
//                             which is exactly why a restored floor still needs
//                             this and why the snapshot does not carry it.
//   2. generate_floor  OR  a snapshot restore — the GEOMETRY. One or the other:
//                             first visit builds it from (seed, number), a
//                             revisit reads it back verbatim.
//   3. floor_apply_rules    — the module's rules laid ON TOP of whichever
//                             geometry step ran: fluids, seeded content.
//                             ALWAYS, after geometry is final.
//
// Steps 1 and 3 are idempotent and deterministic in (seed, number), like the
// geometry itself. A module supplies all three as data rows in floor_gen.cpp's
// dispatch tables — never a branch.
void floor_declare_rules(World& world, int number, const FloorSpec& spec,
                         unsigned seed);

void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed);

void floor_apply_rules(World& world, int number, const FloorSpec& spec,
                       unsigned seed);

// The X/Y room-lattice pitch this kind builds on, in macro cells. A "room" is the
// (stride-1)^2 interior between four wall lines; the wall lines themselves sit on
// every cell whose x or y is a multiple of the stride.
//
// Exported rather than copied because the mob spawner places packs BY ROOM and has
// to agree with the generator exactly. A duplicated stride table would keep
// compiling and start placing "rooms" straddling wall lines the day the module's
// geometry is retuned — a silent, seed-dependent drift.
int floor_room_stride(FloorKind kind);

// ---------------------------------------------------------------------------
// Gravity frame — the module's declared regime, and axis-generic ground queries
// ---------------------------------------------------------------------------
// The engine is ISOTROPIC (x/y/z equal citizens on the torus); gravity is the
// one emergent asymmetry, and it is the MODULE's to declare ([world/gravity.h]
// GravityRegime — 8 values, one of which is Zero). Every consumer that puts a
// body or a crate "on the ground" goes through these instead of naming an axis.
GravityRegime floor_gravity_regime();

// The standing coordinate along the gravity axis (the module's ground storey).
// Meaningless under Zero (any air cell is ground) — callers branch on regime.
int floor_ground_coord();

// A standing cell: air, with solid one cell toward -g. Under Zero every air
// cell qualifies. Wraps on all axes. Reads the WORLD's live regime
// (world.gravity().regime — runtime state the game may flip mid-run), never the
// module's generation-time constant.
bool floor_standable(const World& w, int x, int y, int z);

// Compose a cell from two TANGENT coordinates (the two non-gravity axes in
// x,y,z order) and a HEIGHT coordinate `h` along the gravity axis. No storey is
// special: spawn draws h over the whole axis and filters with floor_standable —
// the torus has no privileged coordinate.
void floor_cell(const World& w, int u, int v, int h, int& x, int& y, int& z);

// floor_cell at the module's default ground coordinate — the ARRIVAL storey
// (elevator pads), not a spawn privilege.
void floor_ground_cell(const World& w, int u, int v, int& x, int& y, int& z);

// Legacy projection: the ground coordinate, valid while the registered module's
// regime is +-Z. Prefer the frame helpers above in new code.
int floor_ground_z();

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

// One opening this generator punches through an interior wall — the cell a DOOR
// occupies ([door.h]). Positions are macro cells, so a byte each.
//
// `axis` says which wall line the opening is IN, which is the only thing a
// consumer cannot re-derive from the cell alone once the wall has decayed:
//   0 -> the wall line x == cx, so the jambs are at (cx, cy+-1)
//   1 -> the wall line y == cy, so the jambs are at (cx+-1, cy)
struct Doorway {
    std::uint16_t cx = 0;   // opening cell, X
    std::uint16_t cy = 0;   // opening cell, Y
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
