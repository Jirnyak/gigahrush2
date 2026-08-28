// Supply комнаты — оснащение и запас из мира. Законы в room_supply.h.

#include "game/room_supply.h"

#include "game/container.h"   // Container — ящики И трупы (one-container)
#include "game/item_table.h"  // kItemVerbs, item_valid
#include "game/loot.h"        // Pickup — предметы на полу
#include "game/prop_system.h" // PropOf — строка таблицы на сущности

namespace giga::game {

RoomId room_at_pos(const FloorRooms& fr, const vec3& pos) {
    // Клетка 2 м: pos 83.0 -> клетка 41 (та же свёртка, что у всех
    // потребителей сетки). wrap делает room_at.
    return room_at(fr, static_cast<int>(pos.x * 0.5f),
                   static_cast<int>(pos.y * 0.5f),
                   static_cast<int>(pos.z * 0.5f));
}

void supply_add_item(FloorRooms& fr, RoomId room, std::uint16_t item,
                     int countDelta) {
    Room* r = room_of(fr, room);
    if (r == nullptr || !item_valid(item) || countDelta == 0) return;
    const auto& vec = kItemVerbs[item - 1]; // item ids 1-based ([item_table.h])
    for (std::size_t v = 0; v < kVerbCount; ++v)
        r->supply[v] += static_cast<std::int32_t>(vec[v]) * countDelta;
}

void supply_add_prop(FloorRooms& fr, RoomId room, PropId id, int sign) {
    Room* r = room_of(fr, room);
    if (r == nullptr || !prop_valid(id) || sign == 0) return;
    const auto& vec = kPropVerbs[static_cast<std::size_t>(id)];
    for (std::size_t v = 0; v < kVerbCount; ++v)
        r->supply[v] += static_cast<std::int32_t>(vec[v]) * sign;
}

void rooms_supply_rebuild(FloorRooms& fr, Registry& reg, LayerId layer) {
    for (Room& r : fr.list)
        for (std::size_t v = 0; v < kVerbCount; ++v) r.supply[v] = 0;

    // ОСНАЩЕНИЕ: каждый табличный проп слоя. Тот же примитив, что у
    // инкрементального пути, — оракул сравним по построению.
    for (auto [e, po, t] : reg.view<const PropOf, const Transform>().each())
        if (t.layer == layer)
            supply_add_prop(fr, room_at_pos(fr, t.pos), po.id, +1);

    // ЗАПАС: содержимое контейнеров (ящики и трупы — один Container).
    for (auto [e, c, t] : reg.view<const Container, const Transform>().each()) {
        if (t.layer != layer) continue;
        const RoomId room = room_at_pos(fr, t.pos);
        for (const ItemSlot& s : c.inv.slots)
            if (s.item != 0 && s.count > 0)
                supply_add_item(fr, room, s.item, static_cast<int>(s.count));
    }

    // ЗАПАС: пикапы на полу — место бойни само становится запасом (S12.5).
    for (auto [e, p, t] : reg.view<const Pickup, const Transform>().each())
        if (t.layer == layer && p.item != kInvalidItem)
            supply_add_item(fr, room_at_pos(fr, t.pos), p.item,
                            static_cast<int>(p.count));
}

} // namespace giga::game
