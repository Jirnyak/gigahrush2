#include "game/light_bake.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

#include "world/macro_grid.h"
#include "world/destruct.h"  // kSubMaterialName
#include "world/material_props.h"
#include "world/subfield.h"
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

// СВЕТЯЩАЯСЯ ЯЧЕЙКА — ЭТО ЯЧЕЙКА СО СВЕТЯЩИМИСЯ АТОМАМИ (закон двух
// масштабов, CANON S2: локальный вопрос обязан спрашивать субвоксели).
// До 2026-08-23 скан спрашивал только ТИП ЯЧЕЙКИ, поэтому неон, нарисованный
// субвокселями, не рождал ни одного эмиттера: он светился сам (эмиссив
// поверхности) и не освещал ничего — поймано владельцем командой `neon`.
// Ячеечный тип остаётся быстрым путём: у однородной ячейки страницы нет.
struct SubLookup {
    const std::uint32_t* pageTab = nullptr;
    const CellType* pages = nullptr;

    explicit SubLookup(const World& world) {
        const SubField<CellType>* sub =
            world.subfields().find<CellType>(kSubMaterialName);
        if (sub) {
            pageTab = sub->page_table();
            pages = sub->pages_data();
        }
    }

    CellType emitting_mat(const MacroGrid& grid, std::uint32_t idx) const {
        const CellType t = grid.types()[idx];
        if (material_emits_light(t)) return t;
        if (pageTab == nullptr) return 0;
        const std::uint32_t pg = pageTab[idx];
        if (pg == SubField<CellType>::kNoPage) return 0;
        const CellType* atoms =
            pages + static_cast<std::size_t>(pg) * kSubVoxels;
        for (int i = 0; i < kSubVoxels; ++i)
            if (material_emits_light(atoms[i])) return atoms[i];
        return 0;
    }
};

} // namespace

void rebuild_emitter_field(const World& world, EmitterField& f) {
    const auto t0 = std::chrono::steady_clock::now();
    const SubLookup sub(world);
    const MacroGrid& grid = world.grid();
    f.mat.assign(kMacroCells, 0);
    f.cells.clear();
    // Обход по возрастанию индекса ⇒ cells отсортирован по построению.
    for (std::uint32_t idx = 0; idx < kMacroCells; ++idx) {
        const CellType t = sub.emitting_mat(grid, idx);
        if (t == 0) continue;
        f.mat[idx] = t;
        f.cells.push_back(idx);
    }
    const double ms = std::chrono::duration<double, std::milli>(
                          std::chrono::steady_clock::now() - t0)
                          .count();
    std::fprintf(stderr, "[lights] field rebuilt: %zu emitting cells in %.1f ms\n",
                 f.cells.size(), ms);
}

bool patch_emitter_field(const World& world, EmitterField& f,
                         const std::uint32_t* dirty, std::size_t n) {
    // Поле обязано быть построено входом этажа (rebuild_emitter_field);
    // латать пустоту нечего — как и до постройки нечему светить.
    if (f.mat.size() != kMacroCells) return false;
    const SubLookup sub(world);
    const MacroGrid& grid = world.grid();
    bool changed = false;
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint32_t idx = dirty[i];
        const CellType now = sub.emitting_mat(grid, idx);
        if (now == f.mat[idx]) continue;
        const auto it = std::lower_bound(f.cells.begin(), f.cells.end(), idx);
        if (now == 0) {
            if (it != f.cells.end() && *it == idx) f.cells.erase(it);
        } else if (f.mat[idx] == 0) {
            f.cells.insert(it, idx);
        }
        f.mat[idx] = now;
        changed = true;
    }
    return changed;
}

std::vector<BakedLight> bake_material_lights(const EmitterField& f) {
    // Печатает собственную стоимость, как [rooms] в main.cpp: этот бейк
    // перепекается на карве прямо в кадре — слепых мест у планировщика
    // допекания быть не должно ([markoaudit/plans/async-rebake.md] §1 №4).
    const auto t0 = std::chrono::steady_clock::now();
    std::vector<BakedLight> out;
    if (f.cells.empty()) return out;

    // visited — по одному биту на ячейку тора; обход только по светоячейкам.
    std::vector<bool> visited(kMacroCells, false);

    for (const std::uint32_t seedIdx : f.cells) {
        if (visited[seedIdx]) continue;
        const CellType t = f.mat[seedIdx];
        const int x = static_cast<int>(seedIdx & (kMacroDim - 1));
        const int y = static_cast<int>((seedIdx >> 7) & (kMacroDim - 1));
        const int z = static_cast<int>(seedIdx >> 14);

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
                const std::uint32_t ni = flat_index(n.x, n.y, n.z);
                if (f.mat[ni] != t) continue;
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
    const double ms = std::chrono::duration<double, std::milli>(
                          std::chrono::steady_clock::now() - t0)
                          .count();
    std::fprintf(stderr, "[lights] baked %zu emitters in %.2f ms\n", out.size(),
                 ms);
    return out;
}

} // namespace giga::game
