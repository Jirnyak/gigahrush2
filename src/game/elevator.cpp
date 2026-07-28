#include "game/elevator.h"

#include "ecs/components.h"
#include "game/embody.h"

namespace giga::game {

RideResult ride_elevator(Registry& reg, NpcPool& pool,
                         const FloorRegistry& registry, Entity player,
                         int fromFloor, int dir, std::uint8_t arrivalZ) {
    RideResult r;
    r.player = player;
    r.floor = fromFloor;
    if (auto* tr = reg.try_get<Transform>(player)) r.layer = tr->layer;

    // Resolve the destination FIRST, before touching the player, so a blocked
    // ride leaves no half-folded state.
    const int dstFloor = fromFloor + dir;
    const LayerId dstLayer = registry.layer_at(dstFloor);
    if (dstLayer == kInvalidLayer) return r; // no such loaded floor -> no-op

    // Recover the alife record behind this body; refuse if it isn't embodied.
    NpcId id = kInvalidNpc;
    if (auto* ref = reg.try_get<NpcRef>(player)) id = ref->id;
    if (id == kInvalidNpc) return r;

    // Capture the view + movement mode: re-embodiment builds a fresh camera and
    // controller, so without this the ride would reset the head and drop fly.
    float yaw = 0.0f, pitch = 0.0f, fovY = 1.2f;
    if (auto* cam = reg.try_get<CameraTag>(player)) {
        yaw = cam->yaw;
        pitch = cam->pitch;
        fovY = cam->fovY;
    }
    bool fly = false;
    if (auto* ctl = reg.try_get<Controller>(player)) fly = ctl->fly;

    // Fold back on the departed floor (writes the record's macro cell from the
    // live transform, then destroys the entity), relocate to the arrival storey
    // keeping x/y, and re-embody as player on the destination layer.
    fold_back(reg, pool, id, player);
    pool.cz(id) = arrivalZ;

    Entity ne = embody_as_player(reg, pool, id, dstLayer);
    if (ne == entt::null) { // unreachable for a valid embodied record
        r.player = entt::null;
        r.layer = kInvalidLayer;
        return r;
    }

    if (auto* cam = reg.try_get<CameraTag>(ne)) {
        cam->yaw = yaw;
        cam->pitch = pitch;
        cam->fovY = fovY;
    }
    if (auto* ctl = reg.try_get<Controller>(ne)) ctl->fly = fly;

    r.player = ne;
    r.layer = dstLayer;
    r.floor = dstFloor;
    r.moved = true;
    return r;
}

} // namespace giga::game
