#pragma once

#include "world/gas_field.h"
#include "world/world.h"
#include <string>

namespace giga {

// Simulated gas properties (diffusion rates etc.)
struct GasParams {
    std::string field = kGasField;
    float diffuse = 0.5f;
    float buoyancy = 0.5f; 
};

void unpack_gas(std::uint32_t v, float& toxic, float& smoke, float& oxy, float& heat);
std::uint32_t pack_gas(float toxic, float smoke, float oxy, float heat);

// Perform one step of CPU gas simulation and chemistry on the given layer.
void gas_step(World& world, int layer, float dt, const GasParams& params = {});

} // namespace giga
