#include "game/floor_anomaly.h"
#include "core/rng.h"
#include <cstddef>

namespace giga::game {

namespace {

inline constexpr std::uint32_t kSaltFloorAnomaly = 0xfa114a01u;

// Definition table for Floor Anomaly.
// Index matches FloorAnomaly enum exactly.
constexpr FloorAnomalyDef kAnomalyDefs[] = {
    // anomaly, weight, dangerMultX100, lightMultX100, gravityDeltaX10, fogBaseX100
    // None: weight 100, 1.0x danger, 1.0x light, 0 m/s^2 grav, 0.0 fog (spec requires weight 0 = byte for byte matching, wait, weight is just selection weight)
    // Actually, "этаж с weight 0 генерируется байт-в-байт как до изменения". 
    // Wait, if it generates byte-for-byte, the modifiers for "None" must be neutral (100, 100, 0, 0).
    {static_cast<std::uint8_t>(FloorAnomaly::None),         100, 100, 100,   0,  0},
    {static_cast<std::uint8_t>(FloorAnomaly::HeavyGravity),  10, 120, 100, -30,  0}, // -3.0 m/s^2 (heavier since gravity is usually -9.81, wait, +30 makes it -6.81, -30 makes it -12.81)
    {static_cast<std::uint8_t>(FloorAnomaly::LowGravity),    10,  80, 100,  30,  0}, // +3.0 m/s^2
    {static_cast<std::uint8_t>(FloorAnomaly::PitchBlack),     5, 150,   0,   0,  0}, // 0 light
    {static_cast<std::uint8_t>(FloorAnomaly::HighDanger),    10, 200, 100,   0,  0}, // 2.0x danger
    {static_cast<std::uint8_t>(FloorAnomaly::Foggy),         15, 120,  80,   0, 30}, // fog base 0.3
};
static_assert(sizeof(kAnomalyDefs) / sizeof(kAnomalyDefs[0]) == static_cast<std::size_t>(FloorAnomaly::Count));

constexpr std::uint32_t total_weight() {
    std::uint32_t w = 0;
    for (const auto& def : kAnomalyDefs) {
        w += def.weight;
    }
    return w;
}
constexpr std::uint32_t kTotalAnomalyWeight = total_weight();

} // namespace

const FloorAnomalyDef& floor_anomaly_def(FloorAnomaly anomaly) {
    std::size_t idx = static_cast<std::size_t>(anomaly);
    if (idx >= static_cast<std::size_t>(FloorAnomaly::Count)) {
        idx = 0;
    }
    return kAnomalyDefs[idx];
}

FloorAnomaly floor_anomaly_for(int number, std::uint32_t worldSeed) {
    // Determine anomaly deterministically
    // Spec 08 5.4: "Аномалия детерминирована по (number, worldSeed): перезаход на этаж даёт ту же аномалию."
    std::uint32_t roll = hash3(kSaltFloorAnomaly, static_cast<std::uint32_t>(number), worldSeed) % kTotalAnomalyWeight;
    
    std::uint32_t acc = 0;
    for (const auto& def : kAnomalyDefs) {
        acc += def.weight;
        if (roll < acc) {
            return static_cast<FloorAnomaly>(def.anomaly);
        }
    }
    return FloorAnomaly::None;
}

} // namespace giga::game
