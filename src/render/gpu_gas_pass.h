#pragma once

#include <cstdint>
#include <vulkan/vulkan.h>
#include "core/math.h"
#include "render/vk_buffer.h"
#include "render/vk_common.h"
#include "render/vk_device.h"
#include "world/types.h"
#include "world/gravity.h"

#ifdef _MSC_VER
#pragma warning(push)
#pragma warning(disable: 4324) // structure was padded due to alignment specifier
#endif

namespace giga::gpu {

// Matches Push in shaders/gas_sim.comp
struct alignas(16) GasPush {
    ivec4 downStep; // xyz = regime_down vector, w = unused
    vec4  params;   // x = diffusionRate, y = buoyancy, z = unused, w = dt
};
static_assert(sizeof(GasPush) == 32, "GasPush layout must be 32 bytes");

class GpuGasPass {
public:
    GpuGasPass() = default;
    ~GpuGasPass() { destroy(); }

    GpuGasPass(const GpuGasPass&) = delete;
    GpuGasPass& operator=(const GpuGasPass&) = delete;

    bool init(VulkanDevice* dev, const char* shaderDir, VkBuffer classBuffer);
    void destroy() noexcept;

    // Advance GPU gas simulation step (ping-pongs buffers)
    void record_sim(VkCommandBuffer cmd, const CellStep& downStep, float dt,
                    float diffusionRate = 0.15f, float buoyancy = 0.40f) noexcept;

    VkBuffer current_gas_buffer() const noexcept {
        return gasSSBO_[readIndex_].buffer;
    }

    bool ready() const noexcept { return computePipeline_ != VK_NULL_HANDLE; }

private:
    bool create_buffers() noexcept;
    bool create_descriptors(VkBuffer classBuffer) noexcept;
    bool create_pipeline(const char* shaderDir) noexcept;

    VulkanDevice* dev_ = nullptr;
    VulkanBuffer gasSSBO_[2]{}; // Double buffered ping-pong (8 MiB each for 128^3)
    uint32_t readIndex_ = 0;

    VkDescriptorSetLayout descSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet descSets_[2]{}; // [0]: In=SSBO[0], Out=SSBO[1]; [1]: In=SSBO[1], Out=SSBO[0]

    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline computePipeline_ = VK_NULL_HANDLE;
};

} // namespace giga::gpu

#ifdef _MSC_VER
#pragma warning(pop)
#endif
