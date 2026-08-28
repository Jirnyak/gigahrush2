// suite_doors — НОВАЯ дверь: зарастание проёма настоящей материей
// (редакция владельца 2026-08-28; прежняя система вырезана целиком).
//
// Пины — ровно три закона системы ([game/door.h]):
//   1. Запись = ГДЕ и ЧЕМ (модуль объявляет; лифтовые створки — механизм).
//   2. Состояния НЕТ: «закрыта» — производная от мира; тоггл штампует и
//      снимает НАСТОЯЩИЕ субвоксели; тело в проёме — отказ закрытия.
//   3. Полотно — материя: снимок этажа несёт закрытую дверь сам (сброса
//      на входе не существует по построению).
#include "game/door.h"
#include "game/floor_gen.h"
#include "game/floor_spec.h"
#include "game/save.h"
#include "world/world.h"

namespace doors_test {

void declaration_and_toggle() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    Doors d;
    door_declare(d, 0, floor_spec(FloorKind::Residential), 1337u);
    CHECK(!d.list.empty());
    // Лифтовые створки: 4 механизм-портала, акторному промпту невидимы.
    for (int hub = 0; hub < 4; ++hub) {
        CHECK(d.lift[hub] != kNoPortal);
        CHECK(d.list[d.lift[hub]].mechanism == 1);
    }
    // На жилом этаже есть и гермополотна (Living/Medical/Hq) и сталь.
    bool sawSteel = false, sawHermetic = false;
    for (const DoorPortal& p : d.list) {
        if (p.mat == kMatDoorSteel) sawSteel = true;
        if (p.mat == kMatDoorHermetic) sawHermetic = true;
    }
    CHECK(sawSteel);
    CHECK(sawHermetic);

    // Первый акторный портал с чистым проёмом.
    Registry reg;
    std::vector<std::uint32_t> dirty;
    std::uint32_t id = kNoPortal;
    for (std::uint32_t i = 0; i < d.list.size(); ++i) {
        if (d.list[i].mechanism) continue;
        if (!door_closed(w, d.list[i])) { id = i; break; }
    }
    CHECK(id != kNoPortal);
    const DoorPortal& p = d.list[id];
    const vec3 at{(p.cx + 0.5f) * kCellSize, (p.cy + 0.5f) * kCellSize,
                  (p.cz + 0.5f) * kCellSize};

    // Тоггл закрывает: настоящая материя в маске+странице, состояние —
    // производная от мира.
    CHECK(door_toggle_near(w, d, reg, 0, at, dirty) == id);
    CHECK(door_closed(w, p));
    CHECK(!dirty.empty());
    CHECK(!w.grid().mask(p.cx, p.cy, p.cz).empty());

    // Тоггл открывает: свои биты сняты, проём снова воздух.
    dirty.clear();
    CHECK(door_toggle_near(w, d, reg, 0, at, dirty) == id);
    CHECK(!door_closed(w, p));
    CHECK(!dirty.empty());

    // Тело в проёме — отказ закрытия (не замуровываем).
    Entity body = reg.create();
    reg.emplace<Transform>(body, Transform{at, 0});
    dirty.clear();
    CHECK(door_toggle_near(w, d, reg, 0, at, dirty) == kNoPortal);
    CHECK(!door_closed(w, p));

    // Механизм-API: лифтовая створка закрывается/открывается машиной,
    // акторный запрос её не видит.
    const DoorPortal& lp = d.list[d.lift[0]];
    const vec3 lat{(lp.cx + 0.5f) * kCellSize, (lp.cy + 0.5f) * kCellSize,
                   (lp.cz + 0.5f) * kCellSize};
    CHECK(door_query_near(d, lat) == kNoPortal || 
          !d.list[door_query_near(d, lat)].mechanism);
    dirty.clear();
    CHECK(door_close(w, lp, reg, 0, dirty));
    CHECK(door_closed(w, lp));
    door_open(w, lp, dirty);
    CHECK(!door_closed(w, lp));
}

void snapshot_carries_closed_door() {
    World w;
    generate_floor(w, 3, floor_spec(FloorKind::Residential), 777u);
    Doors d;
    door_declare(d, 3, floor_spec(FloorKind::Residential), 777u);
    Registry reg;
    std::vector<std::uint32_t> dirty;
    std::uint32_t id = kNoPortal;
    for (std::uint32_t i = 0; i < d.list.size(); ++i)
        if (!d.list[i].mechanism && !door_closed(w, d.list[i])) { id = i; break; }
    CHECK(id != kNoPortal);
    const DoorPortal& p = d.list[id];
    const vec3 at{(p.cx + 0.5f) * kCellSize, (p.cy + 0.5f) * kCellSize,
                  (p.cz + 0.5f) * kCellSize};
    CHECK(door_toggle_near(w, d, reg, 0, at, dirty) == id);
    CHECK(door_closed(w, p));

    // Снимок -> свежий мир: закрытая при уходе дверь закрыта при возврате
    // БЕЗ какого-либо дверного состояния — полотно едет материей мира.
    std::vector<std::uint8_t> blob;
    snapshot_floor(w, 3, blob);
    World w2;
    generate_floor(w2, 3, floor_spec(FloorKind::Residential), 777u);
    CHECK(!door_closed(w2, p)); // свежая генерация — проём открыт
    CHECK(apply_floor_snapshot(w2, blob.data(), blob.size()));
    CHECK(door_closed(w2, p)); // материя вернулась — дверь закрыта
}

} // namespace doors_test

static void test_doors_all() {
    doors_test::declaration_and_toggle();
    doors_test::snapshot_carries_closed_door();
    std::printf("doors suite done (материя, не состояние)\n");
}
