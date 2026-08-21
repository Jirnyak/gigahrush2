// Клеточные бины — ОДИН примитив пространственного поиска «кто в этой
// макроклетке» (S11: один закон ключа и один контейнер; ПОЛИТИКА — у
// потребителя). До 2026-08-21 выражение ключа (layer<<32)|macro_index было
// выписано четырежды в rigid.cpp и ещё раз в prop_system.cpp, а контейнер
// «отсортированные (ключ, сущность)» — трижды. Потребители и их политика:
//
//   - sim/rigid.cpp     — пере-сборка раз на тик по подвижным телам; поверх
//                         бинов свой алгоритм: слияние отсортированных рангов
//                         в пары соседних клеток (13 передних смещений);
//   - game/prop_system  — §59.2: ПЕРСИСТЕНТНЫЕ бины неподвижных якорей,
//                         инвалидация сигналами EnTT на SubVoxelAnchor;
//   - game/combat       — §59.3: пере-сборка на вызов по толпе, ближайший
//                         к снаряду в 27 соседних бакетах.
//
// Контейнер = плоский вектор (ключ, сущность), отсортированный build()-ом;
// запрос — lower_bound. Никаких карт и аллокаций на запрос; память живёт у
// владельца и переиспользуется через clear().
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#include "ecs/registry.h"
#include "world/types.h"

namespace giga {

// Закон ключа — единственное место, где (слой, клетка) складываются в u64.
// Слой в старших битах: сортировка группирует сначала по слою, потом по
// плоскому индексу клетки — на этом стоит слияние соседей в rigid.cpp
// (ключ соседа = ключ + константа при фиксированном смещении).
inline std::uint64_t cell_bin_key(std::uint32_t layer, int cx, int cy, int cz) {
    return (static_cast<std::uint64_t>(layer) << 32) |
           static_cast<std::uint32_t>(
               macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz)));
}

// Макроклетка непрерывной координаты. std::floor, не int-каст: позиция чуть
// ниже нуля обязана уйти в клетку −1 (и завернуться), а не обрезаться к 0.
inline int cell_coord(float v) {
    return static_cast<int>(std::floor(v / kCellSize));
}

struct CellBins {
    struct Entry {
        std::uint64_t key;
        Entity e;
    };
    std::vector<Entry> entries; // после build() отсортированы по (key, e)

    void clear() { entries.clear(); }
    void add(std::uint64_t key, Entity e) { entries.push_back({key, e}); }

    // Порядок (ключ, сущность) детерминирован и не зависит от порядка
    // вставки: «первый найденный» у потребителя — свойство мира, а не
    // памяти (родня запрета фиксированных префиксов, S13.9).
    void build() {
        std::sort(entries.begin(), entries.end(),
                  [](const Entry& a, const Entry& b) {
                      return a.key != b.key ? a.key < b.key : a.e < b.e;
                  });
    }

    template <class F>
    void for_each_in(std::uint64_t key, F&& f) const {
        auto it = std::lower_bound(
            entries.begin(), entries.end(), key,
            [](const Entry& a, std::uint64_t k) { return a.key < k; });
        for (; it != entries.end() && it->key == key; ++it) f(it->e);
    }

    // Брод-фейз точки: 27 клеток вокруг (cx,cy,cz) на слое, wrap честный.
    // Покрывает точечный запрос радиуса ≤ kCellSize к сущностям, забиненным
    // по клетке ЦЕНТРА, — потребитель обязан заявить это static_assert-ом
    // на свой радиус (образец: kProjHitRadius в combat.cpp).
    template <class F>
    void for_each_near(std::uint32_t layer, int cx, int cy, int cz,
                       F&& f) const {
        for (int dz = -1; dz <= 1; ++dz)
            for (int dy = -1; dy <= 1; ++dy)
                for (int dx = -1; dx <= 1; ++dx)
                    for_each_in(cell_bin_key(layer, cx + dx, cy + dy, cz + dz),
                                f);
    }
};

} // namespace giga
