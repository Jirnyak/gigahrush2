#include "game/equip.h"

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

} // namespace giga::game
