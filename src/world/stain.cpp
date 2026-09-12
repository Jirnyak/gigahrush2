#include "core/rng.h"
#include "world/stain.h"

#include "world/los.h" // sub_march — единственный субвоксельный марш (S11)

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

    for (int i = 0; i < rays; ++i) {
        // Uniform direction from two hashes, pulled toward `bias`.
        const std::uint32_t h = hash_u32(seed ^ (0x9e3779b9u * (i + 1)));
        const float z = u01(h) * 2.0f - 1.0f;
        const float a = u01(hash_u32(h)) * 6.2831853f;
        const float rxy = std::sqrt(std::max(0.0f, 1.0f - z * z));
        vec3 dir{rxy * std::cos(a), rxy * std::sin(a), z};
        dir += bias;
        const float len = std::sqrt(dot(dir, dir));
        if (len < 1e-4f) continue;
        dir = dir * (1.0f / len);

        // ЕДИНСТВЕННЫЙ субвоксельный марш дерева ([los.h], S11): прежний
        // полушаговый сэмплинг был вторым маршем и пропускал атом по
        // диагонали — кровь садилась не туда, куда долетела бы пуля
        // (аудит 2026-08-25). stain_splat — событие (попадание/смерть),
        // не тиковый свип: O(клеток сегмента) здесь законно.
        SubRayHit hit;
        if (!sub_march(w.grid(), origin, origin + dir * reach, hit)) continue;
        const float t = hit.t * reach;
        // Falloff: full colour up close, fading toward the reach edge.
        const float k = 1.0f - 0.75f * (t / reach);
        const StainRGB scaled{
            static_cast<std::uint8_t>(static_cast<float>(colour.r) * k),
            static_cast<std::uint8_t>(static_cast<float>(colour.g) * k),
            static_cast<std::uint8_t>(static_cast<float>(colour.b) * k)};
        const std::uint32_t ci = stain_paint(
            w, hit.cx * kSubDim + hit.sx, hit.cy * kSubDim + hit.sy,
            hit.cz * kSubDim + hit.sz, scaled);
        if (ci != UINT32_MAX) {
            ++painted;
            bool seen = false;
            for (std::uint32_t d : dirty)
                if (d == ci) { seen = true; break; }
            if (!seen) dirty.push_back(ci);
        }
    }
    return painted;
}

} // namespace giga
