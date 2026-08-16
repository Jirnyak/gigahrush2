// Character creation and Settings screen UI for GigaHrush 2.
#pragma once

#include <cstdint>
#include "ecs/registry.h"
#include "game/faction.h"
#include "game/inventory.h"
#include "game/npc_pool.h"
#include "game/role.h"
#include "game/rpg.h"

namespace giga {

struct CharCreationState {
    game::RoleId role = game::RoleId::Resident;
    int str = 5;
    int agi = 5;
    int end = 5;
    int intell = 5;
    int per = 5;
    int unallocated = 5;
    game::TraitId trait1 = game::TraitId::None;
    game::TraitId trait2 = game::TraitId::None;
};

// Populate inventory with starter equipment according to role archetype.
void populate_archetype_inventory(game::Inventory& inv, game::RoleId role);

// Draw Character Creation UI (Menu Page 3).
// Returns true if screen is active. Sets outBeginGame=true when player clicks "Начать экспедицию".
// Sets outBack=true when player clicks "Назад".
void draw_character_creation_ui(CharCreationState& state, bool& outBeginGame, bool& outBack);

// Draw Settings UI (Menu Page 4).
// Sets outBack=true when player clicks "Назад".
void draw_settings_menu_ui(bool& outBack);

// Apply character creation selections to live player entity, pool record, and carried progression.
void apply_character_creation(Registry& reg, Entity player, game::NpcPool& pool,
                              game::RpgStats& carriedRpg, const CharCreationState& cc);

} // namespace giga
