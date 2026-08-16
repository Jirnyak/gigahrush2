// Interactive Quest Log & Contract UI implementation for GigaHrush 2.
#include "app/quest_ui.h"

#include <cstdio>
#include "imgui.h"
#include "game/item_table.h"

namespace giga {

void draw_quest_log_ui(QuestUIState& state, const game::QuestLog& quests, const game::ContractBook& contracts) {
    if (!state.open) return;

    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                           ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(860.0f, 580.0f), ImGuiCond_Appearing);

    ImGui::Begin("ЖУРНАЛ ЗАДАНИЙ И КОНТРАКТОВ / QUEST LOG##quest_log_window", &state.open,
                 ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoSavedSettings);

    ImGui::TextColored(ImVec4(0.35f, 0.95f, 0.40f, 1.0f),
                       "=== РЕЕСТР ПОРУЧЕНИЙ, ЗАДАНИЙ И КОНТРАКТОВ МЕГАБЛОКА ===");
    ImGui::Separator();
    ImGui::Spacing();

    if (ImGui::BeginTabBar("##quest_tabs", ImGuiTabBarFlags_None)) {
        // -------------------------------------------------------------------
        // TAB 1: Active Assignments (Quests & Contracts)
        // -------------------------------------------------------------------
        if (ImGui::BeginTabItem("Активные задания / Active")) {
            state.selectedTab = 0;
            ImGui::Spacing();

            ImGui::Columns(2, "##active_quest_cols", true);
            ImGui::SetColumnWidth(0, 360.0f);

            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "СПИСОК ТЕКУЩИХ ЗАДАЧ:");
            ImGui::BeginChild("##active_list", ImVec2(0.0f, 400.0f), true);

            int activeItemsCount = 0;

            // List Active Plot Quests
            for (int qi = 1; qi <= static_cast<int>(game::kQuestCount); ++qi) {
                const game::QuestId qid = static_cast<game::QuestId>(qi);
                const auto& prog = quests.row[qi - 1];
                if (prog.state == static_cast<std::uint8_t>(game::QuestState::Active)) {
                    ++activeItemsCount;
                    const char* title = game::quest_name(qid);
                    char label[256];
                    std::snprintf(label, sizeof(label), "[СЮЖЕТ] %s##q_%d", title, qi);

                    bool isSelected = (state.selectedQuestId == qi && state.selectedContractSlot < 0);
                    if (ImGui::Selectable(label, isSelected)) {
                        state.selectedQuestId = qi;
                        state.selectedContractSlot = -1;
                    }

                    // Mini-progress preview
                    const auto& def = game::quest_def(qid);
                    const float progFrac = def.target > 0 ? static_cast<float>(prog.progress) / static_cast<float>(def.target) : 0.0f;
                    char pBuf[64];
                    std::snprintf(pBuf, sizeof(pBuf), "%d / %d", prog.progress, def.target);
                    ImGui::ProgressBar(progFrac, ImVec2(ImGui::GetContentRegionAvail().x, 14.0f), pBuf);
                    ImGui::Spacing();
                }
            }

            // List Active Contracts
            for (int i = 0; i < game::kMaxContracts; ++i) {
                const auto& c = contracts.slot[i];
                if (c.state == static_cast<std::uint8_t>(game::ContractState::Active)) {
                    ++activeItemsCount;
                    char cText[200] = {};
                    game::contract_text(c, cText, sizeof(cText));
                    char label[256];
                    std::snprintf(label, sizeof(label), "[КОНТРАКТ #%d] %s##c_%d", i + 1, cText, i);

                    bool isSelected = (state.selectedContractSlot == i);
                    if (ImGui::Selectable(label, isSelected)) {
                        state.selectedContractSlot = i;
                        state.selectedQuestId = -1;
                    }

                    const float cFrac = c.target > 0 ? static_cast<float>(c.progress) / static_cast<float>(c.target) : 0.0f;
                    char cpBuf[64];
                    std::snprintf(cpBuf, sizeof(cpBuf), "%d / %d", c.progress, c.target);
                    ImGui::ProgressBar(cFrac, ImVec2(ImGui::GetContentRegionAvail().x, 14.0f), cpBuf);
                    ImGui::Spacing();
                }
            }

            if (activeItemsCount == 0) {
                ImGui::TextColored(ImVec4(0.60f, 0.60f, 0.60f, 1.0f),
                                   "Нет активных заданий.\nПодойдите к жителям или ликвидаторам (клавиша E) для получения поручений.");
            }

            ImGui::EndChild();

            ImGui::NextColumn();

            // Right Pane: Detail View
            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "ПОДРОБНЫЙ БРИФИНГ ЗАДАНИЯ:");
            ImGui::BeginChild("##active_detail", ImVec2(0.0f, 400.0f), true);

            if (state.selectedQuestId > 0 && state.selectedQuestId <= static_cast<int>(game::kQuestCount)) {
                const game::QuestId qid = static_cast<game::QuestId>(state.selectedQuestId);
                const auto& def = game::quest_def(qid);
                const auto& prog = quests.row[state.selectedQuestId - 1];

                ImGui::TextColored(ImVec4(0.35f, 0.95f, 0.40f, 1.0f), "НАЗВАНИЕ: %s", game::quest_name(qid));
                ImGui::Separator();
                ImGui::Spacing();

                ImGui::TextColored(ImVec4(0.95f, 0.95f, 0.85f, 1.0f), "ОПИСАНИЕ: %s", game::quest_brief(qid));
                ImGui::Spacing();

                char objText[96] = {};
                game::quest_objective_text(qid, objText, sizeof(objText));
                ImGui::TextColored(ImVec4(0.40f, 0.85f, 0.91f, 1.0f), "ЦЕЛЬ: %s", objText);
                ImGui::Text("ПРОГРЕСС: %d из %d", prog.progress, def.target);

                if (def.limitMs > 0) {
                    char timeBuf[32] = {};
                    game::quest_time_text(prog.remainingMs, timeBuf, sizeof(timeBuf));
                    ImGui::TextColored(ImVec4(1.0f, 0.45f, 0.45f, 1.0f), "ОСТАЛОСЬ ВРЕМЕНИ: %s", timeBuf);
                } else {
                    ImGui::TextColored(ImVec4(0.60f, 0.85f, 0.60f, 1.0f), "СРОК: Без ограничения по времени");
                }

                ImGui::Spacing();
                ImGui::Separator();
                ImGui::TextColored(ImVec4(0.98f, 0.82f, 0.35f, 1.0f), "НАГРАДА ЗА ВЫПОЛНЕНИЕ:");
                ImGui::BulletText("Деньги: %d рублей", def.reward);
                if (game::item_valid(def.rewardItem) && def.rewardCount > 0) {
                    ImGui::BulletText("Предмет: %s (x%d)", game::item_name(def.rewardItem), def.rewardCount);
                }
            } else if (state.selectedContractSlot >= 0 && state.selectedContractSlot < game::kMaxContracts) {
                const auto& c = contracts.slot[state.selectedContractSlot];
                char cText[200] = {};
                game::contract_text(c, cText, sizeof(cText));

                ImGui::TextColored(ImVec4(0.98f, 0.82f, 0.35f, 1.0f), "КОНТРАКТ #%d: %s", state.selectedContractSlot + 1, cText);
                ImGui::Separator();
                ImGui::Spacing();
                ImGui::Text("ПРОГРЕСС: %d из %d", c.progress, c.target);
                ImGui::TextColored(ImVec4(0.98f, 0.82f, 0.35f, 1.0f), "НАГРАДА: %d рублей", c.reward);
            } else {
                ImGui::TextColored(ImVec4(0.60f, 0.60f, 0.60f, 1.0f),
                                   "Выберите задание из левого списка для просмотра подробностей.");
            }

            ImGui::EndChild();
            ImGui::Columns(1);
            ImGui::EndTabItem();
        }

        // -------------------------------------------------------------------
        // TAB 2: Contract Board (3 procedural slots)
        // -------------------------------------------------------------------
        if (ImGui::BeginTabItem("Доска контрактов / Contracts")) {
            state.selectedTab = 1;
            ImGui::Spacing();
            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "ТЕКУЩИЕ СЛОТЫ КОНТРАКТОВ (CONTRACT SLOTS):");
            ImGui::Separator();
            ImGui::Spacing();

            for (int i = 0; i < game::kMaxContracts; ++i) {
                const auto& c = contracts.slot[i];
                char title[64];
                std::snprintf(title, sizeof(title), "Слот контракта #%d", i + 1);

                ImGui::PushID(i);
                ImGui::BeginChild(title, ImVec2(0.0f, 110.0f), true);

                const char* stateStr = "Пусто (Empty)";
                ImVec4 stateColor(0.5f, 0.5f, 0.5f, 1.0f);
                if (c.state == static_cast<std::uint8_t>(game::ContractState::Active)) {
                    stateStr = "ВЫПОЛНЯЕТСЯ (ACTIVE)";
                    stateColor = ImVec4(0.35f, 0.95f, 0.40f, 1.0f);
                } else if (c.state == static_cast<std::uint8_t>(game::ContractState::Complete)) {
                    stateStr = "ЗАВЕРШЁН (COMPLETE)";
                    stateColor = ImVec4(0.40f, 0.85f, 0.91f, 1.0f);
                } else if (c.state == static_cast<std::uint8_t>(game::ContractState::Failed)) {
                    stateStr = "ПРОВАЛЕН (FAILED)";
                    stateColor = ImVec4(1.0f, 0.40f, 0.40f, 1.0f);
                }

                ImGui::TextColored(stateColor, "[%s] %s", title, stateStr);
                if (c.state == static_cast<std::uint8_t>(game::ContractState::Active)) {
                    char cText[200] = {};
                    game::contract_text(c, cText, sizeof(cText));
                    ImGui::Text("Поручение: %s", cText);
                    ImGui::Text("Прогресс: %d / %d  |  Награда: %d руб.", c.progress, c.target, c.reward);
                    const float fr = c.target > 0 ? static_cast<float>(c.progress) / static_cast<float>(c.target) : 0.0f;
                    ImGui::ProgressBar(fr, ImVec2(320.0f, 14.0f));
                } else {
                    ImGui::TextColored(ImVec4(0.6f, 0.6f, 0.6f, 1.0f), "Слот свободен для новых контрактов от жителей.");
                }

                ImGui::EndChild();
                ImGui::PopID();
                ImGui::Spacing();
            }

            ImGui::EndTabItem();
        }

        // -------------------------------------------------------------------
        // TAB 3: History & Archive Statistics
        // -------------------------------------------------------------------
        if (ImGui::BeginTabItem("История и статистика / Archive")) {
            state.selectedTab = 2;
            ImGui::Spacing();
            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "СВОДНАЯ СТАТИСТИКА ЭКСПЕДИЦИИ:");
            ImGui::Separator();
            ImGui::Spacing();

            ImGui::Columns(2, "##stats_cols", false);
            ImGui::BulletText("Выполнено сюжетных заданий: %u", quests.completed);
            ImGui::BulletText("Выполнено контрактов: %u", contracts.completed);
            ImGui::BulletText("Всего заработано рублями: %lld руб.",
                              static_cast<long long>(quests.earned + contracts.earned));

            ImGui::NextColumn();
            ImGui::BulletText("Истекло по таймеру (Expired): %u", quests.expired);
            ImGui::BulletText("Погибло квестодателей (Orphaned): %u", quests.orphaned);
            ImGui::BulletText("Провалено контрактов: %u", contracts.failed);
            ImGui::BulletText("Потеряно наград (полный рюкзак): %u", quests.rewardItemsLost);

            ImGui::Columns(1);
            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            ImGui::TextColored(ImVec4(0.95f, 0.78f, 0.25f, 1.0f), "АРХИВ СЮЖЕТНЫХ ЗАДАНИЙ:");
            ImGui::BeginChild("##archive_list", ImVec2(0.0f, 220.0f), true);

            for (int qi = 1; qi <= static_cast<int>(game::kQuestCount); ++qi) {
                const game::QuestId qid = static_cast<game::QuestId>(qi);
                const auto& prog = quests.row[qi - 1];
                const char* title = game::quest_name(qid);

                if (prog.state == static_cast<std::uint8_t>(game::QuestState::Complete)) {
                    ImGui::TextColored(ImVec4(0.35f, 0.95f, 0.40f, 1.0f), "[ВЫПОЛНЕНО] %s", title);
                } else if (prog.state == static_cast<std::uint8_t>(game::QuestState::Expired)) {
                    ImGui::TextColored(ImVec4(1.0f, 0.45f, 0.45f, 1.0f), "[ИСТЕКЛО] %s", title);
                } else if (prog.state == static_cast<std::uint8_t>(game::QuestState::Orphaned)) {
                    ImGui::TextColored(ImVec4(0.85f, 0.65f, 0.25f, 1.0f), "[КВЕСТОДАТЕЛЬ ПОГИБ] %s", title);
                }
            }

            ImGui::EndChild();
            ImGui::EndTabItem();
        }
        ImGui::EndTabBar();
    }

    ImGui::Spacing();
    ImGui::Separator();
    if (ImGui::Button("ЗАКРЫТЬ ЖУРНАЛ / CLOSE (J / Esc)", ImVec2(240.0f, 30.0f))) {
        state.open = false;
    }

    ImGui::End();
}

} // namespace giga
