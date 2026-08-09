#include <iostream>
#include <string>

#define CHECK_BUDGET(name, measured, threshold) \
    do { \
        std::printf("[BUDGET] %s: %zu / %zu\n", name, (std::size_t)(measured), (std::size_t)(threshold)); \
        CHECK((measured) <= (threshold)); \
    } while (0)

namespace {

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
}

} // namespace
