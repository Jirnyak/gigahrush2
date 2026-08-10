#pragma once

#include <vulkan/vulkan.h>
#include <vector>
#include "world/gas_field.h"
#include "render/vk_buffer.h"

namespace giga { struct VulkanDevice; }

namespace giga::gpu {

class GasPass {
public:
    GasPass() = default;
    ~GasPass() { destroy(); }
    GasPass(const GasPass&) = delete;
    GasPass& operator=(const GasPass&) = delete;

    bool init(VulkanDevice* dev, const char* shaderDir, VkBuffer masksBuffer);
    void destroy();
    bool ready() const { return computePipeline_ != VK_NULL_HANDLE; }

    void upload(const std::vector<GasCell>& gasCells);
    
    // Dispatches gas_sim.comp and swaps the ping-pong buffers
    void step_sim(VkCommandBuffer cmd, float dt, int downX, int downY, int downZ,
                  float diffuseRate = 2.0f, float buoyancy = 1.0f, float burnRate = 1.0f);

    // Returns the current buffer to read from in other passes (e.g., raymarcher)
    VkBuffer current_buffer() const { return buf_[currentIdx_].buffer; }

private:
    VulkanDevice* dev_ = nullptr;
    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline computePipeline_ = VK_NULL_HANDLE;

    VkDescriptorSetLayout descLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet descSets_[2] = {VK_NULL_HANDLE, VK_NULL_HANDLE};

    VulkanBuffer buf_[2];
    int currentIdx_ = 0;
};

} // namespace giga::gpu
