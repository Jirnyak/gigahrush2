// ПЕРЕПИСЬ «ГДЕ МЕНЯЮТСЯ МАСКИ» — прибор к вопросу, почему автомат среды не
// затихает (NEXT_SESSION.md, очередь п.1; CANON S26.5 «падающее — не
// геометрия»).
//
// ЗАЧЕМ. Счёт двери писателя (`[geom]`) говорит СКОЛЬКО автомат пишет масок —
// на плотной геометрии это тысячи записей и миллионы клеток за игровую
// сессию, — но не говорит ГДЕ. А версий причины три, и различает их именно
// «где»:
//   * вечное падение по кольцу тора: материя идёт вдоль оси гравитации
//     сквозь весь тор, значит маски меняются В КАЖДОМ слое вдоль низа, в
//     немногих колоннах, и поток не убывает со временем;
//   * переходный процесс (осыпь доосыпается): поток УБЫВАЕТ, слоёв занято
//     мало;
//   * возня на месте: клеток мало, записей много, слой один.
//
// Аудит (чтение кода) назвал первую. Это показание, а не доказательство —
// прибор для того и стоит.
//
// Чистая дата и чистые функции: копится в приложении, судится headless.
#pragma once

#include <bit>     // std::popcount — без __builtin_*: MSVC его не знает
#include <cstddef>
#include <cstdint>
#include <vector>

#include "world/types.h"

namespace giga::game {

// Окно потока — в тиках. 250 тиков = 2 секунды сима; тем же шагом печатаются
// `[smert]` и `[kray]`, так что строки логов ложатся друг на друга.
inline constexpr std::uint64_t kChurnWindowTicks = 250;

struct MaskChurn {
    std::uint64_t records = 0;          // клетко-записей всего
    std::vector<std::uint8_t> seen;     // kMacroCells: клетка менялась хоть раз
    // На колонну (пару поперечных осей) — 128 бит: какие слои вдоль низа
    // менялись. Два слова на колонну, kMacroDim² колонн.
    std::vector<std::uint64_t> depth;
    std::vector<std::uint32_t> window;  // записей в окне kChurnWindowTicks
    // ЗНАК записи (CANON S16.10 «падающее — не геометрия»): маску от автомата
    // меняют ровно два события — рыхлое УЛЕГЛОСЬ (бит встал) и рыхлое УШЛО с
    // места (бит погас). Биты по тем же окнам: равные ненулевые потоки
    // «легло» и «ушло» без конца — материя ложится и снимается по кругу, а
    // убывающее «ушло» при малом «легло» — куча стекает в вечное падение.
    std::vector<std::uint32_t> laid;    // битов встало в окне
    std::vector<std::uint32_t> gone;    // битов погасло в окне
};

// Учесть знак: сколько битов маски встало и сколько погасло в этом кадре шва.
inline void mask_churn_bits(MaskChurn& c, std::uint32_t laidBits,
                            std::uint32_t goneBits, std::uint64_t tick) {
    if (laidBits == 0 && goneBits == 0) return;
    const std::size_t w = static_cast<std::size_t>(tick / kChurnWindowTicks);
    if (c.laid.size() <= w) {
        c.laid.resize(w + 1, 0);
        c.gone.resize(w + 1, 0);
    }
    c.laid[w] += laidBits;
    c.gone[w] += goneBits;
}

// Учесть пачку изменённых клеток. `axis` — ось низа фрейма (0/1/2): глубина
// клетки есть её координата вдоль этой оси, колонна — две остальные.
inline void mask_churn_add(MaskChurn& c, const std::uint32_t* cells,
                           std::size_t n, int axis, std::uint64_t tick) {
    if (n == 0) return;
    if (c.seen.empty()) {
        c.seen.assign(kMacroCells, 0);
        c.depth.assign(static_cast<std::size_t>(kMacroDim) * kMacroDim * 2, 0);
    }
    const std::size_t w = static_cast<std::size_t>(tick / kChurnWindowTicks);
    if (c.window.size() <= w) c.window.resize(w + 1, 0);
    c.window[w] += static_cast<std::uint32_t>(n);
    c.records += n;
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint32_t ci = cells[i];
        if (ci >= kMacroCells) continue;
        c.seen[ci] = 1;
        const int x = static_cast<int>(ci % kMacroDim);
        const int y = static_cast<int>((ci / kMacroDim) % kMacroDim);
        const int z = static_cast<int>(ci / (kMacroDim * kMacroDim));
        const int d = axis == 0 ? x : axis == 1 ? y : z;
        const int a = axis == 0 ? y : x;
        const int b = axis == 2 ? y : z;
        const std::size_t col =
            (static_cast<std::size_t>(b) * kMacroDim + a) * 2;
        c.depth[col + (d >> 6)] |= 1ull << (d & 63);
    }
}

struct MaskChurnSummary {
    std::uint64_t records = 0;   // клетко-записей
    std::uint32_t cells = 0;     // разных клеток
    std::uint32_t columns = 0;   // разных колонн
    // СКВОЗНЫЕ колонны: менялись почти во всех слоях оси. Порог — без
    // одного бина зон (8 клеток): вечному потоку позволено не дойти до
    // пары слоёв у шва за время прогона, но не до целого бина.
    std::uint32_t through = 0;
    std::uint32_t depthsUsed = 0; // слоёв вдоль низа, где менялась хоть клетка
    std::uint32_t flowFirst = 0;  // записей в первой половине окон
    std::uint32_t flowLast = 0;   // во второй
    // Знак, теми же половинами окон: битов встало (улеглось) и погасло (ушло).
    std::uint64_t laidFirst = 0, laidLast = 0;
    std::uint64_t goneFirst = 0, goneLast = 0;
};

inline constexpr int kChurnThroughDepths = kMacroDim - 8;

inline MaskChurnSummary mask_churn_summary(const MaskChurn& c) {
    MaskChurnSummary s;
    s.records = c.records;
    for (std::uint8_t v : c.seen) s.cells += v;
    std::uint64_t any[2] = {0, 0};
    for (std::size_t col = 0; col + 1 < c.depth.size(); col += 2) {
        const std::uint64_t lo = c.depth[col], hi = c.depth[col + 1];
        if ((lo | hi) == 0) continue;
        ++s.columns;
        any[0] |= lo;
        any[1] |= hi;
        const int bits = std::popcount(lo) + std::popcount(hi);
        if (bits >= kChurnThroughDepths) ++s.through;
    }
    s.depthsUsed = static_cast<std::uint32_t>(std::popcount(any[0]) +
                                              std::popcount(any[1]));
    const std::size_t half = c.window.size() / 2;
    for (std::size_t i = 0; i < c.window.size(); ++i)
        (i < half ? s.flowFirst : s.flowLast) += c.window[i];
    // Половины — те же, что у потока записей: знак обязан ложиться на него.
    for (std::size_t i = 0; i < c.laid.size(); ++i) {
        (i < half ? s.laidFirst : s.laidLast) += c.laid[i];
        (i < half ? s.goneFirst : s.goneLast) += c.gone[i];
    }
    return s;
}

} // namespace giga::game
