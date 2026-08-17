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
