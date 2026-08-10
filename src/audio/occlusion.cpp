#include "audio/occlusion.h"
#include "world/types.h"
#include "world/macro_grid.h"
#include "core/wrap.h"
#include <cmath>
#include <algorithm>

namespace giga::audio {

float calculate_occlusion(const World& world, const float source[3], const float listener[3]) {
    const float dx = listener[0] - source[0];
    const float dy = listener[1] - source[1];
    const float dz = listener[2] - source[2];
    const float dist = std::sqrt(dx*dx + dy*dy + dz*dz);
    if (dist < 0.001f) return 1.0f;

    const float invDist = 1.0f / dist;
    const float dir[3] = {dx * invDist, dy * invDist, dz * invDist};

    // Convert world-space source position into sub-voxel grid coords.
    // kWorldExtent is the toroidal domain size; wrap() keeps it on the torus.
    const float invVox = 1.0f / kVoxelSize;
    const float startX = wrapf(source[0], kWorldExtent) * invVox;
    const float startY = wrapf(source[1], kWorldExtent) * invVox;
    const float startZ = wrapf(source[2], kWorldExtent) * invVox;

    int x = static_cast<int>(std::floor(startX));
    int y = static_cast<int>(std::floor(startY));
    int z = static_cast<int>(std::floor(startZ));

    const int stepX = (dir[0] > 0.f) ? 1 : ((dir[0] < 0.f) ? -1 : 0);
    const int stepY = (dir[1] > 0.f) ? 1 : ((dir[1] < 0.f) ? -1 : 0);
    const int stepZ = (dir[2] > 0.f) ? 1 : ((dir[2] < 0.f) ? -1 : 0);

    const float tDeltaX = (stepX != 0) ? std::abs(1.0f / dir[0]) : 1e30f;
    const float tDeltaY = (stepY != 0) ? std::abs(1.0f / dir[1]) : 1e30f;
    const float tDeltaZ = (stepZ != 0) ? std::abs(1.0f / dir[2]) : 1e30f;

    float tMaxX = (stepX > 0) ? (std::floor(startX) + 1.0f - startX) * tDeltaX
                               : (startX - std::floor(startX)) * tDeltaX;
    float tMaxY = (stepY > 0) ? (std::floor(startY) + 1.0f - startY) * tDeltaY
                               : (startY - std::floor(startY)) * tDeltaY;
    float tMaxZ = (stepZ > 0) ? (std::floor(startZ) + 1.0f - startZ) * tDeltaZ
                               : (startZ - std::floor(startZ)) * tDeltaZ;

    // Maximum march distance in sub-voxel units.
    const float maxT = dist * invVox;
    float t = 0.0f;
    float density = 0.0f;

    const MacroGrid& grid = world.grid();

    // March up to ~256 steps to stay budget-safe; real cap is maxT.
    for (int steps = 0; steps < 256 && t < maxT; ++steps) {
        // Convert current sub-voxel position to macro cell + local offset.
        // The sub-grid is kMacroDim*kSubDim wide and toroidal.
        const int subGridDim = kMacroDim * kSubDim;
        const int sx = ((x % subGridDim) + subGridDim) % subGridDim;
        const int sy = ((y % subGridDim) + subGridDim) % subGridDim;
        const int sz = ((z % subGridDim) + subGridDim) % subGridDim;

        const int macroX = sx >> kSubDimShift;
        const int macroY = sy >> kSubDimShift;
        const int macroZ = sz >> kSubDimShift;
        const int localX = sx & kSubDimMask;
        const int localY = sy & kSubDimMask;
        const int localZ = sz & kSubDimMask;

        const SubMask& mask = grid.mask(macroX, macroY, macroZ);
        if (mask.test(sub_bit(localX, localY, localZ))) {
            density += 0.2f;
            if (density >= 1.0f) {
                density = 1.0f;
                break;
            }
        }

        // Advance DDA to the nearest next voxel boundary.
        if (tMaxX < tMaxY) {
            if (tMaxX < tMaxZ) { t = tMaxX; x += stepX; tMaxX += tDeltaX; }
            else                { t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; }
        } else {
            if (tMaxY < tMaxZ) { t = tMaxY; y += stepY; tMaxY += tDeltaY; }
            else                { t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; }
        }
    }

    // Map [0,1] density to [1.0, 0.1] HF gain (exponential perceptual feel).
    // density=0 => gain=1.0 (clear), density=1 => gain=0.1 (heavily muffled).
    return 1.0f - density * 0.9f;
}

} // namespace giga::audio
