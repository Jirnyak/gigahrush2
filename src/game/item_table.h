// Global item table — one POD row per item kind, shared by every floor.
//
// Like the mob table ([monsters.md]) this is engine-wide data: a floor never forks
// the catalog, it only shifts which rows are likely to appear ([items.md]). Adding
// an item is one row in `data/items.csv` plus `python tools/gen_item_table.py`.
//
// **442 items** live in the CSV today (kItemCount is generated from it and is
// the truth). The port originally landed 446 — what `Object.keys(ITEMS)` of the
// TypeScript reference actually yields once spreads and computed keys resolve
// (not the ~434 its own docs claim) — and four rows have since been purged.
//
// This table is deliberately LEAN. The reference's `ItemDef` carries ~40 fields;
// only the ones with a live consumer are ported, because a column nothing reads is
// a column that silently rots. Explicitly deferred, with their reason:
//
//   station + tier              consumed by the live craft system via its own
//                               generator (craft_table.cpp) — see craft.h
//   ammo_id / use_grant_id      needs interned string ids; nothing fires yet
//   durability (17 items)       no wear system
//   science/contraband/deceptive (2/5/2 items)  no faction or trade system
//   tags (465 distinct strings) no consumer; the two-tier flattening plan is in
//                               the research spec when one appears
//   en names, descriptions      no localization or inspect UI
//
// Also worth knowing, from the port: **there is no weight field in the reference at
// all.** No mass, no encumbrance, no carry capacity. Inventory is purely slots (64)
// and stacks. Its `gameplay.md` names weight in one sentence and its `balance.md`
// explicitly rejects it — "scarcity держится доступностью, а не весом". Do not add
// one on the assumption it was lost in translation.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

#include "game/inventory.h"  // Inventory/ItemSlot — carried-weight reader below
#include "game/mob_table.h"  // RoomBit — items and mobs share the room taxonomy

namespace giga::game {

// Item handle. **1-based**, because `ItemSlot::item == 0` already means "empty
// slot" ([inventory.h]) — so id N is table row N-1 and 0 can never be an item.
using ItemId = std::uint16_t;
inline constexpr ItemId kInvalidItem = 0;

inline constexpr std::size_t kItemCount = 442;

enum class ItemCategory : std::uint8_t {
    Misc = 0,   // 268
    Weapon,     //  88
    Food,       //  22
    Medicine,   //  20
    Ammo,       //  17
    Tool,       //  17
    Drink,      //   9
    Key,        //   3
    Note,       //   2
    Count
};

enum class EquipSlot : std::uint8_t { None = 0, Weapon, Armor, Tool, Count };

// What using an item does. Most rows do nothing — the reference implements a use
// action on only 59. Names map 1:1 onto its closures.
enum class UseEffect : std::uint8_t {
    None = 0,
    Heal, HealPsi, Feed, FeedPsi, FeedRisky, Drink, DrinkStim,
    Painkiller, Antiemetic, SleepingPills, PsiSurge, TechnicalSpirit,
    Unpack, UnsealSample, RedeemCoupon,
    Count
};

// Armour channels an item can resist. Must equal DamageChannel::Count in
// combat.h; asserted in item_table.cpp, which includes both. Declared here rather
// than including combat.h so this header stays free of the pool/event-bus weight.
inline constexpr std::size_t kItemResistChannels = 5;

// POD, trivially copyable, 20 bytes, no interior padding. The whole table is
// 8,920 B — permanently cache-resident, like the mob table.
struct ItemDef {
    std::int32_t value;         //  0  roubles, 0 .. 500,000
    // GRAMS — the SAME unit as [prop_table.h] massG and [mob_table.h] massG, so
    // there is exactly one thing "mass" means in this tree. Resolved from
    // data/item_mass.csv by rule (id > tag > prefix > category) rather than from a
    // 442-value column, because a rule is reviewable and 442 magic numbers are not;
    // the generator prints every resolved weight and REFUSES an item no rule
    // matches, which is what makes "everything has a weight" a build gate instead
    // of an intention.
    //
    // ZERO IS LEGAL HERE and means "not a physical object" — a psi technique is a
    // thing you know, not a thing in your pack. That is the opposite of the prop
    // and mob tables, where 0 is refused because it is indistinguishable from an
    // unfilled column; here no row can be unfilled, because an unmatched item does
    // not build.
    std::uint32_t massG;        //  4
    std::uint16_t spawnWeight;  //  8  milli-weight, 0..50,000; 0 = never random
    std::uint16_t roomMask;     // 10  RoomBit bitmask — where it is found
    std::int16_t useA;          // 12  primary use magnitude, signed (-6 .. 60)
    std::uint8_t category;      // 14  ItemCategory
    std::uint8_t equipSlot;     // 15  EquipSlot
    std::uint8_t stackMax;      // 16  1..255
    std::uint8_t useEffect;     // 17  UseEffect
    std::int8_t resist[kItemResistChannels];  // 18..22, armour; 441 are zero
    std::uint8_t pad_;          // 23
};
static_assert(sizeof(ItemDef) == 24, "ItemDef must stay a tight 24-byte row");
static_assert(alignof(ItemDef) == 4);
static_assert(std::is_trivially_copyable_v<ItemDef>);

// Generated from data/items.csv by tools/gen_item_table.py. Row N is item id N+1.
extern const std::array<ItemDef, kItemCount> kItemTable;

// Russian display names, parallel to kItemTable. Kept out of ItemDef so the row
// stays pointer-free and trivially serializable.
extern const std::array<const char*, kItemCount> kItemNames;

// Item ids are 1-based; these are the only sanctioned way to index the table.
inline bool item_valid(ItemId id) {
    return id != kInvalidItem && id <= kItemCount;
}
inline const ItemDef& item_def(ItemId id) {
    return kItemTable[static_cast<std::size_t>(id) - 1];
}
inline const char* item_name(ItemId id) {
    return kItemNames[static_cast<std::size_t>(id) - 1];
}

// --- CARRIED WEIGHT ----------------------------------------------------------
// The reader `massG` exists for, and it lands in the SAME change as the column on
// purpose: a data column with no consumer is [problems.md] §35's whole class, and
// this table was on course to become the biggest example of it in the tree.
//
// The BUDGET this is weighed against lives in [rpg.h] (`carry_capacity_g`), not
// here, because it is a property of the character and not of the catalog: 64 kg
// plus 4 kg per point of Strength. This file only answers "how much is in the bag".
//
// Total grams held in one 8x8 grid. O(kInvSlots), no allocation, and it is the
// stack COUNT that multiplies — sixty 9 mm rounds weigh sixty times one round.
inline std::uint32_t inventory_mass_g(const Inventory& inv) {
    std::uint32_t g = 0;
    for (int i = 0; i < kInvSlots; ++i) {
        const ItemSlot& s = inv.slots[i];
        if (s.count == 0 || !item_valid(s.item)) continue;
        g += item_def(s.item).massG * static_cast<std::uint32_t>(s.count);
    }
    return g;
}

// ---------------------------------------------------------------------------
// Depth gating — the greed loop, as data
// ---------------------------------------------------------------------------
// Value is gated by depth, and NOT with a hard cut: the reference maps |floor| to
// an economy band, each band to a value cap, and then decays an item's spawn
// weight exponentially once its value exceeds that cap. So a deep floor *can*
// cough up something absurd, just rarely — which is the entire greed loop. A hard
// cut would replace "worth the risk" with "not on this floor".

inline constexpr std::size_t kEconomyBands = 5;   // E0..E4
inline constexpr std::int32_t kLootValueCap[kEconomyBands] = {
    90, 450, 4000, 80000, 250000
};

// Economy band for a floor: driven by |floor|, like every other depth budget.
std::uint8_t economy_band(int floorZ);

// Spawn weight of `id` on a floor, after depth gating. Returns 0 when the item
// cannot appear there at all (weight 0, or wrong room).
std::uint32_t item_weight_on_floor(ItemId id, int floorZ, std::uint16_t roomMask);

} // namespace giga::game
