// Room stock and production loop — the closed-loop inventory for room zones.
//
// ===========================================================================
// ARCHITECTURE (production.md §10-50, §73-90, §140-153)
// ===========================================================================
// * Macro Grid (128^3) -> Room Zones (field bits) -> Room Stock (table per room column).
// * Each floor has up to 1024 room columns (32x32 at stride 4).
// * Production adds to room stock when worker is at a station.
// * Kitchen, Bathroom, Medical deduct from room stock when servicing needs.
// * Empty stock gates/penalizes room recovery, making the floor economy genuinely closed.
#pragma once

#include <cstddef>
#include <cstdint>

namespace giga::game {

struct RoomStock {
    static constexpr std::size_t kMaxRoomsPerFloor = 1024;
    // Stored stock units per room column (e.g. food units in Kitchen, materials in Production, supplies in Medical)
    std::uint16_t stock[kMaxRoomsPerFloor]{};
    std::uint8_t floorKind = 0;
};

// Initializes room stock for a floor using seed and floor archetype rules.
void room_stock_init(RoomStock& rs, std::uint8_t floorKind, std::uint32_t seed);

// Gets current stock count at room lattice coordinates (rx, ry).
std::uint16_t room_stock_get(const RoomStock& rs, int rx, int ry, int stride);

// Attempts to consume `count` units from room (rx, ry). Returns true if successful, false if insufficient stock.
bool room_stock_consume(RoomStock& rs, int rx, int ry, int stride, std::uint16_t count = 1);

// Produces `count` units at room (rx, ry), clamping to `cap`.
void room_stock_produce(RoomStock& rs, int rx, int ry, int stride, std::uint16_t count = 1, std::uint16_t cap = 200);

// Total stock across all rooms on this floor.
std::uint32_t room_stock_total(const RoomStock& rs);

} // namespace giga::game
