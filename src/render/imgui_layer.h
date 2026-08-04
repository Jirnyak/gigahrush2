// Dear ImGui overlay: SDL3 + Vulkan backends wired to the engine's render pass.
//
// Provides a debug HUD (frame time, camera, world/fluid stats) rendered on top
// of the cube pass inside the same render pass. Owns its own descriptor pool as
// the ImGui Vulkan backend requires.
#pragma once

#include <vulkan/vulkan.h>

#include <cstdint>

struct SDL_Window;
union SDL_Event;

namespace giga::gpu {

struct VulkanDevice;

class ImGuiLayer {
public:
    bool init(VulkanDevice& dev, SDL_Window* window, VkRenderPass renderPass,
              std::uint32_t imageCount);
    void destroy();

    // Feed OS events (returns true if ImGui consumed the event, e.g. a click on
    // the HUD — the app uses this to suppress mouselook while over the UI).
    bool process_event(const SDL_Event& e);

    void begin_frame();
    void draw_crt_overlay();
    // Records ImGui draw data into the (already-open) render pass command buffer.
    void render(VkCommandBuffer cmd);

private:
    VulkanDevice* dev_ = nullptr;
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    bool ready_ = false;

    // Rare CRT tracking-roll glitch state (taste.md: rare glitches make the
    // service UI alive as long as reading is not hindered). A glitch is a brief
    // horizontal band of darker scanlines that rolls down the screen: subtle
    // (low alpha), rare (seconds apart), and never touches the 3D world.
    std::uint64_t glitchNextMs_ = 0;   // next allowed trigger (SDL ticks)
    std::uint64_t glitchStartMs_ = 0;  // current glitch start; 0 = no active glitch
    std::uint64_t glitchDurMs_ = 0;    // current glitch duration (ms)
    float glitchBandH_ = 10.0f;        // current band height (px)
};

} // namespace giga::gpu
