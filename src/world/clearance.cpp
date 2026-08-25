#include "world/clearance.h"

#include "core/jobs.h"       // parallel_for — бейк жмёт ядра, как walk_bits
#include "world/macro_grid.h"

namespace giga {
namespace {

// Вся бит-магия ниже расписана под 8×8: слово маски = слой, байт слова =
// ряд. types.h объявляет kSubDim подкруткой («flipping kSubDim is a one-line
// change») — если это случится, здесь обязан упасть компилятор, а не тихо
// поехать геометрия.
static_assert(kSubDim == 8, "clearance bit tricks are written for 8x8x8 masks");
static_assert(kSubMaskWords == kSubDim, "one mask word per sub-layer");

constexpr std::uint64_t kLoNibbles = 0x0F0F0F0F0F0F0F0Full;
constexpr std::uint64_t kHiNibbles = 0xF0F0F0F0F0F0F0F0ull;
constexpr std::uint64_t kNo7F      = 0x7F7F7F7F7F7F7F7Full;
// Сборка МЛАДШИХ битов восьми байтов в один байт: у флага байта i вес 2^i.
// Умножение раскладывает x*C = Σ флаг_i * (C << 8i); байты C подобраны так,
// что в старший байт произведения каждый флаг приносит ровно бит 2^i, без
// переносов (каждый вклад — одиночный бит своей позиции).
constexpr std::uint64_t kLsbGather = 0x0102040810204080ull;

// Флаг «байт непуст» в СТАРШИЙ бит каждого байта: сложение 0x7F переносит в
// бит 7 при любом ненулевом младшем семибитье, OR с исходником ловит сам бит 7.
inline std::uint64_t byte_nonzero_msb(std::uint64_t t) {
    return (((t & kNo7F) + kNo7F) | t) & ~kNo7F;
}

// 8 флагов «байт непуст» одним байтом: байт i → бит i.
inline std::uint64_t pack_byte_flags(std::uint64_t t) {
    return ((byte_nonzero_msb(t) >> 7) * kLsbGather) >> 56;
}

// Твёрдая проекция ПОЛОВИНЫ клетки вдоль `axis`: битмап 8×8 (u64), бит (u,v)
// = «в половине есть атом с этими тангенциальными координатами». `high` —
// половина у старшей грани оси (переход +axis), иначе у младшей. Раскладка
// (u,v) на осях-соседях фиксирована ОДИНАКОВО для обеих клеток перехода —
// только это и нужно, чтобы AND проекций сравнивал соосные столбцы:
//   axis 0 (x): (u,v) = (sy,sz);  axis 1 (y): (u,v) = (sx,sz);
//   axis 2 (z): (u,v) = (sx,sy).
std::uint64_t half_proj_solid(const SubMask& m, int axis, bool high) {
    if (axis == 2) {
        // Z — ось упаковки: половина = 4 слова, проекция = их OR.
        const int s0 = high ? kSubDim / 2 : 0;
        return m.words[s0] | m.words[s0 + 1] | m.words[s0 + 2] | m.words[s0 + 3];
    }
    std::uint64_t proj = 0;
    if (axis == 0) {
        // X: половина — нибл каждого байта (sx 0..3 младший, 4..7 старший);
        // ряд проекции (по sy) собирается флагами непустых ниблов.
        const std::uint64_t half = high ? kHiNibbles : kLoNibbles;
        for (int sz = 0; sz < kSubDim; ++sz)
            proj |= pack_byte_flags(m.words[sz] & half) << (sz * kSubDim);
    } else {
        // Y: половина — старшие/младшие 4 байта слова; OR четырёх байтов
        // побитно (сдвиги кратны байту — линии sx не перемешиваются).
        for (int sz = 0; sz < kSubDim; ++sz) {
            std::uint64_t h = high ? (m.words[sz] >> 32)
                                   : (m.words[sz] & 0xFFFFFFFFull);
            h |= h >> 16;
            h |= h >> 8;
            proj |= (h & 0xFFull) << (sz * kSubDim);
        }
    }
    return proj;
}

// Все три плюс-нибла клетки одним значением.
inline std::uint16_t cell_faces(const MacroGrid& g, int x, int y, int z) {
    return static_cast<std::uint16_t>(
        face_clearance_at(g, x, y, z, 0) |
        (face_clearance_at(g, x, y, z, 1) << 4) |
        (face_clearance_at(g, x, y, z, 2) << 8));
}

} // namespace

int max_square(std::uint64_t bitmap) {
    // Эрозия: выживает бит, у которого живы соседи (u+1), (v+1), (u+1,v+1) —
    // после k итераций выжившие биты = левые-нижние углы сплошных квадратов
    // (k+1)×(k+1). Сдвиг на 1 и на 9 затаскивает бит u=0 следующего ряда в
    // u=7 текущего — kNo7F гасит ровно эту колонку заворота.
    int s = 0;
    std::uint64_t b = bitmap;
    while (b != 0) {
        ++s;
        b &= ((b >> 1) & kNo7F);
        b &= (b >> kSubDim);
    }
    return s;
}

std::uint8_t face_clearance_at(const MacroGrid& g, int x, int y, int z,
                               int axis) {
    const int nx = axis == 0 ? wrap_macro(x + 1) : x;
    const int ny = axis == 1 ? wrap_macro(y + 1) : y;
    const int nz = axis == 2 ? wrap_macro(z + 1) : z;
    return face_clearance(g.mask(x, y, z), g.mask(nx, ny, nz), axis);
}

std::uint8_t face_clearance(const SubMask& a, const SubMask& b, int axis) {
    // Обе половины пусты — самый массовый случай этажа (воздух над воздухом):
    // ответ 8 без проекций и эрозии.
    const std::uint64_t solid = half_proj_solid(a, axis, /*high=*/true) |
                                half_proj_solid(b, axis, /*high=*/false);
    if (solid == 0) return static_cast<std::uint8_t>(kSubDim);
    return static_cast<std::uint8_t>(max_square(~solid));
}

void ClearanceField::build(const MacroGrid& grid) {
    vals.assign(kMacroCells, 0);
    std::uint16_t* out = vals.data();
    parallel_for(kMacroDim, [&grid, out](int z) {
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                out[macro_index(x, y, z)] = cell_faces(grid, x, y, z);
    });
}

void ClearanceField::patch(const MacroGrid& grid, int x, int y, int z) {
    if (vals.empty()) return; // поле не построено — нечего чинить
    const int cx = wrap_macro(x);
    const int cy = wrap_macro(y);
    const int cz = wrap_macro(z);
    // Свои три плюс-грани...
    vals[macro_index(cx, cy, cz)] = cell_faces(grid, cx, cy, cz);
    // ...и плюс-грань каждого соседа с минус-стороны: их переходы читают
    // МЛАДШУЮ половину этой маски, значит изменивший её писатель платит и им.
    const int mx = wrap_macro(cx - 1);
    const int my = wrap_macro(cy - 1);
    const int mz = wrap_macro(cz - 1);
    auto redo = [&grid, this](int px, int py, int pz, int axis) {
        std::uint16_t& v = vals[macro_index(px, py, pz)];
        v = static_cast<std::uint16_t>(
            (v & ~(0xFu << (4 * axis))) |
            (static_cast<std::uint16_t>(face_clearance_at(grid, px, py, pz, axis))
             << (4 * axis)));
    };
    redo(mx, cy, cz, 0);
    redo(cx, my, cz, 1);
    redo(cx, cy, mz, 2);
}

} // namespace giga
