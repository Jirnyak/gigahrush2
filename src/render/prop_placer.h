// prop_placer.h — Procedural GPU-instanced prop placement engine for Gigahrush2.
// Lives in render layer (src/render/) so it can interact with PropPass and Vulkan.

#pragma once

#include <cstdint>
#include "world/macro_grid.h"
#include "render/prop_pass.h"

namespace giga::gpu {

class PropPlacer {
public:
    PropPlacer() = default;

    // Scan grid around level bounds and populate GPU prop instances into propPass.
    void populate(const MacroGrid& grid, PropPass& propPass, std::uint32_t seed = 0x9e3779b9u);

    std::uint32_t total_placed() const { return totalPlaced_; }

private:
    std::uint32_t totalPlaced_ = 0;
};

} // namespace giga::gpu
