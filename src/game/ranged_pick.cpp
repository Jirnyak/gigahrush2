#include "game/ranged_table.h"

#include "game/equip.h"

namespace giga::game {

// Hand-written sibling of the generated table, so re-running the generator cannot
// clobber it. Same split as [weapon_table.h]'s helpers.
ItemId equipped_ranged(const Inventory& inv, const Equipped* eq) {
    if (eq) {
        const std::uint8_t slotIdx = eq->invSlot[static_cast<std::size_t>(EquipSlot::Weapon)];
        if (slotIdx < kInvSlots && item_valid(inv.slots[slotIdx].item)) {
            const ItemId item = inv.slots[slotIdx].item;
            if (ranged_for_item(item)) return item;
        }
        return kInvalidItem;
    }

    ItemId best = kInvalidItem;
    float bestDps = 0.0f;
    for (const ItemSlot& sl : inv.slots) {
        if (!item_valid(sl.item) || sl.count == 0) continue;
        const RangedDef* d = ranged_for_item(sl.item);
        if (!d) continue;
        // A THROWN weapon is not a gun, and the exclusion is load-bearing rather
        // than tidy: `grenade` is 75 DPS and beats 26 of the 29 firearms, so without
        // this line "the best gun in the bag" resolves to a grenade and
        // player_ranged_step fires one down the camera ray per trigger pull.
        // [ranged_table.h] ranged_is_thrown — the item is its own ammunition.
        if (ranged_is_thrown(sl.item)) continue;
        const float dps = ranged_dps(*d);
        if (dps > bestDps) {
            bestDps = dps;
            best = sl.item;
        }
    }
    return best;
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
