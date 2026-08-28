// Комната как объект (rooms-object инкремент B) — гейты плана:
//
//   1. ИЗОТРОПИЯ (гейт 1): объявление, повёрнутое по осям x<->y<->z, даёт
//      идентично повёрнутый roomAt. Старая комната-КОЛОННА (hash без z) этот
//      тест провалила бы — это и есть доказательство, что 2D умерло (S12.1).
//   2. Ни одной клетки в двух комнатах, ни одной комнаты без клеток (гейт 2):
//      пересечение считается вслух (overlapCells), пустая композиция —
//      отказ (refused), не молчаливый мусор.
//   3. WRAP (S1): зона на шве тора штампует по всем трём осям — сумма клеток
//      по боксам == непустым клеткам roomAt в обоих положениях.
//   4. RoomId бит-в-бит: одна последовательность объявлений — один результат,
//      порядок объявления и есть источник устойчивости id между сессиями.
//
// Included from game_test.cpp like every suite; uses its CHECK.

#include "game/floor_gen.h"  // rooms_declare — диспетч в объявитель модуля
#include "game/floor_spec.h" // floor_spec(kind)
#include "game/room.h"

// Повернуть клетку перестановкой осей perm: outAxis <- inAxis perm[outAxis].
static void rooms_permute_cell(const int perm[3], int in[3], int out[3]) {
    for (int a = 0; a < 3; ++a) out[a] = in[perm[a]];
}

static void test_rooms_isotropy() {
    using namespace giga::game;
    // Асимметричная зона + композиция, чтобы перестановка осей была видима.
    const RoomBox base[2] = {{10, 20, 30, 5, 3, 7}, {15, 20, 30, 2, 3, 2}};
    // Все 6 перестановок осей; тождественная — контроль самой проверки.
    const int perms[6][3] = {{0, 1, 2}, {0, 2, 1}, {1, 0, 2},
                             {1, 2, 0}, {2, 0, 1}, {2, 1, 0}};
    FloorRooms ref;
    rooms_reset(ref);
    CHECK(room_declare(ref, base, 2, 0, 0) != kNoRoom);
    for (const auto& perm : perms) {
        FloorRooms turned;
        rooms_reset(turned);
        RoomBox tb[2];
        for (int b = 0; b < 2; ++b) {
            int o[3] = {base[b].x, base[b].y, base[b].z};
            int s[3] = {base[b].sx, base[b].sy, base[b].sz};
            int oo[3], ss[3];
            rooms_permute_cell(perm, o, oo);
            rooms_permute_cell(perm, s, ss);
            tb[b] = {static_cast<std::uint8_t>(oo[0]),
                     static_cast<std::uint8_t>(oo[1]),
                     static_cast<std::uint8_t>(oo[2]),
                     static_cast<std::uint8_t>(ss[0]),
                     static_cast<std::uint8_t>(ss[1]),
                     static_cast<std::uint8_t>(ss[2])};
        }
        CHECK(room_declare(turned, tb, 2, 0, 0) != kNoRoom);
        // Каждая клетка исходника обязана найтись повёрнутой — и наоборот
        // (счёт клеток равен, значит две инъекции = биекция).
        CHECK(turned.list[0].cells == ref.list[0].cells);
        bool same = true;
        for (int z = 25; z < 45 && same; ++z)
            for (int y = 15; y < 30 && same; ++y)
                for (int x = 5; x < 25 && same; ++x) {
                    int in[3] = {x, y, z}, out[3];
                    rooms_permute_cell(perm, in, out);
                    same = room_at(ref, in[0], in[1], in[2]) ==
                           room_at(turned, out[0], out[1], out[2]);
                }
        CHECK(same);
    }
}

static void test_rooms_no_overlap_no_empty() {
    using namespace giga::game;
    FloorRooms fr;
    rooms_reset(fr);
    const RoomBox a{40, 40, 40, 4, 4, 2};
    CHECK(room_declare(fr, &a, 1, 0, 0) == 1);
    CHECK(fr.overlapCells == 0);
    CHECK(fr.list[0].cells == 4 * 4 * 2);
    // Пересечение: клетка остаётся за ПЕРВЫМ объявившим (детерминизм), а
    // спор считается вслух, не молчит.
    const RoomBox b{42, 42, 40, 4, 4, 2};
    const RoomId second = room_declare(fr, &b, 1, 0, 0);
    CHECK(second == 2);
    CHECK(fr.overlapCells == 2 * 2 * 2);
    CHECK(room_at(fr, 42, 42, 40) == 1);
    CHECK(room_at(fr, 45, 45, 41) == 2);
    // Комната без клеток запрещена: пустая композиция и нулевая ось — отказ.
    CHECK(room_declare(fr, nullptr, 0, 0, 0) == kNoRoom);
    const RoomBox zero{0, 0, 0, 3, 0, 3};
    CHECK(room_declare(fr, &zero, 1, 0, 0) == kNoRoom);
    CHECK(fr.refused == 2);
    // Сумма клеток по комнатам == непустым клеткам roomAt (гейт A плана).
    std::size_t nonEmpty = 0;
    for (const RoomId id : fr.roomAt) nonEmpty += id != kNoRoom;
    std::size_t declaredCells = 0;
    for (const auto& r : fr.list) declaredCells += r.cells;
    CHECK(nonEmpty == declaredCells);
}

static void test_rooms_wrap_all_axes() {
    using namespace giga::game;
    // Одна и та же зона 6x3x4 у шва и вдали от шва — счёт клеток обязан
    // совпасть по каждой оси (S1: заворачивание всегда, по всем трём).
    for (int axis = 0; axis < 3; ++axis) {
        FloorRooms seam, mid;
        rooms_reset(seam);
        rooms_reset(mid);
        std::uint8_t o[3] = {30, 31, 32};
        RoomBox m{o[0], o[1], o[2], 6, 3, 4};
        CHECK(room_declare(mid, &m, 1, 0, 0) != kNoRoom);
        o[axis] = 126; // край: зона перехлёстывает 127 -> 0
        RoomBox s{o[0], o[1], o[2], 6, 3, 4};
        CHECK(room_declare(seam, &s, 1, 0, 0) != kNoRoom);
        CHECK(seam.list[0].cells == mid.list[0].cells);
        CHECK(seam.overlapCells == 0);
        // Обе стороны шва отвечают одной комнатой.
        int probeLo[3] = {static_cast<int>(o[0]), static_cast<int>(o[1]),
                          static_cast<int>(o[2])};
        int probeHi[3] = {probeLo[0], probeLo[1], probeLo[2]};
        probeHi[axis] = 0; // заворот
        CHECK(room_at(seam, probeLo[0], probeLo[1], probeLo[2]) == 1);
        CHECK(room_at(seam, probeHi[0], probeHi[1], probeHi[2]) == 1);
    }
}

static void test_rooms_deterministic_ids_and_alias() {
    using namespace giga::game;
    // Одна последовательность объявлений — байт-в-байт один roomAt и один
    // список: RoomId поедет в якоря агентов (S13.8) и обязан пережить сессию.
    FloorRooms a, b;
    for (FloorRooms* fr : {&a, &b}) {
        rooms_reset(*fr);
        const RoomBox r1{5, 5, 5, 8, 6, 2};
        const RoomBox r2[2] = {{60, 60, 60, 4, 4, 4}, {64, 60, 60, 2, 4, 2}};
        std::int16_t declared[kVerbCount] = {};
        declared[kVerbSleep] = 30;
        (void)room_declare(*fr, &r1, 1, kRoomTagHermetic, 7, declared);
        const RoomId lab = room_declare(*fr, r2, 2, 0, 0);
        room_alias(*fr, room_alias_hash("yakov_lab"), lab);
    }
    CHECK(a.list.size() == b.list.size());
    CHECK(a.roomAt == b.roomAt);
    CHECK(room_find_alias(a, room_alias_hash("yakov_lab")) == 2);
    CHECK(room_find_alias(a, room_alias_hash("no_such_room")) == kNoRoom);
    // Объявленное предложение неразрушимо и читается через room_of.
    const Room* r = room_of(a, 1);
    CHECK(r != nullptr);
    CHECK(r->declared[kVerbSleep] == 30);
    CHECK(r->tags == kRoomTagHermetic);
    CHECK(r->owner == 7);
    CHECK(room_of(a, kNoRoom) == nullptr);
    CHECK(room_of(a, 999) == nullptr);
}

// Гейт инкремента C: модуль объявляет свои НАСТОЯЩИЕ комнаты — падик отдаёт
// BSP-листья всех 42 ярусов, blame — гермолобби решётки; зоны не пересекаются
// и не отвергаются; RoomId бит-в-бит между двумя объявлениями (устойчивость
// между сессиями — источник в детерминизме плана). Хрущи объявляют 0 ВСЛУХ
// до решения владельца о полуторном ярусе — пин ниже держит это обещание и
// покраснеет, когда объявитель сядет (тогда — снять).
static void test_rooms_modules_declare() {
    using namespace giga::game;
    FloorRooms a, b;
    const FloorSpec& padicSpec = floor_spec(FloorKind::Padic);
    rooms_declare(a, /*number=*/4, padicSpec, /*seed=*/1337u);
    rooms_declare(b, /*number=*/4, padicSpec, /*seed=*/1337u);
    // Падик: тысячи комнат (сотни листьев на план x 42 яруса), ни одного
    // пересечения, ни одного отказа — BSP-листья дизъюнктны по построению.
    CHECK(a.list.size() > 1000);
    CHECK(a.overlapCells == 0);
    CHECK(a.refused == 0);
    CHECK(a.roomAt == b.roomAt);
    CHECK(a.list.size() == b.list.size());
    // Объявленное предложение живо: хоть у одной комнаты спать 30 (жилая) и
    // хоть у одной сортир 20 (санузел) — роли листьев доехали до объявления.
    bool sawDwelling = false, sawToilet = false;
    for (const Room& r : a.list) {
        sawDwelling = sawDwelling || r.declared[kVerbSleep] == 30;
        sawToilet = sawToilet || r.declared[kVerbToilet] == 20;
    }
    CHECK(sawDwelling);
    CHECK(sawToilet);
    // Другой seed — другая планировка (план живёт от seed, не от копипасты).
    FloorRooms c;
    rooms_declare(c, /*number=*/4, padicSpec, /*seed=*/7331u);
    CHECK(c.roomAt != a.roomAt);

    // Blame: 16 узлов x 16 бэндов гермолобби, все с тегом и укрытием.
    FloorRooms bl;
    rooms_declare(bl, /*number=*/-26, floor_spec(FloorKind::Blame), 42u);
    CHECK(bl.list.size() == 256);
    CHECK(bl.overlapCells == 0);
    for (const Room& r : bl.list) {
        CHECK(r.tags == kRoomTagHermetic);
        CHECK(r.declared[kVerbShelter] == 10);
    }

    // Хрущи: 5 комнат на квартиру (прихожая/коридор — проход), 2 квартиры на
    // секцию-ярус, 10 ярусов; ни пересечений, ни отказов; детерминизм тот же.
    FloorRooms kh, kh2;
    rooms_declare(kh, /*number=*/1, floor_spec(FloorKind::Khrushi), 42u);
    rooms_declare(kh2, /*number=*/1, floor_spec(FloorKind::Khrushi), 42u);
    CHECK(kh.list.size() > 500);
    CHECK(kh.list.size() % 5 == 0); // комнаты идут пятёрками квартир
    CHECK(kh.overlapCells == 0);
    CHECK(kh.refused == 0);
    CHECK(kh.roomAt == kh2.roomAt);
    // Ярусы чередуются 1 и 2 клетки (правило центра, kStoreyRise 12): у
    // спальни 1x3 в плане клеток либо 3, либо 6.
    bool saw3 = false, saw6 = false;
    for (const Room& r : kh.list)
        if (r.declared[kVerbSleep] == 30) {
            saw3 = saw3 || r.cells == 3;
            saw6 = saw6 || r.cells == 6;
        }
    CHECK(saw3);
    CHECK(saw6);
}

static void test_rooms_object_all() {
    test_rooms_isotropy();
    test_rooms_no_overlap_no_empty();
    test_rooms_wrap_all_axes();
    test_rooms_deterministic_ids_and_alias();
    test_rooms_modules_declare();
}
