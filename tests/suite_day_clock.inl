// Day clock and diurnal rhythm unit tests — production.md §70, §140-143; room_zone.h §220-226.
//
// Validates:
// 1. In-game time stepping and day-count rollover (1440 s = 24 hours = 1 day).
// 2. Hour and minute calculation from timeOfDaySec.
// 3. Diurnal rhythm biases for Sleep, Work, Eat, and Social intents across shift schedule.
// 4. Inactive clock sentinel (< 0.0f) yielding 0.0f bias for all intents.

#include <cstdio>
#include "game/day_clock.h"

namespace giga::game {

static void test_day_clock_stepping_and_rollover() {
    DayClock clock{};
    CHECK(clock.timeOfDaySec == 480.0f); // Default 08:00
    CHECK(clock.dayCount == 0);
    CHECK(clock.hour_of_day() == 8);
    CHECK(clock.minute_of_hour() == 0);
    CHECK(clock.minute_of_day() == 480.0f);

    // Step 30 seconds (half hour in simulation time)
    clock.step(30.0f);
    CHECK(clock.timeOfDaySec == 510.0f); // 08:30
    CHECK(clock.hour_of_day() == 8);
    CHECK(clock.minute_of_hour() == 30);

    // Step forward 930 seconds (15.5 hours) -> 510 + 930 = 1440.0f (exact 24:00 rollover to Day 1, 00:00)
    clock.step(930.0f);
    CHECK(clock.dayCount == 1);
    CHECK(clock.timeOfDaySec == 0.0f);
    CHECK(clock.hour_of_day() == 0);
    CHECK(clock.minute_of_hour() == 0);

    // Step another full day (1440 seconds)
    clock.step(1440.0f);
    CHECK(clock.dayCount == 2);
    CHECK(clock.timeOfDaySec == 0.0f);

    // Zero or negative dt must not corrupt time
    clock.step(0.0f);
    clock.step(-10.0f);
    CHECK(clock.dayCount == 2);
    CHECK(clock.timeOfDaySec == 0.0f);
}

static void test_diurnal_rhythm_biases() {
    // 1. Inactive clock (< 0.0f) must return 0.0f for every intent
    for (std::uint8_t i = 0; i < kIntentCount; ++i) {
        CHECK(rhythm_bias(-1.0f, i) == 0.0f);
    }

    // 2. Sleep rhythm: high at night (22:00 = 1320 min, 03:00 = 180 min), low midday (12:00 = 720 min)
    CHECK(rhythm_bias(1350.0f, IntentSleep) == 25.0f); // 22:30
    CHECK(rhythm_bias(180.0f, IntentSleep) == 25.0f);  // 03:00
    CHECK(rhythm_bias(720.0f, IntentSleep) == -15.0f); // 12:00
    CHECK(rhythm_bias(1200.0f, IntentSleep) == 0.0f);  // 20:00 (neutral transition)

    // 3. Work rhythm: high during shift (09:00 = 540 min, 14:00 = 840 min), suppressed at night (01:00 = 60 min)
    CHECK(rhythm_bias(540.0f, IntentWork) == 20.0f);   // 09:00
    CHECK(rhythm_bias(840.0f, IntentWork) == 20.0f);   // 14:00
    CHECK(rhythm_bias(60.0f, IntentWork) == -20.0f);   // 01:00
    CHECK(rhythm_bias(1380.0f, IntentWork) == -20.0f); // 23:00

    // 4. Eat rhythm: peaks at lunch (12:30 = 750 min), dinner (19:30 = 1170 min), breakfast (07:30 = 450 min)
    CHECK(rhythm_bias(750.0f, IntentEat) == 22.0f);   // Lunch
    CHECK(rhythm_bias(1170.0f, IntentEat) == 22.0f);  // Dinner
    CHECK(rhythm_bias(450.0f, IntentEat) == 16.0f);   // Breakfast
    CHECK(rhythm_bias(180.0f, IntentEat) == 0.0f);    // Deep night (neutral)

    // 5. Social rhythm: high in evening (19:00 = 1140 min), suppressed during working shift (10:00 = 600 min)
    CHECK(rhythm_bias(1140.0f, IntentSocial) == 18.0f); // Evening
    CHECK(rhythm_bias(600.0f, IntentSocial) == -10.0f); // Work hours
    CHECK(rhythm_bias(180.0f, IntentSocial) == 0.0f);   // Night
}

static void test_day_clock_all() {
    test_day_clock_stepping_and_rollover();
    test_diurnal_rhythm_biases();
    std::printf("[test] suite_day_clock: DayClock stepping, rollovers, and diurnal rhythm biases verified\n");
}

} // namespace giga::game
