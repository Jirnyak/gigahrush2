#include "game/day_clock.h"

#include <cmath>

namespace giga::game {

float rhythm_bias(float minuteOfDay, std::uint8_t intent) {
    if (minuteOfDay < 0.0f) {
        return 0.0f; // Clock is inactive or unexposed
    }

    // Normalize minute into [0, 1440)
    float m = std::fmod(minuteOfDay, kDayLengthSec);
    if (m < 0.0f) m += kDayLengthSec;

    switch (intent) {
    case IntentSleep: {
        // High at night (22:00 to 06:00, i.e. 1320..1440 and 0..360 min)
        if (m >= 1320.0f || m < 360.0f) {
            return 25.0f;
        }
        // Suppressed during active daytime hours (09:00 to 18:00, i.e. 540..1080 min)
        if (m >= 540.0f && m < 1080.0f) {
            return -15.0f;
        }
        return 0.0f;
    }

    case IntentWork: {
        // Shift hours (08:00 to 17:00, i.e. 480..1020 min)
        if (m >= 480.0f && m < 1020.0f) {
            return 20.0f;
        }
        // Night rest period (22:00 to 06:00)
        if (m >= 1320.0f || m < 360.0f) {
            return -20.0f;
        }
        return 0.0f;
    }

    case IntentEat: {
        // Lunch peak (12:00 to 13:30, i.e. 720..810 min)
        if (m >= 720.0f && m < 810.0f) {
            return 22.0f;
        }
        // Dinner peak (19:00 to 20:30, i.e. 1140..1230 min)
        if (m >= 1140.0f && m < 1230.0f) {
            return 22.0f;
        }
        // Breakfast peak (07:00 to 08:00, i.e. 420..480 min)
        if (m >= 420.0f && m < 480.0f) {
            return 16.0f;
        }
        return 0.0f;
    }

    case IntentSocial: {
        // Evening leisure after shift (17:00 to 22:00, i.e. 1020..1320 min)
        if (m >= 1020.0f && m < 1320.0f) {
            return 18.0f;
        }
        // Working hours discourage idle loitering
        if (m >= 480.0f && m < 1020.0f) {
            return -10.0f;
        }
        return 0.0f;
    }

    default:
        return 0.0f;
    }
}

} // namespace giga::game
