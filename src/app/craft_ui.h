// Окно верстака и сборки ([items.md], [craft.h]).
//
// Вынесено из main.cpp в изолированный модуль UI.
// Рисует две вкладки: "Сборка" (по рецептам крафта) и "Разбор" (разбор предметов из инвентаря).
#pragma once

#include "ecs/registry.h"
#include "game/craft.h"
#include "game/inventory.h"
#include "game/npc_pool.h"
#include <cstdint>

namespace giga {

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
                             std::uint32_t& outLearned);

} // namespace giga
