// Запрос поверхностей ([world/surface.h]) — примитив S10: экспонированные
// субвоксельные грани, из которых сидеры выводят позицию, якорь и пробу.
// Included into world_test.cpp after its CHECK macro and `using namespace`.

#include "world/surface.h"

static void test_surface_full_wall_face() {
    World w;
    MacroGrid& g = w.grid();
    g.fill_cell(10, 10, 10, 3); // сплошная опора, сосед (11,10,10) — воздух

    // Восточная грань (нормаль +X): все 64 колонки экспонированы, поверхность
    // заподлицо (слой 7 при dir > 0), представитель — у центра грани.
    const SurfaceFace f = surface_face_at(g, 10, 10, 10, anchor_face_pack(0, 1));
    CHECK(f.columns == 64);
    CHECK(f.layer == 7);
    CHECK(f.su >= 3 && f.su <= 4);
    CHECK(f.sv >= 3 && f.sv <= 4);
    // Согласованность с пробой якоря: представительная колонка обязана жить.
    CHECK(anchor_alive(g, f.cx, f.cy, f.cz, f.face, f.su, f.sv));

    // Западная грань (нормаль -X): та же площадь, слой 0.
    const SurfaceFace fw = surface_face_at(g, 10, 10, 10, anchor_face_pack(0, -1));
    CHECK(fw.columns == 64);
    CHECK(fw.layer == 0);
}

static void test_surface_recessed_and_sealed() {
    World w;
    MacroGrid& g = w.grid();
    g.fill_cell(20, 10, 10, 3);

    // Утопить восточную поверхность на 2 субвокселя: снять слои x=7 и x=6.
    for (int sy = 0; sy < kSubDim; ++sy)
        for (int sz = 0; sz < kSubDim; ++sz) {
            g.mask(20, 10, 10).clear(sub_bit(7, sy, sz));
            g.mask(20, 10, 10).clear(sub_bit(6, sy, sz));
        }
    const SurfaceFace f = surface_face_at(g, 20, 10, 10, anchor_face_pack(0, 1));
    CHECK(f.columns == 64);
    CHECK(f.layer == 5); // реальная поверхность, не граница клетки

    // Запечатать грань второй твёрдой клеткой — грань стала внутренней.
    g.fill_cell(21, 10, 10, 3);
    const SurfaceFace fs = surface_face_at(g, 20, 10, 10, anchor_face_pack(0, 1));
    // Утопленные колонки ЖИВЫ (перед ними воздух своей клетки), заподлицо —
    // мертвы; здесь утоплены все 64, значит все экспонированы. Проверяем обе
    // ветки экспозиции на соседней паре: полная против полной.
    CHECK(fs.columns == 64);
    g.fill_cell(30, 10, 10, 3);
    g.fill_cell(31, 10, 10, 3);
    const SurfaceFace fi = surface_face_at(g, 30, 10, 10, anchor_face_pack(0, 1));
    CHECK(fi.columns == 0); // заподлицо и запечатано — поверхности нет

    // Пустая клетка — поверхности нет.
    const SurfaceFace fe = surface_face_at(g, 40, 10, 10, anchor_face_pack(0, 1));
    CHECK(fe.columns == 0);
}

static void test_surface_off_centre_representative_and_z() {
    World w;
    MacroGrid& g = w.grid();
    // Материя только в углу клетки: колонки (0..1, 0..1) по Z-нижней грани.
    for (int sx = 0; sx < 2; ++sx)
        for (int sy = 0; sy < 2; ++sy)
            for (int sz = 0; sz < kSubDim; ++sz)
                g.mask(50, 10, 10).set(sub_bit(sx, sy, sz));
    g.set_cell(50, 10, 10, 3);

    // Нижняя грань (нормаль -Z, потолок над воздухом): 4 экспонированные
    // колонки, представитель — ближайшая к центру из них, (1,1).
    const SurfaceFace f = surface_face_at(g, 50, 10, 10, anchor_face_pack(2, -1));
    CHECK(f.columns == 4);
    CHECK(f.su == 1 && f.sv == 1);
    CHECK(f.layer == 0);
    CHECK(anchor_alive(g, f.cx, f.cy, f.cz, f.face, f.su, f.sv));

    // Обход по всему тору находит ровно эту грань (ось Z, знак -1).
    int found = 0;
    for_each_surface(g, 2, -1, [&](const SurfaceFace& sf) {
        if (sf.cx == 50 && sf.cy == 10 && sf.cz == 10) ++found;
    });
    CHECK(found == 1);
}

static void test_surface_all() {
    test_surface_full_wall_face();
    test_surface_recessed_and_sealed();
    test_surface_off_centre_representative_and_z();
}
