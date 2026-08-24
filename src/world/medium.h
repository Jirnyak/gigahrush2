// АГРЕГАТЫ МАТЕРИИ НА КЛЕТКУ 128³ (CANON S16.4, инкремент 4) — обратная
// связь мира-автомата телам: уровень жидкости и концентрация газа клетки.
//
// НЕ отдельный редьюс-пасс и НЕ ридбек: обратный шов
// ([render/gpu_medium_pass.h]) уже везёт страницы изменённых клеток в
// CPU-канон — агрегат пересчитывается ТАМ ЖЕ, только по изменённым клеткам
// (O(512) на клетку), и хранится прямым массивом kMacroCells (единый закон
// ключа клетки = macro_index, [sim/cell_bins.h]). Спящая клетка держит
// последнее верное значение — спящая материя бесплатна и здесь (S16.1).
//
// Потребители читают КЛЕТКУ тела (S16.4: тело 4×4×7 субвокселей само
// размером с клетку — вопрос «в чём я» макроскопический): плавучесть и
// вязкость воды ([sim/physics.cpp]), дыхание/газ — те же читатели единым
// путём, спецсистем на газ не существует (S16.6).
//
// Колонка phase здесь ЗАКОННА (S16.2): агрегат — геймплейный предикат
// («жидкость даёт плавучесть, газ дышится»), не правило движения.
#pragma once

#include <cstdint>

#include "world/field.h"
#include "world/material_props.h"
#include "world/types.h"
#include "world/world.h"

namespace giga {

inline constexpr const char* kMediumLevelField = "medium_level";

// Нижние 16 бит — кванты жидкости клетки (0..512), верхние — кванты газа
// (не воздуха). Один u32 — одно поле, одна запись на клетку.
inline Field<std::uint32_t>& medium_level_field(World& w) {
    return w.fields().get_or_create<std::uint32_t>(kMediumLevelField);
}

inline std::uint32_t medium_level_at(const World& w, std::size_t ci) {
    const Field<std::uint32_t>* f =
        w.fields().find<std::uint32_t>(kMediumLevelField);
    return f ? f->data()[ci] : 0u;
}

// Доля объёма клетки под жидкостью / газом, 0..1.
inline float liquid_frac_at(const World& w, std::size_t ci) {
    return static_cast<float>(medium_level_at(w, ci) & 0xFFFFu) /
           static_cast<float>(kSubVoxels);
}
inline float gas_frac_at(const World& w, std::size_t ci) {
    return static_cast<float>(medium_level_at(w, ci) >> 16) /
           static_cast<float>(kSubVoxels);
}

// Пересчёт агрегата клетки по её странице материалов — зовёт обратный шов
// после memcpy страницы.
inline void medium_recount(World& w, std::size_t ci, const CellType* page) {
    std::uint32_t liq = 0, gas = 0;
    for (int b = 0; b < kSubVoxels; ++b) {
        const CellType m = page[b];
        if (m == kCellAir) continue;
        const MatPhase ph = material_phase(m);
        if (ph == MatPhase::Liquid) ++liq;
        else if (ph == MatPhase::Gas) ++gas;
    }
    medium_level_field(w).data()[ci] = liq | (gas << 16);
}

} // namespace giga
