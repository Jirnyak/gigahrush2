#include "game/elevator.h"

#include "ecs/components.h"
#include "game/combat.h"    // PlayerRanged, PlayerMelee — live on the body, not the pool
#include "game/embody.h"
#include "game/fast_travel.h" // fast_hub_cell — optional lattice landing
#include "game/floor_gen.h" // floor_gravity_regime — arrival rides the module's axis
#include "game/rpg.h"      // RpgStats — XP/attrs/psi live on the body, not the pool

namespace giga::game {

RideResult ride_elevator(Registry& reg, NpcPool& pool,
                         const FloorRegistry& registry, Entity player,
                         int fromFloor, int dir, std::uint8_t arrivalCoord,
                         int landHub) {
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
    NpcRef npcRef{};
    if (auto* ref = reg.try_get<NpcRef>(player)) npcRef = *ref;
    const NpcId id = npcRef.id;
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

    // Firearm + melee state live on the BODY, not the pool row. fold_back destroys
    // the entity, so without this capture every elevator ride zeroes magCount —
    // reload had already debited inventory into the magazine, so one full mag is
    // deleted per floor change. Same hole as camera/fly, different component.
    // Melee kills tally has the same lifetime; main.cpp already re-stamps it on
    // death-possession, but a ride is not a death and never hit that path.
    const bool hadRanged = reg.all_of<PlayerRanged>(player);
    PlayerRanged ranged{};
    if (hadRanged) ranged = reg.get<PlayerRanged>(player);
    const bool hadMelee = reg.all_of<PlayerMelee>(player);
    PlayerMelee melee{};
    if (hadMelee) melee = reg.get<PlayerMelee>(player);

    // RpgStats is the same class of defect as PlayerRanged (RPG1). embody_as_player
    // always re-rolls via random_rpg(level, id) — deterministic base sheet for the
    // record, but mid-run XP, spent attr points, and current psi are wiped. Death
    // possession already captures/restores the sheet in main.cpp (carriedRpg);
    // a ride is not a death and never hit that path. Capture before fold_back.
    const bool hadRpg = reg.all_of<RpgStats>(player);
    RpgStats rpg{};
    if (hadRpg) rpg = reg.get<RpgStats>(player);

    // Fold back on the departed floor (writes the record's macro cell from the
    // live transform, then destroys the entity), relocate to the arrival storey
    // ALONG THE MODULE'S GRAVITY AXIS keeping the two tangent coordinates
    // ([floor_gen.h] frame — x/y/z are equal citizens, the regime picks which
    // one an elevator rides), and re-embody as player on the destination layer.
    fold_back(reg, pool, npcRef, player);
    const CellStep down = regime_down(floor_gravity_regime());
    if (down.x != 0)
        pool.cx(id) = arrivalCoord;
    else if (down.y != 0)
        pool.cy(id) = arrivalCoord;
    else if (down.z != 0)
        pool.cz(id) = arrivalCoord;
    // Zero-g: any air cell is ground — the record keeps the cell it left from.
    // Fast-travel landing: same hub index on the destination floor so the ride
    // is positionally stable across the stack ([elevators.md] 4×4 cabins). The
    // cabin lives in the two coordinates TANGENT to the module's gravity axis,
    // so the lattice is named by the frame the floor declared, not by x/y.
    if (landHub >= 0 && landHub < kFastHubsPerFloor) {
        if (down.x != 0)
            fast_hub_cell(landHub, pool.cy(id), pool.cz(id));
        else if (down.y != 0)
            fast_hub_cell(landHub, pool.cx(id), pool.cz(id));
        else // z-down and zero-g: the lattice is the xy plane
            fast_hub_cell(landHub, pool.cx(id), pool.cy(id));
    }


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

    // Restore combat state only if it was present — do not invent a fresh
    // PlayerRanged on a body that never fired (lazy attach stays lazy).
    if (hadRanged) reg.emplace_or_replace<PlayerRanged>(ne, ranged);
    if (hadMelee) reg.emplace_or_replace<PlayerMelee>(ne, melee);
    // Character sheet: overwrite the random_rpg roll from embody_as_player with
    // the pre-ride progression. embody always attaches RpgStats, so this is
    // emplace_or_replace rather than a lazy-absent guard (unlike combat).
    if (hadRpg) reg.emplace_or_replace<RpgStats>(ne, rpg);

    r.player = ne;
    r.layer = dstLayer;
    r.floor = dstFloor;
    r.moved = true;
    return r;
}

} // namespace giga::game
