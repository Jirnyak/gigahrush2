// The fullscreen raymarch world pass — stage 2 of the raymarch migration.
//
// Replaces CubePass::record for the WORLD: one vertex-buffer-free fullscreen
// triangle whose fragment shader (shaders/raymarch.frag) runs a two-level DDA
// over the VoxelMirror's SSBOs and writes colour + honest gl_FragDepth through
// the same CubePush::viewProj the raster passes push — so bodies, props and
// particles occlude against voxel walls unchanged ([render.md]).
//
// What this buys, concretely: the renderer's response to world mutation drops
// from "full 2.1 M-cell classify + remesh per invalidate()" to nothing at all —
// the marcher reads whatever bytes the mirror holds this frame, and the mirror
// pays 64 B per dirtied cell ([render/voxel_mirror.h]). Mass destruction by
// hundreds of NPCs becomes bandwidth, not rebuild time.
//
// Sets: 0 = the mirror (5 SSBOs + a small UBO: inverse view-proj for ray
// generation, CPU-inverted, plus the material albedo table); 1 = the light
// grid (same layout every lit pass shares); 2 = CubePass's photographic
// texture arrays, present only in the -DGIGA_ALBEDO_ARRAY module — the same
// two-modules-from-one-source scheme cube.frag uses, for the same reason.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>

#include "core/math.h"
#include "render/vk_buffer.h"
#include "render/vk_common.h" // kMaxFramesInFlight

namespace giga::gpu {

struct VulkanDevice;
struct CubePush;
class CubePass;
class VoxelMirror;

class RaymarchPass {
public:
    // `mirror` must outlive this pass (its buffers back the descriptor sets);
    // `cubePass` lends its texture arrays + masks, which are boot-time state.
    bool init(VulkanDevice& dev, VkRenderPass renderPass, const char* shaderDir,
              const VoxelMirror& mirror, const CubePass& cubePass,
              VkDescriptorSetLayout lightGridSetLayout);
    void destroy();
    bool ready() const { return pipeline_ != VK_NULL_HANDLE; }

    // Draw the world for this frame. Inverts push.viewProj on the CPU into the
    // frame's UBO slot; overwrites push.torus.z/.w with the texture masks,
    // exactly as CubePass::record did, so the shared shading sees the same
    // lanes it always saw.
    void record(VkCommandBuffer cmd, std::uint32_t frameIndex,
                const CubePush& push, VkDescriptorSet lightGridSet);

private:
    bool create_descriptors(const VoxelMirror& mirror);
    bool create_pipeline(VkRenderPass renderPass, const char* shaderDir);

    VulkanDevice* dev_ = nullptr;
    VkPipelineLayout layout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;

    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet sets_[kMaxFramesInFlight] = {};
    VulkanBuffer ubo_[kMaxFramesInFlight]; // persistently mapped, tiny

    VkDescriptorSetLayout lightGridSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout texSetLayout_ = VK_NULL_HANDLE; // borrowed, not owned
    VkDescriptorSet texSet_ = VK_NULL_HANDLE;             // borrowed, not owned
    bool textured_ = false;
    std::uint32_t texMask_ = 0;
    std::uint32_t normalMask_ = 0;
    std::uint32_t roughnessMask_ = 0;
};

} // namespace giga::gpu
