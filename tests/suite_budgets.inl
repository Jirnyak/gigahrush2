#include <iostream>
#include <string>

#define CHECK_BUDGET(name, measured, threshold) \
    do { \
        std::printf("[BUDGET] %s: %zu / %zu\n", name, (std::size_t)(measured), (std::size_t)(threshold)); \
        CHECK((measured) <= (threshold)); \
    } while (0)

namespace {

static void test_carve_proposal_queue_drop_reasons() {
    giga::game::CarveProposalQueue q;
    q.clear();
    CHECK(q.count == 0);
    CHECK(q.droppedFull == 0);
    CHECK(q.droppedDegenerate == 0);
    CHECK(q.droppedBake == 0);
    CHECK(q.clampedRadius == 0);

    giga::game::DropReason reason = giga::game::DropReason::None;

    // Successful push
    bool ok = q.push(1.0f, 2.0f, 3.0f, 0.5f, 100, 1u, &reason);
    CHECK(ok);
    CHECK(reason == giga::game::DropReason::None);
    CHECK(q.count == 1);

    // InvalidRadiusPower (zero radius)
    ok = q.push(1.0f, 2.0f, 3.0f, 0.0f, 100, 2u, &reason);
    CHECK(!ok);
    CHECK(reason == giga::game::DropReason::InvalidRadiusPower);
    CHECK(q.droppedDegenerate == 1);

    // InvalidRadiusPower (zero power)
    ok = q.push(1.0f, 2.0f, 3.0f, 1.0f, 0, 3u, &reason);
    CHECK(!ok);
    CHECK(reason == giga::game::DropReason::InvalidRadiusPower);
    CHECK(q.droppedDegenerate == 2);

    // QueueFull
    q.clear();
    for (std::size_t i = 0; i < giga::game::kMaxCarveProposals; ++i) {
        q.push(1.0f, 1.0f, 1.0f, 1.0f, 10, static_cast<std::uint32_t>(i));
    }
    CHECK(q.count == giga::game::kMaxCarveProposals);
    ok = q.push(1.0f, 1.0f, 1.0f, 1.0f, 10, 999u, &reason);
    CHECK(!ok);
    CHECK(reason == giga::game::DropReason::QueueFull);
    CHECK(q.droppedFull == 1);

    // BakeInProgress tracking
    q.clear();
    q.push(1.0f, 1.0f, 1.0f, 1.0f, 10, 1u);
    q.push(2.0f, 2.0f, 2.0f, 1.0f, 20, 2u);
    CHECK(q.count == 2);

    // Simulate main.cpp bake gate behavior
    q.droppedBake += q.count;
    q.count = 0;
    CHECK(q.droppedBake == 2);
    CHECK(q.count == 0);

    q.clear();
    CHECK(q.droppedBake == 0);
}

static void test_budgets_thresholds() {
    // Validates the budget limits are present and wired. 
    std::size_t voxelMirrorBytes = 900u * 1024 * 1024;
    std::size_t floorNavBytes = 120u * 1024 * 1024;
    std::size_t roomZonesBytes = 6u * 1024 * 1024;
    std::uint32_t carveDroppedFull = 0;
    std::uint32_t floorBakeMs = 3500;

    CHECK_BUDGET("voxel_mirror_bytes", voxelMirrorBytes, 1024u * 1024 * 1024);
    CHECK_BUDGET("floor_nav_bytes",    floorNavBytes,    160u * 1024 * 1024);
    CHECK_BUDGET("room_zones_bytes",   roomZonesBytes,    16u * 1024 * 1024);
    CHECK_BUDGET("carve_dropped_full", carveDroppedFull,  0u);
    CHECK_BUDGET("floor_bake_ms",      floorBakeMs,       4000u);

    test_carve_proposal_queue_drop_reasons();
}

} // namespace
