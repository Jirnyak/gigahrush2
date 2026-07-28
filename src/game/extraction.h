// Extraction — the half of the loop the reference never had.
//
// The game is *Спуск и Экстракция*, Descent & Extraction. [loot.h] built the descent
// half: depth raises the value cap, so one more floor down is worth more. This file
// builds the other half, and without it the descent has no shape at all — if loot is
// yours the instant you touch it, there is never a reason to walk back up.
//
// **This is designed here, not ported.** Three things were searched for in the
// reference (2272 lines of its economics/balance/design docs, read in full) and are
// absent from all of them:
//
//   * **No cost of player death.** No insurance, no gear loss, no corpse run, no
//     permadeath statement, no respawn penalty. Its entire loss model points
//     *outward* at the world — NPCs die permanently, containers stay opened, floors
//     stay altered — and never *inward* at the player. Its own definition of done
//     asks only that a death be *readable*, never that it *cost* anything.
//   * **No weight and no encumbrance.** 25 slots x 999 stack, and its balance doc
//     rejects weight on purpose: "scarcity держится доступностью, а не весом". So
//     "what do I leave behind" is not a decision that exists.
//   * **No turn-back mechanic.** The closest artifact is a *proposed* debug metric.
//
// So the greed curve is built from a different lever, because inventory pressure is
// not available: **value is not yours until it is banked.** Carry it and it is at
// risk; bank it and it is permanent. That single rule creates the decision the
// reference's own numbers could not — by its table a high-risk run pays 33 rub/min
// against 20 rub/min for a safe one, only 1.65x for triple the risk, which is a
// weak gradient. Making the *carried* pile forfeit on death multiplies the stake by
// how long you have been greedy, which is exactly the curve wanted.
//
// The death cost needs no new machinery, which is why this shape was chosen. Death
// already hands you a different body ([main.cpp] possess_a_survivor) and inventory
// is already canonical in the pool row ([npcs.md]) — so the dead row keeps its
// items, no living body can reach them, and the loss is *already* real and
// permanent. All that was missing was making it VISIBLE. An invisible cost is not a
// cost; the player must be able to read what that death took.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "game/inventory.h"
#include "game/item_table.h"
#include "world/macro_grid.h"

namespace giga::game {

// Running score for one life-and-descent cycle. Small POD so it serializes with the
// save verbatim and can be copied into a report without a thought.
//
// 64-bit for the two totals on purpose: the E4 band caps a single item at 250,000
// rub, so a long session's running sum can leave int32 behind, and a wealth counter
// that wraps to negative is the kind of bug that surfaces only for the players who
// played the most.
struct RunLedger {
    std::int64_t banked = 0;        // safe, permanent, yours
    std::int64_t lostToDeath = 0;   // gone; the number that makes death mean something
    std::int32_t bestHaul = 0;      // largest single deposit
    std::uint32_t deposits = 0;
    std::uint32_t deaths = 0;
    int deepestFloor = 0;           // the signed floor whose |z| was the greatest
    std::uint8_t deepestBand = 0;   // economy_band(deepestFloor)
};

// The pad is the bank. `kMatHubPad` already exists as a cell material and is already
// generated into the hub floor ([floor_gen.cpp]) as the nav/fast-travel pad, so the
// extraction point is somewhere the player already recognises and already walks to.
// No new geometry, no new art, no new interaction verb.
inline constexpr float kExtractReachZ = 2.5f;   // metres above the pad that still count

// Is this position standing on an extraction pad? Checks the cell under the feet and
// one below it, because a body rests slightly above the surface it stands on and a
// pad you can only bank on by clipping into it is a pad that looks broken.
bool on_extraction_pad(const MacroGrid& grid, const vec3& pos);

// Should this slot be banked?
//
// The rule is "bank the haul, keep the kit": everything goes EXCEPT the equipped
// weapon and armour, and except Food / Drink / Medicine / Ammo / Key. Spare weapons
// and tools DO bank — you can only wield one, and a spare is treasure.
//
// This is what stops banking from being a trap. If depositing stripped you naked,
// the correct play would be to never bank at all, and the mechanic would be dead on
// arrival. It also keeps a Key — a route key is progress, not money, and selling
// your way out of a locked floor is not a decision anyone would enjoy making twice.
bool bankable_category(ItemCategory cat);
bool bankable_slot(const Inventory& inv, int slot);

// Sweep every bankable slot into the ledger and clear those slots. Returns what was
// banked this call; 0 when there was nothing to bank, which is the common case since
// this runs every tick you stand on the pad.
std::int32_t deposit_valuables(Inventory& inv, RunLedger& led);

// Total value in the inventory, bankable or not. This is what a death takes — all of
// it, kit included — so it is the honest number for "at risk", not the bankable
// subset.
std::int32_t at_risk_value(const Inventory& inv);

// Record a death and what it cost. Read the DEAD row's inventory: the pool never
// reclaims a slot, so the items are still sitting there, and still unreachable.
void record_death(RunLedger& led, const Inventory& lost);

// Track the deepest point reached. |z|, because depth is bidirectional here — the
// roof at +50 is as far from safety as the basement at -50.
void record_floor(RunLedger& led, int floorZ);

// Share of everything you own that a single death would take, 0..1.
//
// This is the greed reading, and it is deliberately a RATIO rather than an absolute.
// 8,000 rub carried means nothing on its own; "a death right now costs you 94% of
// this entire run" is a decision. Returns 0 when there is nothing at stake either
// way, so a fresh run reads as safe rather than as maximally endangered.
float risk_share(const RunLedger& led, std::int32_t carried);

} // namespace giga::game
