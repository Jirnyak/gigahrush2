#include "game/barter.h"

#include "game/vendor.h"   // VendorKind, kBuyMult, kSellMult, vendor_kind_for

namespace giga::game {

namespace {

// E3 int of a float multiplier authored in vendor.h. Truncation is the same
// coarseness vendor.h documented for integer roubles; sell < buy survives it.
constexpr std::uint16_t e3(float mult) {
    return static_cast<std::uint16_t>(mult * 1000.0f + 0.5f);
}

// Value of one marked slot under a multiplier — rubles at par, goods at rate.
std::int64_t slot_value(const ItemSlot& s, std::uint16_t multE3) {
    if (!item_valid(s.item) || s.count == 0) return 0;
    const std::int64_t face = static_cast<std::int64_t>(item_def(s.item).value) *
                              static_cast<std::int64_t>(s.count);
    if (s.item == kItemRuble) return face;   // money is exempt from the spread
    return face * multE3 / 1000;
}

// Rubles an inventory holds OUTSIDE the marked slots — what can settle a debt.
std::int64_t unmarked_rubles(const Inventory& inv, std::uint64_t marks) {
    std::int64_t total = 0;
    for (int i = 0; i < kInvSlots; ++i) {
        if ((marks >> i) & 1u) continue;
        const ItemSlot& s = inv.slots[i];
        if (s.item != kItemRuble || s.count == 0) continue;
        total += s.count;
    }
    return total;
}

// Is slot `idx` currently one of the wearer's equip decisions?
bool slot_equipped(const Equipped* eq, int idx) {
    if (!eq) return false;
    return eq->weapon == idx || eq->armor == idx || eq->tool == idx;
}

bool any_marked_equipped(const Equipped* eq, std::uint64_t marks) {
    if (!eq) return false;
    for (int i = 0; i < kInvSlots; ++i)
        if (((marks >> i) & 1u) && slot_equipped(eq, i)) return true;
    return false;
}

// Move every marked slot of `from` into `to`, wear riding along. True only if
// EVERYTHING landed — a remainder is the caller's cue to abort the whole deal.
bool move_marked(Inventory& from, Inventory& to, std::uint64_t marks) {
    for (int i = 0; i < kInvSlots; ++i) {
        if (!((marks >> i) & 1u)) continue;
        ItemSlot& s = from.slots[i];
        if (!item_valid(s.item) || s.count == 0) continue;   // stale mark: skip
        const std::uint16_t unplaced =
            inventory_give(to, s.item, s.count, s.condition);
        if (unplaced != 0) return false;
        s = ItemSlot{};
    }
    return true;
}

// Drain `amount` rubles out of `from`'s UNMARKED slots into `to`. The marked
// ruble stacks are already part of the goods move, so the change must come
// from what was not offered. True only if the full amount both left and landed.
bool move_cash(Inventory& from, Inventory& to, std::uint64_t fromMarks,
               std::int64_t amount) {
    if (amount <= 0) return true;
    std::int64_t left = amount;
    for (int i = 0; i < kInvSlots && left > 0; ++i) {
        if ((fromMarks >> i) & 1u) continue;
        ItemSlot& s = from.slots[i];
        if (s.item != kItemRuble || s.count == 0) continue;
        const std::uint16_t take =
            static_cast<std::uint16_t>(left < s.count ? left : s.count);
        const std::uint16_t unplaced =
            inventory_give(to, kItemRuble, take, s.condition);
        const std::uint16_t moved = static_cast<std::uint16_t>(take - unplaced);
        // Addition law ([inventory.h]): computed in int, stored clamped.
        s.count = static_cast<std::uint16_t>(s.count - moved);
        if (s.count == 0) s = ItemSlot{};
        left -= moved;
        if (unplaced != 0) return false;   // receiver full mid-payment
    }
    return left == 0;
}

} // namespace

BarterTerms barter_terms_for(Faction who) {
    const VendorKind kind = vendor_kind_for(who);
    BarterTerms t;
    t.chargeMultE3 = e3(kBuyMult);
    t.payMultE3 = e3(kSellMult[static_cast<std::size_t>(kind)]);
    return t;
}

BarterPreview barter_preview(const Inventory& own, const Equipped* ownEq,
                             const Inventory& their, const Equipped* theirEq,
                             std::uint64_t ownMarks, std::uint64_t theirMarks,
                             const BarterTerms& terms) {
    BarterPreview p;
    auto occupied = [](const ItemSlot& s) {
        return item_valid(s.item) && s.count > 0;
    };
    for (int i = 0; i < kInvSlots; ++i) {
        if ((theirMarks >> i) & 1u) {
            if (occupied(their.slots[i])) p.anyMarked = true;
            p.takeCost += slot_value(their.slots[i], terms.chargeMultE3);
        }
        if ((ownMarks >> i) & 1u) {
            if (occupied(own.slots[i])) p.anyMarked = true;
            p.givePay += slot_value(own.slots[i], terms.payMultE3);
        }
    }
    p.cash = p.takeCost - p.givePay;
    p.equippedBlocked = any_marked_equipped(ownEq, ownMarks) ||
                        any_marked_equipped(theirEq, theirMarks);
    // The debtor pays with what it physically holds — outside the offer.
    p.debtorRub = p.cash > 0 ? unmarked_rubles(own, ownMarks)
                             : unmarked_rubles(their, theirMarks);
    const std::int64_t owed = p.cash > 0 ? p.cash : -p.cash;
    p.covered = p.debtorRub >= owed;
    p.ok = p.anyMarked && p.covered && !p.equippedBlocked;
    return p;
}

BarterPreview barter_commit(Inventory& own, const Equipped* ownEq,
                            Inventory& their, const Equipped* theirEq,
                            std::uint64_t ownMarks, std::uint64_t theirMarks,
                            const BarterTerms& terms) {
    // The masks ARE the deal: price them here, so a caller cannot commit a
    // preview that drifted from what the screen showed.
    BarterPreview p = barter_preview(own, ownEq, their, theirEq, ownMarks,
                                     theirMarks, terms);
    if (!p.ok) return p;

    // Stage on copies. 384 B each ([inventory.h]) — atomicity for a memcpy.
    Inventory ownStage = own;
    Inventory theirStage = their;

    // Goods first, both directions — freed slots are what makes room for the
    // counter-offer and for the change.
    bool good = move_marked(ownStage, theirStage, ownMarks) &&
                move_marked(theirStage, ownStage, theirMarks);
    // Then the change, from the debtor's unmarked rubles. After the goods
    // moves the marks no longer describe live slots on the stage, but the
    // ruble stacks they shielded are exactly the ones that LEFT if marked —
    // so the original masks still name the right protection set.
    if (good) {
        good = p.cash > 0 ? move_cash(ownStage, theirStage, ownMarks, p.cash)
                          : move_cash(theirStage, ownStage, theirMarks, -p.cash);
    }
    if (!good) {
        p.ok = false;   // a stack did not fit: report, touch nothing
        p.covered = false;
        return p;
    }

    own = ownStage;
    their = theirStage;
    return p;
}

} // namespace giga::game
