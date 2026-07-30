// suite_props.inl — Unit tests for Procedural Prop Placement System & GPU Instancing.

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

#include "world/macro_grid.h"
#include "world/materials.h"
#include "render/prop_pass.h"
#include "render/prop_placer.h"

using namespace giga;
using namespace giga::gpu;

namespace {

// Layout-compatible inspector to access private PropPass data for assertions
struct PropPassInspector {
    VulkanDevice* dev_;
    VkPipelineLayout layout_;
    VkPipeline pipeline_;
    std::array<PropMesh, kPropShapeCount> meshes_;
    std::array<std::vector<PropInstance>, kPropShapeCount> cpuInst_;
    std::array<std::array<VulkanBuffer, kMaxFramesInFlight>, kPropShapeCount> instBufs_;
    uint32_t lastDrawCount_;
};

inline const PropPassInspector& inspect(const PropPass& pass) {
    return reinterpret_cast<const PropPassInspector&>(pass);
}

} // namespace

// 1. Explicit coverage for all 29 PropShape enum values
static void test_prop_shape_enum_coverage() {
    static_assert(kPropShapeCount == 29, "kPropShapeCount must be 29");
    static_assert(static_cast<uint8_t>(PropShape::kCount) == 29, "PropShape::kCount must be 29");

    static_assert(static_cast<uint8_t>(PropShape::Cylinder) == 0, "PropShape::Cylinder must be 0");
    static_assert(static_cast<uint8_t>(PropShape::HalfCylinder) == 1, "PropShape::HalfCylinder must be 1");
    static_assert(static_cast<uint8_t>(PropShape::Arch) == 2, "PropShape::Arch must be 2");
    static_assert(static_cast<uint8_t>(PropShape::Barrel) == 3, "PropShape::Barrel must be 3");
    static_assert(static_cast<uint8_t>(PropShape::StairStep) == 4, "PropShape::StairStep must be 4");
    static_assert(static_cast<uint8_t>(PropShape::Pipe) == 5, "PropShape::Pipe must be 5");
    static_assert(static_cast<uint8_t>(PropShape::PipeElbow) == 6, "PropShape::PipeElbow must be 6");
    static_assert(static_cast<uint8_t>(PropShape::PipeTee) == 7, "PropShape::PipeTee must be 7");
    static_assert(static_cast<uint8_t>(PropShape::Valve) == 8, "PropShape::Valve must be 8");
    static_assert(static_cast<uint8_t>(PropShape::Grate) == 9, "PropShape::Grate must be 9");
    static_assert(static_cast<uint8_t>(PropShape::RoundGrate) == 10, "PropShape::RoundGrate must be 10");
    static_assert(static_cast<uint8_t>(PropShape::CabinetBox) == 11, "PropShape::CabinetBox must be 11");
    static_assert(static_cast<uint8_t>(PropShape::ControlPanel) == 12, "PropShape::ControlPanel must be 12");
    static_assert(static_cast<uint8_t>(PropShape::Railing) == 13, "PropShape::Railing must be 13");
    static_assert(static_cast<uint8_t>(PropShape::SupportBeam) == 14, "PropShape::SupportBeam must be 14");
    static_assert(static_cast<uint8_t>(PropShape::CrateBox) == 15, "PropShape::CrateBox must be 15");
    static_assert(static_cast<uint8_t>(PropShape::CrateLong) == 16, "PropShape::CrateLong must be 16");
    static_assert(static_cast<uint8_t>(PropShape::LockerUnit) == 17, "PropShape::LockerUnit must be 17");
    static_assert(static_cast<uint8_t>(PropShape::BenchSlab) == 18, "PropShape::BenchSlab must be 18");
    static_assert(static_cast<uint8_t>(PropShape::Terminal) == 19, "PropShape::Terminal must be 19");
    static_assert(static_cast<uint8_t>(PropShape::SecurityCamera) == 20, "PropShape::SecurityCamera must be 20");
    static_assert(static_cast<uint8_t>(PropShape::FloodLamp) == 21, "PropShape::FloodLamp must be 21");
    static_assert(static_cast<uint8_t>(PropShape::FungalColumn) == 22, "PropShape::FungalColumn must be 22");
    static_assert(static_cast<uint8_t>(PropShape::CrystalCluster) == 23, "PropShape::CrystalCluster must be 23");
    static_assert(static_cast<uint8_t>(PropShape::AcidPool) == 24, "PropShape::AcidPool must be 24");
    static_assert(static_cast<uint8_t>(PropShape::Radiator) == 25, "PropShape::Radiator must be 25");
    static_assert(static_cast<uint8_t>(PropShape::DermatinDoor) == 26, "PropShape::DermatinDoor must be 26");
    static_assert(static_cast<uint8_t>(PropShape::ElectricalShield) == 27, "PropShape::ElectricalShield must be 27");
    static_assert(static_cast<uint8_t>(PropShape::BareBulb) == 28, "PropShape::BareBulb must be 28");

    // Runtime loop check using non-constant local variables
    for (int s = 0; s < kPropShapeCount; ++s) {
        PropShape shape = static_cast<PropShape>(s);
        CHECK(static_cast<int>(shape) == s);
    }

    // Verify all 25 shapes can be stored and cleared in PropPass
    PropPass pass;
    pass.clear_instances();
    const auto& insp = inspect(pass);

    for (int s = 0; s < kPropShapeCount; ++s) {
        PropShape shape = static_cast<PropShape>(s);
        PropInstance dummy{};
        dummy.origin = {1.0f * static_cast<float>(s), 2.0f, 3.0f};
        dummy.yaw = 0.5f;
        dummy.color = {0.5f, 0.5f, 0.5f};
        dummy.matId = static_cast<uint8_t>(s % 16);
        dummy.emissive = static_cast<uint8_t>(s * 10);
        dummy.flags = 0x01;
        dummy.animPhase = static_cast<uint8_t>(s * 5);

        pass.add_instance(shape, dummy);
        CHECK(insp.cpuInst_[s].size() == 1);
        CHECK(insp.cpuInst_[s][0].matId == static_cast<uint8_t>(s % 16));
        CHECK(insp.cpuInst_[s][0].emissive == static_cast<uint8_t>(s * 10));
    }

    pass.clear_instances();
    for (int s = 0; s < kPropShapeCount; ++s) {
        CHECK(insp.cpuInst_[s].empty());
    }
}

// 2. Struct layout and size assertions
static void test_prop_instance_layout() {
    static_assert(sizeof(PropInstance) == 32, "PropInstance size mismatch");
    static_assert(sizeof(PropVertex) == 24, "PropVertex size mismatch");

    static_assert(offsetof(PropInstance, origin) == 0, "origin offset error");
    static_assert(offsetof(PropInstance, yaw) == 12, "yaw offset error");
    static_assert(offsetof(PropInstance, color) == 16, "color offset error");
    static_assert(offsetof(PropInstance, matId) == 28, "matId offset error");
    static_assert(offsetof(PropInstance, emissive) == 29, "emissive offset error");
    static_assert(offsetof(PropInstance, flags) == 30, "flags offset error");
    static_assert(offsetof(PropInstance, animPhase) == 31, "animPhase offset error");

    // Runtime checks with non-constant local variables to avoid MSVC C4127 warnings
    size_t szInst = sizeof(PropInstance);
    size_t szVert = sizeof(PropVertex);
    CHECK(szInst == 32);
    CHECK(szVert == 24);

    size_t offOrigin = offsetof(PropInstance, origin);
    size_t offYaw = offsetof(PropInstance, yaw);
    size_t offColor = offsetof(PropInstance, color);
    size_t offMatId = offsetof(PropInstance, matId);
    size_t offEmissive = offsetof(PropInstance, emissive);
    size_t offFlags = offsetof(PropInstance, flags);
    size_t offAnimPhase = offsetof(PropInstance, animPhase);

    CHECK(offOrigin == 0);
    CHECK(offYaw == 12);
    CHECK(offColor == 16);
    CHECK(offMatId == 28);
    CHECK(offEmissive == 29);
    CHECK(offFlags == 30);
    CHECK(offAnimPhase == 31);
}

// 3. PropPlacer::populate non-null placement
static void test_prop_placer_non_null() {
    MacroGrid grid;
    // Build demo layout: solid floor at y=2, solid ceiling at y=6
    for (int z = 10; z < 50; ++z) {
        for (int x = 10; x < 50; ++x) {
            grid.fill_cell(x, 2, z, kMatConcrete);
            grid.fill_cell(x, 6, z, kMatConcrete);
        }
    }
    // Solid West wall
    for (int z = 10; z < 50; ++z) {
        for (int y = 3; y < 6; ++y) {
            grid.fill_cell(10, y, z, kMatConcrete);
        }
    }
    // Hazardous acid pool patch
    for (int z = 20; z < 25; ++z) {
        for (int x = 20; x < 25; ++x) {
            grid.fill_cell(x, 2, z, kMatAcidPool);
        }
    }

    PropPlacer placer;
    PropPass pass;
    placer.populate(grid, pass, 1337u);

    CHECK(placer.total_placed() > 0);
    CHECK(pass.last_draw_count() == 0); // No record() call yet -> GPU draw count 0

    // Sum across all shapes in PropPass
    const auto& insp = inspect(pass);
    uint32_t sumInstances = 0;
    for (int s = 0; s < kPropShapeCount; ++s) {
        sumInstances += static_cast<uint32_t>(insp.cpuInst_[s].size());
    }
    CHECK(sumInstances == placer.total_placed());
}

// 4. PropPlacer determinism
static void test_prop_placer_determinism() {
    MacroGrid gridA, gridB;
    for (int z = 10; z < 40; ++z) {
        for (int x = 10; x < 40; ++x) {
            gridA.fill_cell(x, 2, z, kMatConcrete);
            gridA.fill_cell(x, 6, z, kMatConcrete);
            gridB.fill_cell(x, 2, z, kMatConcrete);
            gridB.fill_cell(x, 6, z, kMatConcrete);
        }
    }

    PropPlacer placerA, placerB;
    PropPass passA, passB;

    placerA.populate(gridA, passA, 42u);
    placerB.populate(gridB, passB, 42u);

    CHECK(placerA.total_placed() > 0);
    CHECK(placerA.total_placed() == placerB.total_placed());

    // Verify detailed per-shape placement counts match bit-for-bit
    const auto& inspA = inspect(passA);
    const auto& inspB = inspect(passB);
    for (int s = 0; s < kPropShapeCount; ++s) {
        CHECK(inspA.cpuInst_[s].size() == inspB.cpuInst_[s].size());
        if (inspA.cpuInst_[s].size() == inspB.cpuInst_[s].size() && !inspA.cpuInst_[s].empty()) {
            CHECK(std::memcmp(inspA.cpuInst_[s].data(), inspB.cpuInst_[s].data(),
                              inspA.cpuInst_[s].size() * sizeof(PropInstance)) == 0);
        }
    }

    // Re-populating the same placer resets and yields identical results
    placerA.populate(gridA, passA, 42u);
    CHECK(placerA.total_placed() == placerB.total_placed());

    // Different seed produces valid placement count
    PropPlacer placerC;
    PropPass passC;
    placerC.populate(gridA, passC, 9999u);
    CHECK(placerC.total_placed() > 0);
}

// 5. Test specific placement rules & shape generation
static void test_prop_placement_rules() {
    MacroGrid grid;
    // Create a corridor along Z (x=20) with solid floor at y=2, ceiling at y=6, West wall at x=19
    for (int z = 10; z < 50; ++z) {
        grid.fill_cell(20, 2, z, kMatConcrete);
        grid.fill_cell(20, 6, z, kMatConcrete);
        grid.fill_cell(19, 3, z, kMatConcrete);
    }
    // Add electric grate at (20, 2, 25)
    grid.fill_cell(20, 2, 25, kMatElectricGrate);

    // Add acid pool patch at (20, 2, 30..34)
    for (int z = 30; z < 35; ++z) {
        grid.fill_cell(20, 2, z, kMatAcidPool);
    }

    PropPlacer placer;
    PropPass pass;
    placer.populate(grid, pass, 777u);
    CHECK(placer.total_placed() > 0);

    const auto& insp = inspect(pass);

    // Verify electric grate special rule (emissive=140, flags=0x04)
    const auto& grates = insp.cpuInst_[static_cast<int>(PropShape::Grate)];
    bool foundElectricGrate = false;
    for (const auto& g : grates) {
        if (g.emissive == 140 && (g.flags & 0x04)) {
            foundElectricGrate = true;
            CHECK_NEAR(g.color.x, 0.30f, 1e-3f);
            CHECK_NEAR(g.color.y, 0.65f, 1e-3f);
            CHECK_NEAR(g.color.z, 0.95f, 1e-3f);
            break;
        }
    }
    CHECK(foundElectricGrate);

    // Verify acid pool prop placement rule
    const auto& acidPools = insp.cpuInst_[static_cast<int>(PropShape::AcidPool)];
    bool foundAcidProp = false;
    for (const auto& a : acidPools) {
        if (a.emissive == 140) {
            foundAcidProp = true;
            CHECK_NEAR(a.color.x, 0.15f, 1e-3f);
            CHECK_NEAR(a.color.y, 0.85f, 1e-3f);
            CHECK_NEAR(a.color.z, 0.25f, 1e-3f);
            break;
        }
    }
    CHECK(foundAcidProp);

    // Build a broad layout to exercise all placement categories and shapes
    MacroGrid broadGrid;
    for (int z = 0; z < 64; ++z) {
        for (int x = 0; x < 64; ++x) {
            broadGrid.fill_cell(x, 0, z, kMatConcrete);
            broadGrid.fill_cell(x, 4, z, kMatConcrete);
            if (x == 0 || x == 63 || z == 0 || z == 63) {
                for (int y = 1; y < 4; ++y) {
                    broadGrid.fill_cell(x, y, z, kMatConcrete);
                }
            }
        }
    }

    PropPlacer broadPlacer;
    PropPass broadPass;
    broadPlacer.populate(broadGrid, broadPass, 12345u);
    CHECK(broadPlacer.total_placed() > 0);

    // Verify flood lamps (emissive == 240)
    const auto& lamps = inspect(broadPass).cpuInst_[static_cast<int>(PropShape::FloodLamp)];
    bool foundLamp = false;
    for (const auto& l : lamps) {
        if (l.emissive == 240) {
            foundLamp = true;
            break;
        }
    }
    CHECK(foundLamp);
}

// 6. Test bounds checking and air cell requirement
static void test_prop_bounds_and_air() {
    MacroGrid grid;
    for (int z = 15; z < 45; ++z) {
        for (int x = 15; x < 45; ++x) {
            grid.fill_cell(x, 2, z, kMatConcrete);
            grid.fill_cell(x, 5, z, kMatConcrete);
        }
    }
    PropPlacer placer;
    PropPass pass;
    placer.populate(grid, pass, 2026u);
    CHECK(placer.total_placed() > 0);

    const auto& insp = inspect(pass);
    for (int s = 0; s < kPropShapeCount; ++s) {
        for (const auto& inst : insp.cpuInst_[s]) {
            int cx = static_cast<int>(std::floor(inst.origin.x / kCellSize));
            int cy = static_cast<int>(std::floor(inst.origin.y / kCellSize));
            int cz = static_cast<int>(std::floor(inst.origin.z / kCellSize));

            CHECK(cx >= 0 && cx < kMacroDim);
            CHECK(cy >= 0 && cy < kMacroDim);
            CHECK(cz >= 0 && cz < kMacroDim);
            // Must inhabit an air cell
            CHECK(grid.cell(cx, cy, cz) == kCellAir);
        }
    }
}

// 7. Test attribute ranges of generated PropInstances
static void test_prop_attribute_validity() {
    MacroGrid grid;
    for (int z = 10; z < 40; ++z) {
        for (int x = 10; x < 40; ++x) {
            grid.fill_cell(x, 2, z, kMatAcidPool);
            grid.fill_cell(x, 6, z, kMatConcrete);
        }
    }
    PropPlacer placer;
    PropPass pass;
    placer.populate(grid, pass, 555u);

    CHECK(placer.total_placed() > 0);

    constexpr float kMaxWorldExtent = static_cast<float>(kMacroDim) * kCellSize;
    constexpr float kTwoPi = 6.283185307179586f;

    const auto& insp = inspect(pass);
    for (int s = 0; s < kPropShapeCount; ++s) {
        for (const auto& inst : insp.cpuInst_[s]) {
            // Origin within world bounds
            CHECK(inst.origin.x >= 0.0f && inst.origin.x <= kMaxWorldExtent);
            CHECK(inst.origin.y >= 0.0f && inst.origin.y <= kMaxWorldExtent);
            CHECK(inst.origin.z >= 0.0f && inst.origin.z <= kMaxWorldExtent);

            // Yaw within [0, 2pi]
            CHECK(inst.yaw >= 0.0f && inst.yaw <= kTwoPi + 1e-4f);

            // Color components within [0, 1]
            CHECK(inst.color.x >= 0.0f && inst.color.x <= 1.0f);
            CHECK(inst.color.y >= 0.0f && inst.color.y <= 1.0f);
            CHECK(inst.color.z >= 0.0f && inst.color.z <= 1.0f);

            // Material ID within valid material range
            CHECK(inst.matId <= 30);
        }
    }
}

// 8. Test capacity limits under full 128^3 grid population
static void test_prop_capacity_limits() {
    MacroGrid grid;
    for (int z = 0; z < kMacroDim; ++z) {
        for (int x = 0; x < kMacroDim; ++x) {
            grid.fill_cell(x, 0, z, kMatConcrete);
            grid.fill_cell(x, 2, z, kMatConcrete);
            grid.fill_cell(x, 4, z, kMatConcrete);
        }
    }
    PropPlacer placer;
    PropPass pass;
    placer.populate(grid, pass, 12345u);
    CHECK(placer.total_placed() > 0);

    const auto& insp = inspect(pass);
    for (int s = 0; s < kPropShapeCount; ++s) {
        CHECK(static_cast<int>(insp.cpuInst_[s].size()) <= kMaxPropInstances);
    }
}

void test_props_all() {
    test_prop_shape_enum_coverage();
    test_prop_instance_layout();
    test_prop_placer_non_null();
    test_prop_placer_determinism();
    test_prop_placement_rules();
    test_prop_bounds_and_air();
    test_prop_attribute_validity();
    test_prop_capacity_limits();
}
