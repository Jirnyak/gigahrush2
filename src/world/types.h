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

// ---- ДАЛЬНОСТЬ ВИДИМОСТИ — ДОЛИ ПЕРИОДА ТОРА, А НЕ ВКУС -------------------
// Два числа, которые до 2026-11-06 жили ЧЕТЫРЬМЯ безымянными литералами:
// `0.5f` в радиусе отбора ламп, `0.50f` в fogEnd отбора пропов и пара
// `0.25f`/`0.50f` в `push.fog` ([app/main.cpp]). Четыре копии одного закона
// нельзя сличить глазами — поэтому имя, и поэтому ЗДЕСЬ: `kWorldExtent` живёт
// строкой выше, а доля без своего периода бессмысленна.
//
// ВЫВОД kFogEndFrac = 1/2. Это НЕ выбор дальности, это ПРЕДЕЛ, который кладёт
// топология. Мир — тор периода kWorldExtent, и рендер рисует каждую геометрию
// в её БЛИЖАЙШЕМ образе (`nearest_image`, [core/wrap.h]): на расстоянии больше
// половины периода ближайший образ точки оказывается ПОЗАДИ наблюдателя, то
// есть луч, пущенный дальше period/2, возвращается в тот же мир с другой
// стороны и упирается в собственный хвост. Поэтому tCap марша = 128 м — не
// «столько решили показывать», а «дальше показывать НЕЧЕГО, кроме повтора».
// Та же половина period/2 названа в [core/wrap.h]: «fog reaches full black at
// exactly period/2» — туман смыкается в чёрный ровно там, где кончается
// однозначность, и шов тора не читается по построению.
//
// ВЫВОД kFogStartFrac = kFogEndFrac / 2. Дымка обязана ЗАНИМАТЬ отрезок:
// `distance_fog` — это `smoothstep(start, end, d)` ([shaders/volumetric_fog.glsl]),
// у которого нулевая производная на обоих концах только при непустом
// интервале; ноль-длины интервал дал бы ступеньку, то есть ровно ту «границу
// видимости», которую смыкание в чёрный и прячет. Деление однозначной
// дальности ПОПОЛАМ — единственная точка, не вносящая пятого числа: ближняя
// половина (0–64 м) честная, дальняя (64–128 м) тонет. Отсюда же шкала
// бюджетов шейдера («вблизи / до старта дымки / дальше») — у неё те же две
// границы.
//
// ЧИСЛА БЕЗ ПОГОДЫ. Это НОМИНАЛ. Самосбор сжимает дымку живым множителем
// (`samosbor_fog_scale`, до 0.34), и этот множитель — дело РЕНДЕРА: он остаётся
// там, где и был, в `push.fog`. Система присутствия ([sim/presence.h]) берёт
// именно эти номинальные доли, и причина названа в её шапке: радиус, зависящий
// от состояния мира, нарушил бы коммутацию (matwej.md §23.1).
inline constexpr float kFogEndFrac = 0.50f;
inline constexpr float kFogStartFrac = kFogEndFrac / 2.0f;
static_assert(kWorldExtent * kFogEndFrac == 128.0f,
              "предел однозначной дальности на торе = period/2 = 128 м; если "
              "поехал kMacroDim или kCellSize — поехал и tCap марша");
static_assert(kWorldExtent * kFogStartFrac == 64.0f,
              "старт дымки = половина однозначной дальности = 64 м");

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
