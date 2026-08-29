// Destruction suite — the universal carve ([world/destruct.h]), the sparse
// sub-voxel fields it rides on ([world/subfield.h]), and the hardness table
// ([world/material_props.h]). Included by world_test.cpp; uses its CHECK.

#include <chrono>
#include <thread>
#include "world/anchor.h"
#include "world/lattice.h"
#include "world/nav.h"

// The sparse sub-field: uniform cells cost nothing, mixed cells page, pages
// collapse back and recycle, and the WORST case is pinned to exactly the dense
// array it would replace — the "degrades to 2 GB, never worse" contract.
static void test_subfield() {
    SubFieldRegistry reg;
    CHECK(!reg.exists("sub_material"));
    auto& f = reg.get_or_create<CellType>("sub_material");
    CHECK(reg.exists("sub_material"));
    CHECK(reg.find<CellType>("sub_material") == &f);
    CHECK(reg.find<float>("sub_material") == nullptr); // wrong T is safe
    CHECK(reg.count() == 1);

    const std::size_t ci = macro_index(3, 4, 5);
    // Unpaged: every read is the caller's base, nothing allocated.
    CHECK(f.at(ci, 0, CellType{7}) == 7);
    CHECK(!f.paged(ci));
    CHECK(f.pages_in_use() == 0);

    // Page on first divergence: base everywhere, the write where written.
    CellType* pg = f.ensure_page(ci, CellType{7});
    CHECK(pg != nullptr && f.paged(ci) && f.pages_in_use() == 1);
    pg[sub_bit(1, 2, 3)] = 9;
    CHECK(f.at(ci, sub_bit(1, 2, 3), CellType{7}) == 9);
    CHECK(f.at(ci, sub_bit(0, 0, 0), CellType{7}) == 7);
    CHECK(f.at(3, 4 + kMacroDim, 5, 1, 2, 3, CellType{7}) == 9); // toroidal

    // Mixed cells refuse to collapse; uniform ones fold back and recycle.
    CellType uni = 0;
    CHECK(!f.collapse_if_uniform(ci, &uni));
    pg[sub_bit(1, 2, 3)] = 7;
    CHECK(f.collapse_if_uniform(ci, &uni));
    CHECK(uni == 7 && !f.paged(ci));
    const std::size_t slotsBefore = f.bytes();
    f.ensure_page(macro_index(9, 9, 9), CellType{1}); // reuses the freed slot
    CHECK(f.pages_in_use() == 1);
    CHECK(f.bytes() == slotsBefore); // no growth: the free list served it

    // The budget pin: worst case (every cell paged) is page bytes + table.
    // 2^21 cells x 512 sub-voxels x 2 bytes = exactly 2 GiB of pages.
    constexpr std::uint64_t worstPages =
        std::uint64_t{kMacroCells} * kSubVoxels * sizeof(CellType);
    CHECK(worstPages == (std::uint64_t{1} << 31));
}

// The stateless roll: pure integer probability power/hardness, deterministic
// by hash, with both sentinels honoured.
static void test_carve_roll() {
    // Determinism of the hash itself.
    CHECK(carve_hash(1, 2, 3) == carve_hash(1, 2, 3));
    CHECK(carve_hash(1, 2, 3) != carve_hash(2, 2, 3)); // seed matters

    for (std::uint32_t h : {0u, 0xFFFFu, 0xDEADBEEFu, 0x12345678u}) {
        CHECK(carve_roll(h, 256, 256));   // power == hardness: certain
        CHECK(carve_roll(h, 300, 256));   // power > hardness: certain
        CHECK(!carve_roll(h, 0, 256));    // no power: never
        CHECK(!carve_roll(h, 0xFFFF, kHardnessUnbreakable)); // never, ever
        CHECK(carve_roll(h, 1, 0));       // hardness 0: any touch
    }

    // Statistics: at power = hardness/2 the removal rate over many distinct
    // sub-voxels must sit near 1/2 (the hash is the only randomness).
    int removed = 0;
    const int n = 4096;
    for (int i = 0; i < n; ++i)
        if (carve_roll(carve_hash(42, static_cast<std::uint32_t>(i), 7u), 128,
                       256))
            ++removed;
    CHECK(removed > n * 2 / 5 && removed < n * 3 / 5);

    // Hardness rows: air never rolls (0), infrastructure is data-protected,
    // out-of-table ids read unbreakable rather than garbage.
    CHECK(kMatHardness[kCellAir] == 0);
    CHECK(kMatHardness[kMatDoor] == kHardnessUnbreakable);
    CHECK(kMatHardness[kMatHubPad] == kHardnessUnbreakable);
    CHECK(kMatHardness[kMatExtract] == kHardnessUnbreakable);
    CHECK(material_hardness(kMatCount) == kHardnessUnbreakable);
    CHECK(material_hardness(kMatConcrete) == 256);
}

// The pickaxe primitive against live geometry: certain removal at full power,
// air-collapse of emptied cells, and the detachment handoff for what the hit
// left hanging.
static void test_carve_at() {
    CarveScratch scratch;
    CarveResult res;

    // Two lone sub-voxels in an otherwise empty torus. Chipping one must (a)
    // remove it, (b) find the survivor now floats unsupported and CONVERT it
    // to rubble IN PLACE (закон владельца 2026-08-24, S16.5: потерявший
    // связность кусок не исчезает и ничего не рождает — те же атомы
    // становятся рыхлой строкой и дальше падают автоматом, как вода).
    {
        World w;
        w.grid().set_cell(10, 10, 10, kMatConcrete);
        w.grid().mask(10, 10, 10).set(sub_bit(4, 4, 4));
        w.grid().mask(10, 10, 10).set(sub_bit(5, 4, 4));
        CHECK(carve_at(w, 10, 10, 10, 4, 4, 4, /*power=*/256, /*seed=*/1,
                       scratch, res));
        CHECK(res.destroyed.size() == 1);
        CHECK(res.destroyed[0].mat == kMatConcrete);
        CHECK(res.detached.size() == 1); // the orphan — теперь материя автомата
        CHECK(res.detached[0].bit == sub_bit(5, 4, 4));
        CHECK(res.detached[0].mat == kMatConcrete);
        CHECK(!w.grid().mask(10, 10, 10).empty());
        CHECK(w.grid().mask(10, 10, 10).test(sub_bit(5, 4, 4)));
        CHECK(sub_material_at(w, 10, 10, 10, 5, 4, 4) == kMatRubbleConcrete);
        CHECK(res.dirtyCells.size() == 1);
        CHECK(res.dirtyCells[0] == macro_index(10, 10, 10));
        // Second swing at the same spot: nothing there any more.
        CHECK(!carve_at(w, 10, 10, 10, 4, 4, 4, 256, 2, scratch, res));
    }

    // A single full cell floating in air is one 512-voxel component — exactly
    // the detach limit — so chipping one voxel off casts the other 511 loose:
    // они конвертируются в rubble НА МЕСТЕ (падать им дальше — автоматом).
    {
        World w;
        w.grid().fill_cell(20, 20, 20, kMatConcrete);
        CHECK(carve_at(w, 20, 20, 20, 0, 0, 0, 256, 5, scratch, res));
        CHECK(res.destroyed.size() == 1);
        CHECK(res.detached.size() == 511);
        CHECK(!w.grid().mask(20, 20, 20).test(sub_bit(0, 0, 0)));
        CHECK(w.grid().mask(20, 20, 20).test(sub_bit(1, 0, 0)));
        CHECK(sub_material_at(w, 20, 20, 20, 1, 0, 0) == kMatRubbleConcrete);
    }

    // The same chip against a floating TWO-cell block: 1023 survivors SPAN THE
    // SEAM, и прежний атомный лимит 512 объявлял их «слишком большими, чтобы
    // быть оторванными» — блок висел в воздухе (репорт владельца, скриншот
    // 2026-08-25: балки над прогрызенной дырой). Иерархический судья (узел =
    // клеточный компонент, рёбра = AND граневых слоёв) обязан судить честно:
    // весь блок конвертируется в рыхлого двойника и падает автоматом.
    // …и по ВСЕМ ТРЁМ осям шва (изотропия S1): рёбра судьи — гранёвая
    // бит-магия с своим сдвигом на каждую ось, ошибка в любом из шести
    // сдвигов оставила бы висяк ровно на «своей» оси.
    for (int axis = 0; axis < 3; ++axis) {
        World w;
        const int nx = 30 + (axis == 0), ny = 30 + (axis == 1),
                  nz = 30 + (axis == 2);
        w.grid().fill_cell(30, 30, 30, kMatConcrete);
        w.grid().fill_cell(nx, ny, nz, kMatConcrete);
        CHECK(carve_at(w, 30, 30, 30, 0, 0, 0, 256, 5, scratch, res));
        CHECK(res.destroyed.size() == 1);
        CHECK(res.detached.size() == 1023); // ОБЕ клетки, шов не спасает
        CHECK(w.grid().mask(nx, ny, nz).full()); // маска стоит — атомы на месте
        CHECK(!w.grid().mask(30, 30, 30).full());
        CHECK(sub_material_at(w, nx, ny, nz, 4, 4, 4) == kMatRubbleConcrete);
        CHECK(sub_material_at(w, 30, 30, 30, 4, 4, 4) == kMatRubbleConcrete);
    }

    // Сценарий скриншота: балка 4×4 сечением через ПЯТЬ клеток (40 слоёв ×
    // 16 = 640 атомов > старого лимита 512), прикреплённая к ОПОРНОЙ плите.
    // Опора — 26×26 = 676 полных клеток: больше узлового бюджета, «сам дом»
    // (в пустом торе меньшая опора честно рыхлая — земли нет, держит
    // размер). Отруб у самой плиты: балка конвертируется ЦЕЛИКОМ, плита —
    // стоит бетоном.
    {
        World w;
        for (int y = 20; y <= 45; ++y)                // опорная плита x=40
            for (int z = 20; z <= 45; ++z)
                w.grid().fill_cell(40, y, z, kMatConcrete);
        for (int ax = 41 * 8; ax < 46 * 8; ++ax)      // балка по x через швы
            for (int sy = 2; sy <= 5; ++sy)
                for (int sz = 2; sz <= 5; ++sz) {
                    const int cx = ax / 8;
                    w.grid().set_cell(cx, 40, 40, kMatConcrete);
                    w.grid().mask(cx, 40, 40).set(sub_bit(ax % 8, sy, sz));
                }
        // Срубить первый слой балки (ax=328, все 16 атомов сечения). Пока
        // сечение цело хоть одним атомом — хвост держится плитой и стоит.
        CarveResult bres;
        for (int sy = 2; sy <= 5; ++sy)
            for (int sz = 2; sz <= 5; ++sz) {
                CHECK(carve_at(w, 41, 40, 40, 0, sy, sz, 256, 7, scratch,
                               bres));
            }
        // Последний удар оставил висеть 39 слоёв × 16 = 624 атома через
        // четыре шва — все конвертированы (маски стоят, материал рыхлый).
        CHECK(sub_material_at(w, 41, 40, 40, 1, 4, 4) == kMatRubbleConcrete);
        CHECK(sub_material_at(w, 43, 40, 40, 4, 4, 4) == kMatRubbleConcrete);
        CHECK(sub_material_at(w, 45, 40, 40, 7, 5, 5) == kMatRubbleConcrete);
        CHECK(w.grid().mask(40, 40, 40).full()); // опора цела и бетонна
        CHECK(sub_material_at(w, 40, 40, 40, 4, 4, 4) == kMatConcrete);
        CHECK(sub_material_at(w, 40, 21, 21, 4, 4, 4) == kMatConcrete);
    }

    // Unbreakable rows really are: full power, no removal, no dirt.
    {
        World w;
        w.grid().fill_cell(40, 40, 40, kMatHubPad);
        CHECK(!carve_at(w, 40, 40, 40, 3, 3, 3, 0xFFFF, 9, scratch, res));
        CHECK(w.grid().mask(40, 40, 40).full());
        CHECK(res.destroyed.empty() && res.dirtyCells.empty());
    }
}

// Layered materials: a plaster coat painted over a concrete cell reads back
// per-sub-voxel, carves at plaster hardness, and reveals the concrete beneath —
// the "краска снаружи, бетон внутри" example verbatim.
static void test_carve_layers() {
    World w;
    // Three cells in a row, ANCHORED into a 676-cell slab («сам дом» — больше
    // узлового бюджета судьи): под новой аксиомой опоры голая полоса из трёх
    // клеток в пустом торе честно рыхлая, её ничто не держит.
    for (int y = 37; y <= 62; ++y)
        for (int z = 37; z <= 62; ++z)
            w.grid().fill_cell(53, y, z, kMatConcrete);
    w.grid().fill_cell(50, 50, 50, kMatConcrete);
    w.grid().fill_cell(51, 50, 50, kMatConcrete);
    w.grid().fill_cell(52, 50, 50, kMatConcrete);
    // Paint the -x face shell (8x8 sub-voxels) plaster.
    for (int sz = 0; sz < kSubDim; ++sz)
        for (int sy = 0; sy < kSubDim; ++sy)
            set_sub_material(w, 50, 50, 50, 0, sy, sz, kMatPlaster);

    CHECK(sub_material_at(w, 50, 50, 50, 0, 3, 3) == kMatPlaster);
    CHECK(sub_material_at(w, 50, 50, 50, 1, 3, 3) == kMatConcrete);
    auto* mats = w.subfields().find<CellType>(kSubMaterialName);
    CHECK(mats != nullptr && mats->pages_in_use() == 1);

    // A tap at plaster hardness (32) is a certain removal on the coat...
    CarveScratch scratch;
    CarveResult res;
    CHECK(carve_at(w, 50, 50, 50, 0, 3, 3, /*power=*/32, /*seed=*/7, scratch,
                   res));
    CHECK(res.destroyed.size() == 1 && res.destroyed[0].mat == kMatPlaster);
    // ...the coat voxel is gone, and what now faces the hole one step deeper
    // is the concrete beneath: the coat stripped, the core revealed.
    CHECK(!w.grid().mask(50, 50, 50).test(sub_bit(0, 3, 3)));
    CHECK(sub_material_at(w, 50, 50, 50, 1, 3, 3) == kMatConcrete);
    // The cell stays mixed (paged) while any plaster remains on the face.
    CHECK(mats->pages_in_use() == 1);

    // Painting a cell uniformly folds back into the plain cell type: the page
    // is shed and the uniform layer carries the material.
    World v;
    v.grid().fill_cell(60, 60, 60, kMatConcrete);
    for (int sz = 0; sz < kSubDim; ++sz)
        for (int sy = 0; sy < kSubDim; ++sy)
            for (int sx = 0; sx < kSubDim; ++sx)
                set_sub_material(v, 60, 60, 60, sx, sy, sz, kMatPlaster);
    CHECK(v.grid().cell(60, 60, 60) == kMatPlaster);
    auto* vm = v.subfields().find<CellType>(kSubMaterialName);
    CHECK(vm != nullptr && vm->pages_in_use() == 0);
    // And painting the base value onto a uniform cell never pages at all.
    set_sub_material(v, 61, 60, 60, 1, 1, 1, kCellAir);
    CHECK(vm->pages_in_use() == 0);
}

// The sphere carve: deterministic for a given seed, honours the falloff
// radius, wraps the torus seam, and severs+hands-off a component the blast
// disconnects while the anchored side stands.
static void test_carve_sphere() {
    CarveScratch scratch;

    // A 1-voxel-wide arm between a heavy anchor (2 full cells, 1024 voxels)
    // and a light blob (1 full cell + arm stub, 514 voxels). Blasting the arm
    // mid-span must destroy exactly the 3 arm voxels under the blast (power
    // dwarfs hardness there), then detach the blob side (<= limit 1024) and
    // keep the anchor side (> limit).
    auto build = [](World& w) {
        // Якорь упирается в плиту 26×26 = 676 клеток: больше узлового
        // бюджета судьи — «сам дом». Двухклеточный якорь без неё под новой
        // аксиомой честно рыхлый: в пустом торе его ничто не держит.
        for (int y = 0; y <= 25; ++y)
            for (int z = 0; z <= 25; ++z)
                w.grid().fill_cell(9, y, z, kMatConcrete);
        w.grid().fill_cell(10, 10, 10, kMatConcrete); // anchor
        w.grid().fill_cell(11, 10, 10, kMatConcrete);
        w.grid().set_cell(12, 10, 10, kMatConcrete);  // arm cell, 8 voxels
        for (int sx = 0; sx < kSubDim; ++sx)
            w.grid().mask(12, 10, 10).set(sub_bit(sx, 4, 4));
        w.grid().fill_cell(13, 10, 10, kMatConcrete); // blob
    };
    CarveOp op;
    // Arm sub-voxel ax=100 (cell 12, sx=4), centre of that voxel in metres.
    op.x = (100.0f + 0.5f) * kVoxelSize;
    op.y = (84.0f + 0.5f) * kVoxelSize;
    op.z = (84.0f + 0.5f) * kVoxelSize;
    op.radius = 2.0f * kVoxelSize; // reaches ax 99..101 with certain power
    op.power = 0xFFFF;
    op.seed = 1234;
    op.detachLimit = 1024;

    World w;
    build(w);
    CarveResult res;
    const std::int32_t removed = carve_sphere(w, op, scratch, res);
    CHECK(res.destroyed.size() == 3); // arm voxels ax 99,100,101
    CHECK(res.detached.size() == 514); // blob cell + arm stub ax 102,103
    CHECK(removed == 3 + 514);
    CHECK(w.grid().mask(10, 10, 10).full()); // anchor stands...
    CHECK(w.grid().mask(11, 10, 10).full());
    CHECK(w.grid().mask(12, 10, 10).test(sub_bit(0, 4, 4))); // ...stub too
    CHECK(w.grid().mask(12, 10, 10).test(sub_bit(2, 4, 4)));
    // Blob is the AUTOMATON's now: конверсия на месте, маска стоит, падать
    // ему дальше по гравитации фрейма (закон владельца 2026-08-24).
    CHECK(w.grid().mask(13, 10, 10).full());
    CHECK(sub_material_at(w, 13, 10, 10, 0, 0, 0) == kMatRubbleConcrete);
    for (const auto& d : res.detached) CHECK(d.mat == kMatConcrete);
    // Dirty list is deduped, sorted, and covers exactly the touched cells.
    CHECK(res.dirtyCells.size() == 2);
    CHECK(res.dirtyCells[0] == macro_index(12, 10, 10));
    CHECK(res.dirtyCells[1] == macro_index(13, 10, 10));

    // Same seed, same world -> bit-identical outcome (the server's replay
    // guarantee); a different seed is a different roll stream.
    World w2;
    build(w2);
    CarveResult res2;
    carve_sphere(w2, op, scratch, res2);
    CHECK(res2.destroyed.size() == res.destroyed.size());
    CHECK(res2.detached.size() == res.detached.size());
    bool same = true;
    for (std::size_t i = 0; i < res.destroyed.size(); ++i)
        same = same && res.destroyed[i].cell == res2.destroyed[i].cell &&
               res.destroyed[i].bit == res2.destroyed[i].bit;
    for (std::size_t i = 0; i < res.detached.size(); ++i)
        same = same && res.detached[i].cell == res2.detached[i].cell &&
               res.detached[i].bit == res2.detached[i].bit;
    CHECK(same);

    // Blast radius is respected: nothing outside the sphere was rolled. (The
    // blob was removed by DETACHMENT, not by the blast — verified above by the
    // destroyed/detached split.)
    for (const auto& d : res.destroyed) {
        const int bit = d.bit;
        const int ax = static_cast<int>(d.cell & 127u) * kSubDim + (bit & 7);
        CHECK(ax >= 99 && ax <= 101);
    }

    // Torus seam: a blast centred at x=0 removes voxels from cells on BOTH
    // sides of the wrap. Балка упёрта концом в плиту-«дом» (676 клеток), и
    // малый кратер её не перерубает — детача нет; голая балка в пустом торе
    // под новой аксиомой рыхлая с рождения.
    World s;
    for (int y = 0; y <= 25; ++y)
        for (int z = 0; z <= 25; ++z)
            s.grid().fill_cell(125, y, z, kMatConcrete);
    for (int x : {126, 127, 0, 1}) s.grid().fill_cell(x, 5, 5, kMatConcrete);
    CarveOp seam;
    seam.x = 0.0f;
    seam.y = (44.0f + 0.5f) * kVoxelSize;
    seam.z = (44.0f + 0.5f) * kVoxelSize;
    seam.radius = 2.0f * kVoxelSize;
    seam.power = 0xFFFF;
    seam.seed = 77;
    CarveResult sres;
    carve_sphere(s, seam, scratch, sres);
    // At minimum the four on-axis voxels (ax 1022,1023 | 0,1 at ay=az=44) are
    // certain removals; off-axis rim voxels roll per seed. Both sides of the
    // seam must be hit, and a small crater cannot sever the 4-cell beam.
    CHECK(sres.destroyed.size() >= 4);
    bool sawLeft = false, sawRight = false;
    for (const auto& d : sres.destroyed) {
        if ((d.cell & 127u) == 127u) sawLeft = true;
        if ((d.cell & 127u) == 0u) sawRight = true;
    }
    CHECK(sawLeft && sawRight);
    CHECK(sres.detached.empty());

    // No-ops stay no-ops: zero power or zero radius touches nothing.
    CarveOp dead = op;
    dead.power = 0;
    CHECK(carve_sphere(w2, dead, scratch, res2) == 0);
    dead = op;
    dead.radius = 0.0f;
    CHECK(carve_sphere(w2, dead, scratch, res2) == 0);
}


// ТОЧНОЕ ВЫРАВНИВАНИЕ ГРАНЕВЫХ БИТОВ — несущая часть закона: стаб держится
// за плиту-«дом» ЕДИНСТВЕННЫМ атомным контактом через грань, по каждой из
// трёх осей. Пары полных клеток к порче сдвига слепы (любой ненулевой мусор
// попадает в единственный компонент полного соседа — мутация вживую это
// показала); одноатомный контакт краснеет от любого неверного сдвига.
static void test_detach_face_alignment() {
    CarveScratch scratch;
    CarveResult res;
    for (int axis = 0; axis < 3; ++axis)
        for (int side = 0; side < 2; ++side) { // обе грани оси: 6 переносов
            World w;
            const int dir = side == 0 ? 1 : -1;
            const int tan = (axis + 1) % 3;
            const int oth = 3 - axis - tan;
            const int aFace = side == 0 ? 7 : 0;    // граневой слой стаба
            const int aTouch = side == 0 ? 0 : 7;   // ответный слой моста
            auto put = [&](MacroGrid& g, int cxx, int cyy, int czz, int a,
                           int t, int o) {
                int sv[3];
                sv[axis] = a;
                sv[tan] = t;
                sv[oth] = o;
                g.set_cell(cxx, cyy, czz, kMatConcrete);
                g.mask(cxx, cyy, czz).set(sub_bit(sv[0], sv[1], sv[2]));
            };
            // Плита-«дом» (676 полных клеток) за клеткой-мостом.
            for (int u = 20; u <= 45; ++u)
                for (int v = 20; v <= 45; ++v) {
                    int c[3];
                    c[axis] = 30 + 2 * dir;
                    c[tan] = u;
                    c[oth] = v;
                    w.grid().fill_cell(c[0], c[1], c[2], kMatConcrete);
                }
            // Стаб в (30,30,30): стержень по оси на (tan=4) + Г-образный
            // кончик В ГРАНЕВОМ СЛОЕ на (tan=5): слой грани отличается от
            // предыдущего — перенос не того слоя (z-семья мутаций) рвёт
            // контакт, а не копирует его.
            for (int t = 0; t < 4; ++t)
                put(w.grid(), 30, 30, 30, side == 0 ? 4 + t : 3 - t, 4, 4);
            put(w.grid(), 30, 30, 30, aFace, 5, 4);
            // Мост в соседней клетке: контакт (tan=5) + колено (tan=6) +
            // стержень до плиты на (tan=6). На линии (tan=4/5) вдоль оси
            // материи НЕТ — мусор неверного СДВИГА (x/y-семья: биты падают
            // на слой a=1/a=6 с теми же tan) ни во что не попадает.
            int b[3] = {30, 30, 30};
            b[axis] = 30 + dir;
            put(w.grid(), b[0], b[1], b[2], aTouch, 5, 4); // контакт
            for (int t = 0; t < 8; ++t)                    // колено+стержень
                put(w.grid(), b[0], b[1], b[2], t, 6, 4);
            put(w.grid(), b[0], b[1], b[2], aTouch, 6, 4); // смычка колена
            // Судим клетку стаба: опёртый через точный контакт — не рыхлый.
            const std::uint32_t ci =
                static_cast<std::uint32_t>(macro_index(30, 30, 30));
            CHECK(detach_judge_cells(w, &ci, 1, scratch, res) == 0);
            int sv[3];
            sv[axis] = side == 0 ? 4 : 3; // дальний от грани атом стержня
            sv[tan] = 4;
            sv[oth] = 4;
            CHECK(sub_material_at(w, 30, 30, 30, sv[0], sv[1], sv[2]) ==
                  kMatConcrete);
        }
}

// СУДЬЯ СВЯЗНОСТИ НА ШВЕ (§60/§61, баг владельца 2026-08-26 «висящие
// атомы»): ход АВТОМАТА (не карв!) рвёт мостик — крошка уехала/истаяла,
// а развёртка отвязки бежала только при карве: сосед висел в пустоте.
// detach_judge_cells обязан судить клетки изменённых масок и конвертнуть
// отвязанное; опёртое (упирающееся в большой компонент) — не трогать.
static void test_detach_judge() {
    static World w;
    // Опора: полная клетка. Мостик B и висюк A — атомы в соседней клетке:
    // A связан с миром ТОЛЬКО через B.
    w.grid().fill_cell(20, 20, 20, kMatConcrete);
    const int cx = 21, cy = 20, cz = 20;
    const std::size_t ci = macro_index(cx, cy, cz);
    CellType* pg = materialize_sub_page(w, ci);
    // B у грани опоры (sx=0), A следом (sx=1).
    const int bB = sub_bit(0, 4, 4);
    const int bA = sub_bit(1, 4, 4);
    pg[bB] = kMatRubble;   // мостик — крошка (подвижная, уедет автоматом)
    pg[bA] = kMatParquet;  // висюк — твёрдый исходник
    w.grid().mask(cx, cy, cz).set(bB);
    w.grid().mask(cx, cy, cz).set(bA);

    // ХОД АВТОМАТА: мостик исчез (истаял/уехал) — БЕЗ карва и развёртки.
    pg[bB] = kCellAir;
    w.grid().mask(cx, cy, cz).clear(bB);

    // Судья на шве по клетке изменённой маски.
    CarveScratch scratch;
    CarveResult res;
    const std::uint32_t cell32 = static_cast<std::uint32_t>(ci);
    const std::int32_t judged =
        detach_judge_cells(w, &cell32, 1, scratch, res);
    CHECK(judged == 1); // ровно висюк A
    CHECK(sub_material_at(w, cx, cy, cz, 1, 4, 4) ==
          material_rubble_of(kMatParquet));
    // Опора цела: полная клетка не тронута (большой компонент = опёрт).
    CHECK(w.grid().mask(20, 20, 20).full());
    CHECK(sub_material_at(w, 20, 20, 20, 4, 4, 4) == kMatConcrete);
}

// ЗАКОН ОПОРЫ (CANON S20.5, решение владельца 2026-08-29): «подвижное — не
// опора». Атом материала-среды (рыхлые двойники, вода) не передаёт опору
// судье и не держит якорь. Корень бага «кучи дебриса у лестниц»: пока
// rubble считался опорой, балка на куче жила до отъезда кучи, суд шёл
// вслед движению, и каждый вердикт рождал новое rubble — петля. Теперь
// балка, держащаяся только за кучу, рыхлеет ОДНИМ судом, а движение кучи
// не пересуживает ничего. Обе полярности + сид от изменения + якорь.
static void test_support_law() {
    // Таблица: закон выведен из параметров строки (S16.2), не назначен.
    CHECK(material_bears_load(kMatConcrete));
    CHECK(!material_bears_load(kMatRubble));
    CHECK(!material_bears_load(material_rubble_of(kMatConcrete)));
    CHECK(!material_bears_load(kMatWater));
    CHECK(!material_bears_load(kCellAir));

    // Плита-«дом» (676 полных клеток > бюджет 512 узлов) — честная опора
    // на торе; над ней клетка с мостом-крошкой и висюком.
    static World w;
    for (int x = 20; x <= 45; ++x)
        for (int y = 20; y <= 45; ++y)
            w.grid().fill_cell(x, y, 39, kMatConcrete);
    const int cx = 30, cy = 30, cz = 40;
    const std::size_t ci = macro_index(cx, cy, cz);
    const int bB = sub_bit(4, 4, 0); // мост у грани плиты
    const int bA = sub_bit(4, 4, 1); // висюк на мосту
    CarveScratch scratch;
    CarveResult res;
    const std::uint32_t cell32 = static_cast<std::uint32_t>(ci);

    // ПОЛЯРНОСТЬ «опёрт»: мост из БЕТОНА — компонент дотекает до плиты,
    // бюджет зовёт его домом, суд молчит.
    {
        CellType* pg = materialize_sub_page(w, ci);
        pg[bB] = kMatConcrete;
        pg[bA] = kMatParquet;
        w.grid().mask(cx, cy, cz).set(bB);
        w.grid().mask(cx, cy, cz).set(bA);
        CHECK(detach_judge_cells(w, &cell32, 1, scratch, res) == 0);
        CHECK(sub_material_at(w, cx, cy, cz, 4, 4, 1) == kMatParquet);
    }

    // ПОЛЯРНОСТЬ «рыхлое — не опора»: тот же мост из КРОШКИ — висюк
    // конвертируется ОДНИМ судом, крошка не судится (идемпотентно) и
    // маской стоит, плита цела.
    {
        CellType* pg = materialize_sub_page(w, ci);
        pg[bB] = kMatRubble;
        CHECK(detach_judge_cells(w, &cell32, 1, scratch, res) == 1);
        CHECK(sub_material_at(w, cx, cy, cz, 4, 4, 1) ==
              material_rubble_of(kMatParquet));
        CHECK(sub_material_at(w, cx, cy, cz, 4, 4, 0) == kMatRubble);
        CHECK(w.grid().mask(cx, cy, cz).test(bB));
        CHECK(w.grid().mask(30, 30, 39).full());
        // Повторный суд той же клетки — НОЛЬ: всё оставшееся подвижно,
        // компонентов нет. «Куча уехала — пересуда нет».
        CHECK(detach_judge_cells(w, &cell32, 1, scratch, res) == 0);
        // ...и «отъезд» крошки (ход автомата) тоже ничего не рождает.
        pg[bB] = kCellAir;
        w.grid().mask(cx, cy, cz).clear(bB);
        CHECK(detach_judge_cells(w, &cell32, 1, scratch, res) == 0);
    }

    // ВХОДНАЯ РАЗВЁРТКА (collect_mobile_support_cells + судья): домен —
    // клетки с подвижной материей и их соседи; новый висюк на новой крошке
    // попадает в домен через клетку крошки и рыхлеет одним входным судом.
    {
        const int bD = sub_bit(6, 6, 0); // крошка
        const int bC = sub_bit(6, 6, 1); // висюк
        CellType* pg = materialize_sub_page(w, ci);
        pg[bD] = kMatRubble;
        pg[bC] = kMatParquet;
        w.grid().mask(cx, cy, cz).set(bD);
        w.grid().mask(cx, cy, cz).set(bC);
        std::vector<std::uint32_t> domain;
        collect_mobile_support_cells(w, domain);
        // Клетка крошки и все 6 её соседей в домене.
        auto in_domain = [&](std::uint32_t c) {
            return std::find(domain.begin(), domain.end(), c) != domain.end();
        };
        CHECK(in_domain(cell32));
        CHECK(in_domain(static_cast<std::uint32_t>(
            macro_index(cx - 1, cy, cz))));
        CHECK(in_domain(static_cast<std::uint32_t>(
            macro_index(cx, cy, cz + 1))));
        CHECK(detach_judge_cells(w, domain.data(), domain.size(), scratch,
                                 res) == 1);
        CHECK(sub_material_at(w, cx, cy, cz, 6, 6, 1) ==
              material_rubble_of(kMatParquet));
        // Идемпотентность входа: повторная развёртка — ноль конверсий.
        collect_mobile_support_cells(w, domain);
        CHECK(detach_judge_cells(w, domain.data(), domain.size(), scratch,
                                 res) == 0);
    }

    // ЯКОРЬ (S20.2): колонка, стоящая на рыхлом, мертва для World-пробы;
    // масочная проба — уровень кэша, закона не знает (обе полярности).
    {
        static World wa;
        const int ax = 60, ay = 60, az = 60;
        const std::uint8_t face = anchor_face_pack(2, -1);
        const std::size_t aci = macro_index(ax, ay, az);
        // Страничная клетка: единственный атом окна — рыхлый → мёртв...
        CellType* pg = materialize_sub_page(wa, aci);
        const int bit = sub_bit(3, 3, 0);
        pg[bit] = kMatRubble;
        wa.grid().mask(ax, ay, az).set(bit);
        wa.grid().set_cell(ax, ay, az, kMatConcrete); // тип-кэш непуст
        CHECK(anchor_alive(wa.grid(), ax, ay, az, face)); // маска: жив
        CHECK(!anchor_alive(wa, ax, ay, az, face));       // закон: мёртв
        // ...бетонный — жив обеими пробами.
        pg[bit] = kMatConcrete;
        CHECK(anchor_alive(wa, ax, ay, az, face));
        // Бесстраничная клетка целиком из рыхлого: тип решает за всех.
        static World wb;
        wb.grid().fill_cell(ax, ay, az, material_rubble_of(kMatConcrete));
        CHECK(anchor_alive(wb.grid(), ax, ay, az, face));
        CHECK(!anchor_alive(wb, ax, ay, az, face));
    }
}

static void test_destruct_all() {
    test_subfield();
    test_carve_roll();
    test_carve_at();
    test_carve_layers();
    test_carve_sphere();
    test_detach_face_alignment();
    test_detach_judge();
    test_support_law();
}
