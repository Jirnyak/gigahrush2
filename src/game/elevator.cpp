#include "game/elevator.h"

#include "ecs/components.h"
#include "game/embody.h"
#include "game/fast_travel.h" // fast_hub_cell — optional lattice landing

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
    // Протухшая ссылка (слот записи переиздан) — не поездка: тело вселилось бы
    // в чужую запись. И без положения ехать нечему.
    if (!npc_ref_current(pool, npcRef) || !reg.all_of<Transform>(player))
        return r;

    // ТЕЛО ЕДЕТ, А НЕ ПЕРЕСОЗДАЁТСЯ (замысел владельца: «игра не прерывается,
    // кабина — инвариант»). Та же сущность меняет слой и клетку; ни один
    // компонент не строится заново, поэтому потерять состояние нельзя по
    // построению. Прежде здесь стояли fold_back + embody_as_player и
    // рукописный список «что вернуть на новое тело» (голова, полёт, огнестрел,
    // ближний бой, лист характеристик). Список латали четыре раза, и каждый
    // раз терялось то, чего в нём не было: в последний — руки и броня
    // (`Equipped`), то есть фонарик, оружие в руке и доспех (жалоба владельца
    // 2026-11-12: «фонарик снялся»). Автосейв поездки закреплял потерю.
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
    Transform& tr = reg.get<Transform>(player);
    // Клетка записи — из живого положения (тем же правилом, что fold_back),
    // координата вдоль шахты — этаж прибытия.
    pool.cx(id) = cell_of_body(tr.pos.x);
    pool.cy(id) = cell_of_body(tr.pos.y);
    pool.cz(id) = arrivalCoord;
    // Fast-travel landing: same hub index on the destination floor so the ride
    // is positionally stable across the stack ([elevators.md] 4×4 cabins). Решётка
    // кабин — ПЛАНАРНАЯ в xy по тому же доводу: она тангенциальна оси ШАХТЫ,
    // которая теперь одна и равна Z.
    if (landHub >= 0 && landHub < kFastHubsPerFloor)
        fast_hub_cell(landHub, pool.cx(id), pool.cy(id));

    tr.pos = embody_cell_centre(pool, id);
    tr.layer = dstLayer;
    // Привязанное к геометрии покинутого этажа с телом не едет: скорость и
    // отчёт об ударе — про тот мир.
    if (auto* v = reg.try_get<Velocity>(player)) *v = Velocity{};
    reg.remove<Impact>(player);

    r.player = player;
    r.layer = dstLayer;
    r.floor = dstFloor;
    r.moved = true;
    return r;
}

} // namespace giga::game
