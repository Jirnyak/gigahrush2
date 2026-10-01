// ЗВЕНО СПРОС·ПРЕДЛОЖЕНИЕ — гейты ([game/place.h], CANON S12.3/S13.2).
//
// Что здесь доказывается, по убыванию цены ошибки:
//
//  1. РАЗМЕРНОСТЬ СХОДИТСЯ, и проверяется она примером САМОГО канона S13.3:
//     своя жилая комната (объявлено 30 + койка 17) в восьми клетках даёт
//     47 − 8 = 39, а одинокая койка в одной клетке — 17 − 1 = 16. Числа 30 и 17
//     берутся из ЖИВЫХ данных (`khrushi_gen` объявляет 30, `kPropVerbs[bed_cot]`
//     даёт 17), а не выписаны в тесте. Несходящаяся размерность — тот дефект,
//     который у соседнего проекта дал перекос ЗНАКА ×50–100.
//
//  2. ОТСЕЧКА БИНАМИ ТОЖДЕСТВЕННА ПЕРЕБОРУ. Оракул: 311 комнат, девять позиций
//     тела, четыре вектора спроса — и `place_pick` обязан дать ТОТ ЖЕ ответ, что
//     полный перебор всех комнат. Это единственная проверка, которая отличает
//     работающую верхнюю грань от объявленной: потолок бина, посчитанный хоть
//     на единицу ниже истины, молча отрезает честного кандидата.
//     + ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: отсечка обязана СУЖАТЬ (суждений меньше, чем
//     комнат; бинов меньше, чем 4096) — иначе «тождественно перебору» означало
//     бы, что она просто выключена.
//
//  3. ТОЧКА ПОД НОГАМИ — КАНДИДАТ ВСЕГДА, и фолбэка «ничего не нашлось» нет
//     (S13.9): тело в лучшей комнате не трогается, нулевой спрос никого не
//     двигает, и обе ответа — kNoRoom, а не «первая по массиву».
//
//  4. СКАЛЯРНОЕ ПРОИЗВЕДЕНИЕ, А НЕ ВЕТКА: интерес растёт по ДВУМ глаголам
//     одновременно и делится на тысячу ОДИН раз, на сумме.
//
//  5. ИЗОТРОПИЯ (S1): перестановка осей x↔y↔z не меняет ни счёта, ни выбора.
//
//  6. ХОД: тело забирает токен и идёт К ЦЕЛИ; тело, которым владеет бегство,
//     не трогается; пустой бейк — no-op; носитель камеры не обслуживается.
//
// Включается из game_test.cpp, пользуется его CHECK.

#include "game/ai.h"          // ai_init — проход требует AiBrain
#include "game/embody.h"      // embody
#include "game/place.h"
#include "game/prop_table.h"  // kPropVerbs — «койка 17» из живых данных
#include "game/room.h"
#include "game/room_supply.h" // supply_add_prop — ОСНАЩЕНИЕ настоящей дверью
#include "world/nav.h"

namespace place_suite {

using namespace giga;
using namespace giga::game;

constexpr LayerId kLayer = 0;

// Сентинель скорости: ни один рулевой его не напишет (`place_errand_step`
// пишет dir*kErrandSpeed, вандер — ноль или dir*speed), поэтому «x всё ещё
// равен kSentX» есть ТОЧНЫЙ, а не статистический ответ на «кто-то писал это
// тело?». Приём взят у suite_utilai.inl.
constexpr float kSentX = 555.0f;
constexpr float kSentY = -555.0f;

inline float cell_centre(int c) { return (static_cast<float>(c) + 0.5f) * kCellSize; }

// Воплощённый житель в центре клетки.
inline Entity make_body(Registry& reg, NpcPool& pool, int cx, int cy, int cz,
                        NpcId& outId) {
    const NpcId id = pool.spawn();
    pool.hp(id) = 100;
    pool.max_hp(id) = 100;
    const Entity e = embody(reg, pool, id, kLayer);
    reg.get<Transform>(e).pos = vec3{cell_centre(cx), cell_centre(cy), cell_centre(cz)};
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    outId = id;
    return e;
}

// Строка нужд с ОДНИМ пустым резервом: спрос выходит сосредоточенным, и тест
// читает его, а не угадывает.
inline void set_needs_sleepy(NpcPool& pool, NpcId id) {
    Needs& n = pool.needs(id);
    n.food = kNeedMax;
    n.water = kNeedMax;
    n.sleep = 0.0f;
    n.pee = 0.0f;
    n.poo = 0.0f;
    n.pendingPee = 0.0f;
    n.pendingPoo = 0.0f;
    n.seeded = 1;
}

inline void set_needs_satisfied(NpcPool& pool, NpcId id) {
    Needs& n = pool.needs(id);
    n.food = kNeedMax;
    n.water = kNeedMax;
    n.sleep = kNeedMax;
    n.pee = 0.0f;
    n.poo = 0.0f;
    n.pendingPee = 0.0f;
    n.pendingPoo = 0.0f;
    n.seeded = 1;
}

// Дешёвая арена нава (приём suite_utilai/suite_behaviours): настоящий
// `bake_fine` — это 128 МиБ и секунды BFS, а `route_step` читает ровно один
// байт потока плюс строку coarse. Один узел (0) и есть всё, что нужно:
// `nearest` целиком нулевой делает узлом цели и узлом источника нуль, а
// зануленный `CoarseGraph` даёт dist[0][0] = 0, то есть «достижимо».
inline void arm_nav(nav::CoarseGraph& coarse, nav::FineNav& fine,
                    std::uint8_t flowByte) {
    coarse = nav::CoarseGraph{};
    fine.flow.assign(kMacroCells, flowByte);
    fine.nearest.assign(kMacroCells, static_cast<std::uint8_t>(0));
}

// Объявить одну кубическую комнату со спросом по одному глаголу.
inline RoomId declare_cube(FloorRooms& fr, int x, int y, int z, int side,
                           VerbId verb, std::int16_t amount) {
    std::int16_t declared[kVerbCount] = {};
    declared[verb] = amount;
    const RoomBox box{static_cast<std::uint8_t>(x), static_cast<std::uint8_t>(y),
                      static_cast<std::uint8_t>(z), static_cast<std::uint8_t>(side),
                      static_cast<std::uint8_t>(side), static_cast<std::uint8_t>(side)};
    return room_declare(fr, &box, 1, /*tags=*/0, /*owner=*/0, declared);
}

// ПЕРЕБОР — оракул отсечки. Тот же закон ничьей, что у `place_pick`: счёт →
// издержка → номер. Порядок обхода другой НАМЕРЕННО: если ответы совпадают при
// разном порядке, значит правило ничьей — полный порядок, а не удача.
inline PlacePick brute_pick(const FloorRooms& fr, const DemandE3 demand[kVerbCount],
                            int cx, int cy, int cz) {
    PlacePick out;
    std::int32_t best = 0;
    std::int32_t bestCost = 0;
    if (const Room* here = room_of(fr, room_at(fr, cx, cy, cz)))
        best = place_interest(*here, demand);
    for (std::size_t i = fr.list.size(); i-- > 0;) { // С КОНЦА, не с начала
        const RoomId id = static_cast<RoomId>(i + 1);
        const Room& r = fr.list[i];
        const std::int32_t cost = place_cost(fr, r, cx, cy, cz);
        const std::int32_t score = place_interest(r, demand) - cost;
        const bool better =
            score > best ||
            (score == best && out.room != kNoRoom && cost < bestCost) ||
            (score == best && out.room != kNoRoom && cost == bestCost && id < out.room);
        if (!better) continue;
        best = score;
        bestCost = cost;
        out.room = id;
    }
    out.score = best;
    out.cost = out.room == kNoRoom ? 0 : bestCost;
    return out;
}

} // namespace place_suite

// --- 1. СПРОС: четвёртый стол словаря глаголов ------------------------------

static void test_place_demand_from_needs() {
    using namespace place_suite;

    Needs full{};
    full.food = kNeedMax;
    full.water = kNeedMax;
    full.sleep = kNeedMax;
    full.seeded = 1;
    DemandE3 d[kVerbCount];
    demand_from_needs(full, d);
    // Полные резервы — нулевой спрос на их глаголы.
    CHECK(d[kVerbSleep] == 0);
    CHECK(d[kVerbEat] == 0);
    CHECK(d[kVerbDrink] == 0);
    CHECK(d[kVerbToilet] == 0);
    // ...но «шататься» НИКОГДА не ноль (S13.2: замирающий NPC — дефект).
    CHECK(d[kVerbWander] == kDemandWanderFloor);
    CHECK(d[kVerbWander] > 0);
    // Вектор пишется ЦЕЛИКОМ: ни одного неинициализированного слота.
    for (std::size_t v = 0; v < kVerbCount; ++v)
        CHECK(d[v] == 0 || v == kVerbWander);

    // Пустые резервы — спрос на всю тысячу. Кривая та же, которой интент-арбитр
    // судит те же бары (`needs_low_pressure`, [game/needs.h]).
    Needs empty{};
    empty.seeded = 1;
    demand_from_needs(empty, d);
    CHECK(d[kVerbSleep] == kDemandFull);
    CHECK(d[kVerbEat] == kDemandFull);
    CHECK(d[kVerbDrink] == kDemandFull);

    // СОРТИР — МАКСИМУМ ДВУХ ДАВЛЕНИЙ, НЕ СУММА: одного полного мочевого
    // достаточно, и сумма требовала бы обоих сразу.
    //
    // ПРОВЕРКА НА КАПЕ ЭТОГО НЕ ЛОВИТ, и выяснилось это мутацией, а не
    // рассуждением: `clamp01` внутри перевода в тысячные режет и 1.0, и 2.0 в
    // одну тысячу, поэтому при двух полных давлениях сумма и максимум дают
    // ОДИН ответ. Прежняя редакция этого комментария утверждала обратное и
    // была неверна. Различает их только ЧАСТИЧНОЕ давление: 62.5 — ровно
    // середина рампы `needs_high_pressure` (0.625 = (0.35+0.90)/2), то есть
    // каждое давление даёт 0.5; максимум — 500, сумма — 1000.
    Needs half{};
    half.food = kNeedMax;
    half.water = kNeedMax;
    half.sleep = kNeedMax;
    half.pee = 62.5f;
    half.poo = 62.5f;
    half.seeded = 1;
    demand_from_needs(half, d);
    CHECK(d[kVerbToilet] == 500);

    Needs pee{};
    pee.food = kNeedMax;
    pee.water = kNeedMax;
    pee.sleep = kNeedMax;
    pee.pee = kNeedMax;
    pee.seeded = 1;
    demand_from_needs(pee, d);
    const DemandE3 onlyPee = d[kVerbToilet];
    CHECK(onlyPee == kDemandFull);
    Needs both = pee;
    both.poo = kNeedMax;
    demand_from_needs(both, d);
    CHECK(d[kVerbToilet] == onlyPee);

    // ОБРАЗЕЦ РАСШИРЕНИЯ S13.1: «контекст → добавь глаголу». Прибавляет, не
    // пишет, и клампится — два вызова не дают две тысячи.
    demand_from_needs(full, d);
    CHECK(d[kVerbHeal] == 0);
    demand_add_health(100.0f, 100.0f, d);
    CHECK(d[kVerbHeal] == 0); // полное HP ничего не просит
    demand_add_health(0.0f, 100.0f, d);
    CHECK(d[kVerbHeal] == kDemandFull);
    demand_add_health(0.0f, 100.0f, d);
    CHECK(d[kVerbHeal] == kDemandFull); // кламп, а не 2000
    // maxHp == 0 (строка без тела) не делит на ноль и ничего не просит.
    DemandE3 z[kVerbCount];
    demand_from_needs(full, z);
    demand_add_health(0.0f, 0.0f, z);
    CHECK(z[kVerbHeal] == 0);
}

// --- 2. ИНТЕРЕС: скалярное произведение, одно деление ------------------------

static void test_place_interest_is_a_dot_product() {
    using namespace place_suite;
    FloorRooms fr;
    rooms_reset(fr);
    std::int16_t declared[kVerbCount] = {};
    declared[kVerbSleep] = 30;
    declared[kVerbEat] = 12;
    const RoomBox box{10, 10, 10, 2, 2, 2};
    const RoomId id = room_declare(fr, &box, 1, 0, 0, declared);
    CHECK(id != kNoRoom);
    const Room& r = *room_of(fr, id);

    DemandE3 d[kVerbCount] = {};
    d[kVerbSleep] = kDemandFull;
    CHECK(place_interest(r, d) == 30);
    // ВТОРОЙ глагол входит слагаемым, а не веткой: 30 + 12.
    d[kVerbEat] = kDemandFull;
    CHECK(place_interest(r, d) == 42);
    // Половина спроса — половина интереса, и деление ОДНО, на сумме:
    // (500*30 + 500*12) / 1000 = 21, а не 15 + 6 с двумя усечениями.
    d[kVerbSleep] = 500;
    d[kVerbEat] = 500;
    CHECK(place_interest(r, d) == 21);
    // Нулевой спрос — нулевой интерес, чем бы комната ни была богата.
    DemandE3 zero[kVerbCount] = {};
    CHECK(place_interest(r, zero) == 0);
    // Глагол, которого комната не предлагает, не приносит ничего.
    DemandE3 other[kVerbCount] = {};
    other[kVerbTrade] = kDemandFull;
    CHECK(place_interest(r, other) == 0);
}

// --- 3. ПРИМЕР КАНОНА S13.3, ЦЕЛИКОМ И НА ЖИВЫХ ДАННЫХ ----------------------

static void test_place_canon_s13_3_example() {
    using namespace place_suite;
    // «Койка 17» — не литерал теста, а строка таблицы пропов.
    const std::int16_t cotSleep = kPropVerbs[static_cast<std::size_t>(PropId::BedCot)][kVerbSleep];
    CHECK(cotSleep == 17);
    // «Объявлено 30» — то, что объявляет модуль хрущей своей спальне.
    constexpr std::int16_t kDeclaredBed = 30;

    FloorRooms fr;
    rooms_reset(fr);
    // Тело стоит в клетке (40,40,40). Своя жилая — ровно в восьми клетках по x.
    const int bx = 40, by = 40, bz = 40;
    const RoomId home = declare_cube(fr, bx + 8, by, bz, 1, kVerbSleep, kDeclaredBed);
    CHECK(home != kNoRoom);
    // Койка внутри — настоящей дверью оснащения (S12.4), не записью в поле.
    supply_add_prop(fr, home, PropId::BedCot, +1);
    CHECK(room_of(fr, home)->supply[kVerbSleep] == cotSleep);

    // Одинокая койка в одной клетке от тела: предложения объявлено ноль.
    const RoomId lone = declare_cube(fr, bx + 1, by, bz, 1, kVerbSleep, 0);
    CHECK(lone != kNoRoom);
    supply_add_prop(fr, lone, PropId::BedCot, +1);

    DemandE3 d[kVerbCount] = {};
    d[kVerbSleep] = kDemandFull; // «хочу спать» на всю тысячу

    // ЧИСЛА КАНОНА. 47 − 8 = 39 против 17 − 1 = 16.
    CHECK(place_interest(*room_of(fr, home), d) == kDeclaredBed + cotSleep);
    CHECK(place_cost(fr, *room_of(fr, home), bx, by, bz) == 8);
    CHECK(place_interest(*room_of(fr, lone), d) == cotSleep);
    CHECK(place_cost(fr, *room_of(fr, lone), bx, by, bz) == 1);

    const PlacePick pick = place_pick(fr, d, bx, by, bz);
    CHECK(pick.room == home);
    CHECK(pick.score == 39);
    CHECK(pick.cost == 8);

    // «КОЙКУ ВЫНЕСЛИ → спит у себя без кровати» — та же шкала, без ветки:
    // 30 − 8 = 22 всё ещё больше, чем 0 − 1.
    supply_add_prop(fr, home, PropId::BedCot, -1);
    supply_add_prop(fr, lone, PropId::BedCot, -1);
    const PlacePick after = place_pick(fr, d, bx, by, bz);
    CHECK(after.room == home);
    CHECK(after.score == kDeclaredBed - 8);
}

// --- 4. ТОЧКА ПОД НОГАМИ И ОТСУТСТВИЕ ФОЛБЭКА -------------------------------

static void test_place_incumbent_is_always_a_candidate() {
    using namespace place_suite;
    FloorRooms fr;
    rooms_reset(fr);
    // Тело стоит ВНУТРИ богатой спальни; рядом спальня беднее.
    const RoomId here = declare_cube(fr, 60, 60, 60, 2, kVerbSleep, 40);
    const RoomId poorer = declare_cube(fr, 64, 60, 60, 2, kVerbSleep, 30);
    CHECK(here != kNoRoom && poorer != kNoRoom);
    DemandE3 d[kVerbCount] = {};
    d[kVerbSleep] = kDemandFull;

    // Стоя в лучшей комнате, тело НЕ ИДЁТ никуда: ответ kNoRoom есть законный
    // ответ «место под ногами лучшее», а не неудача поиска.
    CHECK(room_at(fr, 60, 60, 60) == here);
    const PlacePick stay = place_pick(fr, d, 60, 60, 60);
    CHECK(stay.room == kNoRoom);

    // Стоя в беднейшей — идёт в богатую (путь оплачен и всё равно выгоден).
    const PlacePick leave = place_pick(fr, d, 65, 61, 61);
    CHECK(leave.room == here);

    // НУЛЕВОЙ СПРОС НИКОГО НЕ ДВИГАЕТ: сумма нулевая у всех, инкумбент выигрывает
    // ничью по нулевой издержке. Это и есть «ничего не хочу — гуляю».
    DemandE3 zero[kVerbCount] = {};
    CHECK(place_pick(fr, zero, 65, 61, 61).room == kNoRoom);

    // РАВНЫЕ КОМНАТЫ НА РАВНОМ РАССТОЯНИИ: ничью решает издержка, а при равной
    // издержке — номер, и ответ НЕ ЗАВИСИТ от порядка в памяти (сверка с
    // перебором, который идёт с конца списка).
    FloorRooms sym;
    rooms_reset(sym);
    const RoomId left = declare_cube(sym, 30, 40, 40, 1, kVerbEat, 25);
    const RoomId right = declare_cube(sym, 50, 40, 40, 1, kVerbEat, 25);
    CHECK(left != kNoRoom && right != kNoRoom);
    DemandE3 hungry[kVerbCount] = {};
    hungry[kVerbEat] = kDemandFull;
    const PlacePick tie = place_pick(sym, hungry, 40, 40, 40);
    const PlacePick tieBrute = brute_pick(sym, hungry, 40, 40, 40);
    CHECK(tie.room == tieBrute.room);
    CHECK(tie.score == tieBrute.score);
    CHECK(tie.room == left); // равный счёт, равная издержка → меньший номер

    // Пустые комнаты этажа — тоже законный вход: ни падения, ни выбора.
    FloorRooms bare;
    rooms_reset(bare);
    CHECK(place_pick(bare, hungry, 10, 10, 10).room == kNoRoom);
}

// --- 5. ОРАКУЛ: БИНЫ ТОЖДЕСТВЕННЫ ПЕРЕБОРУ ----------------------------------

static void test_place_bins_match_brute_force() {
    using namespace place_suite;
    FloorRooms fr;
    rooms_reset(fr);
    // 311 комнат по всему тору, детерминированно: позиция и предложение из
    // хеша индекса, два-три глагола на комнату. 311 — простое, чтобы шаг по
    // тору не ложился в решётку бинов периодом.
    constexpr int kRooms = 311;
    for (int i = 0; i < kRooms; ++i) {
        const std::uint32_t h = giga::hash_u32(static_cast<std::uint32_t>(i) * 2654435761u);
        const int x = static_cast<int>(h % kMacroDim);
        const int y = static_cast<int>((h >> 8) % kMacroDim);
        const int z = static_cast<int>((h >> 16) % kMacroDim);
        const int side = 1 + static_cast<int>((h >> 24) % 3u);
        std::int16_t declared[kVerbCount] = {};
        declared[kVerbSleep] = static_cast<std::int16_t>(h % 41u);
        declared[kVerbEat] = static_cast<std::int16_t>((h >> 5) % 37u);
        declared[kVerbToilet] = static_cast<std::int16_t>((h >> 11) % 23u);
        const RoomBox box{static_cast<std::uint8_t>(x), static_cast<std::uint8_t>(y),
                          static_cast<std::uint8_t>(z), static_cast<std::uint8_t>(side),
                          static_cast<std::uint8_t>(side), static_cast<std::uint8_t>(side)};
        room_declare(fr, &box, 1, 0, 0, declared);
    }
    CHECK(fr.list.size() == static_cast<std::size_t>(kRooms));

    // Четыре профиля спроса: сосредоточенный, смешанный, слабый, нулевой.
    DemandE3 profiles[4][kVerbCount] = {};
    profiles[0][kVerbSleep] = kDemandFull;
    profiles[1][kVerbSleep] = 600;
    profiles[1][kVerbEat] = 400;
    profiles[1][kVerbToilet] = 200;
    profiles[2][kVerbEat] = 40;
    // profiles[3] — нулевой

    std::uint32_t cutCases = 0;
    for (int p = 0; p < 4; ++p)
        for (int s = 0; s < 9; ++s) {
            const std::uint32_t hs = giga::hash_u32(static_cast<std::uint32_t>(s) + 9173u);
            const int cx = static_cast<int>(hs % kMacroDim);
            const int cy = static_cast<int>((hs >> 9) % kMacroDim);
            const int cz = static_cast<int>((hs >> 18) % kMacroDim);
            const PlacePick fast = place_pick(fr, profiles[p], cx, cy, cz);
            const PlacePick slow = brute_pick(fr, profiles[p], cx, cy, cz);
            // ТОЖДЕСТВО: и счёт, и выбранная комната, и её издержка.
            CHECK(fast.score == slow.score);
            CHECK(fast.room == slow.room);
            CHECK(fast.cost == slow.cost);
            // ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: отсечка обязана СУЖАТЬ. Иначе тождество
            // означало бы лишь, что она выключена.
            if (fast.judged < static_cast<std::uint32_t>(kRooms) &&
                fast.bins < kRoomBinCount)
                ++cutCases;
        }
    // Из 36 случаев сужение обязано случиться в подавляющем большинстве:
    // нулевой профиль кончает обход на нулевом шелле, слабый — на первых.
    CHECK(cutCases >= 30);
}

// РАЗРЕЖЕННЫЕ СЦЕНЫ — И ЭТО НЕ ПРИДИРКА, А ИСПРАВЛЕНИЕ ГЕЙТА.
//
// Первый прогон этого сьюта поймал мутацию «нижняя грань пути завышена на одно
// ребро бина» НЕ оракулом выше, а побочной проверкой симметричной ничьи. То
// есть оракул на 311 ПЛОТНЫХ комнатах к той самой ошибке, против которой он
// написан, оказался слеп: при плотной застройке победитель почти всегда в
// соседнем бине, и лишние восемь клеток запаса его не отрезают.
//
// Отсечка ошибается там, где победитель ДАЛЁК И БОГАТ: именно тогда разница
// между (r−1) и r рёбрами бина переваливает порог. Поэтому сцены здесь
// РАЗРЕЖЕННЫЕ — шесть комнат на тор, богатство и расстояние разведены хешем, —
// и мутация обязана красить уже этот оракул, а не его соседа.
static void test_place_bins_match_brute_force_sparse() {
    using namespace place_suite;
    constexpr int kScenes = 40;
    std::uint32_t farWins = 0;
    for (int s = 0; s < kScenes; ++s) {
        FloorRooms fr;
        rooms_reset(fr);
        const std::uint32_t hs = giga::hash_u32(static_cast<std::uint32_t>(s) + 77003u);
        // Тело в начале координат сцены; комнаты разбросаны по всему тору.
        const int cx = static_cast<int>(hs % kMacroDim);
        const int cy = static_cast<int>((hs >> 7) % kMacroDim);
        const int cz = static_cast<int>((hs >> 14) % kMacroDim);
        for (int i = 0; i < 6; ++i) {
            const std::uint32_t h =
                giga::hash2(static_cast<std::uint32_t>(s), static_cast<std::uint32_t>(i) + 31u);
            // Расстояние РАСТЁТ с номером, богатство — тоже: так в каждой сцене
            // есть пара «близко и бедно» против «далеко и богато», и порог
            // отсечки проходится по-настоящему.
            const int reach = 3 + i * 11;
            const int x = static_cast<int>(giga::wrapi(cx + reach, kMacroDim));
            const int y = static_cast<int>(giga::wrapi(cy + static_cast<int>(h % 7u), kMacroDim));
            const int z = static_cast<int>(giga::wrapi(cz + static_cast<int>((h >> 3) % 7u), kMacroDim));
            // Богатство растёт БЫСТРЕЕ пути (14 против 11 на шаг) — иначе
            // ближняя комната побеждала бы всегда, и оракул снова мерил бы
            // ближний случай; шум ±11 перемешивает соседей, чтобы победитель
            // не был тождественно последним.
            const std::int16_t rich =
                static_cast<std::int16_t>(6 + i * 14 + static_cast<int>(h % 11u));
            declare_cube(fr, x, y, z, 1, kVerbSleep, rich);
        }
        DemandE3 d[kVerbCount] = {};
        d[kVerbSleep] = kDemandFull;
        const PlacePick fast = place_pick(fr, d, cx, cy, cz);
        const PlacePick slow = brute_pick(fr, d, cx, cy, cz);
        CHECK(fast.room == slow.room);
        CHECK(fast.score == slow.score);
        CHECK(fast.cost == slow.cost);
        // Контроль самой сцены: победитель обязан хоть иногда стоять ДАЛЬШЕ
        // одного ребра бина, иначе этот оракул снова мерил бы ближний случай.
        if (fast.cost > kRoomBinEdge) ++farWins;
    }
    CHECK(farWins >= kScenes / 2);
}

// --- 6. ИЗОТРОПИЯ -----------------------------------------------------------

static void test_place_isotropy() {
    using namespace place_suite;
    // Та же сцена, повёрнутая перестановкой осей, обязана дать ТОТ ЖЕ счёт.
    // Привилегированная ось в сумме (например, путь по z вдвое дешевле) красит
    // шесть проверок из шести.
    const int perms[6][3] = {{0, 1, 2}, {0, 2, 1}, {1, 0, 2},
                             {1, 2, 0}, {2, 0, 1}, {2, 1, 0}};
    const int body[3] = {40, 50, 60};
    const int room[3] = {46, 50, 60}; // шесть клеток по оси 0
    std::int32_t refScore = 0;
    for (int p = 0; p < 6; ++p) {
        FloorRooms fr;
        rooms_reset(fr);
        const int rx = room[perms[p][0]], ry = room[perms[p][1]], rz = room[perms[p][2]];
        const int cx = body[perms[p][0]], cy = body[perms[p][1]], cz = body[perms[p][2]];
        const RoomId id = declare_cube(fr, rx, ry, rz, 1, kVerbSleep, 30);
        CHECK(id != kNoRoom);
        DemandE3 d[kVerbCount] = {};
        d[kVerbSleep] = kDemandFull;
        const PlacePick pick = place_pick(fr, d, cx, cy, cz);
        CHECK(pick.room == id);
        if (p == 0) refScore = pick.score;
        CHECK(pick.score == refScore);
    }
    CHECK(refScore == 30 - 6);
}

// --- 7. ХОД: ТЕЛО ДЕЙСТВИТЕЛЬНО ИДЁТ ---------------------------------------

static void test_place_errand_walks() {
    using namespace place_suite;
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    nav::CoarseGraph coarse;
    nav::FineNav fine;

    // Спальня в восьми клетках по +x от тела.
    const int bx = 40, by = 40, bz = 40;
    const RoomId home = declare_cube(fr, bx + 8, by, bz, 1, kVerbSleep, 30);
    CHECK(home != kNoRoom);

    NpcId id = 0;
    const Entity e = make_body(reg, pool, bx, by, bz, id);
    set_needs_sleepy(pool, id);
    CHECK(ai_init(reg, kLayer) == 1);

    // ПУСТОЙ БЕЙК — NO-OP, НЕ UB (контракт wander_step/ai_patrol_step).
    const PlaceTick none = place_errand_step(reg, pool, fr, coarse, fine, kLayer, 0.0);
    CHECK(none.considered == 0);
    CHECK(none.walking == 0);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);

    // ОСТАТОК ЯКОРЯ: поток говорит «ты на якоре цели», последнюю ногу идёт сам
    // вызывающий — и обязан идти К ЦЕЛИ. Это та ветка, где направление
    // проверяемо: +x и ровно ноль по y.
    arm_nav(coarse, fine, nav::kFlowArrived);
    const PlaceTick walk = place_errand_step(reg, pool, fr, coarse, fine, kLayer, 0.0);
    CHECK(walk.considered == 1);
    CHECK(walk.picked == 1);
    CHECK(walk.walking == 1);
    CHECK(walk.arrived == 0);
    CHECK(walk.unreachable == 0);
    // Цена запроса — ЧИСЛО: суждения были, и их меньше, чем бинов тора.
    CHECK(walk.judged >= 1);
    CHECK(walk.bins >= 1);
    CHECK(walk.bins < kRoomBinCount);
    CHECK(reg.get<ErrandPlan>(e).room == home);
    CHECK(reg.get<ErrandPlan>(e).picks == 1);
    // ТОКЕН ЗАБРАН — значит wander_step и faction_feud_step это тело пропустят.
    CHECK(ai_owns_motion(reg, e));
    const Velocity& v = reg.get<Velocity>(e);
    CHECK(v.v.x > 0.0f);                       // идёт К комнате, а не от неё
    CHECK(std::fabs(v.v.x - kErrandSpeed) < 1e-4f); // шагом дела, не бегства
    CHECK(std::fabs(v.v.y) < 1e-6f);
    CHECK(v.v.y != kSentY);

    // ШАГ ПО ПОТОКУ: байт 1 = kNavDir[1] = +x, целимся в центр соседней клетки.
    // Вторая из двух ветвей хода, и у неё тот же ответ по направлению.
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    reg.get<AiBrain>(e).motion = static_cast<std::uint8_t>(MotionOwner::Wander);
    arm_nav(coarse, fine, 1);
    const PlaceTick step = place_errand_step(reg, pool, fr, coarse, fine, kLayer, 0.0);
    CHECK(step.walking == 1);
    CHECK(step.picked == 0); // цель уже выбрана — пере-выбора не было
    CHECK(std::fabs(reg.get<Velocity>(e).v.x - kErrandSpeed) < 1e-4f);

    // ПРЯМАЯ НА ЦЕЛЬ НЕ ИДЁТ ВСЛЕПУЮ. Эта ветка — 85% ответов маршрута на живом
    // этаже (замер 2026-10-01), и без проверки она выводила тело ЗА ПРОХОДИМОЕ
    // МНОЖЕСТВО, после чего нав его терял и цель умирала. Сцена: нав не знает
    // клетку, в которую тело собирается шагнуть (+x) — тело НЕ забирается
    // токеном и остаётся за вандером, а цель на месте.
    arm_nav(coarse, fine, nav::kFlowArrived);
    fine.nearest[macro_index(wrap_macro(bx + 1), wrap_macro(by), wrap_macro(bz))] =
        nav::kFlowNone;
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    reg.get<AiBrain>(e).motion = static_cast<std::uint8_t>(MotionOwner::Wander);
    const PlaceTick off = place_errand_step(reg, pool, fr, coarse, fine, kLayer, 0.0);
    CHECK(off.offnav == 1);
    CHECK(off.walking == 0);
    CHECK(reg.get<ErrandPlan>(e).room == home); // цель НЕ потеряна
    CHECK(reg.get<Velocity>(e).v.x == kSentX);  // и тело не тронуто
    CHECK(!ai_owns_motion(reg, e));             // токен не забран — ведёт вандер
    arm_nav(coarse, fine, nav::kFlowArrived);

    // БЕГСТВО СТАРШЕ ДЕЛА: тело под токеном `ai_step` не рассматривается вовсе.
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    reg.get<AiBrain>(e).motion = static_cast<std::uint8_t>(MotionOwner::Ai);
    const PlaceTick owned = place_errand_step(reg, pool, fr, coarse, fine, kLayer, 0.0);
    CHECK(owned.considered == 0);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);
    CHECK(reg.get<Velocity>(e).v.y == kSentY);

    // МАРШРУТА НЕТ — цель снимается со стаггером, тело отдаётся вандеру.
    reg.get<AiBrain>(e).motion = static_cast<std::uint8_t>(MotionOwner::Wander);
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    fine.nearest.assign(kMacroCells, nav::kFlowNone); // якоря нет ни у кого
    const PlaceTick lost = place_errand_step(reg, pool, fr, coarse, fine, kLayer, 0.0);
    CHECK(lost.unreachable == 1);
    CHECK(lost.walking == 0);
    CHECK(reg.get<ErrandPlan>(e).room == kNoRoom);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);
    CHECK(!ai_owns_motion(reg, e));

    // ПРИБЫЛ: тело, стоящее в своей цели, отпускается и больше не ведётся.
    arm_nav(coarse, fine, nav::kFlowArrived);
    reg.get<ErrandPlan>(e).room = home;
    reg.get<ErrandPlan>(e).nextPickAt = 0.0f;
    reg.get<Transform>(e).pos =
        vec3{cell_centre(bx + 8), cell_centre(by), cell_centre(bz)};
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    const PlaceTick arrive = place_errand_step(reg, pool, fr, coarse, fine, kLayer, 0.0);
    CHECK(arrive.arrived == 1);
    CHECK(arrive.walking == 0);
    CHECK(reg.get<ErrandPlan>(e).room == kNoRoom);
    CHECK(reg.get<Velocity>(e).v.x == kSentX); // отпущен, а не заморожен
    CHECK(!ai_owns_motion(reg, e));

    // СЫТОЕ ТЕЛО НЕ ИДЁТ НИКУДА — стоя в собственной спальне с полным барахлом
    // оно остаётся на месте, и это шкала, а не ветка «ничего не нашлось».
    set_needs_satisfied(pool, id);
    reg.get<ErrandPlan>(e).nextPickAt = 0.0f;
    const PlaceTick calm = place_errand_step(reg, pool, fr, coarse, fine, kLayer, 0.0);
    CHECK(calm.considered == 1);
    CHECK(calm.picked == 0);
    CHECK(calm.walking == 0);
    CHECK(calm.idle == 1);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);

    // КАДАНС ПО СОБЫТИЮ: до истечения стаггера выбор НЕ пересчитывается — это
    // половина гейта цены (0.07 мс × 1000 тел × 125 Гц = 8.75 ядра).
    set_needs_sleepy(pool, id);
    reg.get<Transform>(e).pos = vec3{cell_centre(bx), cell_centre(by), cell_centre(bz)};
    reg.get<ErrandPlan>(e).room = kNoRoom;
    reg.get<ErrandPlan>(e).nextPickAt = 1000.0f;
    const PlaceTick early = place_errand_step(reg, pool, fr, coarse, fine, kLayer, 0.0);
    CHECK(early.picked == 0);
    CHECK(early.judged == 0); // ни одной комнаты не суждено — запрос не звали
    CHECK(early.idle == 1);

    // РАЗВИЛКА МОЗГОВ (S13.7a): за носителя камеры решает человек, проход его
    // не обслуживает. Мутация «убрать decider_of» красит эту проверку — и это
    // ровно тот баг, которым `ai_patrol_step` перетирал ввод игрока.
    reg.get<ErrandPlan>(e).nextPickAt = 0.0f;
    reg.emplace<CameraTag>(e);
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    const PlaceTick human = place_errand_step(reg, pool, fr, coarse, fine, kLayer, 0.0);
    CHECK(human.considered == 0);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);
    reg.remove<CameraTag>(e);
}

static void test_place_all() {
    test_place_demand_from_needs();
    test_place_interest_is_a_dot_product();
    test_place_canon_s13_3_example();
    test_place_incumbent_is_always_a_candidate();
    test_place_bins_match_brute_force();
    test_place_bins_match_brute_force_sparse();
    test_place_isotropy();
    test_place_errand_walks();
}
