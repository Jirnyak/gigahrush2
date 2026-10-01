// Universal 8x8 inventory — one flat POD grid carried by every entity that can
// hold items: the macro NPC pool row ([npc_pool.h]), embodied ECS entities, and
// the player alike. No allocation, no special cases: the same 64-slot rectangle
// everywhere, so it serializes verbatim with the world and an embodied NPC's
// inventory is a byte-copy of its macro row.
#pragma once

#include <cstddef>
#include <cstdint>

namespace giga::game {

inline constexpr int kInvCols = 8;
inline constexpr int kInvRows = 8;
inline constexpr int kInvSlots = kInvCols * kInvRows; // 64

// One inventory cell. `item == 0` means the slot is empty; item ids index the
// global item table ([items.md]). 6 bytes, so a full inventory is 384 B.
//
// `count` is uint16 BY LAW, not by thrift: stackMax is a uint16 column of
// data/items.csv (1..65535), so no legal stack exceeds 65535 — a wider count
// could only ever hold a value some earlier bug produced. The width exists for
// exactly one row, the RUBLE (value=1, stackMax 65535): money is an ordinary
// item in an ordinary slot ([barter], владелец 2026-08-17 — «стак честно, до
// потолка u16»), and a u8 count capped cash at 255 rub per slot, which no
// economy band past E0 fits into. `condition`: 255 = mint, 0 = ruined, and
// 255 is the DEFAULT so every spawn/aggregate-init site mints a fresh item
// without knowing wear exists. Wear RATES live in the item table's durability
// column ([items.md]); this byte is only the per-instance state.
//
// ADDITION LAW, unchanged by the width: never add into `count` directly —
// compute the sum in int, clamp to stackMax, THEN store. A u16 += overflows
// silently BEFORE any cap check can see it, exactly as the u8 did.
struct ItemSlot {
    std::uint16_t item = 0;      // 0 = empty
    std::uint16_t count = 0;
    std::uint8_t condition = 255;
    std::uint8_t pad_ = 0;
};
static_assert(sizeof(ItemSlot) == 6, "the 6-byte cell is the 384 B grid's law");

// Fixed 8x8 rectangle. POD, trivially copyable — no methods that allocate.
struct Inventory {
    ItemSlot slots[kInvSlots]{};

    ItemSlot& at(int col, int row) {
        return slots[static_cast<std::size_t>(row) * kInvCols + col];
    }
    const ItemSlot& at(int col, int row) const {
        return slots[static_cast<std::size_t>(row) * kInvCols + col];
    }

    bool empty() const {
        for (const auto& s : slots)
            if (s.item != 0) return false;
        return true;
    }

    void clear() {
        for (auto& s : slots) s = ItemSlot{};
    }

    // First empty slot index, or -1 if full. O(64), no allocation.
    int first_free() const {
        for (int i = 0; i < kInvSlots; ++i)
            if (slots[i].item == 0) return i;
        return -1;
    }
};

} // namespace giga::game

// ---- БЛОК КОНТУРА И ЗАКОНА КАПА -------------------------------------------
// Шапка файла обещает «No allocation, no special cases: the same 64-slot
// rectangle everywhere, so it serializes verbatim with the world and an
// embodied NPC's inventory is a byte-copy of its macro row». Два из трёх
// обещаний — «serializes verbatim» и «byte-copy» — есть ровно
// `is_trivially_copyable` плюс `is_standard_layout`, и до 2026-10-01 их не
// утверждало ничто: `sizeof(ItemSlot) == 6` закрепляет РАЗМЕР, но structura с
// `std::string` внутри и размером 6 невозможна, а вот с `std::uint8_t*` —
// вполне, и байт-копия молча стала бы копией УКАЗАТЕЛЯ.
//
// Размер `ItemSlot` держит свой `static_assert` рядом со структурой (CANON S11
// «вывод виден рядом с константой»), поэтому здесь берётся GIGA_ROW без BYTES —
// второй ответ на один вопрос не заводим.
#include "core/po2.h"
#include "core/row_law.h"

GIGA_ROW(giga::game::ItemSlot);
GIGA_ROW_BYTES(giga::game::Inventory, 384);

GIGA_PO2(giga::game::kInvCols);
GIGA_PO2(giga::game::kInvRows);
GIGA_PO2(giga::game::kInvSlots);

// ВЫВОД РАЗМЕРА СЕТКИ, А НЕ НАБЛЮДЕНИЕ. «384 B» стоит в шапке `ItemSlot`
// числом; здесь сказано, ОТКУДА оно: 6 Б ячейки × 64 слота. Раздулась ячейка
// или сменился прямоугольник — красным станет это равенство, и оно назовёт,
// какое из двух слагаемых уехало, а не просто «размер не тот».
static_assert(sizeof(giga::game::Inventory)
                  == sizeof(giga::game::ItemSlot) * giga::game::kInvSlots,
              "инвентарь есть РОВНО сетка ячеек и ничего больше: выравнивание "
              "не добавило дыры, и в прямоугольник не пришили служебного поля");
