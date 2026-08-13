// The vendor's ammunition, and the two defects that made the buy key a money burner.
//
// This suite exists because the previous assertion was "some item of ItemCategory::Ammo
// landed in the inventory", and that is satisfiable by an item the game can do nothing
// with. Measured over data/items.csv and data/weapons_ranged.csv:
//
//   17    AMMO rows
//    3    of them carry a non-None use effect, and all 3 are `UseEffect::Unpack`
//         (ammo_12g_chemical 90 rub, black_market_shells 42, homemade_9mm 11)
//   10    distinct ids actually appear as `RangedDef::ammo` across the 29 guns
//    7    AMMO rows are chambered by NOTHING in kRangedTable
//    0    handlers exist anywhere in src/ for `UseEffect::Unpack`
//
// `vendor_resupply` filtered candidates on "use effect != None" and then took the
// CHEAPEST, so R at the pad bought homemade_9mm every time: not the ammo of any of the
// 29 guns, and a pack whose only action is unimplemented. Reload is an exact-id match
// (combat.cpp:721 `sl.item != def->ammo`), so the purchase was a permanently dead slot —
// strictly worse than buying nothing, because it also cost money.
//
// So the assertions here are the two the old one was missing: the id the vendor sells
// must be chambered by a gun that EXISTS, and it must survive the real reload path.
// Block 5 does not inspect a slot and declare victory — it runs `player_ranged_step` and
// requires `PlayerRanged::magCount` to come back non-zero, which is the same code the
// player's trigger runs.
//
// This is a .inl and not a .cpp for the reason suite_packs.inl states: game_test.cpp
// owns the CHECK macro, so the include has to land after it, and the suite carries its
// own includes of the systems under test to keep that diff two lines.

#include <cstdio>
#include <vector>

#include "core/tick.h"
#include "game/combat.h"
#include "game/ranged_table.h"
#include "game/rumour.h"
#include "game/vendor.h"

namespace vendorammo_detail {

// Is `id` the ammunition of some gun in kRangedTable? This is the property the vendor
// now enforces, and it is exactly what combat.cpp's exact-id reload requires — not
// "category is Ammo", which is what the old test measured.
inline bool chambered_by_some_gun(ItemId id) {
    for (const RangedDef& r : kRangedTable)
        if (r.ammo == id) return true;
    return false;
}

// Every firearm's ItemId. `kRangedByItem` is a sparse ItemId -> row map and there is no
// reverse map, so walking the item table through `ranged_for_item` is the only honest
// way round — and it means this cannot drift from the generated table.
inline std::vector<ItemId> all_guns() {
    std::vector<ItemId> out;
    for (ItemId id = 1; id <= kItemCount; ++id)
        if (ranged_for_item(id)) out.push_back(id);
    return out;
}

// Total count of `id` across the whole inventory. Ammunition can land in several slots
// once a stack fills, so a single-slot check would under-report.
inline std::uint32_t held(const Inventory& inv, ItemId id) {
    std::uint32_t n = 0;
    for (const ItemSlot& s : inv.slots)
        if (s.item == id) n += s.count;
    return n;
}

// The first AMMO-category id in the inventory, or kInvalidItem. What the player would
// see as "the ammunition the vendor sold me".
inline ItemId ammo_in(const Inventory& inv) {
    for (const ItemSlot& s : inv.slots) {
        if (!item_valid(s.item) || s.count == 0) continue;
        if (static_cast<ItemCategory>(item_def(s.item).category) == ItemCategory::Ammo)
            return s.item;
    }
    return kInvalidItem;
}

// A shooter the way combat.cpp resolves one: CameraTag + Transform on the layer, plus an
// NpcRef into a live pool row whose inventory is where the magazine comes from.
inline Entity make_shooter(Registry& reg, NpcPool& pool, NpcId id, LayerId layer) {
    Entity e = reg.create();
    Transform tr;
    tr.pos = vec3{40.0f, 40.0f, 40.0f};
    tr.layer = layer;
    reg.emplace<Transform>(e, tr);
    reg.emplace<NpcRef>(e, NpcRef{id});
    reg.emplace<CameraTag>(e, CameraTag{});
    return e;
}

} // namespace vendorammo_detail

static void test_vendorammo_all() {
    using namespace vendorammo_detail;

    const std::vector<ItemId> guns = all_guns();

    { // ---- 1. the premise, from the data rather than from prose ---------------
        int ammoRows = 0, withEffect = 0, unpackRows = 0, chambered = 0;
        ItemId cheapestEffectRow = kInvalidItem;
        std::int32_t cheapestEffectValue = 0;
        for (ItemId id = 1; id <= kItemCount; ++id) {
            const ItemDef& d = item_def(id);
            if (static_cast<ItemCategory>(d.category) != ItemCategory::Ammo) continue;
            ++ammoRows;
            if (chambered_by_some_gun(id)) ++chambered;
            if (static_cast<UseEffect>(d.useEffect) == UseEffect::None) continue;
            ++withEffect;
            if (static_cast<UseEffect>(d.useEffect) == UseEffect::Unpack) ++unpackRows;
            // What the OLD selection rule would have picked: cheapest of the rows that
            // survive the use-effect filter.
            if (cheapestEffectRow == kInvalidItem || d.value < cheapestEffectValue) {
                cheapestEffectRow = id;
                cheapestEffectValue = d.value;
            }
        }
        CHECK(ammoRows == 17);
        CHECK(withEffect == 3);
        CHECK(unpackRows == 3);        // all three, so the filter selected only packs
        CHECK(chambered == 10);
        CHECK(guns.size() == kRangedCount);
        // 29 firearms + `grenade` (2026-08-13). The ammo arithmetic above is unmoved
        // by the new row and that is the point of pinning it here: a thrown weapon is
        // its own ammunition, so it adds no AMMO row, chambers no AMMO row, and gives
        // the vendor nothing new to sell.
        static_assert(kRangedCount == 30u);

        // THE DEFECT, pinned. The row the old rule chose exists, is cheap, and is the
        // ammunition of nothing — so this CHECK is what fails if the price-first
        // selection is ever written back.
        CHECK(cheapestEffectRow != kInvalidItem);
        CHECK(cheapestEffectValue == 11);                        // homemade_9mm
        CHECK(!chambered_by_some_gun(cheapestEffectRow));
        std::fprintf(stderr,
                     "[vendorammo] AMMO rows=%d use-effect=%d unpack=%d chambered=%d; "
                     "old rule would buy id %u (%d rub, chambered=%d)\n",
                     ammoRows, withEffect, unpackRows, chambered,
                     static_cast<unsigned>(cheapestEffectRow), cheapestEffectValue,
                     chambered_by_some_gun(cheapestEffectRow) ? 1 : 0);
    }

    { // ---- 2. the vendor refuses what it cannot make usable -------------------
        int unpackAnywhere = 0, refusedUnpack = 0, ammoPriced = 0;
        for (ItemId id = 1; id <= kItemCount; ++id) {
            const ItemDef& d = item_def(id);
            const bool unpack =
                static_cast<UseEffect>(d.useEffect) == UseEffect::Unpack;
            if (unpack) {
                ++unpackAnywhere;
                // No handler exists for Unpack, so no buy path may sell one — checked
                // at the PRICE, which is the gate every buy path goes through.
                CHECK(!vendor_stocks_item(id));
                CHECK(vendor_buy_price(id) == 0);
                if (vendor_buy_price(id) == 0) ++refusedUnpack;
                // The SELL side is deliberately untouched: the vendor still pays for a
                // pack the player hauled up. That asymmetry is documented in vendor.cpp.
                if (d.value > 0)
                    CHECK(vendor_sell_price(id, VendorKind::Citizen) > 0);
            }
            if (static_cast<ItemCategory>(d.category) != ItemCategory::Ammo) continue;
            // A priced round is a chambered round, and every chambered round with a
            // price is purchasable. Both directions, or the rule is half a rule.
            if (vendor_buy_price(id) > 0) {
                ++ammoPriced;
                CHECK(chambered_by_some_gun(id));
            } else {
                CHECK(!chambered_by_some_gun(id) || d.value <= 0);
            }
        }
        CHECK(unpackAnywhere == 4);          // 3 AMMO + stolen_filter_pack (MISC)
        CHECK(refusedUnpack == unpackAnywhere);
        CHECK(ammoPriced == 10);             // exactly the chambered set
        // The category promise still holds — this fix narrows WHICH row, not whether
        // the vendor deals in ammunition at all.
        CHECK(vendor_stocks(ItemCategory::Ammo));
    }

    { // ---- 3. with no gun, the fallback is a real round and the cheapest one --
        Inventory bare{};
        const ItemId pick = vendor_ammo_for(bare);
        CHECK(pick != kInvalidItem);
        CHECK(chambered_by_some_gun(pick));
        CHECK(vendor_buy_price(pick) > 0);
        const std::int32_t pickPrice = vendor_buy_price(pick);
        for (const RangedDef& r : kRangedTable) {
            const std::int32_t p = vendor_buy_price(r.ammo);
            if (p > 0) CHECK(pickPrice <= p);
        }
        std::fprintf(stderr, "[vendorammo] no gun -> id %u at %d rub\n",
                     static_cast<unsigned>(pick), pickPrice);
    }

    { // ---- 4. with a gun, it is THAT gun's round, for all 29 -----------------
        // "A vendor selling 7.62 to a man with a shotgun" is the same defect one step
        // quieter, so this is asserted for every row rather than for a sample.
        //
        // FIREARMS only. A thrown weapon is its own ammunition ([ranged_table.h]), so
        // "resupply the round this weapon takes" is not a question it can be asked —
        // more grenades are more grenades, bought through the shop's ordinary item
        // path. `firearms` and not `guns.size()` below, so adding a second thrown row
        // cannot quietly shrink what this block covers.
        std::size_t matched = 0, buyable = 0, firearms = 0;
        for (ItemId gun : guns) {
            const RangedDef* def = ranged_for_item(gun);
            CHECK(def != nullptr);
            if (!def) continue;
            if (ranged_is_thrown(gun)) continue;
            ++firearms;
            Inventory inv{};
            inv.slots[0] = ItemSlot{gun, 1};
            const ItemId pick = vendor_ammo_for(inv);
            CHECK(pick != kInvalidItem);
            CHECK(chambered_by_some_gun(pick));
            // Every one of the 29 guns' ammo rows is priced, so the preference branch
            // must fire for all 29 — if any gun fell through to the cheap fallback this
            // would catch it.
            CHECK(pick == def->ammo);
            if (pick == def->ammo) ++matched;

            // And the round can actually be bought and put in the bag.
            RunLedger led{};
            led.banked = 40000;
            if (vendor_buy(inv, led, pick, 4u) == 4u) ++buyable;
            CHECK(held(inv, pick) == 4u);
        }
        CHECK(firearms == kRangedCount - 1u);   // 30 rows, one of them thrown
        CHECK(matched == firearms);
        CHECK(buyable == firearms);
    }

    { // ---- 5. 50,000 roubles buys rounds, and the rounds LOAD ----------------
        // The brief's two claims in one pass, and the load is proved by running the
        // player's own reload rather than by reading the slot back.
        NpcPool pool;
        pool.init();
        const NpcId sid = pool.spawn();
        CHECK(pool.valid(sid));

        // A shotgun, so the answer cannot be the cheap fallback by accident: shells buy
        // at 13 rub against 9mm's 3, and no gun in the table shares both.
        ItemId shotgun = kInvalidItem;
        for (ItemId gun : guns)
            if (ranged_for_item(gun)->pellets > 1) { shotgun = gun; break; }
        CHECK(shotgun != kInvalidItem);
        const RangedDef* def = ranged_for_item(shotgun);
        CHECK(def != nullptr);

        Inventory& inv = pool.inventory(sid);
        inv.clear();
        inv.slots[0] = ItemSlot{shotgun, 1};

        RunLedger led{};
        led.banked = 200000;
        const std::int32_t spent = vendor_resupply(inv, led, 50000);
        CHECK(spent > 0);

        const ItemId sold = ammo_in(inv);
        CHECK(sold != kInvalidItem);          // it bought ammunition at all
        CHECK(sold == def->ammo);             // ...for the gun in the bag
        CHECK(chambered_by_some_gun(sold));   // ...which some gun chambers
        const std::uint32_t rounds = held(inv, sold);
        CHECK(rounds > 0u);
        std::fprintf(stderr,
                     "[vendorammo] resupply(50000) spent %d rub, bought %u of id %u "
                     "for gun id %u (mag %u)\n",
                     spent, rounds, static_cast<unsigned>(sold),
                     static_cast<unsigned>(shotgun),
                     static_cast<unsigned>(def->magazine));

        // Never sold a pack, whatever else it bought.
        for (const ItemSlot& s : inv.slots) {
            if (!item_valid(s.item) || s.count == 0) continue;
            CHECK(static_cast<UseEffect>(item_def(s.item).useEffect) !=
                  UseEffect::Unpack);
        }

        // THE END-TO-END CLAIM. player_ranged_step picks the gun with `equipped_ranged`,
        // then moves rounds out of the inventory on an exact id match. wantFire is false
        // on purpose: the reload branch returns before the trigger is consulted, so this
        // measures loading and nothing else.
        Registry reg;
        const LayerId layer = 0;
        const Entity shooter = make_shooter(reg, pool, sid, layer);
        const std::uint32_t before = held(inv, sold);
        const std::uint32_t fired = player_ranged_step(
            reg, pool, layer, /*wantFire=*/false, kSimDt, /*tick=*/0u);
        CHECK(fired == 0u);                   // a reload tick fires nothing
        const PlayerRanged* pr = reg.try_get<PlayerRanged>(shooter);
        CHECK(pr != nullptr);
        if (pr) {
            // The magazine is non-empty, which is only reachable through
            // `sl.item == def->ammo` — the exact-id match the old purchase failed.
            CHECK(pr->magCount > 0);
            CHECK(pr->weapon == shotgun);
            CHECK(pr->reloadMs == def->reloadMs);
            CHECK(pr->magCount <= def->magazine);
            // ...and the rounds came out of the bag, so the load is a transfer and not
            // a free magazine.
            CHECK(held(inv, sold) == before - pr->magCount);
            std::fprintf(stderr,
                         "[vendorammo] reload moved %u of %u purchased rounds into the "
                         "magazine\n",
                         static_cast<unsigned>(pr->magCount),
                         static_cast<unsigned>(before));
        }
    }

    { // ---- 6. and the same holds for a player who owns no gun yet ------------
        // The vendor is the only supply there is (all 17 AMMO rows have spawn weight 0),
        // so buying ahead of the gun has to leave a usable stack.
        RunLedger led{};
        led.banked = 200000;
        Inventory inv{};
        CHECK(vendor_resupply(inv, led, 50000) > 0);
        const ItemId sold = ammo_in(inv);
        CHECK(sold != kInvalidItem);
        CHECK(chambered_by_some_gun(sold));
        CHECK(held(inv, sold) > 0u);

        // Slots, not roubles, are what runs out: the first three categories used to take
        // 57 of 64 and starve the category that goes last. Printed and bounded.
        std::size_t used = 0;
        for (const ItemSlot& s : inv.slots)
            if (s.item != kInvalidItem) ++used;
        std::fprintf(stderr,
                     "[vendorammo] no-gun resupply used %zu of %d slots, %u rounds of "
                     "id %u\n",
                     used, kInvSlots, held(inv, sold), static_cast<unsigned>(sold));
        CHECK(used < static_cast<std::size_t>(kInvSlots));   // room was left over
    }

    { // ---- 7. all three sell rates are reachable, which is the second defect --
        // `kSellMult` has three entries and main.cpp pinned VendorKind to Citizen
        // forever, so two of them were dead constants. `vendor_kind_for` is the mapping
        // that makes them reachable; `dominant_faction` is the input, and it had to be
        // exported from rumour.cpp's anonymous namespace to be usable at all — this
        // block failing to LINK is itself the regression signal.
        CHECK(vendor_kind_for(Faction::Citizens) == VendorKind::Citizen);
        CHECK(vendor_kind_for(Faction::Liquidators) == VendorKind::Citizen);
        CHECK(vendor_kind_for(Faction::Cultists) == VendorKind::Citizen);
        CHECK(vendor_kind_for(Faction::Scientists) == VendorKind::Scientist);
        CHECK(vendor_kind_for(Faction::Wild) == VendorKind::Wild);
        // Total over the enum, including the out-of-range Count sentinel: the result
        // indexes kSellMult, so a gap here would be a read past the array.
        for (std::uint8_t f = 0; f <= static_cast<std::uint8_t>(Faction::Count); ++f)
            CHECK(vendor_kind_for(static_cast<Faction>(f)) < VendorKind::Count);

        // Every faction is a reachable vendor through a real population count. A layer
        // of Scientist bodies pays 0.92 and a layer of Wild bodies pays 0.72 — the two
        // rates that could never fire before.
        NpcPool pool;
        pool.init();
        Registry reg;
        const LayerId layer = 3;
        const std::uint8_t kWild = static_cast<std::uint8_t>(Faction::Wild);
        for (int i = 0; i < 5; ++i) {
            const NpcId id = pool.spawn();
            pool.faction(id) = kWild;
            Entity e = reg.create();
            Transform tr;
            tr.pos = vec3{10.0f + static_cast<float>(i), 10.0f, 4.0f};
            tr.layer = layer;
            reg.emplace<Transform>(e, tr);
            reg.emplace<NpcRef>(e, NpcRef{id});
            pool.set_floor(id, layer);
        }
        // One Scientist body, so the tally is a real majority and not a single sample.
        {
            const NpcId id = pool.spawn();
            pool.faction(id) = static_cast<std::uint8_t>(Faction::Scientists);
            Entity e = reg.create();
            Transform tr;
            tr.pos = vec3{20.0f, 10.0f, 4.0f};
            tr.layer = layer;
            reg.emplace<Transform>(e, tr);
            reg.emplace<NpcRef>(e, NpcRef{id});
            pool.set_floor(id, layer);
        }
        CHECK(dominant_faction(pool, layer) == Faction::Wild);
        // A layer nobody stands on answers Citizens, which is also the default vendor —
        // so an empty floor is a safe input rather than an out-of-range index.
        CHECK(dominant_faction(pool, layer + 1) == Faction::Citizens);

        const VendorKind who = vendor_kind_for(dominant_faction(pool, layer));
        CHECK(who == VendorKind::Wild);

        // The rate actually differs, which is the whole point of feeding this through.
        // Asserted on a dear item because integer roubles cannot express the three rates
        // apart below about 7 rub — vendor.h records that limitation.
        ItemId dear = kInvalidItem;
        for (ItemId id = 1; id <= kItemCount; ++id)
            if (item_def(id).value >= 1000) { dear = id; break; }
        CHECK(dear != kInvalidItem);
        if (dear != kInvalidItem) {
            const std::int32_t asWild = vendor_sell_price(dear, VendorKind::Wild);
            const std::int32_t asCit = vendor_sell_price(dear, VendorKind::Citizen);
            const std::int32_t asSci = vendor_sell_price(dear, VendorKind::Scientist);
            CHECK(asWild < asCit);
            CHECK(asCit < asSci);
            std::fprintf(stderr,
                         "[vendorammo] item %u sells for %d wild / %d citizen / %d "
                         "scientist\n",
                         static_cast<unsigned>(dear), asWild, asCit, asSci);
        }
    }
}
