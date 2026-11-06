// Система присутствия — универсальный пузырь ([sim/presence.h], matwej.md §23,
// инкремент F0). Включается в world_test.cpp: его CHECK, using namespace giga.
//
// Пины держат ПЯТЬ утверждений системы, и каждое названо вместе с тем, чем его
// можно опровергнуть:
//
//  1. N ВЫВОДИТСЯ, А НЕ НАЗНАЧАЕТСЯ: N = бюджет × 1000 / цена, усечённое вниз,
//     и края законны по-разному — бюджет 0 даёт честный N = 0, а цена 0
//     ОТКАЗЫВАЕТ в регистрации, потому что дала бы N = ∞, одетое в язык
//     бюджета. Опровергается любой правкой, которая превратит отказ в
//     дефолт.
//
//  2. РАДИУС — НОМИНАЛ, И ЭТО ЮНИТ-СВИДЕТЕЛЬ КОММУТАЦИИ (§23.1). Уровень есть
//     доля периода тора и ничего больше: никакой погодный множитель
//     (`samosbor_fog_scale` до ×0.34) и никакая env-ручка в него не входят.
//     Если бы входили — полный пузырь в самосборе сжимался бы 64 → 21.8 м, то
//     есть «суспендить и возобновить» перестало бы давать то же состояние
//     мира ровно в тот момент, когда в мире что-то происходит. Проверяется
//     ТОЧНЫМ равенством номиналу: любой множитель, даже 0.999, краснеет.
//
//  3. ЦЕНТРОВ МНОЖЕСТВО, И ДВА ЦЕНТРА — ОБЪЕДИНЕНИЕ, А НЕ ПЕРЕСЕЧЕНИЕ. Это
//     не придирка к словам: пересечение дало бы на двух игроках ПУСТО, то
//     есть мир застыл бы у обоих. Сцена построена так, что разница видна
//     числом (1 и 1 по отдельности, 2 вместе, 0 при пересечении).
//
//  4. КАП ЦЕНТРОВ 8 — ЭТО ЧИСЛО УПАКОВКИ, А НЕ ДОГАДКА О ЧИСЛЕ ИГРОКОВ, и
//     здесь проверяется ОБЕ ЕГО ПОЛОВИНЫ машинно: достижимость (восемь узлов
//     решётки {0,128}³ попарно удалены на ≥ 2R) и недостижимость девятого
//     (для любой точки тора ближайший узел ближе 2R). Вывод, который держит
//     только проза, — это вывод, который переживёт свой предмет.
//
//  5. ЗАПРОС «N БЛИЖАЙШИХ» ОТВЕЧАЕТ ТО ЖЕ, ЧТО БРУТФОРС — те же id в том же
//     порядке, включая РАЗВЕДЕНИЕ РАВНЫХ РАССТОЯНИЙ по id. Эталон написан
//     здесь НЕЗАВИСИМО от продакшн-кода: наивный повторный поиск минимума,
//     без куч и без std::sort (та же дисциплина, что у эталона клиренса в
//     [suite_clearance.inl]). Сцена — решётка, у которой счёт попавших в
//     радиус известен АРИФМЕТИЧЕСКИ (20 из 216), поэтому «тест прошёл» и
//     «тест дошёл куда думал» — разные утверждения, и оба проверены.

#include "sim/cell_bins.h"
#include "sim/presence.h"

namespace presence_test {

// Строитель бинов для сцены теста: все сущности с Transform на слое 0.
// Политика «кого бинить» принадлежит потребителю (шапка [sim/cell_bins.h]),
// поэтому здесь она своя, тестовая, и в продакшн-код не лезет.
inline void build_scene_bins(const Registry& reg, CellBins& bins) {
    bins.clear();
    for (auto e : reg.view<const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        bins.add(cell_bin_key(tr.layer, cell_coord(tr.pos.x),
                              cell_coord(tr.pos.y), cell_coord(tr.pos.z)),
                 e);
    }
    bins.build();
}

inline Entity spawn_at(Registry& reg, float x, float y, float z) {
    const Entity e = reg.create();
    reg.emplace<Transform>(e, Transform{vec3{x, y, z}, 0});
    return e;
}

// ЭТАЛОН: расстояние записи = минимум по центрам, посчитанный РОВНО тем же
// порядком операций, что и в продакшне (первый центр, затем строгое «меньше»).
// Иначе сравнение упало бы на последнем бите float и доказывало бы дрейф
// арифметики, а не дефект отбора.
inline float ref_min_d2(const vec3* centers, std::uint32_t n, const vec3& p) {
    float best = wrap_dist2(centers[0], p, kWorldExtent);
    for (std::uint32_t c = 1; c < n; ++c) {
        const float d2 = wrap_dist2(centers[c], p, kWorldExtent);
        if (d2 < best) best = d2;
    }
    return best;
}

// ---- 1. ВЫВОД N ------------------------------------------------------------
static void test_budget_derives_n() {
    presence_reset();

    // Числа §23.3: 2 мс бюджета при замеренных 8.72 мкс на труп (этаж 6).
    // 2000 / 8.72 = 229.36 — усечение вниз, потому что труп, влезающий
    // наполовину, бюджет превышает.
    const PresenceId rag = presence_register(
        {"test:ragdolls", PresenceLevel::kFull, PresenceClass::kFreeze, 2.0f,
         8.72f, "matwej.md §23.3: 8.72 мкс/труп, этаж 6, замер 2026-11-04"});
    CHECK(rag != kInvalidPresenceId);
    CHECK(presence_budget_n(rag) == 229);
    CHECK(presence_radius(rag) == kPresenceFullRadius);

    // Усечение вниз ещё раз, на числе, которое делится некрасиво: 1000/3.
    const PresenceId tr = presence_register(
        {"test:truncate", PresenceLevel::kVisible, PresenceClass::kCoarsen,
         1.0f, 3.0f, "unit"});
    CHECK(presence_budget_n(tr) == 333);

    // КРАЙ: бюджет 0 — законное «сейчас не платим», N = 0, НЕ отказ.
    const PresenceId zero = presence_register(
        {"test:zero-budget", PresenceLevel::kFull, PresenceClass::kFreeze,
         0.0f, 8.72f, "unit"});
    CHECK(zero != kInvalidPresenceId);
    CHECK(presence_budget_n(zero) == 0);

    CHECK(presence_consumer_count() == 3);

    // КРАЙ: цена 0 — ОТКАЗ. Три отказа подряд, и ни один не занимает слот:
    // регистрация, провалившаяся молча, дала бы потребителя, который думает,
    // что он в системе.
    CHECK(presence_register({"test:no-cost", PresenceLevel::kFull,
                             PresenceClass::kFreeze, 2.0f, 0.0f, "unit"}) ==
          kInvalidPresenceId);
    CHECK(presence_register({"test:negative-cost", PresenceLevel::kFull,
                             PresenceClass::kFreeze, 2.0f, -1.0f, "unit"}) ==
          kInvalidPresenceId);
    CHECK(presence_register({nullptr, PresenceLevel::kFull,
                             PresenceClass::kFreeze, 2.0f, 1.0f, "unit"}) ==
          kInvalidPresenceId);
    CHECK(presence_register({"test:no-source", PresenceLevel::kFull,
                             PresenceClass::kFreeze, 2.0f, 1.0f, nullptr}) ==
          kInvalidPresenceId);
    CHECK(presence_consumer_count() == 3);

    // Отказ отдаёт kInvalidPresenceId, и этот id безопасен для чтения: N = 0 и
    // радиус 0. Потребитель, не проверивший возврат, получит пустую выборку, а
    // не чужой бюджет — молчаливое присвоение чужого бюджета было бы худшим
    // исходом отказа.
    CHECK(presence_budget_n(kInvalidPresenceId) == 0);
    CHECK(presence_radius(kInvalidPresenceId) == 0.0f);
}

// ---- 2. РАДИУС — НОМИНАЛ (юнит-свидетель коммутации) -----------------------
static void test_level_radius_is_nominal() {
    presence_reset();

    // Доли периода тора, выведенные в [world/types.h]: 256 × 0.25 = 64 (старт
    // дымки) и 256 × 0.50 = 128 (предел однозначной дальности на торе).
    CHECK(presence_level_radius(PresenceLevel::kFull) == 64.0f);
    CHECK(presence_level_radius(PresenceLevel::kVisible) == 128.0f);
    CHECK(presence_level_radius(PresenceLevel::kFull) ==
          kWorldExtent * kFogStartFrac);
    CHECK(presence_level_radius(PresenceLevel::kVisible) ==
          kWorldExtent * kFogEndFrac);
    CHECK(kFogStartFrac * 2.0f == kFogEndFrac); // одна доля выводит другую

    // ГЛАВНОЕ УТВЕРЖДЕНИЕ СЮИТЫ. Погодное сжатие рендера — до ×0.34
    // (`kSamosborFogSqueeze`). Если бы оно просочилось в уровень, здесь стояли
    // бы 43.52 и 21.76 вместо 128 и 64. Равенство ТОЧНОЕ, поэтому краснеет и
    // множитель 0.999: радиус пузыря не имеет права быть функцией состояния
    // мира (§23.1), иначе суспенд перестаёт коммутировать.
    CHECK(presence_level_radius(PresenceLevel::kVisible) != 128.0f * 0.34f);
    CHECK(presence_level_radius(PresenceLevel::kFull) != 64.0f * 0.34f);

    const PresenceId id = presence_register(
        {"test:nominal", PresenceLevel::kVisible, PresenceClass::kCoarsen,
         1.0f, 1.0f, "unit"});
    CHECK(presence_radius(id) == 128.0f);

    // ШОВ ГЕЙТА КОММУТАЦИИ в ОБЕ полярности: включается, читается, выключается
    // и возвращает ровно номинал, а не «что-то около».
    CHECK(!presence_forced_infinite());
    presence_force_infinite(true);
    CHECK(presence_forced_infinite());
    CHECK(presence_radius(id) > 1.0e30f);
    CHECK(presence_level_radius(PresenceLevel::kFull) > 1.0e30f);
    presence_force_infinite(false);
    CHECK(!presence_forced_infinite());
    CHECK(presence_radius(id) == 128.0f);
}

// ---- 3. ЦЕНТРЫ: ОБЪЕДИНЕНИЕ, А НЕ ПЕРЕСЕЧЕНИЕ -----------------------------
static void test_two_centers_are_a_union() {
    presence_reset();
    Registry reg;

    // Центры разведены ровно на 2R полного пузыря (128 м) — на границе
    // упаковки, то есть пузыри касаются и не пересекаются. `a` сидит в первом,
    // `b` во втором, `c` снаружи обоих (100 м от первого, 162.5 от второго).
    const vec3 c0{10.0f, 10.0f, 10.0f};
    const vec3 c1{138.0f, 10.0f, 10.0f};
    const Entity a = spawn_at(reg, 10.0f, 10.0f, 10.0f);
    const Entity b = spawn_at(reg, 138.0f, 10.0f, 10.0f);
    const Entity c = spawn_at(reg, 10.0f, 110.0f, 10.0f);
    CHECK(wrap_dist(c0, c1, kWorldExtent) == 2.0f * kPresenceFullRadius);

    CellBins bins;
    build_scene_bins(reg, bins);
    CHECK(bins.entries.size() == 3);

    const PresenceId id = presence_register(
        {"test:centers", PresenceLevel::kFull, PresenceClass::kFreeze, 1.0f,
         0.001f, "unit"}); // N = 1 000 000, бюджет здесь не ограничитель
    CellBins::Near out[8];

    // Один центр — один попавший, и это `a`.
    presence_set_centers(&c0, 1);
    CHECK(presence_center_count() == 1);
    CHECK(presence_query(id, bins, reg, out, 8) == 1);
    CHECK(out[0].e == a);

    // Другой центр — другой попавший. Ни `a`, ни `c`.
    presence_set_centers(&c1, 1);
    CHECK(presence_query(id, bins, reg, out, 8) == 1);
    CHECK(out[0].e == b);

    // ОБА центра — ДВА попавших. Пересечение дало бы ноль, то есть застывший
    // мир у обоих игроков; объединение даёт каждому его пузырь.
    const vec3 both[2] = {c0, c1};
    presence_set_centers(both, 2);
    CHECK(presence_center_count() == 2);
    CHECK(presence_query(id, bins, reg, out, 8) == 2);
    CHECK(out[0].e == a); // равные нулевые расстояния разведены по id
    CHECK(out[1].e == b);
    CHECK(out[0].d2 == 0.0f);
    CHECK(out[1].d2 == 0.0f);
    CHECK(out[0].e != c);
    CHECK(out[1].e != c);

    // Центров нет — наблюдателя нет: ответ ПУСТОЙ, а не «всё внутри».
    presence_set_centers(both, 0);
    CHECK(presence_center_count() == 0);
    CHECK(presence_query(id, bins, reg, out, 8) == 0);

    // Перелив капа СЧИТАЕТСЯ, а не режет молча: девять центров дают восемь.
    vec3 many[kMaxPresenceCenters + 1];
    for (std::uint32_t i = 0; i < kMaxPresenceCenters + 1; ++i)
        many[i] = vec3{static_cast<float>(i) * 16.0f, 0.0f, 0.0f};
    presence_set_centers(many, kMaxPresenceCenters + 1);
    CHECK(presence_center_count() == kMaxPresenceCenters);
    presence_set_centers(nullptr, 4);
    CHECK(presence_center_count() == 0);
}

// ---- 4. КАП ЦЕНТРОВ 8 = ЧИСЛО УПАКОВКИ ПОЛНЫХ ПУЗЫРЕЙ ---------------------
static void test_center_cap_is_the_packing_number() {
    // ПОЛОВИНА ПЕРВАЯ — ДОСТИЖИМОСТЬ. Восемь узлов решётки {0,128}³ попарно
    // удалены на 128, 128√2 и 128√3 метров, то есть все ≥ 2R при R = 64:
    // восемь полных пузырей касаются и НЕ пересекаются.
    vec3 lat[8];
    int n = 0;
    for (int i = 0; i < 2; ++i)
        for (int j = 0; j < 2; ++j)
            for (int k = 0; k < 2; ++k)
                lat[n++] = vec3{static_cast<float>(i) * 128.0f,
                                static_cast<float>(j) * 128.0f,
                                static_cast<float>(k) * 128.0f};
    CHECK(n == static_cast<int>(kMaxPresenceCenters));
    for (int p = 0; p < 8; ++p)
        for (int q = p + 1; q < 8; ++q)
            CHECK(wrap_dist(lat[p], lat[q], kWorldExtent) >=
                  2.0f * kPresenceFullRadius);

    // ПОЛОВИНА ВТОРАЯ — НЕДОСТИЖИМОСТЬ ДЕВЯТОГО. На окружности периода 256
    // метки 0 и 128 делят её на две дуги по 128, поэтому любая координата
    // удалена от ближайшей метки не более чем на 64; значит для ЛЮБОЙ точки
    // тора ближайший узел ближе 64√3 = 110.85 < 128 = 2R, и девятый центр
    // обязан пересечь чей-то пузырь. Проба — решётка 9³ шагом 32 м, то есть
    // весь тор включая узлы, середины рёбер и центры ячеек.
    float worst = 0.0f;
    for (int x = 0; x < 9; ++x)
        for (int y = 0; y < 9; ++y)
            for (int z = 0; z < 9; ++z) {
                const vec3 p{static_cast<float>(x) * 32.0f,
                             static_cast<float>(y) * 32.0f,
                             static_cast<float>(z) * 32.0f};
                float best = wrap_dist(lat[0], p, kWorldExtent);
                for (int q = 1; q < 8; ++q) {
                    const float d = wrap_dist(lat[q], p, kWorldExtent);
                    if (d < best) best = d;
                }
                if (best > worst) worst = best;
                CHECK(best < 2.0f * kPresenceFullRadius);
            }
    // И сама граница 64√3 — не «примерно», а точно: худшая точка решётки проб
    // есть центр ячейки, и она обязана лежать ровно на 64√3.
    CHECK(worst > 110.8f && worst < 110.9f);
}

// ---- 5. ЗАПРОС ПРОТИВ БРУТФОРСА -------------------------------------------
static void test_knn_matches_bruteforce() {
    presence_reset();
    Registry reg;

    // Сцена — решётка 6³ = 216 тел шагом 24 м из точки (4,4,4). Центр = узел
    // (0,0,0), радиус 64. Счёт попавших ИЗВЕСТЕН АРИФМЕТИЧЕСКИ: внутрь входят
    // ровно те (i,j,k), у которых 576·(i²+j²+k²) ≤ 4096, то есть сумма
    // квадратов ≤ 7; таких в кубе [0,5]³ — 1+3+3+1+3+6+3 = 20 (7 суммой трёх
    // квадратов не представимо). Это и есть проверка «тест дошёл туда, куда я
    // думал»: не «что-то нашлось», а ДВАДЦАТЬ.
    const int kSide = 6;
    const float kStep = 24.0f;
    const float kOrigin = 4.0f;
    for (int i = 0; i < kSide; ++i)
        for (int j = 0; j < kSide; ++j)
            for (int k = 0; k < kSide; ++k)
                spawn_at(reg, kOrigin + static_cast<float>(i) * kStep,
                         kOrigin + static_cast<float>(j) * kStep,
                         kOrigin + static_cast<float>(k) * kStep);

    CellBins bins;
    build_scene_bins(reg, bins);
    CHECK(bins.entries.size() == 216);

    const vec3 centre{kOrigin, kOrigin, kOrigin};
    presence_set_centers(&centre, 1);

    // ЭТАЛОН — наивный повторный поиск минимума по (d2, id). Ни куч, ни
    // std::sort: алгоритм отбора написан здесь ВТОРОЙ РАЗ и независимо, иначе
    // тест сверял бы продакшн-код с самим собой.
    Entity refE[32];
    float refD2[32];
    int refCount = 0;
    int eligibleRef = 0;
    {
        bool taken[216] = {};
        Entity all[216];
        float d2all[216];
        int m = 0;
        for (const CellBins::Entry& en : bins.entries) {
            if (m >= 216) break; // сцена детерминирована, но буфер не на вере
            const Transform& tr = reg.get<const Transform>(en.e);
            all[m] = en.e;
            d2all[m] = ref_min_d2(&centre, 1, tr.pos);
            if (d2all[m] <= kPresenceFullRadius * kPresenceFullRadius)
                ++eligibleRef;
            ++m;
        }
        while (refCount < 32) {
            int bestIdx = -1;
            for (int t = 0; t < m; ++t) {
                if (taken[t]) continue;
                if (d2all[t] > kPresenceFullRadius * kPresenceFullRadius)
                    continue;
                if (bestIdx < 0 || d2all[t] < d2all[bestIdx] ||
                    (d2all[t] == d2all[bestIdx] && all[t] < all[bestIdx]))
                    bestIdx = t;
            }
            if (bestIdx < 0) break;
            taken[bestIdx] = true;
            refE[refCount] = all[bestIdx];
            refD2[refCount] = d2all[bestIdx];
            ++refCount;
        }
    }
    CHECK(eligibleRef == 20);
    CHECK(refCount == 20);

    // N = 7 из бюджета: 0.0075 мс / 1 мкс = 7.5, усечённое вниз. Седьмой
    // сидит ровно на границе тройки равноудалённых (d² = 1152) — то есть
    // выборка обязана разводить равные расстояния по id, иначе ответ зависел
    // бы от порядка в памяти.
    const PresenceId id7 = presence_register(
        {"test:knn-7", PresenceLevel::kFull, PresenceClass::kFreeze, 0.0075f,
         1.0f, "unit"});
    CHECK(presence_budget_n(id7) == 7);
    CellBins::Near out[64];
    CHECK(presence_query(id7, bins, reg, out, 64) == 7);
    for (int t = 0; t < 7; ++t) {
        CHECK(out[t].e == refE[t]);
        CHECK(out[t].d2 == refD2[t]);
    }
    // Порядок возрастающий — не «примерно отсортировано».
    for (int t = 1; t < 7; ++t) CHECK(out[t - 1].d2 <= out[t].d2);

    // БЮДЖЕТ ШИРЕ СЦЕНЫ: выдаётся всё, что в радиусе, и ни одного лишнего.
    const PresenceId idAll = presence_register(
        {"test:knn-all", PresenceLevel::kFull, PresenceClass::kFreeze, 1.0f,
         1.0f, "unit"});
    CHECK(presence_budget_n(idAll) == 1000);
    CHECK(presence_query(idAll, bins, reg, out, 64) == 20);
    for (int t = 0; t < 20; ++t) {
        CHECK(out[t].e == refE[t]);
        CHECK(out[t].d2 == refD2[t]);
    }

    // БУФЕР ВЫЗЫВАЮЩЕГО — ВТОРОЙ ПОТОЛОК, и он тоже честный: 5 мест при N=1000
    // дают пять БЛИЖАЙШИХ, а не первые пять попавшихся.
    CHECK(presence_query(idAll, bins, reg, out, 5) == 5);
    for (int t = 0; t < 5; ++t) CHECK(out[t].e == refE[t]);

    // КРАЙ: нулевой буфер и нулевой бюджет дают ноль, и ни один из них не
    // падает и не пишет мимо.
    CHECK(presence_query(idAll, bins, reg, out, 0) == 0);
    const PresenceId idZero = presence_register(
        {"test:knn-zero", PresenceLevel::kFull, PresenceClass::kFreeze, 0.0f,
         1.0f, "unit"});
    CHECK(presence_query(idZero, bins, reg, out, 64) == 0);

    // ШОВ ∞: «всё живое» — это И радиус, И счёт. 216 тел из 216, то есть
    // пузыря нет вовсе; это ровно тот прогон, с которым дайджест-гейт класса 1
    // будет сличать настоящий (§23.1, включится с F1).
    presence_force_infinite(true);
    CHECK(presence_query(idZero, bins, reg, out, 64) == 64);
    CellBins::Near wide[256];
    CHECK(presence_query(idZero, bins, reg, wide, 256) == 216);
    presence_force_infinite(false);
    CHECK(presence_query(idZero, bins, reg, out, 64) == 0);

    // Незарегистрированный id не отвечает ничем — чужого бюджета не бывает.
    CHECK(presence_query(kInvalidPresenceId, bins, reg, out, 64) == 0);
}

// ---- 6. ПРИБОР ДОХОДИТ ДО ПЕЧАТИ ------------------------------------------
// Потребитель, которому система дала радиус, но не счёт (отбор ламп), сообщает
// свою отбраковку сам. Тест зовёт и `presence_note`, и `presence_report` — не
// ради их возвращаемых значений, а потому что принтер, которого никто не
// исполняет, зелен и бесполезен (§24.5).
static void test_report_is_reached() {
    presence_reset();
    const PresenceId id = presence_register(
        {"test:report", PresenceLevel::kVisible, PresenceClass::kCoarsen, 0.54f,
         0.234f, "problems.md §78 — та же пара чисел, что у отбора ламп"});
    CHECK(presence_budget_n(id) == 2307);
    presence_note(id, 100, 7);
    presence_note(kInvalidPresenceId, 1, 1); // не падает на чужом id
    presence_report();
    CHECK(presence_consumer_count() == 1);
    presence_reset();
    CHECK(presence_consumer_count() == 0);
    CHECK(presence_center_count() == 0);
    CHECK(!presence_forced_infinite());
    presence_report(); // пустой белый список тоже печатается, а не молчит
}

} // namespace presence_test

static void test_presence_all() {
    presence_test::test_budget_derives_n();
    presence_test::test_level_radius_is_nominal();
    presence_test::test_two_centers_are_a_union();
    presence_test::test_center_cap_is_the_packing_number();
    presence_test::test_knn_matches_bruteforce();
    presence_test::test_report_is_reached();
    std::printf("[presence] вывод N, номинал радиуса, объединение центров, "
                "число упаковки 8, kNN против брутфорса\n");
}
