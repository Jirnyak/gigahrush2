// Equipped item references for embodied entities — closing Spec 03 §3.3.
// Carries indices into the 64-slot Inventory POD rather than duplicating items.
#pragma once

#include <cstddef>
#include <cstdint>
#include "game/inventory.h"
#include "game/item_table.h"

namespace giga::game {

inline constexpr std::uint8_t kEquipNone = 0xFFu;

// Equipped items component on an embodied entity.
// Indexes into the entity's Inventory slots (0..63).
struct Equipped {
    std::uint8_t weapon = kEquipNone;
    std::uint8_t armor  = kEquipNone;
    std::uint8_t tool   = kEquipNone;
    std::uint8_t pad_   = 0;
};
static_assert(sizeof(Equipped) == 4, "Equipped must stay 4 bytes POD");

// Read what ItemId is equipped in a slot.
ItemId equipped_item(const Inventory& inv, const Equipped& eq, EquipSlot slot);

// Retrieve pointer to the equipped ItemSlot, or nullptr if none/empty.
ItemSlot* equipped_slot(Inventory& inv, const Equipped& eq, EquipSlot slot);
const ItemSlot* equipped_slot(const Inventory& inv, const Equipped& eq, EquipSlot slot);

// Equip an item from a specific inventory slot. Returns true if equipped.
bool equip_item(Inventory& inv, Equipped& eq, std::uint8_t slotIdx);

// Unequip a slot.
bool unequip_slot(Equipped& eq, EquipSlot slot);

// Scan inventory and automatically equip best weapon/armor/tool if slots are empty or broken.
void auto_equip_best(const Inventory& inv, Equipped& eq);

// Check if the entity has a functional gas mask / respiratory filter equipped.
bool has_working_filter(const Inventory& inv, const Equipped& eq);

// Check if the entity has environmental/hazmat armor protection equipped.
bool has_hazmat_protection(const Inventory& inv, const Equipped& eq);

// Degrade the condition of the equipped fouling tool/filter by `amount`.
// Returns the actual amount degraded.
std::uint8_t degrade_equipped_filter(Inventory& inv, const Equipped& eq, std::uint8_t amount);

// Degrade the condition of the equipped item in `slot` by `amount`.
// Returns the actual amount degraded.
std::uint8_t degrade_equipped_durability(Inventory& inv, const Equipped& eq, EquipSlot slot, std::uint8_t amount);

} // namespace giga::game
