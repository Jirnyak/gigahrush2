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

void ImGuiLayer::draw_crt_overlay() {
    if (!ready_) return;
    ImGuiIO& io = ImGui::GetIO();
    const float w = io.DisplaySize.x;
    const float h = io.DisplaySize.y;
    if (w <= 0.0f || h <= 0.0f) return;

    ImGui::SetNextWindowPos(ImVec2(0.0f, 0.0f));
    ImGui::SetNextWindowSize(ImVec2(w, h));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::Begin("CRT_Overlay", nullptr,
                 ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoInputs |
                 ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoFocusOnAppearing |
                 ImGuiWindowFlags_NoBringToFrontOnFocus);

    ImDrawList* draw = ImGui::GetWindowDrawList();

    // --- Phosphor wash: faint green tint across the whole display, so the
    // 3D world bleeds through the HUD like it is being viewed through a CRT
    // screen (low alpha phosphor residue). (#59F266 @ ~4% alpha.)
    draw->AddRectFilled(ImVec2(0.0f, 0.0f), ImVec2(w, h),
                        IM_COL32(89, 242, 102, 10));

    // --- CRT scanlines: alternating dark bands at 3px period. Two passes so
    // the lines read as hardware geometry rather than a flat stripe: a thin
    // opaque black line on each 3px boundary, plus a softer half-tone under it.
    for (float y = 0.0f; y < h; y += 3.0f) {
        // Primary scanline: the "blanking" row of the raster.
        draw->AddLine(ImVec2(0.0f, y), ImVec2(w, y), IM_COL32(0, 0, 0, 110));
        // Secondary row: half-intensity, half-pixel offset below the primary,
        // giving the raster its vertical texture instead of isolated lines.
        if (y + 1.0f < h)
            draw->AddLine(ImVec2(0.0f, y + 1.0f), ImVec2(w, y + 1.0f),
                          IM_COL32(0, 0, 0, 45));
    }

    // --- Rare CRT tracking-roll glitch (taste.md: rare glitches make the
    // service UI alive as long as reading is not hindered). A horizontal band
    // of darker scanlines rolls down the screen occasionally. It is rare
    // (seconds apart), subtle (low alpha), and confined to the overlay, so
    // the 3D world and text stay readable.
    const std::uint64_t nowMs = SDL_GetTicks();
    if (glitchStartMs_ != 0) {
        // Active glitch: roll the band down over its duration.
        const std::uint64_t elapsed = nowMs - glitchStartMs_;
        if (elapsed >= glitchDurMs_) {
            glitchStartMs_ = 0; // glitch done
        } else {
            const float progress = static_cast<float>(elapsed) /
                                  static_cast<float>(glitchDurMs_);
            const float bandTop = progress * (h + glitchBandH_) - glitchBandH_;
            // Darker scanlines inside the band + a faint roll shimmer (reads
            // as a tracking tear without corrupting any glyph).
            draw->AddRectFilled(ImVec2(0.0f, bandTop),
                                ImVec2(w, bandTop + glitchBandH_),
                                IM_COL32(0, 0, 0, 95));
            for (float y = bandTop; y < bandTop + glitchBandH_; y += 3.0f) {
                if (y < 0.0f || y >= h) continue;
                draw->AddLine(ImVec2(0.0f, y), ImVec2(w, y),
                              IM_COL32(89, 242, 102, 40));
            }
        }
    } else if (nowMs >= glitchNextMs_) {
        if (glitchNextMs_ == 0) {
            // First-ever trigger: do not roll a band on the boot frame;
            // schedule the first glitch a couple seconds out instead so the
            // effect is genuinely rare from the very start.
            const std::uint64_t t = nowMs;
            glitchNextMs_ = nowMs + 2500u + (t / 397u) % 4000u; // 2.5..6.5 s
        } else {
            // Start a new glitch. Derive band height and duration deterministically
            // from the trigger time so the pattern is reproducible (no RNG state).
            const std::uint64_t t = nowMs;
            glitchBandH_ = 6.0f + static_cast<float>((t / 997u) % 9); // 6..14 px
            glitchDurMs_ = 70u + (t / 571u) % 80u;                    // 70..149 ms
            glitchStartMs_ = nowMs;
            glitchNextMs_ = nowMs + 4000u + (t / 397u) % 6000u;       // 4..10 s
        }
    }

    // --- Vignette: the CRT tube darkens toward the corners (screen curvature
    // is too expensive a shader to fake here, but a radial falloff reads as
    // "tube" and kills the flat-panel look the mandate forbids). Drawn as four
    // overlapping gradient quads so the falloff is smooth, not a hard band.
    constexpr std::uint32_t kVig = 60u;
    draw->AddRectFilledMultiColor(ImVec2(0.0f, 0.0f), ImVec2(w * 0.5f, h * 0.5f),
                                  IM_COL32(0, 0, 0, kVig), IM_COL32(0, 0, 0, 0),
                                  IM_COL32(0, 0, 0, 0), IM_COL32(0, 0, 0, kVig));
    draw->AddRectFilledMultiColor(ImVec2(w * 0.5f, 0.0f), ImVec2(w, h * 0.5f),
                                  IM_COL32(0, 0, 0, 0), IM_COL32(0, 0, 0, kVig),
                                  IM_COL32(0, 0, 0, kVig), IM_COL32(0, 0, 0, 0));
    draw->AddRectFilledMultiColor(ImVec2(0.0f, h * 0.5f), ImVec2(w * 0.5f, h),
                                  IM_COL32(0, 0, 0, kVig), IM_COL32(0, 0, 0, 0),
                                  IM_COL32(0, 0, 0, 0), IM_COL32(0, 0, 0, kVig));
    draw->AddRectFilledMultiColor(ImVec2(w * 0.5f, h * 0.5f), ImVec2(w, h),
                                  IM_COL32(0, 0, 0, 0), IM_COL32(0, 0, 0, kVig),
                                  IM_COL32(0, 0, 0, kVig), IM_COL32(0, 0, 0, 0));

    ImGui::End();
    ImGui::PopStyleVar(2);
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
