// Vendor valuation constants — what survived the shop.
//
// This header used to BE the economy's sell side: a pad-only trader window,
// vendor_buy/vendor_sell_all against RunLedger.banked, a resupply package and
// an authored per-visit liquidity cap. All of it died on 2026-08-17 with the
// barter increment ([conversation.md], [barter.h]): trade is a DEAL between two
// real inventories now, money is an item ([item_table.h] kItemRuble), and the
// liquidity cap is the partner's physical rubles — the reference's own P0
// ("a rich buyer without a liquidity cap") closed by physics instead of by
// kSellPerVisitCap's tuning constant.
//
// What earns its keep here is the reference's authored PRICE SPREAD, because
// the barter terms are built from it ([barter.h] barter_terms_for):
//
//   trade spread     buy x1.15 / sell x0.85 — a **26% round-trip loss**, which
//                    is what stops buy-low-sell-high from being a money press
//   scientist sell   x0.92 (a better buyer)
//   wild sell        x0.72 (a worse one)
//
// Integer roubles keep the documented coarseness: below ~7 rub the three sell
// rates collapse onto the same integer. The invariant that survives at every
// price is sell < buy — truncation of 0.85x can never exceed 1.15x's.
#pragma once

#include <cstdint>

#include "game/faction.h"

namespace giga::game {

// Who is paying. The rate is the PARTNER's own faction row now, resolved per
// body ([barter.h]) — a Scientist is a better buyer than a Wild scavenger
// wherever you meet them, not wherever their faction rules the floor.
enum class VendorKind : std::uint8_t {
    Citizen = 0,     // the default: buy 1.15, sell 0.85
    Scientist,       // pays better: sell 0.92
    Wild,            // pays worse: sell 0.72
    Count
};

// Buy multiplier — what taking a partner's goods costs above face value. One
// rate for everyone, because the reference authors one.
inline constexpr float kBuyMult = 1.15f;

// Sell multipliers by vendor kind, indexed by VendorKind.
inline constexpr float kSellMult[static_cast<std::size_t>(VendorKind::Count)] = {
    0.85f, 0.92f, 0.72f
};

// Which of the five factions trades at which of the three rates. Five onto
// three, and the collapse is deliberate: kSellMult holds three rates because
// the reference authors three, and inventing two more would be inventing
// balance. Scientists pay best, Wild pay worst, and the civil bloc — Citizens,
// Liquidators, Cultists — is the default. Total, not partial: every Faction
// value including out-of-range garbage maps to a real VendorKind, because the
// return value indexes kSellMult directly.
VendorKind vendor_kind_for(Faction who);

} // namespace giga::game
