// suite_props.inl — Unit tests for Procedural Prop Placement System & GPU Instancing.

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

#include "world/macro_grid.h"
#include "world/materials.h"
#include "render/prop_pass.h"


using namespace giga;
using namespace giga::gpu;

namespace {

// Layout-compatible inspector to access private PropPass data for assertions.
// Mirrors the member PREFIX of PropPass ([prop_pass.h] keeps the order).
struct PropPassInspector {
    VulkanDevice* dev_;
    VkPipelineLayout layout_;
    VkPipeline pipeline_;
    std::array<PropMesh, kPropShapeCount> meshes_;
    std::array<std::vector<PropInstance>, kPropShapeCount> cpuInst_;
    uint32_t totalInst_;
    uint32_t overflowDropped_;
};

inline const PropPassInspector& inspect(const PropPass& pass) {
    return reinterpret_cast<const PropPassInspector&>(pass);
}

} // namespace

// 1. Explicit coverage for all 4 PropShape enum values
static void test_prop_shape_enum_coverage() {
    static_assert(kPropShapeCount == 4, "the rebuilt catalog: Box + 3 axis cylinders");
    static_assert(static_cast<uint8_t>(PropShape::kCount) == 4, "PropShape::kCount must be 4");

    // Runtime loop check using non-constant local variables
    for (int s = 0; s < kPropShapeCount; ++s) {
        PropShape shape = static_cast<PropShape>(s);
        CHECK(static_cast<int>(shape) == s);
    }

    // Verify all 4 shapes can be stored and cleared in PropPass
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
    static_assert(sizeof(PropInstance) == 48, "PropInstance size mismatch");
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
    CHECK(szInst == 48);
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

// 3. The cap is the ROOT cap — TOTAL across shapes, not per shape, and the
// overflow is counted (printed at clear_instances, [light-perf.md] owner
// decision: PropPass stores everything, GpuCullPass decides visibility).
static void test_prop_root_cap_total_not_per_shape() {
    static_assert(kRootPropInstances == (1u << 17),
                  "root cap is the owner's 2^17 ([light-perf.md])");

    PropPass pass;
    const auto& insp = inspect(pass);
    PropInstance dummy{};

    // Fill shape 0 to two short of the ROOT cap, then push 5 into shape 1:
    // the old per-shape 4096 would have taken all 5; the root cap takes 2.
    for (uint32_t i = 0; i < kRootPropInstances - 2u; ++i)
        pass.add_instance(static_cast<PropShape>(0), dummy);
    CHECK(pass.total_instance_count() == kRootPropInstances - 2u);

    for (int i = 0; i < 5; ++i)
        pass.add_instance(static_cast<PropShape>(1), dummy);
    CHECK(insp.cpuInst_[0].size() == kRootPropInstances - 2u);
    CHECK(insp.cpuInst_[1].size() == 2u);
    CHECK(pass.total_instance_count() == kRootPropInstances);
    CHECK(insp.overflowDropped_ == 3u);

    pass.clear_instances(); // prints the dropped total out loud
    CHECK(pass.total_instance_count() == 0u);
    CHECK(insp.cpuInst_[0].empty());
    CHECK(insp.cpuInst_[1].empty());
}

void test_props_all() {
    test_prop_shape_enum_coverage();
    test_prop_instance_layout();
    test_prop_root_cap_total_not_per_shape();
}
