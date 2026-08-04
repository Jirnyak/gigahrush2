// Cellular fluid.
//
// Liquid is stored as a runtime field ("fluid" by default: a float amount per
// macro cell) and stepped with a deterministic double-buffered cellular rule:
// each cell first sends what it can straight down (toward -gravity's opposite),
// then spreads any remainder to lower/equal neighbours. Solid sub-voxels below
// a cell block the downward flow, so liquid pools on top of terrain instead of
// falling through it — the "flows through the macro grid, settles voxel-wise"
// contract from the design.
//
// The rule is mass-conserving and reads/writes two buffers so the result is
// independent of iteration order (reproducible across runs and platforms).
#pragma once

#include <cstdint>
#include <string>

#include "world/world.h"

namespace giga {

// The field name every producer and consumer agrees on. ONE definition, four
// consumers: `floor_gen` seeds it, `fluid_step` advances it, `cube_pass` tints by
// it, and container/mob placement refuses to stand something in it. The same
// string literal typed at four call sites is one rename away from a world that is
// silently dry, and nothing would fail to compile.
inline constexpr const char* kFluidField = "fluid";

// Separate field for buoyant gas (e.g. CO2, methane) in elevator shafts.
// Gas uses the same cellular automata step but with inverted gravity direction.
inline constexpr const char* kGasField = "gas";


// Amounts below this are dribbles: never transferred, and treated as DRY by every
// consumer. Named so "is this cell wet" cannot drift from the threshold the solver
// itself uses to decide a transfer is worth making.
inline constexpr float kFluidMinFlow = 1e-4f;

struct FluidParams {
    std::string field = kFluidField;  // name of the float field to simulate
    float maxPerCell = 1.0f;          // a full cell of liquid
    float minFlow = kFluidMinFlow;    // ignore dribbles below this
    float viscosity = 0.25f;          // fraction of the excess that spreads per step
};

// What one step did. Every field is an observation, so a caller can tell "this
// layer is dry" from "this layer's water has found its level" without re-deriving
// either from the field.
//
// `moved` exists for the RENDER and is a measured cost rather than bookkeeping.
// The cube pass caches its instance list because rebuilding it costs 28.6 ms of a
// 43.6 ms frame ([render/cube_pass.h]), and a caller that invalidates that cache
// on every step of a *settled* pool would spend ~0.9 s of CPU per second of wall
// clock for pixels that did not change. `moved == 0.0f` is exactly the statement
// "nothing the render could observe moved", so the invalidate belongs behind it.
struct FluidStep {
    float moved = 0.0f;          // total mass transferred this step
    std::uint32_t wetCells = 0;  // cells holding >= minFlow when the step began
    bool present = false;        // the field existed; false = this layer is dry
};

struct FluidScratch {
    std::vector<float> delta;
};

// Advance the named fluid field by one deterministic step over `world`.
//
// A layer with no fluid field costs one hash lookup and nothing else: the field is
// NOT created, so stepping a dry floor never allocates the 8 MiB a 128^3 float
// field needs. This is what makes an unconditional per-tick call affordable on the
// two FloorKinds that seed no water.
FluidStep fluid_step(World& world, FluidScratch& scratch, const FluidParams& params = {});

// Scratchless overload for one-off callers and tests: allocates a FluidScratch,
// sweeps once, and drops it.
FluidStep fluid_step(World& world, const FluidParams& params = {});

// Liquid in one cell of the default field, toroidally indexed; 0 when this layer has
// no fluid field at all.
//
// The read every non-render consumer needs — spawn placement refuses to stand a crate
// or a monster in standing water — and it exists so the `const_cast` around
// `FieldRegistry::find` (non-const only because it hands back a MUTABLE Field) sits in
// one place instead of being copied to each call site, the way
// render/cube_pass.cpp:467 had to.
//
// One call is one std::unordered_map lookup keyed on a string, so this is the form for
// a handful of reads. A loop that tests candidate CELLS resolves the field once with
// fluid_data() and uses the pointer overload below: `spawn_floor_mobs` tests up to
// want * kPlaceTries = 98,304 candidates on a deep floor, and 98k string hashes to
// answer a question about one array is the wrong shape.
float fluid_at(const World& world, int x, int y, int z);

// Resolve the default fluid field to a flat 128^3 array, or nullptr for a dry layer.
// The pointer stays valid as long as the World's field registry does — fields are never
// removed, and `fluid_step`/`Field::fill` mutate in place without reallocating.
const float* fluid_data(const World& world);

// Toroidal read from a resolved pointer; a nullptr layer is dry everywhere.
inline float fluid_at(const float* data, int x, int y, int z) {
    return data ? data[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))]
                : 0.0f;
}

} // namespace giga
