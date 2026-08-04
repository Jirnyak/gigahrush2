#include "core/rng.h"
#include "world/stain.h"

#include <cmath>

#include "core/wrap.h"
#include "world/subfield.h"
#include "world/world.h"

namespace giga {

namespace {

constexpr int kSubGrid = kMacroDim * kSubDim; // 1024, a power of two
constexpr int kSubGridMask = kSubGrid - 1;



float u01(std::uint32_t h) {
    return static_cast<float>(h >> 8) * (1.0f / 16777216.0f);
}

} // namespace

std::uint32_t stain_paint(World& w, SubField<StainRGB>& field, int gx, int gy, int gz, StainRGB add) {
    if (add.r == 0 && add.g == 0 && add.b == 0) return UINT32_MAX;
    gx &= kSubGridMask;
    gy &= kSubGridMask;
    gz &= kSubGridMask;
    const int cx = gx / kSubDim, cy = gy / kSubDim, cz = gz / kSubDim;
    const int bit = sub_bit(gx % kSubDim, gy % kSubDim, gz % kSubDim);
    if (!w.grid().mask(cx, cy, cz).test(bit)) return UINT32_MAX; // air holds no paint

    const std::size_t ci = macro_index(cx, cy, cz);
    StainRGB* page = field.ensure_page(ci, StainRGB{});
    StainRGB& s = page[bit];
    s.r = std::max(s.r, add.r);
    s.g = std::max(s.g, add.g);
    s.b = std::max(s.b, add.b);
    return static_cast<std::uint32_t>(ci);
}

std::int32_t stain_splat(World& w, vec3 origin, vec3 bias, float reach,
                         int rays, StainRGB colour, std::uint32_t seed,
                         std::vector<std::uint32_t>& dirty) {
    if (rays <= 0 || reach <= 0.0f) return 0;
    std::int32_t painted = 0;
    const int maxSteps = static_cast<int>(reach / kVoxelSize) + 1;

    auto& field = w.subfields().get_or_create<StainRGB>(kStainFieldName);

    for (int i = 0; i < rays; ++i) {
        // Uniform direction via rejection sampling in a unit sphere
        vec3 dir{0.0f, 0.0f, 0.0f};
        float r2 = 0.0f;
        std::uint32_t h = mix32(seed ^ (0x9e3779b9u * (i + 1)));
        for (int attempt = 0; attempt < 8; ++attempt) {
            float dx = u01(h) * 2.0f - 1.0f;
            h = mix32(h);
            float dy = u01(h) * 2.0f - 1.0f;
            h = mix32(h);
            float dz = u01(h) * 2.0f - 1.0f;
            h = mix32(h);
            r2 = dx * dx + dy * dy + dz * dz;
            if (r2 > 1e-4f && r2 <= 1.0f) {
                dir = vec3{dx, dy, dz};
                break;
            }
        }
        if (r2 <= 1e-4f || r2 > 1.0f) {
            dir = vec3{0.0f, 0.0f, 1.0f};
            r2 = 1.0f;
        }
        const float invR = 1.0f / std::sqrt(r2);
        dir.x *= invR;
        dir.y *= invR;
        dir.z *= invR;

        dir += bias;
        const float len = std::sqrt(dot(dir, dir));
        if (len < 1e-4f) continue;
        dir = dir * (1.0f / len);

        // Sub-voxel DDA to the first solid atom (the physics voxel walk).
        float t = 0.0f;
        const float step = kVoxelSize * 0.5f; // half-atom march cannot skip one
        for (int s = 0; s < maxSteps * 2; ++s) {
            t += step;
            if (t > reach) break;
            const vec3 p = origin + dir * t;
            const int gx = static_cast<int>(std::floor(p.x / kVoxelSize));
            const int gy = static_cast<int>(std::floor(p.y / kVoxelSize));
            const int gz = static_cast<int>(std::floor(p.z / kVoxelSize));
            // Falloff: full colour up close, fading toward the reach edge.
            const float k = 1.0f - 0.75f * (t / reach);
            const StainRGB scaled{
                static_cast<std::uint8_t>(static_cast<float>(colour.r) * k),
                static_cast<std::uint8_t>(static_cast<float>(colour.g) * k),
                static_cast<std::uint8_t>(static_cast<float>(colour.b) * k)};
            const std::uint32_t ci = stain_paint(w, field, gx, gy, gz, scaled);
            if (ci != UINT32_MAX) {
                ++painted;
                bool seen = false;
                for (std::uint32_t d : dirty)
                    if (d == ci) { seen = true; break; }
                if (!seen) dirty.push_back(ci);
                break; // this ray is spent on its first surface
            }
        }
    }
    return painted;
}

} // namespace giga
