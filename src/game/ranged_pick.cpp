#include "game/ranged_table.h"
#include "game/equip.h"

namespace giga::game {

int equipped_ranged_slot(const Inventory& inv, const Equipped* eq) {
    if (eq && eq->weapon < kInvSlots) {
        const ItemSlot& sl = inv.slots[eq->weapon];
        if (item_valid(sl.item) && sl.count > 0) {
            const RangedDef* d = ranged_for_item(sl.item);
            if (d && !ranged_is_thrown(sl.item)) return eq->weapon;
        }
        return -1;
    }
    int bestIdx = -1;
    float bestDps = 0.0f;
    for (int i = 0; i < kInvSlots; ++i) {
        const ItemSlot& sl = inv.slots[i];
        if (!item_valid(sl.item) || sl.count == 0) continue;
        const RangedDef* d = ranged_for_item(sl.item);
        if (!d || ranged_is_thrown(sl.item)) continue;
        const float dps = ranged_dps(*d);
        if (dps > bestDps) {
            bestDps = dps;
            bestIdx = i;
        }
    }
    return bestIdx;
}

// Hand-written sibling of the generated table, so re-running the generator cannot
// clobber it. Same split as [weapon_table.h]'s helpers.
ItemId equipped_ranged(const Inventory& inv, const Equipped* eq) {
    const int slot = equipped_ranged_slot(inv, eq);
    if (slot >= 0 && slot < kInvSlots) return inv.slots[slot].item;
    return kInvalidItem;
}

ItemId equipped_throwable(const Inventory& inv) {
    ItemId best = kInvalidItem;
    float bestScore = 0.0f;
    for (const ItemSlot& sl : inv.slots) {
        if (!item_valid(sl.item) || sl.count == 0) continue;
        const RangedDef* d = ranged_for_item(sl.item);
        if (!d || !ranged_is_explosive(*d)) continue;
        // The mirror of equipped_ranged's exclusion, and it must be the SAME test
        // read the other way round: a launcher's shell also explodes, but you do not
        // throw a launcher. If these two predicates ever stop being complements, a
        // weapon becomes either unpickable or pickable twice.
        if (!ranged_is_thrown(sl.item)) continue;
        const float score = static_cast<float>(d->dmg) *
                            static_cast<float>(d->blastDm);
        if (score > bestScore) {
            bestScore = score;
            best = sl.item;
        }
    }
    return best;
}

} // namespace giga::game
