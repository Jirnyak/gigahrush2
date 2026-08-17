#include "render/conversation_ui.h"

#include <cstring>

#include "imgui.h"

namespace giga {

namespace {
constexpr ImU32 kPhosphor = IM_COL32(89, 242, 102, 255);
constexpr ImU32 kAmber = IM_COL32(242, 199, 64, 255);
} // namespace

ConvUiRequest conversation_ui_draw(ConvUiState& st, const char* header,
                                   const char* line,
                                   const game::ConvOption* options,
                                   std::size_t n) {
    ConvUiRequest req;
    if (!options || n == 0) {
        req.wantClose = true;
        return req;
    }
    if (st.sel >= static_cast<int>(n)) st.sel = static_cast<int>(n) - 1;
    if (st.sel < 0) st.sel = 0;

    const ImGuiViewport* vp = ImGui::GetMainViewport();
    const float winW = 420.0f;
    const float winH = 120.0f + 24.0f * static_cast<float>(n);
    ImGui::SetNextWindowPos(ImVec2(vp->WorkPos.x + (vp->WorkSize.x - winW) * 0.5f,
                                   vp->WorkPos.y + (vp->WorkSize.y - winH) * 0.6f),
                            ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(winW, winH), ImGuiCond_Always);
    ImGui::Begin("##conversation", nullptr,
                 ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                     ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar |
                     ImGuiWindowFlags_NoTitleBar);

    ImGui::TextColored(ImGui::ColorConvertU32ToFloat4(kPhosphor), "%s",
                       header ? header : "");
    ImGui::Separator();

    // Последняя реплика — то, что собеседник только что сказал.
    if (line && line[0]) {
        ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + winW - 24.0f);
        ImGui::TextUnformatted(line);
        ImGui::PopTextWrapPos();
    } else {
        ImGui::TextDisabled("(молчит)");
    }
    ImGui::Separator();

    // Опции: стрелки + Enter, мышь — клик. Маркер «!» красится амбером —
    // он уже в ярлыке (game-слой решил), тут только цвет.
    if (ImGui::IsKeyPressed(ImGuiKey_UpArrow) && st.sel > 0) --st.sel;
    if (ImGui::IsKeyPressed(ImGuiKey_DownArrow) &&
        st.sel + 1 < static_cast<int>(n))
        ++st.sel;
    for (std::size_t i = 0; i < n; ++i) {
        const bool selected = static_cast<int>(i) == st.sel;
        const bool marked = std::strchr(options[i].label, '!') != nullptr;
        if (marked)
            ImGui::PushStyleColor(ImGuiCol_Text,
                                  ImGui::ColorConvertU32ToFloat4(kAmber));
        if (ImGui::Selectable(options[i].label, selected)) {
            st.sel = static_cast<int>(i);
            req.optionId = options[i].id;
        }
        if (marked) ImGui::PopStyleColor();
    }
    if (ImGui::IsKeyPressed(ImGuiKey_Enter, false))
        req.optionId = options[st.sel].id;
    if (ImGui::IsKeyPressed(ImGuiKey_Escape, false)) req.wantClose = true;

    ImGui::TextDisabled("стрелки | Enter | Esc");
    ImGui::End();
    return req;
}

} // namespace giga
