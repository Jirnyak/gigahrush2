// Loot — the greed loop, made real.
//
// The game is called *Спуск и Экстракция* — Descent & Extraction — and the whole
// tension is supposed to be "one more floor down is worth more and might kill you".
// That needs three things this file provides: monsters that leave something behind,
// something you have to walk into to take, and value that rises with depth.
//
// Depth is the interesting part and it is NOT a hard gate. `item_table.h` maps
// |floor| to an economy band, each band to a value cap, and then decays an item's
// spawn weight exponentially past that cap — so a shallow floor *can* cough up
// something absurd, just rarely. That rare payout is the loop.
//
// Honest inheritance note, CORRECTED 2026-07-29. This file used to claim "66 of the
// reference's 69 monster kinds have no loot table at all", and treated that as licence to
// ignore `mobKind` entirely. The half that is true: 66 of 69 kinds carry no `lootTable`.
// The half that was wrong, and it is the load-bearing half: the reference authors **136
// `rareDrops` rows across all 69 kinds** — every kind has at least one. It simply never
// reads them (`generateMonsterLoot` consults `lootTable` only), which is why a port that
// went looking for a reader found nothing.
//
// So drops are now **per-kind first, catalog second**: `drop_mob_loot` offers each roll
// to the mob's authored row ([loot_table.h]) and falls back to the global weighted
// catalog when it misses. The tier envelope below still decides HOW MUCH falls; the table
// only decides WHAT. One roller, one `Pickup` spawner, one walk over the `Dead` set —
// there is deliberately no second death-drop system beside this one.
//
// ---------------------------------------------------------------------------
// Kills vs crates — measured, and it contradicts what [container.h] asserts
// ---------------------------------------------------------------------------
// [container.h] opens by stating that containers are the PRIMARY loot source and monster
// drops the secondary one, citing the reference's economics doc. Measured 2026-07-29
// against the tables this build actually ships, that is false at every depth, and by one
// to two orders of magnitude at the bottom:
//
//   floor   heads/floor   rub/kill   all kills   24 crates   42 crates
//   0            106          53.3       5,647       1,717        3,003
//   -13          622         720.5     448,174      13,997       24,495
//   -26        2,157       1,657.4   3,574,960      36,632       64,106
//
// (heads = `mob_count_for_floor(z, danger 3, Ministry)`, re-derived from the shipped
// curve: 106 / 622 / 2,157. rub/kill averaged over all 69 kinds at their own tier. A
// crate priced as the modal RoomStash — 71.5 / 583.2 / 1,526.3 rub — times the only two
// answers `container_budget` can give: its hard floor of 24, for the wide-stride kinds
// (Commercial 16, Industrial 32, whose `rooms / 6` comes out at 10 and 2), and 42 for the
// stride-8 kinds, Residential and Derelict, where 256 rooms / 6 = 42. main passes a cap
// of 64, which never binds.) A floor's monsters carry 1.9x to 98x what its crates do:
// nearly even on the hub, two orders of magnitude apart at the bottom. The crate column
// is also OPTIMISTIC — it prices a crate off the whole-floor table (roomMask 0), while
// the generator places crates in rooms and a room mask only ever removes candidates, so
// the real gap is wider than 1.9x everywhere.
//
// **This is not caused by the loot table and must not be "fixed" here.** The table
// moved expected income by -10.2% to +4.4% — a discount on 28 of the grid's 30 tier x
// depth cells, a small gain on the other two ([loot_table.h] has it). The imbalance is a
// head-count fact — `mob_count_for_floor` reaches 2,157 on floor -26 while
// `container_budget` never exceeds 42 and bottoms out at 24. Nobody clears a floor, so
// what the player feels is softer than the totals; but 22 kills at -26 already out-earn
// every crate on a 24-crate floor and 39 do on a 42-crate one, so the ratio does not save
// the claim either. Which loop the game pays for is an owner-level balance decision, so it
// is recorded here with its numbers rather than silently patched by a roller.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "ecs/registry.h"
#include "game/event_bus.h"
#include "game/item_table.h"
#include "game/inventory.h"
#include "game/npc_pool.h"
#include "world/level_stack.h"

namespace giga::game {

// A dropped item lying on the floor. Carries Transform + AABB + Renderable too, so
// it renders through the existing body pass with no new render code.
struct Pickup {
    ItemId item = kInvalidItem;
    std::uint8_t count = 1;
};

// How close you must be to sweep something up, metres. Generous on purpose: a
// pickup is a 30 cm box in a dark corridor and hunting for it with a cursor is not
// the tension this game is going for.
inline constexpr float kPickupReach = 1.8f;

// Drop the spoils of every mob that is tagged Dead but not yet destroyed.
//
// **Call this between the damage systems and finalize_deaths.** That window — the
// gap between "hp hit zero" and "the entity is gone" — is precisely what the `Dead`
// tag exists to create ([combat.h] defect 2): the reference's P0 was that an entity
// could be culled before its loot hook ran, and this is the shape that makes it
// impossible. Reading position from the corpse also means the death event does not
// have to carry one.
//
// Returns how many pickups were created (0 is normal and common).
std::uint32_t loot_dead_mobs(Registry& reg, LayerId layer, int floorNumber,
                             std::uint32_t seed);

// Drop one mob's spoils at `pos`.
//
// `mobTier` sets the envelope — how many rolls and how likely each is to pay. Each
// paying roll then asks `roll_kind_drop(mobKind, ...)` ([loot_table.h]) for the mob's own
// authored item and, on a miss, picks from the global catalog through the floor's value
// cap. So what falls is both depth-appropriate AND recognisable as having come off THAT
// monster, and the substitution keeps the item count per kill exactly what the envelope
// says it is.
std::uint32_t drop_mob_loot(Registry& reg, LayerId layer, const vec3& pos,
                            std::uint8_t mobKind, std::uint8_t mobTier,
                            int floorNumber, std::uint32_t seed);

// Sweep up every pickup within kPickupReach of the camera holder into its pool-row
// inventory (canonical, folds back on floor exit — [npcs.md]). Stacks where the
// item allows it. Publishes ItemTransferred per pickup.
//
// Returns the total roubles collected this pass, which is what the HUD counts.
std::int32_t pickup_step(Registry& reg, NpcPool& pool, EventBus& bus, LayerId layer,
                         std::uint64_t tick);

// Consume the best healing item in the camera holder's inventory, if any and if it
// would help. Returns the HP restored, 0 if nothing was used.
//
// "Best" means the smallest heal that still covers the missing HP, falling back to
// the largest available — so a bandage is not wasted on a scratch and a full medkit
// is not saved for a corpse.
std::int16_t use_best_heal(Registry& reg, NpcPool& pool, EventBus& bus,
                           LayerId layer, std::uint64_t tick);

// How much ammo drops alongside a firearm, from the reference's own bundling rule.
//
// **Without this the firearm increment is unplayable, and the reason is a data fact
// rather than a design opinion: every one of the 17 AMMO rows in items.csv has
// `spawn_w_milli == 0`.** `drop_mob_loot` rolls the global catalog BY WEIGHT, so it
// can never produce a single bullet — while guns spawn freely at weight 1000. A
// player would find a Makarov and never be able to load it.
//
// The reference does not solve this with loot weights either; it bundles ammo at the
// moment a weapon drops. Shotguns get 4..11 shells; everything else gets
// max(10, magazine) + 0..19 rounds. So a Makarov (mag 8) yields 10..29 and an RPL-23
// (mag 100) yields 100..119 — the magazine size decides the bundle, which keeps a
// belt-fed LMG from being a paperweight.
std::uint32_t drop_weapon_ammo(Registry& reg, LayerId layer, const vec3& pos,
                               ItemId weapon, std::uint32_t seed);

// Total rouble value of an inventory. For the HUD and the extraction score.
std::int32_t inventory_value(const Inventory& inv);

} // namespace giga::game
