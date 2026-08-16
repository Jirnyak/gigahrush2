#include "game/vendor.h"

#include "game/combat.h"         // equipped_melee / equipped_armour
#include "game/ranged_table.h"   // kRangedTable / ranged_for_item / equipped_ranged
#include "game/rpg.h"            // RpgStats / int_document_reward_mult_e3

namespace giga::game {

namespace {

// A vendor will not take the last of a survival consumable off you. Stripping the
// player thirsty for a profit is a trap dressed as a convenience, and they would learn
// not to use it — which costs the whole system rather than the one sale.
constexpr std::uint16_t kKeepAlive = 2;

// Categories `vendor_resupply` walks, in order. Named because the purse and the slot
// budget are both divided by it, and a literal 4 in three places is how those two
// divisions drift apart from the array they are dividing for.
constexpr std::size_t kResupplyCats = 4;

bool survival_category(ItemCategory cat) {
    return cat == ItemCategory::Food || cat == ItemCategory::Drink ||
           cat == ItemCategory::Medicine;
}

// Slots holding nothing. `Inventory::first_free` answers "is there one"; the resupply
// needs "how many", to divide them.
std::size_t free_slots(const Inventory& inv) {
    std::size_t n = 0;
    for (const ItemSlot& s : inv.slots)
        if (s.item == kInvalidItem) ++n;
    return n;
}

} // namespace

VendorKind vendor_kind_for(Faction who) {
    switch (who) {
        case Faction::Scientists: return VendorKind::Scientist;
        case Faction::Wild:       return VendorKind::Wild;
        case Faction::Citizens:
        case Faction::Liquidators:
        case Faction::Cultists:
        default:                  return VendorKind::Citizen;
    }
}

bool vendor_stocks(ItemCategory cat) {
    switch (cat) {
        case ItemCategory::Food:
        case ItemCategory::Drink:
        case ItemCategory::Medicine:
        case ItemCategory::Ammo:
            return true;
        default:
            // No weapons, deliberately. A shop that sells guns removes the reason to
            // open a weapon crate on a deep floor, and the crate is the better story.
            return false;
    }
}

bool vendor_stocks_item(ItemId id) {
    if (!item_valid(id)) return false;
    const ItemDef& d = item_def(id);
    if (!vendor_stocks(static_cast<ItemCategory>(d.category))) return false;
    // An item whose only action has no handler. `UseEffect::Unpack` appears on 4 rows
    // and is dispatched by nothing in src/ — and the `use_grant_id` column that says
    // what a pack yields is not in ItemDef at all ([item_table.h], deferred), so there
    // is nothing to write a handler AGAINST without changing the generated table's
    // shape. Until that column is ported, selling a pack is selling a dead slot.
    if (static_cast<UseEffect>(d.useEffect) == UseEffect::Unpack) return false;
    // A round no gun chambers is the same dead slot with a more convincing name.
    // Reload matches the id exactly (combat.cpp:721), so 7 of the 17 AMMO rows —
    // ammo_fuel, napalm_mix, the three 12-gauge specials and the two contraband packs —
    // can never enter a magazine: their consumers are the 19 deferred non-Normal
    // projectile weapons, which are not in kRangedTable.
    if (static_cast<ItemCategory>(d.category) == ItemCategory::Ammo) {
        bool chambered = false;
        for (const RangedDef& r : kRangedTable)
            if (r.ammo == id) { chambered = true; break; }
        if (!chambered) return false;
    }
    return true;
}

std::int32_t vendor_buy_price(ItemId id, std::int8_t playerRelation) {
    if (!vendor_stocks_item(id)) return 0;
    const ItemDef& d = item_def(id);
    if (d.value <= 0) return 0;
    float mult = kBuyMult;
    if (playerRelation > 0) {
        mult -= (static_cast<float>(playerRelation) * 0.15f / 100.0f);
    } else if (playerRelation < 0) {
        mult += (static_cast<float>(-playerRelation) * 0.25f / 100.0f);
    }
    const std::int32_t p =
        static_cast<std::int32_t>(static_cast<float>(d.value) * mult);
    return p < 1 ? 1 : p;   // nothing is free, however cheap
}

ItemId vendor_ammo_for(const Inventory& inv) {
    // The gun the player will actually fire. Resolved through `equipped_ranged` and
    // `RangedDef::ammo` — the same two calls `player_ranged_step` (combat.cpp:699-700)
    // and `drop_weapon_ammo` (loot.cpp:136) make — so the vendor cannot disagree with
    // the magazine about what fits.
    if (const RangedDef* held = ranged_for_item(equipped_ranged(inv)))
        if (vendor_buy_price(held->ammo) > 0) return held->ammo;

    // No firearm in the bag: the cheapest round SOME gun in the table takes, so the
    // purchase is still a real magazine the moment a gun is found. 29 rows, walked once
    // — this runs on a keypress at the pad, not in the tick.
    ItemId best = kInvalidItem;
    std::int32_t bestPrice = 0;
    for (const RangedDef& r : kRangedTable) {
        // AMMUNITION only. A THROWN row's "ammo" is the weapon itself
        // ([ranged_table.h]), so without this the fallback could hand a man with no
        // gun a grenade and call it a magazine — which is what this branch promises
        // it never does. Grenades are bought like any other item, through the shop's
        // ordinary path, not through the ammo key.
        if (static_cast<ItemCategory>(item_def(r.ammo).category) !=
            ItemCategory::Ammo)
            continue;
        const std::int32_t p = vendor_buy_price(r.ammo);
        if (p <= 0) continue;
        if (best == kInvalidItem || p < bestPrice) { best = r.ammo; bestPrice = p; }
    }
    return best;
}

std::int32_t vendor_sell_price(ItemId id, VendorKind who, const RpgStats* rpg,
                               std::int8_t playerRelation) {
    if (!item_valid(id)) return 0;
    const ItemDef& d = item_def(id);
    if (d.value <= 0) return 0;
    // A vendor BUYS anything with a price, including the trade goods it does not stock
    // — that asymmetry is the point. You sell what you hauled up and buy what keeps you
    // alive; the shop is not a mirror.
    float m = kSellMult[static_cast<std::size_t>(who)];
    if (playerRelation > 0) {
        m += (static_cast<float>(playerRelation) * 0.15f / 100.0f);
    } else if (playerRelation < 0) {
        m -= (static_cast<float>(-playerRelation) * 0.20f / 100.0f);
        if (m < 0.10f) m = 0.10f;
    }
    if (rpg != nullptr && static_cast<ItemCategory>(d.category) == ItemCategory::Note) {
        m *= static_cast<float>(int_document_reward_mult_e3(*rpg)) / 1000.0f;
    }
    // Strict economic invariant: sell multiplier can NEVER exceed buy_mult * 0.88f
    // to prevent infinite arbitrage loops with Scientist vendors at high reputation.
    const float buyM = (playerRelation > 0)
        ? (kBuyMult - static_cast<float>(playerRelation) * 0.15f / 100.0f)
        : (kBuyMult + static_cast<float>(-playerRelation) * 0.25f / 100.0f);
    const float maxAllowedSellM = buyM * 0.88f;
    if (m > maxAllowedSellM) m = maxAllowedSellM;

    std::int32_t p = static_cast<std::int32_t>(static_cast<float>(d.value) * m);
    if (vendor_stocks_item(id)) {
        const std::int32_t buyP = vendor_buy_price(id, playerRelation);
        if (p >= buyP && buyP > 0) {
            p = buyP - 1;
        }
    }
    // NOT clamped up to 1, unlike the buy price. A test asserting "sell < buy for every
    // stocked item" caught this: clamping both sides made a 1-rouble item buy for 1 and
    // sell for 1, so cycling it was free rather than lossy — the money press left ajar
    // on exactly the items nobody would look at. Returning 0 also reads correctly: a
    // one-rouble item is not worth a vendor's time, and `vendor_sell_all` already skips
    // anything priced at 0.
    return p < 1 ? 0 : p;
}

std::uint32_t vendor_buy(Inventory& inv, RunLedger& led, ItemId id,
                         std::uint32_t count, std::int8_t playerRelation) {
    const std::int32_t unit = vendor_buy_price(id, playerRelation);
    if (unit <= 0 || count == 0) return 0;
    const std::uint8_t stack = item_def(id).stackMax;

    std::uint32_t bought = 0;
    while (bought < count) {
        if (led.banked < unit) break;   // out of money: a partial buy, charged for what landed

        // Top up an existing stack before opening a new slot, so buying 30 rounds does
        // not consume 30 slots.
        bool placed = false;
        if (stack > 1) {
            for (ItemSlot& s : inv.slots) {
                if (s.item != id || s.count >= stack) continue;
                ++s.count;
                placed = true;
                break;
            }
        }
        if (!placed) {
            const int slot = inv.first_free();
            if (slot < 0) break;        // full: an inventory limit, not an error
            inv.slots[slot] = ItemSlot{id, 1};
        }
        led.banked -= unit;
        ++bought;
    }
    return bought;
}

std::int32_t vendor_sell_all(Inventory& inv, RunLedger& led, VendorKind who,
                             const RpgStats* rpg, std::int8_t playerRelation) {
    const ItemId keepWeapon = equipped_melee(inv);
    const ItemId keepArmour = equipped_armour(inv);

    // Count survival stock first, so the "keep the last two" rule is decided against
    // the whole inventory rather than per-slot. Deciding per-slot would let two slots
    // of one bandage each both be sold, leaving zero.
    std::uint16_t have[static_cast<std::size_t>(ItemCategory::Count)] = {};
    for (const ItemSlot& s : inv.slots) {
        if (!item_valid(s.item) || s.count == 0) continue;
        const auto cat = static_cast<ItemCategory>(item_def(s.item).category);
        have[static_cast<std::size_t>(cat)] =
            static_cast<std::uint16_t>(have[static_cast<std::size_t>(cat)] + s.count);
    }

    std::int32_t got = 0;
    for (ItemSlot& s : inv.slots) {
        if (got >= kSellPerVisitCap) break;
        if (!item_valid(s.item) || s.count == 0) continue;
        if (s.item == keepWeapon || s.item == keepArmour) continue;
        const auto cat = static_cast<ItemCategory>(item_def(s.item).category);

        std::uint16_t sellable = s.count;
        if (survival_category(cat)) {
            const std::size_t ci = static_cast<std::size_t>(cat);
            if (have[ci] <= kKeepAlive) continue;
            const std::uint16_t spare =
                static_cast<std::uint16_t>(have[ci] - kKeepAlive);
            if (sellable > spare) sellable = spare;
            have[ci] = static_cast<std::uint16_t>(have[ci] - sellable);
        }

        const std::int32_t unit = vendor_sell_price(s.item, who, rpg, playerRelation);
        if (unit <= 0) continue;
        // Respect the per-visit cap exactly rather than overshooting on the last stack.
        std::int32_t room = kSellPerVisitCap - got;
        std::uint16_t n = sellable;
        if (static_cast<std::int32_t>(n) * unit > room)
            n = static_cast<std::uint16_t>(room / unit);
        if (n == 0) continue;

        got += static_cast<std::int32_t>(n) * unit;
        s.count = static_cast<std::uint16_t>(s.count - n);
        if (s.count == 0) s = ItemSlot{};
    }
    // Straight into banked, not into a wallet: there is no cash/account split here and
    // inventing one would give value two homes.
    led.banked += got;
    return got;
}

std::int32_t vendor_resupply(Inventory& inv, RunLedger& led, std::int32_t budget) {
    if (budget <= 0) return 0;
    if (budget > led.banked) budget = static_cast<std::int32_t>(led.banked);
    const std::int64_t before = led.banked;
    const std::int64_t floorAt = before - budget;

    // The cheapest useful thing in each of the three categories that keep you alive,
    // plus a round that fits. Water first, because the water clock is the harshest —
    // about 10 minutes against food's 15-20 ([needs.h]) — so it is what actually ends
    // trips.
    //
    // **Ammo is in this list, and it is the one category NOT chosen by price.** The
    // sequence of two defects is worth keeping, because the second one looked like a fix:
    //
    //   1. the list was Drink/Medicine/Food only. `vendor_stocks(Ammo)` returned true and
    //      `vendor_buy_price` priced ammunition, so the promise and the only key-wired
    //      buy path disagreed: an audit handed the resupply 50,000 roubles and it bought
    //      no rounds at all.
    //   2. Ammo was added to this list, and the "must actually DO something" filter below
    //      then decided WHICH row. Only 3 of the 17 AMMO rows carry a non-None use
    //      effect, all three are `UseEffect::Unpack` packs, and this loop takes the
    //      CHEAPEST — so R at the pad always bought homemade_9mm (11 rub face, 12 to
    //      buy), an item that is the ammo of none of the 29 guns and whose Unpack action
    //      no code implements. Measured on the audit's own 50,000-rouble scenario: 84
    //      packs bought for 1,008 roubles, and they took the inventory from 57 slots to
    //      all 64 — so the purchase was worse than nothing twice over, once in money and
    //      once in space. Every test still passed, because "some item of category Ammo
    //      landed" was the assertion.
    //
    // So the use-effect filter is right for the three consumable categories — `calm_brew`
    // is a DRINK that restores nothing ([needs.h]), and buying it would be a vendor
    // selling a placebo — and WRONG for ammunition, where the question is not "does using
    // it do something" but "does it fit a gun". `vendor_ammo_for` answers that one, and
    // `vendor_stocks_item` refuses the packs outright.
    //
    // Ammo still goes LAST: water is the harshest clock, so when the budget is short the
    // trip is what gets funded, not the firefight.
    const ItemCategory order[kResupplyCats] = {
        ItemCategory::Drink, ItemCategory::Medicine, ItemCategory::Food,
        ItemCategory::Ammo};
    std::size_t catsLeft = kResupplyCats;
    for (ItemCategory cat : order) {
        const std::size_t remaining = catsLeft--;   // 4, 3, 2, 1
        ItemId best = kInvalidItem;
        std::int32_t bestPrice = 0;
        if (cat == ItemCategory::Ammo) {
            best = vendor_ammo_for(inv);
            bestPrice = vendor_buy_price(best);
            if (bestPrice <= 0) continue;   // also covers best == kInvalidItem
        } else {
            for (ItemId id = 1; id <= kItemCount; ++id) {
                const ItemDef& d = item_def(id);
                if (static_cast<ItemCategory>(d.category) != cat) continue;
                if (static_cast<UseEffect>(d.useEffect) == UseEffect::None) continue;
                const std::int32_t p = vendor_buy_price(id);
                if (p <= 0) continue;
                if (best == kInvalidItem || p < bestPrice) { best = id; bestPrice = p; }
            }
            if (best == kInvalidItem || bestPrice <= 0) continue;
        }
        // A quarter of what is left, per category, so one cheap category cannot eat the
        // whole purse and leave you with no medicine — and so the last category in the
        // list is still paid out of something rather than out of nothing.
        const std::int64_t share = (led.banked - floorAt) /
                                   static_cast<std::int64_t>(kResupplyCats);
        std::uint32_t want = bestPrice > 0
                                 ? static_cast<std::uint32_t>(share / bestPrice)
                                 : 0u;
        if (want == 0 && led.banked - floorAt >= bestPrice) want = 1;
        // **The purse was split and the SLOTS were not, and slots are the binding
        // constraint.** Measured on an empty inventory with a 50,000-rouble budget: at a
        // quarter-share each, Drink bought 6,250 bottles of 2-rouble water (25 slots),
        // Medicine 852 bandages (4) and Food 7,032 rations (28) — 57 of 64 — so the
        // category that goes LAST got whatever the first three had not eaten, and
        // `vendor_buy` reported the truncated purchase as a success because it reports
        // what LANDED. An even share of the EMPTY slots, alongside the even share of the
        // purse, is what keeps ammunition fundable in space as well as in money.
        //
        // Conservative on purpose: `vendor_buy` tops up an existing part-stack before it
        // opens a slot, so this can under-buy slightly when the player already carries
        // some of the row. Under-buying is the safe direction — the alternative is a
        // silent truncation the caller cannot see. At the shipped kResupplyBudget of 600
        // (src/app/main.cpp) the cap never binds: the whole visit needs 4 slots.
        std::size_t slotShare = free_slots(inv) / remaining;
        if (slotShare == 0) slotShare = 1;   // one stack is the floor, never zero
        const std::uint64_t slotCap =
            static_cast<std::uint64_t>(slotShare) *
            static_cast<std::uint64_t>(item_def(best).stackMax);
        if (static_cast<std::uint64_t>(want) > slotCap)
            want = static_cast<std::uint32_t>(slotCap);
        vendor_buy(inv, led, best, want);
    }
    return static_cast<std::int32_t>(before - led.banked);
}

} // namespace giga::game
