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
#pragma once

#include <cstdint>

#include "game/extraction.h"
#include "game/inventory.h"
#include "game/item_table.h"

namespace giga::game {

// Who you are trading with. The faction sets the sell rate, so the dominant faction on
// a floor decides how good a buyer you have — which gives `faction_relations.h` a second
// live consumer and makes the territory rumour worth acting on.
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

// Only these categories are stocked. A vendor sells what keeps you alive and shooting;
// it does not sell weapons, because a shop that sells guns removes the reason to open a
// weapon crate on a deep floor, and the crate is the better story.
bool vendor_stocks(ItemCategory cat);

// What one unit costs to buy, in roubles. 0 when the item is not stocked.
std::int32_t vendor_buy_price(ItemId id);

// What one unit fetches when sold to this vendor. 0 when the vendor will not take it.
std::int32_t vendor_sell_price(ItemId id, VendorKind who);

// Buy `count` of `id` into `inv`, paying from `led.banked`.
//
// Returns how many were actually bought, which may be fewer than asked — an inventory
// with two free slots buys two stacks, not five, and a partial purchase is charged only
// for what landed. Reports what LANDED, following `use_best_heal` and `apply_damage`.
std::uint32_t vendor_buy(Inventory& inv, RunLedger& led, ItemId id,
                         std::uint32_t count);

// Sell everything sellable in `inv` to this vendor, up to kSellPerVisitCap.
//
// Sold value goes to `led.banked`, not to a wallet — there is no cash/account split
// here and inventing one would give value two homes. Returns roubles received.
//
// Never sells the equipped weapon or armour, and never sells the last of a survival
// consumable: a vendor that strips you naked and thirsty for a profit is a trap
// disguised as a convenience, and the player would learn not to use it.
std::int32_t vendor_sell_all(Inventory& inv, RunLedger& led, VendorKind who);

// The cheapest useful re-supply: fill up on water, food and bandages within a budget.
// Returns roubles spent. This is the one-keypress path — the interesting decision is
// how much to spend, not which of 446 items to click.
std::int32_t vendor_resupply(Inventory& inv, RunLedger& led, std::int32_t budget);

} // namespace giga::game
