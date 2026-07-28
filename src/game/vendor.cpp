#include "game/vendor.h"

#include "game/combat.h"   // equipped_melee / equipped_armour

namespace giga::game {

namespace {

// A vendor will not take the last of a survival consumable off you. Stripping the
// player thirsty for a profit is a trap dressed as a convenience, and they would learn
// not to use it — which costs the whole system rather than the one sale.
constexpr std::uint16_t kKeepAlive = 2;

bool survival_category(ItemCategory cat) {
    return cat == ItemCategory::Food || cat == ItemCategory::Drink ||
           cat == ItemCategory::Medicine;
}

} // namespace

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

std::int32_t vendor_buy_price(ItemId id) {
    if (!item_valid(id)) return 0;
    const ItemDef& d = item_def(id);
    if (!vendor_stocks(static_cast<ItemCategory>(d.category))) return 0;
    if (d.value <= 0) return 0;
    const std::int32_t p =
        static_cast<std::int32_t>(static_cast<float>(d.value) * kBuyMult);
    return p < 1 ? 1 : p;   // nothing is free, however cheap
}

std::int32_t vendor_sell_price(ItemId id, VendorKind who) {
    if (!item_valid(id)) return 0;
    const ItemDef& d = item_def(id);
    if (d.value <= 0) return 0;
    // A vendor BUYS anything with a price, including the trade goods it does not stock
    // — that asymmetry is the point. You sell what you hauled up and buy what keeps you
    // alive; the shop is not a mirror.
    const float m = kSellMult[static_cast<std::size_t>(who)];
    const std::int32_t p = static_cast<std::int32_t>(static_cast<float>(d.value) * m);
    // NOT clamped up to 1, unlike the buy price. A test asserting "sell < buy for every
    // stocked item" caught this: clamping both sides made a 1-rouble item buy for 1 and
    // sell for 1, so cycling it was free rather than lossy — the money press left ajar
    // on exactly the items nobody would look at. Returning 0 also reads correctly: a
    // one-rouble item is not worth a vendor's time, and `vendor_sell_all` already skips
    // anything priced at 0.
    return p < 1 ? 0 : p;
}

std::uint32_t vendor_buy(Inventory& inv, RunLedger& led, ItemId id,
                         std::uint32_t count) {
    const std::int32_t unit = vendor_buy_price(id);
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

std::int32_t vendor_sell_all(Inventory& inv, RunLedger& led, VendorKind who) {
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

        const std::int32_t unit = vendor_sell_price(s.item, who);
        if (unit <= 0) continue;
        // Respect the per-visit cap exactly rather than overshooting on the last stack.
        std::int32_t room = kSellPerVisitCap - got;
        std::uint16_t n = sellable;
        if (static_cast<std::int32_t>(n) * unit > room)
            n = static_cast<std::uint16_t>(room / unit);
        if (n == 0) continue;

        got += static_cast<std::int32_t>(n) * unit;
        s.count = static_cast<std::uint16_t>(s.count - n);
        if (s.count == 0) s.item = kInvalidItem;
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

    // Cheapest useful thing in each of the three categories that keep you alive. Water
    // first, because the water clock is the harshest — about 10 minutes against food's
    // 15-20 ([needs.h]) — so it is what actually ends trips.
    const ItemCategory order[3] = {ItemCategory::Drink, ItemCategory::Medicine,
                                   ItemCategory::Food};
    for (ItemCategory cat : order) {
        ItemId best = kInvalidItem;
        std::int32_t bestPrice = 0;
        for (ItemId id = 1; id <= kItemCount; ++id) {
            const ItemDef& d = item_def(id);
            if (static_cast<ItemCategory>(d.category) != cat) continue;
            // Must actually DO something. `calm_brew` is a DRINK that restores nothing
            // ([needs.h]) — buying it would be a vendor selling you a placebo.
            const auto eff = static_cast<UseEffect>(d.useEffect);
            if (eff == UseEffect::None) continue;
            const std::int32_t p = vendor_buy_price(id);
            if (p <= 0) continue;
            if (best == kInvalidItem || p < bestPrice) { best = id; bestPrice = p; }
        }
        if (best == kInvalidItem) continue;
        // A third of the remaining budget per category, so one cheap category cannot
        // eat the whole purse and leave you with no medicine.
        const std::int64_t share = (led.banked - floorAt) / 3;
        std::uint32_t want = bestPrice > 0
                                 ? static_cast<std::uint32_t>(share / bestPrice)
                                 : 0u;
        if (want == 0 && led.banked - floorAt >= bestPrice) want = 1;
        vendor_buy(inv, led, best, want);
    }
    return static_cast<std::int32_t>(before - led.banked);
}

} // namespace giga::game
