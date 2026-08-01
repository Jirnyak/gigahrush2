#include "world/stain.h"

#include <cmath>

#include "core/wrap.h"
#include "world/subfield.h"
#include "world/world.h"

namespace giga {

namespace {

constexpr int kSubGrid = kMacroDim * kSubDim; // 1024, a power of two
constexpr int kSubGridMask = kSubGrid - 1;

std::uint8_t sat_add(std::uint8_t a, std::uint8_t b) {
    const int s = static_cast<int>(a) + static_cast<int>(b);
    return static_cast<std::uint8_t>(s > 255 ? 255 : s);
}

// Deterministic per-ray direction hash — the carve_hash discipline: no RNG
// stream, same seed = same spray on any machine.
std::uint32_t mix32(std::uint32_t h) {
    h ^= h >> 16;
    h *= 0x7feb352du;
    h ^= h >> 15;
    h *= 0x846ca68bu;
    h ^= h >> 16;
    return h;
}
float u01(std::uint32_t h) {
    return static_cast<float>(h >> 8) * (1.0f / 16777216.0f);
}

} // namespace

std::uint32_t stain_paint(World& w, int gx, int gy, int gz, StainRGB add) {
    if (add.r == 0 && add.g == 0 && add.b == 0) return UINT32_MAX;
    gx &= kSubGridMask;
    gy &= kSubGridMask;
    gz &= kSubGridMask;
    const int cx = gx / kSubDim, cy = gy / kSubDim, cz = gz / kSubDim;
    const int bit = sub_bit(gx % kSubDim, gy % kSubDim, gz % kSubDim);
    if (!w.grid().mask(cx, cy, cz).test(bit)) return UINT32_MAX; // air holds no paint

    auto& field = w.subfields().get_or_create<StainRGB>(kStainFieldName);
    const std::size_t ci = macro_index(cx, cy, cz);
    StainRGB* page = field.ensure_page(ci, StainRGB{});
    StainRGB& s = page[bit];
    s.r = sat_add(s.r, add.r);
    s.g = sat_add(s.g, add.g);
    s.b = sat_add(s.b, add.b);
    return static_cast<std::uint32_t>(ci);
}

std::int32_t stain_splat(World& w, vec3 origin, vec3 bias, float reach,
                         int rays, StainRGB colour, std::uint32_t seed,
                         std::vector<std::uint32_t>& dirty) {
    if (rays <= 0 || reach <= 0.0f) return 0;
    std::int32_t painted = 0;
    const int maxSteps = static_cast<int>(reach / kVoxelSize) + 1;

    for (int i = 0; i < rays; ++i) {
        // Uniform direction from two hashes, pulled toward `bias`.
        const std::uint32_t h = mix32(seed ^ (0x9e3779b9u * (i + 1)));
        const float z = u01(h) * 2.0f - 1.0f;
        const float a = u01(mix32(h)) * 6.2831853f;
        const float rxy = std::sqrt(std::max(0.0f, 1.0f - z * z));
        vec3 dir{rxy * std::cos(a), rxy * std::sin(a), z};
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
            const std::uint32_t ci = stain_paint(w, gx, gy, gz, scaled);
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
