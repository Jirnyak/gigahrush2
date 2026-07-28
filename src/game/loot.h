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
// Honest inheritance note: **66 of the reference's 69 monster kinds have no loot
// table at all** — they drop at most one rare item. That hole is inherited, not
// introduced, and closing it properly is design work. Until then drops are rolled
// from the global catalog under the floor's value cap, which is the same mechanism
// the reference uses for container/room loot.
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

// Drop one mob's spoils at `pos`. Rolls the global catalog through the floor's value
// cap, so what falls is depth-appropriate without any per-mob table.
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
