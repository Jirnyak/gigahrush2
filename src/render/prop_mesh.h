// prop_mesh.h — Procedurally-built device-local meshes for prop rendering.
//
// Each PropShape is a small parametric mesh (cylinder, arch, barrel, pipe,
// stair-step, half-cylinder) generated on the CPU and uploaded to device-local
// memory once at startup. The prop_pass then draws thousands of instances of
// these shapes in a single vkCmdDrawIndexed per shape.
//
// Vertex layout matches body.vert so the same fragment shader (cube.frag)
// handles both bodies and props — no extra permutations.
#pragma once

#include <vulkan/vulkan.h>
#include <cstdint>
#include <vector>

#include "core/math.h"

namespace giga::gpu {

struct VulkanDevice;

// ──────────────────────────── vertex / instance ──────────────────────────────

// Per-vertex data matching the prop.vert attribute layout.
struct PropVertex {
    vec3 pos;
    vec3 normal;
};

// Per-instance data, uploaded via a per-instance vertex binding.
// Layout must match prop.vert locations 2-5.
struct PropInstance {
    vec3    origin;    // world-space CENTRE of the unit mesh
    float   yaw;       // rotation around local Y, radians
    vec3    color;     // display-referred RGB (cube.frag gamma-expands it)
    uint8_t matId;     // material id (0-30), same encoding as CubeInstance
    uint8_t emissive;  // 0-255 -> 0.0-2.0 emissive multiplier (crystals/lamps)
    uint8_t flags;     // bit0=flipX, bit1=damaged(tint darker), bit2=glow pulse
    uint8_t animPhase; // 0-255 mapped 0-2pi: valve spin, lamp flicker phase
    // Per-axis local scale applied before yaw. Unit meshes span +-0.5, so a
    // pipe leg is CylinderX scaled (lengthM, diamM, diamM) — one instance per
    // straight run, however long ([game/antourage]).
    vec3    scale{1.0f, 1.0f, 1.0f};
    // Pads the struct to 48 B = THREE std430 vec4s. cull.comp mirrors this
    // layout as {vec4, vec4, vec4} — an unpadded 44 would shear every instance
    // the compute pass copies (measured: full-screen flickering junk).
    float   pad_ = 0.0f;
};
static_assert(sizeof(PropInstance) == 48, "PropInstance size mismatch");

// ──────────────────────────── mesh container ──────────────────────────────────

struct PropMesh {
    VkBuffer       vertexBuffer = VK_NULL_HANDLE;
    VkBuffer       indexBuffer  = VK_NULL_HANDLE;
    VkDeviceMemory vertexMem    = VK_NULL_HANDLE;
    VkDeviceMemory indexMem     = VK_NULL_HANDLE;
    uint32_t       indexCount   = 0;

    bool valid() const { return vertexBuffer != VK_NULL_HANDLE; }
    void destroy(VkDevice dev);
};

// ──────────────────────────── shape catalogue ─────────────────────────────────

// The clean parametric catalog (the legacy 29-shape zoo died in the purge):
// unit meshes centred on the origin spanning +-0.5, FLAT-SHADED (hard facets —
// the owner's Soviet-industrial read). Cylinders are 8-gon, one per axis so an
// axis-aligned pipe leg needs no per-instance rotation.
enum class PropShape : uint8_t {
    Box = 0,
    CylinderX,
    CylinderY,
    CylinderZ,
    kCount
};


constexpr int kPropShapeCount = static_cast<int>(PropShape::kCount);

// Build a procedural mesh for `shape`, allocate device-local buffers, and fill
// `out`. Returns false if any Vulkan allocation fails.
bool build_prop_mesh(PropShape shape, const VulkanDevice& dev, PropMesh& out);

} // namespace giga::gpu
