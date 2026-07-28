// Combat — damage, death, and melee attacks.
//
// This module is deliberately shaped around three defects found in the TypeScript
// reference during the port. They are the reason it looks over-engineered for its
// size; each one is a bug that is *impossible* here rather than merely absent.
//
//   1. **One damage function.** In the reference, pre-armour damage leaked into
//      the kill feed, the AI threat model and the blood spray while HP took the
//      mitigated value — so the number the player saw was not the number that
//      landed. `apply_damage` is the only place damage is computed, and it returns
//      the value it actually applied. Report *that*, never the raw input.
//
//   2. **One death finalizer.** The reference had no single place a death funnels
//      through, so an entity could be culled before its loot / A-Life / quest
//      hooks ran — a P0 its own balance.md documented and never fixed. Here
//      `apply_damage` NEVER destroys anything: it tags `Dead`, and
//      `finalize_deaths` is the one function that ends a life, at one defined
//      point in the tick.
//
//   3. **One cooldown decrement.** The reference decremented `attackCd` at ~60
//      sites, several of them as `max()` floors, so some monsters out-attacked
//      their own authored attack rate. `mob_melee_step` decrements it exactly
//      once, at the top, for every mob.
//
// Where HP lives is NOT unified, on purpose. For an embodied NPC the pool row is
// canonical and folds back on floor exit ([npcs.md], embody.h); a mob has no macro
// existence at all and carries its own. `apply_damage` resolves which, so callers
// never have to care — the *function* is single, the storage is where the
// architecture already put it.
#pragma once

#include <cstddef>
#include <cstdint>

#include "ecs/components.h"
#include "ecs/registry.h"
#include "game/event_bus.h"
#include "game/inventory.h"
#include "game/item_table.h"   // ItemId, for the equipped-loadout helpers
#include "game/npc_pool.h"
#include "world/level_stack.h"

namespace giga::game {

// Five channels, matching the reference's armour model and the `resist[5]` vector
// carried by armour items.
enum class DamageChannel : std::uint8_t {
    Kinetic = 0, Buckshot, Energy, Fire, Psi, Count
};
inline constexpr std::size_t kDamageChannels =
    static_cast<std::size_t>(DamageChannel::Count);

// Flat percentage mitigation per channel, 0..100, clamped on use. Absent means no
// armour at all, which is the common case — the reference authors only four.
//
// Currently nothing populates this: armour is an item property and the item table
// is not ported yet. It exists now anyway, because mitigation living in one place
// is the whole point of defect (1) above, and bolting it on later is how the leak
// gets reintroduced.
struct Armour {
    std::int8_t resist[kDamageChannels] = {};
};

// Set by apply_damage when a target's HP reaches zero. Nothing else may set it,
// and it does not mean the entity is gone — only that it is scheduled to die at
// the next finalize_deaths.
struct Dead {
    Entity killer = entt::null;
    std::uint8_t channel = 0;
};

// Per-instance melee state. Separate from MobRef because MobRef is the spawn
// record (what this monster IS) and this is combat state (what it is DOING).
struct MobCombat {
    std::uint16_t cooldownMs = 0;  // time until this mob may attack again
    // >0 while a ranged shot is being telegraphed. The windup is the whole reason
    // ranged monsters are fair: you get 0.48-1.25 s of warning, per kind, and
    // breaking line of sight or leaving the cone during it aborts the shot.
    std::uint16_t windupMs = 0;
};

// A monster's shot in flight. Not a mob and not an alife record — it exists for a
// fraction of a second and then hits something, hits the floor, or times out.
//
// Carries Transform + AABB + Renderable too, so it renders through the existing
// body pass with no new render code: shots are visible tracers, not invisible
// damage events.
struct Projectile {
    Entity source = entt::null;   // for the kill feed; may already be dead
    std::int16_t dmg = 0;
    std::uint16_t ttlMs = 0;      // hard bound, so a stray shot cannot live forever
};

// The camera holder's swing state. Attached lazily by player_melee_step, so
// possessing a new body after death does not need to remember to add it.
struct PlayerMelee {
    std::uint16_t cooldownMs = 0;
    std::uint32_t kills = 0;       // cumulative, survives possession
};

// Cosine of the half-angle you must be facing the target within. 0.35 is roughly
// a 70-degree half-cone: generous enough not to feel like pixel-hunting in a dark
// corridor, tight enough that you cannot hit what is behind you.
inline constexpr float kMeleeFacingDot = 0.35f;

// Reach is authored in cells and a cell is 2 m, but a bare 0.5-cell fist would be
// a 1 m reach against bodies whose own half-extents are up to 0.9 m — you could
// not touch a boss. This slack is added to every weapon's reach so contact is
// possible at all; it is a body-size allowance, not a weapon buff.
inline constexpr float kMeleeReachSlack = 0.9f;   // metres

// Projectile constants. Gravity is lighter than the world's so a shot arcs
// readably instead of dropping like a stone; the TTL is a hard backstop so a
// shot fired into open space cannot live forever; the hit radius is generous
// because a 10 cm box at 20 m/s would tunnel clean through a body between two
// 120 Hz steps.
inline constexpr float kProjGravity = 6.0f;        // m/s^2
inline constexpr std::uint16_t kProjTtlMs = 4000;
inline constexpr float kProjHitRadius = 0.75f;     // metres

// The best melee weapon in an inventory, or kInvalidItem for bare hands. "Best"
// is highest damage — reach and speed are not traded off, because with no stamina
// or stagger system there is nothing to trade them against yet.
ItemId equipped_melee(const Inventory& inv);

// The best armour in an inventory, by total resistance across all channels, or
// kInvalidItem for none.
ItemId equipped_armour(const Inventory& inv);

// Copy the equipped armour's resistances onto `e`'s Armour component, adding or
// removing it as needed. Call after anything that changes the inventory, so that
// picking a vest up actually protects you.
//
// This is what finally gives Armour data: the resistances were in the item table
// all along (5 of 446 items carry them) — mitigation just had nothing feeding it.
void sync_armour(Registry& reg, NpcPool& pool, Entity e);

struct DamageResult {
    std::int16_t applied = 0;  // AFTER mitigation — the only number worth reporting
    std::int16_t blocked = 0;
    bool lethal = false;       // this hit took it to zero
    bool hit = false;          // false when the target holds no HP at all
};

// THE damage entry point. Every hit in the game goes through here.
//
// Resolves where the target's HP lives (mob instance vs. pool row), applies
// channel mitigation, clamps, and tags `Dead` on reaching zero. Does **not**
// destroy the entity — see finalize_deaths.
DamageResult apply_damage(Registry& reg, NpcPool& pool, Entity target,
                          std::int16_t raw, DamageChannel ch, Entity source);

// THE death finalizer, and the only place an entity dies. Publishes one NpcDied
// per death (payload: `a` = victim NpcId or kInvalidNpc for a mob, `b` = MobKind
// or 0xFF, `c` = killer entity id), marks the pool row dead for records, and then
// destroys. Returns the number finalized.
//
// Call it at ONE defined point per tick, after every system that can deal damage.
// Anything that needs to react to a death must do so from the event, not by
// watching for entities to vanish.
std::uint32_t finalize_deaths(Registry& reg, NpcPool& pool, EventBus& bus,
                              std::uint64_t tick);

// Attack pass: every mob on `layer` whose cooldown has expired attacks the
// camera-holder — melee if it is in reach, or a telegraphed shot if the kind is
// ranged and the target sits between its minimum and maximum range.
//
// One function rather than a melee one and a ranged one, deliberately. The
// reference had ~60 places decrementing `attackCd` and at least one monster
// (Slepoglaz) decremented twice, doubling its own fire rate. Keeping both attack
// modes behind the single decrement makes that unrepresentable instead of merely
// absent.
//
// First slice, stated plainly: mobs attack **only the camera holder**. Monsters
// mauling the civilian crowd needs faction relations and a threat model, and
// faking it with "attack the nearest body" would make a residential floor a
// bloodbath on load.
//
// Returns the number of swings that landed.
std::uint32_t mob_attack_step(Registry& reg, NpcPool& pool, EventBus& bus,
                             LayerId layer, float dt, std::uint64_t tick);

// Advance every shot in flight: integrate under gravity, stop on solid geometry,
// damage the camera-holder on contact, expire on TTL. Destroys spent projectiles.
//
// Gravity is what makes a ranged monster miss: a shot fired level from chest height
// reaches the floor in well under a second, so distance is bought with arc. The
// launch adds a vertical rate proportional to range for exactly that reason.
std::uint32_t projectile_step(Registry& reg, NpcPool& pool, EventBus& bus,
                              const LevelStack& stack, LayerId layer, float dt,
                              std::uint64_t tick);

// The camera holder swings at whatever monster is in front of it.
//
// Symmetry with mob_melee_step is deliberate: the same apply_damage, the same
// Dead tag, the same finalize_deaths. A mob killed by the player dies through
// exactly the path a player killed by a mob does, so there is no second death
// route to forget to maintain.
//
// `wantsAttack` is edge-or-held at the caller's discretion; the cooldown is what
// bounds the rate either way. Returns true if a swing actually landed.
bool player_melee_step(Registry& reg, NpcPool& pool, EventBus& bus, LayerId layer,
                       float dt, bool wantsAttack, std::uint64_t tick);

// Current/maximum HP of an entity, wherever its HP lives. Returns false if it
// holds none. For HUD and tests.
bool entity_health(const Registry& reg, const NpcPool& pool, Entity e,
                   std::int16_t& hp, std::int16_t& maxHp);

} // namespace giga::game
