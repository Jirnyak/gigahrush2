// lightvis — запечённая видимость «лампа -> клетка светосетки»
// ([game/light_vis_bake.h], план markoaudit/plans/light-visibility-bake.md).
//
// Включается в game_test.cpp: CHECK-макрос оттуда. Всё, кроме входной точки
// test_lightvis_all(), живёт в namespace lightvis_test.
//
// Что проверяется, и почему только это:
//
//   1. Закон «кто твёрд для флуда»: блокирует ТОЛЬКО полностью полная
//      неэмиссивная клетка (вывод из S2 в заголовке модуля).
//   2. ПИН воспроизводимости (план §6.1): два бейка одного мира дают
//      бит-идентичные клетки И одинаковый fnv — при РАЗНОМ числе потоков
//      (merge детерминирован конкатенацией чанков в порядке ламп, что сильнее
//      контракта [core/jobs.h]).
//   3. ОРАКУЛ «не потерять свет» (план §6.2, главный тест инварианта «ошибка
//      всегда посветить лишним»): на реальном этаже каждая лампа, достающая
//      клетку ПРЯМЫМ лучом без полностью твёрдых клеток, обязана быть в её
//      запечённом списке (либо честно вытеснена по вкладу при переливе).
//      Обратная полярность ЖИВЁТ В ТЕСТЕ: тот же оракул против нарочно
//      сломанного флуда (частичные клетки блокируют) обязан найти потери —
//      тест доказывает свои зубы каждый прогон (run-the-mutation).
//   4. Мгновенность карва (план §6.3): дренаж dirty-клеток ТЕМ ЖЕ вызовом
//      метит клетку светосетки, дистанционный фолбэк (CPU-эмуляция шейдерного
//      слияния) немедленно видит лампу, а ребейк по пропатченным битсетам
//      вписывает её в запечённый список.
//   5. Вывод rDirty из R_max — формула из плана §3.2, падик = 5.
#include <cstring>

#include "game/floor_gen.h"
#include "game/floor_spec.h"
#include "game/light_vis_bake.h"
#include "world/macro_grid.h"
#include "world/types.h"
#include "world/world.h"

namespace lightvis_test {

using giga::game::LightVisBake;
using giga::game::LightVisLamp;

constexpr std::uint32_t kSlots = 63; // = gpu::kGridCellSlots (лейаут клетки)

// Детерминированный LCG — тот же приём, что везде в тестах.
struct Rng {
    std::uint64_t s;
    std::uint32_t next() {
        s = s * 6364136223846793005ull + 1442695040888963407ull;
        return static_cast<std::uint32_t>(s >> 33);
    }
};

// Прямой луч по макроклеткам (3D-DDA, тор): true = ни одной блокирующей
// клетки между from и to. Референс оракула — та же геометрия, что и живой
// giga_shadow на макроуровне (cls==1 блокирует), и тот же предикат
// light_passes_cell, что у флуда.
bool ray_clear(const World& w, vec3 from, vec3 to) {
    const MacroGrid& g = w.grid();
    // Ближайший образ цели — луч идёт кратчайшей дугой тора.
    to.x = from.x + wrap_delta_f(from.x, to.x, kWorldExtent);
    to.y = from.y + wrap_delta_f(from.y, to.y, kWorldExtent);
    to.z = from.z + wrap_delta_f(from.z, to.z, kWorldExtent);
    vec3 rd{to.x - from.x, to.y - from.y, to.z - from.z};
    const float dist =
        std::sqrt(rd.x * rd.x + rd.y * rd.y + rd.z * rd.z);
    if (dist < 1e-6f) return true;
    rd.x /= dist; rd.y /= dist; rd.z /= dist;
    auto fix = [](float v) {
        return std::fabs(v) < 1e-6f ? (v >= 0.0f ? 1e-6f : -1e-6f) : v;
    };
    rd.x = fix(rd.x); rd.y = fix(rd.y); rd.z = fix(rd.z);
    const vec3 rinv{1.0f / rd.x, 1.0f / rd.y, 1.0f / rd.z};
    int c[3] = {static_cast<int>(std::floor(from.x / kCellSize)),
                static_cast<int>(std::floor(from.y / kCellSize)),
                static_cast<int>(std::floor(from.z / kCellSize))};
    const int stp[3] = {rd.x > 0 ? 1 : -1, rd.y > 0 ? 1 : -1,
                        rd.z > 0 ? 1 : -1};
    float tMax[3], tDelta[3];
    const float o[3] = {from.x, from.y, from.z};
    const float ri[3] = {rinv.x, rinv.y, rinv.z};
    for (int a = 0; a < 3; ++a) {
        const float bound =
            (static_cast<float>(c[a]) + (stp[a] > 0 ? 1.0f : 0.0f)) *
            kCellSize;
        tMax[a] = (bound - o[a]) * ri[a];
        tDelta[a] = kCellSize * std::fabs(ri[a]);
    }
    float t = 0.0f;
    for (int i = 0; i < 4 * kMacroDim; ++i) {
        const std::size_t ci = macro_index(
            wrap_macro(c[0]), wrap_macro(c[1]), wrap_macro(c[2]));
        if (!giga::game::light_passes_cell(g.masks()[ci], g.types()[ci]))
            return false;
        const int axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2)
                                           : (tMax[1] < tMax[2] ? 1 : 2);
        t = tMax[axis];
        if (t >= dist) return true;
        c[axis] += stp[axis];
        tMax[axis] += tDelta[axis];
    }
    return true;
}

// Лампа в списке клетки? При переливе — честность вытеснения: каждый
// хранимый id обязан иметь вклад не хуже (score не больше) кандидата.
bool lamp_accounted(const LightVisBake& b, const LightVisLamp* lamps,
                    std::size_t cell, std::uint32_t lamp) {
    const std::uint32_t* row = b.cells.data() + cell * (1 + b.slots);
    const std::uint32_t n = row[0];
    for (std::uint32_t k = 0; k < n; ++k)
        if (row[1 + k] == lamp) return true;
    if (n < b.slots) return false; // места было — потеря света, дефект
    // Список полон: вытеснение законно, только если ВСЕ хранимые вкладнее.
    const int cx = static_cast<int>(cell % giga::game::kLightVisDim);
    const int cy = static_cast<int>((cell / giga::game::kLightVisDim) %
                                    giga::game::kLightVisDim);
    const int cz = static_cast<int>(
        cell / (giga::game::kLightVisDim * giga::game::kLightVisDim));
    const float cand = giga::game::light_cell_score(
        lamps[lamp].pos, lamps[lamp].radiusM, cx, cy, cz);
    for (std::uint32_t k = 0; k < n; ++k) {
        const LightVisLamp& s = lamps[row[1 + k]];
        if (giga::game::light_cell_score(s.pos, s.radiusM, cx, cy, cz) > cand)
            return false;
    }
    return true;
}

// Оракул: число потерянных пар (лампа доходит прямым лучом, а в списке её
// нет). Возвращает счёт — прямая полярность ждёт 0, обратная — > 0.
std::uint32_t oracle_lost_pairs(const World& w, const LightVisBake& b,
                                const std::vector<LightVisLamp>& lamps,
                                std::uint32_t& outTested) {
    Rng rng{0xC0FFEEull};
    std::uint32_t lost = 0, tested = 0;
    for (std::uint32_t li = 0; li < lamps.size(); ++li) {
        const LightVisLamp& L = lamps[li];
        // Выборка клеток светосетки в радиусе: бокс + дистанционный тест.
        const int lc[3] = {
            static_cast<int>(std::floor(L.pos.x / giga::game::kLightVisCellM)),
            static_cast<int>(std::floor(L.pos.y / giga::game::kLightVisCellM)),
            static_cast<int>(std::floor(L.pos.z / giga::game::kLightVisCellM))};
        const int br = static_cast<int>(
            std::ceil(L.radiusM / giga::game::kLightVisCellM)) + 1;
        for (int k = 0; k < 160; ++k) {
            const int dx = static_cast<int>(rng.next() % (2 * br + 1)) - br;
            const int dy = static_cast<int>(rng.next() % (2 * br + 1)) - br;
            const int dz = static_cast<int>(rng.next() % (2 * br + 1)) - br;
            const int cx = lc[0] + dx, cy = lc[1] + dy, cz = lc[2] + dz;
            if (giga::game::light_cell_score(L.pos, L.radiusM, cx, cy, cz) >
                1.0f)
                continue; // вне досягаемости — шейдер бы тоже не биннил
            // Сэмплы клетки: центр + 4 разнесённых точки. Луч чист хотя бы к
            // одному ⇒ свет физически достаёт клетку ⇒ лампа ОБЯЗАНА быть
            // учтена в списке.
            const float m = giga::game::kLightVisCellM;
            const vec3 base{cx * m, cy * m, cz * m};
            const vec3 pts[5] = {
                {base.x + 0.5f * m, base.y + 0.5f * m, base.z + 0.5f * m},
                {base.x + 0.25f * m, base.y + 0.25f * m, base.z + 0.75f * m},
                {base.x + 0.75f * m, base.y + 0.25f * m, base.z + 0.25f * m},
                {base.x + 0.25f * m, base.y + 0.75f * m, base.z + 0.25f * m},
                {base.x + 0.75f * m, base.y + 0.75f * m, base.z + 0.75f * m}};
            bool reaches = false;
            for (const vec3& p : pts) {
                if (wrap_dist2(L.pos, p, kWorldExtent) >
                    L.radiusM * L.radiusM)
                    continue;
                if (ray_clear(w, L.pos, p)) {
                    reaches = true;
                    break;
                }
            }
            if (!reaches) continue;
            ++tested;
            if (!lamp_accounted(
                    b, lamps.data(),
                    giga::game::light_vis_index(cx, cy, cz), li))
                ++lost;
        }
    }
    outTested = tested;
    return lost;
}

// Реальный этаж + детерминированные лампы в воздушных клетках.
void make_floor_and_lamps(World& w, std::vector<LightVisLamp>& lamps) {
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    Rng rng{0xBADA55ull};
    const MacroGrid& g = w.grid();
    while (lamps.size() < 24) {
        const int x = static_cast<int>(rng.next() & (kMacroDim - 1));
        const int y = static_cast<int>(rng.next() & (kMacroDim - 1));
        const int z = static_cast<int>(rng.next() & (kMacroDim - 1));
        if (!g.masks()[macro_index(x, y, z)].empty()) continue; // воздух
        lamps.push_back(LightVisLamp{
            vec3{(x + 0.5f) * kCellSize, (y + 0.5f) * kCellSize,
                 (z + 0.5f) * kCellSize},
            12.0f});
    }
}

void solidity_law() {
    // Кто твёрд для флуда: полностью полная неэмиссивная клетка — и только.
    SubMask m;
    CellType rock = 3; // любой неэмиссивный тип
    m.clear_all();
    CHECK(giga::game::light_passes_cell(m, rock)); // воздух проходим
    m.set_all();
    CHECK(!giga::game::light_passes_cell(m, rock)); // полная — блок
    m.clear(0); // 511/512 — щель есть, свет терять нельзя
    CHECK(giga::game::light_passes_cell(m, rock));
    // Полный неон (материал светит) — эмиттер не окклюдер своего света.
    m.set_all();
    CellType neon = 20; // neon_tube ([world/materials.h])
    CHECK(material_emits_light(neon)); // предпосылка закона, не вера
    CHECK(giga::game::light_passes_cell(m, neon));
}

void dirty_radius_derivation() {
    // rDirty = ceil((R_max + sqrt(3) + 2*sqrt(3)) / 4): падик R=12 -> 5.
    CHECK(giga::game::light_dirty_radius_cells(12.0f) == 5);
    // Блеймовский неон-кластер R~26: ceil((26+5.2)/4) = 8.
    CHECK(giga::game::light_dirty_radius_cells(26.0f) == 8);
    CHECK(giga::game::light_dirty_radius_cells(0.0f) >= 2); // полудиагонали
}

void pin_and_oracle_on_a_real_floor() {
    World w;
    std::vector<LightVisLamp> lamps;
    make_floor_and_lamps(w, lamps);

    WalkBits bits;
    giga::game::build_light_pass_bits(w.grid(), bits);

    // --- ПИН: бит-идентичность при разном числе потоков (план §6.1) ------
    LightVisBake a, b;
    giga::game::bake_light_visibility(bits, lamps.data(), lamps.size(),
                                      kSlots, a, /*threads=*/1);
    giga::game::bake_light_visibility(bits, lamps.data(), lamps.size(),
                                      kSlots, b, /*threads=*/2);
    CHECK(a.cells.size() == b.cells.size());
    CHECK(std::memcmp(a.cells.data(), b.cells.data(),
                      a.cells.size() * sizeof(std::uint32_t)) == 0);
    CHECK(giga::game::light_vis_fnv(a) == giga::game::light_vis_fnv(b));
    CHECK(a.litCells > 0); // бейк не пустой — иначе пин пинил бы нули
    std::printf("[lightvis-pin] suite floor0 fnv=%016llx lit=%u max=%u\n",
                static_cast<unsigned long long>(giga::game::light_vis_fnv(a)),
                a.litCells, a.maxPerCell);

    // --- ОРАКУЛ, прямая полярность: потерь света нет (план §6.2) ---------
    std::uint32_t tested = 0;
    const std::uint32_t lost = oracle_lost_pairs(w, a, lamps, tested);
    CHECK(tested > 500); // выборка настоящая, не вырожденная
    CHECK(lost == 0);

    // --- ОРАКУЛ, ОБРАТНАЯ полярность (run-the-mutation): флуд, нарочно
    // считающий ЧАСТИЧНЫЕ клетки твёрдыми, обязан терять свет — иначе оракул
    // не проверяет ничего. Мутация — ровно та ошибка, от которой защищает
    // закон «твёрд = только mask.full()».
    WalkBits broken;
    {
        const auto& masks = w.grid().masks();
        broken.build([&](int x, int y, int z) {
            return masks[macro_index(x, y, z)].empty(); // партиал = блок (ЛОЖЬ)
        });
    }
    LightVisBake bad;
    giga::game::bake_light_visibility(broken, lamps.data(), lamps.size(),
                                      kSlots, bad, /*threads=*/2);
    std::uint32_t testedBad = 0;
    const std::uint32_t lostBad = oracle_lost_pairs(w, bad, lamps, testedBad);
    CHECK(lostBad > 0); // красный на мутации — у оракула есть зубы
}

void carve_expands_same_call() {
    World w;
    std::vector<LightVisLamp> lamps;
    make_floor_and_lamps(w, lamps);
    WalkBits bits;
    giga::game::build_light_pass_bits(w.grid(), bits);
    LightVisBake baked;
    giga::game::bake_light_visibility(bits, lamps.data(), lamps.size(),
                                      kSlots, baked, /*threads=*/2);

    // Найти пару (лампа, клетка): в радиусе, но НЕ в списке — за стеной.
    int lampId = -1;
    std::size_t targetCell = 0;
    int tcx = 0, tcy = 0, tcz = 0;
    for (std::uint32_t li = 0; li < lamps.size() && lampId < 0; ++li) {
        const LightVisLamp& L = lamps[li];
        const int lc[3] = {
            static_cast<int>(std::floor(L.pos.x / giga::game::kLightVisCellM)),
            static_cast<int>(std::floor(L.pos.y / giga::game::kLightVisCellM)),
            static_cast<int>(std::floor(L.pos.z / giga::game::kLightVisCellM))};
        const int br =
            static_cast<int>(std::ceil(L.radiusM / giga::game::kLightVisCellM));
        for (int dz = -br; dz <= br && lampId < 0; ++dz)
            for (int dy = -br; dy <= br && lampId < 0; ++dy)
                for (int dx = -br; dx <= br && lampId < 0; ++dx) {
                    const int cx = lc[0] + dx, cy = lc[1] + dy,
                              cz = lc[2] + dz;
                    if (giga::game::light_cell_score(L.pos, L.radiusM, cx, cy,
                                                     cz) > 0.9f)
                        continue;
                    const std::size_t cell =
                        giga::game::light_vis_index(cx, cy, cz);
                    const std::uint32_t* row =
                        baked.cells.data() + cell * (1 + kSlots);
                    bool present = false;
                    for (std::uint32_t k = 0; k < row[0]; ++k)
                        if (row[1 + k] == li) present = true;
                    if (present || row[0] >= kSlots) continue;
                    lampId = static_cast<int>(li);
                    targetCell = cell;
                    tcx = cx; tcy = cy; tcz = cz;
                }
    }
    CHECK(lampId >= 0); // на настоящем этаже перекрытая пара обязана найтись

    // «Карв»: пробить прямую от лампы к центру клетки — очистить все
    // блокирующие макроклетки на отрезке, как это сделал бы carve_sphere.
    const LightVisLamp& L = lamps[static_cast<std::uint32_t>(lampId)];
    const float m4 = giga::game::kLightVisCellM;
    vec3 to{(tcx + 0.5f) * m4, (tcy + 0.5f) * m4, (tcz + 0.5f) * m4};
    to.x = L.pos.x + wrap_delta_f(L.pos.x, to.x, kWorldExtent);
    to.y = L.pos.y + wrap_delta_f(L.pos.y, to.y, kWorldExtent);
    to.z = L.pos.z + wrap_delta_f(L.pos.z, to.z, kWorldExtent);
    std::vector<std::uint32_t> dirty;
    {
        const float steps = 64.0f;
        for (int i = 0; i <= static_cast<int>(steps); ++i) {
            const float t = static_cast<float>(i) / steps;
            const int cx = wrap_macro(static_cast<int>(std::floor(
                (L.pos.x + (to.x - L.pos.x) * t) / kCellSize)));
            const int cy = wrap_macro(static_cast<int>(std::floor(
                (L.pos.y + (to.y - L.pos.y) * t) / kCellSize)));
            const int cz = wrap_macro(static_cast<int>(std::floor(
                (L.pos.z + (to.z - L.pos.z) * t) / kCellSize)));
            const std::size_t ci = macro_index(cx, cy, cz);
            if (!giga::game::light_passes_cell(w.grid().masks()[ci],
                                               w.grid().types()[ci])) {
                w.grid().clear_cell(cx, cy, cz);
                dirty.push_back(static_cast<std::uint32_t>(ci));
            }
        }
    }
    CHECK(!dirty.empty()); // стена была настоящей

    // --- Мгновенность, шаг 1: дренаж ТЕМ ЖЕ вызовом метит клетку ---------
    std::vector<std::uint32_t> dirtyGen(giga::game::kLightVisCells, 0);
    giga::game::for_each_dirty_light_cell(
        dirty.data(), dirty.size(), baked.rMaxM,
        [&](std::size_t li) { dirtyGen[li] = 1; });
    CHECK(dirtyGen[targetCell] == 1); // bakedGen=0 < 1 ⇒ клетка грязная

    // --- Шаг 2: грязный фолбэк (дистанционный биннинг по всей таблице —
    // CPU-эмуляция ветки шейдера) немедленно видит лампу.
    CHECK(giga::game::light_cell_score(L.pos, L.radiusM, tcx, tcy, tcz) <=
          1.0f);

    // --- Шаг 3: патч битсета + фоновый ребейк ужимает и ВПИСЫВАЕТ лампу.
    for (std::uint32_t ci : dirty)
        giga::game::patch_light_pass_bit(bits, ci, w.grid().masks()[ci],
                                         w.grid().types()[ci]);
    LightVisBake after;
    giga::game::bake_light_visibility(bits, lamps.data(), lamps.size(),
                                      kSlots, after, /*threads=*/2);
    const std::uint32_t* row =
        after.cells.data() + targetCell * (1 + kSlots);
    bool present = false;
    for (std::uint32_t k = 0; k < row[0]; ++k)
        if (row[1 + k] == static_cast<std::uint32_t>(lampId)) present = true;
    CHECK(present); // свап поднял бы bakedGen ⇒ dirtyGen <= bakedGen, чисто
}

} // namespace lightvis_test

void test_lightvis_all() {
    lightvis_test::solidity_law();
    lightvis_test::dirty_radius_derivation();
    lightvis_test::pin_and_oracle_on_a_real_floor();
    lightvis_test::carve_expands_same_call();
}
