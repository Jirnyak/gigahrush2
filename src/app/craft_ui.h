// Interactive Workbench & Crafting UI for GigaHrush 2.
#pragma once

#include <cstdint>
#include "audio/audio_system.h"
#include "ecs/registry.h"
#include "game/craft.h"
#include "game/inventory.h"
#include "game/npc_pool.h"

namespace giga {

struct CraftUIState {
    bool open = false;
    int selectedTab = 0;          // 0: All, 1: Medicine, 2: Weapons, 3: Ammo, 4: Gear, 5: Tools, 6: Disassembly, 7: Repair
    int selectedRecipeId = 1;     // currently selected ItemId (1..442)
    int craftQty = 1;             // multiplier quantity
    char recipeFilter[64] = {};   // search query
    bool showOnlyKnown = false;   // filter: only learned blueprints
    bool showOnlyCraftable = false; // filter: only recipes with sufficient materials and station match
    int selectedDisasmSlot = -1;
    int selectedRepairSlot = -1;
    char statusMsg[128] = {};
    float statusTimer = 0.0f;
};

// Render full multi-category interactive Workbench & Crafting Studio modal.
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
                             std::uint32_t& outLearned);

// Backward-compatible signature matching existing calls.
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
                          std::uint32_t& outLearned);

} // namespace giga
