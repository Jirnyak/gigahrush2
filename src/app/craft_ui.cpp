#include "app/craft_ui.h"
#include "game/combat.h"
#include "game/item_table.h"
#include <imgui.h>
#include <cfloat>
#include <cctype>
#include <cstdio>

namespace giga {

static bool contains_icase(const char* haystack, const char* needle) {
    if (!haystack || !needle || !*needle) return true;
    for (; *haystack; ++haystack) {
        const char* h = haystack;
        const char* n = needle;
        while (*h && *n && (std::tolower(static_cast<unsigned char>(*h)) == std::tolower(static_cast<unsigned char>(*n)))) {
            ++h; ++n;
        }
        if (!*n) return true;
    }
    return false;
}

void draw_crafting_window_ui(bool* p_open,
                             game::CraftingState& crafting, 
                             game::Inventory& inv,
                             game::CraftStation currentStation, 
                             std::uint64_t simTick,
                             Registry& reg,
                             Entity player,
                             game::NpcPool& pool,
                             std::uint32_t& outCrafted, 
                             std::uint32_t& outScrapped,
                             std::uint32_t& outLearned) 
{
    if (!p_open || !*p_open) return;

    ImGui::SetNextWindowSize(ImVec2(820, 560), ImGuiCond_FirstUseEver);
    if (!ImGui::Begin("ВЕРСТАК И СБОРКА", p_open)) {
        ImGui::End();
        return;
    }

    static int selectedRecipeId = 1;
    static int craftQty = 1;
    static char recipeFilter[64] = "";
    static bool showOnlyKnown = false;

    const char* stationNames[] = { "Голыми руками", "Верстак", "Токарный станок", "Лабстол", "НЕТ-терминал" };
    const char* matNames[] = { "Мех", "Элект", "Расх", "Био", "Хим", "Металл", "Пси", "Мета" };

    ImGui::TextColored(ImVec4(0.949f, 0.780f, 0.251f, 1.0f), "Станция: %s | Допуск: T%u",
                       stationNames[static_cast<std::size_t>(currentStation)], crafting.tier);
    ImGui::Separator();

    ImGui::Text("Запас узлов:");
    ImGui::SameLine();
    for (std::size_t i = 0; i < game::kCraftMaterials; ++i) {
        ImGui::Text("%s: %u", matNames[i], crafting.mat[i]);
        if (i < game::kCraftMaterials - 1) ImGui::SameLine();
    }
    ImGui::Separator();

    if (ImGui::BeginTabBar("CraftingTabs")) {
        if (ImGui::BeginTabItem("Сборка")) {
            ImGui::BeginChild("RecipeListPane", ImVec2(340, 320), true);
            ImGui::InputText("Фильтр", recipeFilter, sizeof(recipeFilter));
            ImGui::Checkbox("Только изученные", &showOnlyKnown);

            ImGui::Separator();
            if (ImGui::BeginListBox("##Recipes", ImVec2(-FLT_MIN, -FLT_MIN))) {
                for (game::ItemId id = 1; id <= game::kCraftRecipeCount; ++id) {
                    const bool isKnown = game::craft_known(crafting, id);
                    if (showOnlyKnown && !isKnown) continue;

                    const char* name = game::item_name(id);
                    if (recipeFilter[0] != '\0' && !contains_icase(name, recipeFilter)) continue;

                    const game::CraftFail fail = game::craft_check(crafting, inv, id, currentStation);

                    char label[128];
                    std::snprintf(label, sizeof(label), "%s [%s]%s",
                                 name, isKnown ? "Изучен" : "Скрыт",
                                 fail == game::CraftFail::None ? " *" : "");

                    bool isSelected = (selectedRecipeId == static_cast<int>(id));
                    if (ImGui::Selectable(label, isSelected)) {
                        selectedRecipeId = static_cast<int>(id);
                    }
                    if (isSelected) ImGui::SetItemDefaultFocus();
                }
                ImGui::EndListBox();
            }
            ImGui::EndChild();

            ImGui::SameLine();

            ImGui::BeginChild("RecipeDetailPane", ImVec2(0, 320), true);
            if (selectedRecipeId >= 1 && selectedRecipeId <= static_cast<int>(game::kCraftRecipeCount)) {
                const auto id = static_cast<game::ItemId>(selectedRecipeId);
                const game::CraftRecipe& rec = game::craft_recipe(id);
                const char* itemName = game::item_name(id);
                const bool known = game::craft_known(crafting, id);
                const game::CraftFail checkResult = game::craft_check(crafting, inv, id, currentStation);

                ImGui::TextColored(ImVec4(0.949f, 0.780f, 0.251f, 1.0f), "%s", itemName);
                ImGui::Text("Допуск: T%u | Станция: %s", rec.tier, stationNames[rec.station]);
                ImGui::Text("Схема: %s", known ? "Изучена" : "Не изучена");
                ImGui::Separator();

                std::uint32_t missing[game::kCraftMaterials] = {};
                game::craft_missing(crafting, id, missing);

                ImGui::Text("Требуемые материалы:");
                if (ImGui::BeginTable("CompTable", 4, ImGuiTableFlags_BordersInnerH | ImGuiTableFlags_RowBg)) {
                    ImGui::TableSetupColumn("Узел");
                    ImGui::TableSetupColumn("Надо");
                    ImGui::TableSetupColumn("Есть");
                    ImGui::TableSetupColumn("Нехватка");
                    ImGui::TableHeadersRow();

                    for (std::size_t i = 0; i < game::kCraftMaterials; ++i) {
                        if (rec.comp[i] == 0) continue;
                        ImGui::TableNextRow();
                        ImGui::TableSetColumnIndex(0); ImGui::Text("%s", matNames[i]);
                        ImGui::TableSetColumnIndex(1); ImGui::Text("%u", rec.comp[i]);
                        ImGui::TableSetColumnIndex(2); ImGui::Text("%u", crafting.mat[i]);
                        ImGui::TableSetColumnIndex(3);
                        if (missing[i] > 0) {
                            ImGui::TextColored(ImVec4(0.902f, 0.310f, 0.361f, 1.0f), "-%u", missing[i]);
                        } else {
                            ImGui::TextColored(ImVec4(0.349f, 0.949f, 0.400f, 1.0f), "OK");
                        }
                    }
                    ImGui::EndTable();
                }

                ImGui::Separator();
                ImGui::SliderInt("Кол-во", &craftQty, 1, 10);

                const bool canCraft = (checkResult == game::CraftFail::None);
                if (!canCraft) ImGui::BeginDisabled();

                if (ImGui::Button("Собрать", ImVec2(160, 32))) {
                    for (int q = 0; q < craftQty; ++q) {
                        game::CraftResult res = game::craft_item(crafting, inv, id, currentStation);
                        if (res.fail == game::CraftFail::None) {
                            outCrafted++;
                            game::sync_armour(reg, pool, player);
                        } else {
                            break;
                        }
                    }
                }

                if (!canCraft) {
                    ImGui::EndDisabled();
                    ImGui::SameLine();
                    ImGui::TextColored(ImVec4(0.902f, 0.310f, 0.361f, 1.0f), "[%s]", game::craft_fail_text(checkResult));
                }
            }
            ImGui::EndChild();

            ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("Разбор")) {
            ImGui::Text("Разбор предметов из сумки на базовые узлы (нужен верстак).");
            if (currentStation != game::CraftStation::Workbench) {
                ImGui::TextColored(ImVec4(1.0f, 0.3f, 0.3f, 1.0f), "ОТКАЗ: подойдите к верстаку");
            }
            ImGui::Separator();

            if (ImGui::BeginTable("DisassemblyTable", 5, ImGuiTableFlags_ScrollY | ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg, ImVec2(0, 350))) {
                ImGui::TableSetupColumn("Слот", ImGuiTableColumnFlags_WidthFixed, 40.0f);
                ImGui::TableSetupColumn("Предмет");
                ImGui::TableSetupColumn("Шт", ImGuiTableColumnFlags_WidthFixed, 60.0f);
                ImGui::TableSetupColumn("Цена");
                ImGui::TableSetupColumn("Действие", ImGuiTableColumnFlags_WidthFixed, 120.0f);
                ImGui::TableHeadersRow();

                const game::Equipped* peq =
                    reg.valid(player) ? reg.try_get<game::Equipped>(player) : nullptr;
                for (int slot = 0; slot < game::kInvSlots; ++slot) {
                    const game::ItemSlot& s = inv.slots[slot];
                    if (!game::item_valid(s.item) || s.count == 0) continue;

                    const bool isEquipped =
                        peq && (slot == peq->handL || slot == peq->armor ||
                                slot == peq->handR);

                    ImGui::TableNextRow();
                    ImGui::TableSetColumnIndex(0); ImGui::Text("#%d", slot);
                    ImGui::TableSetColumnIndex(1);
                    if (isEquipped)
                        ImGui::Text("%s [НАДЕТО]", game::item_name(s.item));
                    else
                        ImGui::Text("%s", game::item_name(s.item));
                    ImGui::TableSetColumnIndex(2); ImGui::Text("%u", s.count);
                    ImGui::TableSetColumnIndex(3); ImGui::Text("%d руб", game::item_def(s.item).value);
                    ImGui::TableSetColumnIndex(4);

                    char btnId[32];
                    std::snprintf(btnId, sizeof(btnId), "Разобрать##%d", slot);

                    const bool canDis =
                        (currentStation == game::CraftStation::Workbench) &&
                        !isEquipped;
                    if (!canDis) ImGui::BeginDisabled();

                    if (ImGui::Button(btnId)) {
                        game::DisassembleResult dres = game::craft_disassemble(
                            crafting, inv, slot, currentStation, static_cast<std::uint32_t>(simTick));
                        if (dres.fail == game::CraftFail::None) {
                            outScrapped++;
                            if (dres.learned) outLearned++;
                            game::sync_armour(reg, pool, player);
                        }
                    }

                    if (!canDis) ImGui::EndDisabled();
                }
                ImGui::EndTable();
            }

            ImGui::EndTabItem();
        }

        ImGui::EndTabBar();
    }

    ImGui::End();
}

} // namespace giga
