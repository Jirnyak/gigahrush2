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
#include "game/focus.h"
#include "game/prop_system.h" // Interactable — тело смотрящего в гейте фокуса
#include "game/floor_gen.h"
#include "game/floor_spec.h"
#include "game/save.h"
#include "world/world.h"

namespace doors_test {

void declaration_and_toggle() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    Doors d;
    FloorRooms fr;
    rooms_declare(fr, 0, floor_spec(FloorKind::Residential), 1337u);
    door_declare(d, fr, 0, floor_spec(FloorKind::Residential), 1337u);
    CHECK(!d.list.empty());
    // Лифтовые створки: 4 механизм-портала, акторному промпту невидимы.
    for (int hub = 0; hub < 4; ++hub) {
        CHECK(d.lift[hub] != kNoPortal);
        CHECK(d.list[d.lift[hub]].mechanism == 1);
    }
    // Вердикт владельца 2026-08-29: жилой фонд падика — НЕ гермозоны, все
    // квартирные двери сталь (ломаются упорным карвом). Гермополотна живут
    // у настоящих гермозон (гермолобби blame) — обе полярности ниже.
    bool sawSteel = false, sawHermetic = false;
    for (const MaskGroup& p : d.list) {
        if (p.mat == kMatDoorSteel) sawSteel = true;
        if (p.mat == kMatDoorHermetic) sawHermetic = true;
    }
    CHECK(sawSteel);
    CHECK(!sawHermetic);

    // Первый акторный портал с чистым проёмом.
    Registry reg;
    std::vector<std::uint32_t> dirty;
    std::uint32_t id = kNoPortal;
    for (std::uint32_t i = 0; i < d.list.size(); ++i) {
        if (d.list[i].mechanism) continue;
        if (!door_closed(w, d.list[i])) { id = i; break; }
    }
    CHECK(id != kNoPortal);
    const MaskGroup& p = d.list[id];
    const vec3 at = p.centre;

    // Тоггл закрывает: настоящая материя в маске+странице, состояние —
    // производная от мира.
    CHECK(door_toggle_near(w, d, reg, 0, at, dirty) == id);
    CHECK(door_closed(w, p));
    CHECK(!dirty.empty());
    CHECK(!w.grid().masks()[p.cells.front().ci].empty());

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
    const MaskGroup& lp = d.list[d.lift[0]];
    const vec3 lat = lp.centre;
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
    FloorRooms fr;
    rooms_declare(fr, 3, floor_spec(FloorKind::Residential), 777u);
    door_declare(d, fr, 3, floor_spec(FloorKind::Residential), 777u);
    Registry reg;
    std::vector<std::uint32_t> dirty;
    std::uint32_t id = kNoPortal;
    for (std::uint32_t i = 0; i < d.list.size(); ++i)
        if (!d.list[i].mechanism && !door_closed(w, d.list[i])) { id = i; break; }
    CHECK(id != kNoPortal);
    const MaskGroup& p = d.list[id];
    const vec3 at = p.centre;
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

// ФОКУС ПРИЦЕЛА на РЕАЛЬНОМ этаже ([game/focus.h]). Гейт существует, потому
// что первая версия молчала в игре по двум причинам сразу — своя формула
// взгляда вместо camera_forward и марш, стартующий В МАТЕРИИ (заслонял всё).
// Оба дефекта headless-ловимы, и этот тест их ловит.
//
// Третья причина немоты — СВОЁ ТЕЛО: каждое живое тело несёт Interactable,
// включая тело смотрящего ([game/embody.cpp] «finders skip self»), и без
// пропуска self оно, стоя в четверти метра от глаза, перебивало ЛЮБУЮ дверь
// (замер GIGA_FOCUS_DBG 2026-08-28: what=Entity dist=0.22 при любом
// взгляде). Тест возит тело смотрящего вместе с глазом.
void focus_aims_at_a_real_door() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    Doors d;
    FloorRooms fr;
    rooms_declare(fr, 0, floor_spec(FloorKind::Residential), 1337u);
    door_declare(d, fr, 0, floor_spec(FloorKind::Residential), 1337u);
    Registry reg;
    const Entity self = reg.create();
    reg.emplace<Transform>(self, Transform{{0, 0, 0}, 0});
    reg.emplace<Interactable>(
        self, Interactable{InteractKind::Npc, 2.5f, true});

    int seen = 0, promptOk = 0;
    for (std::uint32_t i = 0; i < d.list.size() && seen < 8; ++i) {
        const MaskGroup& p = d.list[i];
        if (p.mechanism) continue;
        const vec3 centre = p.centre;
        // Глаз в полутора метрах по -X от проёма, смотрит на него: тот же
        // вектор, что даёт camera_forward(yaw=0) — ось +X.
        // Подход с ЧЕТЫРЁХ сторон, как в игре: проём стоит в стене вдоль
        // одной оси, и с двух сторон к нему не подойти вовсе.
        ++seen;
        const int off[4][2] = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};
        bool aimed = false;
        for (int k = 0; k < 4 && !aimed; ++k) {
            const vec3 eye{centre.x - off[k][0] * 1.5f,
                           centre.y - off[k][1] * 1.5f, centre.z};
            // Взгляд С НАКЛОНОМ ВНИЗ, как в живом замере (aim.z = −0.48):
            // при горизонтальном взгляде своё тело даёт along=0 и мутация
            // «пропуск self снят» не ловится — тело выигрывает только когда
            // проекция на луч положительна, то есть почти всегда в игре.
            const vec3 dir{0.877f * off[k][0], 0.877f * off[k][1], -0.48f};
            // Тело смотрящего стоит под глазом, как в игре (глаз выше
            // центра тела): без пропуска self оно ближайшая цель всегда.
            reg.get<Transform>(self).pos = {eye.x, eye.y, eye.z - 0.7f};
            const Focus f = focus_pick(reg, w, /*layer=*/0, eye, dir, d, self);
            CHECK(!(f.what == Focus::What::Entity && f.entity == self));
            if (f.what == Focus::What::Portal && f.portal == i) {
                aimed = true;
                // Табличка приходит ИЗ СИСТЕМЫ, не из литерала у действия.
                CHECK(focus_prompt(f, w, d) != nullptr);
            }
        }
        if (aimed) ++promptOk;
    }
    std::printf("[focus] doors probed %d, aimed %d\n", seen, promptOk);
    CHECK(seen > 0);
    // Хоть с одной из четырёх сторон обязан ловиться КАЖДЫЙ проём: иначе
    // дверь в игре нема (жалоба владельца 2026-08-28).
    CHECK(promptOk == seen);
}

// ДВЕРЬ ЛЮБОЙ ФОРМЫ ([world/mask.h], владелец 2026-08-28: «проём, решётка
// толщиной в один субвоксель, толстая гермодверь, створки ворот»). Форма —
// биты allow: полотно в один субвоксель толщиной штампует РОВНО свои биты
// и снимает ровно их — ни атомом больше.
void arbitrary_shape_door() {
    World w;
    Doors d;
    MaskGroup g;
    g.props = kMaskDoor;
    g.mat = kMatDoorSteel;
    SubMask plate; // стенка sx==0: 8×8 = 64 атома, толщина 0.25 м
    for (int sz = 0; sz < kSubDim; ++sz)
        for (int sy = 0; sy < kSubDim; ++sy)
            plate.set(sub_bit(0, sy, sz));
    const std::uint32_t ci =
        static_cast<std::uint32_t>(macro_index(10, 10, 10));
    g.cells.push_back(MaskCell{ci, plate});
    g.centre = vec3{10.5f * kCellSize, 10.5f * kCellSize, 10.5f * kCellSize};
    d.list.push_back(g);

    Registry reg;
    std::vector<std::uint32_t> dirty;
    CHECK(!door_closed(w, d.list[0]));
    CHECK(door_toggle_near(w, d, reg, 0, g.centre, dirty) == 0);
    CHECK(door_closed(w, d.list[0]));
    const SubMask& m = w.grid().masks()[ci];
    int stamped = 0;
    for (int b = 0; b < kSubVoxels; ++b) {
        if (!m.test(b)) continue;
        CHECK(plate.test(b)); // ни атома вне формы
        ++stamped;
    }
    CHECK(stamped == kSubDim * kSubDim);
    dirty.clear();
    CHECK(door_toggle_near(w, d, reg, 0, g.centre, dirty) == 0);
    CHECK(!door_closed(w, d.list[0]));
    CHECK(w.grid().masks()[ci].empty()); // сняла ровно свои — клетка чиста
}

// ОБВЕС ЛИФТА + АКТИВАЦИЯ ССЫЛКОЙ (S18, решение 3): кнопка вызова несёт
// DoorRef на створку СВОЕГО хаба; дверь сама ничего не слушает. Гейт
// существует, потому что прежний обработчик ДЕРИВИРОВАЛ хаб из позиции
// кнопки — угадывание, которое «кнопка снаружи не срабатывает» и дало.
void lift_dressing_and_reference() {
    World w;
    // Номер 2 (не 0): хеш lift_entrance на сиде 1337 даёт этажу 2 стороны
    // обеих осей (1 2 1 2) — проверка четверти оборота ниже не пуста; у
    // этажа 0 все четыре входа одноосные.
    generate_floor(w, 2, floor_spec(FloorKind::Residential), 1337u);
    Doors d;
    FloorRooms fr;
    rooms_declare(fr, 2, floor_spec(FloorKind::Residential), 1337u);
    door_declare(d, fr, 2, floor_spec(FloorKind::Residential), 1337u);
    Registry reg;
    std::vector<std::uint32_t> dirty;
    dress_lift_portals(reg, w, d, 2, floor_spec(FloorKind::Residential),
                       1337u, 0, dirty);
    // Дефолт: все 4 створки закрыты («где дверь» больше не вопрос).
    for (int hub = 0; hub < 4; ++hub)
        CHECK(door_closed(w, d.list[d.lift[hub]]));
    // Кнопки: 4 интерактора с DoorRef, каждый ссылается на створку лифта,
    // и активация ссылкой открывает её.
    int found = 0;
    auto view = reg.view<const DoorRef>();
    for (auto e : view) {
        const std::uint32_t g = view.get<const DoorRef>(e).group;
        CHECK(g < d.list.size());
        bool isLift = false;
        for (int hub = 0; hub < 4; ++hub)
            if (d.lift[hub] == g) isLift = true;
        CHECK(isLift);
        dirty.clear();
        door_open(w, d.list[g], dirty);
        CHECK(!door_closed(w, d.list[g]));
        ++found;
    }
    CHECK(found == 4);
    // Ориентация ВЫВОДИТСЯ из грани якоря (плейтест 2026-08-29: кнопка
    // стояла ребром — dress_lift_portals не передавал yaw). Каждый элемент
    // обвеса: yaw == prop_wall_yaw(face); сид обязан покрыть обе оси стен,
    // иначе проверка четверти оборота пуста.
    bool axisX = false, axisY = false;
    auto dressed =
        reg.view<const PropOf, const PropMesh, const SubVoxelAnchor>();
    for (auto e : dressed) {
        const PropId pid = dressed.get<const PropOf>(e).id;
        if (pid != PropId::LiftButton && pid != PropId::LiftPanel) continue;
        const std::uint8_t face = dressed.get<const SubVoxelAnchor>(e).face;
        CHECK(dressed.get<const PropMesh>(e).yaw == prop_wall_yaw(face));
        (anchor_face_axis(face) == 0 ? axisX : axisY) = true;
    }
    CHECK(axisX && axisY);
}

// S20.4 «долг писателя один и полный»: дверь — писатель статики, как карв.
// Проп, заякоренный к атомам ЗАКРЫТОГО полотна, обязан отвалиться при
// открытии — та же anchor_validate_step на DoorSet::dirtyCells, которой
// платит карв (в main дверной дренаж зовёт её теперь же). Обе полярности:
// на закрытом полотне проп живёт, открытие — рвёт.
void door_open_rips_anchored_prop() {
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    Doors d;
    FloorRooms fr;
    rooms_declare(fr, 0, floor_spec(FloorKind::Residential), 1337u);
    door_declare(d, fr, 0, floor_spec(FloorKind::Residential), 1337u);
    Registry reg;
    EventBus bus;
    bus.init();
    std::vector<std::uint32_t> dirty;
    std::uint32_t id = kNoPortal;
    for (std::uint32_t i = 0; i < d.list.size(); ++i)
        if (!d.list[i].mechanism && !door_closed(w, d.list[i])) {
            id = i;
            break;
        }
    CHECK(id != kNoPortal);
    const MaskGroup& p = d.list[id];
    // Клетка ЧИСТОГО проёма (маска пуста до закрытия): после открытия в
    // ней гарантированно не останется несущей материи — проба якоря умрёт
    // именно от снятия полотна, а не случайно выживет на коробке.
    std::uint32_t ci = 0xFFFFFFFFu;
    for (const MaskCell& mc : p.cells)
        if (w.grid().masks()[mc.ci].empty()) {
            ci = mc.ci;
            break;
        }
    CHECK(ci != 0xFFFFFFFFu);
    CHECK(door_toggle_near(w, d, reg, 0, p.centre, dirty) == id);
    CHECK(door_closed(w, p));
    game::SubVoxelAnchor a{};
    a.cx = static_cast<int>(ci & 127u);
    a.cy = static_cast<int>((ci >> 7) & 127u);
    a.cz = static_cast<int>(ci >> 14);
    a.subX = 4; a.subY = 4; a.subZ = 4;
    bool anchored = false;
    for (std::uint8_t f = 0; f < 6 && !anchored; ++f) {
        const AnchorUV uv = anchor_face_uv(f, a.subX, a.subY, a.subZ);
        if (anchor_alive(w, a.cx, a.cy, a.cz, f, uv.u, uv.v)) {
            a.face = f;
            anchored = true;
        }
    }
    CHECK(anchored);
    const vec3 pos{(static_cast<float>(a.cx) + 0.5f) * kCellSize,
                   (static_cast<float>(a.cy) + 0.5f) * kCellSize,
                   (static_cast<float>(a.cz) + 0.5f) * kCellSize};
    const auto prop = game::spawn_prop(reg, w, pos, a,
                                       game::Interactable::Kind::Terminal,
                                       game::PropFallMode::SimpleFall,
                                       vec3{0.3f, 0.3f, 0.3f},
                                       /*meshKind*/0, /*layer*/0);
    CHECK(reg.valid(prop));
    CHECK(reg.all_of<game::StaticPropTag>(prop));

    // Полярность «закрыто»: дренаж закрытия проп не трогает.
    game::anchor_validate_step(reg, w, /*layer*/0, bus, dirty);
    CHECK(reg.all_of<game::StaticPropTag>(prop));

    // Открытие: свои биты сняты — проп на полотне отваливается тем же
    // валидатором, что у карва.
    dirty.clear();
    CHECK(door_toggle_near(w, d, reg, 0, p.centre, dirty) == id);
    CHECK(!door_closed(w, p));
    game::anchor_validate_step(reg, w, /*layer*/0, bus, dirty);
    CHECK(!reg.all_of<game::StaticPropTag>(prop));
}

} // namespace doors_test

static void test_doors_all() {
    doors_test::declaration_and_toggle();
    doors_test::door_open_rips_anchored_prop();
    doors_test::snapshot_carries_closed_door();
    doors_test::focus_aims_at_a_real_door();
    doors_test::arbitrary_shape_door();
    doors_test::lift_dressing_and_reference();
    std::printf("doors suite done (материя, не состояние)\n");
}
