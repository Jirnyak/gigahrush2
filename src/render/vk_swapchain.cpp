#include "render/vk_swapchain.h"

#include "render/vk_common.h"
#include "render/vk_device.h"

#include <algorithm>
#include <vector>

namespace giga::gpu {

namespace {

VkSurfaceFormatKHR choose_format(VkPhysicalDevice pd, VkSurfaceKHR s) {
    std::uint32_t n = 0;
    vkGetPhysicalDeviceSurfaceFormatsKHR(pd, s, &n, nullptr);
    std::vector<VkSurfaceFormatKHR> f(n);
    vkGetPhysicalDeviceSurfaceFormatsKHR(pd, s, &n, f.data());
    for (const auto& x : f)
        if (x.format == VK_FORMAT_B8G8R8A8_UNORM
            && x.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR)
            return x;
    if (!f.empty()) return f[0];
    return VkSurfaceFormatKHR{VK_FORMAT_B8G8R8A8_UNORM,
                              VK_COLOR_SPACE_SRGB_NONLINEAR_KHR};
}

} // namespace

bool VulkanSwapchain::create(const VulkanDevice& d, int fbWidth, int fbHeight) {
    VkSurfaceCapabilitiesKHR caps{};
    VK_TRY(vkGetPhysicalDeviceSurfaceCapabilitiesKHR(d.physical, d.surface,
                                                     &caps));

    VkSurfaceFormatKHR sf = choose_format(d.physical, d.surface);
    format = sf.format;

    if (caps.currentExtent.width != UINT32_MAX) {
        extent = caps.currentExtent;
    } else {
        extent.width = std::clamp(static_cast<std::uint32_t>(fbWidth),
                                  caps.minImageExtent.width,
                                  caps.maxImageExtent.width);
        extent.height = std::clamp(static_cast<std::uint32_t>(fbHeight),
                                   caps.minImageExtent.height,
                                   caps.maxImageExtent.height);
    }
    if (extent.width == 0 || extent.height == 0) return false;

    std::uint32_t imageCount = caps.minImageCount + 1;
    if (caps.maxImageCount > 0 && imageCount > caps.maxImageCount)
        imageCount = caps.maxImageCount;

    VkSwapchainCreateInfoKHR ci{};
    ci.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
    ci.surface = d.surface;
    ci.minImageCount = imageCount;
    ci.imageFormat = sf.format;
    ci.imageColorSpace = sf.colorSpace;
    ci.imageExtent = extent;
    ci.imageArrayLayers = 1;
    // TRANSFER_SRC as well as COLOR_ATTACHMENT, so a presented frame can be read
    // back to a PNG ([screenshot.h]). Universally supported for a swapchain and free
    // when unused; without it vkCmdCopyImageToBuffer on a swapchain image is invalid
    // usage, which validation would catch and Release would not.
    ci.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT |
                    VK_IMAGE_USAGE_TRANSFER_SRC_BIT;

    std::uint32_t qf[2] = {d.families.graphics, d.families.present};
    if (d.families.graphics != d.families.present) {
        ci.imageSharingMode = VK_SHARING_MODE_CONCURRENT;
        ci.queueFamilyIndexCount = 2;
        ci.pQueueFamilyIndices = qf;
    } else {
        ci.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
    }
    ci.preTransform = caps.currentTransform;
    ci.compositeAlpha = VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
    ci.presentMode = VK_PRESENT_MODE_FIFO_KHR; // vsync; always available
    ci.clipped = VK_TRUE;
    ci.oldSwapchain = VK_NULL_HANDLE;
    VK_TRY(vkCreateSwapchainKHR(d.device, &ci, nullptr, &handle));

    std::uint32_t n = 0;
    vkGetSwapchainImagesKHR(d.device, handle, &n, nullptr);
    images.resize(n);
    vkGetSwapchainImagesKHR(d.device, handle, &n, images.data());

    views.resize(n);
    for (std::uint32_t i = 0; i < n; ++i) {
        VkImageViewCreateInfo vci{};
        vci.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
        vci.image = images[i];
        vci.viewType = VK_IMAGE_VIEW_TYPE_2D;
        vci.format = format;
        vci.components.r = VK_COMPONENT_SWIZZLE_IDENTITY;
        vci.components.g = VK_COMPONENT_SWIZZLE_IDENTITY;
        vci.components.b = VK_COMPONENT_SWIZZLE_IDENTITY;
        vci.components.a = VK_COMPONENT_SWIZZLE_IDENTITY;
        vci.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
        vci.subresourceRange.baseMipLevel = 0;
        vci.subresourceRange.levelCount = 1;
        vci.subresourceRange.baseArrayLayer = 0;
        vci.subresourceRange.layerCount = 1;
        VK_TRY(vkCreateImageView(d.device, &vci, nullptr, &views[i]));
    }
    return true;
}

void VulkanSwapchain::destroy(const VulkanDevice& d) {
    for (auto v : views)
        if (v) vkDestroyImageView(d.device, v, nullptr);
    views.clear();
    if (handle) {
        vkDestroySwapchainKHR(d.device, handle, nullptr);
        handle = VK_NULL_HANDLE;
    }
    images.clear();
}

} // namespace giga::gpu
