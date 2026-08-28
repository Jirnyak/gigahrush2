// Телесная проходимость — закон и его три формы. Контракт в body_walk.h.

#include "game/body_walk.h"

#include "world/macro_grid.h"
#include "world/walk_bits.h"

namespace giga::game {
namespace {

// Планка — «не полностью твёрдое» была бы 1-в-512: коллизия точна по
// субвокселям ([sim/physics.cpp] aabb_overlaps_solid), и клетка с одним
// вырезанным вокселем проходила старый тест и останавливала тело намертво.
// След тела: центрированные 4x4 субвокселя. sub_bit пакует sx + sy*kSubDim,
// так что один ряд следа — байт.
inline constexpr std::uint64_t kBodyFootprint = [] {
    std::uint64_t m = 0;
    for (int sy = 2; sy <= 5; ++sy)
        for (int sx = 2; sx <= 5; ++sx)
            m |= std::uint64_t{1} << (sx + sy * kSubDim);
    return m;
}();
// 1.7 м тела — 7 из 8 суб-слоёв клетки, значит ровно один запасной: колонка
// может начинаться со слоя 0 ИЛИ слоя 1 и нигде больше. Обе реальны:
// старт 1 — клетка, чей нижний суб-слой И ЕСТЬ ходовая поверхность, старт 0 —
// клетка с материей в потолке («сэндвич-перемычка», [world/macro_grid.h]).
// Требование слоёв 0..6 в одиночку называло каждую несущую клетку стеной.
inline constexpr int kBodySubLayers = 7;

// Чистая функция ОДНОЙ SubMask — на этом стоит оракульная машинерия: закон
// читает только маску, поэтому этаж — битсет, а карв — O(1) пере-вывод.
inline bool blocked(const SubMask& m) {
    for (int start = 0; start + kBodySubLayers <= kSubDim; ++start) {
        bool clear = true;
        for (int i = 0; i < kBodySubLayers && clear; ++i)
            if ((m.words[start + i] & kBodyFootprint) != 0) clear = false;
        if (clear) return false;
    }
    return true;
}

} // namespace

bool room_body_walkable(const MacroGrid& grid, int x, int y, int z) {
    return !blocked(grid.mask(x, y, z));
}

bool room_body_walkable_mask(const SubMask& m) { return !blocked(m); }

void build_body_walk_bits(const MacroGrid& grid, WalkBits& out) {
    out.build([&grid](int x, int y, int z) {
        return !blocked(grid.mask(x, y, z));
    });
}

void patch_body_walk_bit(WalkBits& bits, std::size_t cell, const SubMask& m) {
    bits.set(cell, !blocked(m));
}

} // namespace giga::game
