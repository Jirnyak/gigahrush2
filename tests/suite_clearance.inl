// Гранный клиренс — закон проходимости от размера ([world/clearance.h], S2
// «волна 3»). Включается в world_test.cpp: его CHECK, using namespace giga.
//
// Пины держат три утверждения закона:
//  1. МАКС-КВАДРАТ эрозией считает то, что обещает (углы, прямоугольники,
//     заворот колонок между рядами u64 — классическая яма сдвига на 1);
//  2. ГРАНЬ видит стену в ЛЮБОМ месте своей половины (и на плоскости грани,
//     и посреди клетки — то, к чему слеп и клеточный `!full()`, и проекция
//     одной граничной плоскости), но НЕ видит дальнюю половину — иначе
//     запирались бы повороты коридоров;
//  3. ПАТЧ == РЕБИЛД в обе полярности (карв открывает, налив закрывает) — и
//     на шве тора: писатель платит и минус-соседям.

#include "world/clearance.h"
#include "world/macro_grid.h"
#include "world/types.h"

namespace clearance_test {

// Битмап 8×8 из прямоугольника [u0,u1]×[v0,v1] — руками, не через код модуля.
inline std::uint64_t rect(int u0, int u1, int v0, int v1) {
    std::uint64_t b = 0;
    for (int v = v0; v <= v1; ++v)
        for (int u = u0; u <= u1; ++u)
            b |= std::uint64_t{1} << (u + v * 8);
    return b;
}

// Маска с одним сплошным бруском [x0,x1]×[y0,y1]×[z0,z1] в субвокселях.
inline SubMask slab(int x0, int x1, int y0, int y1, int z0, int z1) {
    SubMask m;
    for (int sz = z0; sz <= z1; ++sz)
        for (int sy = y0; sy <= y1; ++sy)
            for (int sx = x0; sx <= x1; ++sx)
                m.set(sub_bit(sx, sy, sz));
    return m;
}

inline void vox(SubMask& m, int sx, int sy, int sz) { m.set(sub_bit(sx, sy, sz)); }

} // namespace clearance_test

static void test_clearance_max_square() {
    using clearance_test::rect;
    CHECK(max_square(0) == 0);
    CHECK(max_square(~std::uint64_t{0}) == 8);
    CHECK(max_square(std::uint64_t{1} << 63) == 1);       // одинокий угол
    CHECK(max_square(rect(2, 5, 1, 4)) == 4);             // квадрат 4×4
    CHECK(max_square(rect(0, 7, 3, 5)) == 3);             // лента 8×3 — узкое место
    CHECK(max_square(rect(5, 7, 0, 7)) == 3);             // лента 3×8, вдоль другой оси
    // Заворот колонок: биты у правого края (u=7) НЕ должны склеиваться с u=0
    // следующего ряда — две вертикальные ленты шириной 1 на противоположных
    // краях дают 1, а не 2.
    CHECK(max_square(rect(7, 7, 0, 7) | rect(0, 0, 0, 7)) == 1);
    // Квадрат с выбитым центром: 4×4 минус (3,3) — остаётся 2.
    CHECK(max_square(rect(2, 5, 2, 5) & ~(std::uint64_t{1} << (3 + 3 * 8))) == 2);
}

static void test_clearance_face_law() {
    using clearance_test::slab;
    const SubMask air; // пустая маска

    // Воздух над воздухом — полный просвет по всем трём осям (и это ось-
    // изотропно, S1: одна и та же восьмёрка на x, y, z).
    for (int axis = 0; axis < 3; ++axis)
        CHECK(face_clearance(air, air, axis) == 8);

    // Глухая плита НА ПЛОСКОСТИ ГРАНИ (верхний слой A): переход +z глух...
    const SubMask lid = slab(0, 7, 0, 7, 7, 7);
    CHECK(face_clearance(lid, air, 2) == 0);
    // ...переход снизу В эту клетку свободен (плита — в дальней половине для
    // нижней грани), а вбок плита срезает ровно один ряд: 7.
    CHECK(face_clearance(air, lid, 2) == 8);
    CHECK(face_clearance(lid, air, 0) == 7);
    CHECK(face_clearance(air, lid, 1) == 7);

    // СТЕНА ПОСРЕДИ КЛЕТКИ (слаб sx=3, вся плоскость yz) — то самое место,
    // где клеточный `!full()` отвечал «открыто» (клетка на 7/8 воздух), а нав
    // вёл толпу сквозь стену. Ближняя половина -x грани её видит: 0.
    const SubMask midwall = slab(3, 3, 0, 7, 0, 7);
    CHECK(!midwall.full()); // старый закон эту стену не видел вовсе
    CHECK(face_clearance(air, midwall, 0) == 0);
    // Дальняя для +x грани половина её НЕ видит — и не должна: тело,
    // вошедшее с востока, поворачивает, не дойдя до неё (повороты коридоров).
    CHECK(face_clearance(midwall, air, 0) == 8);
    // Поперёк стены (ось y): столбец sx=3 занят на всю высоту — воздух лежит
    // лентами шириной 3 (sx 0..2) и 4 (sx 4..7): макс-квадрат 4.
    CHECK(face_clearance(air, midwall, 1) == 4);
    CHECK(face_clearance(midwall, air, 1) == 4);

    // ПРОЁМ: глухая стена sx=4..5 с окном 4×4 (sy 2..5, sz 2..5) — переход
    // ровно с габарит окна. Тело 4 пролезает, 5 — нет.
    SubMask doorway = slab(4, 5, 0, 7, 0, 7);
    for (int sz = 2; sz <= 5; ++sz)
        for (int sy = 2; sy <= 5; ++sy) {
            doorway.clear(sub_bit(4, sy, sz));
            doorway.clear(sub_bit(5, sy, sz));
        }
    CHECK(face_clearance(doorway, air, 0) == 4);

    // Окно у КРАЯ грани (прижато к углу sy=0,sz=0) — скользящий квадрат, не
    // центрированный: старый телесный предикат комнат требовал центра.
    SubMask corner_hole = slab(4, 7, 0, 7, 0, 7);
    for (int sz = 0; sz <= 3; ++sz)
        for (int sy = 0; sy <= 3; ++sy)
            for (int sx = 4; sx <= 7; ++sx)
                corner_hole.clear(sub_bit(sx, sy, sz));
    CHECK(face_clearance(corner_hole, air, 0) == 4);

    // Стена в СОСЕДЕ тоже считается: обе половины окна перехода — из двух
    // клеток, и атом с любой стороны грани режет один и тот же просвет.
    CHECK(face_clearance(air, slab(0, 0, 0, 7, 0, 7), 0) == 0);
}

static void test_clearance_field_patch_is_rebuild() {
    using clearance_test::vox;
    MacroGrid g;
    // Пол-плита на слое субвокселей sz=7 клетки (40,40,39) — потолок под
    // клеткой (40,40,40); стенка посреди клетки (41,40,40).
    g.set_cell(40, 40, 39, kMatConcrete);
    for (int sy = 0; sy < 8; ++sy)
        for (int sx = 0; sx < 8; ++sx) vox(g.mask(40, 40, 39), sx, sy, 7);
    g.set_cell(41, 40, 40, kMatConcrete);
    for (int sz = 0; sz < 8; ++sz)
        for (int sy = 0; sy < 8; ++sy) vox(g.mask(41, 40, 40), 2, sy, sz);
    // И материя на шве тора: ЗАПАДНАЯ половина клетки x=0 — ближняя половина
    // перехода 127→0, он обязан её видеть.
    g.set_cell(0, 50, 50, kMatConcrete);
    for (int sz = 0; sz < 8; ++sz)
        for (int sy = 0; sy < 8; ++sy)
            for (int sx = 0; sx < 4; ++sx) vox(g.mask(0, 50, 50), sx, sy, sz);

    ClearanceField f;
    f.build(g);
    CHECK(f.built());

    // Чтение через at(): порядок направлений нава -x,+x,-y,+y,-z,+z.
    CHECK(f.at(40, 40, 40, 4) == 0);   // вниз — плита в верхней половине 39-й
    CHECK(f.at(40, 40, 39, 5) == 0);   // тот же переход с другой стороны
    CHECK(f.at(40, 40, 40, 5) == 8);   // вверх — воздух
    CHECK(f.at(40, 40, 40, 1) == 0);   // на восток — стенка в ближней половине
    CHECK(f.at(42, 40, 40, 0) == 8);   // с востока — стенка в дальней половине
    CHECK(f.at(127, 50, 50, 1) == 0);  // шов тора: материя в клетке x=0
    CHECK(f.at(0, 50, 50, 1) == 8);    // а её восточный выход свободен

    // ПАТЧ == РЕБИЛД, полярность «карв открывает»: прорубаем в стенке окно
    // 4×4 и зовём patch только для изменённой клетки.
    for (int sz = 2; sz <= 5; ++sz)
        for (int sy = 2; sy <= 5; ++sy)
            g.mask(41, 40, 40).clear(sub_bit(2, sy, sz));
    f.patch(g, 41, 40, 40);
    CHECK(f.at(40, 40, 40, 1) == 4); // сосед узнал: его +x нибл жил в (40,..)

    // Полярность «налив закрывает»: заливаем клетку (40,40,40) целиком.
    g.fill_cell(40, 40, 40, kMatConcrete);
    f.patch(g, 40, 40, 40);
    CHECK(f.at(40, 40, 40, 1) == 0);
    CHECK(f.at(40, 40, 40, 5) == 0);
    CHECK(f.at(39, 40, 40, 1) == 0); // минус-сосед по x узнал от патча

    // И финальная сверка целиком: поле после патчей == поле, собранное с нуля.
    ClearanceField fresh;
    fresh.build(g);
    CHECK(fresh.vals == f.vals);
}

static void test_clearance_all() {
    test_clearance_max_square();
    test_clearance_face_law();
    test_clearance_field_patch_is_rebuild();
    std::printf("[clearance] макс-квадрат, закон грани, патч==ребилд\n");
}
