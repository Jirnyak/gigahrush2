// Melee weapon stats — what turns "the player has a fist" into "the player found
// a rebar".
//
// Ported from the reference's `PHYS_WEAPON_STATS`. **Melee only.** It has 71 weapon
// rows and 48 of them are ranged; those need projectiles, ammo pools, magazines,
// spread and reload — none of which exist yet — so porting their numbers now would
// produce a table nothing reads. The 23 melee rows have a live consumer today.
//
// Stats are keyed by **ItemId**, not by a private weapon id: 22 of the 23 keys in
// the reference are also ids in `data/items.csv`, and the generator verifies that,
// so an item rename cannot silently orphan a weapon's stats. The 23rd key is the
// empty string — fists, which are correctly not an item and live at index 0.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

#include "game/item_table.h"

namespace giga::game {

inline constexpr std::size_t kMeleeCount = 23;   // 22 item-backed + unarmed

// POD, 12 bytes. Fixed-point for the same reason as everywhere else: the reference
// authors fractional reach (0.5 .. 2.35 cells) and cooldowns (0.20 .. 2.40 s), and
// millis keep the table integral and bit-identical across builds.
struct MeleeDef {
    std::uint16_t dmg;         // 0  3 .. 96
    std::uint16_t reachMm;     // 2  cells * 1000
    std::uint16_t cooldownMs;  // 4  seconds * 1000
    std::uint16_t durability;  // 6  0 = never wears (fists, and a few others)
    std::uint16_t knockbackMm; // 8  unused by physics yet; recorded, not invented
    std::uint16_t hitRadiusMm; // 10 0 = use reach alone
};
static_assert(sizeof(MeleeDef) == 12);
static_assert(std::is_trivially_copyable_v<MeleeDef>);

extern const std::array<MeleeDef, kMeleeCount> kMeleeTable;

// Sparse ItemId -> melee row. 0 means "not a melee weapon", which is why the
// unarmed row sits at index 0: it is only ever reachable as an explicit fallback,
// never by looking up an item.
extern const std::array<std::uint8_t, kItemCount + 1> kMeleeByItem;

// The unarmed row. 3 damage, 0.5 cells, 340 ms — deliberately feeble, so finding
// anything at all is an upgrade.
inline const MeleeDef& unarmed_melee() { return kMeleeTable[0]; }

// Melee stats for an item, or nullptr if it is not a melee weapon.
inline const MeleeDef* melee_for_item(ItemId id) {
    if (!item_valid(id)) return nullptr;
    const std::uint8_t i = kMeleeByItem[id];
    return i == 0 ? nullptr : &kMeleeTable[i];
}

} // namespace giga::game
