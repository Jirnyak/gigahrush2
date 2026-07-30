// prop_mesh.h — Procedurally-built device-local meshes for prop rendering.
//
// Each PropShape is a small parametric mesh (cylinder, arch, barrel, pipe,
// stair-step, half-cylinder) generated on the CPU and uploaded to device-local
// memory once at startup. The prop_pass then draws thousands of instances of
// these shapes in a single vkCmdDrawIndexed per shape.
//
// Vertex layout matches cube.vert / body.vert so the same fragment shader
// (cube.frag) handles both voxels and props — no extra permutations.
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
    vec3    origin;    // world-space minimum corner / base centre
    float   yaw;       // rotation around local Y, radians
    vec3    color;     // display-referred RGB (cube.frag gamma-expands it)
    uint8_t matId;     // material id (0-30), same encoding as CubeInstance
    uint8_t emissive;  // 0-255 -> 0.0-2.0 emissive multiplier (crystals/lamps)
    uint8_t flags;     // bit0=flipX, bit1=damaged(tint darker), bit2=glow pulse
    uint8_t animPhase; // 0-255 mapped 0-2pi: valve spin, lamp flicker phase
};
static_assert(sizeof(PropInstance) == 32, "PropInstance size mismatch");

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

enum class PropShape : uint8_t {
    // ──── Phase 1: basic primitives ─────────────────────────────────────────
    Cylinder     = 0, // vertical pillar  r=0.30 m, h=2.00 m, 16 sides
    HalfCylinder = 1, // half-pipe wall   r=0.40 m, h=2.00 m,  8 sides
    Arch         = 2, // archway opening  outer r=1.0, inner r=0.6, d=0.5 m
    Barrel       = 3, // squat barrel     r=0.35 m, h=0.80 m, 12 sides
    StairStep    = 4, // wedge step       2.0 x 0.25 x 0.40 m
    Pipe         = 5, // horizontal pipe  r=0.15 m, l=2.00 m, 10 sides
    // ──── Phase 2: mechanical & structural ──────────────────────────────────
    PipeElbow    = 6, // 90° pipe bend (quarter torus) r=0.15, bend_r=0.30 m
    PipeTee      = 7, // T-junction: one horizontal pipe + one vertical branch
    Valve        = 8, // handwheel valve: wheel + spokes + stem
    Grate        = 9, // flat floor grate 2x2x0.05 m (bar grid)
    RoundGrate   = 10,// round ventilation grate r=0.50 m
    CabinetBox   = 11,// electrical cabinet 0.4x1.8x0.2 m (wall-mount)
    ControlPanel = 12,// angled console 1.2x1.0x0.4 m
    Railing      = 13,// handrail segment 2.0 m long (top bar + 2 posts)
    // ──── Phase 3: living world ──────────────────────────────────────────────
    SupportBeam  = 14,// H-section steel beam 4.0 m long
    CrateBox     = 15,// storage crate 0.6x0.6x0.6 m with edge chamfers
    CrateLong    = 16,// long crate  2.0x0.6x0.6 m
    LockerUnit   = 17,// locker 0.5x1.8x0.3 m (door + frame)
    BenchSlab    = 18,// bench 2.0x0.45x0.40 m
    Terminal     = 19,// computer terminal: pedestal + angled screen
    SecurityCamera = 20,// dome camera on L-bracket
    FloodLamp    = 21,// conical floodlight on stem
    // ──── Phase 4: organic / anomalous ──────────────────────────────────────
    FungalColumn = 22,// mushroom-encrusted column r≈0.35 with organic bumps
    CrystalCluster = 23,// cluster of 5 tapered prism crystals
    AcidPool     = 24,// flat acid pool disk r=0.8 with edge bubbles
    kCount
};


constexpr int kPropShapeCount = static_cast<int>(PropShape::kCount);

// Build a procedural mesh for `shape`, allocate device-local buffers, and fill
// `out`. Returns false if any Vulkan allocation fails.
bool build_prop_mesh(PropShape shape, const VulkanDevice& dev, PropMesh& out);

} // namespace giga::gpu
