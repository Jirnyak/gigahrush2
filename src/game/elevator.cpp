#include "game/elevator.h"

#include "ecs/components.h"
#include "game/combat.h"    // PlayerRanged, PlayerMelee — live on the body, not the pool
#include "game/embody.h"
#include "game/fast_travel.h" // fast_hub_cell — optional lattice landing
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
    // and re-embody as player on the destination layer.
    //
    // ОСЬ ПРИБЫТИЯ — ЛИФТОВАЯ, А НЕ ГРАВИТАЦИОННАЯ, и это выбор, а не недосмотр.
    // Прежде здесь стоял `regime_down(floor_gravity_regime())` и прибытие
    // раскладывалось по той оси, вдоль которой у модуля падают тела. Это был
    // ВТОРОЙ ЗАКОН ОБ ОДНОЙ ОСИ: шахту кладёт ОБЩИЙ каркас стопки
    // ([level_stack.h] — этажи сложены по Z у любого модуля, иначе лифт не свёл
    // бы два соседних этажа с разной гравитацией), а здесь её ось выводилась
    // заново из гравитации этажа. Пока оба закона давали Z, расхождения не было
    // видно; у модуля с боковой гравитацией кабина уехала бы по X, а шахта
    // осталась по Z — тело прибыло бы в камень.
    //
    // ДВА ЗАКОНА ОБ ОДНОМ ПОЛОЖЕНИИ В РАЗНЫХ ЕДИНИЦАХ — зафиксированный в этом
    // проекте класс дефекта (§64: рагдолл сталкивался сам с собой ровно потому,
    // что положение сустава считали дважды и в разных единицах; получался
    // предельный цикл). Лечение то же: оставить ОДИН источник правды. Правда об
    // оси шахты принадлежит каркасу стопки, и `arrivalCoord` приходит сюда уже
    // в его единицах (`kFloorArrivalCoord`), поэтому присваивание прямое.
    //
    // Гравитация модуля при этом НЕ игнорируется — она просто не про эту ось:
    // ею распоряжаются падение, проходимость и сеялки пропов ([prop_system.cpp]
    // переведены на гравитационный фрейм в той же волне). Лифт едет по дому, а
    // не по вектору тяжести.
    fold_back(reg, pool, npcRef, player);
    pool.cz(id) = arrivalCoord;
    // Fast-travel landing: same hub index on the destination floor so the ride
    // is positionally stable across the stack ([elevators.md] 4×4 cabins). Решётка
    // кабин — ПЛАНАРНАЯ в xy по тому же доводу: она тангенциальна оси ШАХТЫ,
    // которая теперь одна и равна Z.
    if (landHub >= 0 && landHub < kFastHubsPerFloor)
        fast_hub_cell(landHub, pool.cx(id), pool.cy(id));


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
