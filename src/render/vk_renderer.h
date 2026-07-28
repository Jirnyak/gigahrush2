// Frame lifecycle: swapchain, depth buffer, render pass, framebuffers, and the
// per-frame sync primitives. Owns the double-buffered command recording and the
// acquire/submit/present dance, including resize-driven swapchain recreation.
//
// The renderer itself is draw-agnostic: begin_frame() opens the render pass and
// hands back the active command buffer; callers (the cube pass, the ImGui pass)
// record into it; end_frame() closes and presents.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>
#include <vector>

struct SDL_Window;

namespace giga::gpu {

struct VulkanDevice;
struct VulkanSwapchain;

inline constexpr int kMaxFramesInFlight = 2;

struct VulkanRenderer {
    // Non-owning; must outlive the renderer.
    VulkanDevice* dev = nullptr;

    VkRenderPass renderPass = VK_NULL_HANDLE;
    VkFormat depthFormat = VK_FORMAT_D32_SFLOAT;
    VkImage depthImage = VK_NULL_HANDLE;
    VkDeviceMemory depthMemory = VK_NULL_HANDLE;
    VkImageView depthView = VK_NULL_HANDLE;

    VkCommandPool cmdPool = VK_NULL_HANDLE;
    VkCommandBuffer cmd[kMaxFramesInFlight] = {};

    VkSemaphore imageAvailable[kMaxFramesInFlight] = {};
    VkFence inFlight[kMaxFramesInFlight] = {};
    std::vector<VkSemaphore> renderFinished; // one per swapchain image
    std::vector<VkFence> imagesInFlight;

    std::uint32_t currentFrame = 0;
    std::uint32_t currentImageIndex = 0;
    bool framebufferResized = false;

    bool init(VulkanDevice& dev, SDL_Window* window);
    void destroy();

    // Begins the frame + render pass with the given clear colour. Returns false
    // if the frame was skipped (e.g. swapchain out of date / minimized).
    bool begin_frame(SDL_Window* window, float r, float g, float b);
    // Closes the render pass, submits, and presents.
    bool end_frame(SDL_Window* window);

    VkCommandBuffer current_cmd() const { return cmd[currentFrame]; }

    // Owned swapchain access for the cube pass (viewport, extent, format).
    const VulkanSwapchain& swap() const { return *swapchain_; }
    bool recreate(SDL_Window* window);

private:
    VulkanSwapchain* swapchain_ = nullptr;
    std::vector<VkFramebuffer> framebuffers_;

    bool create_render_pass();
    bool create_depth();
    void destroy_depth();
    bool create_framebuffers();
    void destroy_framebuffers();
    bool create_commands();
    bool create_frame_sync();
    bool create_present_semaphores();
    void destroy_present_semaphores();
    bool acquire_frame(SDL_Window* window);
    void begin_render_pass(float r, float g, float b);
};

} // namespace giga::gpu
