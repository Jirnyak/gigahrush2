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

    // Spec 04: 16 отсчётов по луче, а не полный DDA: это ЗВУК, ошибка в 5 % неслышима.
    int solid = 0;
    const int kSamples = 16;
    const float invVox = 1.0f / kVoxelSize;
    const MacroGrid& grid = world.grid();

    for (int i = 0; i < kSamples; ++i) {
        const float t = (i + 0.5f) / kSamples;
        const float px = source[0] + dx * t;
        const float py = source[1] + dy * t;
        const float pz = source[2] + dz * t;

        const float startX = wrapf(px, kWorldExtent) * invVox;
        const float startY = wrapf(py, kWorldExtent) * invVox;
        const float startZ = wrapf(pz, kWorldExtent) * invVox;

        int sx = static_cast<int>(std::floor(startX));
        int sy = static_cast<int>(std::floor(startY));
        int sz = static_cast<int>(std::floor(startZ));

        const int subGridDim = kMacroDim * kSubDim;
        sx = ((sx % subGridDim) + subGridDim) % subGridDim;
        sy = ((sy % subGridDim) + subGridDim) % subGridDim;
        sz = ((sz % subGridDim) + subGridDim) % subGridDim;

        const int macroX = sx >> kSubDimShift;
        const int macroY = sy >> kSubDimShift;
        const int macroZ = sz >> kSubDimShift;
        const int localX = sx & kSubDimMask;
        const int localY = sy & kSubDimMask;
        const int localZ = sz & kSubDimMask;

        const SubMask& mask = grid.mask(macroX, macroY, macroZ);
        if (mask.test(sub_bit(localX, localY, localZ))) {
            solid++;
        }
    }

    const float wall = static_cast<float>(solid) / kSamples;
    
    // TODO: Трубы ОБХОДЯТ стену: если источник и слушатель в одной компоненте...

    // Map [0,1] wall thickness to [1.0, 0.1] HF gain
    return 1.0f - wall * 0.9f;
}

} // namespace giga::audio
