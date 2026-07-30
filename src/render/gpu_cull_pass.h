// gpu_cull_pass.h — GPU Compute Frustum & Distance Culling Pass.
//
// Computes GPU frustum & distance culling for prop mesh instances, populating
// VkDrawIndexedIndirectCommand SSBOs for zero-CPU-overhead rendering.
//
// 0B GC on hot path, no RTTI, no exceptions, C++23.
#pragma once

#include <vulkan/vulkan.h>
#include <array>
#include <cstdint>
#include "core/math.h"
#include "render/prop_mesh.h"
#include "render/vk_buffer.h"
#include "render/vk_device.h"

namespace giga::gpu {

// Matches VkDrawIndexedIndirectCommand in Vulkan API & GLSL std430 (20 bytes)
struct GpuDrawIndexedIndirectCommand {
    uint32_t indexCount    = 0;
    uint32_t instanceCount = 0;
    uint32_t firstIndex    = 0;
    int32_t  vertexOffset  = 0;
    uint32_t firstInstance = 0;
};
static_assert(sizeof(GpuDrawIndexedIndirectCommand) == 20, "GpuDrawIndexedIndirectCommand layout must be 20 bytes");

// Matches CullPush in shaders/cull.comp (128 bytes)
struct alignas(16) CullPush {
    mat4     viewProj;      // 64B: View-Projection matrix
    vec4     camPos;        // 16B: xyz = camera position, w = fogEnd radius
    vec4     boxMinExt;     // 16B: xyz = AABB min, w = torusPeriod
    vec4     boxMaxParams;  // 16B: xyz = AABB max, w = float(vertexOffset)
    uint32_t objectCount;   //  4B: total input instance count
    uint32_t indexCount;    //  4B: index count for draw command
    uint32_t firstIndex;    //  4B: first index offset
    uint32_t firstInstance; //  4B: base instance offset
};
static_assert(sizeof(CullPush) == 128, "CullPush layout size must be exactly 128 bytes");

class GpuCullPass {
public:
    GpuCullPass()  = default;
    ~GpuCullPass() { destroy(); }

    GpuCullPass(const GpuCullPass&)            = delete;
    GpuCullPass& operator=(const GpuCullPass&) = delete;

    // Create descriptor set layout and compute pipeline
    bool init(VulkanDevice* dev, const char* shaderDir) noexcept;
    void destroy() noexcept;

    // Record compute dispatch & barriers for GPU frustum culling.
    // Writes culled instances to `outCulledInstanceBuf` and indirect command to `outIndirectBuf`.
    void record_cull(VkCommandBuffer cmd,
                     const mat4& viewProj,
                     const vec3& camPos,
                     float fogEnd,
                     float torusPeriod,
                     VkBuffer srcInstanceBuf,
                     uint32_t instanceCount,
                     uint32_t indexCount,
                     uint32_t firstIndex,
                     int32_t vertexOffset,
                     uint32_t firstInstance,
                     const vec3& boxMin,
                     const vec3& boxMax,
                     VkBuffer outCulledInstanceBuf,
                     VkBuffer outIndirectBuf) noexcept;

    // Returns local-space AABB for a given PropShape
    static void get_shape_aabb(PropShape shape, vec3& outMin, vec3& outMax) noexcept;

    bool ready() const noexcept { return pipeline_ != VK_NULL_HANDLE; }
    VkPipelineLayout pipeline_layout() const noexcept { return pipelineLayout_; }

private:
    bool create_descriptor_set_layout() noexcept;
    bool create_compute_pipeline(const char* shaderDir) noexcept;

    VulkanDevice* dev_ = nullptr;

    VkDescriptorSetLayout descSetLayout_  = VK_NULL_HANDLE;
    VkPipelineLayout      pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline            pipeline_       = VK_NULL_HANDLE;
};

} // namespace giga::gpu
