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
    std::uint16_t cooldownMs = 0;  // time until this mob may swing again
};

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

// Melee pass: every mob on `layer` whose cooldown has expired and which has the
// camera-holder within its authored reach swings once, for its authored damage.
//
// First slice, stated plainly: mobs attack **only the camera holder**. Monsters
// mauling the civilian crowd needs faction relations and a threat model, and
// faking it with "attack the nearest body" would make a residential floor a
// bloodbath on load.
//
// Returns the number of swings that landed.
std::uint32_t mob_melee_step(Registry& reg, NpcPool& pool, EventBus& bus,
                             LayerId layer, float dt, std::uint64_t tick);

// Current/maximum HP of an entity, wherever its HP lives. Returns false if it
// holds none. For HUD and tests.
bool entity_health(const Registry& reg, const NpcPool& pool, Entity e,
                   std::int16_t& hp, std::int16_t& maxHp);

} // namespace giga::game
