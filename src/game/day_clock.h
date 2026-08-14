// Day clock and diurnal rhythm — the one truth of in-game time of day.
//
// ===========================================================================
// TIME SCALE SPECIFICATION (production.md §70, §140-143; room_zone.h §220-226)
// ===========================================================================
// * 1 in-game hour == 60 simulation seconds (kGameHourSec = 60.0f).
// * 1 in-game day (24 hours) == 1440 simulation seconds (kDayLengthSec = 1440.0f).
// * minuteOfDay in [0.0f, 1440.0f) maps 1:1 to elapsed simulation seconds within the day.
// * < 0.0f sentinel indicates no active clock / rhythm bias disabled.
#pragma once

#include <cmath>
#include <cstdint>

#include "game/ai.h" // IntentId

namespace giga::game {

inline constexpr float kGameHourSec = 60.0f;
inline constexpr float kDayLengthSec = 24.0f * kGameHourSec; // 1440.0f

struct DayClock {
    // Default starts at 08:00 (8 * 60 = 480 min) — morning work shift start.
    float timeOfDaySec = 480.0f;
    std::uint32_t dayCount = 0;

    void step(float dt) {
        if (dt <= 0.0f) return;
        timeOfDaySec += dt;
        while (timeOfDaySec >= kDayLengthSec) {
            timeOfDaySec -= kDayLengthSec;
            ++dayCount;
        }
    }

    float minute_of_day() const {
        return timeOfDaySec;
    }

    std::uint8_t hour_of_day() const {
        return static_cast<std::uint8_t>(timeOfDaySec / kGameHourSec);
    }

    std::uint8_t minute_of_hour() const {
        return static_cast<std::uint8_t>(std::fmod(timeOfDaySec, kGameHourSec));
    }
};

// Calculates diurnal intent rhythm bias (+/- score adjustment) based on in-game time of day.
// Pure function: deterministic, stateless, depends only on (minuteOfDay, intent).
float rhythm_bias(float minuteOfDay, std::uint8_t intent);

} // namespace giga::game
