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
// ДВЕ РУКИ (эпик two-hands.md, замысел владельца 2026-08-31): активных
// слота два — рука ЛКМ и рука ПКМ, класть можно любой hand-предмет
// (Weapon И Tool категории — Tool-СЛОТ убит решением владельца, «теперь
// руки»), верб решает тип предмета своей таблицей. Байты на прежних
// местах (сейв-раскладка не менялась): weapon→handL, tool→handR — старое
// решение «tool» честно оказывается в правой руке, а протухшее гасится
// валидацией по def, как всегда.
struct Equipped {
    std::uint8_t handL = kEquipNone; // рука ЛКМ: индекс слота 0..63
    std::uint8_t armor = kEquipNone;
    std::uint8_t handR = kEquipNone; // рука ПКМ (байт бывшего tool)
    std::uint8_t pad_  = 0;
};
static_assert(sizeof(Equipped) == 4, "Equipped must stay 4 bytes POD");

// Категория предмета принимается РУКОЙ? (адресация руки — выбор игрока,
// не def: пистолет кладётся в любую из двух).
inline bool hand_accepts(EquipSlot s) {
    return s == EquipSlot::Weapon || s == EquipSlot::Tool;
}

// Записать решение: слот slotIdx инвентаря занимает соответствующую его
// def.equipSlot ячейку Equipped: Armor → armor, hand-предмет — в руку ЛКМ
// по умолчанию (адресный выбор руки — equip_hand ниже). false — слот
// пуст, вне 0..63 или предмет не экипируется (equip_slot=None).
bool equip_item(const Inventory& inv, Equipped& eq, std::uint8_t slotIdx);

// Положить hand-предмет в НАЗВАННУЮ руку (right=true — ПКМ). false —
// предмет не hand-категории или слот пуст/протух.
bool equip_hand(const Inventory& inv, Equipped& eq, std::uint8_t slotIdx,
                bool right);

// Валидированное чтение руки: ItemId или kInvalidItem (решения нет /
// индекс протух / предмет уже не hand-категории).
ItemId equipped_hand(const Inventory& inv, const Equipped& eq, bool right);

// Снять решение. false — slot None/Count.
bool unequip_slot(Equipped& eq, EquipSlot slot);

// Прочитать решение: индекс слота инвентаря или -1 (нет решения / индекс
// протух — слот пуст либо предмет уже не того equip_slot).
int equipped_index(const Inventory& inv, const Equipped& eq, EquipSlot slot);

// То же, но сразу ItemId (kInvalidItem, если решения нет).
ItemId equipped_item(const Inventory& inv, const Equipped& eq, EquipSlot slot);

// --- Износ ------------------------------------------------------------------
// Состояние — байт `condition` клетки ([inventory.h]); СКОРОСТЬ — данные, и
// резолвер у неё ОДИН: для melee-оружия — колонка durability его строки в
// data/weapons_melee.csv (21 строка уже авторская), для всего остального —
// колонка durability в data/items.csv. 0 = вечный. Код и тесты обязаны звать
// резолвер, а не лезть в таблицы напрямую — иначе два источника разойдутся.
std::uint16_t item_durability(ItemId id);

// Один вызов = одно использование решённого слота. Декремент — вероятностный хэш-ролл в
// традиции carve ([destruct.h]): base = 255/durability, дробный остаток
// добирается роллом, так что МАТОЖИДАНИЕ использований до нуля равно колонке
// точно — и для durability 300, которое в целые шаги не делится.
// `seed` — детерминизм вызывающего (tick/id/соль), не Math.random.
// false — нет решения, слот протух или предмет вечный.
bool wear_equipped(Inventory& inv, const Equipped& eq, EquipSlot slot,
                   std::uint32_t seed);

// Эффект состояния, ЕДИНСТВЕННЫЕ две формулы (никаких локальных копий):
// оружие держит 60% урона на руинах, броня — 20% резистов. Целочисленно,
// монотонно, 255 -> ровно 100%.
inline std::int16_t wear_damage_scale(std::int16_t dmg, std::uint8_t cond) {
    // 60% + 40% * cond/255
    return static_cast<std::int16_t>(
        (static_cast<std::int32_t>(dmg) * (153 + (102 * cond) / 255)) / 255);
}
inline std::int8_t wear_resist_scale(std::int8_t resist, std::uint8_t cond) {
    // 20% + 80% * cond/255
    return static_cast<std::int8_t>(
        (static_cast<std::int32_t>(resist) * (51 + (204 * cond) / 255)) / 255);
}

} // namespace giga::game
