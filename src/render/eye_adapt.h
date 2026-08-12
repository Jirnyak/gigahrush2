#pragma once

#include <vulkan/vulkan.h>
#include <cstdint>

#include "render/vk_buffer.h"

namespace giga::gpu {

struct VulkanDevice;

struct AdaptState {
    float currentLum;
    float targetLum;
    float dt;
    float pad;
};

class EyeAdaptPass {
public:
    bool init(VulkanDevice& dev);
    void destroy(VulkanDevice& dev);

    // Records the compute shader dispatch. 
    // Uses the offscreen HDR view to calculate average luminance.
    void record(VulkanDevice& dev, VkCommandBuffer cmd, VkImageView hdrView, float dtSec);
    
    // Returns the current calculated luminance (readback from GPU from the previous frame).
    float get_current_lum() const {
        if (!ssbo_.mapped) return 1.0f;
        return static_cast<const AdaptState*>(ssbo_.mapped)->currentLum;
    }

private:
    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkPipelineLayout pipelineLayout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;
    
    VkSampler sampler_ = VK_NULL_HANDLE;
    VkDescriptorPool descriptorPool_ = VK_NULL_HANDLE;
    VkDescriptorSet descriptorSet_ = VK_NULL_HANDLE;
    
    VulkanBuffer ssbo_;
};

} // namespace giga::gpu
