#include "game/light_bake.h"

#include <cmath>
#include <cstdint>
#include <vector>

#include "world/macro_grid.h"
#include "world/material_props.h"
#include "world/types.h"
#include "world/world.h"

namespace giga::game {

namespace {

inline std::uint32_t flat_index(int x, int y, int z) {
    x &= (kMacroDim - 1);
    y &= (kMacroDim - 1);
    z &= (kMacroDim - 1);
    return static_cast<std::uint32_t>(x) |
           (static_cast<std::uint32_t>(y) << 7) |
           (static_cast<std::uint32_t>(z) << 14);
}

} // namespace

std::vector<BakedLight> bake_material_lights(const World& world) {
    const MacroGrid& grid = world.grid();
    std::vector<BakedLight> out;

    // visited — по одному биту на ячейку тора; светоячеек мало, но скан полный.
    std::vector<bool> visited(kMacroCells, false);

    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            for (int x = 0; x < kMacroDim; ++x) {
                const CellType t = grid.cell(x, y, z);
                if (!material_emits_light(t)) continue;
                const std::uint32_t seedIdx = flat_index(x, y, z);
                if (visited[seedIdx]) continue;

                // BFS по 6-связности С ВРАПОМ; координаты храним НЕврапнутыми
                // относительно затравки, чтобы центроид кластера, лежащего на
                // шве тора, не разъехался на полмира.
                visited[seedIdx] = true;
                std::uint32_t cellCount = 1;
                long sx = x, sy = y, sz = z;
                ivec3 lo{x, y, z}, hi{x, y, z};

                // Параллельный стек неврапнутых координат.
                std::vector<ivec3> open;
                open.push_back(ivec3{x, y, z});

                while (!open.empty()) {
                    const ivec3 c = open.back();
                    open.pop_back();

                    static constexpr int kD[6][3] = {
                        {1, 0, 0}, {-1, 0, 0}, {0, 1, 0},
                        {0, -1, 0}, {0, 0, 1}, {0, 0, -1},
                    };
                    for (const auto& d : kD) {
                        const ivec3 n{c.x + d[0], c.y + d[1], c.z + d[2]};
                        if (grid.cell(n.x, n.y, n.z) != t) continue;
                        const std::uint32_t ni = flat_index(n.x, n.y, n.z);
                        if (visited[ni]) continue;
                        visited[ni] = true;
                        open.push_back(n);
                        sx += n.x; sy += n.y; sz += n.z;
                        lo.x = n.x < lo.x ? n.x : lo.x;
                        lo.y = n.y < lo.y ? n.y : lo.y;
                        lo.z = n.z < lo.z ? n.z : lo.z;
                        hi.x = n.x > hi.x ? n.x : hi.x;
                        hi.y = n.y > hi.y ? n.y : hi.y;
                        hi.z = n.z > hi.z ? n.z : hi.z;
                        ++cellCount;
                    }
                }

                const float invN = 1.0f / static_cast<float>(cellCount);
                // Центр ячейки: (i + 0.5) * kCellSize; координаты неврапнутые —
                // add_light/wrap_nearest свернут к ближайшему образу сами.
                BakedLight l;
                l.pos = vec3{(static_cast<float>(sx) * invN + 0.5f) * kCellSize,
                             (static_cast<float>(sy) * invN + 0.5f) * kCellSize,
                             (static_cast<float>(sz) * invN + 0.5f) * kCellSize};
                // Радиус = табличный + полудиагональ кластера: длинная полоса
                // неона освещает весь свой пролёт, а не пятно у центроида.
                const vec3 half{
                    (static_cast<float>(hi.x - lo.x) + 1.0f) * 0.5f * kCellSize,
                    (static_cast<float>(hi.y - lo.y) + 1.0f) * 0.5f * kCellSize,
                    (static_cast<float>(hi.z - lo.z) + 1.0f) * 0.5f * kCellSize};
                const float halfDiag = std::sqrt(
                    half.x * half.x + half.y * half.y + half.z * half.z);
                l.radiusM =
                    static_cast<float>(kMatLightRadiusMm[t]) * 0.001f + halfDiag;
                l.color = vec3{kMatAlbedoR[t], kMatAlbedoG[t], kMatAlbedoB[t]};
                l.intensity = static_cast<float>(kMatLightIntensityE3[t]) * 0.001f;
                out.push_back(l);
            }
        }
    }
    return out;
}

} // namespace giga::game
