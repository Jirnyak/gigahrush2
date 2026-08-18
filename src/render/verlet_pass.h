// verlet_pass.h — THE GPU-verlet pass for antourage: hanging wires (GHOST
// chains) and 2D cloth sheets (curtains, tarps, membranes) in one class, one
// compute shader (verlet_sim.comp), one push-body buffer. A chain is a W x 1
// lattice — at H == 1 the sheet solver degenerates into the chain solver in
// the same traversal order, so the two old passes (wire_pass/cloth_pass, 87 %
// identical) collapsed into sections of this one.
//
// The render half of the owner's one-way law: the verlet sim lives ENTIRELY
// on the GPU, bodies/the player push antourage and antourage pushes nothing
// back, so the CPU tick pays zero. Points are pulled straight from the sim
// SSBOs by wire.vert (line ribbons) and cloth.vert (two-sided quads) — no
// vertex buffer, no per-frame upload beyond a handful of alive flags.
//
// LAYERING: render never includes game/ ([ARCHITECTURE.md]), so this pass
// speaks POD element formats (GpuWireChain / GpuClothSheet below) and the app
// packs them from game::AntourageBake at floor load.
#pragma once

#include <vulkan/vulkan.h>
#include <cstdint>

#include "core/math.h"
#include "render/cube_pass.h" // CubePush — the shared push-constant block
#include "render/vk_buffer.h"

namespace giga::gpu {

// One chain on the GPU. Must stay in LOCKSTEP with verlet_sim.comp (an
// element = {vec4 meta; vec4 cur[P]; vec4 prev[P]}) and wire.vert:
// {vec4 meta; vec4 cur[8]; vec4 prev[8]} = 272 B, all std430-clean vec4s.
// meta.x = segment rest length, meta.y = alive flag, cur[i].w = inverse mass
// (0 pins the two anchor endpoints).
inline constexpr int kWireChainPoints = 8;
struct GpuWireChain {
    vec4 meta;
    vec4 cur[kWireChainPoints];
    vec4 prev[kWireChainPoints];
};
static_assert(sizeof(GpuWireChain) == 272, "three-vec4-clean layout");

inline constexpr std::uint32_t kMaxWireChains = 1024;

// One sheet on the GPU. Same lockstep law, with cloth.vert: {vec4 meta;
// vec4 cur[32]; vec4 prev[32]} = 1040 B. Grid is kClothGridW x kClothGridH =
// 8 x 4 points, row-major from the TOP row. meta.x = horizontal rest length,
// meta.y = alive flag, meta.z = vertical rest length; cur[i].w = inverse mass
// (0 pins a point — the whole top row by default).
inline constexpr int kClothGridW = 8;
inline constexpr int kClothGridH = 4;
inline constexpr int kClothGridPoints = kClothGridW * kClothGridH;
struct GpuClothSheet {
    vec4 meta;
    vec4 cur[kClothGridPoints];
    vec4 prev[kClothGridPoints];
};
static_assert(sizeof(GpuClothSheet) == 1040, "vec4-clean layout");

inline constexpr std::uint32_t kMaxClothSheets = 512;
// 7 x 3 quads x 6 vertices — cloth.vert derives the grid cell from the index.
inline constexpr std::uint32_t kClothVertsPerSheet =
    (kClothGridW - 1) * (kClothGridH - 1) * 6;

// Push-body cap. Every body on the active layer brushes wires and cloth —
// the player is just one of them (an NPC with a camera, owner's law). One
// vec4 per body: xyz = world pos, w = push radius. ONE buffer for both
// sections — the same array used to be memcpy'd twice.
inline constexpr std::uint32_t kMaxPushBodies = 512;

class VerletPass {
public:
    VerletPass() = default;
    ~VerletPass() { destroy(); }
    VerletPass(const VerletPass&) = delete;
    VerletPass& operator=(const VerletPass&) = delete;

    // `masksBuffer` is VoxelMirror's masks SSBO, exactly as ParticlePass takes
    // it: the sim collides against the render-side copy of the grid, so a piece
    // that lost its last pin falls and LANDS instead of sinking through the
    // floor. The mirror outlives this pass, so the raw handle is safe to keep.
    bool init(VulkanDevice* dev, VkRenderPass renderPass, const char* shaderDir,
              VkBuffer masksBuffer);
    void destroy();
    bool ready() const {
        return wireDrawPipeline_ != VK_NULL_HANDLE &&
               clothDrawPipeline_ != VK_NULL_HANDLE;
    }

    // Replace an element set (floor load / prop rebuild). Uploads rest poses;
    // the verlet state restarts from rest, which is invisible on a load.
    void upload_wires(const GpuWireChain* chains, std::uint32_t count);
    void upload_cloths(const GpuClothSheet* sheets, std::uint32_t count);

    // CPU-side aliveness (the anchor probe against the live grid): flags[i]=0
    // kills element i this frame — one byte per element, written into meta.y.
    void write_wire_alive(const std::uint8_t* flags, std::uint32_t count);
    void write_cloth_alive(const std::uint8_t* flags, std::uint32_t count);

    // Per-element pin mask (bit j pins point j) written into the sim's inverse
    // mass slots: pinned = 0, free = 1. This is how a SEVERED end lets go
    // without re-uploading the element — the live verlet positions are kept,
    // so the wire whips down from where it was instead of snapping back to
    // rest, and a curtain drops on the cut corner and keeps swinging.
    void write_wire_pins(const std::uint8_t* masks, std::uint32_t count);
    void write_cloth_pins(const std::uint32_t* masks, std::uint32_t count);

    // This frame's push bodies (every Transform+AABB body on the layer, the
    // camera holder among them — nobody special). vec4 = xyz pos, w radius.
    void upload_bodies(const vec4* bodies, std::uint32_t count);

    // The verlet step: ONE pipeline, one dispatch per non-empty section
    // (chains at W=8,H=1, sheets at W=8,H=4 — disjoint buffers, no barrier
    // needed between them). Record OUTSIDE the render pass, before draw.
    // `gravity` is the layer's declared acceleration VECTOR (m/s^2), straight
    // from world.gravity() — the sim must never re-derive "down" for itself.
    void record_sim(VkCommandBuffer cmd, float dt, vec3 gravity);

    // The draws. Record INSIDE the render pass, after the solid passes.
    void record_draw_wires(VkCommandBuffer cmd, const CubePush& push);
    void record_draw_cloths(VkCommandBuffer cmd, const CubePush& push);

    std::uint32_t chain_count() const { return wire_.count; }
    std::uint32_t sheet_count() const { return cloth_.count; }

private:
    // One antourage section (chains or sheets): its state buffer, its
    // descriptor set (binding 0 differs, bodies/masks shared), its draw
    // pipeline, and its GIGA_VERLET_PIN bookkeeping (sims recorded since the
    // last upload, the upload ordinal, the once-per-epoch dump latch).
    struct Section {
        VulkanBuffer points; // persistent, host-visible
        VkDescriptorSet set = VK_NULL_HANDLE;
        std::uint32_t count = 0;
        std::uint32_t simsSinceUpload = 0;
        std::uint32_t uploadEpoch = 0;
        bool pinDumped = false;
    };

    bool create_pipelines(VkRenderPass renderPass, const char* shaderDir);
    void begin_upload(Section& s); // pin-epoch reset shared by both uploads
    void maybe_pin_dump(Section& s, const char* tag, std::uint32_t pointsPer);
    void record_section_sim(VkCommandBuffer cmd, Section& s, float gridW,
                            float gridH, float dt, vec3 gravity);

    VulkanDevice* dev_ = nullptr;
    Section wire_;
    Section cloth_;
    VulkanBuffer bodies_; // per-frame push bodies, ONE buffer for both
    std::uint32_t bodyCount_ = 0;

    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkPipelineLayout simLayout_ = VK_NULL_HANDLE;
    VkPipeline simPipeline_ = VK_NULL_HANDLE;
    VkPipelineLayout drawLayout_ = VK_NULL_HANDLE;
    VkPipeline wireDrawPipeline_ = VK_NULL_HANDLE;
    VkPipeline clothDrawPipeline_ = VK_NULL_HANDLE;
};

} // namespace giga::gpu
