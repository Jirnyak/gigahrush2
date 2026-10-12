// СИНТЕТИЧЕСКИЙ НАВ ПО ЗОНАМ ДЛЯ ТЕСТОВ — два фикстура, и оба суть ПЕРЕВОД
// готовых приёмов решётки, а не новые изобретения.
//
// Шаг агента по зонам есть ДВА ЧТЕНИЯ ([game/zone_nav.h]): таблица даёт соседку
// на пути к цели, плоскость соседки даёт направление. Подделать надо РОВНО их,
// поэтому настоящий бейк этажа здесь не нужен — а он стоил бы секунд BFS и
// сотен МиБ, ровно как `bake_fine` у решётки (довод `arm_nav@suite_place.inl`).
// Массивы `ZoneNav` публичные, и это не дыра в инкапсуляции, а то, чем уже
// пользуется блок патруля в `suite_utilai.inl`.
//
// ПОЧЕМУ ФАЙЛ ОБЩИЙ. Проход прогулки обходят СЕМЬ сюит (`suite_behaviours`,
// `suite_packs`, `suite_hunt`, `suite_noise`, `suite_utilai`,
// `suite_gravity_regimes`, плюс `game_test.cpp` сам), и у решётки каждая строила
// свой вырожденный бейк руками. Семь копий одной фикстуры — это семь мест, где
// перевод на зоны мог разойтись, и именно там красный тест перестал бы говорить,
// которая из семи.
#pragma once

namespace zone_fixture {

// ОДНА ЗОНА НА ВЕСЬ ТОР, И ИДТИ НЕКУДА — перевод ВЫРОЖДЕННОГО бейка решётки
// (`fine.flow` целиком из `kFlowNone`), и переводится он вместе со своим
// доводом, записанным в шапке `suite_behaviours.inl`: при настоящем бейке моб,
// который НЕ гонится, всё равно получает шаг, и «гнался ли он?» пришлось бы
// выводить из направления — а оно случайно совпадает с направлением на игрока.
// Здесь у тела зона ЕСТЬ (значит `offnav` не срабатывает и проход доходит до
// выбора цели), но достижимых ЧУЖИХ зон нет ни одной, поэтому непогонное тело
// получает владеемый ноль. `|v| > 0` означает «этот моб решил гнаться» и больше
// ничего.
//
// `zones.built()` требует все четыре массива, включая поле: степень зоны ноль,
// но плоскость обязана существовать, иначе проход примет бейк за непостроенный
// и вернётся на первой строке — то есть тест мерил бы пустоту (§85).
inline void arm_zones_one(giga::game::ZoneNav& zn) {
    using namespace giga;
    zn = game::ZoneNav{};
    zn.part.zones = 1;
    zn.part.at.assign(kMacroCells, static_cast<RoomId>(1));
    // `cells` обязателен: из него бейк выводит поперечник зоны, а из
    // поперечника — перевод бюджета ноги из МЕТРОВ в прыжки
    // ([game/zone_nav.h] `zone_hops_for_metres`). Фикстура, оставившая его
    // нулём, молча получила бы бюджет в один прыжок и мерила бы не то.
    zn.part.cells = static_cast<std::uint32_t>(kMacroCells);
    zn.graph.zones = 1;
    zn.graph.offset = {0u, 0u};  // степень ноль: соседок нет
    zn.graph.nbr.clear();
    zn.dist.zones = 1;
    zn.dist.d = {0};
    zn.flow.planes = 1;
    zn.flow.dir.assign(kMacroCells, game::kZoneFlowNone);
}

// ДВЕ ЗОНЫ, ГРАНИЦА ПО x == 48, ПОЛЕ ГОВОРИТ «+x» В КАЖДОЙ КЛЕТКЕ — перевод
// `fill_flow_plus_x@suite_utilai.inl`, дословно с той же целью: тело обязано
// взять ОБЫЧНУЮ горизонтальную ветку и записать НЕнулевую скорость.
//
// Расстояние между зонами ровно 1, то есть внутри ЛЮБОГО бюджета ноги (минимум
// бюджета — один прыжок, [game/zone_nav.h] `zone_hops_for_metres`). Иначе
// фикстура мерила бы предел дальности под именем шага.
//
// «+x» законно и для зоны 2: по тору шаг +x из x=100 доходит до 127 и
// заворачивается в x=0, то есть в зону 1. Фикстура не врёт геометрией — она
// просто мельче настоящей.
inline void arm_zones_plus_x(giga::game::ZoneNav& zn) {
    using namespace giga;
    zn = game::ZoneNav{};
    zn.part.zones = 2;
    zn.part.at.assign(kMacroCells, static_cast<RoomId>(1));
    zn.part.cells = static_cast<std::uint32_t>(kMacroCells); // см. довод выше
    for (int cz = 0; cz < kMacroDim; ++cz)
        for (int cy = 0; cy < kMacroDim; ++cy)
            for (int cx = 48; cx < kMacroDim; ++cx)
                zn.part.at[macro_index(cx, cy, cz)] = static_cast<RoomId>(2);
    zn.graph.zones = 2;
    zn.graph.offset = {0u, 1u, 2u};
    zn.graph.nbr = {static_cast<RoomId>(2), static_cast<RoomId>(1)};
    zn.dist.zones = 2;
    zn.dist.d = {0, 1, 1, 0};
    zn.flow.planes = 1;
    zn.flow.dir.assign(kMacroCells, 1);  // слот 0 = соседка, kNavDir[1] = +x
}

} // namespace zone_fixture
