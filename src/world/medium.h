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
#include "world/subfield.h" // SubField — этап «оживление сред» ходит по страницам
#include "world/types.h"
#include "world/world.h"

namespace giga {

inline constexpr const char* kMediumLevelField = "medium_level";

// ПОДВИЖНОСТЬ КЛЕТКИ — второй агрегат, рядом с уровнем и из того же разбора.
// Он существует потому, что уровень отвечает НЕ НА ТОТ вопрос: medium_level
// считается по ФАЗЕ (Liquid|Gas), а движение в автомате — по СТРОКЕ материала
// (`mobile()` в medium_sim.comp: flow>0 || diffusion>0). Все 16 строк rubble
// подвижны (flow 1.0) при фазе Solid, поэтому будильник этажа, спрашивавший
// уровень, структурно НЕ ВИДЕЛ висящую кучу рыхлого из сейва — она не
// просыпалась ничем (корень В2; тот же корень заставил cell_full_static
// затачивать особый случай). Спрашивать надо строку — S16.2: «фаза — метка для
// геймплея, параметры — для движения».
inline constexpr const char* kMediumMobileField = "medium_mobile";

// Имя поля-засева газа у генераторов (перенос из УМЕРШЕГО sim/fluid.h —
// чистка 2026-08-24: fluid-сим и поле воды вычищены, вода = материя).

// Порог «мокро» для поведения (спавн, слизни, звук): 8 квантов = 125 л на
// клетку — заметная лужа, не плёнка. Вывод: меньше ведра — не мокро.
inline constexpr std::uint32_t kWetQuanta = 8;

// Нижние 16 бит — кванты жидкости клетки (0..512), верхние — кванты газа
// (не воздуха). Один u32 — одно поле, одна запись на клетку.
inline Field<std::uint32_t>& medium_level_field(World& w) {
    return w.fields().get_or_create<std::uint32_t>(kMediumLevelField);
}

// Прямой массив уровней для горячих потребителей (спавн: до 98k кандидатов
// на загрузке этажа) — nullptr, пока автомат ничего не вернул швом.
inline const std::uint32_t* medium_level_data(const World& w) {
    const Field<std::uint32_t>* f =
        w.fields().find<std::uint32_t>(kMediumLevelField);
    return f ? f->data().data() : nullptr;
}

inline Field<std::uint8_t>& medium_mobile_field(World& w) {
    return w.fields().get_or_create<std::uint8_t>(kMediumMobileField);
}

inline const std::uint8_t* medium_mobile_data(const World& w) {
    const Field<std::uint8_t>* f =
        w.fields().find<std::uint8_t>(kMediumMobileField);
    return f ? f->data().data() : nullptr;
}

// РАЗБОР КЛЕТКИ — ОДИН на всех (S11: закон живёт в одном месте). Его зовут
// обход рождения этажа ([world/floor_awaken.h], все клетки разом) и обратный
// шов автомата ([render/gpu_medium_pass.cpp], только изменённые) — потому
// уровень и подвижность не могут разъехаться: они выходят из одного прохода по
// одной странице.
struct MediumDigest {
    std::uint32_t liq = 0; // квантов жидкости (фаза — геймплейный предикат)
    std::uint32_t gas = 0; // квантов газа
    bool mobile = false;   // есть ли атом, который АВТОМАТ может двинуть
};

// Страничная клетка: правда — атомы страницы.
inline MediumDigest medium_digest_page(const CellType* page) {
    MediumDigest d;
    for (int b = 0; b < kSubVoxels; ++b) {
        const CellType m = page[b];
        if (m == kCellAir) continue; // воздух подвижен, но не ИСТОЧНИК хода
        const MatPhase ph = material_phase(m);
        if (ph == MatPhase::Liquid) ++d.liq;
        else if (ph == MatPhase::Gas) ++d.gas;
        if (material_is_medium(m)) d.mobile = true;
    }
    return d;
}

// Беcстраничная клетка: правда — тип и маска, по закону чтения
// ([world/destruct.cpp], двойник sub_material_at). Уровень берётся только у
// пустой маски (у непустой маски тип — материал ТВЁРДЫХ атомов), а подвижность
// — по строке и потому ловит монолит рыхлого с ПОЛНОЙ маской: ровно тот случай,
// который терял прежний будильник.
inline MediumDigest medium_digest_uniform(CellType t, const SubMask& m) {
    MediumDigest d;
    if (t == kCellAir) return d;
    if (m.empty()) {
        const MatPhase ph = material_phase(t);
        if (ph == MatPhase::Liquid) d.liq = static_cast<std::uint32_t>(kSubVoxels);
        else if (ph == MatPhase::Gas) d.gas = static_cast<std::uint32_t>(kSubVoxels);
    }
    d.mobile = material_is_medium(t);
    return d;
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
    const MediumDigest d = medium_digest_page(page);
    medium_level_field(w).data()[ci] = d.liq | (d.gas << 16);
    medium_mobile_field(w).data()[ci] = d.mobile ? 1u : 0u;
}

// ОЖИВЛЕНИЕ СРЕД как отдельный проход по всем клеткам здесь УМЕРЛО
// (2026-09-23): оно было одним из ЧЕТЫРЁХ независимых полных обходов, каждый
// из которых разрешал ту же страницу и крутил тот же цикл по 512 атомам
// (замер: 2015 мс на этаже в 1.54 млн страниц). Обход теперь ОДИН —
// [world/floor_awaken.h], и агрегаты этого модуля он наполняет тем же
// medium_digest_*, что и шов.

} // namespace giga
