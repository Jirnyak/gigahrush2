// Экипировка — это РЕШЕНИЕ, и этот компонент хранит решение, а не находку.
//
// Два решателя, один примитив: NPC решают проходом ai_equip_step ([ai.h]) —
// из обстоятельств (что сильнее в рюкзаке, как прокачано тело, дальше — контекст
// боя вроде резистов врага); игрок решает сам (консоль `equip`/`unequip`).
// Автоэкипировки как системы НЕТ — если никто не решил, тело дерётся кулаками.
//
// Отсюда строгая семантика чтения в combat ([combat.h] equipped_*): указатель на
// Equipped ЕСТЬ — читается только записанное решение, слот протух или пуст →
// kInvalidItem, никакого «тихо возьмём лучшее». Указателя НЕТ (монстры, холодные
// пути) — работает старый скан по инвентарю, это другая система (mob_table, не
// решатель). Наличие компонента = решатель существует.
//
// Индексы, не ItemId: инвентарь — 8x8 POD ([inventory.h]) на строке пула, и слот
// «какой именно предмет из двух одинаковых ножей» различим только индексом.
// Индекс протухает, когда инвентарь мутирует (продажа, банк, разлив трупа) —
// это ЗАКОННО: чтение валидирует слот по def.equipSlot / таблице оружия и
// возвращает «нет решения», а следующий проход решателя решит заново.
#pragma once

#include <cstdint>

#include "game/inventory.h"
#include "game/item_table.h"

namespace giga::game {

inline constexpr std::uint8_t kEquipNone = 0xFFu;

// На ТЕЛЕ (ECS), не на строке пула: решение — свойство воплощённого существа,
// холодной толпе экипировка не нужна, а после воплощения первый же проход
// ai_equip_step решает заново. 4 байта, POD.
struct Equipped {
    std::uint8_t weapon = kEquipNone; // индекс слота инвентаря, 0..63
    std::uint8_t armor  = kEquipNone;
    std::uint8_t tool   = kEquipNone;
    std::uint8_t pad_   = 0;
};
static_assert(sizeof(Equipped) == 4, "Equipped must stay 4 bytes POD");

// Записать решение: слот slotIdx инвентаря занимает соответствующую его
// def.equipSlot ячейку Equipped. false — слот пуст, вне 0..63 или предмет
// не экипируется (equip_slot=None в data/items.csv).
bool equip_item(const Inventory& inv, Equipped& eq, std::uint8_t slotIdx);

// Снять решение. false — slot None/Count.
bool unequip_slot(Equipped& eq, EquipSlot slot);

// Прочитать решение: индекс слота инвентаря или -1 (нет решения / индекс
// протух — слот пуст либо предмет уже не того equip_slot).
int equipped_index(const Inventory& inv, const Equipped& eq, EquipSlot slot);

// То же, но сразу ItemId (kInvalidItem, если решения нет).
ItemId equipped_item(const Inventory& inv, const Equipped& eq, EquipSlot slot);

} // namespace giga::game
