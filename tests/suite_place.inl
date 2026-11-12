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
//  6. ХОД: тело ЗАЯВЛЯЕТ цель рангом дела и едет К ЦЕЛИ — но скорость ему
//     пишет ЕДИНСТВЕННЫЙ писатель (`guide_step@game/guide.h`), и ни один
//     заявитель её не касается; тело, заявленное сильнее (бегство/наряд), не
//     рассматривается вовсе и уводится ЧУЖОЙ заявкой; пустой бейк — no-op;
//     носитель камеры не обслуживается ни заявителем, ни писателем.
//
//  7. ОДНА ЗАПИСЬ СКОРОСТИ НА ТИК, и это свойство, которого при токене нечем
//     было проверить: токен держал арбитраж ВМЕСТЕ С ПОРЯДКОМ ВЫЗОВОВ, а
//     замер прибором `--action vedenie` насчитал 45 двойных записей за 250
//     тиков ([game/guide.h], шапка). Гейт — в
//     `test_place_one_velocity_write_per_tick`: четыре прохода подряд, один
//     сентинель, и ответ числом.
//
// Включается из game_test.cpp, пользуется его CHECK.

#include "game/action.h"      // Acting/acting_busy — занятость деянием (S22)
#include "game/ai.h"          // ai_init/ai_patrol_step/kFleeSpeed — наряд и бегство
#include "game/embody.h"      // embody
#include "game/guide.h"       // Steer/SteerRank/guide_step — ЗАЯВКА и единственный писатель
#include "game/place.h"
#include "game/serve.h"       // ServeTick/kVerbAction — деяние нужды (S24)
#include "game/prop_table.h"  // kPropVerbs — «койка 17» из живых данных
#include "game/room.h"
#include "game/room_supply.h" // supply_add_prop — ОСНАЩЕНИЕ настоящей дверью
#include "game/wander.h"      // wander_init/wander_step — слабейший заявитель + MacroGrid

namespace place_suite {

using namespace giga;
using namespace giga::game;

constexpr LayerId kLayer = 0;

// Сентинель скорости: его не пишет НИКТО, кроме единственного писателя
// (`guide_step@game/guide.h`), поэтому «x всё ещё равен kSentX» есть ТОЧНЫЙ, а
// не статистический ответ на «кто-то писал это тело?». Приём взят у
// suite_utilai.inl.
//
// С 2026-11-09 У НЕГО ДВЕ РАБОТЫ, И ВТОРАЯ ВАЖНЕЕ. Заявители
// (`place_errand_step`, `ai_patrol_step`, `wander_step`) скорости не касаются
// вовсе, значит сентинель обязан стоять ПОСЛЕ них и уезжать ПОСЛЕ ведения.
// Утверждение о скорости, сделанное сразу после заявителя, проверяло бы
// значение ДО ВЫЗОВА писателя — ровно тот класс зелёной лжи, которым эта
// сюита уже болела («доказывала ПРАВИЛО, а не ПРОВОДКУ»).
constexpr float kSentX = 555.0f;
constexpr float kSentY = -555.0f;

// Заявка тела ЭТОГО тика, или nullptr. Прямой ответ на «кто владеет телом»,
// заменивший чтение токена `AiBrain::motion`: тик в заявке и есть срок её
// жизни, поэтому «заявки нет» и «заявка прошлого тика» здесь ОДИН ответ —
// ровно так их читает и единственный писатель.
inline const giga::game::Steer* live_claim(const Registry& reg, Entity e,
                                           std::uint64_t tick) {
    const Steer* s = reg.try_get<Steer>(e);
    return (s != nullptr && steer_claim_live(*s, tick)) ? s : nullptr;
}

// Сколько записей скорости сделал проход ведения ВСЕГО и сколько — по одному
// рангу. «Тело получило РОВНО ОДНУ запись» есть ЧИСЛО, а не проза, и считать
// его обязан прибор самого прохода: сложить `led` с `held` руками значило бы
// завести второй ответ на тот же вопрос.
inline std::uint32_t guide_writes(const GuideTick& g) {
    std::uint32_t n = 0;
    for (std::size_t r = 0; r < kSteerRankCount; ++r) n += g.byRank[r];
    return n;
}
inline std::uint32_t rank_writes(const GuideTick& g, SteerRank rank) {
    return g.byRank[static_cast<std::size_t>(rank)];
}

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

// ДЕШЁВАЯ АРЕНА НАВА ПО ЗОНАМ — наследница `arm_nav`, которая подделывала
// решётку (`fine.flow` + нулевой `CoarseGraph`). Общая фикстура
// `zone_fixture::arm_zones_plus_x` здесь не годится: её граница стоит на x==48,
// а сцена этого теста — тело на x==40 и спальня на x==48, то есть ОБЕ точки
// обязаны лежать в РАЗНЫХ зонах с границей МЕЖДУ ними. Поэтому граница
// параметризована, а всё остальное — тот же приём: два чтения, и подделать надо
// ровно их ([game/zone_nav.h]).
//
// `homeZone` — зона цели, и она обязана численно равняться `RoomId` комнаты:
// у нава по зонам цель ЕСТЬ зона, и проход индексирует таблицу номером комнаты
// (`plan.room`). Фикстура, нарушившая это, мерила бы чужую строку таблицы.
inline void arm_zones_errand(giga::game::ZoneNav& zn, int boundaryX,
                             RoomId bodyZone, RoomId homeZone,
                             std::uint8_t flowByte = 1) {
    using namespace giga;
    zn = game::ZoneNav{};
    const std::uint32_t zones = bodyZone > homeZone ? bodyZone : homeZone;
    zn.part.zones = zones;
    zn.part.at.assign(kMacroCells, bodyZone);
    zn.part.cells = static_cast<std::uint32_t>(kMacroCells);
    for (int cz = 0; cz < kMacroDim; ++cz)
        for (int cy = 0; cy < kMacroDim; ++cy)
            for (int cx = boundaryX; cx < kMacroDim; ++cx)
                zn.part.at[macro_index(cx, cy, cz)] = homeZone;
    // Граф: каждая зона знает другую одной соседкой (слот 0).
    zn.graph.zones = zones;
    zn.graph.offset.assign(zones + 1u, 0u);
    zn.graph.nbr.clear();
    for (std::uint32_t z = 0; z < zones; ++z) {
        zn.graph.offset[z] = z;
        zn.graph.nbr.push_back(static_cast<RoomId>(z == 0 ? 2 : 1));
    }
    zn.graph.offset[zones] = zones;
    // Таблица: расстояние 1 между любыми двумя, 0 до себя.
    zn.dist.zones = zones;
    zn.dist.d.assign(static_cast<std::size_t>(zones) * zones, 1);
    for (std::uint32_t z = 0; z < zones; ++z)
        zn.dist.d[static_cast<std::size_t>(z) * zones + z] = 0;
    zn.flow.planes = 1;
    zn.flow.dir.assign(kMacroCells, flowByte);
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
    // была неверна. Различает их только ЧАСТИЧНОЕ давление — ровно СЕРЕДИНА
    // рампы, где каждое давление даёт 0.5: максимум 500, сумма 1000.
    //
    // СЕРЕДИНА ВЫВОДИТСЯ ИЗ СТРОКИ, А НЕ НАЗНАЧЕНА (S13.5): рампа идёт от
    // терпения глагола до единицы, поэтому её середина есть (p + 1) / 2.
    // Прежде здесь стояло 62.5 — середина общего колена (0.35 + 0.90) / 2,
    // которого больше нет: у сортира своё терпение 200, и число следует за
    // ним без правки теста.
    const float toiletPatience =
        static_cast<float>(kVerbPatienceE3[kVerbToilet]) * 0.001f;
    Needs half{};
    half.food = kNeedMax;
    half.water = kNeedMax;
    half.sleep = kNeedMax;
    half.pee = kNeedMax * (toiletPatience + 1.0f) * 0.5f;
    half.poo = half.pee;
    half.seeded = 1;
    demand_from_needs(half, d);
    CHECK(d[kVerbToilet] == 500);
    // И та же середина ПО ДАННЫМ: давление ниже терпения спроса не создаёт
    // вовсе — «стерпит» значит стерпит.
    Needs tolerated{};
    tolerated.food = kNeedMax;
    tolerated.water = kNeedMax;
    tolerated.sleep = kNeedMax;
    tolerated.pee = kNeedMax * toiletPatience * 0.5f;
    tolerated.seeded = 1;
    demand_from_needs(tolerated, d);
    CHECK(d[kVerbToilet] == 0);

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

    // ЯРЛЫК ПАРЫ — ИЗ ТОЙ ЖЕ СУММЫ (решение владельца 2026-11-08: «интент =
    // ярлык выигравшей пары»). Побочным выходом, а не вторым проходом: иначе
    // счёт и ярлык могли бы разойтись, и это ровно болезнь двух решателей.
    VerbId top = static_cast<VerbId>(kVerbCount);
    d[kVerbSleep] = kDemandFull;
    d[kVerbEat] = kDemandFull;
    CHECK(place_interest(r, d, &top) == 42);
    CHECK(top == kVerbSleep);          // 30 против 12 — спать весомее
    // СПРОС РЕШАЕТ, А НЕ ПРЕДЛОЖЕНИЕ: та же комната, перевес спроса на еду.
    d[kVerbSleep] = 100;
    d[kVerbEat] = kDemandFull;
    CHECK(place_interest(r, d, &top) == 15); // (100*30 + 1000*12)/1000
    CHECK(top == kVerbEat);
    // Пустой спрос — ярлыка нет, а не «нулевой глагол» (0 это `спать`,
    // законная строка: сентинелом служит kVerbCount, не ноль).
    CHECK(place_interest(r, zero, &top) == 0);
    CHECK(top == static_cast<VerbId>(kVerbCount));
}

// --- 2b. ОДНО РЕШЕНИЕ: ПАРА «КОМНАТА × ГЛАГОЛ» ------------------------------
//
// Прежде решателей было ДВА и они не знали друг о друге: сумма выбирала
// комнату и ВЫБРАСЫВАЛА глагол, а `score_intents` в том же тике заново судил те
// же нужды, чтобы назвать то же самое другим словарём. Гейт на то, что ответ
// теперь ОДИН и обе его половины приходят вместе.

static void test_place_pick_names_its_verb() {
    using namespace place_suite;
    FloorRooms fr;
    rooms_reset(fr);
    // Две комнаты рядом: столовая (еда 40) и спальня (сон 40).
    std::int16_t kitchen[kVerbCount] = {};
    kitchen[kVerbEat] = 40;
    std::int16_t bedroom[kVerbCount] = {};
    bedroom[kVerbSleep] = 40;
    const RoomBox kb{20, 20, 20, 2, 2, 2};
    const RoomBox bb{26, 20, 20, 2, 2, 2};
    const RoomId kid = room_declare(fr, &kb, 1, 0, 0, kitchen);
    const RoomId bid = room_declare(fr, &bb, 1, 0, 0, bedroom);
    CHECK(kid != kNoRoom && bid != kNoRoom);

    // ГОЛОДНОЕ тело: выигрывает столовая, и ярлык — «есть».
    Needs hungry{};
    hungry.food = 0.0f;
    hungry.water = kNeedMax;
    hungry.sleep = kNeedMax;
    hungry.seeded = 1;
    DemandE3 d[kVerbCount];
    demand_from_needs(hungry, d);
    // Тело стоит В КОРИДОРЕ между ними: место под ногами ничего не предлагает,
    // поэтому обе комнаты — честные кандидаты (стоя В столовой, тело уже на
    // месте, и ответ «никуда не идти» был бы верным, но проверял бы не то).
    PlacePick pick = place_pick(fr, d, 23, 21, 21);
    CHECK(pick.room == kid);
    CHECK(pick.verb == kVerbEat);

    // СОННОЕ тело из той же точки: другая комната И другой ярлык, одной
    // суммой. Второго решателя для этого не понадобилось.
    Needs sleepy{};
    sleepy.food = kNeedMax;
    sleepy.water = kNeedMax;
    sleepy.sleep = 0.0f;
    sleepy.seeded = 1;
    demand_from_needs(sleepy, d);
    pick = place_pick(fr, d, 23, 21, 21);
    CHECK(pick.room == bid);
    CHECK(pick.verb == kVerbSleep);

    // Сытое и выспавшееся тело никуда не идёт — и ярлыка у него нет.
    Needs full{};
    full.food = kNeedMax;
    full.water = kNeedMax;
    full.sleep = kNeedMax;
    full.seeded = 1;
    demand_from_needs(full, d);
    pick = place_pick(fr, d, 23, 21, 21);
    CHECK(pick.room == kNoRoom);
    CHECK(pick.verb == static_cast<VerbId>(kVerbCount));
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
//
// ТИКИ ЗДЕСЬ — ЛЕСТНИЦА, И ЭТО НЕ КОСМЕТИКА. Заявка ведения живёт РОВНО ОДИН
// ТИК ([game/guide.h]), поэтому две сцены на одном тике судили бы одну заявку:
// вторая читала бы то, что оставила первая. Прежде роль «сброса между сценами»
// играла строка `brain.motion = MotionOwner::Wander` перед каждой из них — её
// предмет умер вместе с токеном, и сбрасывать больше нечего: срок жизни заявки
// и есть номер тика. Поэтому каждая сцена ниже носит СВОЙ тик и называет его.
//
// И КАЖДОЕ УТВЕРЖДЕНИЕ О СКОРОСТИ ЗВЁТ `guide_step`. Заявитель скорости не
// пишет, значит проверка «v.x == ...» сразу после него читала бы значение ДО
// вызова писателя и осталась бы зелёной при любой мутации проводки.

static void test_place_errand_walks() {
    using namespace place_suite;
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    ZoneNav zones;

    // Спальня в восьми клетках по +x от тела.
    const int bx = 40, by = 40, bz = 40;
    const RoomId home = declare_cube(fr, bx + 8, by, bz, 1, kVerbSleep, 30);
    CHECK(home != kNoRoom);
    // Зона тела — ВТОРАЯ, зона цели совпадает с номером комнаты (см. довод у
    // фикстуры). Граница между телом (x=40) и спальней (x=48).
    const RoomId bodyZone = static_cast<RoomId>(2);
    const int boundary = 44;

    NpcId id = 0;
    const Entity e = make_body(reg, pool, bx, by, bz, id);
    set_needs_sleepy(pool, id);
    CHECK(ai_init(reg, kLayer) == 1);

    // НЕПОСТРОЕННЫЙ НАВ — NO-OP, НЕ UB (контракт wander_step/ai_patrol_step).
    // До 2026-10-12 этой сценой был «пустой решёточный бейк»; теперь — пустые
    // зоны, и проверка та же: тело не тронуто, счётчики нули.
    //
    // «НЕ ТРОНУТО» ТЕПЕРЬ СУДИТСЯ ДО КОНЦА: заявки нет — значит и писателю
    // писать нечем, и сентинель обязан пережить ОБА прохода. Проверка только
    // после заявителя была бы тавтологией (он скорости не касается никогда).
    const PlaceTick none =
        place_errand_step(reg, pool, fr, kLayer, 0.0, /*tick=*/0, nullptr, &zones);
    CHECK(none.considered == 0);
    CHECK(none.walking == 0);
    CHECK(live_claim(reg, e, 0) == nullptr);
    const GuideTick noneGuide = guide_step(reg, zones, kLayer, /*tick=*/0, nullptr, nullptr);
    CHECK(guide_writes(noneGuide) == 0);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);
    CHECK(reg.get<Velocity>(e).v.y == kSentY);

    // ШАГ В ПЛОСКОСТИ ХОДЬБЫ — ЕДИНСТВЕННАЯ ветка хода после сноса решётки.
    // Байт 1 = kNavDir[1] = +x, целимся в центр соседней клетки. Прежде здесь
    // было ДВЕ ветки с одним ответом («остаток якоря» слепой прямой и шаг по
    // потоку); остатка больше нет, и направление проверяемо ровно так же: +x и
    // ровно ноль по y.
    constexpr std::uint64_t kWalkTick = 1;
    arm_zones_errand(zones, boundary, bodyZone, home);
    const PlaceTick walk =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kWalkTick, nullptr, &zones);
    CHECK(walk.considered == 1);
    CHECK(walk.picked == 1);
    CHECK(walk.walking == 1);
    CHECK(walk.arrived == 0);
    CHECK(walk.unreachable == 0);
    CHECK(walk.offnav == 0);
    // Прибор прогресса: расстояние в ЗОНАХ посчитано по ведомому телу.
    CHECK(walk.zoneDistBodies == 1);
    CHECK(walk.zoneDistSum == 1);
    // Цена запроса — ЧИСЛО: суждения были, и их меньше, чем бинов тора.
    CHECK(walk.judged >= 1);
    CHECK(walk.bins >= 1);
    CHECK(walk.bins < kRoomBinCount);
    CHECK(reg.get<ErrandPlan>(e).room == home);
    CHECK(reg.get<ErrandPlan>(e).picks == 1);
    // ВМЕСТО ЗАБОРА ТОКЕНА — ЗАЯВКА, И ОНА СУДИТСЯ ЦЕЛИКОМ. Ход к месту есть
    // ЦЕЛЬ-ЗОНА (`plan.room`) рангом дела и шагом ходьбы; мутация «дело
    // заявляет `target_hold`» дала бы прибывшее-на-месте тело посреди коридора,
    // а «дело заявляет рангом `Walk`» отдала бы его прогулке.
    const Steer* claim = live_claim(reg, e, kWalkTick);
    CHECK(claim != nullptr);
    CHECK(claim->rank == SteerRank::Errand);
    CHECK(claim->target.kind == TargetKind::Zone);
    CHECK(claim->target.zone == home);
    CHECK(std::fabs(claim->target.speed - kErrandSpeed) < 1e-4f);
    // ЗАЯВИТЕЛЬ СКОРОСТИ НЕ КАСАЕТСЯ — сентинель ЖИВ. Это наследник закона
    // «один писатель на тело за тик», и прежде его держал токен ПЛЮС порядок
    // вызовов в кадре; мутация «вернуть `steer_write` в `place.cpp`» красит
    // ровно эти две строки, и только они.
    CHECK(reg.get<Velocity>(e).v.x == kSentX);
    CHECK(reg.get<Velocity>(e).v.y == kSentY);
    // «ТОКЕН ЗАБРАН» ЧИТАЕТСЯ РАНГОМ: прогулка и вражда это тело пропустят
    // (они спрашивают про свой ранг), а САМО ДЕЛО свою же заявку чужой НЕ
    // ЧИТАЕТ — ровно то третье значение токена (`Errand`), которым ловилась
    // мутация «деяние рвёт себя само». Сравнение строгое, и это обе полярности
    // одной строки `steer_claimed_by_stronger`.
    CHECK(steer_claimed_by_stronger(reg, e, SteerRank::Walk, kWalkTick));
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Errand, kWalkTick));
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Flee, kWalkTick));
    // ...и живёт заявка ОДИН ТИК: на следующем её уже нет, то есть тело
    // достанется слабейшему заявителю, а не поедет прошлым решением.
    CHECK(!steer_claim_live(*claim, kWalkTick + 1));

    // СКОРОСТЬ ПОЯВЛЯЕТСЯ ТОЛЬКО ПОСЛЕ ЕДИНСТВЕННОГО ПИСАТЕЛЯ, И РОВНО ОДНА.
    const GuideTick walkGuide = guide_step(reg, zones, kLayer, kWalkTick, nullptr, nullptr);
    CHECK(walkGuide.led == 1);
    CHECK(walkGuide.held == 0);
    CHECK(rank_writes(walkGuide, SteerRank::Errand) == 1);
    CHECK(guide_writes(walkGuide) == 1);
    // Самопроверка прохода: заявка этого тика, байты понятны, цель РАЗРЕШИЛАСЬ
    // (заявитель проверял исполнимость той же дверью и на тех же входах).
    CHECK(walkGuide.stale == 0);
    CHECK(walkGuide.bogus == 0);
    CHECK(walkGuide.unresolved == 0);
    CHECK(walkGuide.foreign == 0);
    const Velocity& v = reg.get<Velocity>(e);
    CHECK(v.v.x > 0.0f);                       // идёт К комнате, а не от неё
    CHECK(std::fabs(v.v.x - kErrandSpeed) < 1e-4f); // шагом дела, не бегства
    CHECK(std::fabs(v.v.y) < 1e-6f);
    CHECK(v.v.y != kSentY);

    // ВТОРОЙ ТИК ПО УЖЕ ВЫБРАННОЙ ЦЕЛИ — пере-выбора нет, ведёт тем же шагом.
    constexpr std::uint64_t kStepTick = 2;
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    const PlaceTick step =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kStepTick, nullptr, &zones);
    CHECK(step.walking == 1);
    CHECK(step.picked == 0); // цель уже выбрана — пере-выбора не было
    CHECK(reg.get<Velocity>(e).v.x == kSentX); // и снова: заявитель не пишет
    const GuideTick stepGuide = guide_step(reg, zones, kLayer, kStepTick, nullptr, nullptr);
    CHECK(rank_writes(stepGuide, SteerRank::Errand) == 1);
    CHECK(guide_writes(stepGuide) == 1);
    CHECK(stepGuide.stale == 0); // заявка ЭТОГО тика, а не прошлого
    CHECK(std::fabs(reg.get<Velocity>(e).v.x - kErrandSpeed) < 1e-4f);

    // СТУПЕНЬКА: дверь зон отдала шаг ВДОЛЬ гравитации. Тангенциального пеленга
    // у него ровно ноль, вести им нечем — тело отдаётся вандеру, а цель
    // ОСТАЁТСЯ. Слепой прямой на цель здесь нет СОЗНАТЕЛЬНО: ровно она была
    // остатком якоря у решётки и стоила §88 нуля прибытий.
    // Эта ветка решёточными тестами НЕ покрывалась вовсе — её не существовало.
    //
    // «ТОКЕН НЕ ЗАБРАН» ТЕПЕРЬ ЗВУЧИТ ТАК: ЗАЯВКА НЕ ПОДАНА. Это не перевод
    // слов, а другое утверждение, и оно сильнее: подать заявку и провалить её
    // значило бы ОТНЯТЬ тело у прогулки, которая его ещё провела бы (тело
    // замерло бы, а замирающий NPC есть дефект S13.2).
    constexpr std::uint64_t kStepUpTick = 3;
    arm_zones_errand(zones, boundary, bodyZone, home, /*flowByte=*/5); // +z
    // Чтобы дверь зон ОТДАЛА вертикальный шаг, он обязан быть ВЫХОДОМ из зоны:
    // `zone_walk_dir` щупает вперёд до kSubDim и отказывает, если шаг вдоль
    // гравитации никуда не выводит (иначе он вёл бы тело в уступ). Поэтому
    // клетка над телом принадлежит зоне ЦЕЛИ — это и есть ступенька.
    zones.part.at[macro_index(wrap_macro(bx), wrap_macro(by), wrap_macro(bz + 1))] =
        home;
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    const PlaceTick stepup =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kStepUpTick, nullptr, &zones);
    CHECK(stepup.walking == 0);
    CHECK(stepup.idle == 1);
    CHECK(stepup.unreachable == 0); // это не отказ маршрута, а отказ ВЕСТИ
    CHECK(reg.get<ErrandPlan>(e).room == home); // цель НЕ потеряна
    CHECK(live_claim(reg, e, kStepUpTick) == nullptr);           // заявки нет
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Walk, kStepUpTick)); // → прогулке
    // ...И ПИСАТЕЛЬ ПРОШЛУЮ ЗАЯВКУ НЕ ИСПОЛНЯЕТ. На теле лежит заявка тика
    // `kStepTick` (дело её подало и больше не обновляло), и проход обязан
    // прочитать её как УСТАРЕВШУЮ: тело стоит на прошлой скорости, то есть
    // ровно там, где его оставил прошлый кадр. Мутация «`steer_claim_live` не
    // сравнивает тик» красит эту тройку строк — отказ вести молча превратился
    // бы в езду по снятому решению.
    const GuideTick stepupGuide =
        guide_step(reg, zones, kLayer, kStepUpTick, nullptr, nullptr);
    CHECK(guide_writes(stepupGuide) == 0);
    CHECK(stepupGuide.stale == 1);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);  // и тело не тронуто
    CHECK(reg.get<Velocity>(e).v.y == kSentY);

    // ТЕЛО ВНЕ РАЗБИВКИ. Клетка центра тела бывает дыркой в разбивке (замер:
    // 26 тел на тик) — вести его некуда, отдаём вандеру, цель на месте. Это
    // наследник сцены «нав не знает клетку, в которую тело шагает»: прежде её
    // ловила проверка `nearest_node` у слепой прямой, теперь — сама разбивка.
    constexpr std::uint64_t kOffnavTick = 4;
    arm_zones_errand(zones, boundary, bodyZone, home);
    // Дырка обязана быть и у шести соседей: `zone_of_body` опирается на соседа
    // (клетка центра тела бывает дыркой при живой зоне вокруг), и фикстура,
    // занулившая одну клетку, мерила бы ровно этот фолбэк, а не отказ.
    zones.part.at[macro_index(wrap_macro(bx), wrap_macro(by), wrap_macro(bz))] =
        kNoRoom;
    for (int d = 0; d < 6; ++d)
        zones.part.at[macro_index(wrap_macro(bx + nav::kNavDir[d][0]),
                                  wrap_macro(by + nav::kNavDir[d][1]),
                                  wrap_macro(bz + nav::kNavDir[d][2]))] = kNoRoom;
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    const PlaceTick off =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kOffnavTick, nullptr, &zones);
    CHECK(off.offnav == 1);
    CHECK(off.walking == 0);
    CHECK(reg.get<ErrandPlan>(e).room == home); // цель НЕ потеряна
    CHECK(live_claim(reg, e, kOffnavTick) == nullptr); // заявки нет — ведёт вандер
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Walk, kOffnavTick));
    const GuideTick offGuide = guide_step(reg, zones, kLayer, kOffnavTick, nullptr, nullptr);
    CHECK(guide_writes(offGuide) == 0);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);  // и тело не тронуто
    CHECK(reg.get<Velocity>(e).v.y == kSentY);

    // БЕГСТВО СТАРШЕ ДЕЛА: тело, заявленное СИЛЬНЫМ рангом, проход не
    // рассматривает вовсе — и ведёт его ЧУЖАЯ заявка, а не дело. Прежде это
    // выражалось токеном `MotionOwner::Ai`, в котором бегство и наряд были
    // ОДНИМ значением; ранг их разводит, а набор «кто старше дела» остался тем
    // же (`Patrol` и `Flee`).
    //
    // Заявка подаётся В ТОЧНО ТОЙ ФОРМЕ, в которой её подаёт `ai_step`
    // ([game/ai.cpp]: `SteerRank::Flee` + `target_dir`). Сам `ai_step` здесь не
    // зовут, и это не поблажка: ему нужно поле опасности с градиентом, а судится
    // не он, а СТАРШИНСТВО — его собственный гейт живёт в suite_utilai.
    constexpr std::uint64_t kFleeTick = 5;
    arm_zones_errand(zones, boundary, bodyZone, home);
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    CHECK(steer_claim(reg, e, kFleeTick, SteerRank::Flee,
                      target_dir(vec3{-1.0f, 0.0f, 0.0f}, kFleeSpeed)));
    const PlaceTick owned =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kFleeTick, nullptr, &zones);
    CHECK(owned.considered == 0);
    CHECK(reg.get<ErrandPlan>(e).room == home); // цель дела не потеряна
    CHECK(reg.get<Velocity>(e).v.x == kSentX);  // заявитель не пишет и здесь
    // ЗАЯВКА ОСТАЛАСЬ ЧУЖОЙ: дело её не перебило (слабая поверх сильной не
    // ложится), и писатель уводит тело ПО НЕЙ — шагом бегства и в ту сторону,
    // которую назвало бегство. Мутация «`steer_claim` кладёт заявку всегда»
    // красит ранг и знак скорости сразу.
    const Steer* fleeClaim = live_claim(reg, e, kFleeTick);
    CHECK(fleeClaim != nullptr);
    CHECK(fleeClaim->rank == SteerRank::Flee);
    CHECK(fleeClaim->target.kind == TargetKind::Dir);
    const GuideTick fleeGuide = guide_step(reg, zones, kLayer, kFleeTick, nullptr, nullptr);
    CHECK(rank_writes(fleeGuide, SteerRank::Flee) == 1);
    CHECK(rank_writes(fleeGuide, SteerRank::Errand) == 0);
    CHECK(guide_writes(fleeGuide) == 1);
    CHECK(std::fabs(reg.get<Velocity>(e).v.x + kFleeSpeed) < 1e-4f); // УВЕЛИ
    CHECK(std::fabs(reg.get<Velocity>(e).v.y) < 1e-6f);

    // МАРШРУТА НЕТ — цель снимается со стаггером, тело отдаётся вандеру.
    // Сцена переведена с «ни у кого нет якоря» на «таблица зон говорит
    // НЕДОСТИЖИМО», то есть на тот же отказ у того же места решения.
    constexpr std::uint64_t kLostTick = 6;
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    zones.flow.dir.assign(kMacroCells, kZoneFlowNone);
    const PlaceTick lost =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kLostTick, nullptr, &zones);
    CHECK(lost.unreachable == 1);
    CHECK(lost.walking == 0);
    CHECK(reg.get<ErrandPlan>(e).room == kNoRoom);
    CHECK(live_claim(reg, e, kLostTick) == nullptr);
    const GuideTick lostGuide = guide_step(reg, zones, kLayer, kLostTick, nullptr, nullptr);
    CHECK(guide_writes(lostGuide) == 0);
    // НЕДОСТИЖИМОЕ НЕ ЗАЯВЛЕНО — а не «заявлено и провалено»: счётчик
    // `unresolved` обязан быть НУЛЁМ по построению, он и есть прибор на
    // заявителя, который заявляет то, чего исполнить нельзя.
    CHECK(lostGuide.unresolved == 0);
    CHECK(lostGuide.stale == 1); // прошлая заявка БЕГСТВА тоже не исполняется
    CHECK(reg.get<Velocity>(e).v.x == kSentX);
    CHECK(reg.get<Velocity>(e).v.y == kSentY);

    // ПРИБЫЛ — И ТУТ ЖЕ ДЕЛАЕТ ДЕЛО (S24). ЗАКОН СМЕНИЛСЯ 2026-11-08: прежде
    // прибывшее тело отпускалось тем же тиком («деяние придёт расходом запаса,
    // не стоянием»), и это и была разомкнутая половина цикла нужд. Теперь
    // цель снимается, а тело падает в деяние над предложением места, то есть
    // ДЕРЖИТСЯ: заявлено СТОЯНИЕ, и скорость в плоскости ходьбы обнулена.
    //
    // Сентинель здесь работает В ДВА ТАКТА, и это тот самый порядок, который
    // прежде был не нужен: ПОСЛЕ заявителя он обязан СТОЯТЬ (держать — не его
    // работа), а ПОСЛЕ писателя — ИСЧЕЗНУТЬ по обеим тангенциальным осям,
    // потому что держать значит ПИСАТЬ НОЛЬ, а не «не трогать» (иначе тело
    // доспало бы на ходу, унося прошлую скорость).
    constexpr std::uint64_t kArriveTick = 7;
    arm_zones_errand(zones, boundary, bodyZone, home);
    reg.get<ErrandPlan>(e).room = home;
    reg.get<ErrandPlan>(e).nextPickAt = 0.0f;
    reg.get<Transform>(e).pos =
        vec3{cell_centre(bx + 8), cell_centre(by), cell_centre(bz)};
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    ServeTick arriveServe{};
    const PlaceTick arrive =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kArriveTick, nullptr, &zones,
                          &arriveServe);
    CHECK(arrive.arrived == 1);
    CHECK(arrive.walking == 0);
    CHECK(arrive.serving == 1);
    CHECK(reg.get<ErrandPlan>(e).room == kNoRoom);
    // ДЕРЖАТЬ — ЭТО ЦЕЛЬ `Hold` РАНГОМ ДЕЛА. Прежде это был забор своего токена
    // плюс обнуление скорости своей рукой — то есть ВТОРОЙ писатель.
    const Steer* holdClaim = live_claim(reg, e, kArriveTick);
    CHECK(holdClaim != nullptr);
    CHECK(holdClaim->rank == SteerRank::Errand);
    CHECK(holdClaim->target.kind == TargetKind::Hold);
    CHECK(reg.get<Velocity>(e).v.x == kSentX); // сам проход скорости не трогал
    CHECK(reg.get<Velocity>(e).v.y == kSentY);
    const GuideTick holdGuide = guide_step(reg, zones, kLayer, kArriveTick, nullptr, nullptr);
    CHECK(holdGuide.held == 1);
    CHECK(holdGuide.led == 0);
    CHECK(rank_writes(holdGuide, SteerRank::Errand) == 1);
    CHECK(guide_writes(holdGuide) == 1);
    CHECK(holdGuide.stale == 0 && holdGuide.bogus == 0);
    CHECK(reg.get<Velocity>(e).v.x == 0.0f); // держат, а не отпускают
    CHECK(reg.get<Velocity>(e).v.y == 0.0f);
    // ...и это именно СОН, а не «что-нибудь»: строка действия берётся из
    // обратного индекса таблицы, а не из головы теста.
    CHECK(arriveServe.began == 1);
    CHECK(arriveServe.byVerb[kVerbSleep] == 1);
    CHECK(acting_what(reg.get<Acting>(e), ActSlot::Body, kArriveTick) ==
          kVerbAction[kVerbSleep]);
    CHECK(kActionDurMs[kVerbAction[kVerbSleep]] > 0u); // посылка стенда

    // СВОЁ ДЕЯНИЕ СЕБЯ НЕ РВЁТ — и это та мутация, которая нашла третьего
    // владельца токена (`MotionOwner::Errand`). Теперь её держит СТРОГОЕ
    // сравнение рангов, и судится оно ДВАЖДЫ, примитивом и проводкой.
    //
    // (1) ПРИМИТИВОМ, на живой заявке ЭТОГО ЖЕ тика: на теле стоит заявка
    // ранга дела, которую подал сам проход, и вопрос «меня перебили?» обязан
    // ответить НЕТ. Мутация `s->rank >= mine` в `steer_claimed_by_stronger`
    // красит эту строку.
    CHECK(!steer_claimed_by_stronger(reg, e, SteerRank::Errand, kArriveTick));
    // (2) ПРОВОДКОЙ: повторный проход ТЕМ ЖЕ ТИКОМ видит свою же заявку —
    // именно так выглядел бы любой второй читатель заявки дела в кадре, — и
    // окно обязано остаться открытым, а не быть сорванным «угрозой».
    ServeTick sameTickServe{};
    const PlaceTick sameTick =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kArriveTick, nullptr, &zones,
                          &sameTickServe);
    CHECK(sameTickServe.broke == 0);
    CHECK(sameTickServe.holding == 1);
    CHECK(sameTickServe.began == 0);
    CHECK(sameTick.serving == 1);
    CHECK(acting_busy(reg.get<Acting>(e), ActSlot::Body, kArriveTick));

    // ...И НИ НА КАКОМ ДАЛЬНЕЙШЕМ ТИКЕ ТОЖЕ: следующий тик, заявка прошлого
    // снята сроком, окно держат заново.
    constexpr std::uint64_t kSecondTick = 8;
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    ServeTick secondServe{};
    const PlaceTick second =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kSecondTick, nullptr, &zones,
                          &secondServe);
    CHECK(second.serving == 1);
    CHECK(secondServe.holding == 1);
    CHECK(secondServe.broke == 0);
    CHECK(secondServe.began == 0); // окно монотонно: второго начала нет
    CHECK(acting_busy(reg.get<Acting>(e), ActSlot::Body, kSecondTick));
    // Держат КАЖДЫЙ тик, а не один раз на входе: заявка стояния подаётся
    // заново, и ноль пишется заново.
    const Steer* holdAgain = live_claim(reg, e, kSecondTick);
    CHECK(holdAgain != nullptr);
    CHECK(holdAgain->target.kind == TargetKind::Hold);
    const GuideTick secondGuide =
        guide_step(reg, zones, kLayer, kSecondTick, nullptr, nullptr);
    CHECK(secondGuide.held == 1);
    CHECK(rank_writes(secondGuide, SteerRank::Errand) == 1);
    CHECK(reg.get<Velocity>(e).v.x == 0.0f);
    CHECK(reg.get<Velocity>(e).v.y == 0.0f);

    // УГРОЗА СТАРШЕ ДЕЛА: тело заявило бегство — окно рвётся, и рвётся ДО
    // контактного кадра, значит эффекта не было. Наблюдаемое следствие, которым
    // заменено чтение токена: тело УВОДЯТ, и уводят по чужому пеленгу.
    constexpr std::uint64_t kThreatTick = 9;
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    CHECK(steer_claim(reg, e, kThreatTick, SteerRank::Flee,
                      target_dir(vec3{0.0f, 1.0f, 0.0f}, kFleeSpeed)));
    ServeTick threatServe{};
    place_errand_step(reg, pool, fr, kLayer, 0.0, kThreatTick, nullptr, &zones,
                      &threatServe);
    CHECK(threatServe.broke == 1);
    CHECK(!acting_busy(reg.get<Acting>(e), ActSlot::Body, kThreatTick));
    CHECK(pool.needs(id).sleep == 0.0f); // сорванное деяние НЕ кормит
    const GuideTick threatGuide =
        guide_step(reg, zones, kLayer, kThreatTick, nullptr, nullptr);
    CHECK(rank_writes(threatGuide, SteerRank::Flee) == 1);
    CHECK(rank_writes(threatGuide, SteerRank::Errand) == 0);
    CHECK(guide_writes(threatGuide) == 1);
    CHECK(std::fabs(reg.get<Velocity>(e).v.y - kFleeSpeed) < 1e-4f);

    // УГРОЗА, ПРИШЕДШАЯ НА ПОСЛЕДНЕМ ТИКЕ ОКНА, ТОЖЕ НЕ КОРМИТ — и этот гейт
    // поставлен на НАЙДЕННЫЙ АУДИТОМ дефект, а не на подтверждённое поведение.
    // Контактный кадр деяния нужды стоит РОВНО в конце окна, а `break_action`
    // по построению отказывает на окне, которое уже кончилось, — поэтому
    // угроза в этот тик оставляла бит `applied` нулём, и эффект падал ПОЗЖЕ, в
    // той комнате, где тело окажется после бегства. Прежняя проверка на этом
    // месте (`threatServe.applied == 0` сразу после обрыва) была ТАВТОЛОГИЕЙ:
    // в ветке угрозы эффект не падает ни в одной реализации.
    reg.get<ErrandPlan>(e).room = kNoRoom;
    reg.get<ErrandPlan>(e).nextPickAt = 0.0f;
    ServeTick lateBegin{};
    place_errand_step(reg, pool, fr, kLayer, 0.0, /*tick=*/10, nullptr, &zones,
                      &lateBegin);
    CHECK(lateBegin.began == 1);
    const std::uint16_t dur =
        act_slot(reg.get<Acting>(e), ActSlot::Body).durTicks;
    CHECK(dur > 1);
    // Тик конца окна: эффект ещё НЕ снят (опроса не было), и в этот самый тик
    // тело забирает угроза. Сброса «владельца» после сцены больше нет и быть не
    // может: заявка бегства кончается вместе со своим тиком, и следующий вызов
    // читает её как снятую.
    const std::uint64_t kLateThreatTick = 10u + static_cast<std::uint64_t>(dur);
    CHECK(steer_claim(reg, e, kLateThreatTick, SteerRank::Flee,
                      target_dir(vec3{0.0f, 1.0f, 0.0f}, kFleeSpeed)));
    ServeTick lateThreat{};
    place_errand_step(reg, pool, fr, kLayer, 0.0, kLateThreatTick, nullptr,
                      &zones, &lateThreat);
    CHECK(lateThreat.broke == 1);
    // ...и дальше его не кормит НИКОГДА: сколько ни опрашивай, бар не поехал.
    ServeTick afterThreat{};
    place_errand_step(reg, pool, fr, kLayer, 0.0,
                      /*tick=*/10u + static_cast<std::uint64_t>(dur) * 2u, nullptr,
                      &zones, &afterThreat);
    CHECK(afterThreat.applied == 0);
    CHECK(pool.needs(id).sleep == 0.0f);
    // ...зато НОВОЕ деяние начинается тем же тиком, и это не побочный эффект, а
    // сам цикл: угроза ушла, тело по-прежнему не спало, место по-прежнему
    // предлагает — значит делать.
    CHECK(afterThreat.began == 1);

    // СЫТОЕ ТЕЛО НЕ ИДЁТ НИКУДА И НИЧЕГО НЕ ДЕЛАЕТ — стоя в собственной
    // спальне с полным барахлом оно остаётся на месте, и это шкала, а не
    // ветка «ничего не нашлось». Вторая полярность деяния: предложение есть,
    // спроса нет — значит `nothing`, а не `began`.
    // ЧАСЫ ИДУТ ТОЛЬКО ВПЕРЁД, и сцена мерит НАЧАЛО, а не удержание: открытое
    // окно прошлой сцены снимается явно. Поймано на себе — тик из прошлого
    // `act_elapsed` читает как нуль ([game/action.h]), поэтому «сытое тело»
    // мерило бы удержание чужого деяния.
    reg.remove<Acting>(e);
    set_needs_satisfied(pool, id);
    reg.get<ErrandPlan>(e).nextPickAt = 0.0f;
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    const std::uint64_t kCalmTick = 10u + static_cast<std::uint64_t>(dur) * 3u;
    ServeTick calmServe{};
    const PlaceTick calm =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kCalmTick,
                          nullptr, &zones, &calmServe);
    CHECK(calm.considered == 1);
    CHECK(calm.picked == 0);
    CHECK(calm.walking == 0);
    CHECK(calm.serving == 0);
    CHECK(calm.idle == 1);
    CHECK(calmServe.began == 0);
    CHECK(calmServe.nothing == 1);
    // НИ ХОДА, НИ СТОЯНИЯ: тело без решения не заявляет ВООБЩЕ НИЧЕГО и
    // достаётся прогулке. Владеемого нуля здесь нет СОЗНАТЕЛЬНО — он был бы
    // остановкой на ровном месте, то есть замиранием (S13.2), и мутация
    // «на `idle` заявлять `target_hold`» красит обе строки ниже.
    CHECK(live_claim(reg, e, kCalmTick) == nullptr);
    const GuideTick calmGuide = guide_step(reg, zones, kLayer, kCalmTick, nullptr, nullptr);
    CHECK(guide_writes(calmGuide) == 0);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);
    CHECK(reg.get<Velocity>(e).v.y == kSentY);

    // КАДАНС ПО СОБЫТИЮ: до истечения стаггера выбор НЕ пересчитывается — это
    // половина гейта цены (0.07 мс × 1000 тел × 125 Гц = 8.75 ядра).
    // Тело при этом стоит в КОРИДОРЕ (x = bx, спальня в bx+8), поэтому и
    // деяние ему недоступно — по МЕСТУ, и прибор называет это вслух.
    set_needs_sleepy(pool, id);
    reg.get<Transform>(e).pos = vec3{cell_centre(bx), cell_centre(by), cell_centre(bz)};
    reg.get<ErrandPlan>(e).room = kNoRoom;
    reg.get<ErrandPlan>(e).nextPickAt = 1000.0f;
    const std::uint64_t kEarlyTick = 10u + static_cast<std::uint64_t>(dur) * 4u;
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    ServeTick earlyServe{};
    const PlaceTick early =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kEarlyTick,
                          nullptr, &zones, &earlyServe);
    CHECK(early.picked == 0);
    CHECK(early.judged == 0); // ни одной комнаты не суждено — запрос не звали
    CHECK(early.idle == 1);
    CHECK(earlyServe.began == 0);
    CHECK(earlyServe.corridor == 1);
    // Тело без цели и без деяния — снова ничьё: ни заявки, ни записи.
    CHECK(live_claim(reg, e, kEarlyTick) == nullptr);
    const GuideTick earlyGuide = guide_step(reg, zones, kLayer, kEarlyTick, nullptr, nullptr);
    CHECK(guide_writes(earlyGuide) == 0);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);

    // РАЗВИЛКА МОЗГОВ (S13.7a) — И ТЕПЕРЬ ЕЁ ДЕРЖАТ ДВОЕ: заявитель и писатель.
    // За носителя камеры решает человек, поэтому проход его не обслуживает.
    // Мутация «убрать decider_of из `place_errand_step`» красит эту проверку —
    // и это ровно тот баг, которым `ai_patrol_step` перетирал ввод игрока.
    const std::uint64_t kHumanTick = 10u + static_cast<std::uint64_t>(dur) * 5u;
    reg.get<ErrandPlan>(e).nextPickAt = 0.0f;
    reg.emplace<CameraTag>(e);
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    const PlaceTick human =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kHumanTick,
                          nullptr, &zones);
    CHECK(human.considered == 0);
    CHECK(live_claim(reg, e, kHumanTick) == nullptr);
    CHECK(reg.get<Velocity>(e).v.x == kSentX);

    // ...А ВТОРОЙ РАЗ ТОТ ЖЕ ВОПРОС ЗАДАЁТ ЕДИНСТВЕННЫЙ ПИСАТЕЛЬ, и спрашивает
    // он не зря: вселение отдаёт `CameraTag` ЖИВОМУ жителю ПОСЕРЕДИНЕ кадра, и
    // заявка, поданная до вселения, перетёрла бы ввод человека в том же тике —
    // дословно дефект Б6.2, которым наряд стоил владельцу управления. Заявку
    // кладём руками: это ровно та, которую подал бы заявитель тиком раньше, и
    // другого способа получить её на теле человека нет (все заявители его
    // пропускают). Мутация «убрать `decider_of` из `guide_step`» красит три
    // строки ниже; обратная полярность той же развилки — все сцены выше, где
    // тот же проход тело ЖИТЕЛЯ ведёт.
    CHECK(steer_claim(reg, e, kHumanTick, SteerRank::Errand,
                      target_zone(home, kErrandSpeed)));
    const GuideTick humanGuide = guide_step(reg, zones, kLayer, kHumanTick, nullptr, nullptr);
    CHECK(humanGuide.foreign == 1);
    CHECK(guide_writes(humanGuide) == 0);
    CHECK(reg.get<Velocity>(e).v.x == kSentX); // ввод человека не тронут
    CHECK(reg.get<Velocity>(e).v.y == kSentY);
    reg.remove<CameraTag>(e);
}

// --- 8. ОДНА ЗАПИСЬ СКОРОСТИ НА ТИК -----------------------------------------
//
// СВОЙСТВО, КОТОРОГО ПРИ ТОКЕНЕ НЕЧЕМ БЫЛО ПРОВЕРИТЬ, И ЭТО НЕ ОЦЕНКА, А
// ЗАМЕР. Прибор `--action vedenie` насчитал на этаже 6 СОРОК ПЯТЬ двойных
// записей горизонтальной скорости за 250 тиков ([game/guide.h], шапка): токен
// читали четыре прохода из шести в четырёх разных формулировках, пятый
// (`investigate_step`) не читал вовсе, и держался закон «писатель один» не
// токеном, а тем, что два звена цепочки почти всегда молчат. Сюита этого не
// ловила, потому что проверить его было нечем: каждый проход писал скорость
// САМ, и «кто написал последним» выражалось только значением.
//
// Теперь это ЧИСЛО. Четыре прохода в порядке кадра ([app/main.cpp]: наряд →
// дело → прогулка → ведение), один сентинель, и два утверждения:
//   (а) ДО ведения не написал НИКТО — сентинель цел после трёх заявителей;
//   (б) ПОСЛЕ ведения запись РОВНО ОДНА, и она принадлежит делу (Σ по рангам).
//
// МУТАЦИИ, КОТОРЫЕ ЭТО КРАСИТ (каждая — одна строка прода):
//   * вернуть `steer_write`/`steer_stop` в любой заявитель → (а) красное;
//   * снять у `wander_step` вопрос о ранге → слабая заявка легла бы поверх
//     сильной, и тело ВСТАЛО БЫ (`held`) вместо хода: byRank[Walk] == 1;
//   * `steer_claim` без проверки ранга → то же самое, с другой стороны;
//   * `guide_step` без проверки штампа тика → в фазе Б тело поехало бы
//     заявкой прошлого тика на тиках, где заявителя не было.
//
// ВТОРАЯ ПОЛЯРНОСТЬ ОБЯЗАТЕЛЬНА, иначе «прогулка не написала» значило бы
// «прогулки здесь нет вовсе»: фаза Б снимает у тела дело и показывает, что В
// ТОЙ ЖЕ АРЕНЕ прогулка его ведёт — ровно раз за период стаггера.
static void test_place_one_velocity_write_per_tick() {
    using namespace place_suite;
    Registry reg;
    NpcPool pool;
    pool.init();
    FloorRooms fr;
    rooms_reset(fr);
    ZoneNav zones;
    // Прогулке нужен мир: четыре чтения клеток «стена рядом?» для пяти пород
    // мобов из 69. Житель до них не доходит, но параметр обязателен, а
    // `MacroGrid` стоит ~138 МиБ одной аллокацией в конструкторе — поэтому он
    // ОДИН на весь гейт, тем же приёмом, которым живёт `suite_behaviours`.
    MacroGrid grid;

    const int bx = 40, by = 40, bz = 40;
    const RoomId home = declare_cube(fr, bx + 8, by, bz, 1, kVerbSleep, 30);
    CHECK(home != kNoRoom);
    const RoomId bodyZone = static_cast<RoomId>(2);
    const int boundary = 44;

    NpcId id = 0;
    const Entity e = make_body(reg, pool, bx, by, bz, id);
    set_needs_sleepy(pool, id);
    CHECK(ai_init(reg, kLayer) == 1);
    // ТЕЛО ОБЯЗАНО БЫТЬ ХОДЯЧИМ, иначе прогулка его не видит вовсе и гейт мерил
    // бы отсутствие компоненты, а не уступку по рангу ([game/wander.h]:
    // `WanderTarget` и есть ходячесть).
    CHECK(wander_init(reg, kLayer) == 1);
    CHECK(reg.all_of<WanderTarget>(e));
    arm_zones_errand(zones, boundary, bodyZone, home);

    // --- ФАЗА А: ТЕЛО ПОД ДЕЛОМ --------------------------------------------
    constexpr std::uint64_t kTick = 1;
    reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
    const PatrolTick pt = ai_patrol_step(reg, zones, kLayer, nullptr, kTick);
    const PlaceTick et =
        place_errand_step(reg, pool, fr, kLayer, 0.0, kTick, nullptr, &zones);
    const WanderTick wt =
        wander_step(reg, grid, pool, zones, kLayer, kTick, nullptr);
    // Наряд тело не берёт: интент не его (`kIntentNone` после `ai_init`), и
    // старшинство наряда над делом судит suite_utilai — здесь он в цепочке
    // ровно для того, чтобы доказать, что СКОРОСТИ ОН НЕ ПИШЕТ.
    CHECK(pt.walking == 0);
    CHECK(pt.considered == 0);
    CHECK(et.walking == 1);
    // Прогулка уступила ПО РАНГУ, а не по стаггеру: вопрос о ранге стоит ДО
    // стаггера, поэтому тело не попало даже в знаменатель.
    CHECK(wt.considered == 0);
    CHECK(wt.walking == 0);
    // (а) НИ ОДИН ЗАЯВИТЕЛЬ НЕ НАПИСАЛ НИ БАЙТА.
    CHECK(reg.get<Velocity>(e).v.x == kSentX);
    CHECK(reg.get<Velocity>(e).v.y == kSentY);

    // (б) ПИСАТЕЛЬ ПИШЕТ РОВНО РАЗ, И ПИШЕТ ЗАЯВКУ ДЕЛА.
    const GuideTick g = guide_step(reg, zones, kLayer, kTick, nullptr, nullptr);
    CHECK(guide_writes(g) == 1);
    CHECK(rank_writes(g, SteerRank::Errand) == 1);
    CHECK(rank_writes(g, SteerRank::Walk) == 0);
    CHECK(rank_writes(g, SteerRank::Patrol) == 0);
    CHECK(rank_writes(g, SteerRank::Flee) == 0);
    CHECK(g.led == 1);
    CHECK(g.held == 0); // ВЕДЁТ, а не держит: слабая заявка не легла поверх
    CHECK(g.stale == 0 && g.bogus == 0 && g.unresolved == 0 && g.foreign == 0);
    CHECK(std::fabs(reg.get<Velocity>(e).v.x - kErrandSpeed) < 1e-4f);
    CHECK(std::fabs(reg.get<Velocity>(e).v.y) < 1e-6f);

    // --- ФАЗА Б: ТО ЖЕ ТЕЛО БЕЗ ДЕЛА ---------------------------------------
    //
    // Сытое тело в коридоре: сумма не даёт цели, место не даёт деяния — дело
    // заявки не подаёт, и тело достаётся слабейшему заявителю. Прогулка
    // посещает его РОВНО РАЗ в период стаггера (слот — функция тождества), и
    // на остальных тиках заявки нет ни у кого: тело обязано стоять на прошлой
    // скорости, а не ехать прошлым решением.
    set_needs_satisfied(pool, id);
    reg.get<ErrandPlan>(e).room = kNoRoom;
    reg.get<ErrandPlan>(e).nextPickAt = 0.0f;
    std::uint32_t walkWrites = 0;
    std::uint32_t errandWrites = 0;
    std::uint32_t quietTicks = 0;
    for (std::uint64_t k = 0; k < kWanderPeriod; ++k) {
        const std::uint64_t tk = 100u + k;
        reg.get<Velocity>(e).v = vec3{kSentX, kSentY, 0.0f};
        place_errand_step(reg, pool, fr, kLayer, 0.0, tk, nullptr, &zones);
        wander_step(reg, grid, pool, zones, kLayer, tk, nullptr);
        // Заявители по-прежнему не пишут — ни один, ни на одном тике.
        CHECK(reg.get<Velocity>(e).v.x == kSentX);
        CHECK(reg.get<Velocity>(e).v.y == kSentY);
        const GuideTick gk = guide_step(reg, zones, kLayer, tk, nullptr, nullptr);
        CHECK(guide_writes(gk) <= 1); // одна запись на тик, КАЖДЫЙ тик
        walkWrites += rank_writes(gk, SteerRank::Walk);
        errandWrites += rank_writes(gk, SteerRank::Errand);
        if (guide_writes(gk) == 0) {
            ++quietTicks;
            // Тела без заявки проход не касается: прошлая скорость, ноль
            // записей — тот же исход, что при пропуске по стаггеру.
            CHECK(reg.get<Velocity>(e).v.x == kSentX);
            CHECK(reg.get<Velocity>(e).v.y == kSentY);
        } else {
            CHECK(reg.get<Velocity>(e).v.x != kSentX ||
                  reg.get<Velocity>(e).v.y != kSentY);
        }
    }
    CHECK(walkWrites == 1);   // прогулка ведёт это тело — ровно раз за период
    CHECK(errandWrites == 0); // а дело сытому телу заявки не подаёт
    CHECK(quietTicks == kWanderPeriod - 1);
}

static void test_place_all() {
    test_place_demand_from_needs();
    test_place_interest_is_a_dot_product();
    test_place_pick_names_its_verb();
    test_place_canon_s13_3_example();
    test_place_incumbent_is_always_a_candidate();
    test_place_bins_match_brute_force();
    test_place_bins_match_brute_force_sparse();
    test_place_isotropy();
    test_place_errand_walks();
    test_place_one_velocity_write_per_tick();
}
