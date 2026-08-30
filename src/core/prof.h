// Кольцо замеров и его сводка — ядро профиля кадра (GIGA_PROF=1 в main.cpp).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Детектор [hitch] печатает разбор только на кадрах
// дороже порога (50 мс), а весь стационар между бюджетом (8 мс тика) и
// порогом — немой: §59.25 назвал эту слепую зону структурной причиной §58.
// Свод per-system строится из колец «мс за кадр по системе»; сама статистика
// (медиана/p90/пик по последним N кадрам) — чистая математика без единой
// зависимости, поэтому живёт в core и покрывается тестом напрямую, а не
// через прогон бинаря.
//
// РАЗМЕР 256 — тот же вывод, что у wallRing в main.cpp: p90 по 256 кадрам
// имеет ~26 точек в хвосте (достаточно, чтобы не дрожать), а 1 КиБ на кольцо
// позволяет держать их по числу систем не думая о памяти.
#pragma once

#include <algorithm>
#include <cstdint>

namespace giga {
namespace prof {

struct Ring {
    static constexpr std::uint32_t kCap = 256u;  // степень двойки: индекс = маска
    float v[kCap];
    std::uint32_t head = 0;  // всего записей за жизнь; пишем по head & (kCap-1)

    void push(float ms) noexcept {
        v[head & (kCap - 1u)] = ms;
        ++head;
    }
    std::uint32_t count() const noexcept { return head < kCap ? head : kCap; }
};

struct Stats {
    float median = 0.0f;
    float p90 = 0.0f;
    float peak = 0.0f;
};

// Копия + сортировка на стеке: зовётся раз в сотни кадров на печати свода,
// цена не входит ни в один замеряемый кадр (инструмент не искажает предмет).
inline Stats ring_stats(const Ring& r) noexcept {
    Stats s;
    const std::uint32_t n = r.count();
    if (n == 0) return s;
    float tmp[Ring::kCap];
    for (std::uint32_t i = 0; i < n; ++i) tmp[i] = r.v[i];
    std::sort(tmp, tmp + n);
    s.median = tmp[n / 2u];
    s.p90 = tmp[(n * 9u) / 10u];
    s.peak = tmp[n - 1u];
    return s;
}

}  // namespace prof
}  // namespace giga
