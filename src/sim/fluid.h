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

#include <string>

#include "world/world.h"

namespace giga {

struct FluidParams {
    std::string field = "fluid"; // name of the float field to simulate
    float maxPerCell = 1.0f;     // a full cell of liquid
    float minFlow = 1e-4f;       // ignore dribbles below this
    float viscosity = 0.25f;     // fraction of the excess that spreads per step
};

// Advance the named fluid field by one deterministic step over `world`.
void fluid_step(World& world, const FluidParams& params = {});

} // namespace giga
