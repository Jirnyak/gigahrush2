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
// global item table ([items.md]). Kept to 4 bytes so a full inventory is 256 B.
struct ItemSlot {
    std::uint16_t item = 0;  // 0 = empty
    std::uint16_t count = 0;
};
static_assert(sizeof(ItemSlot) == 4);

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
