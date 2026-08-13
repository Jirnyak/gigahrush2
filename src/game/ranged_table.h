// Player firearms — the 29 straight-line, single-hit guns.
//
// [weapon_table.h] ported the 23 melee rows because the player's swing was a live
// consumer. This is the other half: the reference has 48 ranged weapons and the
// player could not fire one. Monsters have been shooting since [combat.h]'s ranged
// pass; the player has had fists and a pipe.
//
// **Scope was `ProjType::Normal`: 29 of the 48.** The reference documents that type as
// "straight-line, single-hit", which is precisely what `projectile_step` already
// implements — so that increment was a table, a fire step and two bug fixes, not an
// architectural change. The other 19 (grenades, flamers, BFG, beams) were deferred
// because each needs a behaviour the projectile system did not have — detonation on
// expiry, a burn status, area damage, or hitscan — and NOT because their numbers are
// unavailable. Porting numbers without their systems is how the mob-behaviour column
// came to sit unread for months.
//
// **Row 30 is `grenade`, and it arrives with its systems, 2026-08-13.** Detonation on
// expiry and area damage — two of the four behaviours the paragraph above names —
// are now in `projectile_step`, so the deferral it records has been paid rather than
// waived. The three columns that carry them (`projType`, `blastDm`, `fuseDs`) are
// below.
//
// Still deferred, and the reason is still "the system does not exist", not "the
// numbers are missing": `foam_grenade_6p10` and `brt2_foam_projector` ADD matter and
// the engine can only carve it away ([destruct.h] is a one-way door);
// `concrete_breaker_grenade` is a shaped charge, i.e. a blast whose carve power is
// decoupled from its fragment damage, and this table derives carve power FROM damage
// (`carve_power_from_dmg`), so it has nowhere to put the difference. The three
// launchers (`pistol_grenade_launcher`, `g41_grenade_launcher`,
// `party_might_launcher`) need no new system at all — they fire the projectile
// implemented here — but their numbers exist in the reference and not in this tree,
// and inventing stats for a shipped weapon is not the same act as porting them.
//
// **A THROWN weapon is its own ammunition, and that is read from data, not flagged.**
// `data/items.csv` gives `grenade` an `ammo_id` of `grenade`. So `def.ammo == itemId`
// IS the test for "this is thrown", used by `ranged_is_thrown` below to keep
// `equipped_ranged` (which picks by raw DPS) from handing the player a grenade every
// time he pulls a trigger. No column was added for it: the fact was already in the
// content, spelled by the same three explosives and the two demolition charges and
// by nothing else in 442 items.
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

inline constexpr std::size_t kRangedCount = 30;

// POD, 18 bytes, no interior padding. The whole table is 540 B.
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
    std::uint8_t channel;         // 14  DamageChannel; Kinetic on all 30 today
    // What the round IS: a `ProjType` ([mob_table.h]), stored as the raw u8 the enum
    // is so this header need not include the mob table. This byte was `pad_`.
    //
    // It exists because the deferred set the header note lists is not one system: a
    // grenade needs detonation, a flamer needs a burn status, a beam needs hitscan.
    // Deriving "explosive" from `blastDm > 0` would have worked for exactly the first
    // of those and then have had to be undone.
    std::uint8_t projType;        // 15
    // Blast radius in DECIMETRES, and fuse in DECISECONDS. Both zero on every
    // non-explosive row, and the generator refuses a row that sets one without the
    // other — half an explosive is a grenade that never goes off, or one that goes
    // off with no radius, and both are silent.
    //
    // Decimetres/deciseconds rather than metres/seconds for the reason `spreadE4`
    // states about its own unit: the table is integral so it is bit-identical across
    // builds, and a u8 of whole metres cannot express a 4.5 m blast.
    std::uint8_t blastDm;         // 16  0, or 10..255 (1.0..25.5 m)
    std::uint8_t fuseDs;          // 17  0, or 1..255 (0.1..25.5 s)
};
static_assert(sizeof(RangedDef) == 18, "RangedDef must stay a tight 18-byte row");
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

// True when `id` is a weapon you THROW rather than fire — it is its own ammunition.
//
// Derived, never declared: `data/items.csv` already says a grenade's `ammo_id` is
// `grenade`. A `bool thrown` column would have been a second statement of the same
// fact, free to disagree with the first.
inline bool ranged_is_thrown(ItemId id) {
    const RangedDef* d = ranged_for_item(id);
    return d != nullptr && d->ammo == id;
}

// True when the row detonates. `blastDm` is the field that decides, because it is the
// field `projectile_step` reads; `projType` says what the projectile IS and this says
// what it DOES, and a row where the two disagree cannot be generated (see
// tools/gen_ranged_table.py).
inline bool ranged_is_explosive(const RangedDef& d) { return d.blastDm > 0; }

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
//
// THROWN weapons are excluded, and without that exclusion the pick is broken the
// moment one exists: a grenade is 90 damage on a 1.2 s cooldown = 75 DPS, which beats
// 26 of the 29 firearms, so "the best gun in the bag" would resolve to a grenade the
// player then fires like a rifle — one per trigger pull until the bag is empty. The
// test is `ranged_is_thrown`, i.e. the item is its own ammunition; see the header
// note. Grenades are picked by `equipped_throwable` and thrown by
// `player_throw_step`, on their own button.
ItemId equipped_ranged(const Inventory& inv);

// The best explosive in an inventory, by damage x blast radius, or kInvalidItem.
//
// Damage ALONE would be the wrong order the day a bigger charge trades reach for
// punch, and radius alone the day a firecracker outranks a frag. The product is the
// crude stand-in for "how much of the room does this remove" — same spirit as
// `ranged_dps`, and just as replaceable by a selection UI.
ItemId equipped_throwable(const Inventory& inv);

} // namespace giga::game
