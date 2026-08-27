#include "game/fast_travel.h"

namespace giga::game {

FastTravelGate fast_travel_gate(const FastTravelState& ft,
                                const FloorRegistry& floors, int fromFloor,
                                int toFloor, int cx, int cy, int* hubOut) {
    if (toFloor == fromFloor) return FastTravelGate::SameFloor;
    if (floors.module_at(toFloor) == kInvalidModule) return FastTravelGate::NoFloor;
    if (!ft.unlocked(toFloor)) return FastTravelGate::Locked;
    const int hub = fast_hub_at(cx, cy);
    if (hub < 0) return FastTravelGate::NotInCabin;
    if (hubOut) *hubOut = hub;
    return FastTravelGate::Ok;
}

} // namespace giga::game
