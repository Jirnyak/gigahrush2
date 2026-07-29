// Diffusion fields — danger / scent / blood that spreads and fades.
//
// A scalar float field over the macro grid, advanced by a deterministic
// double-buffered sweep: each OPEN cell relaxes toward its OPEN neighbours (the
// discrete heat equation) and a fraction evaporates every sweep. So a source —
// spilled blood, a gunshot, a fear pheromone — bleeds outward through the walkable
// void and dies away, and an agent gets a GRADIENT to flee up or seek down with no
// search of any kind. It is the sibling of [sim/fluid.h]: same field substrate, same
// double-buffered determinism, relaxation + decay instead of gravity + mass
// conservation.
//
// Three unrelated things are called "danger" in this tree and conflating them is the
// mistake this comment exists to prevent:
//   * THIS field — dynamic, spatial, runtime. Spreads, fades, has no goal.
//   * The baked flow fields ([world/nav.h]) — static shortest-path routing. Diffusion
//     is emphatically NOT pathfinding.
//   * FloorSpec::hostility ([game/floor_spec.h]) — an authored designer constant that
//     scales mob spawn count and tier. Nothing to do with either field.
//
// COST, at the real kMacroDim = 128 (all figures exact, not rounded):
//   * 2,097,152 cells. One float field = 8,388,608 B = 8.00 MiB.
//   * The reused back buffer is another 8.00 MiB and the walkability bitset 256 KiB,
//     so one diffused field costs 16.25 MiB resident per layer. Against the 128 MiB
//     [world/nav.h] already spends on flow fields that is a 12.7% add.
//   * A sweep touches 8 MiB in + 8 MiB out and ~42 M arithmetic ops, so it is
//     memory-bound. The measured number is printed by `test_diffusion_all`
//     (tests/suite_diffusion.inl) on a real Residential floor, and THAT number — not
//     a sentence here — is the claim.
//   * MEASURED, and it is worse than this file used to guess: EIGHT runs across two
//     sessions on 2026-07-29 (MSVC 19.44 /O2 /GL, linked /LTCG, Windows dev host, real
//     Residential floor, 59.8% of cells open) span 18.42-43.67 ms/sweep, 14.69-34.83 ns
//     per open cell, and a bitset bake of 10.97-37.33 ms.
//     DO NOT NARROW THAT BAND. An earlier draft of this comment claimed
//     "18.42-24.64 ms/sweep over three runs" while the same session had already
//     measured 27.09, and a review pass then measured 27.29, 27.56 and 43.67 from the
//     same binary. The honest figure is a 2.4x band; a single number here would be a
//     number about the box.
//     The open-cell count is bit-deterministic at 1,253,822 of 2,097,152 across every
//     one of the eight runs, which is what makes the ns/cell figure comparable at all.
//     AND THE SPREAD IS LOAD, NOT CODE: the SAME binary measured 74.79 ms/sweep
//     (59.65 ns/open cell, bake 190 ms) on one run while the host was under an
//     eight-way parallel build. A 4x swing with an identical instruction stream is why
//     test_diffusion_all asserts work counts and merely PRINTS milliseconds — a
//     wall-clock threshold here would be a test of the box. Every figure above was
//     taken on a host running that wave, so all of them are an UPPER bound: no
//     quiet-host measurement of this loop exists yet.
//     ONE TRAP for whoever measures next, because it cost a wrong headline: the release
//     flags here carry /GL, and linking those objects WITHOUT /LTCG makes the linker
//     discard the IL and fall back to per-object codegen. The identical sweep measured
//     40.74 ms that way — 1.8x slow, with no warning louder than LNK4075. A timing run
//     that skips /LTCG is measuring the link, not the loop.
//     That is 2-5x a WHOLE 8 ms sim step, so a sweep is not something to drop on the
//     sim thread and forget. Two consequences, both load-bearing: the sweep is
//     non-creating and reports `liveCells`, so a caller sweeps only while the floor
//     actually holds danger (see diffusion_step and DiffusionDriver below); and the
//     eventual home for this is off the sim thread — the async pattern
//     [world/nav_async.h] already uses for the bake, or the GPU.
//
// WHERE IT RUNS. On a coarse cadence, not every sim tick: kDiffusionSweepTicks below.
// The sim tick is 125 Hz and one step is exactly 8 ms ([core/tick.h] — 125, not the
// 120 this file used to say; the integer-millisecond fix made kSimStepMs exactly 8).
// A sweep in the milliseconds therefore cannot go per-tick: it would be a large
// fraction of a whole step. Danger evolves on the order of seconds, so 5 sweeps/s is
// the cadence. As a cellular stencil this eventually belongs on the GPU as async
// compute ([performance.md] §The compute split, [fields.md]); this CPU implementation
// is then the deterministic reference that port must reproduce bit-for-bit.
//
// WHO CALLS IT: DiffusionDriver at the bottom of this header, which is what the app
// shell's fixed-step loop holds. That type exists because this file spent a long time
// being a correct solver nobody invoked — the cadence arithmetic, the "the camera
// changed floor so my walkability bitset describes the wrong world" invalidation and
// the quiet-floor gate are all things a call site would otherwise have to re-derive,
// and the one that re-derived them wrong would be silently sweeping a stale bitset.
//
// TOROIDAL ON ALL THREE AXES, and W is the axis that does not wrap. x/y/z wrap
// ([world.md]), and Field::at / MacroGrid::mask apply wrap_macro to all three
// unconditionally, so this file could not opt out of the z wrap even if it wanted to.
// That is correct rather than merely consistent: floor_gen sizes every storey to
// divide 128 precisely so "the top storey's ceiling is floor-0's slab", and that slab
// is a fully solid cell — so the no-flux wall below already seals the z seam wherever
// a floor has an intact ground slab. Storeys do not leak into each other because a
// `World` IS one layer: diffusion_step takes one World, so nothing it does can reach
// another floor. W isolation is structural, not asserted.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "core/math.h"         // giga::vec3
#include "core/tick.h"         // giga::kSimHz — the sweep cadence is stated in sim ticks
#include "world/field.h"       // giga::Field
#include "world/level_stack.h" // giga::LayerId, kInvalidLayer — the driver's floor token
#include "world/world.h"       // giga::World, MacroGrid

namespace giga {

// The field name every producer and consumer agrees on. ONE definition, because
// [sim/fluid.h] already paid for learning this: the same string literal typed at four
// call sites is one rename away from a world that is silently inert, and nothing would
// fail to compile.
inline constexpr const char* kDangerField = "danger";

// Levels below this are residue: clamped to 0 by the sweep, and to be treated as
// "nothing here" by every consumer. Named so "is this cell dangerous" cannot drift
// from the threshold the solver itself uses.
inline constexpr float kDiffusionMinLevel = 1e-4f;

// Explicit 6-neighbour diffusion is stable only while rate * 6 <= 1. Past that the
// checkerboard mode grows without bound and the field diverges instead of spreading.
// The engine has no exceptions ([AGENTS.md]) so a bad parameter cannot be rejected
// loudly — diffusion_step CLAMPS to this instead, which degrades a typo into
// slightly-slower spreading rather than into NaNs.
inline constexpr float kDiffusionMaxRate = 1.0f / 6.0f;

// Sim ticks between sweeps. 25 at kSimHz = 125 is exactly 5 sweeps/s, and the
// static_assert below is what keeps "sweeps per second" an integer — which is what
// makes the decay figures here exact rather than approximate. With decay = 0.02:
//   * half-life  ln(0.5)/ln(0.98)  = 34.3 sweeps =  6.9 s
//   * to residue ln(1e-4)/ln(0.98) =  456 sweeps = 91.2 s for an unspread unit source
// Spread, treating the sweep as a random walk with hop probability `rate` per face:
// variance per axis per sweep is 2*rate = 0.30 cell^2, so after 25 sweeps (5 s) the
// front's sigma is sqrt(7.5) = 2.7 cells = 5.5 m, and after 100 sweeps (20 s) it is
// 5.5 cells = 11 m, by which point the peak has decayed to 0.98^100 = 0.13.
//
// DIVERGENCE, stated rather than buried: [diffusion.md] cites the reference's
// danger_field.ts at ~2 sweeps/s. 125 has only the divisors 1, 5, 25 and 125, so an
// exact 2/s does not exist on this tick — 5/s is the nearest divisor that keeps the
// cadence integral, and the alternative (1/s) would advance the front at 2 m/s.
inline constexpr int kDiffusionSweepTicks = 25;
inline constexpr int kDiffusionSweepsPerSec = kSimHz / kDiffusionSweepTicks;
static_assert(kDiffusionSweepsPerSec * kDiffusionSweepTicks == kSimHz,
              "the sweep cadence must divide the tick rate exactly, or every decay "
              "figure above is approximate and drifts with the tick");

struct DiffusionParams {
    std::string field = kDangerField;    // which float field to diffuse
    float rate = 0.15f;                  // per-sweep coefficient; clamped to 1/6
    float decay = 0.02f;                 // fraction that evaporates per sweep
    float minLevel = kDiffusionMinLevel; // clamp residues below this to 0
};

// What one sweep did. Every member is an OBSERVATION, so a caller can distinguish
// "this layer has no danger field" from "the field exists and has gone quiet" without
// re-deriving either by scanning 2 M cells itself — the same reason [sim/fluid.h]
// returns FluidStep instead of void, and the reason a `void` return was not portable
// to a caller that has to decide whether to keep sweeping.
struct DiffusionStep {
    bool present = false;        // the field existed; false = nothing to diffuse
    float total = 0.0f;          // summed level AFTER the sweep
    std::uint32_t liveCells = 0; // cells >= minLevel after the sweep
    // Cells that took the OPEN branch and did the 6-neighbour arithmetic. This is the
    // sweep's WORK COUNT, and it is reported rather than assumed because a solid cell
    // costs one store while an open cell costs ~20 ops — "ms per sweep" is
    // uninterpretable without it. A test asserts this, never a wall-clock figure.
    std::uint32_t openCells = 0;
};

// Reused scratch for the sweep. The caller owns one per World it sweeps.
//
// This is a deliberate API cost — one object at the call site — bought for two
// reasons, both of which the naive form had:
//
//   1. THE BACK BUFFER. The naive step allocated `std::vector<float>
//      dst(kMacroCells, 0.0f)` inside itself: an 8.00 MiB allocation plus a
//      2,097,152-element zero-fill on EVERY sweep. At 5 sweeps/s that is 40 MiB/s of
//      allocate-touch-free churn for a buffer whose contents are entirely overwritten
//      anyway. Here it is allocated once and reused, and never pre-zeroed because
//      every cell is assigned.
//
//   2. THE WALKABILITY BITSET, which is the bigger win. Walkability is
//      `!MacroGrid::mask(x,y,z).full()`, and SubMask is 8 x uint64 = 64 B/cell, so the
//      mask array is 134,217,728 B = 128 MiB. A sweep asks the walkability question 7
//      times per cell (self + 6 neighbours) = 14,680,064 probes, and the +-1 z probes
//      land 64 KiB apart in that 128 MiB array — a scattered read per probe. One bit
//      per cell instead is 2,097,152 bits = 262,144 B = 256 KiB, which is L2-resident
//      on any target machine. Same answer, ~500x less memory in play.
//
// Geometry is static between bakes ([performance.md] §Two regimes: full re-bake at
// load and after self-assembly, never per tick), so the bitset is built at those
// boundaries and read on every sweep — the same bake-once/read-O(1) shape as nav.
struct DiffusionScratch {
    std::vector<float> back;         // 8.00 MiB, sized on first sweep, then reused
    std::vector<std::uint64_t> open; // 256 KiB walkability bitset, 1 = cell is open

    // Set when geometry moved and the bitset has not caught up. The next sweep
    // rebuilds instead of diffusing through a wall that now exists. This is the blunt
    // valve; diffusion_mark_cell is the cheap one.
    bool geomDirty = false;

    // True once `open` reflects a MacroGrid. A sweep with an empty bitset builds it
    // from the grid it was handed rather than silently treating the world as solid.
    bool walkable_ready() const { return !open.empty(); }
};

// (Re)build the walkability bitset from `grid`, and clear `geomDirty`. Call at every
// geometry boundary the nav bake is also called at — floor load, post-samosbor stitch,
// and after any dirty local re-bake — because a stale bitset diffuses danger through a
// wall that now exists, or holds it out of a doorway that was just blown open.
//
// One pass over the 128 MiB mask array; the measured cost is printed by
// test_diffusion_all. It is bake time, not tick time, and it is idempotent, so calling
// it twice costs time and nothing else.
void diffusion_refresh_walkable(const MacroGrid& grid, DiffusionScratch& scratch);

// O(1) patch of ONE cell's walkability bit — the sanctioned "dirty local re-bake"
// ([performance.md] §Two regimes) for a caller that knows exactly which cell moved.
// A door is the live case: [game/door.cpp] fill_cell/clear_cells a door's column on
// every open and every break, which is a geometry mutation on the tick that a full
// rebuild is far too expensive to answer. Coordinates are wrapped.
//
// No-op while the bitset has never been built — there is nothing to patch, and the
// next sweep builds the whole thing from the live grid anyway.
void diffusion_mark_cell(const MacroGrid& grid, DiffusionScratch& scratch, int x,
                         int y, int z);

// "Geometry moved and I do not cheaply know where." The next sweep rebuilds the whole
// bitset. Cheap to call and idempotent, so a caller may set it every tick; the cost is
// paid at most once per sweep cadence rather than once per mutation.
inline void diffusion_mark_geometry_dirty(DiffusionScratch& scratch) {
    scratch.geomDirty = true;
}

// Everything a layer needs when its geometry has just been (re)built: rebuild the
// walkability bitset from the new grid AND zero the field. ONE call, because doing
// half of it is a bug both ways round.
//
// The second half is not tidiness. A LevelStack slot is RECYCLED
// ([game/floor_stream.cpp] free_slot / alloc_slot), `generate_floor` clears the GRID
// but not the World's FieldRegistry, and fields are never removed from a registry
// ([world/field.h]). So floor N's danger survives into floor N+2 unless someone zeroes
// it — the same class of bug [game/floor_stream.cpp] documents having shipped with
// orphaned entities on a recycled layer, and the same one seed_floor_sumps already
// guards against for the fluid field.
//
// Zeroes in place rather than creating: a layer with no field keeps not having one.
void diffusion_on_floor_built(World& world, DiffusionScratch& scratch,
                              const std::string& field = kDangerField);

// Add `amount` at a cell, CREATING the field zero-filled if this layer has none.
//
// This is the only entry point that creates the field, and that is the whole point:
// diffusion_step below is non-creating, so a layer nobody has ever wounded costs one
// hash lookup per sweep instead of an 8 MiB allocation and a sweep over 2,097,152
// guaranteed-zero cells. [sim/fluid.h] documents having made exactly that mistake with
// get_or_create and having had to undo it. Coordinates are wrapped, so raw cell
// indices are fine.
//
// A source dropped inside solid rock is silently discarded rather than stored, because
// the sweep holds solid cells at 0 and the level would vanish on the next sweep anyway
// — better to have never counted it than to have `total` report mass that cannot
// exist. Returns the field level at that cell after the add (0 when it was refused).
float diffusion_add(World& world, int x, int y, int z, float amount,
                    const std::string& field = kDangerField);

// Same, from a world-space position (metres) instead of a cell index. One macro cell
// is kCellSize = 2 m ([world/types.h]) and the conversion is
// `wrap_macro(int(pos.axis / kCellSize))`, the same one [game/door.cpp],
// [game/combat.cpp] and [game/wander.cpp] each write by hand. It lives here so a
// producer holding a Transform — a corpse, a gunshot, a fleeing body — does not have
// to know the convention, and so there is one place to fix if it ever changes.
float diffusion_add_at(World& world, vec3 pos, float amount,
                       const std::string& field = kDangerField);

// Advance the named field one deterministic sweep over `world`.
//
// Reads the whole field from one buffer and writes the next into the other, so the
// result is independent of visitation order and therefore bit-identical across runs,
// platforms and any future parallel split ([ARCHITECTURE.md] §Determinism). Fully
// solid cells are held at 0 and are skipped in every neighbour sum, which IS a no-flux
// (Neumann) wall: danger pools in rooms and leaks through doorways instead of bleeding
// through structure.
//
// `scratch` should be the same object every sweep, or reason 1 above is thrown away.
// If its bitset is empty, or `geomDirty` is set, this rebuilds it from world.grid()
// first.
//
// THE QUIET-FLOOR GATE, which is what makes an 18-44 ms sweep affordable at all. The
// return value is a complete answer to "is there any point sweeping again":
//
//   * `present == false` — this layer has no danger field, because nothing has ever
//     called diffusion_add on it. The call cost one string hash. A floor nobody has
//     bled on never pays.
//   * `liveCells == 0` — the field exists but has fully evaporated. Nothing will
//     change until the next diffusion_add, so a caller should STOP sweeping and
//     resume when it next deposits. Skipping this is the difference between paying
//     20 ms every 200 ms forever and paying it only while a floor is actually hot.
//
// A caller that ignores both still gets correct results, just at full price.
DiffusionStep diffusion_step(World& world, DiffusionScratch& scratch,
                             const DiffusionParams& params = {});

// Scratchless overload for one-off callers and tests: allocates a DiffusionScratch,
// sweeps once, and drops it. Bit-identical to the scratch form — same code path, the
// scratch just does not survive the call — so it costs the 8.00 MiB back buffer plus a
// full bitset rebuild EVERY call. Correct anywhere, affordable only where the cadence
// is "once"; anything sweeping on a clock owns a scratch.
DiffusionStep diffusion_step(World& world, const DiffusionParams& params = {});

// The spatial gradient of a field at a cell: a wrapped central difference over OPEN
// neighbours per axis, one-sided when a side is walled (that side carries no flux),
// and 0 when both sides are walls. Danger rises along +gradient, so an agent FLEES
// along -gradient.
//
// UNITS: the result is delta-level per CELL step. One cell is kCellSize = 2 m
// ([world/types.h]), so divide by kCellSize for per-metre. Steering only needs the
// direction and does not care; anything comparing a gradient magnitude against an
// authored threshold does.
//
// This overload probes MacroGrid directly and is for one-off calls. It is
// allocation-free, but it makes 6 scattered reads into the 128 MiB mask array, so at
// the crowd scale [macrosim.md] targets that is millions of cache-missing loads per
// pass. Use the bitset overload below for a crowd.
vec3 diffusion_gradient(const Field<float>& f, const MacroGrid& g, int x, int y, int z);

// Same gradient, answering walkability from a DiffusionScratch bitset (256 KiB, L2
// resident) instead of the 128 MiB mask array. Identical results by construction —
// both forms ask `!mask.full()`, one of them just asked it earlier. This is the form a
// per-agent tick should call.
vec3 diffusion_gradient(const Field<float>& f, const DiffusionScratch& scratch, int x,
                        int y, int z);

// Level at a cell of a named field, toroidally indexed; 0 when this layer has no such
// field. The read a consumer wants when it has a World and not a Field, and it exists
// so the const_cast around FieldRegistry::find (non-const only because it hands back a
// MUTABLE Field) sits in one place — [sim/fluid.cpp] made the same call for the same
// reason. One call is one string hash, so resolve the Field once for a loop.
float diffusion_at(const World& world, int x, int y, int z,
                   const std::string& field = kDangerField);

// ---------------------------------------------------------------------------
// The driver: everything a fixed-step loop needs in order to actually RUN this.
// ---------------------------------------------------------------------------
//
// One whole source. Every decay and spread figure quoted at the top of this file is
// "for an unspread unit source", so the unit is named rather than left as a bare 1.0f
// at each producer. How MANY units a corpse or a gunshot is worth is gameplay and
// belongs to the caller; what one unit MEANS is this file's.
inline constexpr float kDangerUnit = 1.0f;

// What the app shell holds, one per sweeping layer. This is the object that turns a
// solver into a system, and it exists because the three things below are exactly the
// things a call site gets wrong:
//
//   1. THE CADENCE. A sweep is 18-44 ms against an 8 ms step, so it cannot go per tick.
//   2. THE FLOOR TOKEN. `scratch.open` is walkability for ONE World. The camera rides an
//      elevator, the active layer changes, and a sweep against the bitset of the floor
//      you left diffuses danger through walls that exist and holds it out of doorways
//      that do not.
//   3. THE QUIET GATE. Without it, a floor nobody has bled on pays 20 ms every 200 ms
//      forever. With it, it pays nothing at all — not "one string hash", nothing: the
//      sweep is not called.
struct DiffusionDriver {
    DiffusionScratch scratch;

    // Which layer `scratch.open` was built from. kInvalidLayer means "never built", so
    // the first tick rebuilds whatever it is handed.
    LayerId layer = kInvalidLayer;

    // The quiet gate, armed by a deposit and disarmed by a sweep that found nothing.
    // False means the field is provably static: it either does not exist or has fully
    // evaporated, and in both cases no sweep can change a single cell.
    bool hot = false;

    std::uint64_t sweeps = 0;   // diffusion_step calls made, for a HUD or a test
    std::uint64_t deposits = 0; // sources that TOOK (one refused inside rock is not one)
    DiffusionStep last{};       // the most recent sweep's report; zeroed until the first
};

// Arm the gate by hand. Needed only by a producer that deposits through the bare
// diffusion_add rather than through diffusion_driver_add — and that is the one footgun
// this design has, so it is named instead of hidden: deposit behind the driver's back
// while the floor is quiet and the danger sits there, correct and frozen, until
// something else happens to arm it. Same shape as diffusion_mark_geometry_dirty: cheap,
// idempotent, and the caller's job.
inline void diffusion_arm(DiffusionDriver& driver) { driver.hot = true; }

// Deposit through the driver: diffusion_add, plus arming the gate so the next cadence
// tick resumes sweeping. THE entry point for a producer — a corpse, a gunshot, a
// scream. Returns what diffusion_add returned (0 when the source was refused inside
// rock), and a refused source arms nothing, because waking a 20 ms sweep to rediscover
// that the floor is still empty is the one cost the gate exists to avoid.
float diffusion_driver_add(DiffusionDriver& driver, World& world, int x, int y, int z,
                           float amount, const std::string& field = kDangerField);

// Same, from a world-space position in metres. This is the overload a producer holding
// a Transform wants; the cell conversion is the engine-wide truncate-then-wrap.
float diffusion_driver_add_at(DiffusionDriver& driver, World& world, vec3 pos,
                              float amount,
                              const std::string& field = kDangerField);

// Call at EVERY floor entry, next to the nav bake, for the reason spelled out on
// diffusion_on_floor_built: a LevelStack slot is recycled, generate_floor clears the
// grid but not the FieldRegistry, so floor N's danger is still sitting in floor N+2's
// cells. Rebuilds the bitset from the new geometry, zeroes the field, and re-parks the
// gate — a zeroed field has nothing to spread, so the new floor starts free.
//
// This is the CONTRACT; the layer-id comparison inside diffusion_tick is only a
// backstop. It cannot cover the recycled-slot case, because a recycled slot hands back
// the same LayerId with different geometry and the comparison sees nothing wrong.
void diffusion_driver_on_floor_built(DiffusionDriver& driver, World& world, LayerId layer,
                                     const std::string& field = kDangerField);

// Call EVERY sim tick with the layer the sim is currently stepping. Returns true if
// diffusion_step was CALLED, which is the number a caller should report rather than
// assume — and which is deliberately not quite "a sweep ran". A layer change forces one
// call so that `last` describes the floor we are on, and on a floor with no danger field
// that call takes the non-creating early-out and touches no cell. `driver.sweeps` counts
// the same thing, so on a floor-hopping run it reads one high per floor entered.
//
// Named _tick rather than _step, breaking the `*_step` convention ([AGENTS.md] §ECS
// Conventions) on purpose: `diffusion_step` is already the SWEEP, and one function
// called every 8 ms wrapping another called every 200 ms must not share a name with it.
//
// Costs nothing on 24 of every 25 ticks, and nothing at all on a quiet floor. Not
// "cheap" — the sweep is not entered, so a floor nobody has wounded is free even at the
// cadence tick.
//
// `simTick` is the caller's own tick counter, used only modulo kDiffusionSweepTicks, so
// any monotonically increasing per-step counter works and the phase is whatever the
// caller's counter already has.
bool diffusion_tick(DiffusionDriver& driver, World& world, LayerId layer,
                    std::uint64_t simTick, const DiffusionParams& params = {});

} // namespace giga
