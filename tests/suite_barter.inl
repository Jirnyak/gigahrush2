// Barter — the atomic deal ([barter.h], [conversation.md]).
//
// Replaces suite_vendorammo.inl, which tested the pad shop this increment
// deleted. What it pins instead is the deal's three laws: money moves itself,
// a party pays only with what it physically holds, and commit is atomic or
// nothing. All headless, all against two plain Inventory PODs — the same call
// the search screen's T key makes.
//
// Subjects are resolved by PROPERTY, never by hardcoded id (items.csv is
// alphabetical; an insert renumbers everything — the suite_craft rule).
namespace barter_detail {

// A goods row with a real price and a stack: barter math is exercised on it.
inline ItemId priced_goods(std::int32_t minValue, std::uint16_t minStack) {
    for (ItemId i = 1; i <= kItemCount; ++i) {
        if (i == kItemRuble) continue;
        const ItemDef& d = item_def(i);
        if (d.value >= minValue && d.stackMax >= minStack) return i;
    }
    return kInvalidItem;
}

inline bool same_inventory(const Inventory& a, const Inventory& b) {
    return std::memcmp(&a, &b, sizeof(Inventory)) == 0;
}

} // namespace barter_detail

// --- money moves itself, and the spread prices both directions ---------------
static void barter_cash_settles_the_difference() {
    using namespace barter_detail;
    const BarterTerms t = barter_terms_for(Faction::Citizens);
    const ItemId goods = priced_goods(100, 4);
    CHECK(goods != kInvalidItem);
    const std::int64_t face = item_def(goods).value;

    // The partner offers 4 of the goods; the player marks them and nothing else.
    Inventory mine, theirs;
    CHECK(inventory_give(mine, kItemRuble, 65535) == 0);
    theirs.slots[0] = ItemSlot{goods, 4};

    const BarterPreview p =
        barter_preview(mine, nullptr, theirs, nullptr, 0ull, 1ull, t);
    CHECK(p.anyMarked);
    CHECK(p.takeCost == face * 4 * 1150 / 1000);   // charge rate, truncated
    CHECK(p.givePay == 0);
    CHECK(p.cash == p.takeCost);                    // the player owes it all
    CHECK(p.covered);                               // ...and can pay
    CHECK(p.ok);

    const BarterPreview done =
        barter_commit(mine, nullptr, theirs, nullptr, 0ull, 1ull, t);
    CHECK(done.ok);
    // The goods arrived, the exact cash left, the partner holds it now.
    std::int64_t myGoods = 0, myRub = 0, theirRub = 0;
    for (const ItemSlot& s : mine.slots) {
        if (s.item == goods) myGoods += s.count;
        if (s.item == kItemRuble) myRub += s.count;
    }
    for (const ItemSlot& s : theirs.slots)
        if (s.item == kItemRuble) theirRub += s.count;
    CHECK(myGoods == 4);
    CHECK(myRub == 65535 - p.takeCost);
    CHECK(theirRub == p.takeCost);
}

// --- the liquidity law: a partner pays with what it HOLDS --------------------
static void barter_liquidity_is_physical() {
    using namespace barter_detail;
    const BarterTerms t = barter_terms_for(Faction::Citizens);
    const ItemId goods = priced_goods(1000, 1);
    CHECK(goods != kInvalidItem);
    const std::int64_t pay = item_def(goods).value * 850 / 1000;

    // The player offers the valuable; the partner holds LESS cash than it pays.
    Inventory mine, theirs;
    mine.slots[0] = ItemSlot{goods, 1};
    CHECK(inventory_give(theirs, kItemRuble,
                         static_cast<std::uint16_t>(pay - 1)) == 0);

    const Inventory mine0 = mine, theirs0 = theirs;
    BarterPreview p = barter_preview(mine, nullptr, theirs, nullptr, 1ull, 0ull, t);
    CHECK(p.cash == -pay);          // the partner owes
    CHECK(p.debtorRub == pay - 1);  // ...and is one ruble short
    CHECK(!p.covered);
    CHECK(!p.ok);
    // Commit refuses and moves NOTHING — the reference's P0 (a rich buyer
    // without a liquidity cap) closed by physics: this buyer is simply poor.
    p = barter_commit(mine, nullptr, theirs, nullptr, 1ull, 0ull, t);
    CHECK(!p.ok);
    CHECK(same_inventory(mine, mine0));
    CHECK(same_inventory(theirs, theirs0));

    // Hand the partner one more ruble and the same deal signs.
    CHECK(inventory_give(theirs, kItemRuble, 1) == 0);
    p = barter_commit(mine, nullptr, theirs, nullptr, 1ull, 0ull, t);
    CHECK(p.ok);
    std::int64_t myRub = 0;
    for (const ItemSlot& s : mine.slots)
        if (s.item == kItemRuble) myRub += s.count;
    CHECK(myRub == pay);            // paid in full, in physical rubles
}

// --- the ruble is exempt from the spread, in both directions -----------------
static void barter_money_at_par() {
    const BarterTerms t = barter_terms_for(Faction::Wild);  // worst payer
    Inventory mine, theirs;
    // Marking a ruble stack IS legal and counts at par — otherwise making
    // change would tax itself and two marked rubles would buy one of goods.
    mine.slots[0] = ItemSlot{kItemRuble, 100};
    theirs.slots[0] = ItemSlot{kItemRuble, 100};
    const BarterPreview p =
        barter_preview(mine, nullptr, theirs, nullptr, 1ull, 1ull, t);
    CHECK(p.takeCost == 100);   // not 115
    CHECK(p.givePay == 100);    // not 72
    CHECK(p.cash == 0);
    CHECK(p.ok);
}

// --- equipped gear never enters the offer ------------------------------------
static void barter_worn_gear_is_blocked() {
    using namespace barter_detail;
    const BarterTerms t = barter_terms_for(Faction::Citizens);
    ItemId wpn = kInvalidItem;
    for (ItemId i = 1; i <= kItemCount; ++i)
        if (static_cast<EquipSlot>(item_def(i).equipSlot) == EquipSlot::Weapon) {
            wpn = i;
            break;
        }
    CHECK(wpn != kInvalidItem);

    Inventory mine, theirs;
    mine.slots[3] = ItemSlot{wpn, 1};
    CHECK(inventory_give(theirs, kItemRuble, 60000) == 0);
    Equipped eq{};
    CHECK(equip_item(mine, eq, 3));

    const Inventory mine0 = mine, theirs0 = theirs;
    BarterPreview p = barter_preview(mine, &eq, theirs, nullptr, 1ull << 3, 0ull, t);
    CHECK(p.equippedBlocked);
    CHECK(!p.ok);
    p = barter_commit(mine, &eq, theirs, nullptr, 1ull << 3, 0ull, t);
    CHECK(!p.ok);
    CHECK(same_inventory(mine, mine0));
    CHECK(same_inventory(theirs, theirs0));

    // Take it off and the same slot trades. Selling your weapon is a choice,
    // never a trap — the block is on the DECISION, not the item.
    CHECK(unequip_slot(eq, EquipSlot::Weapon));
    p = barter_commit(mine, &eq, theirs, nullptr, 1ull << 3, 0ull, t);
    CHECK(p.ok);
}

// --- atomic or nothing: a full bag aborts the whole deal ---------------------
static void barter_full_bag_aborts_whole() {
    using namespace barter_detail;
    const BarterTerms t = barter_terms_for(Faction::Citizens);
    const ItemId goods = priced_goods(30, 1);
    ItemId filler = kInvalidItem;
    for (ItemId i = 1; i <= kItemCount; ++i)
        if (i != goods && i != kItemRuble && item_def(i).stackMax == 1) {
            filler = i;
            break;
        }
    CHECK(goods != kInvalidItem && filler != kInvalidItem);

    // My bag: 63 slots of unstackable filler + the ruble wad. Their two goods
    // cannot BOTH land, and the deal is the whole offer — any remainder
    // anywhere must abort everything, or a half-executed trade is theft by bug.
    Inventory mine, theirs;
    for (int i = 0; i < kInvSlots - 1; ++i) mine.slots[i] = ItemSlot{filler, 1};
    mine.slots[kInvSlots - 1] = ItemSlot{kItemRuble, 60000};
    theirs.slots[0] = ItemSlot{goods, 1};
    theirs.slots[1] = ItemSlot{goods, 1};

    const Inventory mine0 = mine, theirs0 = theirs;
    const BarterPreview p =
        barter_commit(mine, nullptr, theirs, nullptr, 0ull, 3ull, t);
    CHECK(!p.ok);
    CHECK(same_inventory(mine, mine0));
    CHECK(same_inventory(theirs, theirs0));
}

// --- wear rides the deal -----------------------------------------------------
static void barter_condition_travels() {
    using namespace barter_detail;
    const BarterTerms t = barter_terms_for(Faction::Citizens);
    const ItemId goods = priced_goods(10, 1);
    CHECK(goods != kInvalidItem);
    Inventory mine, theirs;
    theirs.slots[0] = ItemSlot{goods, 1, 77};   // a worn instance
    CHECK(inventory_give(mine, kItemRuble, 60000) == 0);

    const BarterPreview p =
        barter_commit(mine, nullptr, theirs, nullptr, 0ull, 1ull, t);
    CHECK(p.ok);
    bool found = false;
    for (const ItemSlot& s : mine.slots)
        if (s.item == goods) {
            found = true;
            CHECK(s.condition == 77);   // still worn: no dup-repair via trade
        }
    CHECK(found);
}

static void test_barter_all() {
    barter_cash_settles_the_difference();
    barter_liquidity_is_physical();
    barter_money_at_par();
    barter_worn_gear_is_blocked();
    barter_full_bag_aborts_whole();
    barter_condition_travels();
    std::fprintf(stderr,
                 "[barter] deal laws hold: auto-cash, physical liquidity, "
                 "par money, worn-gear block, atomicity, wear rides\n");
}
