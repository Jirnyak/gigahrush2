#include "game/ranged_table.h"
#include "game/prop_table.h" // prop_def — сила метательного = масса ВВ пропа

namespace giga::game {

// Hand-written sibling of the generated table, so re-running the generator cannot
// clobber it. Same split as [weapon_table.h]'s helpers.
ItemId equipped_ranged(const Inventory& inv, const Equipped* eq) {
    // Strict decision read ([equip.h]): the ONE weapon cell holds either a club
    // or a gun, and this reader answers only when it is a real firearm — thrown
    // stays excluded for the same load-bearing reason as the scan below.
    if (eq) {
        // ДВЕ РУКИ (two-hands.md): огнестрел ищется в обеих, ЛКМ первой.
        for (int r = 0; r < 2; ++r) {
            const ItemId chosen = equipped_hand(inv, *eq, r == 1);
            if (ranged_for_item(chosen) && !ranged_is_thrown(chosen))
                return chosen;
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
    // Чистый скан сумки — путь БЕЗ решателя (консольная `grenade`,
    // фикстуры). Выбор руки живёт в player_throw_step: рука бросает СВОЁ,
    // приоритетов между руками нет по построению (владелец 2026-08-31:
    // «не надо никаких приоритетов»).
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
        // Сила метательного — масса ВВ его пропа: урон и радиус оба
        // монотонны по ней ([combat.h] charge_dmg/charge_radius_m), так что
        // порядок «лучший заряд» тот же, что давал прежний dmg×blast.
        const float score = static_cast<float>(
            prop_def(static_cast<PropId>(d->thrownPropId)).explosiveG);
        if (score > bestScore) {
            bestScore = score;
            best = sl.item;
        }
    }
    return best;
}

} // namespace giga::game
