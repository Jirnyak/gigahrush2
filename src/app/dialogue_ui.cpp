// Rich interactive NPC Dialogue Window implementation for GigaHrush 2.
#include "app/dialogue_ui.h"

#include <cstdio>
#include "imgui.h"
#include "game/dialogue.h"
#include "game/faction.h"
#include "game/speech.h"

namespace giga {

void draw_dialogue_window_ui(DialogueSession& session, DialogueAction& outAction) {
    outAction = DialogueAction::None;
    if (!session.active) return;

    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.72f),
                           ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(820.0f, 350.0f), ImGuiCond_Always);

    ImGui::Begin("ДИАЛОГ С ВЫЖИВШИМ / DIALOGUE##dialogue_window", nullptr,
                 ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoMove |
                 ImGuiWindowFlags_NoSavedSettings);

    // 1. Header: Speaker Badge, Faction, Attitude, Situation, Vitality
    const vec3 fc = game::faction_color(static_cast<std::uint16_t>(session.faction),
                                       static_cast<std::uint32_t>(session.speaker));
    const char* fName = game::faction_name(session.faction);
    const char* sitName = game::speech_situation_name(session.situation);
    const char* attName = game::dialogue_attitude_name(session.attitude);

    ImVec4 attColor = ImVec4(0.85f, 0.85f, 0.85f, 1.0f);
    switch (session.attitude) {
        case game::DialogueAttitude::HeroVeneration: attColor = ImVec4(0.98f, 0.85f, 0.30f, 1.0f); break;
        case game::DialogueAttitude::Friendly:       attColor = ImVec4(0.40f, 0.95f, 0.45f, 1.0f); break;
        case game::DialogueAttitude::Neutral:        attColor = ImVec4(0.80f, 0.80f, 0.80f, 1.0f); break;
        case game::DialogueAttitude::Wary:           attColor = ImVec4(0.95f, 0.75f, 0.25f, 1.0f); break;
        case game::DialogueAttitude::Hostile:
        case game::DialogueAttitude::AtrocityVengeful:
        case game::DialogueAttitude::AtrocityTerror: attColor = ImVec4(0.95f, 0.30f, 0.30f, 1.0f); break;
        case game::DialogueAttitude::WarAnxious:      attColor = ImVec4(0.95f, 0.80f, 0.35f, 1.0f); break;
        default: break;
    }

    ImGui::TextColored(ImVec4(fc.x, fc.y, fc.z, 1.0f), "[%s]", fName);
    ImGui::SameLine();
    ImGui::TextColored(ImVec4(1.0f, 1.0f, 1.0f, 1.0f), "%s", session.speakerName[0] ? session.speakerName : "Выживший гражданин");
    ImGui::SameLine();
    ImGui::TextColored(attColor, "| [%s]", attName);
    ImGui::SameLine();
    ImGui::TextColored(ImVec4(0.70f, 0.70f, 0.65f, 1.0f), "| Состояние: [%s]", sitName);

    // Speaker Vitality bar
    const float hpFrac = session.speakerMaxHp > 0
                             ? static_cast<float>(session.speakerHp) / static_cast<float>(session.speakerMaxHp)
                             : 0.0f;
    ImGui::SameLine(ImGui::GetWindowWidth() - 170.0f);
    char hpBuf[32];
    std::snprintf(hpBuf, sizeof(hpBuf), "HP: %d/%d", session.speakerHp, session.speakerMaxHp);
    ImGui::ProgressBar(hpFrac, ImVec2(150.0f, 18.0f), hpBuf);

    ImGui::Separator();
    ImGui::Spacing();

    // 2. Main Speech Body & Rumours with complete Cyrillic UTF-8 word-wrapping
    ImGui::BeginChild("##dialogue_speech_scroll", ImVec2(0.0f, 170.0f), true);
    ImGui::PushTextWrapPos(0.0f);

    if (session.speechText[0]) {
        ImGui::TextColored(ImVec4(0.95f, 0.95f, 0.85f, 1.0f), "«%s»", session.speechText);
    } else {
        ImGui::TextColored(ImVec4(0.60f, 0.60f, 0.60f, 1.0f), "«...собеседник молча осматривает коридор...»");
    }

    if (session.rumourText[0]) {
        ImGui::Spacing();
        ImGui::TextColored(ImVec4(0.40f, 0.85f, 0.91f, 1.0f), "Слухи и обстановка: \"%s\"", session.rumourText);
    }

    if (session.warReportText[0]) {
        ImGui::Spacing();
        ImGui::TextColored(ImVec4(0.95f, 0.75f, 0.30f, 1.0f), "Сводка этажа: %s", session.warReportText);
    }

    if (session.contractText[0]) {
        ImGui::Spacing();
        ImGui::TextColored(ImVec4(0.98f, 0.82f, 0.35f, 1.0f), "ПРЕДЛОЖЕНИЕ КОНТРАКТА: %s (Награда: %d руб.)",
                           session.contractText, session.contractOffer.reward);
    }

    if (session.questText[0]) {
        ImGui::Spacing();
        ImGui::TextColored(ImVec4(0.70f, 0.98f, 0.60f, 1.0f), "СЮЖЕТНОЕ ПОРУЧЕНИЕ: %s", session.questText);
    }

    ImGui::PopTextWrapPos();
    ImGui::EndChild();

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    // 3. Responsive Action Buttons
    if (ImGui::Button("[1] Слухи", ImVec2(120.0f, 28.0f)) ||
        (ImGui::IsKeyPressed(ImGuiKey_1) && !io.WantTextInput)) {
        outAction = DialogueAction::AskRumours;
    }

    ImGui::SameLine();
    if (ImGui::Button("[2] Сводка этажа", ImVec2(140.0f, 28.0f)) ||
        (ImGui::IsKeyPressed(ImGuiKey_2) && !io.WantTextInput)) {
        outAction = DialogueAction::AskWarSituation;
    }

    ImGui::SameLine();
    if (session.contractText[0]) {
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.28f, 0.24f, 0.08f, 1.0f));
        if (ImGui::Button("[3] Контракт", ImVec2(130.0f, 28.0f)) ||
            (ImGui::IsKeyPressed(ImGuiKey_3) && !io.WantTextInput)) {
            outAction = DialogueAction::AcceptContract;
        }
        ImGui::PopStyleColor();
        ImGui::SameLine();
    }

    if (session.questText[0]) {
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.12f, 0.32f, 0.16f, 1.0f));
        if (ImGui::Button("[4] Задание", ImVec2(120.0f, 28.0f)) ||
            (ImGui::IsKeyPressed(ImGuiKey_4) && !io.WantTextInput)) {
            outAction = DialogueAction::AcceptQuest;
        }
        ImGui::PopStyleColor();
        ImGui::SameLine();
    }

    if (session.traderNear) {
        if (ImGui::Button("[5] Торговля", ImVec2(120.0f, 28.0f)) ||
            (ImGui::IsKeyPressed(ImGuiKey_5) && !io.WantTextInput)) {
            outAction = DialogueAction::OpenTrade;
        }
        ImGui::SameLine();
    }

    if (session.canPossess) {
        if (ImGui::Button("[P] Вселиться", ImVec2(110.0f, 28.0f)) ||
            (ImGui::IsKeyPressed(ImGuiKey_P) && !io.WantTextInput)) {
            outAction = DialogueAction::Possess;
        }
        ImGui::SameLine();
    }

    ImGui::SetCursorPosX(ImGui::GetWindowWidth() - 150.0f);
    if (ImGui::Button("[E / Esc] Завершить", ImVec2(135.0f, 28.0f)) ||
        (ImGui::IsKeyPressed(ImGuiKey_Escape) && !io.WantTextInput) ||
        (ImGui::IsKeyPressed(ImGuiKey_E) && !io.WantTextInput)) {
        outAction = DialogueAction::Close;
    }

    ImGui::End();
}

} // namespace giga
