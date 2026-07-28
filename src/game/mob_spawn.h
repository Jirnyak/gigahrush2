// Monster spawning — turns the global mob table into live ECS entities on a
// floor ([monsters.md]).
//
// Mobs are deliberately NOT alife records ([npcs.md]): they have no macro
// existence, no relationships, no cold pool. They are spawned when a floor is
// entered and destroyed when it is left. That is why this file talks to the
// Registry and the World directly and never touches NpcPool.
//
// The whole per-floor mix comes from data: the head-count and level from the
// V-shape budgets in mob_table.h, the roster from each row's spawn weight and
// floor mask. A floor supplies only its danger rating and theme — never a
// hand-written spawn list, and never a redefined stat row.
#pragma once

#include <cstdint>

#include "ecs/registry.h"
#include "game/floor_spec.h"
#include "game/mob_table.h"
#include "world/level_stack.h"  // LayerId
#include "world/types.h"

namespace giga {
class World;
}

namespace giga::game {

// A live monster instance. Small and POD: the table row holds everything
// static, so an instance only carries what differs per spawn.
struct MobRef {
    std::uint8_t kind;   // MobKind — index into kMobTable
    std::uint8_t level;  // 1..12, from mob_level_for_floor
    std::int16_t hp;     // current, level-scaled
    std::int16_t maxHp;  // level-scaled base
};

// A floor's theme drives the head-count multiplier. Derived from its archetype
// rather than authored twice.
FloorTheme theme_for_kind(FloorKind kind);

// FloorSpec stores hostility as 0..1; the budgets want danger 1..5.
std::uint8_t danger_for_hostility(float hostility);

// Spawn a floor's monster population into `reg` on `layer`.
//
// Deterministic in (floorNumber, seed): the same floor re-entered with the same
// seed produces the same roster in the same places, which is what lets a floor be
// unloaded and reloaded without the world visibly changing.
//
// `cap` bounds the spawn regardless of what the budget asks for (0 = no cap).
// The budget saturates at 4096 on the deepest floors, which is a lot of entities
// to add in one frame; callers that care about frame time should pass a cap.
//
// Returns the number actually spawned, which is lower than the budget when the
// floor has too few standable cells.
std::uint32_t spawn_floor_mobs(Registry& reg, const World& world,
                               int floorNumber, std::uint8_t danger,
                               FloorTheme theme, LayerId layer,
                               std::uint32_t seed, std::uint32_t cap = 0);

// Destroy every mob on `layer`. Called when a floor is unloaded — mobs do not
// fold back into anything, they simply cease to exist ([monsters.md]).
std::uint32_t despawn_layer_mobs(Registry& reg, LayerId layer);

// How many mobs are currently live on a layer (HUD / tests).
std::uint32_t count_layer_mobs(const Registry& reg, LayerId layer);

} // namespace giga::game
