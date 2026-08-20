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
// Алгоритм — 9-ЛУЧЕВАЯ ПРЯМАЯ ВИДИМОСТЬ + ДИЛАТАЦИЯ НА 1 КЛЕТКУ (решение
// владельца 2026-08-20, замена строгого флуда). История в двух замерах:
// сначала владелец выбрал строгий флуд («без приближений», план §финал), но
// посадка потребителя показала ровно то, о чём предупреждал план §2.1 —
// флуд «огибает углы», свет течёт сквозь дверные проёмы, и списки остаются
// толстыми: mean 33 лампы/клетку, кадр 21 мс как был; таблица из 8 ламп —
// 5.3 мс, т.е. кадр пропорционален толщине списков, и ужать его может
// только строгость видимости. Отсюда лучи:
//
//  * На клетку в радиусе — DDA-луч к центру + к 8 углам (углы решётки общие
//    для восьми клеток и мемоизируются: ~2 луча на клетку). Достижима, если
//    хоть один чист.
//  * Дилатация на 26 соседей (в пределах радиуса) — страховка сэмплирования:
//    канал уже 4 м может пройти между лучами. Это инженерная ставка, и
//    потому она ОБЯЗАНА жить под оракулом «не потерять свет»
//    (tests/suite_lightvis.inl §6.2, обратная полярность в самом тесте).
//  * Ошибка по-прежнему только «посветить лишним»: луч судит той же
//    геометрией, что живой giga_shadow на макроуровне, а точную тень по
//    субвокселям кадр в кадр даёт пиксельный марш — он не менялся вовсе.
//
// КТО «ТВЁРД» ДЛЯ ЛУЧА — вывод из закона двух масштабов (CANON S2): луч —
// ЛОКАЛЬНЫЙ вопрос и обязан спрашивать субвоксели, клеточный тип — кэш.
// Урок 2026-08-20, измеренный пробой: скульпт-пайплайн оставляет лепку на
// каждой твёрдой клетке, полных клеток на падике 0.4% — макро-предикат
// «блокирует только mask.full()» пропускал 97.5% пар лампа->клетка (свет
// сквозь стены), субвоксельный луч — 10.5%: ужатие списков 9.3x. Поэтому луч
// бейка идёт ЕДИНСТВЕННЫМ субвоксельным маршем дерева ([world/los] sub_march,
// S11) с двумя поправками света, обе в сторону излишка:
//
//  * светоматериал не блокирует СВОЙ свет: неон солиден, его центроид внутри
//    тела — честная блокировка гасила бы сам источник; марш продолжается
//    сквозь эмиссивную материю;
//  * клетка самой лампы проходима принудительно (та же причина: лампа висит
//    вплотную к своему якорю).
//
// Пропы и двери в маске мира отсутствуют — не блокируют (консервативно);
// двери в придачу идут по премисе all-open, как nav ([game/door.h]) — тоггл
// двери бейк не старит. Снапшот воркера — КОПИЯ MacroGrid по значению
// (масок и типов, ~134 МиБ транзиентно; «бери больше во благо» — решение
// владельца 2026-08-20): класс гонок «мутация во время бейка» не существует
// по построению, как и у nav-битсетов.
#pragma once

#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "core/math.h"
#include "world/macro_grid.h"     // MacroGrid — маски+типы, снапшот по значению
#include "world/material_props.h" // material_emits_light — эмиттер не окклюдер
#include "world/types.h"          // kMacroDim, kCellSize

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
    // Цвет нужен ТОЛЬКО синтезу кластеров (light-cluster.md): кластерная
    // запись PointLight несёт взвешенный цвет членов. Вес члена — radiusM²
    // (флюкс-прокси: радиус выводится из силы, а живая интенсивность в base
    // всегда 0 — её пишет кадр).
    vec3 color{1.0f, 1.0f, 1.0f};
};

// --- Кластеры (light-cluster.md, решения владельца 2026-08-20) --------------
//
// Кластер = пространственный бакет ламп 8 м (= 2 клетки светосетки; вывод:
// ошибка позиции кластера ≤ полудиагонали бакета ≈ 6.9 м — хвостовые лампы
// по построению дальние/слабые, угловая ошибка тонет в аттенюации; финал —
// замером). Кластер — та же запись PointLight для потребителя: позиция =
// центроид членов по весу radiusM², радиус = охват (max дистанции до члена +
// его радиус), цвет — взвешенное среднее. Живую интенсивность кластера кадр
// считает суммой членов (CPU, collect_scene_lights) — мерцание толпы
// усредняется само, обесточка района гасит кластер честно.
inline constexpr int kClusterBucketCells = 2;              // клеток светосетки
inline constexpr int kClusterGridDim = kLightVisDim / kClusterBucketCells; // 32
// Честных ламп на клетку (топ по вкладу, с настоящими теневыми маршами):
// вывод — максимум теневого бюджета пикселя (4, volumetric_fog.glsl) × запас
// 2 на отбраковку порогом/ndotl. Хвост за ними уходит в кластеры (шаг 2).
inline constexpr std::uint32_t kClusterHonestLamps = 8;

struct LightVisCluster {
    vec3 pos{0.0f, 0.0f, 0.0f};
    float radiusM = 0.0f;
    vec3 color{1.0f, 1.0f, 1.0f};
    std::uint32_t memberStart = 0; // диапазон в LightVisBake::clusterMembers
    std::uint32_t memberCount = 0;
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
    // Средняя длина УПАКОВАННОГО списка (после top-K+кластеры) — то, что
    // реально платит пиксель; сравнивать с meanPerCell (достижимых).
    float packedMeanPerCell = 0.0f;
    float bakeMs = 0.0f;
    // Кластеры занятых бакетов (порядок — возрастание плоского индекса
    // бакета: детерминизм) + CSR слотов-членов. Шаг 1 light-cluster.md:
    // синтез есть, клетки их ещё НЕ ссылают (это шаг 2, вместе со слотами в
    // статик-таблице — id без записи в таблице был бы чтением мусора).
    std::vector<LightVisCluster> clusters;
    std::vector<std::uint32_t> clusterMembers;

    bool valid() const { return !cells.empty(); }
    std::size_t resident_bytes() const {
        return cells.capacity() * sizeof(std::uint32_t);
    }
};

// Свет доходит от `from` до точки за stopShortM метров до `to`? Двухуровневая
// правда: единственный субвоксельный марш дерева ([world/los] sub_march) с
// поправками света из шапки (эмиссив прощён, клетка `from` проходима
// принудительно). Публична, потому что это И закон бейка, И предмет прямых
// тестов сьюта (стена блокирует, щель пропускает, неон светит из тела).
bool light_ray_passes(const MacroGrid& grid, const vec3& from, const vec3& to,
                      float stopShortM = 0.0f);

// CPU-скор клетки — та же математика, что light_grid.comp
// dist_sq_point_aabb_toroidal: d² от точки до AABB клетки светосетки по тору,
// делённый на r². 0 = лампа внутри клетки, 1 = едва касается, >1 = вне.
float light_cell_score(const vec3& lampPos, float radiusM, int cx, int cy,
                       int cz);

// Бейк: 9-лучевая субвоксельная видимость + дилатация от каждой лампы,
// транспонирование в списки клеток, top-slots по вкладу с подсчётом
// переливов. Детерминирован и НЕ зависит от числа потоков: лампы делятся на
// непрерывные чанки ([core/jobs.h]), выход склеивается в порядке ламп.
// cancel — узловая отмена (гранулярность — лампа). `grid` — живой на Fresh
// (синхронный бейк главного потока) или снапшот-копия воркера на Rebake.
// clusterRefBase != 0 включает паковку шага 2 (light-cluster.md): клетка =
// top-kClusterHonestLamps честных + ссылки кластеров хвостовых бакетов как
// clusterRefBase + clusterIdx (верхний регион таблицы, рендер передаёт свой
// kClusterSlotBase — game лейаут-агностичен). 0 = прежняя паковка top-slots.
void bake_light_visibility(const MacroGrid& grid, const LightVisLamp* lamps,
                           std::size_t lampCount, std::uint32_t slots,
                           LightVisBake& out, int threads = 0,
                           const std::atomic<bool>* cancel = nullptr,
                           std::uint32_t clusterRefBase = 0);

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
