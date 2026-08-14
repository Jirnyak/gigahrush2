// Room stock and production loop unit tests — production.md §10-50, §73-90, §140-153.
//
// Validates:
// 1. Initialization with seed-based initial supplies and determinism.
// 2. Production increment, capping semantics, and overflow safety.
// 3. Consumption decrement, empty stock rejection, and boundary handling.
// 4. Toroidal wrapping across room columns.
// 5. Total stock accumulation across all 1024 room columns.

#include <cstdio>
#include "game/room_stock.h"

namespace giga::game {

static void test_room_stock_initialization() {
    static_assert(RoomStock::kMaxRoomsPerFloor == 1024);

    RoomStock rs1{};
    CHECK(rs1.floorKind == 0);
    CHECK(room_stock_total(rs1) == 0);
    for (std::size_t i = 0; i < RoomStock::kMaxRoomsPerFloor; ++i) {
        CHECK(rs1.stock[i] == 0);
    }

    // Seed-based initialization
    const std::uint32_t seedA = 0xC0FFEE11u;
    const std::uint8_t floorKind = 1;
    room_stock_init(rs1, floorKind, seedA);
    CHECK(rs1.floorKind == floorKind);
    CHECK(room_stock_total(rs1) > 0);

    // Verify determinism: identical seed and floorKind yield identical stock
    RoomStock rs2{};
    room_stock_init(rs2, floorKind, seedA);
    CHECK(rs2.floorKind == floorKind);
    CHECK(room_stock_total(rs1) == room_stock_total(rs2));
    for (std::size_t i = 0; i < RoomStock::kMaxRoomsPerFloor; ++i) {
        CHECK(rs1.stock[i] == rs2.stock[i]);
        CHECK(rs1.stock[i] >= 10 && rs1.stock[i] <= 40);
    }

    // Different seed yields different stocks
    RoomStock rs3{};
    const std::uint32_t seedB = 0xDEADBEEFu;
    room_stock_init(rs3, floorKind, seedB);
    CHECK(room_stock_total(rs1) != room_stock_total(rs3));

    // Different floorKind yields different stocks
    RoomStock rs4{};
    room_stock_init(rs4, 2, seedA);
    CHECK(room_stock_total(rs1) != room_stock_total(rs4));
}

static void test_room_stock_get_and_indexing() {
    RoomStock rs{};
    const int stride = 4; // 128 / 4 = 32 rooms per axis => 1024 rooms

    // Empty stock returns 0
    CHECK(room_stock_get(rs, 0, 0, stride) == 0);
    CHECK(room_stock_get(rs, 5, 10, stride) == 0);

    // Set specific stock
    rs.stock[0] = 42;
    rs.stock[31 * 32 + 31] = 99; // (31, 31)

    CHECK(room_stock_get(rs, 0, 0, stride) == 42);
    CHECK(room_stock_get(rs, 31, 31, stride) == 99);

    // Toroidal wrapping
    CHECK(room_stock_get(rs, 32, 0, stride) == 42);
    CHECK(room_stock_get(rs, 0, 32, stride) == 42);
    CHECK(room_stock_get(rs, -32, 0, stride) == 42);
    CHECK(room_stock_get(rs, -1, -1, stride) == 99);

    // Invalid stride safety
    CHECK(room_stock_get(rs, 0, 0, 0) == 0);
    CHECK(room_stock_get(rs, 0, 0, -4) == 0);
}

static void test_room_stock_production_and_cap() {
    RoomStock rs{};
    const int stride = 4;
    const int rx = 5;
    const int ry = 8;

    CHECK(room_stock_get(rs, rx, ry, stride) == 0);

    // Produce default 1 unit
    room_stock_produce(rs, rx, ry, stride);
    CHECK(room_stock_get(rs, rx, ry, stride) == 1);

    // Produce multiple units
    room_stock_produce(rs, rx, ry, stride, 49);
    CHECK(room_stock_get(rs, rx, ry, stride) == 50);

    // Produce up to custom cap of 100
    room_stock_produce(rs, rx, ry, stride, 60, 100);
    CHECK(room_stock_get(rs, rx, ry, stride) == 100);

    // Produce further when already at cap — should remain at cap
    room_stock_produce(rs, rx, ry, stride, 10, 100);
    CHECK(room_stock_get(rs, rx, ry, stride) == 100);

    // Produce with default cap 200
    room_stock_produce(rs, rx, ry, stride, 150);
    CHECK(room_stock_get(rs, rx, ry, stride) == 200);

    // Zero produce is no-op
    room_stock_produce(rs, rx, ry, stride, 0, 200);
    CHECK(room_stock_get(rs, rx, ry, stride) == 200);

    // Invalid stride is no-op
    room_stock_produce(rs, rx, ry, 0, 10, 200);
    CHECK(room_stock_get(rs, rx, ry, stride) == 200);
}

static void test_room_stock_consumption_and_rejection() {
    RoomStock rs{};
    const int stride = 4;
    const int rx = 12;
    const int ry = 7;

    // Consumption on empty stock must fail (empty stock rejection)
    CHECK(!room_stock_consume(rs, rx, ry, stride, 1));
    CHECK(room_stock_get(rs, rx, ry, stride) == 0);

    // Produce 30 units
    room_stock_produce(rs, rx, ry, stride, 30);
    CHECK(room_stock_get(rs, rx, ry, stride) == 30);

    // Consume 10 units
    CHECK(room_stock_consume(rs, rx, ry, stride, 10));
    CHECK(room_stock_get(rs, rx, ry, stride) == 20);

    // Over-consumption must fail and not modify existing stock
    CHECK(!room_stock_consume(rs, rx, ry, stride, 25));
    CHECK(room_stock_get(rs, rx, ry, stride) == 20);

    // Consume remaining exactly
    CHECK(room_stock_consume(rs, rx, ry, stride, 20));
    CHECK(room_stock_get(rs, rx, ry, stride) == 0);

    // Consume again from depleted stock fails
    CHECK(!room_stock_consume(rs, rx, ry, stride, 1));
    CHECK(room_stock_get(rs, rx, ry, stride) == 0);

    // Count 0 consumption succeeds without changing stock
    CHECK(room_stock_consume(rs, rx, ry, stride, 0));

    // Invalid stride consumption fails
    CHECK(!room_stock_consume(rs, rx, ry, 0, 1));
}

static void test_room_stock_total_accumulation() {
    RoomStock rs{};
    const int stride = 4;
    CHECK(room_stock_total(rs) == 0);

    room_stock_produce(rs, 0, 0, stride, 15);
    room_stock_produce(rs, 1, 1, stride, 25);
    room_stock_produce(rs, 2, 3, stride, 60);

    CHECK(room_stock_total(rs) == 100);

    CHECK(room_stock_consume(rs, 1, 1, stride, 10));
    CHECK(room_stock_total(rs) == 90);

    // Initialize with seed and verify total equals sum of gets
    room_stock_init(rs, 0, 0x12345678u);
    std::uint32_t manualSum = 0;
    for (int ry = 0; ry < 32; ++ry) {
        for (int rx = 0; rx < 32; ++rx) {
            manualSum += room_stock_get(rs, rx, ry, stride);
        }
    }
    CHECK(room_stock_total(rs) == manualSum);
}

static void test_room_stock_all() {
    test_room_stock_initialization();
    test_room_stock_get_and_indexing();
    test_room_stock_production_and_cap();
    test_room_stock_consumption_and_rejection();
    test_room_stock_total_accumulation();
    std::printf("[test] suite_room_stock: initialization, production, consumption, and totals verified\n");
}

} // namespace giga::game
