#include "game/equip.h"

namespace giga::game {

namespace {

inline std::uint8_t slot_for_enum(const Equipped& eq, EquipSlot slot) {
    switch (slot) {
        case EquipSlot::Weapon: return eq.weapon;
        case EquipSlot::Armor:  return eq.armor;
        case EquipSlot::Tool:   return eq.tool;
        default:                return kEquipNone;
    }
}

inline void set_slot_for_enum(Equipped& eq, EquipSlot slot, std::uint8_t idx) {
    switch (slot) {
        case EquipSlot::Weapon: eq.weapon = idx; break;
        case EquipSlot::Armor:  eq.armor  = idx; break;
        case EquipSlot::Tool:   eq.tool   = idx; break;
        default: break;
    }
}

} // namespace

ItemId equipped_item(const Inventory& inv, const Equipped& eq, EquipSlot slot) {
    const std::uint8_t idx = slot_for_enum(eq, slot);
    if (idx >= kInvSlots) return kInvalidItem;
    const ItemSlot& s = inv.slots[idx];
    if (s.item == 0 || s.count == 0) return kInvalidItem;
    return s.item;
}

ItemSlot* equipped_slot(Inventory& inv, const Equipped& eq, EquipSlot slot) {
    const std::uint8_t idx = slot_for_enum(eq, slot);
    if (idx >= kInvSlots) return nullptr;
    ItemSlot& s = inv.slots[idx];
    if (s.item == 0 || s.count == 0) return nullptr;
    return &s;
}

const ItemSlot* equipped_slot(const Inventory& inv, const Equipped& eq, EquipSlot slot) {
    const std::uint8_t idx = slot_for_enum(eq, slot);
    if (idx >= kInvSlots) return nullptr;
    const ItemSlot& s = inv.slots[idx];
    if (s.item == 0 || s.count == 0) return nullptr;
    return &s;
}

bool equip_item(Inventory& inv, Equipped& eq, std::uint8_t slotIdx) {
    if (slotIdx >= kInvSlots) return false;
    const ItemSlot& s = inv.slots[slotIdx];
    if (s.item == 0 || s.count == 0) return false;
    const ItemDef& d = item_def(s.item);
    const EquipSlot targetSlot = static_cast<EquipSlot>(d.equipSlot);
    if (targetSlot == EquipSlot::None || targetSlot >= EquipSlot::Count) {
        return false;
    }
    set_slot_for_enum(eq, targetSlot, slotIdx);
    return true;
}

bool unequip_slot(Equipped& eq, EquipSlot slot) {
    if (slot == EquipSlot::None || slot >= EquipSlot::Count) return false;
    set_slot_for_enum(eq, slot, kEquipNone);
    return true;
}

void auto_equip_best(const Inventory& inv, Equipped& eq) {
    for (std::uint8_t i = 0; i < static_cast<std::uint8_t>(kInvSlots); ++i) {
        const ItemSlot& s = inv.slots[i];
        if (s.item == 0 || s.count == 0) continue;
        const ItemDef& d = item_def(s.item);
        const EquipSlot slot = static_cast<EquipSlot>(d.equipSlot);
        if (slot == EquipSlot::Weapon && eq.weapon >= kInvSlots) {
            eq.weapon = i;
        } else if (slot == EquipSlot::Armor && eq.armor >= kInvSlots) {
            eq.armor = i;
        } else if (slot == EquipSlot::Tool && eq.tool >= kInvSlots) {
            eq.tool = i;
        }
    }
}

} // namespace giga::game
