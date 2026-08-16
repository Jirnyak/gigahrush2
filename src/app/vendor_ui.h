// Interactive Vendor Trading UI for GigaHrush 2.
#pragma once

#include <cstdint>
#include "game/faction.h"
#include "game/inventory.h"
#include "game/rpg.h"
#include "game/save.h"
#include "game/vendor.h"

namespace giga {

struct VendorUIState {
    bool open = false;
    char buyFilter[64] = {};
    int buyQty = 1;
    int selectedCategory = -1; // -1 = All, 0..8 = ItemCategory
    int selectedVendorItemId = -1;
    int selectedPlayerSlot = -1;
};

// Render full two-column barter/trade window (Vendor Stock vs Player Inventory).
void draw_vendor_trading_ui(VendorUIState& state,
                            game::Inventory& inv,
                            game::RunLedger& ledger,
                            game::VendorKind vendorKind,
                            bool isOnPad,
                            std::int32_t& outSold,
                            std::int32_t& outSpent,
                            const game::RpgStats* rpg = nullptr,
                            std::int8_t playerRelation = 0,
                            game::Faction vendorFaction = game::Faction::Citizens);

// Backward-compatible signature matching existing calls.
void DrawVendorWindowUI(bool* p_open,
                        game::Inventory& inv,
                        game::RunLedger& ledger,
                        game::VendorKind vendorKind,
                        bool isOnPad,
                        std::int32_t& outSold,
                        std::int32_t& outSpent,
                        const game::RpgStats* rpg = nullptr,
                        std::int8_t playerRelation = 0,
                        game::Faction vendorFaction = game::Faction::Citizens);

} // namespace giga
