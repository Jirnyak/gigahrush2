// The fullscreen raymarch world pass — stage 2 of the raymarch migration.
//
// The WORLD draw (replaced the old cube-mesher pass): one vertex-buffer-free fullscreen
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
// grid (same layout every lit pass shares); 2 = MaterialTextures' photographic
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
class MaterialTextures;
class VoxelMirror;

class RaymarchPass {
public:
    // `mirror` must outlive this pass (its buffers back the descriptor sets);
    // `materials` lends its texture arrays + masks, which are boot-time state.
    bool init(VulkanDevice& dev, VkRenderPass renderPass, const char* shaderDir,
              const VoxelMirror& mirror, const MaterialTextures& materials,
              VkDescriptorSetLayout lightGridSetLayout);
    void destroy();
    bool ready() const { return pipeline_ != VK_NULL_HANDLE; }

    // ПОЛУРЕЗНЫЙ СВЕТОВОЙ ПОЛУПАСС (ddalight.md, решение владельца 2026-08-24
    // после опровержения квад-теней замером): ДО главного рендер-пасса кадр
    // считает весь световой цикл (лампы + теневые DDA-лучи) на половинном
    // разрешении по каждой оси — вчетверо меньше фрагментов при ЛЮБОМ
    // разрешении рендера (цели пересоздаются от свапчейна). Полный кадр
    // сэмплит результат билатерально (глубинный гейт по t луча). Зовётся
    // МЕЖДУ begin_frame_cmd и begin_pass — свой оффскрин-рендерпасс.
    void record_light(VkCommandBuffer cmd, std::uint32_t frameIndex,
                      const CubePush& push, VkDescriptorSet lightGridSet,
                      VkExtent2D fullExtent);

    // Draw the world for this frame. Inverts push.viewProj on the CPU into the
    // frame's UBO slot; overwrites push.torus.z/.w with the texture masks,
    // exactly as the old cube pass did, so the shared shading sees the same
    // lanes it always saw.
    void record(VkCommandBuffer cmd, std::uint32_t frameIndex,
                const CubePush& push, VkDescriptorSet lightGridSet);

private:
    bool create_descriptors(const VoxelMirror& mirror);
    bool create_pipeline(VkRenderPass renderPass, const char* shaderDir);
    bool create_half_pass();
    bool create_half_targets(VkExtent2D halfExtent);
    void destroy_half_targets();

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
    std::uint64_t texMask_ = 0;      // 64 бита: id двойников до 37 (К1-2)
    std::uint64_t normalMask_ = 0;
    std::uint64_t roughnessMask_ = 0;

    // Полурезный свет: 2 цели RGBA16F (диффуз+t, спекуляр) НА КАДР В ПОЛЁТЕ —
    // кадр N+1 пишет, пока кадр N ещё читает свои. Пересоздаются при смене
    // разрешения (waitIdle — смена редка).
    VkRenderPass halfPass_ = VK_NULL_HANDLE;
    VkPipeline halfPipeline_ = VK_NULL_HANDLE;
    VkSampler halfSampler_ = VK_NULL_HANDLE;
    VkDescriptorSetLayout halfSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorSet halfSets_[kMaxFramesInFlight] = {};
    VkImage halfImg_[kMaxFramesInFlight][2] = {};
    VkDeviceMemory halfMem_[kMaxFramesInFlight][2] = {};
    VkImageView halfView_[kMaxFramesInFlight][2] = {};
    VkFramebuffer halfFb_[kMaxFramesInFlight] = {};
    VkExtent2D halfExtent_{0, 0};
};

} // namespace giga::gpu
