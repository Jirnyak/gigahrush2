// cloth_pass.h — GPU-verlet 2D sheets (the antourage CLOTH primitive:
// curtains, tarps, membranes). The third universal primitive after instances
// and wire chains ([game/antourage/antourage.h] ClothSheet).
//
// Same one-way law and same architecture as WirePass: the sim lives entirely
// on the GPU (cloth_sim.comp), every body on the layer pushes the sheet and
// the sheet pushes nothing back. Points are pulled straight from the sim SSBO
// by cloth.vert as two-sided quads — no vertex buffer.
//
// LAYERING: render never includes game/, so this pass speaks a POD sheet
// format and the app packs it from game::AntourageBake at floor load.
#pragma once

#include <vulkan/vulkan.h>
#include <cstdint>

#include "core/math.h"
#include "render/cube_pass.h" // CubePush — the shared push-constant block
#include "render/vk_buffer.h"
#include "render/wire_pass.h" // kMaxPushBodies — the shared body-cap law

namespace giga::gpu {

// One sheet on the GPU. Must stay in LOCKSTEP with cloth_sim.comp /
// cloth.vert: {vec4 meta; vec4 cur[32]; vec4 prev[32]} = 1040 B. Grid is
// kClothW x kClothH = 8 x 4 points, row-major from the TOP row. meta.x =
// horizontal rest length, meta.y = alive flag, meta.z = vertical rest length;
// cur[i].w = inverse mass (0 pins a point — the whole top row by default).
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

class ClothPass {
public:
    ClothPass() = default;
    ~ClothPass() { destroy(); }
    ClothPass(const ClothPass&) = delete;
    ClothPass& operator=(const ClothPass&) = delete;

    // `masksBuffer` is VoxelMirror's masks SSBO, exactly as ParticlePass takes
    // it: the sim collides against the render-side copy of the grid, so a piece
    // that lost its last pin falls and LANDS instead of sinking through the
    // floor. The mirror outlives this pass, so the raw handle is safe to keep.
    bool init(VulkanDevice* dev, VkRenderPass renderPass, const char* shaderDir,
              VkBuffer masksBuffer);
    void destroy();
    bool ready() const { return drawPipeline_ != VK_NULL_HANDLE; }

    // Replace the sheet set (floor load). Verlet state restarts from rest.
    void upload(const GpuClothSheet* sheets, std::uint32_t count);

    // CPU-side aliveness (anchor probe against the live grid), as for wires.
    void write_alive(const std::uint8_t* flags, std::uint32_t count);

    // Per-sheet pin mask (bit j pins point j) into the inverse-mass slots —
    // the wire pass's twin. Cut one ceiling anchor and half the top row lets
    // go, so the curtain drops on that corner and keeps swinging.
    void write_pins(const std::uint32_t* masks, std::uint32_t count);

    // This frame's push bodies — same array the wire pass gets.
    void upload_bodies(const vec4* bodies, std::uint32_t count);

    // The verlet step. Record OUTSIDE the render pass, before draw.
    void record_sim(VkCommandBuffer cmd, float dt);

    // The two-sided quad draw. Record INSIDE the render pass.
    void record_draw(VkCommandBuffer cmd, const CubePush& push);

    std::uint32_t sheet_count() const { return sheetCount_; }

private:
    bool create_pipelines(VkRenderPass renderPass, const char* shaderDir);

    VulkanDevice* dev_ = nullptr;
    VulkanBuffer points_;  // persistent, host-visible
    VulkanBuffer bodies_;  // per-frame push bodies
    std::uint32_t sheetCount_ = 0;
    std::uint32_t bodyCount_ = 0;

    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    VkDescriptorSet set_ = VK_NULL_HANDLE;
    VkPipelineLayout simLayout_ = VK_NULL_HANDLE;
    VkPipeline simPipeline_ = VK_NULL_HANDLE;
    VkPipelineLayout drawLayout_ = VK_NULL_HANDLE;
    VkPipeline drawPipeline_ = VK_NULL_HANDLE;
};

} // namespace giga::gpu
