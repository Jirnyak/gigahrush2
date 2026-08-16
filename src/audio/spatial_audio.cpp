// 3D Toroidal Spatial Audio, Constant-Power Azimuth Panning & Voxel Occlusion Filter implementation.
#include "audio/spatial_audio.h"
#include "audio/dsp_math.h"
#include "core/wrap.h"
#include "world/los.h"
#include "world/macro_grid.h"
#include <algorithm>
#include <cmath>

namespace giga::audio {

constexpr float kWorldPeriodM = 256.0f; // 128 cells * 2.0 m

float compute_occlusion_cutoff(int numBlockerWalls) {
    if (numBlockerWalls <= 0) {
        return 20000.0f;
    }
    // fc(N) = max(100 Hz, 1100 / (1 + 1.6 * N))
    float fc = 1100.0f / (1.0f + 1.6f * static_cast<float>(numBlockerWalls));
    return std::max(100.0f, fc);
}

float compute_wall_attenuation(int numBlockerWalls) {
    if (numBlockerWalls <= 0) {
        return 1.0f;
    }
    // g_wall(N) = exp(-0.65 * N) (~ -5.6 dB per solid concrete wall)
    return std::exp(-0.65f * static_cast<float>(numBlockerWalls));
}

void spatial_evaluate_geom(const vec3& listenerPos, float listenerYaw, float listenerPitch,
                           const vec3& emitterPos, float& outGainL, float& outGainR, float& outDist) {
    // 1. Toroidal minimal-image delta in X and Y, non-wrapping in Z
    float dx = wrap_delta_f(listenerPos.x, emitterPos.x, kWorldPeriodM);
    float dy = wrap_delta_f(listenerPos.y, emitterPos.y, kWorldPeriodM);
    float dz = emitterPos.z - listenerPos.z;
    float dist = std::sqrt(dx * dx + dy * dy + dz * dz);
    outDist = dist;

    // 2. Distance Attenuation
    float gDist = 0.0f;
    if (dist <= kRefDistanceM) {
        gDist = 1.0f;
    } else if (dist < kMaxAudibleDistM) {
        gDist = kRefDistanceM / (kRefDistanceM + 1.0f * (dist - kRefDistanceM));
        if (dist > kFadeDistanceM) {
            float t = (dist - kFadeDistanceM) / (kMaxAudibleDistM - kFadeDistanceM);
            t = std::clamp(t, 0.0f, 1.0f);
            float fade = 1.0f - (t * t * (3.0f - 2.0f * t));
            gDist *= fade;
        }
    }

    if (gDist <= 0.0f) {
        outGainL = 0.0f;
        outGainR = 0.0f;
        return;
    }

    // 3. Constant-Power Azimuth Stereo Panning
    // Camera forward unit vector
    float cosPitch = std::cos(listenerPitch);
    vec3 forward{
        std::cos(listenerYaw) * cosPitch,
        std::sin(listenerYaw) * cosPitch,
        std::sin(listenerPitch)
    };
    // Camera right unit vector (in horizontal plane)
    vec3 right{
        std::sin(listenerYaw),
        -std::cos(listenerYaw),
        0.0f
    };

    float invDist = 1.0f / std::max(dist, 1e-4f);
    vec3 dir{dx * invDist, dy * invDist, dz * invDist};

    float dotFwd = forward.x * dir.x + forward.y * dir.y + forward.z * dir.z;
    float dotRight = right.x * dir.x + right.y * dir.y + right.z * dir.z;

    float azimuth = std::atan2(dotRight, dotFwd);
    float pan = std::clamp(azimuth / kHalfPi, -1.0f, 1.0f);

    // Constant-power gains: cos((pan + 1) * pi/4), sin((pan + 1) * pi/4)
    float angle = (pan + 1.0f) * (kPi * 0.25f);
    outGainL = std::cos(angle) * gDist;
    outGainR = std::sin(angle) * gDist;
}

void spatial_evaluate(const vec3& listenerPos, float listenerYaw, float listenerPitch,
                      const vec3& emitterPos, const MacroGrid& grid,
                      float& outGainL, float& outGainR, float& outCutoffHz, float& outWallAtten) {
    float dist = 0.0f;
    spatial_evaluate_geom(listenerPos, listenerYaw, listenerPitch, emitterPos, outGainL, outGainR, dist);

    if (dist >= kMaxAudibleDistM) {
        outGainL = 0.0f;
        outGainR = 0.0f;
        outCutoffHz = 100.0f;
        outWallAtten = 0.0f;
        return;
    }

    // Voxel ray-march solid blocker count query
    int blockers = los_blockers(grid, listenerPos, emitterPos);
    outCutoffHz = compute_occlusion_cutoff(blockers);
    outWallAtten = compute_wall_attenuation(blockers);

    outGainL *= outWallAtten;
    outGainR *= outWallAtten;
}

} // namespace giga::audio
