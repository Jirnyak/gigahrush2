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

#include "render/gpu_timer.h"
#include "render/vk_common.h" // kMaxFramesInFlight

struct SDL_Window;

namespace giga::gpu {

struct VulkanDevice;
struct VulkanSwapchain;

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

    // Real per-pass GPU time. The renderer owns it because both ends of it are
    // frame-lifecycle events with hard placement rules: the query-pool reset must
    // be recorded before the render pass opens, and the readback must sit exactly
    // on the fence wait that recycles this slot's command buffer. Callers only
    // bracket their own draws with timer.pass_begin/pass_end. See gpu_timer.h.
    GpuTimer timer;

    bool init(VulkanDevice& dev, SDL_Window* window);
    void destroy();

    // Begins command buffer recording for the frame without starting the render pass.
    bool begin_frame_cmd(SDL_Window* window);
    // Begins the render pass with the given clear colour.
    void begin_pass(float r, float g, float b);

    // Begins the frame + render pass with the given clear colour. Returns false
    // if the frame was skipped (e.g. swapchain out of date / minimized).
    bool begin_frame(SDL_Window* window, float r, float g, float b);
    // Closes the render pass, submits, and presents.
    bool end_frame(SDL_Window* window);

    VkCommandBuffer current_cmd() const { return cmd[currentFrame]; }

    // Ask the NEXT end_frame to copy the swapchain image into `dst` before presenting.
    //
    // **This exists because reading the image AFTER present is illegal.** The spec says
    // use of a presentable image may occur only after it is returned by
    // vkAcquireNextImageKHR, and vkQueuePresentKHR hands it back to the presentation
    // engine. The first screenshot path copied it after present: correct output on this
    // NVIDIA driver, undefined everywhere else, and MoltenVK — the owner's machine — is
    // exactly where it would surface. Found by a validation-layer run, not by a crash.
    //
    // Recorded into the SAME command buffer as the draws, immediately after
    // vkCmdEndRenderPass, which is the only window in which the image is ours.
    void request_capture(VkBuffer dst) { captureTo_ = dst; captureDone_ = false; }
    bool capture_done() const { return captureDone_; }
    void clear_capture() { captureTo_ = VK_NULL_HANDLE; captureDone_ = false; }

    // Owned swapchain access for the cube pass (viewport, extent, format).
    const VulkanSwapchain& swap() const { return *swapchain_; }
    bool recreate(SDL_Window* window);

private:
    VulkanSwapchain* swapchain_ = nullptr;
    VkBuffer captureTo_ = VK_NULL_HANDLE;
    bool captureDone_ = false;
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
