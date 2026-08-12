#pragma once

#include "world/world.h"

namespace giga::audio {

// Calculates the occlusion high-frequency gain (0.0 to 1.0) along a
// straight-line 3D DDA ray from `source` to `listener` through the
// macro-grid sub-voxel masks of `world`.
//
// Returns 1.0 when the line of sight is clear, lower values when voxels
// block the path (each solid sub-voxel adds 0.2 to accumulated density,
// capped at 1.0). A density of 1.0 maps to an HF gain of 0.1 (heavily
// muffled), yielding the EFX AL_LOWPASS_GAINHF value to set on the source.
float calculate_occlusion(const World& world, const float source[3], const float listener[3]);

} // namespace giga::audio
