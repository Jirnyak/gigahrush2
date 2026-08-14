#include "game/room_stock.h"

#include <algorithm>
#include "core/rng.h"
#include "core/wrap.h"
#include "world/types.h"

namespace giga::game {

namespace {

inline int room_stock_index(int rx, int ry, int stride) {
    if (stride <= 0) return -1;
    const int roomsPerAxis = kMacroDim / stride;
    if (roomsPerAxis <= 0) return -1;

    const int wx = wrapi(rx, roomsPerAxis);
    const int wy = wrapi(ry, roomsPerAxis);
    const int idx = wy * roomsPerAxis + wx;
    if (idx < 0 || static_cast<std::size_t>(idx) >= RoomStock::kMaxRoomsPerFloor) {
        return -1;
    }
    return idx;
}

} // namespace

void room_stock_init(RoomStock& rs, std::uint8_t floorKind, std::uint32_t seed) {
    rs.floorKind = floorKind;
    const std::uint32_t floorSeed = seed ^ (static_cast<std::uint32_t>(floorKind) * 0x9E3779B9u);
    for (std::size_t i = 0; i < RoomStock::kMaxRoomsPerFloor; ++i) {
        // Deterministic initial supply seeded by floor, room index and salt
        const std::uint32_t h = hash3(floorSeed, static_cast<std::uint32_t>(i), 0x570C12u);
        // Initial stock 10..40 units per room
        rs.stock[i] = static_cast<std::uint16_t>(10 + rand_below(h, 31));
    }
}

std::uint16_t room_stock_get(const RoomStock& rs, int rx, int ry, int stride) {
    const int idx = room_stock_index(rx, ry, stride);
    if (idx < 0) return 0;
    return rs.stock[idx];
}

bool room_stock_consume(RoomStock& rs, int rx, int ry, int stride, std::uint16_t count) {
    if (count == 0) return true;
    const int idx = room_stock_index(rx, ry, stride);
    if (idx < 0) return false;

    if (rs.stock[idx] >= count) {
        rs.stock[idx] -= count;
        return true;
    }
    return false;
}

void room_stock_produce(RoomStock& rs, int rx, int ry, int stride, std::uint16_t count, std::uint16_t cap) {
    if (count == 0) return;
    const int idx = room_stock_index(rx, ry, stride);
    if (idx < 0) return;

    const std::uint32_t newTotal = static_cast<std::uint32_t>(rs.stock[idx]) + count;
    rs.stock[idx] = static_cast<std::uint16_t>(std::min<std::uint32_t>(newTotal, cap));
}

std::uint32_t room_stock_total(const RoomStock& rs) {
    std::uint32_t sum = 0;
    for (std::size_t i = 0; i < RoomStock::kMaxRoomsPerFloor; ++i) {
        sum += rs.stock[i];
    }
    return sum;
}

} // namespace giga::game
