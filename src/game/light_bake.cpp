#include "game/light_bake.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "world/macro_grid.h"
#include "world/destruct.h"  // kSubMaterialName, kSubGridDim
#include "world/material_props.h"
#include "world/subfield.h"
#include "world/types.h"
#include "world/world.h"

namespace giga::game {

namespace {

// Плоский индекс ячейки (равен macro_index: 128 = 2^7).
inline std::uint32_t cell_index(int x, int y, int z) {
    x &= (kMacroDim - 1);
    y &= (kMacroDim - 1);
    z &= (kMacroDim - 1);
    return static_cast<std::uint32_t>(x) |
           (static_cast<std::uint32_t>(y) << 7) |
           (static_cast<std::uint32_t>(z) << 14);
}

// Плоский индекс АТОМА в субвоксельной сетке тора 1024³ (10 бит на ось).
inline std::uint32_t atom_index(int ax, int ay, int az) {
    ax &= kSubGridMask;
    ay &= kSubGridMask;
    az &= kSubGridMask;
    return static_cast<std::uint32_t>(ax) |
           (static_cast<std::uint32_t>(ay) << 10) |
           (static_cast<std::uint32_t>(az) << 20);
}

// СВЕТЯЩИЙСЯ АТОМ = ПРИСУТСТВУЕТ ∧ МАТЕРИАЛ СВЕТИТ (закон двух масштабов,
// CANON S2: локальный вопрос обязан спрашивать субвоксели). Карв чистит только
// маску присутствия (remove_key), материал страницы живёт до опустения клетки —
// бейк, спрашивавший одни материалы, считал выбитые атомы светящимися.
// Однородная ячейка без страницы остаётся быстрым путём.
struct SubLookup {
    const SubMask* masks;
    const CellType* types;
    const std::uint32_t* pageTab = nullptr;
    const CellType* pages = nullptr;

    explicit SubLookup(const World& world)
        : masks(world.grid().masks().data()),
          types(world.grid().types().data()) {
        const SubField<CellType>* sub =
            world.subfields().find<CellType>(kSubMaterialName);
        if (sub) {
            pageTab = sub->page_table();
            pages = sub->pages_data();
        }
    }

    // Светящиеся атомы ячейки: материал первого (0 — нет ни одного) и их
    // маска в *out.
    CellType emitting_scan(std::uint32_t idx, SubMask* out) const {
        const SubMask& occ = masks[idx];
        const std::uint32_t pg =
            pageTab ? pageTab[idx] : SubField<CellType>::kNoPage;
        if (pg == SubField<CellType>::kNoPage) {
            const CellType t = types[idx];
            if (!material_emits_light(t) || occ.empty()) return 0;
            if (out) *out = occ;
            return t;
        }
        const CellType* atoms =
            pages + static_cast<std::size_t>(pg) * kSubVoxels;
        CellType first = 0;
        SubMask m;
        for (int b = 0; b < kSubVoxels; ++b) {
            if (!occ.test(b)) continue;
            if (!material_emits_light(atoms[b])) continue;
            m.set(b);
            if (first == 0) first = atoms[b];
        }
        if (first != 0 && out) *out = m;
        return first;
    }

    // Материал атома, про который поле уже сказало «светит» (бит emitMask).
    CellType emitting_atom_mat(std::uint32_t cellIdx, int bit) const {
        const std::uint32_t pg =
            pageTab ? pageTab[cellIdx] : SubField<CellType>::kNoPage;
        if (pg == SubField<CellType>::kNoPage) return types[cellIdx];
        return pages[static_cast<std::size_t>(pg) * kSubVoxels + bit];
    }
};

inline bool same_mask(const SubMask& a, const SubMask& b) {
    return std::memcmp(a.words, b.words, sizeof(a.words)) == 0;
}

} // namespace

void rebuild_emitter_field(const World& world, EmitterField& f) {
    const auto t0 = std::chrono::steady_clock::now();
    const SubLookup sub(world);
    f.mat.assign(kMacroCells, 0);
    f.cells.clear();
    f.emitMask.clear();
    // Обход по возрастанию индекса ⇒ cells отсортирован по построению.
    for (std::uint32_t idx = 0; idx < kMacroCells; ++idx) {
        SubMask m;
        const CellType t = sub.emitting_scan(idx, &m);
        if (t == 0) continue;
        f.mat[idx] = t;
        f.cells.push_back(idx);
        f.emitMask.push_back(m);
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
    bool changed = false;
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint32_t idx = dirty[i];
        SubMask now;
        const CellType matNow = sub.emitting_scan(idx, &now);
        const auto it = std::lower_bound(f.cells.begin(), f.cells.end(), idx);
        const std::size_t pos =
            static_cast<std::size_t>(it - f.cells.begin());
        const bool present = it != f.cells.end() && *it == idx;
        if (matNow == 0) {
            if (!present) continue;
            f.cells.erase(it);
            f.emitMask.erase(f.emitMask.begin() +
                             static_cast<std::ptrdiff_t>(pos));
            f.mat[idx] = 0;
            changed = true;
            continue;
        }
        if (!present) {
            f.cells.insert(it, idx);
            f.emitMask.insert(
                f.emitMask.begin() + static_cast<std::ptrdiff_t>(pos), now);
            f.mat[idx] = matNow;
            changed = true;
            continue;
        }
        if (f.mat[idx] != matNow || !same_mask(f.emitMask[pos], now)) {
            f.mat[idx] = matNow;
            f.emitMask[pos] = now;
            changed = true;
        }
    }
    return changed;
}

std::vector<BakedLight> bake_material_lights(const World& world,
                                             const EmitterField& f,
                                             EmitterClusters& c) {
    // Печатает собственную стоимость, как [rooms] в main.cpp: этот бейк
    // перепекается на карве прямо в кадре — слепых мест у планировщика
    // допекания быть не должно ([markoaudit/plans/async-rebake.md] §1 №4).
    const auto t0 = std::chrono::steady_clock::now();
    std::vector<BakedLight> out;
    if (f.cells.empty()) {
        c.atomOwner.clear();
        return out;
    }
    const SubLookup sub(world);

    // Позиция ячейки в списке светоячеек поля; -1 — в ячейке нет светящихся
    // атомов, а компонента состоит только из них.
    const auto cell_pos = [&f](std::uint32_t idx) -> std::ptrdiff_t {
        const auto it = std::lower_bound(f.cells.begin(), f.cells.end(), idx);
        if (it == f.cells.end() || *it != idx) return -1;
        return it - f.cells.begin();
    };

    // Связные 6-компоненты светящихся АТОМОВ; visited — маска на светоячейку.
    // Координаты в обходе НЕврапнутые относительно затравки, чтобы центроид
    // кластера на шве тора не разъехался на полмира.
    struct Comp {
        CellType t = 0;
        std::vector<std::uint32_t> atoms; // врапнутые atom_index
        long sx = 0, sy = 0, sz = 0;      // суммы неврапнутых координат
        ivec3 lo{0, 0, 0}, hi{0, 0, 0};   // бокс неврапнутый
        std::uint32_t id = 0;
    };
    std::vector<Comp> comps;
    std::vector<SubMask> visited(f.cells.size());
    std::vector<ivec3> open; // стек неврапнутых координат атомов

    for (std::size_t k = 0; k < f.cells.size(); ++k) {
        const std::uint32_t idx = f.cells[k];
        const int cx = static_cast<int>(idx & (kMacroDim - 1));
        const int cy = static_cast<int>((idx >> 7) & (kMacroDim - 1));
        const int cz = static_cast<int>(idx >> 14);
        for (int bit = 0; bit < kSubVoxels; ++bit) {
            if (!f.emitMask[k].test(bit)) continue;
            if (visited[k].test(bit)) continue;
            const int ax = cx * kSubDim + (bit & (kSubDim - 1));
            const int ay = cy * kSubDim + ((bit / kSubDim) & (kSubDim - 1));
            const int az = cz * kSubDim + bit / (kSubDim * kSubDim);

            Comp comp;
            comp.t = sub.emitting_atom_mat(idx, bit);
            visited[k].set(bit);
            comp.atoms.push_back(atom_index(ax, ay, az));
            comp.sx = ax; comp.sy = ay; comp.sz = az;
            comp.lo = ivec3{ax, ay, az};
            comp.hi = ivec3{ax, ay, az};
            open.clear();
            open.push_back(ivec3{ax, ay, az});

            while (!open.empty()) {
                const ivec3 a = open.back();
                open.pop_back();
                static constexpr int kD[6][3] = {
                    {1, 0, 0}, {-1, 0, 0}, {0, 1, 0},
                    {0, -1, 0}, {0, 0, 1}, {0, 0, -1},
                };
                for (const auto& d : kD) {
                    const ivec3 nb{a.x + d[0], a.y + d[1], a.z + d[2]};
                    const int wx = nb.x & kSubGridMask;
                    const int wy = nb.y & kSubGridMask;
                    const int wz = nb.z & kSubGridMask;
                    const std::uint32_t nIdx = cell_index(
                        wx / kSubDim, wy / kSubDim, wz / kSubDim);
                    const std::ptrdiff_t np = cell_pos(nIdx);
                    if (np < 0) continue;
                    const int nBit = sub_bit(wx & (kSubDim - 1),
                                             wy & (kSubDim - 1),
                                             wz & (kSubDim - 1));
                    if (!f.emitMask[np].test(nBit)) continue;
                    if (visited[np].test(nBit)) continue;
                    if (sub.emitting_atom_mat(nIdx, nBit) != comp.t) continue;
                    visited[np].set(nBit);
                    open.push_back(nb);
                    comp.atoms.push_back(atom_index(wx, wy, wz));
                    comp.sx += nb.x; comp.sy += nb.y; comp.sz += nb.z;
                    comp.lo.x = nb.x < comp.lo.x ? nb.x : comp.lo.x;
                    comp.lo.y = nb.y < comp.lo.y ? nb.y : comp.lo.y;
                    comp.lo.z = nb.z < comp.lo.z ? nb.z : comp.lo.z;
                    comp.hi.x = nb.x > comp.hi.x ? nb.x : comp.hi.x;
                    comp.hi.y = nb.y > comp.hi.y ? nb.y : comp.hi.y;
                    comp.hi.z = nb.z > comp.hi.z ? nb.z : comp.hi.z;
                }
            }
            comps.push_back(std::move(comp));
        }
    }

    // НАСЛЕДОВАНИЕ ID ЧЕРЕЗ СВЯЗНОСТЬ. Все светящиеся атомы нового бейка,
    // отсортированные для поиска.
    std::vector<std::pair<std::uint32_t, std::uint32_t>> newAtoms; // атом→комп
    for (std::size_t i = 0; i < comps.size(); ++i)
        for (const std::uint32_t a : comps[i].atoms)
            newAtoms.emplace_back(a, static_cast<std::uint32_t>(i));
    std::sort(newAtoms.begin(), newAtoms.end());

    // Наследник прошлой компоненты — компонента её САМОГО МЛАДШЕГО выжившего
    // атома (atomOwner отсортирован по атому: первый найденный и есть
    // младший). Разделение: часть с младшим выжившим атомом наследует id,
    // прочие получают новые. Слияние: компонента собирает несколько прошлых
    // id и берёт младший, прочие умирают надгробиями в статик-таблице.
    std::vector<std::pair<std::uint32_t, std::uint32_t>> heirs; // прошлый id→комп
    for (const auto& [atom, oldId] : c.atomOwner) {
        bool seen = false;
        for (const auto& h : heirs)
            if (h.first == oldId) { seen = true; break; }
        if (seen) continue;
        const auto it = std::lower_bound(
            newAtoms.begin(), newAtoms.end(),
            std::pair<std::uint32_t, std::uint32_t>{atom, 0u});
        if (it != newAtoms.end() && it->first == atom)
            heirs.emplace_back(oldId, it->second);
    }
    for (std::size_t i = 0; i < comps.size(); ++i) {
        std::uint32_t id = 0;
        bool inherited = false;
        for (const auto& h : heirs)
            if (h.second == i && (!inherited || h.first < id)) {
                id = h.first;
                inherited = true;
            }
        comps[i].id = inherited ? id : c.nextId++;
    }
    c.atomOwner.clear();
    for (const Comp& comp : comps)
        for (const std::uint32_t a : comp.atoms)
            c.atomOwner.emplace_back(a, comp.id);
    std::sort(c.atomOwner.begin(), c.atomOwner.end());

    for (const Comp& comp : comps) {
        const float invN = 1.0f / static_cast<float>(comp.atoms.size());
        // Центр атома: (i + 0.5) * kVoxelSize; координаты неврапнутые —
        // add_light/wrap_nearest свернут к ближайшему образу сами.
        BakedLight l;
        l.pos = vec3{
            (static_cast<float>(comp.sx) * invN + 0.5f) * kVoxelSize,
            (static_cast<float>(comp.sy) * invN + 0.5f) * kVoxelSize,
            (static_cast<float>(comp.sz) * invN + 0.5f) * kVoxelSize};
        // Радиус = табличный + полудиагональ кластера: длинная полоса
        // неона освещает весь свой пролёт, а не пятно у центроида.
        const vec3 half{
            (static_cast<float>(comp.hi.x - comp.lo.x) + 1.0f) * 0.5f *
                kVoxelSize,
            (static_cast<float>(comp.hi.y - comp.lo.y) + 1.0f) * 0.5f *
                kVoxelSize,
            (static_cast<float>(comp.hi.z - comp.lo.z) + 1.0f) * 0.5f *
                kVoxelSize};
        const float halfDiag = std::sqrt(
            half.x * half.x + half.y * half.y + half.z * half.z);
        l.radiusM = static_cast<float>(kMatLightRadiusMm[comp.t]) * 0.001f +
                    halfDiag;
        l.color =
            vec3{kMatAlbedoR[comp.t], kMatAlbedoG[comp.t], kMatAlbedoB[comp.t]};
        l.intensity =
            static_cast<float>(kMatLightIntensityE3[comp.t]) * 0.001f;
        l.id = comp.id;
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
