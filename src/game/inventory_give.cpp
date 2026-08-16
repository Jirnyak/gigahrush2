#include "game/item_table.h"

namespace giga::game {

// Hand-written sibling of the generated table, same split as ranged_pick.cpp:
// re-running the generator cannot clobber it.
//
// THE transfer primitive (problems.md §39, [inventory.md]): every path that
// puts items INTO an 8x8 grid goes through here — pickup, container take,
// quest reward — so the stack law lives once. Returns the UNPLACED remainder;
// the caller decides what a remainder means (stays on the floor, stays in the
// box, reward truncated) — this function never deletes anything.
//
// Two condition laws, both load-bearing ([inventory.h]):
//   1. Pass 1 tops up only stacks of the SAME condition. Merging a ruined
//      tool into a mint stack would either launder the ruin or infect the
//      stack — different wear is a different stack, full stop.
//   2. Pass 2 writes `condition` EXPLICITLY into the fresh slot. A slot freed
//      by sale/spill keeps its stale wear byte (emptiers only zero item and
//      count), and inheriting it would hand a mint pickup a dead man's wear.
std::uint16_t inventory_give(Inventory& inv, ItemId id, std::uint16_t count,
                             std::uint8_t condition) {
    if (!item_valid(id) || count == 0) return count;
    const std::uint8_t rawMax = item_def(id).stackMax;
    const int cap = rawMax < 1 ? 1 : static_cast<int>(rawMax);

    int left = static_cast<int>(count);

    // Pass 1: top up partial same-item SAME-CONDITION stacks, so a reward of 2
    // bandages does not consume a slot the carrier still needs.
    for (ItemSlot& s : inv.slots) {
        if (left <= 0) break;
        if (s.item != id || s.count == 0) continue;
        if (s.condition != condition) continue;  // law 1: wear splits stacks
        // Addition law ([inventory.h]): sum in int, clamp, then store.
        const int room = cap - static_cast<int>(s.count);
        if (room <= 0) continue;
        const int take = room < left ? room : left;
        s.count = static_cast<std::uint8_t>(static_cast<int>(s.count) + take);
        left -= take;
    }

    // Pass 2: fresh slots, condition written explicitly (law 2).
    for (ItemSlot& s : inv.slots) {
        if (left <= 0) break;
        if (s.item != kInvalidItem && s.count != 0) continue;
        const int take = cap < left ? cap : left;
        s.item = id;
        s.count = static_cast<std::uint8_t>(take);
        s.condition = condition;
        left -= take;
    }

    return static_cast<std::uint16_t>(left);
}

} // namespace giga::game
