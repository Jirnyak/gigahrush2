// Swapchain + image views. Recreatable on window resize.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>
#include <vector>

namespace giga::gpu {

struct VulkanDevice;

struct VulkanSwapchain {
    VkSwapchainKHR handle = VK_NULL_HANDLE;
    VkFormat format = VK_FORMAT_UNDEFINED;
    VkExtent2D extent{};
    std::vector<VkImage> images;
    std::vector<VkImageView> views;

    // fbWidth/fbHeight = drawable size in pixels, used only when the surface
    // reports no fixed extent. Returns false if the drawable is zero-sized.
    bool create(const VulkanDevice& dev, int fbWidth, int fbHeight);
    void destroy(const VulkanDevice& dev);
};

} // namespace giga::gpu
