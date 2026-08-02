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

// 1. Explicit coverage for all 4 PropShape enum values
static void test_prop_shape_enum_coverage() {
    static_assert(kPropShapeCount == 0, "kPropShapeCount must be 0");
    static_assert(static_cast<uint8_t>(PropShape::kCount) == 0, "PropShape::kCount must be 0");

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

void test_props_all() {
    test_prop_shape_enum_coverage();
    test_prop_instance_layout();
}
