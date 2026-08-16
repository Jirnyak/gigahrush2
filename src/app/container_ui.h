// Interactive Container Looting UI for GigaHrush 2.
#pragma once

#include <cstdint>
#include "game/combat.h"
#include "game/container.h"
#include "game/inventory.h"
#include "game/rpg.h"

namespace giga {

struct ContainerUIState {
    bool open = false;
    char title[64] = "Контейнер / Container";
    char subTitle[64] = "";
    game::ContainerKind kind = game::ContainerKind::RoomStash;
    int selectedContainerSlot = -1;
    int selectedPlayerSlot = -1;
    bool isCorpse = false;
    std::uint32_t containerEntityId = 0;
};

// Render interactive Container Looting UI (Container contents vs Player 8x8 inventory grid).
// Supports crates, lockers, desks, safes, weapon boxes, and defeated NPC corpses.
// Returns true if any item was transferred.
bool draw_container_loot_ui(ContainerUIState& state,
                            game::Inventory& playerInv,
                            game::Container* container,
                            game::Corpse* corpse = nullptr,
                            const game::RpgStats* rpg = nullptr);

} // namespace giga
