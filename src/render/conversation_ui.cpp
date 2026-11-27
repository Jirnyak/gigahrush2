#include "render/conversation_ui.h"

#include <cstdio>
#include <cstring>

#include "imgui.h"

namespace giga {

namespace {
// Единая палитра CRT-аппаратуры ([AGENTS.md], [hud_ui.cpp]): фосфор, янтарь,
// красный опасности, приглушённый фосфор для подсказок.
constexpr ImVec4 kPhosphor{0.349f, 0.949f, 0.400f, 1.0f}; // #59F266
constexpr ImVec4 kAmber{0.949f, 0.780f, 0.251f, 1.0f};    // #F2C740
constexpr ImVec4 kDanger{0.902f, 0.310f, 0.361f, 1.0f};
constexpr ImVec4 kDim{0.349f, 0.949f, 0.400f, 0.55f};

bool crt_button(const char* label, const ImVec4& accent,
                const ImVec2& size = ImVec2(0.0f, 0.0f)) {
    ImGui::PushStyleColor(ImGuiCol_Border, accent);
    ImGui::PushStyleColor(ImGuiCol_Text, accent);
    const bool pressed = ImGui::Button(label, size);
    ImGui::PopStyleColor(2);
    return pressed;
}
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
    const float winW = 460.0f;
    ImGui::SetNextWindowPos(ImVec2(vp->WorkPos.x + vp->WorkSize.x * 0.5f,
                                   vp->WorkPos.y + vp->WorkSize.y * 0.6f),
                            ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(winW, 0.0f), ImGuiCond_Always);
    ImGui::Begin("##conversation", nullptr,
                 ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                     ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_AlwaysAutoResize |
                     ImGuiWindowFlags_NoTitleBar);

    ImGui::TextColored(kPhosphor, "%s", header ? header : "");
    ImGui::Separator();

    // Последняя реплика — то, что собеседник только что сказал.
    if (line && line[0]) {
        ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + winW - 24.0f);
        ImGui::TextColored(kPhosphor, "%s", line);
        ImGui::PopTextWrapPos();
    } else {
        ImGui::TextColored(kDim, "(молчит)");
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
        ImGui::PushStyleColor(ImGuiCol_Text, marked ? kAmber : kPhosphor);
        if (ImGui::Selectable(options[i].label, selected)) {
            st.sel = static_cast<int>(i);
            req.optionId = options[i].id;
        }
        ImGui::PopStyleColor();
    }
    if (ImGui::IsKeyPressed(ImGuiKey_Enter, false))
        req.optionId = options[st.sel].id;
    if (ImGui::IsKeyPressed(ImGuiKey_Escape, false)) req.wantClose = true;

    ImGui::TextColored(kDim, "стрелки | Enter | Esc");
    ImGui::End();
    return req;
}

DiceUiRequest dice_ui_draw(const game::DiceGame& g, const char* header) {
    DiceUiRequest req;
    const ImGuiViewport* vp = ImGui::GetMainViewport();
    const float winW = 440.0f;
    const float winH = 240.0f;
    ImGui::SetNextWindowPos(ImVec2(vp->WorkPos.x + (vp->WorkSize.x - winW) * 0.5f,
                                   vp->WorkPos.y + (vp->WorkSize.y - winH) * 0.6f),
                            ImGuiCond_Always);
    ImGui::SetNextWindowSize(ImVec2(winW, winH), ImGuiCond_Always);
    ImGui::Begin("##dice", nullptr,
                 ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                     ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar |
                     ImGuiWindowFlags_NoTitleBar);

    ImGui::TextColored(kAmber, "КОСТИ | СТАВКА %d РУБ | ЦЕЛЬ ДО %d",
                       g.stake, game::kDiceTarget);
    ImGui::Separator();

    // Два борта: счёт красится по единой CRT-палитре — перебор тревожный, 21 амбер.
    auto scoreCol = [](std::int32_t sc) {
        if (sc > game::kDiceTarget) return kDanger;
        if (sc == game::kDiceTarget) return kAmber;
        return kPhosphor;
    };
    ImGui::TextColored(scoreCol(g.playerScore), "ТЫ: %d", g.playerScore);
    if (g.playerRolls > 0)
        ImGui::TextColored(kDim, "  %u бр. | последний: %u+%u=%u", g.playerRolls,
                           g.lastA, g.lastB,
                           static_cast<unsigned>(g.lastA + g.lastB));
    ImGui::TextColored(scoreCol(g.npcScore), "%s: %d",
                       header ? header : "ОН", g.npcScore);
    if (g.npcRolls > 0)
        ImGui::TextColored(kDim, "  %u бр. | последний: %u+%u=%u", g.npcRolls,
                           g.npcLastA, g.npcLastB,
                           static_cast<unsigned>(g.npcLastA + g.npcLastB));
    ImGui::Separator();

    if (g.phase == game::DicePhase::Finished) {
        switch (g.winner) {
            case game::DiceWinner::Player:
                ImGui::TextColored(kAmber, "ТВОЯ ВЗЯЛА: +%d руб", g.paid);
                break;
            case game::DiceWinner::Npc:
                ImGui::TextColored(kDanger, "ПРОДУЛ: -%d руб", g.paid);
                break;
            default:
                ImGui::TextColored(kPhosphor,
                                   "НИЧЬЯ. Деньги остаются в карманах.");
                break;
        }
        ImGui::TextColored(kDim, "Enter/Esc — от стола");
        if (ImGui::IsKeyPressed(ImGuiKey_Enter, false) ||
            ImGui::IsKeyPressed(ImGuiKey_Escape, false))
            req.close = true;
    } else {
        ImGui::TextColored(kDim,
                           "Enter БРОСИТЬ | T СТОП | Esc СДАТЬСЯ (ставка уйдёт)");
        if (ImGui::IsKeyPressed(ImGuiKey_Enter, false)) req.roll = true;
        if (ImGui::IsKeyPressed(ImGuiKey_T, false)) req.hold = true;
        if (ImGui::IsKeyPressed(ImGuiKey_Escape, false)) req.surrender = true;
    }
    ImGui::End();
    return req;
}

TellerUiRequest teller_ui_draw(std::int64_t banked, std::int64_t cash,
                               const char* header) {
    TellerUiRequest req;
    const ImGuiViewport* vp = ImGui::GetMainViewport();
    const float winW = 480.0f;
    ImGui::SetNextWindowPos(ImVec2(vp->WorkPos.x + vp->WorkSize.x * 0.5f,
                                   vp->WorkPos.y + vp->WorkSize.y * 0.6f),
                            ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(winW, 0.0f), ImGuiCond_Always);
    ImGui::Begin("##teller", nullptr,
                 ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                     ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_AlwaysAutoResize |
                     ImGuiWindowFlags_NoTitleBar);
    ImGui::TextColored(kAmber, "КАССА | %s", header ? header : "");
    ImGui::Separator();
    ImGui::TextColored(kPhosphor, "СЧЁТ:    %lld руб",
                       static_cast<long long>(banked));
    ImGui::TextColored(kPhosphor, "НАЛИЧКА: %lld руб",
                       static_cast<long long>(cash));
    ImGui::Separator();

    ImGui::BeginDisabled(cash <= 0);
    if (crt_button("Внести всё [Enter]", kPhosphor)) req.depositAll = true;
    ImGui::EndDisabled();
    ImGui::SameLine();
    if (crt_button("Уйти [Esc]", kDim)) req.close = true;

    ImGui::Spacing();
    ImGui::TextColored(kDim, "Снять наличкой:");
    ImGui::BeginDisabled(banked <= 0);
    struct Preset {
        const char* label;
        std::int32_t amount;
    };
    const std::int32_t allAmount =
        banked <= 0 ? 0
        : (banked > 2147483647LL ? 2147483647
                                 : static_cast<std::int32_t>(banked));
    const Preset kPresets[] = {
        {"100", 100},
        {"500", 500},
        {"1000 [T]", 1000},
        {"Всё", allAmount},
    };
    for (std::size_t i = 0; i < sizeof(kPresets) / sizeof(kPresets[0]); ++i) {
        if (i > 0) ImGui::SameLine();
        char btnId[32];
        std::snprintf(btnId, sizeof btnId, "%s##wd_%zu", kPresets[i].label, i);
        if (crt_button(btnId, kAmber)) {
            req.withdraw = true;
            req.withdrawAmount = kPresets[i].amount;
        }
    }
    ImGui::EndDisabled();

    ImGui::Separator();
    ImGui::TextColored(kDim, "Enter внести всё | T снять 1000 | Esc уйти");
    if (ImGui::IsKeyPressed(ImGuiKey_Enter, false)) req.depositAll = true;
    if (ImGui::IsKeyPressed(ImGuiKey_T, false)) {
        req.withdraw = true;
        req.withdrawAmount = 1000;
    }
    if (ImGui::IsKeyPressed(ImGuiKey_Escape, false)) req.close = true;
    ImGui::End();
    return req;
}

} // namespace giga
