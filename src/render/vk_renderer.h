// Frame lifecycle: swapchain, offscreen HDR scene target, depth buffer, the two
// render passes, framebuffers, and the per-frame sync primitives. Owns the
// double-buffered command recording and the acquire/submit/present dance,
// including resize-driven swapchain recreation.
//
// Кадр — ДВА паса (порт форка 16004b86 с двумя правками, см. ниже):
//   1. Сценовый пас: мир/тела/пропсы рисуют в оффскрин HDR-таргет
//      (R16G16B16A16F). begin_pass() открывает его.
//   2. Пост-пас: полноэкранный треугольник (post_pass.frag) семплит HDR-таргет
//      в свопчейн — CRT-кривизна, скан-линии, хроматика, виньетка, фосфорный
//      налёт, CRT-оверлей (экспозиция адаптации вырезана 2026-08-17). begin_post_pass() закрывает сцену и
//      открывает его; ImGui пишет ПОСЛЕ треугольника, ПОВЕРХ обработки.
//
// Правка 1 — UI вне трубки: у форка ImGui жил в сценовом пасе, и весь
// интерфейс гнуло кривизной и глушило адаптацией. Пиксельная заставка, сетка
// инвентаря и HUD обязаны быть резкими: UI — это НЕ то, что видит герой через
// люминофор, это то, что видит игрок. Поэтому begin_post_pass() зовётся ДО
// hud.render(), и весь ImGui ложится в свопчейн нетронутым.
//
// Правка 2 — гонка write-after-read: единственный HDR-таргет читается
// пост-пасом кадра N фрагмент-шейдером, а кадр N+1 начинает писать в него же;
// у форка external-зависимость сценового паса ждала только COLOR_ATTACHMENT,
// чтение же происходит в FRAGMENT_SHADER — кадры в полёте могли наложиться.
// Дублировать таргет не нужно: достаточно FRAGMENT_SHADER в srcStageMask
// external-зависимости (WAR-хазард закрывается execution-зависимостью).
//
// The renderer itself is draw-agnostic: begin_frame() opens the scene pass and
// hands back the active command buffer; callers record into it.
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

    VkRenderPass renderPass = VK_NULL_HANDLE; // сценовый пас (HDR-таргет)
    VkFormat depthFormat = VK_FORMAT_D32_SFLOAT;
    VkImage depthImage = VK_NULL_HANDLE;
    VkDeviceMemory depthMemory = VK_NULL_HANDLE;
    VkImageView depthView = VK_NULL_HANDLE;

    // Оффскрин HDR-таргет сцены — вход пост-паса.
    VkFormat hdrFormat = VK_FORMAT_R16G16B16A16_SFLOAT;
    VkImage hdrImage = VK_NULL_HANDLE;
    VkDeviceMemory hdrMemory = VK_NULL_HANDLE;
    VkImageView hdrView = VK_NULL_HANDLE;
    VkSampler hdrSampler = VK_NULL_HANDLE;

    // Пост-пас: свопчейн-таргет, полноэкранный треугольник + ImGui поверх.
    VkRenderPass postRenderPass = VK_NULL_HANDLE;

    // Ручки пост-обработки; main выставляет их до begin_post_pass().
    // Характер трубки. crtEnabled=false (--no-crt) даёт сырой кадр.
    // Экспозиции здесь НЕТ: «тёмная адаптация» вырезана ([ddalight.md] №10).
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

    // Real per-pass GPU time. The renderer owns it because both ends of it are
    // frame-lifecycle events with hard placement rules: the query-pool reset must
    // be recorded before the render pass opens, and the readback must sit exactly
    // on the fence wait that recycles this slot's command buffer. Callers only
    // bracket their own draws with timer.pass_begin/pass_end. See gpu_timer.h.
    GpuTimer timer;

    bool init(VulkanDevice& dev, SDL_Window* window, const char* shaderDir);
    void destroy();

    // Begins command buffer recording for the frame without starting the render pass.
    bool begin_frame_cmd(SDL_Window* window);
    // Begins the scene render pass with the given clear colour.
    void begin_pass(float r, float g, float b);

    // Begins the frame + scene pass with the given clear colour. Returns false
    // if the frame was skipped (e.g. swapchain out of date / minimized).
    bool begin_frame(SDL_Window* window, float r, float g, float b);

    // Закрывает сценовый пас, открывает пост-пас и рисует CRT-треугольник.
    // Пас остаётся ОТКРЫТЫМ: всё, что запишется дальше (ImGui), ложится в
    // свопчейн поверх обработки — резкое, без кривизны и экспозиции.
    void begin_post_pass();

    // Closes the post pass, submits, and presents.
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
    VkFramebuffer sceneFramebuffer_ = VK_NULL_HANDLE; // hdrView + depthView
    std::vector<VkFramebuffer> postFramebuffers_;     // по свопчейн-имиджу

    VkDescriptorSetLayout postSetLayout_ = VK_NULL_HANDLE;
    VkDescriptorPool postPool_ = VK_NULL_HANDLE;
    VkDescriptorSet postSet_ = VK_NULL_HANDLE;
    VkPipelineLayout postLayout_ = VK_NULL_HANDLE;
    VkPipeline postPipeline_ = VK_NULL_HANDLE;

    bool create_render_pass();
    bool create_post_render_pass();
    bool create_hdr_target();
    void destroy_hdr_target();
    bool create_depth();
    void destroy_depth();
    bool create_framebuffers();
    void destroy_framebuffers();
    bool create_post_descriptors();
    void write_post_descriptor();
    bool create_post_pipeline(const char* shaderDir);
    bool create_commands();
    bool create_frame_sync();
    bool create_present_semaphores();
    void destroy_present_semaphores();
    bool acquire_frame(SDL_Window* window);
    void begin_render_pass(float r, float g, float b);
};

} // namespace giga::gpu
