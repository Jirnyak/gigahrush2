#include "game/equip.h"

#include "core/rng.h"          // hash_u32, rand_below — the wear roll
#include "game/weapon_table.h" // melee_for_item — the melee durability source

namespace giga::game {

namespace {

// Адресация: Weapon-адрес = рука ЛКМ, Tool-адрес = рука ПКМ (Tool-СЛОТ
// убит — «теперь руки», владелец 2026-08-31; адресные имена доживают в
// легаси-вызовах и консольных алиасах).
std::uint8_t* eq_cell(Equipped& eq, EquipSlot slot) {
    switch (slot) {
        case EquipSlot::Weapon: return &eq.handL;
        case EquipSlot::Armor:  return &eq.armor;
        case EquipSlot::Tool:   return &eq.handR;
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
    const auto ds = static_cast<EquipSlot>(item_def(s.item).equipSlot);
    // Рука принимает ОБЕ hand-категории (пистолет и лом в любой руке);
    // строгое равенство остаётся у брони.
    if (hand_accepts(slot) ? !hand_accepts(ds) : ds != slot) return -1;
    return static_cast<int>(*cell);
}

bool equip_hand(const Inventory& inv, Equipped& eq, std::uint8_t slotIdx,
                bool right) {
    if (slotIdx >= kInvSlots) return false;
    const ItemSlot& s = inv.slots[slotIdx];
    if (s.item == kInvalidItem || s.count == 0 || !item_valid(s.item))
        return false;
    if (!hand_accepts(static_cast<EquipSlot>(item_def(s.item).equipSlot)))
        return false;
    (right ? eq.handR : eq.handL) = slotIdx;
    return true;
}

ItemId equipped_hand(const Inventory& inv, const Equipped& eq, bool right) {
    return equipped_item(inv, eq,
                         right ? EquipSlot::Tool : EquipSlot::Weapon);
}

ItemId equipped_item(const Inventory& inv, const Equipped& eq, EquipSlot slot) {
    const int idx = equipped_index(inv, eq, slot);
    return idx >= 0 ? inv.slots[idx].item : kInvalidItem;
}

std::uint16_t item_durability(ItemId id) {
    // Melee rows carry their own authored lifetime ([weapon_table.h]
    // durability, weapons_melee.csv); everything else reads the items.csv
    // column. ONE resolver by law — see the header.
    if (const MeleeDef* m = melee_for_item(id)) return m->durability;
    return item_def(id).durability;
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
