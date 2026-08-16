// Interactive Vendor Trading UI implementation for GigaHrush 2.
#include "app/vendor_ui.h"

#include <cctype>
#include <cstdio>
#include <cstring>
#include "imgui.h"
#include "game/combat.h"
#include "game/encumbrance.h"
#include "game/faction.h"
#include "game/item_table.h"
#include "game/ranged_table.h"
#include "game/rpg.h"
#include "game/vendor.h"

namespace giga {

namespace {

static bool contains_icase_vendor(const char* haystack, const char* needle) {
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

const char* category_name(game::ItemCategory cat) {
    switch (cat) {
        case game::ItemCategory::Misc:     return "Разное / Misc";
        case game::ItemCategory::Weapon:   return "Оружие / Weapon";
        case game::ItemCategory::Food:     return "Еда / Food";
        case game::ItemCategory::Medicine: return "Медикаменты / Meds";
        case game::ItemCategory::Ammo:     return "Боеприпасы / Ammo";
        case game::ItemCategory::Tool:     return "Инструменты / Tool";
        case game::ItemCategory::Drink:    return "Напитки / Drink";
        case game::ItemCategory::Key:      return "Ключи / Key";
        case game::ItemCategory::Note:     return "Документы / Note";
        default:                           return "Другое / Other";
    }
}

} // namespace

void draw_vendor_trading_ui(VendorUIState& state,
                            game::Inventory& inv,
                            game::RunLedger& ledger,
                            game::VendorKind vendorKind,
                            bool isOnPad,
                            std::int32_t& outSold,
                            std::int32_t& outSpent,
                            const game::RpgStats* rpg,
                            std::int8_t playerRelation,
                            game::Faction vendorFaction) {
    if (!state.open) return;

    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f),
                           ImGuiCond_Appearing, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(1040.0f, 660.0f), ImGuiCond_Appearing);

    if (!ImGui::Begin("ТОРГОВАЯ ЛАВКА / TRADER BARTER & EXCHANGE##vendor_window", &state.open,
                      ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoSavedSettings)) {
        ImGui::End();
        return;
    }

    // 1. Header: Vendor Identity, Faction Affinity, Barter Multipliers, Bank Balance
    const char* vendorNames[] = {
        "Гражданский снабженец (Citizen Trader)",
        "Научный аванпост (Scientist Outpost)",
        "Дикий скупщик (Wild Zone Scavenger)"
    };
    const std::size_t vkIdx = static_cast<std::size_t>(vendorKind) < 3 ? static_cast<std::size_t>(vendorKind) : 0;
    const char* fName = game::faction_name(vendorFaction);
    const vec3 fc = game::faction_color(static_cast<std::uint16_t>(vendorFaction), 0);

    // Compute active multiplier percentages
    float effectiveBuyMult = game::kBuyMult;
    if (playerRelation > 0) {
        effectiveBuyMult -= (static_cast<float>(playerRelation) * 0.15f / 100.0f);
    } else if (playerRelation < 0) {
        effectiveBuyMult += (static_cast<float>(-playerRelation) * 0.25f / 100.0f);
    }

    float effectiveSellMult = game::kSellMult[vkIdx];
    if (playerRelation > 0) {
        effectiveSellMult += (static_cast<float>(playerRelation) * 0.15f / 100.0f);
    } else if (playerRelation < 0) {
        effectiveSellMult -= (static_cast<float>(-playerRelation) * 0.20f / 100.0f);
        if (effectiveSellMult < 0.10f) effectiveSellMult = 0.10f;
    }

    const std::uint32_t carriedMassG = game::inventory_mass_g(inv);
    const std::uint32_t capacityG = rpg ? game::carry_capacity_g(*rpg) : 64000;
    const float weightFrac = capacityG > 0 ? static_cast<float>(carriedMassG) / static_cast<float>(capacityG) : 0.0f;

    ImGui::TextColored(ImVec4(fc.x, fc.y, fc.z, 1.0f), "[%s]", fName);
    ImGui::SameLine();
    ImGui::TextColored(ImVec4(0.95f, 0.95f, 0.90f, 1.0f), "%s", vendorNames[vkIdx]);
    ImGui::SameLine();
    ImGui::TextColored(ImVec4(0.80f, 0.80f, 0.40f, 1.0f), "| Репутация: %+d", static_cast<int>(playerRelation));
    ImGui::SameLine();
    ImGui::TextColored(ImVec4(0.50f, 0.85f, 1.0f, 1.0f), "| Курс: Покупка x%.2f / Продажа x%.2f",
                       effectiveBuyMult, effectiveSellMult);

    ImGui::SameLine(ImGui::GetWindowWidth() - 250.0f);
    ImGui::TextColored(ImVec4(0.35f, 0.95f, 0.45f, 1.0f), "Баланс: %lld руб. (₽)",
                       static_cast<long long>(ledger.banked));

    // Carry weight and Pad Status
    char weightBuf[64];
    std::snprintf(weightBuf, sizeof(weightBuf), "Вес: %.1f / %.1f кг",
                  static_cast<float>(carriedMassG) / 1000.0f,
                  static_cast<float>(capacityG) / 1000.0f);
    ImVec4 barColor = (weightFrac > 1.0f) ? ImVec4(0.95f, 0.25f, 0.25f, 1.0f)
                    : (weightFrac > 0.8f) ? ImVec4(0.95f, 0.75f, 0.25f, 1.0f)
                                          : ImVec4(0.35f, 0.85f, 0.45f, 1.0f);
    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, barColor);
    ImGui::ProgressBar(weightFrac, ImVec2(240.0f, 16.0f), weightBuf);
    ImGui::PopStyleColor();

    if (weightFrac > 1.0f) {
        ImGui::SameLine();
        ImGui::TextColored(ImVec4(1.0f, 0.35f, 0.35f, 1.0f), "[ПЕРЕГРУЗ]");
    }

    if (!isOnPad) {
        ImGui::Spacing();
        ImGui::TextColored(ImVec4(1.0f, 0.45f, 0.35f, 1.0f),
                           "[ВНЕ ЗОНЫ ЭКСТРАКЦИИ] Прямая торговля доступна через диалог или на площадке эвакуации.");
    }

    ImGui::Separator();
    ImGui::Spacing();

    // 2. Two-Column Barter Interface: Left = Vendor Stock, Right = Player Inventory
    ImGui::Columns(2, "##vendor_trade_columns", true);
    ImGui::SetColumnWidth(0, ImGui::GetWindowWidth() * 0.54f);

    // =======================================================================
    // LEFT COLUMN: VENDOR STOCK / BUY CATALOG
    // =======================================================================
    ImGui::TextColored(ImVec4(0.40f, 0.90f, 0.50f, 1.0f), "АССОРТИМЕНТ ТОРГОВЦА / VENDOR STOCK");
    ImGui::Spacing();

    // Category filter bar
    struct CatFilter { int id; const char* label; };
    const CatFilter catFilters[] = {
        {-1, "Все"},
        {static_cast<int>(game::ItemCategory::Food), "Еда"},
        {static_cast<int>(game::ItemCategory::Drink), "Вода"},
        {static_cast<int>(game::ItemCategory::Medicine), "Аптечки"},
        {static_cast<int>(game::ItemCategory::Ammo), "Патроны"}
    };

    for (std::size_t ci = 0; ci < sizeof(catFilters)/sizeof(catFilters[0]); ++ci) {
        const bool active = (state.selectedCategory == catFilters[ci].id);
        if (active) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.20f, 0.50f, 0.35f, 1.0f));
        if (ImGui::Button(catFilters[ci].label, ImVec2(58.0f, 22.0f))) {
            state.selectedCategory = catFilters[ci].id;
        }
        if (active) ImGui::PopStyleColor();
        if (ci < sizeof(catFilters)/sizeof(catFilters[0]) - 1) ImGui::SameLine();
    }

    ImGui::Spacing();

    // Search and Quantity Selector
    ImGui::SetNextItemWidth(160.0f);
    ImGui::InputTextWithHint("##buy_search", "Поиск...", state.buyFilter, sizeof(state.buyFilter));
    ImGui::SameLine();
    ImGui::SetNextItemWidth(80.0f);
    ImGui::SliderInt("Кол-во##buy_qty", &state.buyQty, 1, 50);

    // Quick Resupply Button
    ImGui::SameLine();
    const bool canResupply = (ledger.banked >= 600);
    if (!canResupply) ImGui::BeginDisabled();
    if (ImGui::Button("Набор (600₽)", ImVec2(100.0f, 22.0f))) {
        outSpent += game::vendor_resupply(inv, ledger, 600);
    }
    if (!canResupply) ImGui::EndDisabled();
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("Быстрое пополнение: вода, медикаменты, патроны и консервы на 600 руб.");
    }

    // Ammo for equipped firearm shortcut
    const game::ItemId ammoForGun = game::vendor_ammo_for(inv);
    if (ammoForGun != game::kInvalidItem) {
        char ammoBtn[128];
        const std::int32_t aPrice = game::vendor_buy_price(ammoForGun, playerRelation);
        std::snprintf(ammoBtn, sizeof(ammoBtn), "Патроны к оружию: %s (%d₽)##ammo_btn",
                      game::item_name(ammoForGun), aPrice);
        const bool canBuyAmmo = (ledger.banked >= aPrice && aPrice > 0);
        if (!canBuyAmmo) ImGui::BeginDisabled();
        if (ImGui::Button(ammoBtn, ImVec2(ImGui::GetContentRegionAvail().x, 22.0f))) {
            const std::uint32_t bCount = game::vendor_buy(inv, ledger, ammoForGun,
                                                          static_cast<std::uint32_t>(state.buyQty), playerRelation);
            outSpent += static_cast<std::int32_t>(bCount * aPrice);
        }
        if (!canBuyAmmo) ImGui::EndDisabled();
    }

    ImGui::Spacing();

    // Stock items table
    if (ImGui::BeginTable("##VendorCatalogTable", 4,
                          ImGuiTableFlags_ScrollY | ImGuiTableFlags_Borders |
                          ImGuiTableFlags_RowBg | ImGuiTableFlags_Resizable,
                          ImVec2(0.0f, 380.0f))) {
        ImGui::TableSetupColumn("Наименование / Item", ImGuiTableColumnFlags_WidthStretch);
        ImGui::TableSetupColumn("Категория", ImGuiTableColumnFlags_WidthFixed, 90.0f);
        ImGui::TableSetupColumn("Цена / ₽", ImGuiTableColumnFlags_WidthFixed, 70.0f);
        ImGui::TableSetupColumn("Купить", ImGuiTableColumnFlags_WidthFixed, 85.0f);
        ImGui::TableHeadersRow();

        for (game::ItemId id = 1; id <= game::kItemCount; ++id) {
            if (!game::vendor_stocks_item(id)) continue;

            const game::ItemDef& def = game::item_def(id);
            if (state.selectedCategory >= 0 && static_cast<int>(def.category) != state.selectedCategory) {
                continue;
            }

            const char* name = game::item_name(id);
            if (state.buyFilter[0] != '\0' && !contains_icase_vendor(name, state.buyFilter)) continue;

            const std::int32_t unitPrice = game::vendor_buy_price(id, playerRelation);
            const std::int32_t totalBuyPrice = unitPrice * state.buyQty;
            const bool canAfford = (ledger.banked >= totalBuyPrice && unitPrice > 0);

            ImGui::TableNextRow();
            ImGui::TableSetColumnIndex(0);
            ImGui::Text("%s", name);
            if (ImGui::IsItemHovered()) {
                ImGui::BeginTooltip();
                ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.40f, 1.0f), "%s", name);
                ImGui::Text("Категория: %s", category_name(static_cast<game::ItemCategory>(def.category)));
                ImGui::Text("Базовая стоимость: %d руб.", def.value);
                ImGui::Text("Цена у торговца: %d руб. (курс x%.2f)", unitPrice, effectiveBuyMult);
                ImGui::Text("Вес единицы: %.2f кг (%u г)", static_cast<float>(def.massG) / 1000.0f, def.massG);
                ImGui::Text("Макс. в пачке: %u шт.", def.stackMax);
                ImGui::EndTooltip();
            }

            ImGui::TableSetColumnIndex(1);
            ImGui::TextDisabled("%s", category_name(static_cast<game::ItemCategory>(def.category)));

            ImGui::TableSetColumnIndex(2);
            ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.30f, 1.0f), "%d₽", unitPrice);

            ImGui::TableSetColumnIndex(3);
            char buyLabel[32];
            if (state.buyQty > 1) {
                std::snprintf(buyLabel, sizeof(buyLabel), "x%d##%u", state.buyQty, id);
            } else {
                std::snprintf(buyLabel, sizeof(buyLabel), "Купить##%u", id);
            }

            if (!canAfford) ImGui::BeginDisabled();
            if (ImGui::Button(buyLabel, ImVec2(75.0f, 20.0f))) {
                const std::uint32_t bought = game::vendor_buy(inv, ledger, id,
                                                              static_cast<std::uint32_t>(state.buyQty), playerRelation);
                outSpent += static_cast<std::int32_t>(bought * unitPrice);
            }
            if (!canAfford) ImGui::EndDisabled();
        }
        ImGui::EndTable();
    }

    // =======================================================================
    // RIGHT COLUMN: PLAYER INVENTORY / SELL SECTION
    // =======================================================================
    ImGui::NextColumn();

    ImGui::TextColored(ImVec4(0.95f, 0.75f, 0.30f, 1.0f), "РЮКЗАК ИГРОКА / PLAYER INVENTORY");
    ImGui::Spacing();

    const game::ItemId keepWeapon = game::equipped_melee(inv);
    const game::ItemId keepArmour = game::equipped_armour(inv);

    // Quick Sell All button
    if (ImGui::Button("Продать весь хабар / Sell All (до 12000₽)", ImVec2(ImGui::GetContentRegionAvail().x, 24.0f))) {
        outSold += game::vendor_sell_all(inv, ledger, vendorKind, rpg, playerRelation);
    }
    if (ImGui::IsItemHovered()) {
        ImGui::SetTooltip("Автоматически продать все ценные предметы и трофеи торговцу, сохраняя экипировку и минимальный запас выживания.");
    }

    ImGui::Spacing();

    // Player inventory items table
    if (ImGui::BeginTable("##PlayerSellInventoryTable", 5,
                          ImGuiTableFlags_ScrollY | ImGuiTableFlags_Borders |
                          ImGuiTableFlags_RowBg | ImGuiTableFlags_Resizable,
                          ImVec2(0.0f, 380.0f))) {
        ImGui::TableSetupColumn("Слот", ImGuiTableColumnFlags_WidthFixed, 40.0f);
        ImGui::TableSetupColumn("Предмет", ImGuiTableColumnFlags_WidthStretch);
        ImGui::TableSetupColumn("Шт.", ImGuiTableColumnFlags_WidthFixed, 35.0f);
        ImGui::TableSetupColumn("Цена/₽", ImGuiTableColumnFlags_WidthFixed, 60.0f);
        ImGui::TableSetupColumn("Продажа", ImGuiTableColumnFlags_WidthFixed, 110.0f);
        ImGui::TableHeadersRow();

        for (int slot = 0; slot < game::kInvSlots; ++slot) {
            game::ItemSlot& s = inv.slots[slot];
            if (!game::item_valid(s.item) || s.count == 0) continue;

            const char* name = game::item_name(s.item);
            const game::ItemDef& def = game::item_def(s.item);
            const bool isEquipped = (s.item == keepWeapon || s.item == keepArmour);
            const std::int32_t unitSell = game::vendor_sell_price(s.item, vendorKind, rpg, playerRelation);
            const std::int32_t totalSell = unitSell * s.count;

            ImGui::TableNextRow();
            ImGui::TableSetColumnIndex(0);
            ImGui::TextDisabled("#%02d", slot + 1);

            ImGui::TableSetColumnIndex(1);
            if (isEquipped) {
                ImGui::TextColored(ImVec4(0.40f, 0.85f, 0.95f, 1.0f), "%s [ЭКИП]", name);
            } else {
                ImGui::Text("%s", name);
            }
            if (ImGui::IsItemHovered()) {
                ImGui::BeginTooltip();
                ImGui::TextColored(ImVec4(0.95f, 0.85f, 0.40f, 1.0f), "%s", name);
                ImGui::Text("Категория: %s", category_name(static_cast<game::ItemCategory>(def.category)));
                ImGui::Text("Базовая стоимость: %d руб.", def.value);
                ImGui::Text("Цена выкупа: %d руб. (курс x%.2f)", unitSell, effectiveSellMult);
                ImGui::Text("Вес: %.2f кг", static_cast<float>(def.massG * s.count) / 1000.0f);
                ImGui::Text("Состояние: %u%%", static_cast<unsigned>(s.condition * 100 / 255));
                ImGui::EndTooltip();
            }

            ImGui::TableSetColumnIndex(2);
            ImGui::Text("%u", s.count);

            ImGui::TableSetColumnIndex(3);
            if (unitSell > 0) {
                ImGui::TextColored(ImVec4(0.35f, 0.95f, 0.45f, 1.0f), "%d₽", unitSell);
            } else {
                ImGui::TextDisabled("0₽");
            }

            ImGui::TableSetColumnIndex(4);
            char s1Label[32], sAllLabel[32];
            std::snprintf(s1Label, sizeof(s1Label), "1##s1_%d", slot);
            std::snprintf(sAllLabel, sizeof(sAllLabel), "Все##sa_%d", slot);

            const bool canSell = (unitSell > 0 && !isEquipped);
            if (!canSell) ImGui::BeginDisabled();

            if (ImGui::Button(s1Label, ImVec2(45.0f, 20.0f))) {
                ledger.banked += unitSell;
                outSold += unitSell;
                s.count--;
                if (s.count == 0) {
                    s.item = game::kInvalidItem;
                    s.condition = 255;
                }
            }
            ImGui::SameLine();
            if (ImGui::Button(sAllLabel, ImVec2(50.0f, 20.0f))) {
                ledger.banked += totalSell;
                outSold += totalSell;
                s.count = 0;
                s.item = game::kInvalidItem;
                s.condition = 255;
            }

            if (!canSell) ImGui::EndDisabled();
        }
        ImGui::EndTable();
    }

    ImGui::Columns(1);
    ImGui::Spacing();
    ImGui::Separator();
    ImGui::Spacing();

    // 3. Footer Bar: Summary and Close
    ImGui::TextColored(ImVec4(0.80f, 0.80f, 0.70f, 1.0f),
                       "ИТОГО В СЕССИИ: Продано хабара на %d руб. | Куплено припасов на %d руб.",
                       outSold, outSpent);
    ImGui::SameLine(ImGui::GetWindowWidth() - 140.0f);
    if (ImGui::Button("[Esc / Закрыть]", ImVec2(120.0f, 24.0f)) ||
        (ImGui::IsKeyPressed(ImGuiKey_Escape) && !io.WantTextInput)) {
        state.open = false;
    }

    ImGui::End();
}

void DrawVendorWindowUI(bool* p_open,
                        game::Inventory& inv,
                        game::RunLedger& ledger,
                        game::VendorKind vendorKind,
                        bool isOnPad,
                        std::int32_t& outSold,
                        std::int32_t& outSpent,
                        const game::RpgStats* rpg,
                        std::int8_t playerRelation,
                        game::Faction vendorFaction) {
    if (!p_open || !*p_open) return;
    static VendorUIState s_vendorState{};
    s_vendorState.open = *p_open;
    draw_vendor_trading_ui(s_vendorState, inv, ledger, vendorKind, isOnPad,
                           outSold, outSpent, rpg, playerRelation, vendorFaction);
    *p_open = s_vendorState.open;
}

} // namespace giga
