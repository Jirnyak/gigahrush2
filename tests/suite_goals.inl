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
#include "game/needs.h"
#include "game/room.h"

namespace goals_test {

// Спрос руками: тесты задают контекст точно, не через клок.
void demand_zero(float d[kVerbCount]) {
    for (std::size_t v = 0; v < kVerbCount; ++v) d[v] = 0.0f;
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
    const GoalPick p = goals_pick_room(d, fr, at);
    CHECK(p.room == 1);
    CHECK(p.topVerb == kVerbEat);
}

void point_underfoot_always() {
    FloorRooms fr;
    rooms_reset(fr); // ноль комнат
    float d[kVerbCount];
    demand_zero(d);
    d[kVerbSleep] = 1.0f;
    const GoalPick p = goals_pick_room(
        d, fr, vec3{10.0f, 10.0f, 10.0f});
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
    const GoalPick p = goals_pick_room(d, fr, at);
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
    const GoalPick p = goals_pick_room(d, fr, at);
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
    const GoalPick p = goals_pick_room(d, fr, at);
    CHECK(p.room == 1);
}

} // namespace goals_test

static void test_goals_all() {
    goals_test::hunger_leads();
    goals_test::point_underfoot_always();
    goals_test::tie_breaks_by_torus_distance();
    goals_test::far_interest_dies_at_derived_radius();
    goals_test::canon_scale_example();
}
