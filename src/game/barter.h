// Barter — the deal, as one atomic primitive.
//
// The owner's law ([inventory.md], решение 2026-08-17): trade is not a window
// with prices, it is the SEARCH SCREEN with a policy. Both parties are real
// inventories — the player's 8x8 and the partner's pool row — and a deal is a
// set of MARKED slots on each side plus the cash that settles the difference.
// Loot is the degenerate case (no balance required) and keeps its instant
// transfers; this file only exists for the balanced case.
//
// Three laws, each the answer to a failure the old vendor window had:
//
//   1. **Money moves ITSELF.** Neither side marks rubles: the preview computes
//      the value difference and the commit moves exactly that many ruble items
//      from the debtor's own slots. Marking goods is the decision; change is
//      arithmetic. (Marking a ruble stack IS still legal — it counts at par —
//      but it is never necessary.)
//   2. **A party pays only with what it physically holds.** The reference's own
//      balance doc flags "a rich buyer without a liquidity cap" as its P0; the
//      old window's stand-in was an arbitrary per-visit constant
//      (kSellPerVisitCap, deleted with it). Here the cap is the partner's
//      actual ruble stacks: a trader who cannot cover the difference refuses
//      the deal, and the refusal SHOWS the shortfall. Physics, not tuning.
//   3. **Commit is atomic or nothing.** Both transfers are staged on copies of
//      both inventories; any remainder anywhere — a full bag, a vanished slot,
//      an equipped item in the offer — aborts with both parties untouched. A
//      half-executed trade is theft by bug, in whichever direction.
//
// Valuation is the reference's own spread, ported through [vendor.h]'s
// surviving constants: the partner CHARGES value x1.15 for what the player
// takes and PAYS value x kSellMult[kind] for what the player gives, where kind
// comes from the partner's OWN faction (vendor_kind_for) — a Scientist is a
// better buyer than a Wild scavenger, per row. The ruble itself is exempt from
// both multipliers: money at par in both directions, or change-making itself
// would be taxed and a two-ruble coin would buy one ruble of goods.
//
// Integer money: all sums are int64 of (value x multE3) / 1000, truncated —
// the same coarseness vendor.h documented. Sell < buy survives truncation at
// every price, so the round-trip press stays closed.
//
// Pure game layer: no UI, no registry — two Inventory&, two masks, terms.
// Headless-tested in suite_barter.inl.
#pragma once

#include <cstdint>

#include "game/equip.h"       // Equipped — an offered slot must not be worn
#include "game/faction.h"     // Faction — the partner's own row picks the rate
#include "game/inventory.h"
#include "game/item_table.h"  // item_def, kItemRuble

namespace giga::game {

// The deal's pricing policy. E3 fixed-point, no floats in money math.
struct BarterTerms {
    std::uint16_t chargeMultE3 = 1150;  // what taking the partner's goods costs
    std::uint16_t payMultE3 = 850;      // what the partner pays for yours
};

// Terms against a partner of faction `who` — vendor_kind_for's three rows,
// expressed as E3 ints. The 1.15 charge is universal; the pay rate is the
// partner's, which is what makes WHO you trade with a decision.
BarterTerms barter_terms_for(Faction who);

// The deal, priced. Everything the UI needs to draw the balance line and
// everything the commit needs to refuse — computed in one place so the line
// the player reads and the gate the commit enforces cannot disagree.
struct BarterPreview {
    std::int64_t takeCost = 0;   // marked partner slots, at charge rate
    std::int64_t givePay = 0;    // marked own slots, at pay rate
    std::int64_t cash = 0;       // takeCost - givePay: >0 player owes, <0 partner owes
    std::int64_t debtorRub = 0;  // rubles the debtor actually holds (unmarked)
    bool covered = false;        // the debtor can pay `|cash|` in physical rubles
    bool equippedBlocked = false;  // a marked slot is currently worn
    bool anyMarked = false;      // at least one slot marked on either side
    bool ok = false;             // anyMarked && covered && !equippedBlocked
};

// Price the marked deal. `ownMarks` / `theirMarks` are slot bitmasks (bit k =
// slot k, the widget's mirror law). Either Equipped may be null (a crowd body
// with no worn gear).
BarterPreview barter_preview(const Inventory& own, const Equipped* ownEq,
                             const Inventory& their, const Equipped* theirEq,
                             std::uint64_t ownMarks, std::uint64_t theirMarks,
                             const BarterTerms& terms);

// Execute the marked deal atomically. Re-derives the preview (the masks are
// the deal; a stale preview cannot be smuggled in), stages both directions on
// copies, and commits only if every marked stack lands and the cash covers.
// Returns the preview it acted on; `ok` false means NEITHER inventory moved.
// Wear rides with every moved stack (inventory_give's condition law).
BarterPreview barter_commit(Inventory& own, const Equipped* ownEq,
                            Inventory& their, const Equipped* theirEq,
                            std::uint64_t ownMarks, std::uint64_t theirMarks,
                            const BarterTerms& terms);

} // namespace giga::game
