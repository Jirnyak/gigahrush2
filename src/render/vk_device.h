// Vulkan instance + surface + logical device bring-up (SDL3 window surface,
// MoltenVK portability on macOS). Owns the objects every later stage needs.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>

struct SDL_Window;

namespace giga::gpu {

struct QueueFamilies {
    std::uint32_t graphics = UINT32_MAX;
    std::uint32_t present = UINT32_MAX;
    bool complete() const {
        return graphics != UINT32_MAX && present != UINT32_MAX;
    }
};

struct VulkanDevice {
    VkInstance instance = VK_NULL_HANDLE;
    VkDebugUtilsMessengerEXT debug = VK_NULL_HANDLE;
    VkSurfaceKHR surface = VK_NULL_HANDLE;
    VkPhysicalDevice physical = VK_NULL_HANDLE;
    VkDevice device = VK_NULL_HANDLE;
    VkQueue graphicsQueue = VK_NULL_HANDLE;
    VkQueue presentQueue = VK_NULL_HANDLE;
    QueueFamilies families;
    VkPhysicalDeviceProperties props{};
    bool validation = false;

    // window must have been created with SDL_WINDOW_VULKAN.
    bool init(SDL_Window* window, bool enableValidation);
    void destroy();

    VulkanDevice() = default;
    VulkanDevice(const VulkanDevice&) = delete;
    VulkanDevice& operator=(const VulkanDevice&) = delete;
};

} // namespace giga::gpu
