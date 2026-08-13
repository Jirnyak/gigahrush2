#pragma once

#include <vulkan/vulkan.h>

namespace giga::gpu {

struct VulkanDevice;

struct PostState {
    float darkAdapt = 1.0f;       // экспозиция, экспоненциально ползёт к цели
    float stun = 0.0f;            // 0..1: размытие + смещение каналов
    float hallucination = 0.0f;   // 0..1: искажение UV + сдвиг палитры
    float crt = 1.0f;             // 0..1: выключатель CRT
};

class PostPass {
public:
    bool init(VulkanDevice& dev, VkRenderPass postRenderPass, const char* shaderDir);
    void destroy();
    bool ready() const { return pipeline_ != VK_NULL_HANDLE; }

    // Renders the offscreen texture into the swapchain, applying PostState effects
    // and tonemapping/sRGB conversions.
    void record(VkCommandBuffer cmd, VkImageView offscreenView, const PostState& state);

private:
    bool create_pipeline(VkRenderPass renderPass, const char* shaderDir);
    bool create_descriptors();
    bool create_sampler();

    VulkanDevice* dev_ = nullptr;
    VkPipelineLayout layout_ = VK_NULL_HANDLE;
    VkPipeline pipeline_ = VK_NULL_HANDLE;

    VkSampler sampler_ = VK_NULL_HANDLE;

    VkDescriptorSetLayout setLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool descPool_ = VK_NULL_HANDLE;
    VkDescriptorSet ds_ = VK_NULL_HANDLE; // Updated per-frame inside record() via vkUpdateDescriptorSets
};

} // namespace giga::gpu
