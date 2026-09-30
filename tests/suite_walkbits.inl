// Оракул тяжёлых бейков — гранный клиренс нава — и два утверждения, на которых
// стоит async-rebake phase C.
//
// ТЕЛЕСНАЯ ПОЛОВИНА СНЕСЕНА 2026-09-30 вместе со своим предметом:
// `WalkBits` ([world/walk_bits.h]) и `game/body_walk.*` не имели в `src/` ни
// одного читателя, кроме щупа застревания под `GIGA_SOAK`, а их объявленный
// будущий потребитель — agent-goals — закрыт тем же решением владельца.
// Блоки удалены, а не закомментированы: тест, переживший свой предмет, — это
// будущая вторая реализация.
//
// Included into game_test.cpp, so it uses that file's CHECK macro and its
// `using namespace giga` / `using namespace giga::game`. Everything except the
// entry point `test_walkbits_all()` lives in `namespace walkbits_test`.
//
// Планировщик фонового допекания держит у воркера СНАПШОТ оракула по значению
// (клиренс-поле 4 МиБ + телесный битсет 256 КиБ), не указатель в живой грид.
// Подстановка законна тогда и только тогда, когда:
//
//   1. БИТ-ИДЕНТИЧНОСТЬ: бейк через оракул даёт байт-в-байт результат бейка
//      через грид — edge/dist/next, flow, nearest. Эталонный оракул построен
//      ЗДЕСЬ, руками, из
//      законов, переписанных в этом файле НЕЗАВИСИМО от продакшн-кода (для
//      клиренса — наивные циклы по субвокселям, без бит-магии): дрейф закона
//      ломает этот сьют, а не молча переопределяет, что такое стена.
//      Продакшн-строители сверяются С эталоном — то же утверждение с другого
//      конца.
//
//   2. ПАТЧ == РЕБИЛД: O(1)-патч клетки (дренаж dirtyCells) оставляет оракул
//      ровно в состоянии полной пересборки — в обе полярности (карв открывает,
//      заливка закрывает), на настоящем лепленом этаже.
//
// Сюда же — пин §60/К1-10 (эпик occupancy): прежний нав-закон `!full()`
// открывал клетку по одному выбитому атому из 512; гранный клиренс обязан
// НЕ открыться на одном атоме — это дословно та «дыра», через которую
// флоу-поля вели толпу сквозь лепленые стены.
//
// One real floor, generated once and shared: the mutation test runs LAST
// because it carves the world the identity tests measured.
#include <cstring>

#include "game/floor_gen.h"   // generate_floor — a real carved floor, not a toy
#include "game/floor_spec.h"  // FloorKind, floor_spec
#include "world/clearance.h"  // ClearanceField — нав-оракул (occupancy)
#include "world/macro_grid.h" // SubMask — the mutation test carves masks directly
#include "world/nav.h"        // bake_coarse/bake_fine
#include "world/types.h"      // kMacroDim, kMacroCells, macro_index
#include "world/world.h"

namespace walkbits_test {

// memcmp над CoarseGraph законен ровно потому, что в структуре нет дырок: три
// плотно упакованных массива 2- и 1-байтовых типов, 768 + 8192 + 4096 = 13056,
// чётно, значит и хвостового выравнивания нет. Утверждение переехало сюда
// 2026-09-30 из снесённого `nav_cache.cpp` — к своему единственному
// оставшемуся потребителю. Появится ли четвёртый член или появится ли padding —
// оба случая ловятся здесь, ДО того как сверка байтов начнёт врать.
static_assert(sizeof(nav::CoarseGraph::edge) + sizeof(nav::CoarseGraph::dist) +
                      sizeof(nav::CoarseGraph::next) == sizeof(nav::CoarseGraph),
              "CoarseGraph обзавёлся членом или дыркой — memcmp ниже больше не "
              "сравнивает то, что думает, что сравнивает");
static_assert(sizeof(nav::CoarseGraph) == 13056u,
              "768 + 8192 + 4096 при kNodes == 64");

// Законы, переписанные НЕЗАВИСИМО от продакшн-хелперов (clearance.cpp,
// room_zone.cpp). Сьют, строящий эталон вызовом кода под тестом, доказал бы
// лишь согласие кода с самим собой; эти функции — контракт, записанный
// дважды, и потому дрейф предиката — красный тест, а не переопределение.

// Гранный клиренс наивно: максимум s, при котором найдётся квадрат s×s
// тангенциальных колонок, чистых от материи в БЛИЖНИХ К ГРАНИ половинах обеих
// клеток (переход через +axis-грань клетки (x,y,z)). Никакой бит-магии:
// четыре вложенных цикла и SubMask::test.
inline bool ref_col_clear(const SubMask& m, int axis, int u, int v, int d) {
    // Раскладка (u,v) как в законе: x->(sy,sz), y->(sx,sz), z->(sx,sy);
    // d — глубина вдоль оси перехода.
    const int sx = axis == 0 ? d : u;
    const int sy = axis == 0 ? u : (axis == 1 ? d : v);
    const int sz = axis == 2 ? d : v;
    return !m.test(sub_bit(sx, sy, sz));
}
inline int ref_face_clearance(const MacroGrid& g, int x, int y, int z,
                              int axis) {
    const SubMask& a = g.mask(x, y, z);
    const SubMask& b = g.mask(axis == 0 ? x + 1 : x, axis == 1 ? y + 1 : y,
                              axis == 2 ? z + 1 : z); // mask() заворачивает
    auto clear = [&](int u, int v) {
        for (int d = kSubDim / 2; d < kSubDim; ++d) // ближняя к грани половина A
            if (!ref_col_clear(a, axis, u, v, d)) return false;
        for (int d = 0; d < kSubDim / 2; ++d)       // ближняя половина B
            if (!ref_col_clear(b, axis, u, v, d)) return false;
        return true;
    };
    int best = 0;
    for (int s = 1; s <= kSubDim; ++s) {
        bool found = false;
        for (int v0 = 0; v0 + s <= kSubDim && !found; ++v0)
            for (int u0 = 0; u0 + s <= kSubDim && !found; ++u0) {
                bool ok = true;
                for (int v = v0; v < v0 + s && ok; ++v)
                    for (int u = u0; u < u0 + s && ok; ++u)
                        ok = clear(u, v);
                found = ok;
            }
        if (!found) break;
        best = s;
    }
    return best;
}

void nav_bake_through_field_is_bit_identical(const World& w) {
    // The grid path — the entry every synchronous caller still uses. Габарит
    // — тело NPC (kBodyClearanceSub, вывод в [game/embody.h]).
    nav::CoarseGraph g1;
    nav::bake_coarse(w.grid(), kBodyClearanceSub, g1);
    nav::FineNav f1;
    nav::bake_fine(w.grid(), kBodyClearanceSub, f1);

    // Продакшн-поле против наивного эталона — на детерминированной выборке
    // клеток (полный этаж наивным законом — минуты; выборка держит и дрейф,
    // и все три оси). Шаг 037 взаимно прост с 128, так что выборка обходит
    // все остатки по каждой оси, а не полосу.
    ClearanceField field;
    field.build(w.grid());
    int checked = 0, mismatched = 0;
    for (std::size_t i = 0; i < kMacroCells; i += 37) {
        const int x = static_cast<int>(i % kMacroDim);
        const int y = static_cast<int>((i / kMacroDim) % kMacroDim);
        const int z = static_cast<int>(i / (kMacroDim * kMacroDim));
        for (int axis = 0; axis < 3; ++axis) {
            const int prod = face_clearance_at(w.grid(), x, y, z, axis);
            if (prod != ref_face_clearance(w.grid(), x, y, z, axis))
                ++mismatched;
            // И то же значение обязано лежать в построенном поле (нибл
            // +axis-грани = at() с плюс-направлением 2*axis+1).
            if (field.at(x, y, z, 2 * axis + 1) != prod) ++mismatched;
            ++checked;
        }
    }
    CHECK(mismatched == 0);
    CHECK(checked >= 3 * static_cast<int>(kMacroCells / 37)); // выборка не съёжилась

    // And the oracle bakes must reproduce the grid bakes byte for byte.
    // memcmp over CoarseGraph is safe because the struct is padding-free —
    // это утверждал static_assert в снесённом nav_cache.cpp, поэтому он
    // переехал сюда, к своему единственному оставшемуся потребителю.
    nav::CoarseGraph g2;
    nav::bake_coarse(field, kBodyClearanceSub, g2);
    CHECK(std::memcmp(&g1, &g2, sizeof(nav::CoarseGraph)) == 0);

    nav::FineNav f2;
    nav::bake_fine(field, kBodyClearanceSub, f2);
    CHECK(f1.flow == f2.flow);
    CHECK(f1.nearest == f2.nearest);
    // Not an empty-vs-empty accident: the floor really produced fields.
    CHECK(f1.flow.size() == static_cast<std::size_t>(nav::kNodes) * kMacroCells);
    CHECK(f1.nearest.size() == kMacroCells);
}

// Mutate real cells in every direction the law can flip, patch the resident
// oracle per cell, and demand the patched state EQUALS a from-scratch rebuild.
// This is the exact obligation of the dirtyCells drain: a patched oracle that
// disagreed with a rebuild would steer a background bake by a world that never
// existed.
void patch_equals_rebuild(World& w) {
    MacroGrid& g = w.grid();

    // Resident oracle, as the scheduler holds it.
    ClearanceField navClear;
    navClear.build(g);

    // Find one fully-solid cell and one air cell by deterministic scan, so the
    // test does not depend on floor-gen internals staying put.
    int solidI = -1, airI = -1;
    for (std::size_t i = 0; i < kMacroCells && (solidI < 0 || airI < 0); ++i) {
        const SubMask& m = g.masks()[i];
        if (solidI < 0 && m.full()) solidI = static_cast<int>(i);
        if (airI < 0 && m.empty()) airI = static_cast<int>(i);
    }
    CHECK(solidI >= 0);
    CHECK(airI >= 0);
    const auto coord = [](int i, int& x, int& y, int& z) {
        x = i % kMacroDim;
        y = (i / kMacroDim) % kMacroDim;
        z = i / (kMacroDim * kMacroDim);
    };
    int sx, sy, sz, ax, ay, az;
    coord(solidI, sx, sy, sz);
    coord(airI, ax, ay, az);

    // Direction 1 — air -> fully solid: both laws flip open -> blocked. Все
    // шесть граней залитой клетки глухие для любого габарита.
    g.fill_cell(ax, ay, az, 1);
    // Direction 2 — one voxel carved out of a solid cell: ПИН §60. Прежний
    // нав-закон «не полностью твёрдая» здесь открывал клетку — дыра, через
    // которую маршруты шли сквозь лепленые стены. Клиренс обязан НЕ дать
    // телу хода: одиночный атом — не проход 4×4.
    g.mask(sx, sy, sz).clear(sub_bit(0, 0, 0));

    const std::size_t si = static_cast<std::size_t>(solidI);
    const std::size_t ai = static_cast<std::size_t>(airI);
    navClear.patch(g, ax, ay, az);
    navClear.patch(g, sx, sy, sz);

    for (int d = 0; d < 6; ++d) {
        CHECK(navClear.at(ax, ay, az, d) == 0);
        CHECK(navClear.at(sx, sy, sz, d) < kBodyClearanceSub); // §60: не открылась
    }

    // Direction 3 — carve the solid cell down to a body-sized shaft: clear the
    // centred 4x4 footprint through ALL eight sub-layers. Its ±z faces open to
    // body clearance as soon as the ±z neighbours can offer the matching half —
    // проверяется финальной сверкой с ребилдом, соседи тут произвольные клетки
    // настоящего этажа.
    for (int lz = 0; lz < kSubDim; ++lz)
        for (int ly = 2; ly <= 5; ++ly)
            for (int lx = 2; lx <= 5; ++lx)
                g.mask(sx, sy, sz).clear(sub_bit(lx, ly, lz));
    navClear.patch(g, sx, sy, sz);

    // Direction 4 — back to full: blocked again. Round-tripping the same cell is
    // what a real battle does to a wall (carve, then samosbor re-fill), and a
    // patch that only worked one way would pass 1-3.
    g.fill_cell(sx, sy, sz, 1);
    navClear.patch(g, sx, sy, sz);
    for (int d = 0; d < 6; ++d) CHECK(navClear.at(sx, sy, sz, d) == 0);

    // THE claim: after all of it, patched == rebuilt, word for word.
    ClearanceField navRef;
    navRef.build(g);
    CHECK(navClear.vals == navRef.vals);
}

} // namespace walkbits_test

void test_walkbits_all() {
    // One real floor for the whole suite. Residential: its mix rolls
    // Kitchen/Bathroom/Living ([floor_gen.cpp]), so the rooms comparison below
    // compares real fields, not eleven empty vectors against eleven others.
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    walkbits_test::nav_bake_through_field_is_bit_identical(w);
    // Last: it carves the floor the identity tests just measured.
    walkbits_test::patch_equals_rebuild(w);
}
