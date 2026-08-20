// light_vis_bake — запечённая видимость «лампа -> клетка светосетки».
// Дизайн: markoaudit/plans/light-visibility-bake.md (решения владельца внизу
// плана); строка №10 реестра допекания (async-rebake.md §1). Диагноз, который
// это лечит: 52% GPU-кадра — пиксельные DDA-марши теней к лампам, перекрытым
// стенами; окклюжна в СБОРЕ света не было вообще.
//
// Что бейк отвечает и чего НЕ отвечает. Пиксельный марш giga_shadow
// ([shaders/shadow_march.glsl]) живёт всегда и даёт точную тень по субвокселям
// кадр в кадр. Бейк заменяет не тень, а СБОР КАНДИДАТОВ: «может ли свет лампы
// В ПРИНЦИПЕ дойти до этой 4-метровой клетки». Ошибка обязана быть только
// «посветить лишним», никогда «потерять свет» (железный инвариант владельца).
//
// Алгоритм — СТРОГИЙ ФЛУД от лампы (решение владельца, план §финал: без
// приближений, 9-лучевой сэмплинг отвергнут как «инженерная ставка»). BFS по
// 6-связности макроклеток в радиусе досягаемости лампы:
//
//  * Консервативность по построению: любая физическая траектория света
//    положительной меры пересекает клетки ЧЕРЕЗ ГРАНИ (DDA-цепочка прямой —
//    6-связный путь; касание ровно ребра/угла — мера нуль), значит множество
//    достижимых флудом клеток — надмножество достижимых любым прямым лучом.
//  * Граница области: точки отрезка лампа->P лежат в шаре радиуса R (дальше
//    света физически нет — light_attenuation), клетка, пересекаемая отрезком,
//    имеет центр не дальше R + полудиагональ макроклетки (sqrt(3) м). Флуд,
//    ограниченный этим шаром, содержит все клетки всех прямых лучей.
//
// КТО «ТВЁРД» ДЛЯ ФЛУДА — вывод из закона двух масштабов (CANON S2). Атомы-
// субвоксели — физическая правда; клетка 128³ — макро-абстракция, и бейк —
// ровно МАКРО-вопрос (биннинг кандидатов), где ей и место. Локальную точность
// даёт живой марш. Отсюда консервативная граница: флуд блокирует ТОЛЬКО
// клетка, чьё сечение твёрдо на всём макромасштабе — mask.full(), все 512
// субвокселей (это же и закон живого марша: cls==1 в shadow_march.glsl:83).
// Клетка 511/512 пропускает: порог атомов резал бы свет через реальную щель —
// «потерять свет» запрещено. Два уточнения, оба в сторону излишка:
//
//  * светоматериал не блокирует СВОЙ свет: полная эмиссивная клетка (неон)
//    проходима для флуда — кластер солиден, его центроид внутри тела, честная
//    блокировка гасила бы сам источник;
//  * клетка самой лампы проходима принудительно (та же причина).
//
// Пропы, двери, частичные клетки НЕ блокируют — консервативно; двери в
// придачу идут по премисе all-open, как nav ([game/door.h]) — тоггл двери
// бейк не старит.
#pragma once

#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "core/math.h"
#include "world/macro_grid.h"     // SubMask, CellType
#include "world/material_props.h" // material_emits_light — эмиттер не окклюдер
#include "world/types.h"          // kMacroDim, kCellSize
#include "world/walk_bits.h"      // WalkBits — тот же класс снапшота, что nav

namespace giga::game {

// Светосетка ВЫВОДИТСЯ из макросетки, не назначается: клетка света = 2×2×2
// макроклетки (маппинг дренажа карва — сдвиг на бит), значит измерение —
// kMacroDim/2 и клетка — 2·kCellSize. Рендер обязан совпадать
// (gpu::kGridDimX == kLightVisDim — static_assert на шве в app).
inline constexpr int kLightVisDim = kMacroDim / 2; // 64
inline constexpr std::size_t kLightVisCells =
    static_cast<std::size_t>(kLightVisDim) * kLightVisDim * kLightVisDim;
inline constexpr float kLightVisCellM = kCellSize * 2.0f; // 4 м

inline std::size_t light_vis_index(int x, int y, int z) {
    x &= (kLightVisDim - 1);
    y &= (kLightVisDim - 1);
    z &= (kLightVisDim - 1);
    return static_cast<std::size_t>(x) +
           static_cast<std::size_t>(y) * kLightVisDim +
           static_cast<std::size_t>(z) * kLightVisDim * kLightVisDim;
}

// Всё, что флуду нужно знать о лампе. Индекс в массиве = стабильный id слота
// статик-таблицы света (та же нумерация, что uPointLights[0..staticCount)).
struct LightVisLamp {
    vec3 pos{0.0f, 0.0f, 0.0f};
    float radiusM = 0.0f;
};

// Выход бейка: на клетку светосетки — (1 + slots) слов u32 в лейауте
// GpuGridCell (count, id[slots]), отсортированных по вкладу (лучший первым),
// готовых к memcpy в стейджинг GPU. slots приходит от рендера параметром —
// game лейаут-агностичен, корневая константа kGridCellBytes живёт в
// gpu_light_grid.h.
struct LightVisBake {
    std::vector<std::uint32_t> cells;
    std::uint32_t slots = 0;
    std::uint32_t lampCount = 0;
    float rMaxM = 0.0f; // максимальный радиус статика — вход дренажа карва
    std::uint32_t litCells = 0;
    std::uint32_t overflowCells = 0; // клеток с достижимыми > slots (вслух!)
    std::uint32_t maxPerCell = 0;
    // Среднее ламп на ОСВЕЩЁННУЮ клетку — главный перф-датчик: кадр GPU
    // пропорционален толщине списков (замер 2026-08-20: таблица 12552 ->
    // 21 мс, таблица 8 -> 5 мс), и ужать его может только строгость бейка.
    float meanPerCell = 0.0f;
    float bakeMs = 0.0f;

    bool valid() const { return !cells.empty(); }
    std::size_t resident_bytes() const {
        return cells.capacity() * sizeof(std::uint32_t);
    }
};

// Битсет «свет проходит клетку» (SET = проходит) — третий предикат класса
// walk_bits (nav: !full, body: футпринт, свет: вывод в шапке). 256 КиБ,
// копия по значению — снапшот воркера, как у nav.
inline bool light_passes_cell(const SubMask& m, CellType t) {
    return !m.full() || material_emits_light(t);
}
void build_light_pass_bits(const MacroGrid& grid, WalkBits& out);
inline void patch_light_pass_bit(WalkBits& bits, std::size_t idx,
                                 const SubMask& m, CellType t) {
    bits.set(idx, light_passes_cell(m, t));
}

// CPU-скор клетки — та же математика, что light_grid.comp
// dist_sq_point_aabb_toroidal: d² от точки до AABB клетки светосетки по тору,
// делённый на r². 0 = лампа внутри клетки, 1 = едва касается, >1 = вне.
float light_cell_score(const vec3& lampPos, float radiusM, int cx, int cy,
                       int cz);

// Бейк: строгий флуд от каждой лампы, транспонирование в списки клеток,
// top-slots по вкладу с подсчётом переливов. Детерминирован и НЕ зависит от
// числа потоков: лампы делятся на непрерывные чанки ([core/jobs.h]), выход
// склеивается в порядке ламп. cancel — узловая отмена (гранулярность — лампа).
void bake_light_visibility(const WalkBits& passBits, const LightVisLamp* lamps,
                           std::size_t lampCount, std::uint32_t slots,
                           LightVisBake& out, int threads = 0,
                           const std::atomic<bool>* cancel = nullptr);

// FNV-1a содержимого клеток — пин воспроизводимости (GIGA_LIGHT_VIS_PIN,
// образец GIGA_VERLET_PIN).
std::uint64_t light_vis_fnv(const LightVisBake& b);

// --- Дренаж карва: мгновенное расширение (инвариант «тем же кадром») --------
//
// Карв только УДАЛЯЕТ материю -> видимость только РАСШИРЯЕТСЯ. Какие клетки
// могли получить НОВУЮ лампу через дыру в клетке C? Путь света L->P проходит
// через C и короче R_L (дальше света нет), C на отрезке ⇒ dist(C,P) <= R_L <=
// R_max этажа. Плюс полудиагонали обеих решёток (центр клетки против точки):
//   rDirty = ceil((R_max + sqrt(3) + 2*sqrt(3)) / 4 м)   [план §3.2]
//   падик, R_max = 12 м: ceil(17.2 / 4) = 5 клеток светосетки.
// R_max — вывод из контента этажа (печатается бейком), не константа.
inline int light_dirty_radius_cells(float rMaxM) {
    const float kHalfDiagMacro = 1.7320508f;      // sqrt(3) · kCellSize/2
    const float kHalfDiagLight = 2.0f * 1.7320508f; // sqrt(3) · kLightVisCellM/2
    return static_cast<int>(
        std::ceil((rMaxM + kHalfDiagMacro + kHalfDiagLight) / kLightVisCellM));
}

// Для каждой карвнутой МАКРОклетки (flat macro_index, как в
// CarveResult::dirtyCells) обойти шар rDirty по КЛЕТКАМ СВЕТОСЕТКИ и позвать
// fn(lightCellIndex). Маппинг макро->свето — сдвиг на бит (сетки соосны, обе
// стартуют в нуле мира). Запись идемпотентна — дедупликация не нужна.
template <class Fn>
void for_each_dirty_light_cell(const std::uint32_t* dirtyCells, std::size_t n,
                               float rMaxM, Fn&& fn) {
    const int r = light_dirty_radius_cells(rMaxM);
    const int r2 = r * r;
    for (std::size_t i = 0; i < n; ++i) {
        const std::uint32_t idx = dirtyCells[i];
        const int mx = static_cast<int>(idx % kMacroDim);
        const int my = static_cast<int>((idx / kMacroDim) % kMacroDim);
        const int mz = static_cast<int>(idx / (kMacroDim * kMacroDim));
        const int lx = mx >> 1, ly = my >> 1, lz = mz >> 1;
        for (int dz = -r; dz <= r; ++dz)
            for (int dy = -r; dy <= r; ++dy)
                for (int dx = -r; dx <= r; ++dx) {
                    if (dx * dx + dy * dy + dz * dz > r2) continue;
                    fn(light_vis_index(lx + dx, ly + dy, lz + dz));
                }
    }
}

} // namespace giga::game
