// Core world dimensions and index math.
//
// The world is a monolith: a single flat 128^3 macro grid, where every macro
// cell is further subdivided into an 8^3 block of sub-voxels tracked as a bit
// mask. These two constants are the only knobs; everything else derives from
// them. Flipping kSubDim to 16 (512-voxel blocks) is a one-line change here,
// though it grows the per-cell mask (see macro_grid.h).
#pragma once
#include <cstddef>
#include <cstdint>

#include "core/wrap.h"

namespace giga {

// Macro grid: 128 cells per axis, wrapped (torus).
inline constexpr int kMacroDim = 128;
inline constexpr std::size_t kMacroCells =
    static_cast<std::size_t>(kMacroDim) * kMacroDim * kMacroDim;

// Sub-voxel block: 8 voxels per axis inside each macro cell => 512 voxels,
// which packs exactly into 8 x uint64_t. Change to 16 for 4096-voxel blocks.
inline constexpr int kSubDim = 8;
inline constexpr int kSubVoxels = kSubDim * kSubDim * kSubDim;
inline constexpr std::size_t kSubMaskWords = (kSubVoxels + 63) / 64;

// World-space size of one macro cell along an axis (arbitrary units). One
// sub-voxel is therefore kCellSize / kSubDim. Physics and rendering share this
// so a unit in the ECS Transform maps directly onto the grid.
// One macro cell is ~2 metres on a side (matching the reference game's block
// scale), so one sub-voxel is 2 / kSubDim = 0.25 m. Gravity, jump, and move
// speeds are expressed in metres, so keeping the cell physical makes those
// numbers read as real m/s and m/s^2.
inline constexpr float kCellSize = 2.0f;
inline constexpr float kVoxelSize = kCellSize / static_cast<float>(kSubDim);

// World-space extent of the whole torus along one axis. Entity positions wrap
// modulo this, so moving off any face re-enters from the opposite one.
inline constexpr float kWorldExtent = kMacroDim * kCellSize;

// Flat index into a 128^3 array. Caller must pass in-range coordinates; use
// wrap_macro() first for toroidal access.
inline std::size_t macro_index(int x, int y, int z) {
    return static_cast<std::size_t>(x)
         + static_cast<std::size_t>(y) * kMacroDim
         + static_cast<std::size_t>(z) * kMacroDim * kMacroDim;
}

// Wrap a macro coordinate onto the torus.
inline int wrap_macro(int c) { return wrapi(c, kMacroDim); }

// Flat bit index of a sub-voxel within a macro cell's 8^3 block.
inline int sub_bit(int sx, int sy, int sz) {
    return sx + sy * kSubDim + sz * kSubDim * kSubDim;
}

} // namespace giga

// ---- ЗАКОН СТЕПЕНИ ДВОЙКИ: БЛОК КОНТУРА -----------------------------------
// Включение стоит ЗДЕСЬ, а не в шапке, по двум причинам: внутри `namespace
// giga` его ставить нельзя (`<bit>` уехал бы в наше пространство имён), а
// наверху оно сдвинуло бы весь файл на строку и сгноило бы каждую ссылку
// документов в него.
//
// Это ТОТ САМЫЙ файл, про который CANON S1/S2 говорят «128³» и «8³ на клетку»,
// а шапка выше обещает: «These two constants are the only knobs; everything
// else derives from them». Обещание верно ровно до тех пор, пока оба knob'а —
// степени двойки: `macro_index` сворачивается в сдвиги, `wrap_macro` — в маску,
// `sub_bit` — в смещение. До 2026-10-01 это держалось шапкой и ничем больше.
#include "core/po2.h"

GIGA_PO2(giga::kMacroDim);
GIGA_PO2(giga::kSubDim);
GIGA_PO2(giga::kSubVoxels);

// ВЫВОД, А НЕ НАБЛЮДЕНИЕ. Эти три равенства — не повтор чисел словами: они
// утверждают, что сторона мира, сторона субблока и упаковка маски СВЯЗАНЫ, а
// не совпали. Поменял `kMacroDim` на 256 — равенства скажут, какое из
// производных чисел осталось старым.
static_assert(giga::po2_log2(giga::kMacroDim) == 7,
              "сторона мира 128 = 2^7: адрес клетки берётся сдвигом на 7, и "
              "это число живёт в GIGA_MACRO_DIM, который CMakeLists парсит "
              "отсюда и раздаёт шейдерам (-DGIGA_*)");
static_assert(giga::po2_log2(giga::kSubDim) == 3,
              "сторона субблока 8 = 2^3: sub_bit складывает три сдвига по 3");
static_assert(giga::kSubMaskWords * 64 == giga::kSubVoxels,
              "512 субвокселей упаковываются В ТОЧНОСТИ в 8 слов по 64 бита — "
              "без остатка и без хвостового слова с мусорными битами. Это и "
              "есть причина, по которой сторона субблока обязана быть "
              "степенью двойки: полубитовое слово сделало бы маску ЛОЖЬЮ в "
              "старших битах, и `full()` перестал бы отвечать правду.");
