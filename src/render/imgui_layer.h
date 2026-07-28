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
    // Records ImGui draw data into the (already-open) render pass command buffer.
    void render(VkCommandBuffer cmd);

private:
    VulkanDevice* dev_ = nullptr;
    VkDescriptorPool pool_ = VK_NULL_HANDLE;
    bool ready_ = false;
};

} // namespace giga::gpu
