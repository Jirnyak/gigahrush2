#include "render/imgui_layer.h"

#include "render/vk_common.h"
#include "render/vk_device.h"

#include <SDL3/SDL.h>
#include <filesystem>

#include "imgui.h"
#include "imgui_internal.h"
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
    // VHS / CRT / PS1 retro HUD mandate (Overseer / jirnyak UI law):
    // no sterile modern flat chrome -- phosphor green on near-black, hard
    // corners, thick borders, low alpha so the world bleeds through like CRT.
    {
        ImGuiStyle& st = ImGui::GetStyle();
        st.WindowRounding = 0.0f;
        st.ChildRounding = 0.0f;
        st.FrameRounding = 0.0f;
        st.PopupRounding = 0.0f;
        st.ScrollbarRounding = 0.0f;
        st.GrabRounding = 0.0f;
        st.TabRounding = 0.0f;
        st.WindowBorderSize = 2.0f;
        st.FrameBorderSize = 1.0f;
        st.PopupBorderSize = 1.0f;
        st.WindowPadding = ImVec2(10.0f, 8.0f);
        st.FramePadding = ImVec2(8.0f, 4.0f);
        st.ItemSpacing = ImVec2(8.0f, 4.0f);
        st.ScrollbarSize = 14.0f;
        st.GrabMinSize = 12.0f;
        ImVec4* c = st.Colors;
        const ImVec4 bg{0.02f, 0.04f, 0.02f, 0.88f};
        const ImVec4 panel{0.04f, 0.08f, 0.04f, 0.92f};
        const ImVec4 edge{0.10f, 0.28f, 0.10f, 1.00f};
        const ImVec4 phosphor{0.349f, 0.949f, 0.400f, 1.00f}; // #59F266
        const ImVec4 amber{0.95f, 0.78f, 0.25f, 1.00f};
        const ImVec4 dim{0.20f, 0.45f, 0.22f, 1.00f};
        const ImVec4 text{0.75f, 1.00f, 0.78f, 1.00f};
        c[ImGuiCol_Text] = text;
        c[ImGuiCol_TextDisabled] = dim;
        c[ImGuiCol_WindowBg] = bg;
        c[ImGuiCol_ChildBg] = bg;
        c[ImGuiCol_PopupBg] = panel;
        c[ImGuiCol_Border] = edge;
        c[ImGuiCol_BorderShadow] = ImVec4{0, 0, 0, 0};
        c[ImGuiCol_FrameBg] = panel;
        c[ImGuiCol_FrameBgHovered] = edge;
        c[ImGuiCol_FrameBgActive] = ImVec4{0.12f, 0.35f, 0.12f, 1.00f};
        c[ImGuiCol_TitleBg] = bg;
        c[ImGuiCol_TitleBgActive] = panel;
        c[ImGuiCol_TitleBgCollapsed] = bg;
        c[ImGuiCol_MenuBarBg] = panel;
        c[ImGuiCol_ScrollbarBg] = bg;
        c[ImGuiCol_ScrollbarGrab] = dim;
        c[ImGuiCol_ScrollbarGrabHovered] = phosphor;
        c[ImGuiCol_ScrollbarGrabActive] = amber;
        c[ImGuiCol_CheckMark] = phosphor;
        c[ImGuiCol_SliderGrab] = phosphor;
        c[ImGuiCol_SliderGrabActive] = amber;
        c[ImGuiCol_Button] = panel;
        c[ImGuiCol_ButtonHovered] = edge;
        c[ImGuiCol_ButtonActive] = ImVec4{0.15f, 0.40f, 0.15f, 1.00f};
        c[ImGuiCol_Header] = panel;
        c[ImGuiCol_HeaderHovered] = edge;
        c[ImGuiCol_HeaderActive] = ImVec4{0.15f, 0.40f, 0.15f, 1.00f};
        c[ImGuiCol_Separator] = edge;
        c[ImGuiCol_SeparatorHovered] = phosphor;
        c[ImGuiCol_SeparatorActive] = amber;
        c[ImGuiCol_ResizeGrip] = dim;
        c[ImGuiCol_ResizeGripHovered] = phosphor;
        c[ImGuiCol_ResizeGripActive] = amber;
        c[ImGuiCol_Tab] = panel;
        c[ImGuiCol_TabHovered] = edge;
        c[ImGuiCol_TabActive] = edge;
        c[ImGuiCol_TabUnfocused] = bg;
        c[ImGuiCol_TabUnfocusedActive] = panel;
        c[ImGuiCol_PlotLines] = phosphor;
        c[ImGuiCol_PlotLinesHovered] = amber;
        c[ImGuiCol_PlotHistogram] = phosphor;
        c[ImGuiCol_PlotHistogramHovered] = amber;
        c[ImGuiCol_TableHeaderBg] = panel;
        c[ImGuiCol_TableBorderStrong] = edge;
        c[ImGuiCol_TableBorderLight] = dim;
        c[ImGuiCol_TableRowBg] = ImVec4{0, 0, 0, 0};
        c[ImGuiCol_TableRowBgAlt] = ImVec4{0.05f, 0.10f, 0.05f, 0.40f};
        c[ImGuiCol_TextSelectedBg] = ImVec4{0.20f, 0.55f, 0.22f, 0.55f};
        c[ImGuiCol_DragDropTarget] = amber;
        c[ImGuiCol_NavHighlight] = phosphor;
        c[ImGuiCol_NavWindowingHighlight] = phosphor;
        c[ImGuiCol_NavWindowingDimBg] = ImVec4{0, 0, 0, 0.55f};
        c[ImGuiCol_ModalWindowDimBg] = ImVec4{0, 0, 0, 0.65f};
    }
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr; // no imgui.ini side effects for a debug HUD

    // Cyrillic & Typography. The default ImGui font is ProggyClean, which is
    // ASCII-only, so any Russian string handed to ImGui::Text renders as mojibake.
    // We configure the font atlas with full Cyrillic (0x0400..0x052F), General
    // Punctuation (0x2000..0x206F for em-dashes —, en-dashes –, quotes, ellipsis),
    // and Cyrillic Extended ranges.
    {
        static const ImWchar kCyrillicWithPunctuationRanges[] = {
            0x0020, 0x00FF, // Basic Latin + Latin Supplement
            0x0400, 0x052F, // Cyrillic + Cyrillic Supplement
            0x2000, 0x206F, // General Punctuation (em-dash —, quotes, ellipsis)
            0x2DE0, 0x2DFF, // Cyrillic Extended-A
            0xA640, 0xA69F, // Cyrillic Extended-B
            0
        };
        const char* candidates[] = {
            "C:/Windows/Fonts/consola.ttf",  // monospace suits a debug readout
            "C:/Windows/Fonts/tahoma.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
            "C:/Windows/Fonts/arial.ttf",
            "/System/Library/Fonts/Menlo.ttc",          // macOS
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/Library/Fonts/Arial Unicode.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
            "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
            "/usr/share/fonts/liberation/LiberationMono-Regular.ttf",
        };
        for (const char* path : candidates) {
            if (std::filesystem::exists(path)) {
                if (io.Fonts->AddFontFromFileTTF(path, 15.0f, nullptr, kCyrillicWithPunctuationRanges)) break;
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

void ImGuiLayer::draw_crt_overlay() {
    // Zero CPU AddLine / PrimReserve CRT rasterization.
    // All CRT curvature, scanlines, aberration, vignette, and phosphor wash
    // are executed on the GPU via shaders/post_pass.frag in VulkanRenderer.
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
