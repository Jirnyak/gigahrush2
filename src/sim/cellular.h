// Cellular rules — the automata that make a floor evolve on its own.
//
// ONE substrate, THREE rules, one slow clock. The substrate is a per-layer
// `std::uint8_t` field over the macro grid ([world/field.h]); a rule is a
// neighbourhood plus a transition over that field. This is deliberately not three
// subsystems: a sandpile, a Conway variant and a spreading contamination are the same
// shape — a bounded, double-buffered, order-independent update over a dense byte
// field on a cadence measured in sim ticks — and [sim/diffusion.h] already proved that
// shape carries its weight here.
//
// WHAT IS *NOT* HERE, because it already exists and duplicating it would be the
// expensive mistake:
//   * [sim/diffusion.h] — the CONSERVING relaxation (discrete Laplacian + evaporation)
//     over a float field, with no-flux walls. That is the reference's danger_field.ts,
//     complete. `Creep` below is deliberately a DIFFERENT rule: a monotone
//     max-minus-drop contagion, which spreads at a fixed one-cell-per-sweep front at
//     full strength instead of averaging itself away. A creep front reaches a doorway
//     and comes through it; a diffused field arrives there at 1/6^n of its source
//     level. Wanting both is not redundancy.
//   * [sim/fluid.h] — gravity-driven mass transport. Not an automaton over a scalar
//     potential; it has a preferred direction and a per-cell capacity.
//
// THE THREE RULES, each ported from a named reference system:
//
//   * `Sandpile` — the abelian sandpile (Bak-Tang-Wiesenfeld). The byte is a GRAIN
//     COUNT, read as structural stress in a slab. A cell holding >= `topple` grains
//     sheds exactly `topple` of them, one into each of its 6 face neighbours.
//     REFERENCE: sandpile_perekrytie.ts, which runs the same rule 2-dimensionally at
//     threshold 4 — but only ONCE, at generation, to bake a static `stress` map it then
//     reads for the rest of the floor's life. Here it runs live at threshold 6 over the
//     3D torus, so stress travels DOWN through the building as well as across a slab,
//     which is what a khrushchevka's перекрытие actually does. That divergence is
//     affordable for exactly the reason [master_prompt.md] gives for the macro tick:
//     the browser could not pay for it and this engine can.
//   * `Life` — Conway B3/S23, verbatim, per horizontal storey: 8-neighbour Moore in the
//     XY plane, toroidal in x and y, and NO coupling between z planes.
//     REFERENCE: conway_life.ts (`nextLifeCell(alive, n) = n === 3 || (alive && n === 2)`
//     — the same expression, unchanged). Per-storey rather than 3D-26-neighbour is the
//     faithful choice, not a shortcut: the reference world is ONE 1024x1024 plane, its
//     arenas are room footprints, and B3/S23 in a 26-neighbourhood dies out in a few
//     generations. A storey plan IS the reference's plane.
//   * `Creep` — a bounded hazard that spreads by contact, fades, and can PULSE on and
//     off. REFERENCE: cell_hazards.ts (the pulse period / active window and the sticky
//     red slime) plus the integer FADE_RATE of danger_field.ts.
//
// AND THE THREE THAT ARE NOT RULES, stated so nobody looks for them here:
// living_tunnels.ts is a random-WALKER (O(roots), not O(cells) — an agent that carves
// and heals a trail, so it belongs with the mob/agent systems, not in a field sweep);
// swarm_nests.ts is an entity spawner with a child cap ([game/mob_spawn.h] territory);
// procedural_anomalies.ts is the reference's dispatcher, and the dispatch here is
// `CellularParams::rule` plus the driver below. The full gap table is in the lane
// report, not duplicated in a comment that would rot.
//
// COST AND MEMORY, at the real kMacroDim = 128, exact rather than rounded:
//   * 2,097,152 cells. One byte field = 2,097,152 B = 2.00 MiB — a QUARTER of the
//     8.00 MiB a float field costs, which is the whole reason the substrate is a byte.
//     A sandpile never exceeds 11 grains (proved below), Life is one bit, and a hazard
//     level is 0..255; none of them needs a mantissa.
//   * A CellularScratch holds the 2.00 MiB back buffer, the 256 KiB walkability bitset,
//     the 256 KiB writable-region bitset and the 4 KiB hot-group bitset:
//     2,097,152 + 262,144 + 262,144 + 4,096 = 2,625,536 B = 2.504 MiB.
//   * So ONE ruled field costs 2,097,152 + 2,625,536 = 4,722,688 B = 4.504 MiB
//     resident per layer. Against the 130 MiB [world/nav.h] already spends on flow
//     fields that is a 3.5% add, and against [sim/diffusion.h]'s 16.254 MiB it is 27.7%.
//     Two rules on one layer (stress AND creep) cost 9.008 MiB, because each rule owns
//     its own field and its own scratch.
//   * MEASURED figures are printed by `test_cellular_all` (tests/suite_cellular.inl)
//     and THOSE are the claim — not a sentence here. It prints a sparse and a saturated
//     ms/sweep for each rule, because the cost is data-dependent: a row whose whole
//     read neighbourhood is bitwise zero is PROVED to be zero rather than computed
//     ([sim/cellular.cpp] PASS 1), and a source-driven floor is almost entirely quiet.
//   * ONE HONEST WARNING that the measurement makes unavoidable: `Life` seeded from a
//     real floor's geometry is the SATURATED case permanently. Its live-cell count is
//     the floor's solid-cell count (~840k), so no row is ever skippable and the quiet
//     gate below never closes. Sandpile and Creep are source-driven and go quiet;
//     Life does not. That is why `CellularParams::window` exists and why the
//     reference confined its own Life to room-sized arenas plus one roaming
//     128x128 window rather than running it on the whole world.
//
// DETERMINISM is structural, not tested-in. Every rule reads one buffer and writes the
// other, so the result cannot depend on visitation order, and every rule is integer
// arithmetic — no float, so no reassociation and no fast-math exposure at all. Two
// worlds seeded identically produce bit-identical fields for any number of sweeps;
// `cellular_digest` gives a caller an FNV-1a fold to compare or print, which is the
// same discipline `suite_macrosim` pins the pool columns with.
//
// TOROIDAL ON x/y/z, and W is the axis that does not wrap. Field::at and
// MacroGrid::mask apply wrap_macro to all three unconditionally, so this file could
// not opt out of the z wrap if it wanted to. W isolation is structural: every entry
// point takes ONE World, and a World IS one layer, so nothing here can reach another
// floor.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "core/tick.h"         // kSimHz — the cadence is stated in sim ticks
#include "world/level_stack.h" // LayerId, kInvalidLayer — the driver's floor token
#include "world/materials.h"   // kMatConcrete — the default material a Life cell grows as
#include "world/world.h"       // World, MacroGrid
#include "core/aligned_allocator.h"

namespace giga {

// ---------------------------------------------------------------------------
// Field names. One definition each, for the reason [sim/fluid.h] paid to learn: the
// same string literal typed at four call sites is one rename away from a world that is
// silently inert, and nothing would fail to compile.
// ---------------------------------------------------------------------------
inline constexpr const char* kStressField = "stress"; // Sandpile
inline constexpr const char* kLifeField = "life";     // Life
inline constexpr const char* kCreepField = "creep";   // Creep

enum class CellularRule : std::uint8_t {
    Sandpile = 0, // grains; 6-face; gated on walkability
    Life = 1,     // 0/1; 8-Moore per storey; gated on the writable region
    Creep = 2,    // 0..255 hazard; 6-face; gated on walkability
};

// The field a rule uses when the caller does not name one. Resolving this INSIDE
// cellular_step is what stops "I ran Life over the stress field" from being a
// one-character mistake with no compiler diagnostic.
inline const char* cellular_field_for(CellularRule rule) {
    switch (rule) {
        case CellularRule::Life: return kLifeField;
        case CellularRule::Creep: return kCreepField;
        case CellularRule::Sandpile: break;
    }
    return kStressField;
}

// --- Sandpile constants -----------------------------------------------------
//
// 6 because the neighbourhood is the 6 faces: shedding one grain per face is what makes
// the rule ABELIAN (the stable configuration is independent of toppling order), which
// is in turn what lets the sweep be synchronous and therefore order-independent.
inline constexpr std::uint8_t kSandpileTopple = 6;

// THE BOUND, proved rather than hoped, because it is what makes a byte field safe:
// a cell at height h gains at most 6 (one per toppling face neighbour) and loses
// exactly 6 if h >= 6.
//   * h >= 6  ->  h' = h - 6 + gain <= h. Never increases. No overflow, at any h.
//   * h <  6  ->  h' = h + gain <= 5 + 6 = 11.
// So after one sweep every cell is <= max(seeded height, 11), and every cell above 11
// is non-increasing. A uint8 therefore cannot wrap, and the field cannot grow without
// bound however long it runs. `test_cellular_all` asserts exactly this.
//
// THE PROOF IS THRESHOLD-DEPENDENT, and stating the condition is the difference between
// a proof and a slogan: the second line generalises to h' <= (topple - 1) + 6, which
// exceeds 255 once `topple` passes 250. [sim/cellular.cpp] therefore CLAMPS
// CellularParams::topple to 250, which is what makes the unconditional "cannot wrap"
// above true rather than true-at-the-default.
inline constexpr std::uint8_t kSandpileSteadyPeak = kSandpileTopple + 5; // 11

// The largest threshold at which the byte field is provably wrap-free (see above). Not a
// tunable — a bound the sweep enforces by clamping.
inline constexpr std::uint8_t kSandpileMaxTopple = 250;

// --- Cadence ----------------------------------------------------------------
//
// Sim ticks between sweeps. 25 at kSimHz = 125 is exactly 5 sweeps/s, and the
// static_assert is what keeps "sweeps per second" an integer rather than a drifting
// approximation.
//
// DIVERGENCE, stated rather than buried. The reference runs conway_life.ts at 0.75 s
// (1.33/s), cell_hazards.ts NPC scans at 0.25 s (4/s) and danger_field.ts at 0.5 s
// (2/s). 125 has only the divisors 1, 5, 25 and 125, so none of those three exists on
// this tick; 5/s is the nearest divisor that keeps the cadence integral and it is the
// same one [sim/diffusion.h] chose for the same reason. A Life generation every 200 ms
// is FASTER than the reference's 750 ms, which matters: it is 3.75x the geometry churn
// per second if `topology` is on. `CellularDriver::everySweeps` divides it back down
// without leaving the integral cadence.
inline constexpr int kCellularSweepTicks = 25;
inline constexpr int kCellularSweepsPerSec = kSimHz / kCellularSweepTicks;
static_assert(kCellularSweepsPerSec * kCellularSweepTicks == kSimHz,
              "the sweep cadence must divide the tick rate exactly, or every rate "
              "quoted in this file is approximate and drifts with the tick");

// A rectangular region of the macro grid, in cells. The Life rule needs one and the
// other two accept one, for a reason the reference already discovered: conway_life.ts
// confines Life to room-footprint arenas plus ONE roaming 128x128 window out of a
// 1024x1024 world (1.6% of it), and shifts that window every 60 s. Life over a whole
// floor is not a bigger version of that — it is a permanently saturated sweep whose
// quiet gate never closes and whose topology churn never settles.
//
// Sizes are clamped into [1, kMacroDim] and the origin is wrapped, so a window may
// straddle the torus seam.
struct CellularWindow {
    int x = 0, y = 0, z = 0;
    int w = kMacroDim, h = kMacroDim, d = kMacroDim;

    bool whole_world() const {
        return w >= kMacroDim && h >= kMacroDim && d >= kMacroDim;
    }
};

// A deterministically placed window of the given size, from a seed and a shift token.
// This is conway_life.ts's `selectFieldWindow` — same idea, no wall clock: the token is
// whatever monotonic counter the caller has (sweeps / kCellularSweepsPerSec / 60 gives
// the reference's 60 s shift exactly), so the same (seed, token) always yields the same
// window on every host and every run.
CellularWindow cellular_window_at(std::uint32_t seed, std::uint32_t token, int w, int h,
                                  int d);

struct CellularParams {
    CellularRule rule = CellularRule::Sandpile;

    // Empty means "use cellular_field_for(rule)". Set it only to run two instances of
    // one rule on one layer.
    std::string field;

    // --- Sandpile ---
    // Clamped into [1, kSandpileMaxTopple] by the sweep; see kSandpileSteadyPeak for why
    // the upper end is a bound and not a preference.
    std::uint8_t topple = kSandpileTopple;
    // Stress at which the SLAB UNDER an open cell lets go, when `topology` is on. The
    // reference turns a FLOOR cell into ABYSS; in 3D the equivalent is clearing the
    // solid cell at z-1, which opens a real hole to the storey below. Above
    // kSandpileSteadyPeak = 11 nothing can ever reach it, so 10 is the top usable
    // value and 0 disables collapse.
    std::uint8_t collapseAt = 10;

    // --- Creep ---
    std::uint8_t decay = 2;      // subtracted every sweep (danger_field.ts FADE_RATE)
    std::uint8_t spreadFrom = 24; // a cell at or above this infects its open neighbours
    std::uint8_t spreadDrop = 8;  // how much weaker the infection lands
    // Pulse, in SWEEPS not seconds (cell_hazards.ts pulsePeriodSeconds /
    // pulseActiveSeconds). 0 period = always active. The pulse gates the hazard's
    // EFFECT, never the sweep: a hazard that stopped decaying while inactive would
    // never expire.
    std::uint32_t pulsePeriodSweeps = 0;
    std::uint32_t pulseActiveSweeps = 0;

    // --- Topology (all rules; only Sandpile and Life have an effect) ---
    // False = the field evolves and nothing else changes; the field is then a pure
    // read for a consumer (stress under your feet, hazard on the floor, living
    // concrete for the render). True = the sweep also writes world.grid():
    //   * Life  — alive becomes a solid cell of `material`, dead becomes air. This is
    //             the reference's живой бетон and it is the whole point of the rule.
    //   * Sandpile — a cell at `collapseAt` clears the SOLID cell below it and its own
    //             grains fall through (counted in CellularStep::absorbed, so
    //             conservation stays exact).
    // Only cells in the writable bitset are ever flipped, so the nav lattice columns
    // are safe by construction — see cellular_refresh_geometry.
    bool topology = false;
    CellType material = kMatConcrete;

    // The region the rules may run in. Life is gated on it (cells outside are FROZEN
    // and still count as neighbours, exactly as conway_life.ts's mask cells do);
    // Sandpile and Creep run everywhere and only their TOPOLOGY writes are gated.
    CellularWindow window;

    // Keep-out sphere, in CELLS, re-read every sweep rather than baked: a topology flip
    // inside it is suppressed and the cell is held at the grid's current solidity.
    // conway_life.ts protects a 2.25-cell radius around the player so the automaton
    // cannot wall a body in; living_tunnels.ts does the same at 1.35. Negative radius
    // = no keep-out. Costs O(flips), not O(cells): only a cell that would actually
    // change is tested.
    int keepOutX = 0, keepOutY = 0, keepOutZ = 0;
    int keepOutR = -1;
};

// What one sweep did. Every member is an OBSERVATION, so a caller can tell "this layer
// has no such field" from "the field exists and has gone quiet" without re-scanning
// 2,097,152 cells — the same reason FluidStep and DiffusionStep are not `void`.
struct CellularStep {
    bool present = false; // the field existed; false = nothing to sweep, nothing done
    CellularRule rule = CellularRule::Sandpile;

    // Summed byte value AFTER the sweep. uint64 because 2,097,152 cells x 255 is
    // 534,773,760 — it fits in uint32, but a caller accumulating totals across sweeps
    // does not, and an exact integer total is the whole basis of the conservation
    // assertion, so it is not worth being clever about.
    std::uint64_t total = 0;
    std::uint32_t liveCells = 0; // cells > 0 after the sweep
    std::uint8_t peak = 0;       // largest byte after the sweep — the boundedness proof

    // OPEN cells (popcount of the walkability bitset) and WRITABLE cells (popcount of
    // the region bitset). Reported rather than assumed because a solid cell costs one
    // store while an open cell costs a neighbourhood, so "ms per sweep" is
    // uninterpretable without the denominator — and because a test can assert them
    // against an independent popcount, which a wall-clock figure can never be.
    //
    // NOT counts of executed arithmetic. A row whose whole read neighbourhood is
    // bitwise zero is proved to be zero instead of computed, so these are the cells the
    // sweep is RESPONSIBLE for, never the cells it touched. Anything that wants real
    // executed work must time the saturated case.
    std::uint32_t openCells = 0;
    std::uint32_t writableCells = 0;

    // Grid solidity flips applied this sweep (0 unless params.topology). A caller that
    // sees changes > 0 owes the world two things — see cellular_tick.
    std::uint32_t changes = 0;

    // Sandpile only: grains destroyed this sweep, at the ONE documented sink — a grain
    // toppled toward a solid neighbour is absorbed by the concrete, plus the grains
    // that fall through a collapse. total + (sum of absorbed over all sweeps) is
    // EXACTLY the total ever added. There is no other loss and no other gain.
    //
    // THE SCOPE OF THAT "EXACTLY", because an unqualified conservation claim is the kind
    // a test can be made to pass and a real floor can still break. It holds for every
    // grain that entered through `cellular_add`, which refuses to store anything inside
    // solid rock. It does NOT hold for state written INTO a solid cell by hand — a
    // `Field::fill` or a direct `Field::at` on a wall — because the sweep zeroes a solid
    // cell's whole 64-cell group with one memset and only the WHOLLY solid group counts
    // what it erased. A partially solid group's walls are cleared silently. That is a
    // deliberate trade (the alternative is a per-cell test in the hot loop for a state no
    // sanctioned producer can create), and it is why the cost block in
    // tests/suite_cellular.inl saturates with `fill` and then does NOT assert
    // conservation, while the conservation block deposits only through cellular_add.
    std::uint32_t absorbed = 0;

    // Life only: 0 -> 1 and 1 -> 0 transitions in the field this sweep. `born + died`
    // is the churn, and it going to 0 means the automaton has reached a still life —
    // which is the one state in which Life is done evolving and the driver may sleep.
    std::uint32_t born = 0;
    std::uint32_t died = 0;
};

// Reused scratch, one per (World, rule) the caller sweeps. This is a deliberate API
// cost — one object at the call site — bought for four things the naive form pays for
// on every single sweep:
//
//   1. THE BACK BUFFER. 2.00 MiB, allocated once and never pre-zeroed (every cell in a
//      swept row is assigned and every skipped row is memset). The naive form allocates
//      and zero-fills it 5 times a second, forever, for a buffer whose contents are
//      entirely overwritten.
//   2. THE WALKABILITY BITSET. Walkability is `!MacroGrid::mask(x,y,z).full()`, and a
//      SubMask is 8 x uint64 = 64 B/cell, so the mask array is 128 MiB. A 6-face sweep
//      asks the question 7 times per cell = 14,680,064 scattered probes, and the +-z
//      probes land 64 KiB apart in that 128 MiB. One bit per cell instead is 256 KiB,
//      which is L2-resident on any target machine. Same answer, ~500x less memory in
//      play. [sim/diffusion.h] measures the same trade.
//   3. THE WRITABLE BITSET, 256 KiB — the region a topology rule may flip, with the
//      nav lattice columns punched OUT of it. This is not an optimisation; it is the
//      safety property. Without it a Life sweep can wall up a lift shaft.
//   4. THE HOT-GROUP BITSET, 4 KiB — one bit per 64-cell run, rebuilt from the field at
//      the top of EVERY sweep. It is what makes a quiet floor nearly free, and being
//      derived inside the sweep is exactly what makes it hazard-free: unlike `open` it
//      has no stale case, so no caller has to remember anything about it.
//
// Geometry is static between bakes ([performance.md] §Two regimes), so `open` and
// `writable` are built at those boundaries and read on every sweep — the same
// bake-once / read-O(1) shape as nav.
struct CellularScratch {
    std::vector<std::uint8_t, AlignedAllocator<std::uint8_t, 64>> back;      // 2.00 MiB
    std::vector<std::uint64_t, AlignedAllocator<std::uint64_t, 64>> open;     // 256 KiB; 1 = cell is not fully solid
    std::vector<std::uint64_t, AlignedAllocator<std::uint64_t, 64>> writable; // 256 KiB; 1 = a topology rule may flip it
    std::vector<std::uint64_t, AlignedAllocator<std::uint64_t, 64>> hotGroups; // 4 KiB; pure scratch, rewritten per sweep

    // Set when geometry moved and the two bitsets have not caught up. The next sweep
    // rebuilds instead of spreading through a wall that now exists. This is the blunt
    // valve; cellular_mark_cell is the cheap one.
    bool geomDirty = false;

    bool ready() const { return !open.empty() && !writable.empty(); }
};

// (Re)build BOTH bitsets from `grid` and the params' window, and clear `geomDirty`.
// One call rather than two, because doing half of it is a bug both ways round: a stale
// walkability bitset spreads a hazard through a wall, and a stale writable bitset lets
// a topology rule flip a cell in a lift shaft.
//
// WHAT IS PUNCHED OUT OF `writable`, and why it is not negotiable: the 4x4x4 nav
// lattice ([world/lattice.h]) is carved as a full-height shaft at each of its 16
// distinct (x,y) node positions, and those shafts are what guarantee VERTICAL
// connectivity on every floor kind including a half-collapsed Derelict
// ([master_prompt.md] §7 #11 increment A). A 3x3 column around each of the 16
// positions, through all 128 z, is therefore excluded — 16 x 9 x 128 = 18,432 cells,
// 0.88% of the world. Horizontal connectivity is NOT guaranteed and never was; the
// coarse graph correctly reports kUnreachable when a floor lacks it, which is sound
// for nav.
//
// One pass over the 128 MiB mask array; the measured cost is printed by
// test_cellular_all. It is bake-time work, not tick-time, and it is idempotent.
void cellular_refresh_geometry(const MacroGrid& grid, CellularScratch& scratch,
                               const CellularWindow& window = {});

// O(1) patch of ONE cell's walkability bit — the sanctioned "dirty local re-bake"
// ([performance.md] §Two regimes) for a caller that knows exactly which cell moved.
// [game/door.cpp] is the live case: it fills and clears a door's column on every open
// and every break, which is a geometry mutation on the tick that a 128 MiB rebuild is
// far too expensive to answer. The writable bit is left alone — region membership is a
// property of the window and the lattice, not of what is currently solid.
//
// No-op while nothing has been built; the next sweep builds both bitsets anyway.
void cellular_mark_cell(const MacroGrid& grid, CellularScratch& scratch, int x, int y,
                        int z);

// "Geometry moved and I do not cheaply know where." The next sweep rebuilds both
// bitsets. Cheap and idempotent, so a caller may set it every tick; the cost is paid at
// most once per cadence rather than once per mutation.
inline void cellular_mark_geometry_dirty(CellularScratch& scratch) {
    scratch.geomDirty = true;
}

// Everything a layer needs when its geometry has just been (re)built: rebuild both
// bitsets from the new grid AND zero the field. ONE call, because doing half of it is a
// bug both ways round.
//
// The second half is not tidiness. A LevelStack slot is RECYCLED
// ([game/floor_stream.cpp] free_slot / alloc_slot), `generate_floor` clears the GRID
// but not the World's FieldRegistry, and fields are never removed from a registry
// ([world/field.h]). So floor N's stress survives into floor N+2 unless someone zeroes
// it — the same class of bug [sim/diffusion.h] documents for the danger field and
// seed_floor_sumps guards against for fluid.
//
// Zeroes in place rather than creating: a layer with no field keeps not having one.
void cellular_on_floor_built(World& world, CellularScratch& scratch,
                             const CellularParams& params = {});

// Seed the Life field from the grid: 1 where the cell is fully solid, 0 elsewhere.
// THE ENTRY POINT FOR LIFE, and it must be called at every geometry boundary, because
// Life's field IS a copy of solidity and the sweep never re-reads the grid.
//
// That is a real contract with a real failure mode, so it is stated rather than
// implied: between boundaries, cells outside the writable region are FROZEN at their
// last-seeded value. If [game/door.cpp] shuts a door outside the region, Life keeps
// counting that cell as it was until the next seed. The alternative — re-reading 128
// MiB of masks every sweep — is the cost this whole file exists to avoid, and the
// reference made exactly the same trade (`selectFieldWindow` snapshots `world.cells`
// into `field.current` once per window and never re-reads it).
//
// Creates the field if this layer has none: unlike a source-driven rule, Life with an
// empty field is dead everywhere and would never start.
void cellular_seed_from_grid(World& world, CellularScratch& scratch,
                             const CellularParams& params = {});

// Add `amount` at a cell, saturating at 255, CREATING the field zero-filled if this
// layer has none. Returns the level after the add (0 when the source was refused).
//
// This is the only entry point that creates a Sandpile/Creep field, and that is the
// point: cellular_step is NON-creating, so a layer nobody has stressed costs one hash
// lookup per sweep instead of a 2.00 MiB allocation and a sweep over 2,097,152
// guaranteed-zero cells. [sim/fluid.h] documents having made exactly that mistake with
// get_or_create and having had to undo it.
//
// A source dropped inside solid rock is REFUSED rather than stored, because the sweep
// pins solid cells to 0 and the level would vanish on the next sweep anyway — better
// never counted than reported as mass that cannot exist. Coordinates are wrapped.
std::uint8_t cellular_add(World& world, int x, int y, int z, std::uint8_t amount,
                          const CellularParams& params = {});

// Level at a cell, toroidally indexed; 0 when this layer has no such field. The read a
// consumer wants when it has a World and not a Field, and it exists so the const_cast
// around FieldRegistry::find (non-const only because it hands back a MUTABLE Field)
// sits in one place. One call is one string hash, so resolve the Field once for a loop.
std::uint8_t cellular_at(const World& world, int x, int y, int z,
                         const CellularParams& params = {});

// Is a Creep hazard's EFFECT live right now? Pure function of the sweep counter, so it
// costs no per-cell state at all — cell_hazards.ts stores `pulseActive` per site and
// rebuilds a cell index on every transition; this stores nothing and rebuilds nothing.
// Period 0 means always active.
bool cellular_pulse_active(const CellularParams& params, std::uint64_t sweep);

// Advance the named field one deterministic sweep over `world`.
//
// Reads the whole field from one buffer and writes the next into the other, so the
// result is independent of visitation order and therefore bit-identical across runs,
// platforms and any future parallel split ([ARCHITECTURE.md] §Determinism).
//
// If the scratch is unbuilt, or `geomDirty` is set, this rebuilds both bitsets from
// world.grid() first. `scratch` should be the same object every sweep or reason 1 above
// is thrown away.
//
// THE QUIET GATE, which is what makes this affordable at all. The return value is a
// complete answer to "is there any point sweeping again":
//   * `present == false` — this layer has no such field, because nothing ever called
//     cellular_add or cellular_seed_from_grid on it. The call cost one string hash.
//   * `liveCells == 0` — the field exists and has fully evaporated. Nothing can change
//     until the next deposit, so a caller should STOP and resume when it next deposits.
//   * For Life, `born + died == 0` — a still life. The field is not empty but it is
//     provably static, so sweeping it again cannot change one cell.
// A caller that ignores all three still gets correct results, just at full price.
CellularStep cellular_step(World& world, CellularScratch& scratch,
                           const CellularParams& params = {});

// Scratchless overload for one-off callers and tests: allocates a CellularScratch,
// sweeps once, and drops it. Bit-identical to the scratch form — same code path — so it
// costs the 2.00 MiB back buffer plus a full 128 MiB bitset rebuild EVERY call.
// Correct anywhere, affordable only where the cadence is "once".
CellularStep cellular_step(World& world, const CellularParams& params = {});

// FNV-1a 64 over the whole field, in flat index order; 0 when the layer has no such
// field. The cheap way to compare two runs bit-for-bit without holding two 2.00 MiB
// copies, and the same digest discipline `suite_macrosim` pins the pool columns with.
// Not a checksum for storage — a fold for equality, and it is stable because the fold
// order is the flat index order.
std::uint64_t cellular_digest(const World& world, const CellularParams& params = {});

// ---------------------------------------------------------------------------
// The driver: everything a fixed-step loop needs in order to actually RUN this.
// ---------------------------------------------------------------------------
//
// This is the object that turns three solvers into a system, and it exists because the
// four things below are exactly the things a call site gets wrong:
//
//   1. THE CADENCE. A saturated sweep is a measurable fraction of the whole 8 ms step,
//      so it cannot go per tick.
//   2. THE FLOOR TOKEN. `scratch.open` is walkability for ONE World. The camera rides
//      an elevator, the active layer changes, and a sweep against the bitset of the
//      floor you left spreads through walls that exist and stops at doorways that do
//      not.
//   3. THE QUIET GATE. Without it, a floor nobody has stressed pays a sweep every
//      200 ms forever. With it, it pays nothing at all — the sweep is not called.
//   4. THE TOPOLOGY DEBT. A sweep that flipped a cell's solidity has invalidated
//      other people's caches, and `changes` is the only place a caller learns that.
struct CellularDriver {
    CellularScratch scratch;
    CellularParams params;

    // Which layer the bitsets were built from. kInvalidLayer means "never built", so
    // the first tick rebuilds whatever it is handed.
    LayerId layer = kInvalidLayer;

    // The quiet gate, armed by a deposit and disarmed by a sweep that found nothing
    // left to do. False means the field is provably static: it does not exist, or it
    // has emptied, or (Life) it has reached a still life. In all three cases no sweep
    // can change a single cell.
    bool hot = false;

    // Divide the 5/s cadence down further, in whole sweeps, without leaving the
    // integral cadence: 1 = 5 sweeps/s, 5 = 1/s, 25 = one every 5 s. The reference's
    // conway_life.ts runs at 1.33/s, between 1 and 2 here; `everySweeps = 4` gives
    // 1.25/s, which is the closest this tick can express.
    std::uint32_t everySweeps = 1;

    std::uint64_t sweeps = 0;   // cellular_step calls made, for a HUD or a test
    std::uint64_t deposits = 0; // sources that TOOK (one refused inside rock is not one)
    std::uint64_t changes = 0;  // cumulative grid flips, so a HUD can show the churn
    CellularStep last{};        // the most recent sweep's report; zeroed until the first
};

// Arm the gate by hand. Needed only by a producer that deposits through the bare
// cellular_add rather than through cellular_driver_add — and that is the one footgun
// this design has, so it is named instead of hidden: deposit behind the driver's back
// while the floor is quiet and the state sits there, correct and frozen, until
// something else happens to arm it.
inline void cellular_arm(CellularDriver& driver) { driver.hot = true; }

// Deposit through the driver: cellular_add, plus arming the gate so the next cadence
// tick resumes sweeping. THE entry point for a producer — a load-bearing wall taking a
// hit, a ruptured pipe, a spreading infection. A refused source arms nothing, because
// waking a whole sweep to rediscover that the floor is still quiet is the one cost the
// gate exists to avoid.
std::uint8_t cellular_driver_add(CellularDriver& driver, World& world, int x, int y,
                                 int z, std::uint8_t amount);

// Call at EVERY floor entry, next to the nav bake, for the reason spelled out on
// cellular_on_floor_built: a LevelStack slot is recycled, generate_floor clears the
// grid but not the FieldRegistry, so floor N's state is still sitting in floor N+2's
// cells. Rebuilds both bitsets from the new geometry, zeroes the field, re-parks the
// gate, and — for the Life rule ONLY — re-seeds the field from the new grid and arms
// the gate, because Life with a zeroed field is dead everywhere and would never start.
//
// This is the CONTRACT; the layer-id comparison inside cellular_tick is only a
// backstop. It cannot cover the recycled-slot case, because a recycled slot hands back
// the same LayerId with different geometry and the comparison sees nothing wrong.
void cellular_driver_on_floor_built(CellularDriver& driver, World& world, LayerId layer);

// Call EVERY sim tick with the layer the sim is currently stepping. Returns true if
// cellular_step was CALLED — deliberately not quite "a sweep ran": a layer change
// forces one call so `last` describes the floor we are on, and on a floor with no field
// that call takes the non-creating early-out and touches no cell.
//
// Named _tick rather than _step, breaking the `*_step` convention ([AGENTS.md] §ECS
// Conventions) on purpose: cellular_step is already the SWEEP, and one function called
// every 8 ms wrapping another called every 200 ms must not share a name with it.
//
// `simTick` is the caller's own counter, used only modulo the cadence, so any
// monotonically increasing per-step counter works.
//
// WHAT THE CALLER STILL OWES, when `driver.last.changes > 0` — this is the part that
// cannot live in here, because giga_core must not know about the renderer or about
// another system's scratch:
//   * `diffusion_mark_geometry_dirty(diffusionDriver.scratch)` — the danger field's own
//     walkability bitset just went stale. Blunt valve, idempotent, one bool.
//   * `cubePass.invalidate()` — the render caches its instance list ([render/cube_pass.h])
//     and a flipped cell is a changed pixel it will otherwise never redraw.
//   * NOTHING for nav. The baked flow fields go stale and stay stale until the next full
//     bake at floor load, which is exactly the accept-stale regime
//     ([performance.md] §Two regimes) — a nav re-bake is 64 BFS and cannot run on a tick.
bool cellular_tick(CellularDriver& driver, World& world, LayerId layer,
                   std::uint64_t simTick);

} // namespace giga
