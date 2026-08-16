#include "game/equip.h"

#include <algorithm>

#include "core/rng.h"          // hash_u32, rand_below — the wear roll
#include "game/weapon_table.h" // melee_for_item — the melee durability source

namespace giga::game {

namespace {

std::uint8_t* eq_cell(Equipped& eq, EquipSlot slot) {
    switch (slot) {
        case EquipSlot::Weapon: return &eq.weapon;
        case EquipSlot::Armor:  return &eq.armor;
        case EquipSlot::Tool:   return &eq.tool;
        default:                return nullptr;
    }
}

const std::uint8_t* eq_cell(const Equipped& eq, EquipSlot slot) {
    return eq_cell(const_cast<Equipped&>(eq), slot);
}

} // namespace

bool equip_item(const Inventory& inv, Equipped& eq, std::uint8_t slotIdx) {
    if (slotIdx >= kInvSlots) return false;
    const ItemSlot& s = inv.slots[slotIdx];
    if (s.item == kInvalidItem || s.count == 0 || !item_valid(s.item)) return false;
    const EquipSlot target = static_cast<EquipSlot>(item_def(s.item).equipSlot);
    std::uint8_t* cell = eq_cell(eq, target);
    if (!cell) return false; // equip_slot=None: предмет не носится
    *cell = slotIdx;
    return true;
}

bool unequip_slot(Equipped& eq, EquipSlot slot) {
    std::uint8_t* cell = eq_cell(eq, slot);
    if (!cell) return false;
    *cell = kEquipNone;
    return true;
}

int equipped_index(const Inventory& inv, const Equipped& eq, EquipSlot slot) {
    const std::uint8_t* cell = eq_cell(eq, slot);
    if (!cell || *cell >= kInvSlots) return -1;
    const ItemSlot& s = inv.slots[*cell];
    // Протухший индекс — не ошибка, а «решения больше нет»: инвентарь мутировал
    // после записи (продажа, разлив, банк). Валидация по данным, не по памяти.
    if (s.item == kInvalidItem || s.count == 0 || !item_valid(s.item)) return -1;
    if (static_cast<EquipSlot>(item_def(s.item).equipSlot) != slot) return -1;
    return static_cast<int>(*cell);
}

ItemId equipped_item(const Inventory& inv, const Equipped& eq, EquipSlot slot) {
    const int idx = equipped_index(inv, eq, slot);
    return idx >= 0 ? inv.slots[idx].item : kInvalidItem;
}

ItemSlot* equipped_slot(Inventory& inv, const Equipped& eq, EquipSlot slot) {
    const int idx = equipped_index(inv, eq, slot);
    if (idx < 0) return nullptr;
    return &inv.slots[idx];
}

const ItemSlot* equipped_slot(const Inventory& inv, const Equipped& eq, EquipSlot slot) {
    const int idx = equipped_index(inv, eq, slot);
    if (idx < 0) return nullptr;
    return &inv.slots[idx];
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

std::uint16_t item_durability(ItemId id) {
    // Melee rows carry their own authored lifetime ([weapon_table.h]
    // durability, weapons_melee.csv); everything else reads wearPerUse.
    // ONE resolver by law — see the header.
    if (!item_valid(id)) return 0;
    if (const MeleeDef* m = melee_for_item(id)) return m->durability;
    const ItemDef& d = item_def(id);
    if (d.wearPerUse > 0) {
        return static_cast<std::uint16_t>(255u / d.wearPerUse);
    }
    return 0;
}

bool wear_equipped(Inventory& inv, const Equipped& eq, EquipSlot slot,
                   std::uint32_t seed) {
    const int idx = equipped_index(inv, eq, slot);
    if (idx < 0) return false;
    ItemSlot& s = inv.slots[idx];
    const std::uint16_t dur = item_durability(s.item);
    if (dur == 0) return false;          // вечный — контентное решение строки
    if (s.condition == 0) return false;  // руины дальше не изнашиваются

    // 255 = base * dur + frac: целая часть каждый раз, дробная — роллом.
    std::uint32_t dec = 255u / dur;
    const std::uint32_t frac = 255u % dur;
    if (frac != 0 && rand_below(hash_u32(seed), dur) < frac) ++dec;
    s.condition = static_cast<std::uint8_t>(
        dec >= s.condition ? 0 : s.condition - dec);
    return true;
}

} // namespace giga::game
