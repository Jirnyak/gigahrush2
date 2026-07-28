#include "game/floor_spec.h"

#include <cstddef>

namespace giga::game {

namespace {

// The floor catalog — one row per FloorKind, in enum order. This table IS the
// design: tune a floor's character by editing numbers here, not by branching in
// the seeder. Populations give a clear dense->sparse gradient; hostility runs
// the opposite way (safe residential -> deadly derelict).
//
//   kind         name           pop  factionMix    hostility  age window
constexpr FloorSpec kCatalog[] = {
    {FloorKind::Residential, "Residential", 420, {6, 1, 1, 0}, 0.05f, 1, 90},
    {FloorKind::Commercial,  "Commercial",  260, {3, 3, 2, 1}, 0.20f, 14, 80},
    {FloorKind::Industrial,  "Industrial",  150, {2, 4, 1, 0}, 0.35f, 18, 65},
    {FloorKind::Derelict,    "Derelict",     40, {1, 0, 0, 3}, 0.90f, 16, 70},
};
static_assert(sizeof(kCatalog) / sizeof(kCatalog[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "floor catalog must have exactly one row per FloorKind");

} // namespace

const FloorSpec& floor_spec(FloorKind kind) {
    std::size_t i = static_cast<std::size_t>(kind);
    if (i >= static_cast<std::size_t>(FloorKind::Count)) i = 0;
    return kCatalog[i];
}

const FloorSpec& floor_spec_for(std::uint16_t floor) {
    // A readable, deterministic character pattern up the building: mostly
    // residential, commercial on a shorter cycle, industrial deeper, and the
    // occasional derelict/dangerous floor. Pure function of the number, so it
    // reproduces exactly across runs.
    FloorKind kind;
    if (floor % 7 == 6)      kind = FloorKind::Derelict;
    else if (floor % 5 == 4) kind = FloorKind::Industrial;
    else if (floor % 3 == 2) kind = FloorKind::Commercial;
    else                     kind = FloorKind::Residential;
    return floor_spec(kind);
}

} // namespace giga::game
