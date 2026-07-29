#include "render/imgui_layer.h"

#include "render/vk_common.h"
#include "render/vk_device.h"

#include <SDL3/SDL.h>
#include <filesystem>

#include "imgui.h"
#include "imgui_impl_sdl3.h"
#include "imgui_impl_vulkan.h"

namespace giga::gpu {

bool ImGuiLayer::init(VulkanDevice& dev, SDL_Window* window,
                      VkRenderPass renderPass, std::uint32_t imageCount) {
    dev_ = &dev;

    // The ImGui Vulkan backend allocates its font texture + per-frame descriptor
    // sets from a pool it does not own; give it a generous combined-image-sampler
    // pool.
    VkDescriptorPoolSize sizes[] = {
        {VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 64},
    };
    VkDescriptorPoolCreateInfo pci{};
    pci.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO;
    pci.flags = VK_DESCRIPTOR_POOL_CREATE_FREE_DESCRIPTOR_SET_BIT;
    pci.maxSets = 64;
    pci.poolSizeCount = 1;
    pci.pPoolSizes = sizes;
    VK_TRY(vkCreateDescriptorPool(dev.device, &pci, nullptr, &pool_));

    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGui::StyleColorsDark();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr; // no imgui.ini side effects for a debug HUD

    // Cyrillic. The default ImGui font is ProggyClean, which is ASCII-only, so any
    // Russian string handed to ImGui::Text renders as mojibake — and the HUD now
    // prints item and monster names straight out of the content tables, all of
    // which are Russian. This was a live defect: the weapon/armour line was showing
    // garbage rather than "Арматура".
    //
    // A system font is loaded rather than a vendored one so no font binary lands in
    // the repository. If it is missing the default font is kept: a HUD in mojibake
    // is worse than one in ASCII, but neither is worth failing to boot over, and
    // ImGui falls back on its own if AddFontFromFileTTF returns null.
    {
        static const ImWchar* cyr = io.Fonts->GetGlyphRangesCyrillic();
        const char* candidates[] = {
            "C:/Windows/Fonts/consola.ttf",  // monospace suits a debug readout
            "C:/Windows/Fonts/tahoma.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
            "/System/Library/Fonts/Menlo.ttc",          // macOS
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        };
        for (const char* path : candidates) {
            if (std::filesystem::exists(path)) {
                if (io.Fonts->AddFontFromFileTTF(path, 15.0f, nullptr, cyr)) break;
            }
        }
    }

    if (!ImGui_ImplSDL3_InitForVulkan(window)) return false;

    ImGui_ImplVulkan_InitInfo info{};
    info.Instance = dev.instance;
    info.PhysicalDevice = dev.physical;
    info.Device = dev.device;
    info.QueueFamily = dev.families.graphics;
    info.Queue = dev.graphicsQueue;
    info.DescriptorPool = pool_;
    info.RenderPass = renderPass;
    info.MinImageCount = imageCount < 2 ? 2 : imageCount;
    info.ImageCount = imageCount < 2 ? 2 : imageCount;
    info.MSAASamples = VK_SAMPLE_COUNT_1_BIT;
    if (!ImGui_ImplVulkan_Init(&info)) return false;

    ready_ = true;
    return true;
}

bool ImGuiLayer::process_event(const SDL_Event& e) {
    return ImGui_ImplSDL3_ProcessEvent(&e);
}

void ImGuiLayer::begin_frame() {
    if (!ready_) return;
    ImGui_ImplVulkan_NewFrame();
    ImGui_ImplSDL3_NewFrame();
    ImGui::NewFrame();
}

void ImGuiLayer::render(VkCommandBuffer cmd) {
    if (!ready_) return;
    ImGui::Render();
    ImGui_ImplVulkan_RenderDrawData(ImGui::GetDrawData(), cmd);
}

void ImGuiLayer::destroy() {
    if (!dev_) return;
    if (ready_) {
        vkDeviceWaitIdle(dev_->device);
        ImGui_ImplVulkan_Shutdown();
        ImGui_ImplSDL3_Shutdown();
        ImGui::DestroyContext();
        ready_ = false;
    }
    if (pool_) {
        vkDestroyDescriptorPool(dev_->device, pool_, nullptr);
        pool_ = VK_NULL_HANDLE;
    }
}

} // namespace giga::gpu
