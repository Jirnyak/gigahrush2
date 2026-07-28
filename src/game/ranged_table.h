// Player firearms — the 29 straight-line, single-hit guns.
//
// [weapon_table.h] ported the 23 melee rows because the player's swing was a live
// consumer. This is the other half: the reference has 48 ranged weapons and the
// player could not fire one. Monsters have been shooting since [combat.h]'s ranged
// pass; the player has had fists and a pipe.
//
// **Scope is `ProjType::Normal`: 29 of the 48.** The reference documents that type as
// "straight-line, single-hit", which is precisely what `projectile_step` already
// implements — so this increment is a table, a fire step and two bug fixes, not an
// architectural change. The other 19 (grenades, flamers, BFG, beams) are deferred
// because each needs a behaviour the projectile system does not have — detonation on
// expiry, a burn status, area damage, or hitscan — and NOT because their numbers are
// unavailable. Porting numbers without their systems is how the mob-behaviour column
// came to sit unread for months.
//
// Only TWO weapons in the whole reference are hitscan (`gravity_beam_emitter` and
// `ato41_atomic_flamer`, both `deletionBeam`), and both are in the deferred set. That
// is why one shared projectile system is enough, and the total price of keeping it
// shared is two bytes on `Projectile`.
//
// Fields the reference does not have, and which are therefore ABSENT here rather than
// invented from genre convention:
//
//   range         zero on every ranged row. Effective range is emergent from
//                 projectile speed and gravity, not authored.
//   reloadTime    never set on a ranged weapon — every firearm falls through to a
//                 flat 1.0 s. Recorded in the CSV honestly rather than hidden as a
//                 magic number in code.
//   durability    zero on every ranged row. Firearms never wear.
//   damageType    set on ZERO physical weapons, so in the reference a shotgun deals
//                 Kinetic, not Buckshot, and plasma deals Kinetic, not Energy. Making
//                 those channels meaningful is a deliberate invention and belongs in
//                 its own commit, flagged as such.
//   accuracy, recoil, ADS, penetration, falloff — none of these exist at all.
#pragma once

#include <array>
#include <cstdint>
#include <type_traits>

#include "game/inventory.h"   // Inventory, for equipped_ranged
#include "game/item_table.h"

namespace giga::game {

inline constexpr std::size_t kRangedCount = 29;

// POD, 16 bytes, no interior padding. The whole table is 464 B.
//
// Fixed-point throughout so the table is integral and bit-identical across builds,
// matching [mob_table.h] and [weapon_table.h].
struct RangedDef {
    std::uint16_t dmg;            //  0  7..180, PER PELLET
    std::uint16_t cooldownMs;     //  2  45..4250
    std::uint16_t projSpeedMmps;  //  4  cells/s * 1000; 14000..44000
    // Radians * 1e-4, and the unit is load-bearing. `ptrs_liquidator` is 0.0015 rad,
    // which milliradians would round to 2 — a 33% error on the game's most precise
    // weapon. Microradians would overflow uint16 at 0.0655 rad and
    // `granit4u_belt_shotgun` needs 0.46.
    std::uint16_t spreadE4;       //  6  0..4600
    std::uint16_t reloadMs;       //  8  1000 on all 29; see the header note
    ItemId ammo;                  // 10  1-based ItemId, resolved at generation time
    std::uint8_t pellets;         // 12  1..12; >1 is a shotgun
    std::uint8_t magazine;        // 13  1..100
    std::uint8_t channel;         // 14  DamageChannel; Kinetic on all 29 today
    std::uint8_t pad_;            // 15
};
static_assert(sizeof(RangedDef) == 16, "RangedDef must stay a tight 16-byte row");
static_assert(alignof(RangedDef) == 2);
static_assert(std::is_trivially_copyable_v<RangedDef>);

// Generated from data/weapons_ranged.csv by tools/gen_ranged_table.py.
extern const std::array<RangedDef, kRangedCount> kRangedTable;

// Sparse map from ItemId to a row, **ONE-BASED**: 0 means "not a ranged weapon" and
// N means `kRangedTable[N-1]`.
//
// The offset is not cosmetic. [weapon_table.h] can store a raw index only because
// fists deliberately occupy melee slot 0; there is no unarmed firearm, so slot 0 here
// is `makarov` — a real gun that a raw index would make permanently unreachable, and
// silently, since a lookup returning 0 reads as "this item is not a weapon".
extern const std::array<std::uint8_t, kItemCount + 1> kRangedByItem;

// Row for an item, or nullptr when the item is not a firearm.
inline const RangedDef* ranged_for_item(ItemId id) {
    if (!item_valid(id)) return nullptr;
    const std::uint8_t slot = kRangedByItem[id];
    return slot ? &kRangedTable[slot - 1u] : nullptr;
}

// Damage-per-second of a whole burst, for choosing which gun in the inventory to
// hold. Pellets count: a shotgun's 12x8 is 96 a shot, not 8.
inline float ranged_dps(const RangedDef& d) {
    const float cd = static_cast<float>(d.cooldownMs) * 0.001f;
    if (cd <= 0.0f) return 0.0f;
    return static_cast<float>(d.dmg) * static_cast<float>(d.pellets) / cd;
}

// The best firearm in an inventory, by burst DPS, or kInvalidItem when there is none.
// Mirrors `equipped_melee`'s "highest damage wins" — ugly, consistent, and honest
// until there is a weapon-selection UI.
ItemId equipped_ranged(const Inventory& inv);

} // namespace giga::game
