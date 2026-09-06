// Честный выбор цели (CANON S13.2-S13.3; agent-goals инкремент A) — гейты:
//
//   1. НУЖДА ВЕДЁТ: голодный выбирает комнату, где объявлено «есть», а не
//      спальню на том же расстоянии (гейт 2 плана в зачаточной форме).
//   2. СПИСОК НЕ БЫВАЕТ ПУСТ: этаж без комнат → точка под ногами, не
//      «ничего не нашлось» (S13.9: фолбэк запрещён по построению).
//   3. НИЧЬЮ РЕШАЕТ ФИЗИКА: две одинаковые кухни — ближняя выигрывает, и
//      «ближняя» считается ТОРОМ (через шов короче, чем напрямую; S1).
//   4. РАДИУС ВЫВОДИТСЯ: дальняя комната, чей интерес съеден путём,
//      проигрывает точке (S13.2: R = интерес / стоимость клетки).
//   5. ШКАЛА S13.3 дословно: «объявлено 30 > одинокая койка 17» — приоритет
//      своей комнаты выведен суммой слагаемых, не назначен веткой.
//
// Included from game_test.cpp like every suite; uses its CHECK.

#include "game/goals.h"
#include "game/item_table.h"  // kItemVerbs — supply растягивает радиус (B-4)
#include "game/needs.h"
#include "game/prop_table.h"  // kPropVerbs — то же пропом
#include "game/room.h"
#include "game/room_supply.h"

namespace goals_test {

// Спрос руками: тесты задают контекст точно, не через клок.
void demand_zero(float d[kVerbCount]) {
    for (std::size_t v = 0; v < kVerbCount; ++v) d[v] = 0.0f;
}

// Обёртка со свежим скретчем: тестам не нужен общий скретч, а свежий
// заодно проверяет холодный путь (аллокация штампов на первом вызове).
GoalPick pick(const float d[kVerbCount], const FloorRooms& fr,
              const vec3& at) {
    GoalsScratch scratch;
    return goals_pick_room(d, fr, at, scratch);
}

void declare_room(FloorRooms& fr, std::uint8_t x, std::uint8_t y,
                  std::uint8_t z, VerbId verb, std::int16_t offer) {
    std::int16_t declared[kVerbCount] = {};
    declared[verb] = offer;
    const RoomBox box{x, y, z, 2, 2, 1};
    CHECK(room_declare(fr, &box, 1, 0, 0, declared) != kNoRoom);
}

void hunger_leads() {
    FloorRooms fr;
    rooms_reset(fr);
    // Кухня и спальня на РАВНОМ расстоянии от агента в (64,64,10).
    declare_room(fr, 70, 64, 10, kVerbEat, 20);   // RoomId 1
    declare_room(fr, 58, 64, 10, kVerbSleep, 20); // RoomId 2
    float d[kVerbCount];
    demand_zero(d);
    d[kVerbEat] = 1.0f;
    d[kVerbSleep] = 0.2f;
    const vec3 at{64.0f * kCellSize, 64.0f * kCellSize, 10.0f * kCellSize};
    const GoalPick p = pick(d, fr, at);
    CHECK(p.room == 1);
    CHECK(p.topVerb == kVerbEat);
}

void point_underfoot_always() {
    FloorRooms fr;
    rooms_reset(fr); // ноль комнат
    float d[kVerbCount];
    demand_zero(d);
    d[kVerbSleep] = 1.0f;
    const GoalPick p = pick(d, fr, vec3{10.0f, 10.0f, 10.0f});
    CHECK(p.room == kNoRoom);        // точка под ногами
    CHECK(p.score > 0.0f);           // и она не пустышка
    CHECK(p.distCells == 0.0f);      // путь ноль — она всегда здесь
}

void tie_breaks_by_torus_distance() {
    FloorRooms fr;
    rooms_reset(fr);
    // Кухня A у шва (x=124): от агента на x=2 через ЗАВОРОТ 4 клетки.
    // Кухня B на x=20: напрямую 18 клеток. Евклид без тора выбрал бы B.
    declare_room(fr, 124, 10, 10, kVerbEat, 20); // RoomId 1
    declare_room(fr, 20, 10, 10, kVerbEat, 20);  // RoomId 2
    float d[kVerbCount];
    demand_zero(d);
    d[kVerbEat] = 1.0f;
    const vec3 at{2.0f * kCellSize, 11.0f * kCellSize, 10.0f * kCellSize};
    const GoalPick p = pick(d, fr, at);
    CHECK(p.room == 1);
    CHECK(p.distCells < 5.0f);
}

void far_interest_dies_at_derived_radius() {
    FloorRooms fr;
    rooms_reset(fr);
    // Интерес 20 очков глохнет за 20 клеток (kGoalCostPerCell = 1, пример
    // S13.3); комната в ~60 клетках даёт глубокий минус и проигрывает
    // точке под ногами (спать на полу лучше похода через полмира).
    declare_room(fr, 124, 64, 10, kVerbEat, 20);
    float d[kVerbCount];
    demand_zero(d);
    d[kVerbEat] = 1.0f;
    d[kVerbSleep] = 1.0f;
    const vec3 at{64.0f * kCellSize, 64.0f * kCellSize, 10.0f * kCellSize};
    const GoalPick p = pick(d, fr, at);
    CHECK(p.room == kNoRoom);
    CHECK(p.score > 0.0f);
}

void canon_scale_example() {
    FloorRooms fr;
    rooms_reset(fr);
    // Пример S13.3 в лоб: «своя жилая (объявлено 30) 30 − путь 8 = 22»
    // против «одинокая койка 17 − путь 1 = 16» — выигрывает комната,
    // потому что объявленное суммируется, а не потому что есть ветка.
    declare_room(fr, 64, 72, 10, kVerbSleep, 30); // жилая, 8 клеток
    declare_room(fr, 64, 65, 10, kVerbSleep, 17); // «койка», 1 клетка
    float d[kVerbCount];
    demand_zero(d);
    d[kVerbSleep] = 1.0f;
    const vec3 at{65.0f * kCellSize, 64.0f * kCellSize, 10.0f * kCellSize};
    const GoalPick p = pick(d, fr, at);
    CHECK(p.room == 1);
}

// ГЕЙТ B-1 (оракул): радиус-отбор бинами обязан быть ТОЖДЕСТВЕН полному
// перебору — бины меняют порядок посещения и режут заведомых неудачников,
// но победитель, его счёт и дистанция совпадают бит в бит. Полный перебор
// здесь — независимая копия суммы S13.2 (та же математика, без бинов).
GoalPick brute_pick(const float demand[kVerbCount], const FloorRooms& fr,
                    const vec3& at) {
    const float px = at.x / kCellSize, py = at.y / kCellSize,
                pz = at.z / kCellSize;
    GoalPick best;
    best.score = kFloorPointOffer * (demand[kVerbSleep] +
                                     demand[kVerbShelter] +
                                     demand[kVerbWander]);
    const auto axisDist = [](float p, std::uint8_t o, std::uint8_t s) {
        const float dim = static_cast<float>(kMacroDim);
        float dp = p - static_cast<float>(o);
        dp -= dim * std::floor(dp / dim);
        if (dp < static_cast<float>(s)) return 0.0f;
        const float past = dp - static_cast<float>(s);
        const float back = dim - dp;
        return past < back ? past : back;
    };
    for (std::size_t i = 0; i < fr.list.size(); ++i) {
        const Room& r = fr.list[i];
        float offerSum = 0.0f;
        for (std::size_t v = 0; v < kVerbCount; ++v)
            offerSum += demand[v] * (static_cast<float>(r.declared[v]) +
                                     static_cast<float>(r.supply[v]));
        float d2min = -1.0f;
        for (std::uint32_t b = 0; b < r.boxCount; ++b) {
            const RoomBox& bx = fr.boxes[r.boxFirst + b];
            const float dx = axisDist(px, bx.x, bx.sx);
            const float dy = axisDist(py, bx.y, bx.sy);
            const float dz = axisDist(pz, bx.z, bx.sz);
            const float d2 = dx * dx + dy * dy + dz * dz;
            if (d2min < 0.0f || d2 < d2min) d2min = d2;
        }
        const float dist = d2min > 0.0f ? std::sqrt(d2min) : 0.0f;
        const float score = offerSum - dist * kGoalCostPerCell;
        const RoomId id = static_cast<RoomId>(i + 1);
        if (score > best.score ||
            (score == best.score &&
             (dist < best.distCells ||
              (dist == best.distCells &&
               (best.room == kNoRoom || id < best.room))))) {
            best.room = id;
            best.score = score;
            best.distCells = dist;
        }
    }
    return best;
}

void bins_match_brute_force() {
    FloorRooms fr;
    rooms_reset(fr);
    // Детерминированный LCG-разброс комнат по всему тору, включая швы;
    // глаголы и очки крутятся, чтобы победители были разными.
    std::uint32_t rng = 0x9e3779b9u;
    const auto next = [&rng] {
        rng = rng * 1664525u + 1013904223u;
        return rng >> 8;
    };
    for (int i = 0; i < 400; ++i) {
        std::int16_t declared[kVerbCount] = {};
        declared[next() % kVerbCount] = static_cast<std::int16_t>(
            5 + next() % 40);
        const RoomBox box{static_cast<std::uint8_t>(next() % kMacroDim),
                          static_cast<std::uint8_t>(next() % kMacroDim),
                          static_cast<std::uint8_t>(next() % kMacroDim),
                          static_cast<std::uint8_t>(1 + next() % 6),
                          static_cast<std::uint8_t>(1 + next() % 6),
                          static_cast<std::uint8_t>(1 + next() % 3)};
        CHECK(room_declare(fr, &box, 1, 0, 0, declared) != kNoRoom);
    }
    GoalsScratch scratch; // ОДИН на все прогоны — эпоха дедупа под нагрузкой
    for (int trial = 0; trial < 64; ++trial) {
        float d[kVerbCount];
        demand_zero(d);
        // 1-3 ненулевых спроса 0..1
        for (std::uint32_t k = 0; k < 1 + next() % 3; ++k)
            d[next() % kVerbCount] =
                static_cast<float>(next() % 1000) / 1000.0f;
        const vec3 at{static_cast<float>(next() % (kMacroDim * 2)),
                      static_cast<float>(next() % (kMacroDim * 2)),
                      static_cast<float>(next() % (kMacroDim * 2))};
        const GoalPick a = goals_pick_room(d, fr, at, scratch);
        const GoalPick b = brute_pick(d, fr, at);
        CHECK(a.room == b.room);
        CHECK(a.score == b.score);
        CHECK(a.distCells == b.distCells);
        // Дедуп штампом: комната в нескольких бинах судится ОДИН раз —
        // иначе scored врёт замеру гейта B и перф держится на удаче.
        CHECK(a.scored <= static_cast<std::uint32_t>(fr.list.size()));
    }
}

// ГЕЙТ B-2 (отсечка): дальняя комната, которую радиус выключил, не должна
// быть даже ПОСУЖДЕНА — иначе бины декоративны и перф-гейт «< 0.1 мс»
// держится на удаче. Богатая комната прямо под агентом останавливает обход
// на первых шеллах; scored считает суждения.
void radius_prunes_judging() {
    FloorRooms fr;
    rooms_reset(fr);
    declare_room(fr, 64, 64, 10, kVerbEat, 40); // под ногами
    for (int i = 0; i < 200; ++i)               // дальняя стена комнат
        declare_room(fr, static_cast<std::uint8_t>((i * 5) % kMacroDim),
                     static_cast<std::uint8_t>((i * 7) % kMacroDim), 100,
                     kVerbEat, 20);
    float d[kVerbCount];
    demand_zero(d);
    d[kVerbEat] = 1.0f;
    const vec3 at{64.5f * kCellSize, 64.5f * kCellSize, 10.0f * kCellSize};
    const GoalPick p = pick(d, fr, at);
    CHECK(p.room == 1);
    // Комната под ногами даёт 40; потолок этажа 40 ⇒ обход обязан встать,
    // не дойдя до стены на z=100 (90 клеток пути): суждений — единицы.
    CHECK(p.scored < 32);
}

// ГЕЙТ B-3 (кромка радиуса): правильный победитель сидит в ПОСЛЕДНИХ
// шеллах перед честной остановкой — обход обязан дойти, прежде чем встать.
// Ловит занижение границы break, которое разреженный оракул B-1 может
// проскочить. Числа: приманка 20 под ногами, победитель 80 на x=120 —
// дистанция 55.5, счёт 24.5 > 20; его бин-шелл (55.5+64.5)/8 → 7, а
// честный break — только когда 80 − s·ребро < 20, то есть после s=8.
// Break, заниженный хоть на пару шеллов, встаёт до седьмого и возвращает
// приманку.
void winner_at_radius_edge() {
    FloorRooms fr;
    rooms_reset(fr);
    declare_room(fr, 64, 64, 10, kVerbEat, 20);  // под ногами, лидер-приманка
    declare_room(fr, 120, 64, 10, kVerbEat, 80); // 55.5 клеток: 80−55.5>20
    float d[kVerbCount];
    demand_zero(d);
    d[kVerbEat] = 1.0f;
    const vec3 at{64.5f * kCellSize, 64.5f * kCellSize, 10.0f * kCellSize};
    const GoalPick p = pick(d, fr, at);
    CHECK(p.room == 2);
    CHECK(p.score > 20.0f);
}

// ГЕЙТ B-4 (supply растягивает радиус): предложение из ЗАПАСА/ОСНАЩЕНИЯ
// обязано доехать до потолков бинов — иначе комната, разбогатевшая после
// объявления (хлеб лёг, плиту поставили), не досягаема радиус-отсечкой,
// хоть скор её и выиграл бы. Оба живых хука supply — предметный и
// проповый. Предмет/проп ищутся по данным (первый с глаголом «есть»),
// а не магическим id: таблица — истина.
void supply_extends_reach_items() {
    std::uint16_t eatItem = 0;
    for (std::uint16_t it = 1; it <= kItemCount; ++it)
        if (kItemVerbs[it - 1][kVerbEat] > 0) { eatItem = it; break; }
    CHECK(eatItem != 0); // в items.csv обязан жить хоть один съедобный
    if (eatItem == 0) return;
    const std::int16_t verbVal = kItemVerbs[eatItem - 1][kVerbEat];

    FloorRooms fr;
    rooms_reset(fr);
    declare_room(fr, 64, 64, 10, kVerbEat, 20);  // приманка под ногами
    declare_room(fr, 110, 64, 10, kVerbEat, 1);  // бедная даль (~44 клетки)
    // Кладём еды, пока предложение дальней не перекроет путь с запасом.
    const int count = (80 + verbVal - 1) / verbVal;
    supply_add_item(fr, 2, eatItem, count);
    float d[kVerbCount];
    demand_zero(d);
    d[kVerbEat] = 1.0f;
    const vec3 at{64.5f * kCellSize, 64.5f * kCellSize, 10.0f * kCellSize};
    const GoalPick p = pick(d, fr, at);
    CHECK(p.room == 2); // богатая даль бьёт приманку — потолок бина вырос
}

void supply_extends_reach_props() {
    PropId eatProp = static_cast<PropId>(kPropCount); // «не найден»
    std::int16_t verbVal = 0;
    for (std::size_t pi = 0; pi < kPropCount; ++pi)
        if (kPropVerbs[pi][kVerbEat] > 0) {
            eatProp = static_cast<PropId>(pi);
            verbVal = kPropVerbs[pi][kVerbEat];
            break;
        }
    if (verbVal == 0) return; // в props.csv нет кормящего пропа — не гейт
    FloorRooms fr;
    rooms_reset(fr);
    declare_room(fr, 64, 64, 10, kVerbEat, 20);
    declare_room(fr, 110, 64, 10, kVerbEat, 1);
    for (int n = 0; n * verbVal < 80; ++n) supply_add_prop(fr, 2, eatProp, +1);
    float d[kVerbCount];
    demand_zero(d);
    d[kVerbEat] = 1.0f;
    const vec3 at{64.5f * kCellSize, 64.5f * kCellSize, 10.0f * kCellSize};
    const GoalPick p = pick(d, fr, at);
    CHECK(p.room == 2);
}

} // namespace goals_test

static void test_goals_all() {
    goals_test::hunger_leads();
    goals_test::point_underfoot_always();
    goals_test::tie_breaks_by_torus_distance();
    goals_test::far_interest_dies_at_derived_radius();
    goals_test::canon_scale_example();
    goals_test::bins_match_brute_force();
    goals_test::radius_prunes_judging();
    goals_test::winner_at_radius_edge();
    goals_test::supply_extends_reach_items();
    goals_test::supply_extends_reach_props();
}
