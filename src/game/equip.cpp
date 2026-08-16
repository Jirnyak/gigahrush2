#include "game/equip.h"

#include <algorithm>

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
    if (s.item == 0 || s.count == 0 || !item_valid(s.item)) return kInvalidItem;
    return s.item;
}

ItemSlot* equipped_slot(Inventory& inv, const Equipped& eq, EquipSlot slot) {
    const std::uint8_t idx = slot_for_enum(eq, slot);
    if (idx >= kInvSlots) return nullptr;
    ItemSlot& s = inv.slots[idx];
    if (s.item == 0 || s.count == 0 || !item_valid(s.item)) return nullptr;
    return &s;
}

const ItemSlot* equipped_slot(const Inventory& inv, const Equipped& eq, EquipSlot slot) {
    const std::uint8_t idx = slot_for_enum(eq, slot);
    if (idx >= kInvSlots) return nullptr;
    const ItemSlot& s = inv.slots[idx];
    if (s.item == 0 || s.count == 0 || !item_valid(s.item)) return nullptr;
    return &s;
}

bool equip_item(Inventory& inv, Equipped& eq, std::uint8_t slotIdx) {
    if (slotIdx >= kInvSlots) return false;
    const ItemSlot& s = inv.slots[slotIdx];
    if (s.item == 0 || s.count == 0 || !item_valid(s.item)) return false;
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
    auto is_slot_empty_or_broken = [&](EquipSlot slot) -> bool {
        const ItemSlot* s = equipped_slot(inv, eq, slot);
        return (s == nullptr || s->condition == 0);
    };

    // First pass: look for working (condition > 0) items for empty or broken slots
    for (std::uint8_t i = 0; i < static_cast<std::uint8_t>(kInvSlots); ++i) {
        const ItemSlot& s = inv.slots[i];
        if (s.item == 0 || s.count == 0 || !item_valid(s.item) || s.condition == 0) continue;
        const ItemDef& d = item_def(s.item);
        const EquipSlot slot = static_cast<EquipSlot>(d.equipSlot);
        if (slot == EquipSlot::Weapon && is_slot_empty_or_broken(EquipSlot::Weapon)) {
            eq.weapon = i;
        } else if (slot == EquipSlot::Armor && is_slot_empty_or_broken(EquipSlot::Armor)) {
            eq.armor = i;
        } else if (slot == EquipSlot::Tool && is_slot_empty_or_broken(EquipSlot::Tool)) {
            eq.tool = i;
        }
    }

    // Second pass fallback: if still empty, equip any valid item (even condition 0)
    for (std::uint8_t i = 0; i < static_cast<std::uint8_t>(kInvSlots); ++i) {
        const ItemSlot& s = inv.slots[i];
        if (s.item == 0 || s.count == 0 || !item_valid(s.item)) continue;
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

bool has_working_filter(const Inventory& inv, const Equipped& eq) {
    // 1. Check tool slot (e.g. ip4_gasmask)
    if (const ItemSlot* ts = equipped_slot(inv, eq, EquipSlot::Tool)) {
        if (ts->condition > 0 && item_valid(ts->item)) {
            const ItemDef& def = item_def(ts->item);
            if (def.wearKind == static_cast<std::uint8_t>(WearKind::Fouling)) {
                return true;
            }
        }
    }
    // 2. Check armor slot (e.g. hazmat suit integrated mask if any)
    if (const ItemSlot* as = equipped_slot(inv, eq, EquipSlot::Armor)) {
        if (as->condition > 0 && item_valid(as->item)) {
            const ItemDef& def = item_def(as->item);
            if (def.wearKind == static_cast<std::uint8_t>(WearKind::Fouling)) {
                return true;
            }
        }
    }
    return false;
}

bool has_hazmat_protection(const Inventory& inv, const Equipped& eq) {
    if (const ItemSlot* as = equipped_slot(inv, eq, EquipSlot::Armor)) {
        if (as->condition > 0 && item_valid(as->item)) {
            const ItemDef& def = item_def(as->item);
            // Check for chemical, environmental or thermal resistance channels
            if (def.resist[3] > 0 || def.resist[2] > 0 || def.resist[0] >= 60) {
                return true;
            }
        }
    }
    return false;
}

std::uint8_t degrade_equipped_filter(Inventory& inv, const Equipped& eq, std::uint8_t amount) {
    if (amount == 0) return 0;
    ItemSlot* ts = equipped_slot(inv, eq, EquipSlot::Tool);
    if (ts && ts->condition > 0 && item_valid(ts->item)) {
        const ItemDef& def = item_def(ts->item);
        if (def.wearKind == static_cast<std::uint8_t>(WearKind::Fouling)) {
            const std::uint8_t lost = std::min(amount, ts->condition);
            ts->condition = static_cast<std::uint8_t>(ts->condition - lost);
            return lost;
        }
    }
    ItemSlot* as = equipped_slot(inv, eq, EquipSlot::Armor);
    if (as && as->condition > 0 && item_valid(as->item)) {
        const ItemDef& def = item_def(as->item);
        if (def.wearKind == static_cast<std::uint8_t>(WearKind::Fouling)) {
            const std::uint8_t lost = std::min(amount, as->condition);
            as->condition = static_cast<std::uint8_t>(as->condition - lost);
            return lost;
        }
    }
    return 0;
}

std::uint8_t degrade_equipped_durability(Inventory& inv, const Equipped& eq, EquipSlot slot, std::uint8_t amount) {
    if (amount == 0 || slot == EquipSlot::None || slot >= EquipSlot::Count) return 0;
    ItemSlot* s = equipped_slot(inv, eq, slot);
    if (!s || s->condition == 0 || !item_valid(s->item)) return 0;
    const std::uint8_t lost = std::min(amount, s->condition);
    s->condition = static_cast<std::uint8_t>(s->condition - lost);
    return lost;
}

} // namespace giga::game
