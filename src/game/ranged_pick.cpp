#include "game/ranged_table.h"

namespace giga::game {

// Hand-written sibling of the generated table, so re-running the generator cannot
// clobber it. Same split as [weapon_table.h]'s helpers.
ItemId equipped_ranged(const Inventory& inv) {
    ItemId best = kInvalidItem;
    float bestDps = 0.0f;
    for (const ItemSlot& sl : inv.slots) {
        if (!item_valid(sl.item) || sl.count == 0) continue;
        const RangedDef* d = ranged_for_item(sl.item);
        if (!d) continue;
        const float dps = ranged_dps(*d);
        if (dps > bestDps) {
            bestDps = dps;
            best = sl.item;
        }
    }
    return best;
}

} // namespace giga::game
