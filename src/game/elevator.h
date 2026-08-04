// Elevator — inter-floor travel for the embodied player ([floors.md]).
//
// Riding a floor is the embodiment seam in motion: the player is just an alife
// record that is currently embodied with a camera. To change floors we
//   1. resolve the destination floor NUMBER -> module -> resident LayerId through
//      the FloorRegistry (never against a raw LayerId — floors renumber/reshuffle),
//   2. fold the player's record back into the cold pool on the floor it is leaving
//      (freezing where it stood), and
//   3. re-embody that same record as the player on the destination layer.
// Because the body is rebuilt, embody_as_player() hands back a FRESH camera and
// controller; this module carries the view orientation and movement mode across
// the swap so the ride doesn't snap the player's head or drop them out of fly.
//
// If the destination floor is not currently loaded (unassigned or streamed out),
// the ride is a no-op — #9 (streaming) will load-on-demand later. Pure game-layer
// logic over Registry + NpcPool + FloorRegistry: no SDL/Vulkan, headless-testable.
#pragma once

#include <cstdint>

#include "ecs/registry.h"        // giga::Entity, giga::Registry
#include "game/floor_registry.h" // giga::game::FloorRegistry
#include "game/npc_pool.h"       // giga::game::NpcPool
#include "world/level_stack.h"   // giga::LayerId, giga::kInvalidLayer

namespace giga::game {

// Rule 24: МАТРИЦА ЛИФТОВ. Data-Driven flat arrays to ensure zero heap allocations in the hot path.
// Represents the fixed grid of elevator shafts on a floor (4x4 fast travel, 4x4 down, 4x4 up).
struct ElevatorShaft {
    int fast_travel[16];
    int proc_down[16];
    int proc_up[16];
};

// Outcome of a ride. On success `player` is the NEW entity (the old one has been
// destroyed) and `moved` is true. On a no-op (no such loaded floor) `player` is
// the unchanged input entity, `moved` is false, and `floor`/`layer` report where
// the player still is.
struct RideResult {
    Entity player = entt::null;
    LayerId layer = kInvalidLayer;
    int floor = 0;
    bool moved = false;
};

// Ride from `fromFloor` by `dir` (+1 = up toward the roof, -1 = down). Resolves
// `fromFloor + dir` through `registry`; if that floor is not loaded, returns a
// no-op result and leaves `player` untouched. Otherwise folds the player's record
// back on its current layer, moves it to the arrival cell (keeps x/y, sets cell
// z = `arrivalCoord`), re-embodies it as player on the destination layer preserving
// camera yaw/pitch/fov + fly mode, and returns the new player entity.
//
// `player` must be an embodied record (carry an NpcRef); otherwise this is a
// no-op. `fromFloor` is supplied by the caller because the registry maps
// number -> layer, not the reverse — the app already knows the player's floor.
//
// `landHub` (default -1): when in [0, 16), also plant x/y on that planar lattice
// hub cabin before embody — the fast-travel landing ([elevators.md] §24). Adjacent
// ±1 rides leave it at -1 and keep the mirrored x/y.
RideResult ride_elevator(Registry& reg, NpcPool& pool,
                         const FloorRegistry& registry, Entity player,
                         int fromFloor, int dir, std::uint8_t arrivalCoord,
                         int landHub = -1);

void update_elevators(Registry& reg);

} // namespace giga::game
