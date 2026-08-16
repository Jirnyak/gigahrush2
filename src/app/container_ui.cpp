// Interactive Container Looting UI implementation for GigaHrush 2.
#include "app/container_ui.h"

#include <cstdio>
#include "imgui.h"
#include "game/encumbrance.h"
#include "game/item_table.h"
#include "game/loot.h"

namespace giga {

namespace {

const char* container_kind_name(game::ContainerKind kind) {
    switch (kind) {
        case game::ContainerKind::PublicBox:   return "Ящик экстренной помощи / Public Box";
        case game::ContainerKind::RoomStash:   return "Тайник в комнате / Room Stash";
        case game::ContainerKind::Safe:        return "Бронированный сейф / Safe";
        case game::ContainerKind::WeaponCrate: return "Оружейный ящик / Weapon Crate";
        default:                               return "Контейнер / Container";
    }
}

const char* item_category_label(game::ItemCategory cat) {
    switch (cat) {
        case game::ItemCategory::Weapon:   return "Оружие";
        case game::ItemCategory::Food:     return "Еда";
        case game::ItemCategory::Drink:    return "Напиток";
        case game::ItemCategory::Medicine: return "Медикамент";
        case game::ItemCategory::Ammo:     return "Патроны";
        case game::ItemCategory::Tool:     return "Инструмент";
        case game::ItemCategory::Note:     return "Документ";
        case game::ItemCategory::Key:      return "Ключ";
        default:                           return "Разное";
    }
}

} // namespace

bool draw_container_loot_ui(ContainerUIState& state,
                            game::Inventory& playerInv,
                            game::Container* container,
                            game::Corpse* corpse,
                            const game::RpgStats* rpg) {
    if (!state.open || (!container && !corpse)) return false;

    bool inventoryChanged = false;
    ImGuiIO& io = ImGui::GetIO();

    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                           ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(960.0f, 620.0f), ImGuiCond_Appearing);

    char winTitle[128];
    if (state.isCorpse) {
        std::snprintf(winTitle, sizeof(winTitle), "ОСМОТР ТЕЛА / LOOT CORPSE##container_window");
    } else {
        std::snprintf(winTitle, sizeof(winTitle), "ОСМОТР ХРАНИЛИЩА / %s##container_window",
                      container_kind_name(state.kind));
    }

    if (!ImGui::Begin(winTitle, &state.open,
                      ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoSavedSettings)) {
        ImGui::End();
        return false;
    }

    // 1. Header: Container Type, Total Value, Player Capacity & Overload Warning
    const std::uint32_t carriedMassG = game::inventory_mass_g(playerInv);
    const std::uint32_t capacityG = rpg ? game::carry_capacity_g(*rpg) : 64000;
    const float weightFrac = capacityG > 0 ? static_cast<float>(carriedMassG) / static_cast<float>(capacityG) : 0.0f;

    // Count items and value inside container
    int containerItemsCount = 0;
    std::int32_t containerTotalValue = 0;
    if (container) {
        for (int i = 0; i < game::kContainerSlots; ++i) {
            if (game::item_valid(container->item[i]) && container->count[i] > 0) {
                ++containerItemsCount;
                containerTotalValue += game::item_def(container->item[i]).value * container->count[i];
            }
        }
    } else if (corpse) {
        for (std::size_t i = 0; i < game::kMaxCorpseSlots; ++i) {
            if (game::item_valid(corpse->lootSlots[i].item) && corpse->lootSlots[i].count > 0) {
                ++containerItemsCount;
                containerTotalValue += game::item_def(corpse->lootSlots[i].item).value * corpse->lootSlots[i].count;
            }
        }
    }

    if (state.isCorpse) {
        ImGui::TextColored(ImVec4(0.95f, 0.40f, 0.40f, 1.0f), "[ОСТАНКИ / CORPSE]");
    } else {
        ImGui::TextColored(ImVec4(0.40f, 0.85f, 0.95f, 1.0f), "[%s]", container_kind_name(state.kind));
    }
    ImGui::SameLine();
    ImGui::TextColored(ImVec4(0.90f, 0.90f, 0.80f, 1.0f), "| Предметов: %d | Оценка: %d руб.",
                       containerItemsCount, containerTotalValue);

    // Player carried weight bar
    ImGui::SameLine(ImGui::GetWindowWidth() - 320.0f);
    char weightBuf[64];
    std::snprintf(weightBuf, sizeof(weightBuf), "Вес: %.1f / %.1f кг",
                  static_cast<float>(carriedMassG) / 1000.0f,
                  static_cast<float>(capacityG) / 1000.0f);
    ImVec4 barColor = (weightFrac > 1.0f) ? ImVec4(0.95f, 0.25f, 0.25f, 1.0f)
                    : (weightFrac > 0.8f) ? ImVec4(0.95f, 0.75f, 0.25f, 1.0f)
                                          : ImVec4(0.35f, 0.85f, 0.45f, 1.0f);
    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, barColor);
    ImGui::ProgressBar(weightFrac, ImVec2(200.0f, 18.0f), weightBuf);
    ImGui::PopStyleColor();

    if (weightFrac > 1.0f) {
        ImGui::SameLine();
        ImGui::TextColored(ImVec4(1.0f, 0.25f, 0.25f, 1.0f), "[ПЕРЕГРУЗ]");
    }

    ImGui::Separator();
    ImGui::Spacing();

    // 2. Dual Pane: Left = Container Storage, Right = Player 8x8 Backpack Grid
    ImGui::Columns(2, "##container_loot_columns", true);
    ImGui::SetColumnWidth(0, 440.0f);

    // =======================================================================
    // LEFT PANE: CONTAINER CONTENTS
    // =======================================================================
    ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.40f, 1.0f), "СОДЕРЖИМОЕ ХРАНИЛИЩА / LOOT");
    ImGui::Spacing();

    // Take All button
    bool doTakeAll = false;
    if (ImGui::Button("Забрать всё / Take All [T / Пробел]", ImVec2(ImGui::GetContentRegionAvail().x, 28.0f)) ||
        (ImGui::IsKeyPressed(ImGuiKey_T) && !io.WantTextInput) ||
        (ImGui::IsKeyPressed(ImGuiKey_Space) && !io.WantTextInput)) {
        doTakeAll = true;
    }

    if (doTakeAll) {
        if (container) {
            for (int i = 0; i < game::kContainerSlots; ++i) {
                if (!game::item_valid(container->item[i]) || container->count[i] == 0) continue;
                const std::uint16_t unplaced = game::inventory_give(playerInv, container->item[i], container->count[i]);
                if (unplaced != container->count[i]) {
                    container->count[i] = static_cast<std::uint8_t>(unplaced);
                    if (unplaced == 0) container->item[i] = game::kInvalidItem;
                    inventoryChanged = true;
                }
            }
        } else if (corpse) {
            for (std::size_t i = 0; i < game::kMaxCorpseSlots; ++i) {
                if (!game::item_valid(corpse->lootSlots[i].item) || corpse->lootSlots[i].count == 0) continue;
                const std::uint16_t unplaced = game::inventory_give(playerInv, corpse->lootSlots[i].item, corpse->lootSlots[i].count);
                if (unplaced != corpse->lootSlots[i].count) {
                    corpse->lootSlots[i].count = unplaced;
                    if (unplaced == 0) corpse->lootSlots[i] = game::ItemSlot{};
                    inventoryChanged = true;
                }
            }
        }
    }

    ImGui::Spacing();

    // List Container Slots
    ImGui::BeginChild("##container_slot_list", ImVec2(0.0f, 410.0f), true);

    int renderedSlots = 0;
    if (container) {
        for (int i = 0; i < game::kContainerSlots; ++i) {
            if (!game::item_valid(container->item[i]) || container->count[i] == 0) continue;
            ++renderedSlots;

            const game::ItemId id = container->item[i];
            const char* name = game::item_name(id);
            const game::ItemDef& def = game::item_def(id);

            char itemBtnLabel[128];
            std::snprintf(itemBtnLabel, sizeof(itemBtnLabel), "%s x%u (%d руб.)##cslot_%d",
                          name, container->count[i], def.value * container->count[i], i);

            if (ImGui::Button(itemBtnLabel, ImVec2(ImGui::GetContentRegionAvail().x - 70.0f, 32.0f))) {
                // Transfer single item slot into backpack
                const std::uint16_t unplaced = game::inventory_give(playerInv, id, container->count[i]);
                if (unplaced != container->count[i]) {
                    container->count[i] = static_cast<std::uint8_t>(unplaced);
                    if (unplaced == 0) container->item[i] = game::kInvalidItem;
                    inventoryChanged = true;
                }
            }
            if (ImGui::IsItemHovered()) {
                ImGui::BeginTooltip();
                ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.40f, 1.0f), "%s", name);
                ImGui::Text("Категория: %s", item_category_label(static_cast<game::ItemCategory>(def.category)));
                ImGui::Text("Стоимость: %d руб.", def.value);
                ImGui::Text("Вес: %.2f кг (%u г)", static_cast<float>(def.massG) / 1000.0f, def.massG);
                ImGui::TextColored(ImVec4(0.4f, 0.9f, 0.4f, 1.0f), "Нажмите ЛКМ чтобы забрать в рюкзак");
                ImGui::EndTooltip();
            }

            ImGui::SameLine();
            char takeBtnLabel[32];
            std::snprintf(takeBtnLabel, sizeof(takeBtnLabel), "Взять##tb_%d", i);
            if (ImGui::Button(takeBtnLabel, ImVec2(60.0f, 32.0f))) {
                const std::uint16_t unplaced = game::inventory_give(playerInv, id, container->count[i]);
                if (unplaced != container->count[i]) {
                    container->count[i] = static_cast<std::uint8_t>(unplaced);
                    if (unplaced == 0) container->item[i] = game::kInvalidItem;
                    inventoryChanged = true;
                }
            }
            ImGui::Spacing();
        }
    } else if (corpse) {
        for (std::size_t i = 0; i < game::kMaxCorpseSlots; ++i) {
            if (!game::item_valid(corpse->lootSlots[i].item) || corpse->lootSlots[i].count == 0) continue;
            ++renderedSlots;

            const game::ItemId id = corpse->lootSlots[i].item;
            const char* name = game::item_name(id);
            const game::ItemDef& def = game::item_def(id);

            char itemBtnLabel[128];
            std::snprintf(itemBtnLabel, sizeof(itemBtnLabel), "%s x%u (%d руб.)##corpseslot_%zu",
                          name, corpse->lootSlots[i].count, def.value * corpse->lootSlots[i].count, i);

            if (ImGui::Button(itemBtnLabel, ImVec2(ImGui::GetContentRegionAvail().x - 70.0f, 32.0f))) {
                const std::uint16_t unplaced = game::inventory_give(playerInv, id, corpse->lootSlots[i].count);
                if (unplaced != corpse->lootSlots[i].count) {
                    corpse->lootSlots[i].count = unplaced;
                    if (unplaced == 0) corpse->lootSlots[i] = game::ItemSlot{};
                    inventoryChanged = true;
                }
            }
            if (ImGui::IsItemHovered()) {
                ImGui::BeginTooltip();
                ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.40f, 1.0f), "%s", name);
                ImGui::Text("Категория: %s", item_category_label(static_cast<game::ItemCategory>(def.category)));
                ImGui::Text("Стоимость: %d руб.", def.value);
                ImGui::Text("Вес: %.2f кг (%u г)", static_cast<float>(def.massG) / 1000.0f, def.massG);
                ImGui::Text("Состояние: %u%%", static_cast<unsigned>(corpse->lootSlots[i].condition * 100 / 255));
                ImGui::TextColored(ImVec4(0.4f, 0.9f, 0.4f, 1.0f), "Нажмите ЛКМ чтобы забрать в рюкзак");
                ImGui::EndTooltip();
            }

            ImGui::SameLine();
            char takeBtnLabel[32];
            std::snprintf(takeBtnLabel, sizeof(takeBtnLabel), "Взять##tbc_%zu", i);
            if (ImGui::Button(takeBtnLabel, ImVec2(60.0f, 32.0f))) {
                const std::uint16_t unplaced = game::inventory_give(playerInv, id, corpse->lootSlots[i].count);
                if (unplaced != corpse->lootSlots[i].count) {
                    corpse->lootSlots[i].count = unplaced;
                    if (unplaced == 0) corpse->lootSlots[i] = game::ItemSlot{};
                    inventoryChanged = true;
                }
            }
            ImGui::Spacing();
        }
    }

    if (renderedSlots == 0) {
        ImGui::TextColored(ImVec4(0.60f, 0.60f, 0.60f, 1.0f),
                           "Хранилище пусто.\nВсе предметы перемещены в инвентарь.");
    }

    ImGui::EndChild();

    // =======================================================================
    // RIGHT PANE: PLAYER 8x8 INVENTORY GRID
    // =======================================================================
    ImGui::NextColumn();

    int freeSlots = 0;
    for (int i = 0; i < game::kInvSlots; ++i) {
        if (!game::item_valid(playerInv.slots[i].item) || playerInv.slots[i].count == 0) {
            ++freeSlots;
        }
    }

    ImGui::TextColored(ImVec4(0.40f, 0.90f, 0.50f, 1.0f), "РЮКЗАК ИГРОКА 8x8 (Свободно: %d / 64)", freeSlots);
    ImGui::Spacing();

    // Render 8x8 interactive inventory grid
    const float slotSize = 48.0f;
    const float slotSpacing = 4.0f;

    ImGui::BeginChild("##player_inv_grid_container", ImVec2(0.0f, 442.0f), true);

    for (int row = 0; row < game::kInvRows; ++row) {
        for (int col = 0; col < game::kInvCols; ++col) {
            const int slotIdx = row * game::kInvCols + col;
            game::ItemSlot& s = playerInv.slots[slotIdx];

            char slotBtnId[32];
            std::snprintf(slotBtnId, sizeof(slotBtnId), "##pslot_%d", slotIdx);

            const bool hasItem = game::item_valid(s.item) && s.count > 0;

            if (hasItem) {
                const char* itemName = game::item_name(s.item);
                const game::ItemDef& def = game::item_def(s.item);

                // Slot color based on category
                ImVec4 btnColor = ImVec4(0.20f, 0.22f, 0.24f, 1.0f);
                if (static_cast<game::ItemCategory>(def.category) == game::ItemCategory::Weapon) {
                    btnColor = ImVec4(0.35f, 0.18f, 0.18f, 1.0f);
                } else if (static_cast<game::ItemCategory>(def.category) == game::ItemCategory::Medicine) {
                    btnColor = ImVec4(0.18f, 0.35f, 0.22f, 1.0f);
                } else if (static_cast<game::ItemCategory>(def.category) == game::ItemCategory::Ammo) {
                    btnColor = ImVec4(0.35f, 0.30f, 0.15f, 1.0f);
                }

                ImGui::PushStyleColor(ImGuiCol_Button, btnColor);
                if (ImGui::Button(slotBtnId, ImVec2(slotSize, slotSize))) {
                    // Quick store from player to container if container has an empty slot
                    if (container) {
                        for (int ci = 0; ci < game::kContainerSlots; ++ci) {
                            if (!game::item_valid(container->item[ci]) || container->count[ci] == 0) {
                                container->item[ci] = s.item;
                                container->count[ci] = static_cast<std::uint8_t>(s.count);
                                s = game::ItemSlot{};
                                inventoryChanged = true;
                                break;
                            }
                        }
                    }
                }
                ImGui::PopStyleColor();

                // Item tooltip
                if (ImGui::IsItemHovered()) {
                    ImGui::BeginTooltip();
                    ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.40f, 1.0f), "%s (x%u)", itemName, s.count);
                    ImGui::Text("Категория: %s", item_category_label(static_cast<game::ItemCategory>(def.category)));
                    ImGui::Text("Стоимость: %d руб.", def.value * s.count);
                    ImGui::Text("Вес: %.2f кг", static_cast<float>(def.massG * s.count) / 1000.0f);
                    ImGui::Text("Состояние: %u%%", static_cast<unsigned>(s.condition * 100 / 255));
                    if (container) {
                        ImGui::TextColored(ImVec4(0.4f, 0.8f, 0.9f, 1.0f), "Нажмите ЛКМ чтобы переложить в хранилище");
                    }
                    ImGui::EndTooltip();
                }

                // Overlay item text / count inside button
                ImVec2 btnMin = ImGui::GetItemRectMin();
                ImDrawList* drawList = ImGui::GetWindowDrawList();
                char countStr[16];
                std::snprintf(countStr, sizeof(countStr), "%u", s.count);
                drawList->AddText(ImVec2(btnMin.x + 3.0f, btnMin.y + 3.0f),
                                  IM_COL32(230, 230, 230, 240), countStr);

                // Small category indicator dot
                ImU32 dotColor = IM_COL32(180, 180, 180, 200);
                if (static_cast<game::ItemCategory>(def.category) == game::ItemCategory::Weapon) dotColor = IM_COL32(230, 80, 80, 255);
                else if (static_cast<game::ItemCategory>(def.category) == game::ItemCategory::Medicine) dotColor = IM_COL32(80, 230, 100, 255);
                else if (static_cast<game::ItemCategory>(def.category) == game::ItemCategory::Ammo) dotColor = IM_COL32(230, 200, 60, 255);
                drawList->AddCircleFilled(ImVec2(btnMin.x + slotSize - 6.0f, btnMin.y + 6.0f), 3.0f, dotColor);
            } else {
                // Empty slot
                ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.12f, 0.12f, 0.14f, 0.8f));
                ImGui::Button(slotBtnId, ImVec2(slotSize, slotSize));
                ImGui::PopStyleColor();
            }

            if (col < game::kInvCols - 1) {
                ImGui::SameLine(0.0f, slotSpacing);
            }
        }
    }

    ImGui::EndChild();

    ImGui::Columns(1);
    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    // 3. Footer Bar
    ImGui::TextColored(ImVec4(0.65f, 0.65f, 0.65f, 1.0f),
                       "[T / Пробел] Забрать всё | [ЛКМ] Взять / Положить | [E / Esc] Закрыть");
    ImGui::SameLine(ImGui::GetWindowWidth() - 140.0f);
    if (ImGui::Button("[E / Esc Закрыть]", ImVec2(120.0f, 24.0f)) ||
        (ImGui::IsKeyPressed(ImGuiKey_Escape) && !io.WantTextInput) ||
        (ImGui::IsKeyPressed(ImGuiKey_E) && !io.WantTextInput)) {
        state.open = false;
    }

    // Check if container was completely emptied
    if (container) {
        bool empty = true;
        for (int i = 0; i < game::kContainerSlots; ++i) {
            if (game::item_valid(container->item[i]) && container->count[i] > 0) {
                empty = false;
                break;
            }
        }
        if (empty) {
            container->opened = true;
        }
    } else if (corpse) {
        bool empty = true;
        for (std::size_t i = 0; i < game::kMaxCorpseSlots; ++i) {
            if (game::item_valid(corpse->lootSlots[i].item) && corpse->lootSlots[i].count > 0) {
                empty = false;
                break;
            }
        }
        if (empty) {
            corpse->searched = true;
        }
    }

    ImGui::End();
    return inventoryChanged;
}

} // namespace giga
