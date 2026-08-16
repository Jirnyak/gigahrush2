// Interactive Workbench & Crafting UI implementation for GigaHrush 2.
#include "app/craft_ui.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include "imgui.h"
#include "game/combat.h"
#include "game/craft.h"
#include "game/encumbrance.h"
#include "game/item_table.h"
#include "game/rpg.h"

namespace giga {

namespace {

static bool contains_icase_craft(const char* haystack, const char* needle) {
    if (!haystack || !needle || !*needle) return true;
    for (; *haystack; ++haystack) {
        const char* h = haystack;
        const char* n = needle;
        while (*h && *n && (std::tolower(static_cast<unsigned char>(*h)) ==
                            std::tolower(static_cast<unsigned char>(*n)))) {
            ++h;
            ++n;
        }
        if (!*n) return true;
    }
    return false;
}

const char* station_name_str(game::CraftStation st) {
    switch (st) {
        case game::CraftStation::Any:         return "Вручную (Any)";
        case game::CraftStation::Workbench:   return "Верстак (Workbench)";
        case game::CraftStation::Lathe:       return "Токарный станок (Lathe)";
        case game::CraftStation::Lab:         return "Химлаборатория (Lab)";
        case game::CraftStation::NetTerminal: return "Сетевой терминал (Terminal)";
        default:                              return "Неизвестно";
    }
}

const char* mat_name_str(std::size_t idx) {
    static const char* kMatNames[game::kCraftMaterials] = {
        "Механика (Mech)",
        "Электроника (Elec)",
        "Стройматериалы (Cons)",
        "Биомасса (Bio)",
        "Химия (Chem)",
        "Металлургия (Metal)",
        "Пси-сплавы (Psi)",
        "Мета-вещество (Meta)"
    };
    return (idx < game::kCraftMaterials) ? kMatNames[idx] : "Материал";
}

bool recipe_matches_category(game::ItemId id, int catTab) {
    if (catTab == 0) return true; // All
    if (id < 1 || id > game::kCraftRecipeCount) return false;

    const game::ItemDef& def = game::item_def(id);
    const auto cat = static_cast<game::ItemCategory>(def.category);

    switch (catTab) {
        case 1: // Медицина (Medical / Medicine / Food / Drink)
            return (cat == game::ItemCategory::Medicine ||
                    cat == game::ItemCategory::Food ||
                    cat == game::ItemCategory::Drink ||
                    def.useEffect == static_cast<std::uint8_t>(game::UseEffect::Heal) ||
                    def.useEffect == static_cast<std::uint8_t>(game::UseEffect::HealPsi) ||
                    def.useEffect == static_cast<std::uint8_t>(game::UseEffect::Painkiller) ||
                    def.useEffect == static_cast<std::uint8_t>(game::UseEffect::Antiemetic) ||
                    def.useEffect == static_cast<std::uint8_t>(game::UseEffect::SleepingPills) ||
                    def.useEffect == static_cast<std::uint8_t>(game::UseEffect::PsiSurge));
        case 2: // Оружие (Weapons)
            return (cat == game::ItemCategory::Weapon ||
                    def.equipSlot == static_cast<std::uint8_t>(game::EquipSlot::Weapon));
        case 3: // Боеприпасы (Ammo)
            return (cat == game::ItemCategory::Ammo);
        case 4: // Снаряжение (Gear / Armor / Wearables)
            return (def.equipSlot == static_cast<std::uint8_t>(game::EquipSlot::Armor) ||
                    def.resist[0] > 0 || def.resist[1] > 0 || def.resist[2] > 0 ||
                    def.resist[3] > 0 || def.resist[4] > 0 ||
                    (cat == game::ItemCategory::Misc &&
                     (def.wearKind == static_cast<std::uint8_t>(game::WearKind::Fouling) ||
                      def.wearKind == static_cast<std::uint8_t>(game::WearKind::Durability))));
        case 5: // Инструменты (Tools / Keys / Notes)
            return (cat == game::ItemCategory::Tool ||
                    cat == game::ItemCategory::Key ||
                    cat == game::ItemCategory::Note ||
                    def.equipSlot == static_cast<std::uint8_t>(game::EquipSlot::Tool));
        default:
            return true;
    }
}

// Calculate max number of units of `id` that can be crafted given current bank materials and bag slots.
int calculate_max_craftable(const game::CraftingState& st, const game::Inventory& inv, game::ItemId id) {
    if (!game::item_valid(id)) return 0;
    const game::CraftRecipe& rec = game::craft_recipe(id);

    int maxByMat = 9999;
    for (std::size_t i = 0; i < game::kCraftMaterials; ++i) {
        if (rec.comp[i] > 0) {
            const int possible = static_cast<int>(st.mat[i] / rec.comp[i]);
            if (possible < maxByMat) maxByMat = possible;
        }
    }
    if (maxByMat <= 0) return 0;

    // Bag capacity calculation
    const std::uint8_t stackCap = game::item_def(id).stackMax ? game::item_def(id).stackMax : 1;
    int bagCapacity = 0;
    for (int i = 0; i < game::kInvSlots; ++i) {
        const game::ItemSlot& s = inv.slots[i];
        if (!game::item_valid(s.item) || s.count == 0) {
            bagCapacity += stackCap;
        } else if (s.item == id && s.count < stackCap) {
            bagCapacity += (stackCap - s.count);
        }
    }

    return std::clamp(std::min(maxByMat, bagCapacity), 0, 50);
}

} // namespace

void draw_crafting_window_ui(CraftUIState& state,
                             game::CraftingState& crafting,
                             game::Inventory& inv,
                             game::CraftStation currentStation,
                             std::uint64_t simTick,
                             Registry& reg,
                             Entity player,
                             game::NpcPool& pool,
                             audio::AudioSystem* audioSys,
                             std::uint32_t& outCrafted,
                             std::uint32_t& outScrapped,
                             std::uint32_t& outLearned) {
    if (!state.open) return;

    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                            ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(1040.0f, 660.0f), ImGuiCond_Appearing);

    if (!ImGui::Begin("ВЕРСТАК И МАСТЕРСКАЯ / CRAFTING & WORKBENCH STUDIO##craft_window", &state.open,
                      ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoSavedSettings)) {
        ImGui::End();
        return;
    }

    // 1. Header: Station Proximity, Player Tier, Material Bank Chips, Carry Capacity
    const game::RpgStats* rpg = reg.try_get<game::RpgStats>(player);
    const std::uint32_t carriedMassG = game::inventory_mass_g(inv);
    const std::uint32_t capacityG = rpg ? game::carry_capacity_g(*rpg) : 64000;
    const float weightFrac = capacityG > 0 ? static_cast<float>(carriedMassG) / static_cast<float>(capacityG) : 0.0f;

    ImGui::TextColored(ImVec4(0.35f, 0.85f, 1.0f, 1.0f),
                       "СТАНЦИЯ: %s | ДОПУСК: T%u | ИЗУЧЕНО: %u / %zu",
                       station_name_str(currentStation), crafting.tier,
                       game::craft_known_count(crafting), game::kCraftRecipeCount);

    ImGui::SameLine(ImGui::GetWindowWidth() - 320.0f);
    char weightBuf[64];
    std::snprintf(weightBuf, sizeof(weightBuf), "Вес: %.1f / %.1f кг",
                  static_cast<float>(carriedMassG) / 1000.0f,
                  static_cast<float>(capacityG) / 1000.0f);
    ImVec4 barColor = (weightFrac > 1.0f) ? ImVec4(0.95f, 0.25f, 0.25f, 1.0f)
                    : (weightFrac > 0.8f) ? ImVec4(0.95f, 0.75f, 0.25f, 1.0f)
                                          : ImVec4(0.35f, 0.85f, 0.45f, 1.0f);
    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, barColor);
    ImGui::ProgressBar(weightFrac, ImVec2(200.0f, 16.0f), weightBuf);
    ImGui::PopStyleColor();

    if (weightFrac > 1.0f) {
        ImGui::SameLine();
        ImGui::TextColored(ImVec4(1.0f, 0.25f, 0.25f, 1.0f), "[ПЕРЕГРУЗ]");
    }

    ImGui::Spacing();

    // Material Bank Overview Chips
    ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.40f, 1.0f), "БАНК МАТЕРИАЛОВ:");
    ImGui::SameLine();

    std::uint32_t totalMatUnits = 0;
    for (std::size_t i = 0; i < game::kCraftMaterials; ++i) {
        totalMatUnits += crafting.mat[i];
    }
    ImGui::TextDisabled("(Всего единиц: %u)", totalMatUnits);

    if (ImGui::BeginTable("##MaterialBankChips", game::kCraftMaterials, ImGuiTableFlags_BordersInnerV)) {
        for (std::size_t i = 0; i < game::kCraftMaterials; ++i) {
            ImGui::TableSetupColumn(mat_name_str(i), ImGuiTableColumnFlags_WidthStretch);
        }
        ImGui::TableNextRow();
        for (std::size_t i = 0; i < game::kCraftMaterials; ++i) {
            ImGui::TableSetColumnIndex(static_cast<int>(i));
            if (crafting.mat[i] > 0) {
                ImGui::TextColored(ImVec4(0.40f, 0.95f, 0.50f, 1.0f), "%s:\n%u ед.", mat_name_str(i), crafting.mat[i]);
            } else {
                ImGui::TextDisabled("%s:\n0 ед.", mat_name_str(i));
            }
        }
        ImGui::EndTable();
    }

    ImGui::Separator();
    ImGui::Spacing();

    // 2. Navigation Tabs
    if (ImGui::BeginTabBar("##CraftingCategoryTabs", ImGuiTabBarFlags_None)) {
        const char* tabNames[] = {
            "Все рецепты",
            "Медицина",
            "Оружие",
            "Боеприпасы",
            "Снаряжение",
            "Инструменты",
            "Разборка и утилизация",
            "Ремонт экипировки"
        };

        for (int t = 0; t < 8; ++t) {
            if (ImGui::BeginTabItem(tabNames[t])) {
                if (state.selectedTab != t) {
                    state.selectedTab = t;
                    if (audioSys) audioSys->trigger_ui(audio::UiSound::KeyClick);
                }
                ImGui::EndTabItem();
            }
        }
        ImGui::EndTabBar();
    }

    // 3. Tab Body
    if (state.selectedTab == 6) {
        // =======================================================================
        // TAB 6: DISASSEMBLY & SCRAP
        // =======================================================================
        ImGui::TextColored(ImVec4(0.95f, 0.75f, 0.35f, 1.0f),
                           "УТИЛИЗАЦИЯ И РАЗБОРКА ПРЕДМЕТОВ НА МАТЕРИАЛЫ");
        ImGui::TextDisabled("Разборка предметов извлекает базовые компоненты в банк материалов и дает 50%% шанс изучить чертеж предмета.");

        const bool isAtWorkbench = (currentStation == game::CraftStation::Workbench);
        if (!isAtWorkbench) {
            ImGui::Spacing();
            ImGui::TextColored(ImVec4(1.0f, 0.35f, 0.35f, 1.0f),
                               "[ВНИМАНИЕ] Для разборки требуется Верстак (Workbench)!");
        }

        ImGui::Spacing();

        // Quick scrap recommendation button
        const int autoScrapSlot = game::craft_scrap_slot(inv);
        if (autoScrapSlot >= 0 && game::item_valid(inv.slots[autoScrapSlot].item)) {
            const game::ItemId scrapId = inv.slots[autoScrapSlot].item;
            char autoScrapBtn[128];
            std::snprintf(autoScrapBtn, sizeof(autoScrapBtn),
                          "Утилизировать рекомендуемый хлам: %s (#%02d)##auto_scrap",
                          game::item_name(scrapId), autoScrapSlot + 1);

            if (!isAtWorkbench) ImGui::BeginDisabled();
            if (ImGui::Button(autoScrapBtn, ImVec2(380.0f, 26.0f))) {
                const game::DisassembleResult dres = game::craft_disassemble(
                    crafting, inv, autoScrapSlot, currentStation,
                    static_cast<std::uint32_t>(simTick ^ 0x5a1b3c7du));

                if (dres.fail == game::CraftFail::None) {
                    outScrapped++;
                    if (dres.learned) {
                        outLearned++;
                        if (audioSys) audioSys->trigger_ui(audio::UiSound::InventoryRustle);
                        std::snprintf(state.statusMsg, sizeof(state.statusMsg),
                                      "Разобран %s: получен компонент и изучен новый чертеж!",
                                      game::item_name(scrapId));
                    } else {
                        if (audioSys) audioSys->trigger_ui(audio::UiSound::KeyClick);
                        std::snprintf(state.statusMsg, sizeof(state.statusMsg),
                                      "Разобран %s: получен компонент в банк материалов.",
                                      game::item_name(scrapId));
                    }
                    game::sync_armour(reg, pool, player);
                }
            }
            if (!isAtWorkbench) ImGui::EndDisabled();
            ImGui::Spacing();
        }

        if (ImGui::BeginTable("##DisassemblyTable", 6,
                              ImGuiTableFlags_ScrollY | ImGuiTableFlags_Borders |
                              ImGuiTableFlags_RowBg | ImGuiTableFlags_Resizable,
                              ImVec2(0.0f, 400.0f))) {
            ImGui::TableSetupColumn("Слот", ImGuiTableColumnFlags_WidthFixed, 45.0f);
            ImGui::TableSetupColumn("Предмет в рюкзаке", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Кол-во", ImGuiTableColumnFlags_WidthFixed, 50.0f);
            ImGui::TableSetupColumn("Выход материалов", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Статус чертежа", ImGuiTableColumnFlags_WidthFixed, 110.0f);
            ImGui::TableSetupColumn("Действие", ImGuiTableColumnFlags_WidthFixed, 100.0f);
            ImGui::TableHeadersRow();

            for (int slot = 0; slot < game::kInvSlots; ++slot) {
                game::ItemSlot& s = inv.slots[slot];
                if (!game::item_valid(s.item) || s.count == 0) continue;

                const game::ItemId id = s.item;
                const char* name = game::item_name(id);
                const game::CraftRecipe& rec = game::craft_recipe(id);

                // Check yield
                char yieldBuf[160] = {};
                int yieldPos = 0;
                for (std::size_t mi = 0; mi < game::kCraftMaterials; ++mi) {
                    if (rec.comp[mi] > 0) {
                        yieldPos += std::snprintf(yieldBuf + yieldPos, sizeof(yieldBuf) - yieldPos,
                                                  "%s: +%u  ", mat_name_str(mi), rec.comp[mi]);
                    }
                }
                if (yieldPos == 0) std::snprintf(yieldBuf, sizeof(yieldBuf), "Нет компонентов");

                const bool isKnown = game::craft_known(crafting, id);

                ImGui::TableNextRow();
                ImGui::TableSetColumnIndex(0);
                ImGui::TextDisabled("#%02d", slot + 1);

                ImGui::TableSetColumnIndex(1);
                ImGui::Text("%s", name);

                ImGui::TableSetColumnIndex(2);
                ImGui::Text("%u", s.count);

                ImGui::TableSetColumnIndex(3);
                ImGui::TextColored(ImVec4(0.40f, 0.90f, 0.50f, 1.0f), "%s", yieldBuf);

                ImGui::TableSetColumnIndex(4);
                if (isKnown) {
                    ImGui::TextDisabled("Изучен (T%u)", rec.tier);
                } else {
                    ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.35f, 1.0f), "Шанс 50%% (T%u)", rec.tier);
                }

                ImGui::TableSetColumnIndex(5);
                char scrapBtnLabel[32];
                std::snprintf(scrapBtnLabel, sizeof(scrapBtnLabel), "Разобрать##sc_%d", slot);

                if (!isAtWorkbench) ImGui::BeginDisabled();
                if (ImGui::Button(scrapBtnLabel, ImVec2(90.0f, 22.0f))) {
                    const game::DisassembleResult dres = game::craft_disassemble(
                        crafting, inv, slot, currentStation,
                        static_cast<std::uint32_t>(simTick ^ (static_cast<std::uint32_t>(slot) * 0x9e3779b9u)));

                    if (dres.fail == game::CraftFail::None) {
                        outScrapped++;
                        if (dres.learned) {
                            outLearned++;
                            if (audioSys) audioSys->trigger_ui(audio::UiSound::InventoryRustle);
                            std::snprintf(state.statusMsg, sizeof(state.statusMsg),
                                          "Изучен новый чертеж: %s!", name);
                        } else {
                            if (audioSys) audioSys->trigger_ui(audio::UiSound::KeyClick);
                            std::snprintf(state.statusMsg, sizeof(state.statusMsg),
                                          "Разобран 1 шт. %s", name);
                        }
                        game::sync_armour(reg, pool, player);
                    } else {
                        if (audioSys) audioSys->trigger_ui(audio::UiSound::ErrorChirp);
                    }
                }
                if (!isAtWorkbench) ImGui::EndDisabled();
            }
            ImGui::EndTable();
        }
    } else if (state.selectedTab == 7) {
        // =======================================================================
        // TAB 7: REPAIR & MAINTENANCE (Spec 03 §4.2)
        // =======================================================================
        ImGui::TextColored(ImVec4(0.40f, 0.85f, 1.0f, 1.0f),
                           "РЕМОНТ И ОБСЛУЖИВАНИЕ ЭКИПИРОВКИ (Spec 03 §4.2)");
        ImGui::TextDisabled("Восстановление прочности оружия и снаряжения до 100%% (255) за счет Механики и Металла.");

        ImGui::Spacing();

        if (ImGui::BeginTable("##RepairTable", 6,
                              ImGuiTableFlags_ScrollY | ImGuiTableFlags_Borders |
                              ImGuiTableFlags_RowBg | ImGuiTableFlags_Resizable,
                              ImVec2(0.0f, 400.0f))) {
            ImGui::TableSetupColumn("Слот", ImGuiTableColumnFlags_WidthFixed, 45.0f);
            ImGui::TableSetupColumn("Предмет", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Состояние", ImGuiTableColumnFlags_WidthFixed, 100.0f);
            ImGui::TableSetupColumn("Стоимость ремонта", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Материалы в наличии", ImGuiTableColumnFlags_WidthFixed, 120.0f);
            ImGui::TableSetupColumn("Действие", ImGuiTableColumnFlags_WidthFixed, 110.0f);
            ImGui::TableHeadersRow();

            int damagedCount = 0;
            const std::size_t mechIdx = static_cast<std::size_t>(game::CraftMaterial::Mechanics);
            const std::size_t metalIdx = static_cast<std::size_t>(game::CraftMaterial::Metal);
            const std::uint32_t repairBank = crafting.mat[mechIdx] + crafting.mat[metalIdx];

            for (int slot = 0; slot < game::kInvSlots; ++slot) {
                game::ItemSlot& s = inv.slots[slot];
                if (!game::item_valid(s.item) || s.count == 0) continue;
                if (s.condition >= 255) continue; // Pristine, no repair needed

                damagedCount++;
                const game::ItemId id = s.item;
                const char* name = game::item_name(id);

                const std::uint32_t damage = static_cast<std::uint32_t>(255u - s.condition);
                std::uint32_t totalCost = game::craft_cost_total(s.item);
                if (totalCost == 0) totalCost = 2u;
                const std::uint32_t costNeeded = std::max(1u, (damage * totalCost + 255u) / 510u);
                const bool canAfford = (repairBank >= costNeeded);

                ImGui::TableNextRow();
                ImGui::TableSetColumnIndex(0);
                ImGui::TextDisabled("#%02d", slot + 1);

                ImGui::TableSetColumnIndex(1);
                ImGui::Text("%s", name);

                ImGui::TableSetColumnIndex(2);
                const float condPct = (static_cast<float>(s.condition) / 255.0f) * 100.0f;
                if (condPct < 40.0f) {
                    ImGui::TextColored(ImVec4(0.95f, 0.30f, 0.30f, 1.0f), "%.1f%% (%u/255)", condPct, s.condition);
                } else if (condPct < 75.0f) {
                    ImGui::TextColored(ImVec4(0.95f, 0.80f, 0.30f, 1.0f), "%.1f%% (%u/255)", condPct, s.condition);
                } else {
                    ImGui::TextColored(ImVec4(0.40f, 0.90f, 0.50f, 1.0f), "%.1f%% (%u/255)", condPct, s.condition);
                }

                ImGui::TableSetColumnIndex(3);
                ImGui::Text("%u ед. (Мех/Мет)", costNeeded);

                ImGui::TableSetColumnIndex(4);
                if (canAfford) {
                    ImGui::TextColored(ImVec4(0.40f, 0.95f, 0.50f, 1.0f), "%u ед.", repairBank);
                } else {
                    ImGui::TextColored(ImVec4(0.95f, 0.30f, 0.30f, 1.0f), "%u ед. (Нехватка)", repairBank);
                }

                ImGui::TableSetColumnIndex(5);
                char repBtnLabel[32];
                std::snprintf(repBtnLabel, sizeof(repBtnLabel), "Починить##rep_%d", slot);

                if (!canAfford) ImGui::BeginDisabled();
                if (ImGui::Button(repBtnLabel, ImVec2(100.0f, 22.0f))) {
                    const game::RepairResult rres = game::craft_repair_item(crafting, inv, slot, currentStation);
                    if (rres.ok) {
                        if (audioSys) audioSys->trigger_ui(audio::UiSound::InventoryRustle);
                        std::snprintf(state.statusMsg, sizeof(state.statusMsg),
                                      "Отремонтировано: %s (Потрачено: %u ед. компонентов)",
                                      name, rres.costTotal);
                    } else {
                        if (audioSys) audioSys->trigger_ui(audio::UiSound::ErrorChirp);
                    }
                }
                if (!canAfford) ImGui::EndDisabled();
            }

            if (damagedCount == 0) {
                ImGui::TableNextRow();
                ImGui::TableSetColumnIndex(1);
                ImGui::TextDisabled("В рюкзаке нет поврежденных предметов.");
            }

            ImGui::EndTable();
        }
    } else {
        // =======================================================================
        // TABS 0..5: RECIPE BROWSER (All, Medicine, Weapons, Ammo, Gear, Tools)
        // =======================================================================
        ImGui::Columns(2, "##crafting_split_view", true);
        ImGui::SetColumnWidth(0, ImGui::GetWindowWidth() * 0.46f);

        // LEFT COLUMN: RECIPE SEARCH & LIST
        ImGui::TextColored(ImVec4(0.40f, 0.90f, 0.50f, 1.0f), "СПИСОК ЧЕРТЕЖЕЙ И РЕЦЕПТОВ");
        ImGui::Spacing();

        ImGui::SetNextItemWidth(160.0f);
        ImGui::InputTextWithHint("##recipe_filter", "Поиск по названию...", state.recipeFilter, sizeof(state.recipeFilter));
        ImGui::SameLine();
        ImGui::Checkbox("Только изученные", &state.showOnlyKnown);
        ImGui::SameLine();
        ImGui::Checkbox("Доступные", &state.showOnlyCraftable);

        ImGui::Spacing();

        if (ImGui::BeginTable("##RecipeCatalogTable", 4,
                              ImGuiTableFlags_ScrollY | ImGuiTableFlags_Borders |
                              ImGuiTableFlags_RowBg | ImGuiTableFlags_Resizable,
                              ImVec2(0.0f, 420.0f))) {
            ImGui::TableSetupColumn("Наименование", ImGuiTableColumnFlags_WidthStretch);
            ImGui::TableSetupColumn("Ранг", ImGuiTableColumnFlags_WidthFixed, 36.0f);
            ImGui::TableSetupColumn("Станция", ImGuiTableColumnFlags_WidthFixed, 85.0f);
            ImGui::TableSetupColumn("Расход", ImGuiTableColumnFlags_WidthFixed, 50.0f);
            ImGui::TableHeadersRow();

            for (game::ItemId id = 1; id <= game::kCraftRecipeCount; ++id) {
                if (!recipe_matches_category(id, state.selectedTab)) continue;

                const char* name = game::item_name(id);
                if (state.recipeFilter[0] != '\0' && !contains_icase_craft(name, state.recipeFilter)) continue;

                const bool isKnown = game::craft_known(crafting, id);
                if (state.showOnlyKnown && !isKnown) continue;

                const game::CraftFail failCheck = game::craft_check(crafting, inv, id, currentStation);
                const bool isCraftable = (failCheck == game::CraftFail::None);
                if (state.showOnlyCraftable && !isCraftable) continue;

                const game::CraftRecipe& rec = game::kCraftRecipes[static_cast<std::size_t>(id) - 1];
                const std::uint32_t costTotal = game::craft_cost_total(id);

                ImGui::TableNextRow();
                ImGui::TableSetColumnIndex(0);

                const bool isSelected = (state.selectedRecipeId == static_cast<int>(id));
                char itemSelectLabel[128];
                std::snprintf(itemSelectLabel, sizeof(itemSelectLabel), "%s##rec_%u", name, id);

                if (isCraftable) {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.40f, 0.95f, 0.45f, 1.0f));
                    if (ImGui::Selectable(itemSelectLabel, isSelected)) {
                        state.selectedRecipeId = static_cast<int>(id);
                        if (audioSys) audioSys->trigger_ui(audio::UiSound::KeyClick);
                    }
                    ImGui::PopStyleColor();
                } else if (isKnown) {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.95f, 0.85f, 0.40f, 1.0f));
                    if (ImGui::Selectable(itemSelectLabel, isSelected)) {
                        state.selectedRecipeId = static_cast<int>(id);
                        if (audioSys) audioSys->trigger_ui(audio::UiSound::KeyClick);
                    }
                    ImGui::PopStyleColor();
                } else {
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.55f, 0.55f, 0.55f, 1.0f));
                    if (ImGui::Selectable(itemSelectLabel, isSelected)) {
                        state.selectedRecipeId = static_cast<int>(id);
                        if (audioSys) audioSys->trigger_ui(audio::UiSound::KeyClick);
                    }
                    ImGui::PopStyleColor();
                }

                ImGui::TableSetColumnIndex(1);
                ImGui::Text("T%u", rec.tier);

                ImGui::TableSetColumnIndex(2);
                ImGui::TextDisabled("%s", station_name_str(static_cast<game::CraftStation>(rec.station)));

                ImGui::TableSetColumnIndex(3);
                ImGui::Text("%u ед.", costTotal);
            }
            ImGui::EndTable();
        }

        // RIGHT COLUMN: RECIPE DETAILS & REAL-TIME INGREDIENT CHECK
        ImGui::NextColumn();

        const game::ItemId curId = static_cast<game::ItemId>(state.selectedRecipeId);
        if (curId >= 1 && curId <= game::kCraftRecipeCount) {
            const char* curName = game::item_name(curId);
            const game::ItemDef& curDef = game::item_def(curId);
            const game::CraftRecipe& curRec = game::kCraftRecipes[static_cast<std::size_t>(curId) - 1];
            const bool isKnown = game::craft_known(crafting, curId);

            ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.35f, 1.0f), "%s", curName);
            ImGui::TextDisabled("Ранг: T%u (%s) | Станция: %s | Масса: %u г | Стоимость: %d руб.",
                                curRec.tier, isKnown ? "Изучен" : "Не изучен",
                                station_name_str(static_cast<game::CraftStation>(curRec.station)),
                                curDef.massG, curDef.value);

            ImGui::Separator();
            ImGui::Spacing();

            // Real-time missing calculation
            std::uint32_t missing[game::kCraftMaterials] = {};
            game::craft_missing(crafting, curId, missing);

            bool hasMaterials = true;
            for (std::size_t mi = 0; mi < game::kCraftMaterials; ++mi) {
                if (missing[mi] > 0) {
                    hasMaterials = false;
                    break;
                }
            }

            // Material Requirements Table
            ImGui::Text("Требуемые компоненты (Списание из банка материалов):");
            if (ImGui::BeginTable("##RecipeComponentsTable", 4,
                                  ImGuiTableFlags_Borders | ImGuiTableFlags_RowBg,
                                  ImVec2(0.0f, 140.0f))) {
                ImGui::TableSetupColumn("Материал", ImGuiTableColumnFlags_WidthStretch);
                ImGui::TableSetupColumn("Требуется", ImGuiTableColumnFlags_WidthFixed, 80.0f);
                ImGui::TableSetupColumn("В банке", ImGuiTableColumnFlags_WidthFixed, 80.0f);
                ImGui::TableSetupColumn("Статус", ImGuiTableColumnFlags_WidthFixed, 100.0f);
                ImGui::TableHeadersRow();

                for (std::size_t mi = 0; mi < game::kCraftMaterials; ++mi) {
                    if (curRec.comp[mi] == 0) continue;

                    ImGui::TableNextRow();
                    ImGui::TableSetColumnIndex(0);
                    ImGui::Text("%s", mat_name_str(mi));

                    ImGui::TableSetColumnIndex(1);
                    ImGui::Text("%u", curRec.comp[mi]);

                    ImGui::TableSetColumnIndex(2);
                    ImGui::Text("%u", crafting.mat[mi]);

                    ImGui::TableSetColumnIndex(3);
                    if (missing[mi] > 0) {
                        ImGui::TextColored(ImVec4(0.95f, 0.30f, 0.30f, 1.0f), "Нехватка -%u", missing[mi]);
                    } else {
                        ImGui::TextColored(ImVec4(0.35f, 0.95f, 0.45f, 1.0f), "В наличии");
                    }
                }
                ImGui::EndTable();
            }

            // Real-time Inventory Scavenge helper for missing materials
            if (!hasMaterials) {
                ImGui::Spacing();
                ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.40f, 1.0f),
                                   "Поиск компонентов в рюкзаке для быстрой утилизации:");

                bool foundScavengeOption = false;
                for (std::size_t mi = 0; mi < game::kCraftMaterials; ++mi) {
                    if (missing[mi] == 0) continue;

                    for (int slot = 0; slot < game::kInvSlots; ++slot) {
                        const game::ItemSlot& s = inv.slots[slot];
                        if (!game::item_valid(s.item) || s.count == 0) continue;
                        if (s.item == curId) continue; // Don't suggest scrapping the same item

                        const game::CraftRecipe& sRec = game::craft_recipe(s.item);
                        if (sRec.comp[mi] > 0) {
                            foundScavengeOption = true;
                            ImGui::BulletText("%s (x%u в рюкзаке) -> дает %s",
                                              game::item_name(s.item), s.count, mat_name_str(mi));
                            ImGui::SameLine();
                            char qScrapBtn[64];
                            std::snprintf(qScrapBtn, sizeof(qScrapBtn), "Разобрать 1 шт##qs_%d_%zu", slot, mi);

                            const bool isAtWb = (currentStation == game::CraftStation::Workbench);
                            if (!isAtWb) ImGui::BeginDisabled();
                            if (ImGui::Button(qScrapBtn, ImVec2(120.0f, 20.0f))) {
                                const game::DisassembleResult dres = game::craft_disassemble(
                                    crafting, inv, slot, currentStation,
                                    static_cast<std::uint32_t>(simTick ^ 0x1337beefu));
                                if (dres.fail == game::CraftFail::None) {
                                    outScrapped++;
                                    if (dres.learned) outLearned++;
                                    if (audioSys) audioSys->trigger_ui(audio::UiSound::InventoryRustle);
                                    game::sync_armour(reg, pool, player);
                                }
                            }
                            if (!isAtWb) ImGui::EndDisabled();
                        }
                    }
                }
                if (!foundScavengeOption) {
                    ImGui::TextDisabled("  В рюкзаке нет предметов, содержащих нужные материалы.");
                }
            }

            ImGui::Spacing();

            // Status check banner
            const game::CraftFail failReason = game::craft_check(crafting, inv, curId, currentStation);
            if (failReason == game::CraftFail::None) {
                ImGui::TextColored(ImVec4(0.35f, 0.95f, 0.45f, 1.0f),
                                   "● СТАТУС: ВСЕ ТРЕБОВАНИЯ ВЫПОЛНЕНЫ — ГОТОВ К СБОРКЕ");
            } else {
                switch (failReason) {
                    case game::CraftFail::NotLearned:
                    case game::CraftFail::NotDiscoverable:
                        ImGui::TextColored(ImVec4(0.95f, 0.40f, 0.40f, 1.0f),
                                           "● СТАТУС: ЧЕРТЕЖ НЕ ИЗУЧЕН (Найдите схему или разберите предмет на верстаке)");
                        break;
                    case game::CraftFail::StationMismatch:
                        ImGui::TextColored(ImVec4(0.95f, 0.60f, 0.20f, 1.0f),
                                           "● СТАТУС: ТРЕБУЕТСЯ СТАНЦИЯ: %s",
                                           station_name_str(static_cast<game::CraftStation>(curRec.station)));
                        break;
                    case game::CraftFail::TierTooHigh:
                        ImGui::TextColored(ImVec4(0.95f, 0.40f, 0.40f, 1.0f),
                                           "● СТАТУС: НЕДОСТАТОЧЕН УРОВЕНЬ ДОПУСКА (Требуется T%u, текущий T%u)",
                                           curRec.tier, crafting.tier);
                        break;
                    case game::CraftFail::InsufficientMaterials:
                        ImGui::TextColored(ImVec4(0.95f, 0.80f, 0.30f, 1.0f),
                                           "● СТАТУС: НЕДОСТАТОЧНО МАТЕРИАЛОВ В БАНКЕ");
                        break;
                    case game::CraftFail::InventoryFull:
                        ImGui::TextColored(ImVec4(0.95f, 0.40f, 0.40f, 1.0f),
                                           "● СТАТУС: РЮКЗАК ПЕРЕПОЛНЕН (НЕТ СВОБОДНЫХ СЛОТОВ)");
                        break;
                    default:
                        ImGui::TextColored(ImVec4(0.95f, 0.40f, 0.40f, 1.0f),
                                           "● СТАТУС: %s", game::craft_fail_text(failReason));
                        break;
                }
            }

            ImGui::Spacing();
            ImGui::Separator();
            ImGui::Spacing();

            // Quantity selector controls (x1, x5, x10, max)
            const int maxCraftable = calculate_max_craftable(crafting, inv, curId);
            ImGui::Text("Количество для сборки:");
            ImGui::SameLine();
            if (ImGui::Button("x1", ImVec2(35.0f, 22.0f))) state.craftQty = 1;
            ImGui::SameLine();
            if (ImGui::Button("x5", ImVec2(35.0f, 22.0f))) state.craftQty = 5;
            ImGui::SameLine();
            if (ImGui::Button("x10", ImVec2(38.0f, 22.0f))) state.craftQty = 10;
            ImGui::SameLine();
            if (ImGui::Button("МАКС", ImVec2(48.0f, 22.0f))) {
                state.craftQty = std::max(1, maxCraftable);
            }
            ImGui::SameLine();
            ImGui::SetNextItemWidth(110.0f);
            ImGui::SliderInt("##craft_multiplier_slider", &state.craftQty, 1, 50);

            ImGui::Spacing();

            const bool canCraft = (failReason == game::CraftFail::None);
            if (!canCraft) ImGui::BeginDisabled();

            char craftBtnText[96];
            std::snprintf(craftBtnText, sizeof(craftBtnText), "СОЗДАТЬ: %s (x%d)##exec_craft",
                          curName, state.craftQty);

            if (ImGui::Button(craftBtnText, ImVec2(ImGui::GetContentRegionAvail().x, 38.0f))) {
                int createdCount = 0;
                for (int q = 0; q < state.craftQty; ++q) {
                    const game::CraftResult res = game::craft_item(crafting, inv, curId, currentStation);
                    if (res.fail == game::CraftFail::None) {
                        outCrafted++;
                        createdCount++;
                    } else {
                        break;
                    }
                }
                if (createdCount > 0) {
                    if (audioSys) audioSys->trigger_ui(audio::UiSound::InventoryRustle);
                    game::sync_armour(reg, pool, player);
                    std::snprintf(state.statusMsg, sizeof(state.statusMsg),
                                  "Успешно создано: %d шт. %s", createdCount, curName);
                } else {
                    if (audioSys) audioSys->trigger_ui(audio::UiSound::ErrorChirp);
                }
            }
            if (!canCraft) ImGui::EndDisabled();
        }

        ImGui::Columns(1);
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    // Footer & Status Notification Bar
    if (state.statusMsg[0] != '\0') {
        ImGui::TextColored(ImVec4(0.40f, 0.95f, 0.50f, 1.0f), ">>> %s", state.statusMsg);
    } else {
        ImGui::TextColored(ImVec4(0.60f, 0.60f, 0.60f, 1.0f),
                           "GigaHrush 2 Crafting & Barter Architecture | [Esc / E] Закрыть");
    }

    ImGui::SameLine(ImGui::GetWindowWidth() - 140.0f);
    if (ImGui::Button("Закрыть [Esc]", ImVec2(120.0f, 24.0f)) ||
        (ImGui::IsKeyPressed(ImGuiKey_Escape) && !io.WantTextInput)) {
        state.open = false;
    }

    ImGui::End();
}

void DrawCraftingWindowUI(bool* p_open,
                          game::CraftingState& crafting,
                          game::Inventory& inv,
                          game::CraftStation currentStation,
                          std::uint64_t simTick,
                          Registry& reg,
                          Entity player,
                          game::NpcPool& pool,
                          std::uint32_t& outCrafted,
                          std::uint32_t& outScrapped,
                          std::uint32_t& outLearned) {
    if (!p_open || !*p_open) return;
    CraftUIState state{};
    state.open = *p_open;
    draw_crafting_window_ui(state, crafting, inv, currentStation, simTick, reg, player, pool, nullptr, outCrafted, outScrapped, outLearned);
    *p_open = state.open;
}

} // namespace giga
