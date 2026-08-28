// Оракулы тяжёлых бейков — клиренс нава и телесный битсет комнат — и два
// утверждения, на которых стоит async-rebake phase C.
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
//      через грид — для нава (edge/dist/next, flow, nearest) И для комнат
//      (flow, nearRoom, baked). Эталонные оракулы построены ЗДЕСЬ, руками, из
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
#include "game/body_walk.h"   // телесный оракул — выживший rooms-object F
#include "world/clearance.h"  // ClearanceField — нав-оракул (occupancy)
#include "world/macro_grid.h" // SubMask — the mutation test carves masks directly
#include "world/nav.h"        // bake_coarse/bake_fine
#include "world/types.h"      // kMacroDim, kMacroCells, macro_index
#include "world/walk_bits.h"  // WalkBits — телесный битсет комнат
#include "world/world.h"

namespace walkbits_test {

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

inline bool ref_body_open(const MacroGrid& g, int x, int y, int z) {
    // The GRID form of the body law, i.e. the public contract predicate —
    // deliberately the other spelling than build_body_walk_bits' mask form, so
    // the two forms are also proven to be one law.
    return room_body_walkable(g, x, y, z);
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
    // memcmp over CoarseGraph is safe here for the reason suite_navcache.inl
    // states: nav_cache.cpp static_asserts the struct is padding-free.
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

void body_oracle_is_bit_identical(const World& w) {
    // Зонная половина умерла (rooms-object F: flow-полей нет); закон тела —
    // выживший, и его две формы обязаны совпасть побитово.
    WalkBits body;
    body.words.assign(WalkBits::kWords, 0u);
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                body.set(macro_index(x, y, z), ref_body_open(w.grid(), x, y, z));

    // The production builder (mask form) against the grid form: one law.
    WalkBits built;
    build_body_walk_bits(w.grid(), built);
    CHECK(built.words == body.words);
}

// Mutate real cells in every direction the laws can flip, patch the resident
// oracles per cell, and demand the patched state EQUALS a from-scratch rebuild.
// This is the exact obligation of the dirtyCells drain: a patched oracle that
// disagreed with a rebuild would steer a background bake by a world that never
// existed.
void patch_equals_rebuild(World& w) {
    MacroGrid& g = w.grid();

    // Resident oracles, as the scheduler holds them.
    ClearanceField navClear;
    navClear.build(g);
    WalkBits bodyBits;
    build_body_walk_bits(g, bodyBits);

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
    patch_body_walk_bit(bodyBits, ai, g.mask(ax, ay, az));
    patch_body_walk_bit(bodyBits, si, g.mask(sx, sy, sz));

    for (int d = 0; d < 6; ++d) {
        CHECK(navClear.at(ax, ay, az, d) == 0);
        CHECK(navClear.at(sx, sy, sz, d) < kBodyClearanceSub); // §60: не открылась
    }
    CHECK(!bodyBits.at(ai));
    CHECK(!bodyBits.at(si)); // no body fits through a 1-voxel hole either

    // Direction 3 — carve the solid cell down to a body-sized shaft: clear the
    // centred 4x4 footprint through ALL eight sub-layers. Its ±z faces open to
    // body clearance as soon as the ±z neighbours can offer the matching half
    // (проверяется финальной сверкой с ребилдом — соседи тут произвольные
    // клетки настоящего этажа); телесный закон открывается уже сейчас.
    for (int lz = 0; lz < kSubDim; ++lz)
        for (int ly = 2; ly <= 5; ++ly)
            for (int lx = 2; lx <= 5; ++lx)
                g.mask(sx, sy, sz).clear(sub_bit(lx, ly, lz));
    navClear.patch(g, sx, sy, sz);
    patch_body_walk_bit(bodyBits, si, g.mask(sx, sy, sz));
    CHECK(bodyBits.at(si));

    // Direction 4 — back to full: blocked again for both. Round-tripping the
    // same cell is what a real battle does to a wall (carve, then samosbor
    // re-fill), and a patch that only worked one way would pass 1-3.
    g.fill_cell(sx, sy, sz, 1);
    navClear.patch(g, sx, sy, sz);
    patch_body_walk_bit(bodyBits, si, g.mask(sx, sy, sz));
    for (int d = 0; d < 6; ++d) CHECK(navClear.at(sx, sy, sz, d) == 0);
    CHECK(!bodyBits.at(si));

    // THE claim: after all of it, patched == rebuilt, word for word.
    ClearanceField navRef;
    navRef.build(g);
    WalkBits bodyRef;
    build_body_walk_bits(g, bodyRef);
    CHECK(navClear.vals == navRef.vals);
    CHECK(bodyBits.words == bodyRef.words);
}

} // namespace walkbits_test

void test_walkbits_all() {
    // One real floor for the whole suite. Residential: its mix rolls
    // Kitchen/Bathroom/Living ([floor_gen.cpp]), so the rooms comparison below
    // compares real fields, not eleven empty vectors against eleven others.
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    walkbits_test::nav_bake_through_field_is_bit_identical(w);
    walkbits_test::body_oracle_is_bit_identical(w);
    // Last: it carves the floor the identity tests just measured.
    walkbits_test::patch_equals_rebuild(w);
}
