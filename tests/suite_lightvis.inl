// lightvis — запечённая видимость «лампа -> клетка светосетки»
// ([game/light_vis_bake.h], план markoaudit/plans/light-visibility-bake.md).
//
// Включается в game_test.cpp: CHECK-макрос оттуда. Всё, кроме входной точки
// test_lightvis_all(), живёт в namespace lightvis_test.
//
// Что проверяется, и почему только это:
//
//   1. Закон «кто твёрд для луча»: СУБВОКСЕЛЬ (S2 — луч локален; стена
//      блокирует, реальная щель в почти полной клетке пропускает, неон
//      светит из собственного тела, клетка лампы проходима принудительно).
//   2. ПИН воспроизводимости (план §6.1): два бейка одного мира дают
//      бит-идентичные клетки И одинаковый fnv — при РАЗНОМ числе потоков
//      (merge детерминирован конкатенацией чанков в порядке ламп, что сильнее
//      контракта [core/jobs.h]).
//   3. ОРАКУЛ «не потерять свет» (план §6.2, главный тест инварианта «ошибка
//      всегда посветить лишним»): на реальном этаже каждая лампа, достающая
//      клетку ПРЯМЫМ субвоксельным лучом, обязана быть в её запечённом списке
//      (либо честно вытеснена по вкладу при переливе). Референс — независимое
//      плотное сэмплирование, бейк — sub_march: сверяются два разных кода.
//      Обратная полярность ЖИВЁТ В ТЕСТЕ: тот же оракул против бейка по
//      нарочно испорченной сетке (частичные клетки залиты монолитом) обязан
//      найти потери — тест доказывает свои зубы каждый прогон
//      (run-the-mutation).
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

// Референс оракула — НЕЗАВИСИМАЯ субвоксельная правда: плотное сэмплирование
// отрезка (шаг 0.06 м, четверть субвокселя) по маскам, с теми же двумя
// поправками света, что у бейка (эмиссив прощён, клетка лампы проходима
// принудительно). Бейк идёт ДРУГИМ кодом ([world/los] sub_march,
// Amanatides-Woo) — совпадение ответов не гарантировано ничем, кроме физики:
// это и делает оракул оракулом.
bool ray_clear(const World& w, vec3 from, vec3 to) {
    const MacroGrid& g = w.grid();
    // Ближайший образ цели — луч идёт кратчайшей дугой тора.
    to.x = from.x + wrap_delta_f(from.x, to.x, kWorldExtent);
    to.y = from.y + wrap_delta_f(from.y, to.y, kWorldExtent);
    to.z = from.z + wrap_delta_f(from.z, to.z, kWorldExtent);
    const vec3 rd{to.x - from.x, to.y - from.y, to.z - from.z};
    const float dist = std::sqrt(rd.x * rd.x + rd.y * rd.y + rd.z * rd.z);
    if (dist < 1e-6f) return true;
    const int lampC[3] = {
        wrap_macro(static_cast<int>(std::floor(from.x / kCellSize))),
        wrap_macro(static_cast<int>(std::floor(from.y / kCellSize))),
        wrap_macro(static_cast<int>(std::floor(from.z / kCellSize)))};
    const int steps = static_cast<int>(dist / 0.06f) + 1;
    for (int i = 1; i <= steps; ++i) {
        const float t = static_cast<float>(i) / steps;
        const float px = from.x + rd.x * t, py = from.y + rd.y * t,
                    pz = from.z + rd.z * t;
        const int cx = wrap_macro(static_cast<int>(std::floor(px / kCellSize)));
        const int cy = wrap_macro(static_cast<int>(std::floor(py / kCellSize)));
        const int cz = wrap_macro(static_cast<int>(std::floor(pz / kCellSize)));
        if (cx == lampC[0] && cy == lampC[1] && cz == lampC[2]) continue;
        const std::size_t ci = macro_index(cx, cy, cz);
        const SubMask& m = g.masks()[ci];
        if (m.empty()) continue;
        if (material_emits_light(g.types()[ci])) continue;
        if (m.full()) return false;
        auto sub = [](float v) {
            const float local =
                v - std::floor(v / kCellSize) * kCellSize;
            int s = static_cast<int>(local / 0.25f);
            return s < 0 ? 0 : (s > 7 ? 7 : s);
        };
        if (m.test(sub_bit(sub(px), sub(py), sub(pz)))) return false;
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
        // 320 проб на лампу: субвоксельная правда пропускает ~10% пар (в 9
        // раз меньше макро-предиката), выборка обязана остаться настоящей.
        for (int k = 0; k < 320; ++k) {
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
    // Кто твёрд для луча: СУБВОКСЕЛЬ, не клетка (S2: луч — локальный вопрос;
    // урок 2026-08-20 — макро-предикат светил сквозь стены, полных клеток на
    // падике 0.4%). Мир пустой, лампа и цель в воздухе, между ними клетка
    // (8,5,5); луч идёт по субвоксельному ряду (sy=0, sz=0) этой клетки.
    World w;
    MacroGrid& g = w.grid();
    const CellType rock = 3; // любой неэмиссивный тип
    const vec3 from{10.1f, 10.125f, 10.125f};
    const vec3 to{22.1f, 10.125f, 10.125f};
    CHECK(giga::game::light_ray_passes(g, from, to)); // пусто — свет идёт
    g.fill_cell(8, 5, 5, rock);
    CHECK(!giga::game::light_ray_passes(g, from, to)); // полная — блок
    // Щель в один субвоксельный ряд по линии луча: клетка 504/512 всё ещё
    // почти полная, но реальная щель ОБЯЗАНА пропускать свет.
    for (int sx = 0; sx < 8; ++sx) g.mask(8, 5, 5).clear(sub_bit(sx, 0, 0));
    CHECK(giga::game::light_ray_passes(g, from, to));
    // Полный неон (материал светит) — эмиттер не окклюдер своего света.
    const CellType neon = 20; // neon_tube ([world/materials.h])
    CHECK(material_emits_light(neon)); // предпосылка закона, не вера
    g.fill_cell(8, 5, 5, neon);
    CHECK(giga::game::light_ray_passes(g, from, to));
    // Клетка самой лампы проходима принудительно: замурованная в своём якоре
    // лампа светит наружу, а не гаснет в нулевом сантиметре пути.
    g.clear_cell(8, 5, 5);
    g.fill_cell(5, 5, 5, rock); // клетка from
    CHECK(giga::game::light_ray_passes(g, from, to));
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

    // --- ПИН: бит-идентичность при разном числе потоков (план §6.1) ------
    LightVisBake a, b;
    giga::game::bake_light_visibility(w.grid(), lamps.data(), lamps.size(),
                                      kSlots, a, /*threads=*/1);
    giga::game::bake_light_visibility(w.grid(), lamps.data(), lamps.size(),
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
    CHECK(tested > 150); // выборка настоящая, не вырожденная
    CHECK(lost == 0);
}

// ОБРАТНАЯ полярность оракула (run-the-mutation) на ПОСТРОЕННОЙ сцене —
// случайный этаж не гарантирует детерминированной потери, а тест обязан
// быть красным на мутации каждый прогон. Сцена: сплошная стена-плоскость
// между лампой и клеткой, в стене субвоксельная щель точно по лучу.
// Реальная сетка: референс видит свет, бейк включает лампу. Мутация «щель
// замурована» (ровно та ошибка, от которой защищает закон «твёрд =
// субвоксель»): референс по НАСТОЯЩЕЙ сетке всё ещё видит свет, а
// бейк-мутант лампу теряет — предикат оракула нарушен, у теста есть зубы.
void oracle_reverse_polarity_constructed() {
    World w;
    MacroGrid& g = w.grid();
    const CellType rock = 3;
    // Стена — ДВЕ сплошные плоскости x=8,9 (толщина 4 м = клетка светосетки):
    // в обход не облететь, а легальная протечка дилатации на 1 клетку от
    // углов передней грани до цели не дотягивается — цель на 2 клетки глубже.
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y) {
            g.fill_cell(8, y, z, rock);
            g.fill_cell(9, y, z, rock);
        }

    const std::vector<LightVisLamp> lamps{
        {vec3{10.1f, 9.7f, 9.7f}, 16.0f}}; // клетка (5,4,4)
    // Цель — клетка светосетки (6,2,2), центр (26,10,10): ~15.9 м < R=16,
    // score по AABB ≈ 0.76.
    const int tcx = 6, tcy = 2, tcz = 2;
    const std::size_t targetCell = giga::game::light_vis_index(tcx, tcy, tcz);
    const vec3 centre{26.0f, 10.0f, 10.0f};
    // Щель по лучу: отрезок пересекает клетки стены (8,4,4) и (9,4,4) при
    // y=z≈9.81..9.89 — локальные субвоксели (6..7, 6..7); чистим канал 2×2
    // на всю толщину обеих клеток.
    for (int wx = 8; wx <= 9; ++wx)
        for (int sx = 0; sx < 8; ++sx)
            for (int sy = 6; sy < 8; ++sy)
                for (int sz = 6; sz < 8; ++sz)
                    g.mask(wx, 4, 4).clear(sub_bit(sx, sy, sz));

    CHECK(ray_clear(w, lamps[0].pos, centre)); // референс: свет сквозь щель
    LightVisBake real;
    giga::game::bake_light_visibility(g, lamps.data(), lamps.size(), kSlots,
                                      real, /*threads=*/2);
    CHECK(lamp_accounted(real, lamps.data(), targetCell, 0)); // бейк честен

    // МУТАЦИЯ: щель замурована монолитом.
    g.fill_cell(8, 4, 4, rock);
    g.fill_cell(9, 4, 4, rock);
    LightVisBake bad;
    giga::game::bake_light_visibility(g, lamps.data(), lamps.size(), kSlots,
                                      bad, /*threads=*/2);
    // Референс по настоящей (не замурованной) сетке видел свет, мутант
    // потерял лампу — оракул поймал бы это как lost > 0.
    CHECK(!lamp_accounted(bad, lamps.data(), targetCell, 0));
}

void carve_expands_same_call() {
    World w;
    std::vector<LightVisLamp> lamps;
    make_floor_and_lamps(w, lamps);
    LightVisBake baked;
    giga::game::bake_light_visibility(w.grid(), lamps.data(), lamps.size(),
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

    // «Карв»: пробить ТОЛСТЫЙ тоннель (куб 3³ вокруг каждой точки отрезка,
    // как сделал бы carve_sphere радиуса ~2 м) от лампы к центру клетки —
    // очистить все твёрдые макроклетки коридора.
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
            const int bx = static_cast<int>(std::floor(
                (L.pos.x + (to.x - L.pos.x) * t) / kCellSize));
            const int by = static_cast<int>(std::floor(
                (L.pos.y + (to.y - L.pos.y) * t) / kCellSize));
            const int bz = static_cast<int>(std::floor(
                (L.pos.z + (to.z - L.pos.z) * t) / kCellSize));
            for (int dz = -1; dz <= 1; ++dz)
                for (int dy = -1; dy <= 1; ++dy)
                    for (int dx = -1; dx <= 1; ++dx) {
                        const int cx = wrap_macro(bx + dx);
                        const int cy = wrap_macro(by + dy);
                        const int cz = wrap_macro(bz + dz);
                        const std::size_t ci = macro_index(cx, cy, cz);
                        if (w.grid().masks()[ci].empty()) continue;
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

    // --- Шаг 3: фоновый ребейк (снапшот масок снимается заново — поклеточного
    // патча у света нет) ужимает и ВПИСЫВАЕТ лампу.
    LightVisBake after;
    giga::game::bake_light_visibility(w.grid(), lamps.data(), lamps.size(),
                                      kSlots, after, /*threads=*/2);
    const std::uint32_t* row =
        after.cells.data() + targetCell * (1 + kSlots);
    bool present = false;
    for (std::uint32_t k = 0; k < row[0]; ++k)
        if (row[1 + k] == static_cast<std::uint32_t>(lampId)) present = true;
    CHECK(present); // свап поднял бы bakedGen ⇒ dirtyGen <= bakedGen, чисто
}

// Синтез кластеров (light-cluster.md шаг 1): бакетизация 8 м, членство CSR,
// центроид по весу radiusM², радиус-охват. Клетки кластеры ещё не ссылают —
// это шаг 2; здесь проверяется сам синтез.
void cluster_synthesis() {
    World w; // пустая сетка: лучи чисты, кластеры — чистая геометрия ламп
    std::vector<LightVisLamp> lamps;
    // Две лампы в ОДНОМ 8-м бакете (x 1..7), вторая вдвое ярче по радиусу;
    // третья — в далёком бакете.
    lamps.push_back({vec3{2.0f, 2.0f, 2.0f}, 6.0f, vec3{1.0f, 0.0f, 0.0f}});
    lamps.push_back({vec3{6.0f, 2.0f, 2.0f}, 12.0f, vec3{0.0f, 1.0f, 0.0f}});
    lamps.push_back({vec3{100.0f, 100.0f, 100.0f}, 8.0f,
                     vec3{0.0f, 0.0f, 1.0f}});
    LightVisBake b;
    giga::game::bake_light_visibility(w.grid(), lamps.data(), lamps.size(),
                                      63, b, 1, nullptr);
    CHECK(b.clusters.size() == 2);
    CHECK(b.clusterMembers.size() == 3);
    // Порядок кластеров — возрастание индекса бакета: пара (2,6) раньше 100.
    const auto& c0 = b.clusters[0];
    const auto& c1 = b.clusters[1];
    CHECK(c0.memberCount == 2);
    CHECK(c1.memberCount == 1);
    CHECK(b.clusterMembers[c0.memberStart] == 0u);
    CHECK(b.clusterMembers[c0.memberStart + 1] == 1u);
    CHECK(b.clusterMembers[c1.memberStart] == 2u);
    // Центроид взвешен radiusM²: вес 36 против 144 ⇒ x = (2·36+6·144)/180 = 5.2.
    CHECK(std::fabs(c0.pos.x - 5.2f) < 1e-3f);
    // Радиус — охват: до дальнего члена (x=2, dist 3.2) + его радиус 6 = 9.2;
    // против (x=6, dist 0.8) + 12 = 12.8 ⇒ 12.8.
    CHECK(std::fabs(c0.radiusM - 12.8f) < 1e-3f);
    // Цвет — взвешенное среднее: зелёный доминирует 144/180 = 0.8.
    CHECK(std::fabs(c0.color.y - 0.8f) < 1e-3f);
    CHECK(std::fabs(c0.color.x - 0.2f) < 1e-3f);
    // Одиночка: кластер = сама лампа.
    CHECK(std::fabs(c1.pos.x - 100.0f) < 1e-3f);
    CHECK(std::fabs(c1.radiusM - 8.0f) < 1e-3f);
    // Обратная полярность руками не нужна: каждое равенство выше — точное
    // число из вывода, любое искажение весов/охвата красит их само.
}

} // namespace lightvis_test

void test_lightvis_all() {
    lightvis_test::cluster_synthesis();
    lightvis_test::solidity_law();
    lightvis_test::dirty_radius_derivation();
    lightvis_test::pin_and_oracle_on_a_real_floor();
    lightvis_test::oracle_reverse_polarity_constructed();
    lightvis_test::carve_expands_same_call();
}
