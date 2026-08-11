#pragma once

#include <cstdint>

namespace giga::game {

enum class FloorAnomaly : std::uint8_t {
    None = 0,
    HeavyGravity,
    LowGravity,
    PitchBlack,
    HighDanger,
    Foggy,
    Count
};

struct FloorAnomalyDef {
    std::uint8_t anomaly;         // FloorAnomaly; == index of row
    std::uint8_t weight;          // weight of choice
    std::uint8_t dangerMultX100;  // multiplier for floor_danger (100 = 1x)
    std::uint8_t lightMultX100;   // multiplier for lighting (100 = 1x)
    std::int8_t  gravityDeltaX10; // shift of gravity in m/s^2, -30..+30
    std::uint8_t fogBaseX100;     // base fog density without samosbor (100 = 1.0)
};

static_assert(sizeof(FloorAnomalyDef) == 6);

// Floor anomaly is a pure function of (number, worldSeed)
FloorAnomaly floor_anomaly_for(int number, std::uint32_t worldSeed);

// Retrieve the definition for a given anomaly
const FloorAnomalyDef& floor_anomaly_def(FloorAnomaly anomaly);

} // namespace giga::game
