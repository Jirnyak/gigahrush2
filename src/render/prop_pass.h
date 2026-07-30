// prop_pass.h — GPU-instanced arbitrary mesh pass.
//
// Renders 6 distinct prop shapes (cylinder, half-cylinder, arch, barrel,
// stair-step, pipe) each as one vkCmdDrawIndexed with up to kMaxPropInstances
// instances. The fragment shader is shared with the world and body passes
// (cube.frag) so lighting, fog, and material shading are identical and free.
//
// Integration:
//   1. Call init() once after VulkanDevice and the cube pipeline layout are up.
//   2. Call add_instance() / clear_instances() to populate the scene list.
//   3. Inside the render pass, after CubePass::record(), call record() with
//      the same push constants the cube pass received.
#pragma once

#include <vulkan/vulkan.h>
#include <array>
#include <cstdint>
#include <vector>

#include "render/cube_pass.h"   // CubePush (shared push-constant block)
#include "render/prop_mesh.h"
#include "render/vk_buffer.h"
#include "render/vk_device.h"
#include "render/vk_renderer.h" // kMaxFramesInFlight

namespace giga::gpu {

static constexpr int kMaxPropInstances = 4096; // per shape per frame

class PropPass {
public:
    PropPass()  = default;
    ~PropPass() { destroy(); }
    PropPass(const PropPass&)            = delete;
    PropPass& operator=(const PropPass&) = delete;

    // `pipelineLayout` is borrowed from CubePass (same push-constant block).
    // `shaderDir` must contain prop.vert.spv and cube_tex.frag.spv (or
    // cube.frag.spv when no albedo array is available).
    bool init(VulkanDevice* dev, VkPipelineLayout pipelineLayout,
              VkRenderPass renderPass, const char* shaderDir);

    // Submit instances for the next record() call.
    void add_instance(PropShape shape, const PropInstance& inst);
    void clear_instances();

    // Record all prop draw calls into `cmd`. Push constants must already be
    // bound by the caller (CubePass::record() does this for the world pass;
    // the prop pass is drawn inside the same render-pass subpass so they carry
    // over without a re-push).
    void record(VkCommandBuffer cmd, uint32_t frameIndex,
                const CubePush& push);

    void destroy();
    bool ready() const { return pipeline_ != VK_NULL_HANDLE; }

    uint32_t last_draw_count() const { return lastDrawCount_; }

private:
    bool create_pipeline(VkPipelineLayout layout, VkRenderPass rp,
                         const char* shaderDir);

    VulkanDevice*    dev_ = nullptr;
    VkPipelineLayout layout_ = VK_NULL_HANDLE;
    VkPipeline       pipeline_ = VK_NULL_HANDLE;

    std::array<PropMesh, kPropShapeCount> meshes_;

    // CPU-side instance lists, rebuilt each frame before upload
    std::array<std::vector<PropInstance>, kPropShapeCount> cpuInst_;

    // Per-shape × per-frame host-visible GPU instance buffers
    std::array<std::array<VulkanBuffer, kMaxFramesInFlight>, kPropShapeCount> instBufs_;

    uint32_t lastDrawCount_ = 0;
};

} // namespace giga::gpu
