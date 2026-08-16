// 3D Toroidal Spatial Audio, Constant-Power Azimuth Panning & Voxel Occlusion Filter.
#pragma once

#include "audio/audio_types.h"
#include "core/math.h"

namespace giga {
class MacroGrid;
}

namespace giga::audio {

// Pure geometric evaluation (toroidal distance falloff + constant-power azimuth panning)
void spatial_evaluate_geom(const vec3& listenerPos, float listenerYaw, float listenerPitch,
                           const vec3& emitterPos, float& outGainL, float& outGainR, float& outDist);

// Full acoustic evaluation including MacroGrid voxel ray-march occlusion
void spatial_evaluate(const vec3& listenerPos, float listenerYaw, float listenerPitch,
                      const vec3& emitterPos, const MacroGrid& grid,
                      float& outGainL, float& outGainR, float& outCutoffHz, float& outWallAtten);

// Analytical occlusion formulas for unit testing
float compute_occlusion_cutoff(int numBlockerWalls);
float compute_wall_attenuation(int numBlockerWalls);

} // namespace giga::audio
