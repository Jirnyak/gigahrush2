// The vendor — the half of the economy that was missing.
//
// [extraction.h] made banking the point of a descent, and it worked: value becomes
// permanently yours at the pad. But banked roubles had **no use whatsoever**. You could
// accumulate a quarter of a million and the number would still be a number. An economy
// that only accepts deposits is not an economy, it is a scoreboard — and a scoreboard
// cannot create the decision the survival clock exists to force, because there is
// nothing to spend against the clock.
//
// This closes it: descend, loot, bank, **re-supply**, descend deeper. Water and bandages
// bought with what the last trip earned are the difference between "the timer ran out"
// and "I chose to spend on ammo instead of water".
//
// The reference's own numbers, ported as-is:
//
//   trade spread     buy x1.15 / sell x0.85 — a **26% round-trip loss**, which is what
//                    stops buy-low-sell-high from being a free money press
//   scientist sell   x0.92 (a better buyer)
//   wild sell        x0.72 (a worse one)
//
// The spread is the load-bearing part. Without it, and with a vendor that both buys and
// sells at face value, the optimal play is to stand at the pad cycling the same item
// forever. With it, trading is a service you pay for.
//
// **Deliberately NOT ported: stock, restocking, trader liquidity caps, and haggling.**
// Each is a system, and the reference's own balance doc flags its missing liquidity cap
// as a P0 — "a rich buyer without a liquidity cap turns rare loot into immediate
// snowball". That warning applies to the SELL side, which is why selling is capped here
// by something simpler: see kSellPerVisitCap.
//
// **Ammunition is the one line of stock that cannot be chosen by price**, and getting
// that wrong cost the player their money twice over. Reload is an EXACT id match
// (combat.cpp:721 `sl.item != def->ammo`), so a round that no gun in `kRangedTable`
// chambers is a permanently dead slot — see `vendor_ammo_for` and `vendor_stocks_item`.
#pragma once

#include <cstdint>

#include "game/extraction.h"
#include "game/faction.h"
#include "game/inventory.h"
#include "game/item_table.h"

namespace giga::game {

// Who you are trading with. The faction sets the sell rate, so the dominant faction on
// a floor decides how good a buyer you have — which is what makes the territory rumour
// worth acting on rather than colour.
//
// **Three rows only two of which were ever reachable, until the arrival wiring landed.**
// `src/app/main.cpp` initialised this to Citizen and never reassigned it, so
// `kSellMult[1]` and `kSellMult[2]` below were dead constants and every floor paid 0.85.
// The live consumer is `vendor_kind_for(dominant_faction(...))` called on every floor
// arrival; if that call is ever dropped, this enum silently collapses to one row again.
enum class VendorKind : std::uint8_t {
    Citizen = 0,     // the default: buy 1.15, sell 0.85
    Scientist,       // pays better: sell 0.92
    Wild,            // pays worse: sell 0.72
    Count
};

// Buy multiplier — what you pay above an item's face value. One rate for everyone,
// because the reference authors one.
//
// **Integer roubles cannot represent a 26% spread on a cheap item, and that is a real
// limitation rather than a rounding detail.** Water priced at 2 buys for
// `int(2 * 1.15) = 2` and sells for `int(2 * 0.85) = 1` — a 50% round-trip loss, not
// 26% — and at that scale the three faction sell rates collapse onto the same integer,
// so a Scientist and a Wild buyer pay identically for a bottle of water.
//
// The invariant that survives at every price is the one that matters: **sell is always
// strictly less than buy**, because truncation of 0.85x can never exceed truncation of
// 1.15x. So the money press is closed everywhere; only the exact rate is coarse below
// about 7 roubles. Fixing it properly means pricing in kopecks, which is a currency
// change and not this file's business.
inline constexpr float kBuyMult = 1.15f;

// Sell multipliers by vendor, indexed by VendorKind.
inline constexpr float kSellMult[static_cast<std::size_t>(VendorKind::Count)] = {
    0.85f, 0.92f, 0.72f
};

// What a vendor will pay out in one visit, in roubles.
//
// This stands in for the reference's missing trader-liquidity cap, which its own balance
// doc lists as a P0: an unlimited buyer converts one deep-floor safe into enough money
// to skip the entire early game. A per-visit ceiling is the cheapest honest version —
// you can still sell everything, just not all at once, so a jackpot becomes several
// trips rather than a single snowball.
inline constexpr std::int32_t kSellPerVisitCap = 12000;

// Which of the five factions supplies which of the three vendors.
//
// Five onto three, and the collapse is deliberate: `kSellMult` holds three rates because
// the reference authors three, and inventing two more to fill the enum would be
// inventing balance. Scientists pay best, Wild pay worst, and the civil bloc — Citizens,
// Liquidators, Cultists — is the default buyer.
//
// Total, not partial: every Faction value including out-of-range garbage maps to a real
// VendorKind, because the return value indexes kSellMult directly.
VendorKind vendor_kind_for(Faction who);

// Only these categories are stocked. A vendor sells what keeps you alive and shooting;
// it does not sell weapons, because a shop that sells guns removes the reason to open a
// weapon crate on a deep floor, and the crate is the better story.
bool vendor_stocks(ItemCategory cat);

// Will the vendor sell THIS item — not just its category?
//
// Category alone was not enough and the gap was a live defect. `UseEffect::Unpack` has
// no handler anywhere in src/ — 4 generated table rows and an enumerator, and the game's
// only two use verbs are `use_best_heal` (loot.cpp) and `apply_consumable` (needs.cpp),
// whose signature returns need points rather than items and so cannot express "yields N
// of item X" at all. Worse, the data to write a handler against is not in the table:
// `use_grant_id` / `use_grant_n` are among the columns item_table.h explicitly defers,
// and all four Unpack rows carry `useA == 0` (item_table.cpp rows 6, 44, 185 and 396),
// so even the magnitude is gone. Implementing Unpack is a new ItemDef column plus a
// generator change plus a use verb — three files this one does not own.
//
// So an Unpack row is an item whose only action cannot be performed, and 3 of the 17
// AMMO rows are exactly that: ammo_12g_chemical (90 rub), black_market_shells (42) and
// homemade_9mm (11). Selling one is selling a rock — and the cheapest of the three was
// what the buy key picked. Refusing the sale is the honest half-measure; the pack stays
// in the world as loot and as something the vendor will BUY, so nothing is deleted.
//
// Refused HERE rather than only in `vendor_resupply`, so every buy path is covered by
// the one rule. The SELL side is untouched: the vendor still pays for a pack the player
// hauled up, which is the documented buy/sell asymmetry.
bool vendor_stocks_item(ItemId id);

// The round the vendor will sell to whoever is carrying `inv`, or kInvalidItem.
//
// **Never the cheapest AMMO row, which is what made the buy key worthless.** Reload is
// an exact-id match (combat.cpp:721), so the choice is restricted to ids that appear as
// `RangedDef::ammo` in `kRangedTable` — 10 distinct ids across the 29 guns — which is
// the same resolution `drop_weapon_ammo` uses (loot.cpp:136) and therefore cannot
// disagree with it. Preference order:
//
//   1. the ammo of `equipped_ranged(inv)`, because that is literally the gun
//      `player_ranged_step` will fire (combat.cpp:699). Selling 7.62 to a man holding a
//      shotgun is the same defect one step quieter.
//   2. otherwise the cheapest round some gun in the table chambers — ammo_9mm at 3 rub,
//      which 6 of the 29 guns take. A hedge for a player who has not found a gun yet,
//      and cheap on purpose: all 17 AMMO rows carry spawn weight 0, so no WEIGHTED
//      roller can produce a round and the only other supply in the game is the bundle
//      `drop_weapon_ammo` attaches to a firearm that fell off a corpse.
ItemId vendor_ammo_for(const Inventory& inv);

// What one unit costs to buy, in roubles. 0 when the item is not stocked.
struct RpgStats;
std::int32_t vendor_buy_price(ItemId id, std::int8_t playerRelation = 0);

// What one unit fetches when sold to this vendor. 0 when the vendor will not take it.
std::int32_t vendor_sell_price(ItemId id, VendorKind who, const RpgStats* rpg = nullptr,
                               std::int8_t playerRelation = 0);

// Buy `count` of `id` into `inv`, paying from `led.banked`.
//
// Returns how many were actually bought, which may be fewer than asked — an inventory
// with two free slots buys two stacks, not five, and a partial purchase is charged only
// for what landed. Reports what LANDED, following `use_best_heal` and `apply_damage`.
std::uint32_t vendor_buy(Inventory& inv, RunLedger& led, ItemId id,
                         std::uint32_t count, std::int8_t playerRelation = 0);

// Sell everything sellable in `inv` to this vendor, up to kSellPerVisitCap.
//
// Sold value goes to `led.banked`, not to a wallet — there is no cash/account split
// here and inventing one would give value two homes. Returns roubles received.
//
// Never sells the equipped weapon or armour, and never sells the last of a survival
// consumable: a vendor that strips you naked and thirsty for a profit is a trap
// disguised as a convenience, and the player would learn not to use it.
std::int32_t vendor_sell_all(Inventory& inv, RunLedger& led, VendorKind who,
                             const RpgStats* rpg = nullptr, std::int8_t playerRelation = 0);

// The cheapest useful re-supply: water, medicine, food and a magazine, within a budget.
// Returns roubles spent. This is the one-keypress path — the interesting decision is
// how much to spend, not which of 446 items to click.
//
// Three of the four categories are picked on price; ammunition is picked by
// `vendor_ammo_for`, because "cheapest" is the wrong question for a round that has to
// fit a gun. The purse is split evenly per category, and so are the SLOTS — measured on
// an empty inventory with a 50,000-rouble budget, the first three categories took 57 of
// the 64 slots before the split existed, which starved the category that goes last.
std::int32_t vendor_resupply(Inventory& inv, RunLedger& led, std::int32_t budget);

} // namespace giga::game
