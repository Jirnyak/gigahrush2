// Frame lifecycle: swapchain, offscreen HDR target, depth buffer, render passes,
// post-processing fullscreen triangle pass, framebuffers, and the per-frame sync
// primitives. Owns the double-buffered command recording and the acquire/submit/
// present dance, including resize-driven swapchain recreation.
//
// The renderer executes a two-pass Vulkan pipeline:
// Pass 1 (scene renderPass): renders linear HDR to VK_FORMAT_R16G16B16A16_SFLOAT.
// Pass 2 (postRenderPass): executes fullscreen triangle shader (shaders/post_pass.frag)
// into swapchain image applying CRT curvature, scanlines, chromatic aberration,
// radial vignette, phosphor wash, and dark adaptation exposure modulation.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>
#include <string>
#include <vector>

#include "core/math.h"
#include "render/gpu_timer.h"
#include "render/vk_common.h" // kMaxFramesInFlight

struct SDL_Window;

namespace giga::gpu {

struct VulkanDevice;
struct VulkanSwapchain;

struct PostPush {
    // params0: x = timeSec, y = darkAdaptation (exposure), z = crtEnabled (1.0/0.0), w = chromaticAberration (0.003)
    vec4 params0;
    // params1: x = curvature (0.035), y = scanlineIntensity (0.35), z = vignettePower (0.40), w = phosphorWash (0.04)
    vec4 params1;
    // resolution: x = width, y = height, z = 1.0/width, w = 1.0/height
    vec4 resolution;
};

struct VulkanRenderer {
    // Non-owning; must outlive the renderer.
    VulkanDevice* dev = nullptr;

    // Pass 1: HDR Scene Render Pass & Offscreen Color + Depth Target
    VkRenderPass renderPass = VK_NULL_HANDLE;
    VkFormat hdrFormat = VK_FORMAT_R16G16B16A16_SFLOAT;
    VkImage hdrImage = VK_NULL_HANDLE;
    VkDeviceMemory hdrMemory = VK_NULL_HANDLE;
    VkImageView hdrView = VK_NULL_HANDLE;
    VkSampler hdrSampler = VK_NULL_HANDLE;

    VkFormat depthFormat = VK_FORMAT_D32_SFLOAT;
    VkImage depthImage = VK_NULL_HANDLE;
    VkDeviceMemory depthMemory = VK_NULL_HANDLE;
    VkImageView depthView = VK_NULL_HANDLE;

    // Pass 2: Fullscreen Post-Processing Pass presenting to Swapchain
    VkRenderPass postRenderPass = VK_NULL_HANDLE;
    VkDescriptorSetLayout postSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool postPool_ = VK_NULL_HANDLE;
    VkDescriptorSet postSet_ = VK_NULL_HANDLE;
    VkPipelineLayout postLayout_ = VK_NULL_HANDLE;
    VkPipeline postPipeline_ = VK_NULL_HANDLE;

    // CRT & Post-processing parameters
    float darkAdaptation = 1.0f;
    bool crtEnabled = true;
    float chromaticAberration = 0.003f;
    float crtCurvature = 0.035f;
    float scanlineIntensity = 0.35f;
    float vignettePower = 0.40f;
    float phosphorWash = 0.04f;

    VkCommandPool cmdPool = VK_NULL_HANDLE;
    VkCommandBuffer cmd[kMaxFramesInFlight] = {};

    VkSemaphore imageAvailable[kMaxFramesInFlight] = {};
    VkFence inFlight[kMaxFramesInFlight] = {};
    std::vector<VkSemaphore> renderFinished; // one per swapchain image
    std::vector<VkFence> imagesInFlight;

    std::uint32_t currentFrame = 0;
    std::uint32_t currentImageIndex = 0;
    bool framebufferResized = false;

    // Real per-pass GPU time.
    GpuTimer timer;

    bool init(VulkanDevice& dev, SDL_Window* window, const char* shaderDir = nullptr);
    void destroy();

    // Begins command buffer recording for the frame without starting the render pass.
    bool begin_frame_cmd(SDL_Window* window);
    // Begins the scene render pass with the given clear colour.
    void begin_pass(float r, float g, float b);

    // Begins the frame + render pass with the given clear colour. Returns false
    // if the frame was skipped (e.g. swapchain out of date / minimized).
    bool begin_frame(SDL_Window* window, float r, float g, float b);
    // Closes the render pass, executes post pass, submits, and presents.
    bool end_frame(SDL_Window* window);

    VkCommandBuffer current_cmd() const { return cmd[currentFrame]; }

    // Ask the NEXT end_frame to copy the swapchain image into `dst` before presenting.
    void request_capture(VkBuffer dst) { captureTo_ = dst; captureDone_ = false; }
    bool capture_done() const { return captureDone_; }
    void clear_capture() { captureTo_ = VK_NULL_HANDLE; captureDone_ = false; }

    // Owned swapchain access.
    const VulkanSwapchain& swap() const { return *swapchain_; }
    bool recreate(SDL_Window* window);

    void set_dark_adaptation(float da) { darkAdaptation = da; }
    void set_crt_enabled(bool e) { crtEnabled = e; }
    void set_post_params(float da, bool crt, float ca, float curv, float scan, float vig, float phos) {
        darkAdaptation = da;
        crtEnabled = crt;
        chromaticAberration = ca;
        crtCurvature = curv;
        scanlineIntensity = scan;
        vignettePower = vig;
        phosphorWash = phos;
    }

private:
    VulkanSwapchain* swapchain_ = nullptr;
    VkBuffer captureTo_ = VK_NULL_HANDLE;
    bool captureDone_ = false;
    std::string shaderDir_;
    VkFramebuffer sceneFramebuffer_ = VK_NULL_HANDLE;
    std::vector<VkFramebuffer> postFramebuffers_;

    bool create_scene_render_pass();
    bool create_post_render_pass();
    bool create_hdr_target();
    void destroy_hdr_target();
    bool create_depth();
    void destroy_depth();
    bool create_framebuffers();
    void destroy_framebuffers();
    bool create_post_pipeline();
    void destroy_post_pipeline();
    bool create_commands();
    bool create_frame_sync();
    bool create_present_semaphores();
    void destroy_present_semaphores();
    bool acquire_frame(SDL_Window* window);
    void begin_render_pass(float r, float g, float b);
    void record_post_pass(VkCommandBuffer c);
};

} // namespace giga::gpu
