// ПОСТАНОВКА СОДЕРЖИМОГО МОДУЛЕМ — гейты хука и трёх глаголов
// ([game/floor_gen.h] FloorPlaceCtx + floor_place_content, [game/prop_system.h]
// place_prop_on_wall / place_prop_standing / place_prop_hanging).
//
// Что здесь судится, по убыванию цены ошибки:
//
//  1. ОТКАЗ — ЗНАЧЕНИЕ. Модуль назвал клетку, где нет опоры, — ни одной
//     сущности. Это единственная защита от мебели, висящей в воздухе, и она
//     обязана краснеть в ОБЕ полярности: есть опора — вещь есть, нет — нет.
//
//  2. ЯКОРЬ В НАЗВАННУЮ ОПОРУ, а не «куда-нибудь рядом»: у панели — в стену, у
//     стоящей вещи — В ПОЛ (вырезали пол — падает, стену рядом — стоит), у
//     подвеса — в потолок. Якорь не туда = вещь, переживающая снос своей
//     опоры, то есть молчаливо сломанный S20.2, которого не видно глазами.
//
//  3. ПОРОГ ГЛАГОЛА В ОБЕ ПОЛЯРНОСТИ (`prop_fits_room`). Это ВСЁ правило «что
//     где стоит»: койка встаёт в комнату, объявившую «спать» не слабее самой
//     койки, и НЕ встаёт в ту, которая глагол лишь допускает. Без второй
//     полярности правило вырождается в «ставь везде» и остаётся зелёным.
//
//  4. МЕСТО ПРИНАДЛЕЖИТ НАЗВАННОЙ КОМНАТЕ (`room_stand_spots` спрашивает
//     `room_at`, а не только бокс): на пересечении объявлений клетка
//     достаётся ПЕРВОМУ объявившему (room.h), и мебель второго иначе уехала
//     бы в чужую зону.
//
//  5. ДИСПАТЧ — СТРОКА, и ноль блейма приходит ИЗ БЛЕЙМА: одна и та же
//     годная зона обставляется у хрущей и остаётся пустой у мегаструктуры.
#include "game/floors/khrushi/khrushi.h" // khrushi_place — расстановщик модуля

namespace content_suite {

using namespace giga;
using namespace giga::game;

// Воздушная клетка (cx,cy,cz) с полной твердью под ней и полной твердью со
// стороны +Y — ровно то, что просит `place_prop_standing` (пол + стена).
static void box_with_floor_and_wall(World& w, int cx, int cy, int cz) {
    w.grid().fill_cell(cx, cy, cz - 1, kMatConcrete); // пол
    w.grid().fill_cell(cx, cy + 1, cz, kMatConcrete); // стена за спиной
}

static int layer_props(const Registry& reg, LayerId layer) {
    int n = 0;
    for (auto e : reg.view<const Transform, const PropOf>())
        if (reg.get<const Transform>(e).layer == layer) ++n;
    return n;
}

// ---- 1+2: отказ есть значение, якорь идёт в названную опору --------------
static void test_content_refuses_without_support() {
    Registry reg;
    World world;
    const LayerId layer = 3;
    const std::uint8_t up = anchor_face_pack(2, +1);   // грань пола «вверх»
    const std::uint8_t back = anchor_face_pack(1, -1); // грань стены +Y на вещь

    // ПОЛЯРНОСТЬ А: пустой мир — ни пола, ни стены, сущностей ноль.
    CHECK(place_prop_standing(reg, world, layer, 10, 10, 9, up, back,
                              PropId::BedCot) == entt::null);
    CHECK(layer_props(reg, layer) == 0);

    // ПОЛЯРНОСТЬ А': пол есть, стены нет — всё равно отказ. Стена за спиной
    // обязательна по контракту, и это названное решение, не упущение.
    world.grid().fill_cell(10, 10, 9, kMatConcrete);
    CHECK(place_prop_standing(reg, world, layer, 10, 10, 9, up, back,
                              PropId::BedCot) == entt::null);
    CHECK(layer_props(reg, layer) == 0);

    // ПОЛЯРНОСТЬ А'' — ЗЕРКАЛЬНАЯ, и без неё гейт ПОЛА не покрыт ничем: в
    // пустом мире его отказ неотличим от отказа стены. Стена есть, опоры нет.
    {
        World noFloor;
        noFloor.grid().fill_cell(10, 11, 10, kMatConcrete); // только стена
        CHECK(place_prop_standing(reg, noFloor, layer, 10, 10, 9, up, back,
                                  PropId::BedCot) == entt::null);
        CHECK(layer_props(reg, layer) == 0);
    }

    // ПОЛЯРНОСТЬ А''' — ГЕЙТ ПОЛА, ЗАЖАТЫЙ ТАК, ЧТО ОН ЕДИНСТВЕННЫЙ. Прогон
    // показал, что на простых стендах `columns == 0` у пола — ВТОРОЙ ОТВЕТ:
    // `surface_face_at` заполняет клетку даже при нулевой площади, якорь
    // указывает на названную опору, и отказ выдаёт `anchor_alive` внутри
    // спавна. Чтобы гейт стал несущим, нужна геометрия, где опора ДЕРЖИТ
    // НАГРУЗКУ, но её грань ВНУТРЕННЯЯ: два сплошных куба подряд (шов двух
    // твёрдых клеток гранью не является, surface.h) при стене, чья
    // поверхность утоплена в СВОЮ клетку и потому экспонирована.
    {
        World sealed;
        sealed.grid().fill_cell(10, 10, 9, kMatConcrete);  // опора
        sealed.grid().fill_cell(10, 10, 10, kMatConcrete); // и клетка вещи
        SubMask& w2 = sealed.grid().mask(10, 11, 10);
        for (int sz = 0; sz < kSubDim; ++sz)
            for (int sy = kSubDim / 2; sy < kSubDim; ++sy)
                for (int sx = 0; sx < kSubDim; ++sx) w2.set(sub_bit(sx, sy, sz));
        sealed.grid().set_cell(10, 11, 10, kMatConcrete);
        CHECK(place_prop_standing(reg, sealed, layer, 10, 10, 9, up, back,
                                  PropId::BedCot) == entt::null);
        CHECK(layer_props(reg, layer) == 0);
    }

    // ПОЛЯРНОСТЬ Б: появилась стена — вещь родилась.
    world.grid().fill_cell(10, 11, 10, kMatConcrete);
    const Entity bed = place_prop_standing(reg, world, layer, 10, 10, 9, up,
                                           back, PropId::BedCot);
    CHECK(bed != entt::null);
    CHECK(layer_props(reg, layer) == 1);

    // ЯКОРЬ — В ПОЛ, НЕ В СТЕНУ: клетка якоря обязана быть клеткой опоры,
    // которую назвал вызывающий, иначе карв пола койку не уронит.
    const SubVoxelAnchor& a = reg.get<const SubVoxelAnchor>(bed);
    CHECK(a.cx == 10 && a.cy == 10 && a.cz == 9);
    CHECK(world.grid().solid(a.cx, a.cy, a.cz, a.subX, a.subY, a.subZ));
    // МЕТРЫ — ТОЧНО, И ЧИСЛА ИЗ ЖИВОЙ СТРОКИ. Границы клетки («выше 20, ниже
    // 22») оставляли 1.74 м люфта и не ловили ни подмену полвысоты на высоту,
    // ни sizeZ на sizeX. Опора — полная клетка 9, её верхняя грань на
    // 10·kCellSize; вещь стоит на ней, приподнятая на полкорпуса + волос.
    const PropDef& bd = prop_def(PropId::BedCot);
    const float halfH = 0.5f * static_cast<float>(bd.sizeZMm) * 0.001f;
    const vec3& p = reg.get<const Transform>(bed).pos;
    CHECK(std::fabs(p.z - (static_cast<float>(10) * kCellSize + halfH + 0.01f))
          < 1e-4f);
    // ...И СПИНОЙ К СТЕНЕ: сдвиг по оси backFace к реальной поверхности стены
    // (полная клетка 11 → её грань −Y на 11·kCellSize), на полглубины корпуса.
    // Без этой строки «спиной к стене» не гейтилось НИЧЕМ — ни одной
    // координаты, кроме вертикали, тест не читал.
    const float halfD = 0.5f * static_cast<float>(bd.sizeYMm) * 0.001f;
    CHECK(std::fabs(p.y - (static_cast<float>(11) * kCellSize - halfD - 0.02f))
          < 1e-4f);
}

static void test_content_wall_and_hang_anchor_their_support() {
    Registry reg;
    World world;
    const LayerId layer = 5;

    // Стена в (20,21,22) — ТРИ РАЗНЫЕ координаты намеренно: на (20,20,20)
    // перестановка осей в `anchor_from_surface` неотличима от тождества.
    world.grid().fill_cell(20, 21, 22, kMatConcrete);
    const std::uint8_t wallFace = anchor_face_pack(1, -1); // нормаль на вещь
    const Entity panel = place_prop_on_wall(reg, world, layer, 20, 21, 22,
                                            wallFace, PropId::Terminal);
    CHECK(panel != entt::null);
    const SubVoxelAnchor& pa = reg.get<const SubVoxelAnchor>(panel);
    CHECK(pa.cx == 20 && pa.cy == 21 && pa.cz == 22); // В СТЕНУ
    // ЗАПОДЛИЦО — ТОЧНО, а не «внутри соседней клетки»: граница клетки
    // оставляла 2 м люфта, и смена знака сдвига (панель прилипает к
    // ПРОТИВОПОЛОЖНОЙ стене в полутора метрах от своего якоря — тот самый
    // «парящий щиток» 2026-08-20) проходила зелёной.
    const float halfT = 0.5f * static_cast<float>(
                                   prop_def(PropId::Terminal).sizeYMm) * 0.001f;
    const vec3& pp = reg.get<const Transform>(panel).pos;
    CHECK(std::fabs(pp.y - (static_cast<float>(21) * kCellSize - halfT - 0.02f))
          < 1e-4f);
    // По касательным — центр клетки вещи (20,20,22): клетка вещи = клетка
    // стены + нормаль грани.
    CHECK(std::fabs(pp.x - (static_cast<float>(20) + 0.5f) * kCellSize) < 1e-4f);
    CHECK(std::fabs(pp.z - (static_cast<float>(22) + 0.5f) * kCellSize) < 1e-4f);
    // Интерактор приехал СТРОКОЙ пропа — отдельной двери «поставить
    // интерактор» не существует и не нужно. Склеено в ОДИН CHECK: CHECK не
    // прерывает тест, и разыменование после упавшей пробы — не красный гейт,
    // а segfault.
    CHECK(reg.all_of<Interactable>(panel) &&
          static_cast<std::uint8_t>(reg.get<Interactable>(panel).kind) ==
              prop_def(PropId::Terminal).interactKind);

    // ПОЛЯРНОСТЬ ОТКАЗА У ПАНЕЛИ — её не было вовсе, хотя шапка сьюта
    // объявляет отказ обязательным для всех трёх глаголов.
    CHECK(place_prop_on_wall(reg, world, layer, 50, 50, 50, wallFace,
                             PropId::Terminal) == entt::null);
    CHECK(layer_props(reg, layer) == 1); // панель одна, воздух не родил вторую

    // Потолок в (30,31,32) — снова три разные координаты.
    world.grid().fill_cell(30, 31, 32, kMatConcrete);
    const std::uint8_t hang = anchor_face_pack(2, -1);
    const Entity bulb = place_prop_hanging(reg, world, layer, 30, 31, 32, hang,
                                           PropId::BareBulb, /*dropM=*/0.45f);
    CHECK(bulb != entt::null);
    const SubVoxelAnchor& ba = reg.get<const SubVoxelAnchor>(bulb);
    CHECK(ba.cx == 30 && ba.cy == 31 && ba.cz == 32); // В ПОТОЛОК
    const vec3& bp = reg.get<const Transform>(bulb).pos;
    // Ровно dropM ниже нижней грани клетки потолка (полная клетка — грань на
    // её границе), а по касательным — ЦЕНТР клетки опоры (форма «по
    // представительной колонке» вешала лампу на стену соседнего угла).
    CHECK(std::fabs(bp.z - (static_cast<float>(32) * kCellSize - 0.45f)) <
          1e-4f);
    CHECK(std::fabs(bp.x - (static_cast<float>(30) + 0.5f) * kCellSize) <
          1e-4f);
    CHECK(std::fabs(bp.y - (static_cast<float>(31) + 0.5f) * kCellSize) <
          1e-4f);

    // Пустая клетка опоры — отказ, а не парящая лампа.
    CHECK(place_prop_hanging(reg, world, layer, 40, 40, 40, hang,
                             PropId::BareBulb, 0.45f) == entt::null);
    // ...и тот же зажатый случай, что у пола: опора ДЕРЖИТ нагрузку, но её
    // грань ВНУТРЕННЯЯ (сплошной куб под сплошным кубом). Без этой строки
    // гейт опоры подвеса был вторым ответом к `anchor_alive`, и его снос
    // проходил зелёным — проверено прогоном.
    world.grid().fill_cell(35, 35, 35, kMatConcrete);
    world.grid().fill_cell(35, 35, 34, kMatConcrete); // шов, а не грань
    CHECK(place_prop_hanging(reg, world, layer, 35, 35, 35, hang,
                             PropId::BareBulb, 0.45f) == entt::null);
    CHECK(layer_props(reg, layer) == 2); // панель и лампа, третьей нет
}

// ---- 3: порог глагола, обе полярности ------------------------------------
static void test_prop_fits_room_threshold_both_ways() {
    // Числа берутся из ЖИВОЙ таблицы, не выписаны тестом: порог ВЫВЕДЕН —
    // комната годится, когда объявила глагол не слабее самой вещи.
    const std::int16_t bedSleep =
        kPropVerbs[static_cast<std::size_t>(PropId::BedCot)][kVerbSleep];
    // > 1, а не > 0: при весе 1 комната `allows` (вес−1 = 0) схлопнулась бы в
    // `mute`, и «ВТОРАЯ ПОЛЯРНОСТЬ» ниже выродилась бы в проверку нулевого
    // стража, оставшись зелёной.
    CHECK(bedSleep > 1);

    Room lives{}; // спальня: ЖИВЁТ «спать»
    lives.declared[kVerbSleep] = static_cast<std::int16_t>(bedSleep + 1);
    Room allows{}; // зал: допускает, но не живёт
    allows.declared[kVerbSleep] = static_cast<std::int16_t>(bedSleep - 1);
    Room exact{}; // ровно по порогу — годится
    exact.declared[kVerbSleep] = bedSleep;
    Room mute{}; // не объявила ничего

    CHECK(prop_fits_room(PropId::BedCot, lives));
    CHECK(prop_fits_room(PropId::BedCot, exact));
    CHECK(!prop_fits_room(PropId::BedCot, allows)); // ВТОРАЯ ПОЛЯРНОСТЬ
    CHECK(!prop_fits_room(PropId::BedCot, mute));

    // Вещь с ДВУМЯ глаголами годится по ЛЮБОМУ из них: стол (eat + social)
    // встаёт и в кухню, и в зал. И это не «годится всегда» — унитаз в зал не
    // встаёт.
    const std::array<std::int16_t, kVerbCount>& tableV =
        kPropVerbs[static_cast<std::size_t>(PropId::KitchenTable)];
    CHECK(tableV[kVerbEat] > 0 && tableV[kVerbSocial] > 0); // посылка стенда
    Room hall{};
    hall.declared[kVerbSocial] = tableV[kVerbSocial];
    CHECK(prop_fits_room(PropId::KitchenTable, hall));
    CHECK(!prop_fits_room(PropId::ToiletPan, hall));
    // ВТОРАЯ ПОЛОВИНА того же утверждения — «встаёт и в кухню»: комната,
    // объявившая ТОЛЬКО `eat`. Без неё проверялся лишь один из двух глаголов,
    // и ранний выход из цикла по первому ненулевому остался бы зелёным.
    Room kitchen{};
    kitchen.declared[kVerbEat] = tableV[kVerbEat];
    CHECK(prop_fits_room(PropId::KitchenTable, kitchen));
}

// ---- 4: место принадлежит названной комнате ------------------------------
static void test_room_stand_spots_respect_ownership() {
    Registry reg;
    World world;
    FloorRooms fr;
    rooms_reset(fr);

    // Две комнаты на ОДИН бокс: первая забирает клетки (room.h — первый
    // объявивший владеет), вторая остаётся без своих.
    const RoomBox box{40, 40, 20, 3, 1, 1};
    std::int16_t declared[kVerbCount] = {};
    declared[kVerbSleep] = 30;
    const RoomId first = room_declare(fr, &box, 1, 0, 0, declared);
    const RoomId second = room_declare(fr, &box, 1, 0, 0, declared);
    CHECK(first != kNoRoom);

    for (int dx = 0; dx < 3; ++dx)
        box_with_floor_and_wall(world, 40 + dx, 40, 20);

    StandSpot spots[kMaxStandSpots];
    const int nFirst =
        room_stand_spots(world, fr, first, 0xABCDu, spots, kMaxStandSpots);
    CHECK(nFirst == 3); // три годных клетки, все принадлежат первой комнате

    // ДЕТЕРМИНИЗМ: та же соль — та же выдача, клетка за клеткой. Этаж обязан
    // возвращаться тем же (S20.6), а мебель — частью «того же».
    StandSpot again[kMaxStandSpots];
    CHECK(room_stand_spots(world, fr, first, 0xABCDu, again, kMaxStandSpots) ==
          nFirst);
    for (int i = 0; i < nFirst; ++i) {
        CHECK(again[i].cx == spots[i].cx);
        CHECK(again[i].cy == spots[i].cy);
        CHECK(again[i].cz == spots[i].cz);
        CHECK(again[i].floorFace == spots[i].floorFace);
        CHECK(again[i].backFace == spots[i].backFace);
    }

    for (int i = 0; i < nFirst; ++i) {
        // Запись называет клетку ОПОРЫ — на шаг против «вверх» от клетки вещи.
        CHECK(spots[i].cz == 19);
        CHECK(room_at(fr, spots[i].cx, spots[i].cy, spots[i].cz + 1) == first);
        // ...И ЕЁ ГРАНИ. Стенд знает обе (пол снизу, стена в +Y), а сьют их
        // не утверждал нигде — два байта записи ехали непроверенными, хотя
        // ровно ими глагол выбирает ось сдвига и поворот.
        CHECK(spots[i].floorFace == anchor_face_pack(2, +1));
        CHECK(spots[i].backFace == anchor_face_pack(1, -1));
    }
    // Второй объявитель того же бокса не получает НИ ОДНОГО места. Снять
    // проверку `room_at` — здесь вернулось бы 3, и мебель уехала бы в чужую
    // зону, оставшись зелёной.
    // БЕЗУСЛОВНО: это ЕДИНСТВЕННЫЙ гейт проверки владения (`room_at`) во всём
    // сьюте, а под `if` он исчез бы молча в тот день, когда `room_declare`
    // научится отказывать полностью перекрытому боксу.
    CHECK(second != kNoRoom);
    CHECK(room_stand_spots(world, fr, second, 0xABCDu, spots,
                           kMaxStandSpots) == 0);

    // Несуществующая комната — ноль, а не чтение за границей списка.
    CHECK(room_stand_spots(world, fr, 60000u, 1u, spots, kMaxStandSpots) == 0);
    // Нулевой запрос и нулевой буфер — ноль.
    CHECK(room_stand_spots(world, fr, first, 1u, spots, 0) == 0);
    CHECK(room_stand_spots(world, fr, first, 1u, nullptr, 4) == 0);

    // ПОРЯДОК — ХЕШЕМ, НЕ ОБХОДОМ: при другой соли первое место хотя бы раз
    // оказывается другой клеткой. Обходной порядок парковал бы всю мебель
    // этажа в младший угол каждой комнаты и читался бы решёткой.
    const int n0 = room_stand_spots(world, fr, first, 1u, spots, 1);
    CHECK(n0 == 1);
    const std::int16_t cx0 = spots[0].cx;
    bool reordered = false;
    for (std::uint32_t s = 2; s < 40 && !reordered; ++s)
        if (room_stand_spots(world, fr, first, s, spots, 1) == 1 &&
            spots[0].cx != cx0)
            reordered = true;
    CHECK(reordered);
}

// ---- 4bis: место ищется у АТОМОВ, а не у типа клетки ---------------------
// ЗАМЕР 2026-11-08, этаж хрущей: 17 100 клеток квартир из 18 810 отлетали
// тестом «клетка не воздух» и НИ ОДНА — отсутствием пола или стены. Причина
// архитектурная: перегородки квартиры — субвоксельные ПОЛОСЫ ВНУТРИ своей же
// клетки (`put_hlayer`), поэтому клетка типизирована «не воздух», оставаясь на
// 90 % воздухом. Мебели вставало 570 из 5700 заказанных; после перехода на
// вопрос к атомам — 4560 и ни одной зоны без места.
//
// Стенд воспроизводит эту архитектуру в миниатюре: клетка с ОДНОЙ полоской
// материи у края. Вернуть тест типу клетки — и этот гейт краснеет.
static void test_spot_asks_atoms_not_cell_type() {
    Registry reg;
    World world;
    FloorRooms fr;
    rooms_reset(fr);

    std::int16_t declared[kVerbCount] = {};
    declared[kVerbSleep] = 30;
    const RoomBox box{90, 90, 30, 1, 1, 1};
    const RoomId id = room_declare(fr, &box, 1, 0, 0, declared);
    CHECK(id != kNoRoom);

    // Пол и стена — полными клетками (они не предмет этой проверки).
    box_with_floor_and_wall(world, 90, 90, 30);
    // А В САМОЙ клетке комнаты — субвоксельная перегородка у края −X:
    // колонка sx = 0 забита на всю высоту. Клетка перестаёт быть «воздухом»
    // по типу, оставаясь на 7/8 воздухом по атомам.
    SubMask& m = world.grid().mask(90, 90, 30);
    for (int sz = 0; sz < kSubDim; ++sz)
        for (int sy = 0; sy < kSubDim; ++sy) m.set(sub_bit(0, sy, sz));
    world.grid().set_cell(90, 90, 30, kMatPlaster);
    CHECK(world.grid().cell(90, 90, 30) != kCellAir); // по типу — «не воздух»
    CHECK(!world.grid().mask(90, 90, 30).full());     // по атомам — есть место

    StandSpot spots[kMaxStandSpots];
    CHECK(room_stand_spots(world, fr, id, 7u, spots, kMaxStandSpots) == 1);

    // ВТОРАЯ ПОЛЯРНОСТЬ: клетка, забитая ЦЕЛИКОМ, местом не считается —
    // «не воздух» и «встать нельзя» наконец разные вопросы с разными ответами.
    world.grid().mask(90, 90, 30).set_all();
    CHECK(world.grid().mask(90, 90, 30).full());
    CHECK(room_stand_spots(world, fr, id, 7u, spots, kMaxStandSpots) == 0);

    // ...И ЭТОТ ОТКАЗ ОБЯЗАН БЫТЬ СВОИМ, А НЕ ПОБОЧНЫМ. На полных клетках
    // опоры и стены забитую клетку отвергают и запросы поверхностей (у
    // заподлицо-грани «воздух перед ней» — это субвоксель СОСЕДА, то есть
    // наш забитый), так что мутация, снявшая проверку, прошла бы зелёной —
    // проверено прогоном. Настоящий отказ нужен на ЛЕПКЕ: когда у опоры и у
    // стены поверхность УТОПЛЕНА внутрь своей клетки, «воздух перед гранью»
    // находится там же, обе пробы проходят, и вещь встала бы ВНУТРИ камня.
    // Такую геометрию и производят скульпт-модули (padic, blame).
    FloorRooms sculpt;
    rooms_reset(sculpt);
    World rock;
    const RoomBox sbox{100, 100, 40, 1, 1, 1};
    const RoomId sid = room_declare(sculpt, &sbox, 1, 0, 0, declared);
    CHECK(sid != kNoRoom);
    // Опора под комнатой: материя в нижней половине клетки, воздух сверху —
    // верхняя грань опоры ЭКСПОНИРОВАНА внутри самой опоры.
    SubMask& floorM = rock.grid().mask(100, 100, 39);
    for (int sz = 0; sz < kSubDim / 2; ++sz)
        for (int sy = 0; sy < kSubDim; ++sy)
            for (int sx = 0; sx < kSubDim; ++sx) floorM.set(sub_bit(sx, sy, sz));
    rock.grid().set_cell(100, 100, 39, kMatConcrete);
    // Стена +Y: материя в ДАЛЬНЕЙ от комнаты половине, воздух в ближней —
    // ближняя грань тоже экспонирована внутри своей клетки.
    SubMask& wallM = rock.grid().mask(100, 101, 40);
    for (int sz = 0; sz < kSubDim; ++sz)
        for (int sy = kSubDim / 2; sy < kSubDim; ++sy)
            for (int sx = 0; sx < kSubDim; ++sx) wallM.set(sub_bit(sx, sy, sz));
    rock.grid().set_cell(100, 101, 40, kMatConcrete);
    // Сама клетка комнаты — КАМЕНЬ ЦЕЛИКОМ.
    rock.grid().mask(100, 100, 40).set_all();
    rock.grid().set_cell(100, 100, 40, kMatConcrete);
    CHECK(room_stand_spots(rock, sculpt, sid, 7u, spots, kMaxStandSpots) == 0);
}

// ---- 3+4 на живом расстановщике: мебель едет по глаголу ------------------
static void test_module_furnishes_by_declared_verb() {
    Registry reg;
    World world;
    FloorRooms fr;
    rooms_reset(fr);

    // Три зоны ОДНОЙ геометрии, отличающиеся только объявленными глаголами:
    // поедет расстановка не по глаголу — наполнятся одинаково.
    // ЧИСЛА ВЫВЕДЕНЫ ИЗ ЖИВОЙ ТАБЛИЦЫ, а не выписаны рукой. Рукописные 30/20/1
    // ломались бы от невинной правки props.csv, а в одном случае МОЛЧА
    // ПЕРЕВОРАЧИВАЛИ бы гейт: скажи строка койки `sleep:1`, и «чулан» со
    // значением 1 стал бы ГОДНЫМ, то есть вторая полярность ниже проверяла бы
    // ровно обратное тому, что обещает.
    const std::int16_t bedS =
        kPropVerbs[static_cast<std::size_t>(PropId::BedCot)][kVerbSleep];
    const std::int16_t panT =
        kPropVerbs[static_cast<std::size_t>(PropId::ToiletPan)][kVerbToilet];
    CHECK(bedS > 1 && panT > 0); // посылки стенда, не гейты
    struct Zone { std::uint8_t x; std::size_t verb; std::int16_t value; };
    const Zone zones[] = {
        {50, kVerbSleep, static_cast<std::int16_t>(bedS + 1)},  // спальня
        {60, kVerbToilet, panT},                                // санузел
        {70, kVerbSleep, static_cast<std::int16_t>(bedS - 1)},  // чулан: слабо
    };
    RoomId ids[3] = {};
    for (int zi = 0; zi < 3; ++zi) {
        const Zone& z = zones[zi];
        std::int16_t declared[kVerbCount] = {};
        declared[z.verb] = z.value;
        const RoomBox b{z.x, 50, 20, 2, 1, 1};
        ids[zi] = room_declare(fr, &b, 1, 0, 0, declared);
        CHECK(ids[zi] != kNoRoom);
        for (int dx = 0; dx < 2; ++dx)
            box_with_floor_and_wall(world, z.x + dx, 50, 20);
    }

    const FloorSpec& spec = floor_spec(FloorKind::Khrushi);
    const std::uint32_t n = khrushi_place(FloorPlaceCtx{
        reg, world, fr, spec, /*layer=*/7, /*number=*/6, /*seed=*/0x5EEDu,
        /*tick=*/0});
    CHECK(n > 0u);

    // ОТБОР ПО КОМНАТЕ И СЛОЮ, а не по голой позиции: «вещь попала в
    // НАЗВАННУЮ зону» — ровно то, что тест обещает, и ровно то, что окно по
    // координатам НЕ говорит. Побочно это снимает немую посылку «городской
    // обвес хрущей в голом мире весь отказал»: поднимись столб на клетку —
    // и уличный фонарь посчитался бы мебелью спальни, а красным стал бы не
    // дефект, а ложь стенда.
    auto props_in_room = [&](RoomId id) {
        std::vector<PropId> out;
        for (auto e : reg.view<const Transform, const PropOf>()) {
            const Transform& t = reg.get<const Transform>(e);
            if (t.layer != 7) continue;
            const int cx = static_cast<int>(std::floor(t.pos.x / kCellSize));
            const int cy = static_cast<int>(std::floor(t.pos.y / kCellSize));
            const int cz = static_cast<int>(std::floor(t.pos.z / kCellSize));
            if (room_at(fr, cx, cy, cz) == id)
                out.push_back(reg.get<const PropOf>(e).id);
        }
        return out;
    };
    const std::vector<PropId> bedroom = props_in_room(ids[0]);
    const std::vector<PropId> bath = props_in_room(ids[1]);
    const std::vector<PropId> closet = props_in_room(ids[2]);

    auto has = [](const std::vector<PropId>& v, PropId id) {
        for (PropId p : v) if (p == id) return true;
        return false;
    };
    CHECK(has(bedroom, PropId::BedCot));
    CHECK(has(bath, PropId::ToiletPan));
    CHECK(!has(bath, PropId::BedCot)); // санузел «спать» не объявлял вовсе
    // ВТОРАЯ ПОЛЯРНОСТЬ ПОРОГА НА ЖИВОМ РАССТАНОВЩИКЕ, и она СИЛЬНЕЕ, чем
    // «чулан пуст»: чулан объявил тот же глагол `sleep`, что и спальня, но
    // СЛАБЕЕ койки — и койки там нет, ЗАТО ЕСТЬ ДИВАН, который даёт меньше и
    // потому проходит. Один глагол, две вещи, разный вердикт — значит порог
    // считается ПО ВЕЩИ, а не по комнате, и никакой «вид комнаты» в решении
    // не участвует. (Прежняя формулировка «чулан пуст» сломалась от первой же
    // новой строки props.csv — и правильно сделала.)
    CHECK(!has(closet, PropId::BedCot));
    CHECK(has(closet, PropId::Sofa));
    CHECK(kPropVerbs[static_cast<std::size_t>(PropId::Sofa)][kVerbSleep] <
          kPropVerbs[static_cast<std::size_t>(PropId::BedCot)][kVerbSleep]);
}

// ---- 5: диспатч — строка, ноль приходит из модуля ------------------------
static void test_dispatch_is_a_row() {
    Registry reg;
    World world;
    FloorRooms fr;
    rooms_reset(fr);
    // Одна и та же годная зона: хрущи её обставят, блейм — нет, и разница
    // приходит СТРОКОЙ `kContentPlacers`, а не веткой по виду этажа.
    std::int16_t declared[kVerbCount] = {};
    declared[kVerbSleep] = 30;
    const RoomBox b{80, 80, 20, 1, 1, 1};
    CHECK(room_declare(fr, &b, 1, 0, 0, declared) != kNoRoom);
    box_with_floor_and_wall(world, 80, 80, 20);

    // ТАБЛИЦА СУДИТСЯ КАК ТАБЛИЦА: у КАЖДОГО вида этажа есть свой
    // расстановщик, и ни один не падает. Прежде тест сверял `blame_place` (то
    // есть `return 0;`) с нулём — проверка константы, которая не покраснела
    // бы и на `if (kind == Khrushi) … else return 0;` вместо диспатча.
    // Порядок строк прибит В КОМПИЛЯЦИИ (`GIGA_TABLE_BY_ENUM`), поэтому
    // перестановка не краснеет, а не собирается; здесь судится ПОЛНОТА.
    for (std::size_t k = 0; k < static_cast<std::size_t>(FloorKind::Count);
         ++k) {
        const FloorSpec& sp = floor_spec(static_cast<FloorKind>(k));
        CHECK(sp.kind == static_cast<FloorKind>(k)); // строка каталога своя
        const LayerId lay = static_cast<LayerId>(20 + k);
        const std::uint32_t n = floor_place_content(
            FloorPlaceCtx{reg, world, fr, sp, lay, 6, 7u, 0});
        // Счёт расстановщика покрывает ВСЁ, что он родил, — и вещи, и мобов
        // (хрущи сажают по мобу на крышу). Сверка только с пропами молча
        // разошлась бы в тот день, когда модуль добавит мобов, и прочиталась
        // бы как дефект диспатча.
        CHECK(n == static_cast<std::uint32_t>(layer_props(reg, lay)) +
                       count_layer_mobs(reg, lay));
    }

    // И РАЗНИЦА МЕЖДУ МОДУЛЯМИ НА ОДНОЙ И ТОЙ ЖЕ ЗОНЕ: мегаструктура
    // отвечает нулём ИЗ СВОЕГО ФАЙЛА, хрущи обставляют.
    const FloorSpec& blameSpec = floor_spec(FloorKind::Blame);
    CHECK(floor_place_content(
              FloorPlaceCtx{reg, world, fr, blameSpec, 8, -26, 7u, 0}) == 0u);
    CHECK(layer_props(reg, 8) == 0);

    const FloorSpec& khSpec = floor_spec(FloorKind::Khrushi);
    CHECK(floor_place_content(
              FloorPlaceCtx{reg, world, fr, khSpec, 9, 6, 7u, 0}) > 0u);
    CHECK(layer_props(reg, 9) > 0);
}

// ---- 6: МОБ — ТА ЖЕ ДВЕРЬ, И ТИК ДОЕЗЖАЕТ ДО ОКНА ------------------------
// Поле `tick` завелось в контексте ВМЕСТЕ с этим читателем. Гейт судит две
// вещи, и вторая важнее первой:
//   * модуль ставит мобов по СВОЕМУ условию (у хрущей — по мобу на крышу), и
//     счёт сходится с числом крыш, которое отдаёт план модуля;
//   * ТИК ИЗ КОНТЕКСТА ДОЕЗЖАЕТ ДО ОКНА ДЕЙСТВИЯ (CANON S22): окно `maul`
//     открыто в момент посева, и его `startTick` обязан прийти из `ctx.tick`,
//     а не из нуля. Передай хук ноль вместо живого тика — моб родится с
//     окном «из прошлого», и шахматный сдвиг первого темпа схлопнется.
static void test_module_places_mobs_with_live_tick() {
    Registry reg;
    World world;
    FloorRooms fr;
    rooms_reset(fr);
    const FloorSpec& spec = floor_spec(FloorKind::Khrushi);
    const unsigned seed = 0x4242u;
    const int number = kKhrushiFloorNumber;
    generate_khrushi_floor(world, number, spec, seed);
    khrushi_rooms(number, seed, fr);

    std::vector<KhrushiRoof> roofs;
    const std::uint32_t nRoofs = khrushi_roofs(seed, number, roofs);
    CHECK(nRoofs > 0u);                              // план знает свои крыши
    CHECK(roofs.size() == static_cast<std::size_t>(nRoofs)); // контракт append

    const LayerId layer = 11;
    const std::uint64_t tick = 777u;
    khrushi_place(FloorPlaceCtx{reg, world, fr, spec, layer, number, seed,
                                tick});

    // По мобу на крышу — ровно столько, сколько крыш у плана.
    CHECK(count_layer_mobs(reg, layer) == nRoofs);

    // ...и КАЖДЫЙ несёт окно, открытое ЭТИМ тиком.
    int withWindow = 0;
    for (auto e : reg.view<const MobRef, const Transform, const Acting>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        const ActWindow& w = act_slot(reg.get<const Acting>(e), ActSlot::Body);
        CHECK(w.startTick == tick);
        ++withWindow;
    }
    CHECK(withWindow == static_cast<int>(nRoofs));

    // ...И КАЖДЫЙ СТОИТ НА СВОЕЙ КРЫШЕ, а не «где-то на этаже»: клетка z
    // обязана совпасть с ходовой клеткой над плитой, которую назвал план.
    int onRoofZ = 0;
    for (auto e : reg.view<const MobRef, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        const int cz = static_cast<int>(std::floor(t.pos.z / kCellSize));
        for (const KhrushiRoof& rf : roofs)
            if (cz == rf.z) { ++onRoofZ; break; }
    }
    CHECK(onRoofZ == static_cast<int>(nRoofs));
}

} // namespace content_suite

static void test_content_all() {
    content_suite::test_content_refuses_without_support();
    content_suite::test_content_wall_and_hang_anchor_their_support();
    content_suite::test_prop_fits_room_threshold_both_ways();
    content_suite::test_room_stand_spots_respect_ownership();
    content_suite::test_spot_asks_atoms_not_cell_type();
    content_suite::test_module_furnishes_by_declared_verb();
    content_suite::test_dispatch_is_a_row();
    content_suite::test_module_places_mobs_with_live_tick();
}
