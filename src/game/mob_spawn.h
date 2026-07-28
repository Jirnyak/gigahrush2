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
// floor mask, the GROUPING from each row's packMode/packMin/packMax/packSpread.
// A floor supplies only its danger rating, theme and geometry kind — never a
// hand-written spawn list, and never a redefined stat row.
//
// Placement is per-PACK, not per-monster: a room is drawn from the generator's own
// wall lattice, one kind is rolled for it, and that kind's authored pack size is
// placed inside that room. Placing each head at an independent random cell (which
// is what this used to do) salt-sprinkles a floor — a rat swarm and a lone
// sentinel become indistinguishable in space, and every packMode column in
// mob_table.h reads as decoration.
#pragma once

#include <cstddef>
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
    std::uint8_t pack;   // spawn group, 1..255; 0 = never grouped
};

// `pack` is LAST on purpose. Several call sites write `MobRef{kind, level, hp,
// maxHp}` and rely on the remainder zero-initialising; a field inserted before `hp`
// would shift them silently — `pack` would take hp's value and maxHp would become
// 0, which is a monster that is already dead. Pinned so it cannot happen quietly.
static_assert(offsetof(MobRef, hp) == 2,
              "MobRef{kind,level,hp,maxHp} call sites would shift");

// Pack ids are one byte and a floor's budget reaches 4096 heads, so the id wraps
// every 255 packs. Two packs sharing an id is harmless: it only means they choose
// the same wander destination (of 64), which un-grouped agents already do by
// chance. It is NOT a correctness constraint anywhere — nothing looks a pack up by
// id, so a collision cannot merge two packs' state.
inline constexpr std::uint32_t kPackIdSpan = 255;

// A floor's theme drives the head-count multiplier. Derived from its archetype
// rather than authored twice.
FloorTheme theme_for_kind(FloorKind kind);

// FloorSpec stores hostility as 0..1; the budgets want danger 1..5.
std::uint8_t danger_for_hostility(float hostility);

// Spawn a floor's monster population into `reg` on `layer`, one PACK at a time.
//
// Deterministic in (floorNumber, seed, geometry): the same floor re-entered with
// the same seed produces the same roster in the same places, which is what lets a
// floor be unloaded and reloaded without the world visibly changing.
//
// `cap` bounds the spawn regardless of what the budget asks for (0 = no cap).
// The budget saturates at 4096 on the deepest floors, which is a lot of entities
// to add in one frame; callers that care about frame time should pass a cap.
//
// `kind` supplies the ROOM PITCH, via floor_room_stride. It cannot be recovered
// from `theme`: theme_for_kind collapses two of its inputs onto FloorTheme::Ministry
// (Commercial, plus the out-of-range default), so inverting it would be right today
// and silently wrong the first time a fifth FloorKind is themed. It is last with a
// default only so the existing call sites keep compiling; the default's stride is 8,
// which is correct for Residential and Derelict and WRONG for Commercial (16) and
// Industrial (32) — pass the real kind.
//
// Returns the number of heads actually spawned, which is lower than the budget only
// when rooms have too few standable cells.
std::uint32_t spawn_floor_mobs(Registry& reg, const World& world,
                               int floorNumber, std::uint8_t danger,
                               FloorTheme theme, LayerId layer,
                               std::uint32_t seed, std::uint32_t cap = 0,
                               FloorKind kind = FloorKind::Residential);

// Destroy every mob on `layer`. Called when a floor is unloaded — mobs do not
// fold back into anything, they simply cease to exist ([monsters.md]).
std::uint32_t despawn_layer_mobs(Registry& reg, LayerId layer);

// How many mobs are currently live on a layer (HUD / tests).
std::uint32_t count_layer_mobs(const Registry& reg, LayerId layer);

} // namespace giga::game
