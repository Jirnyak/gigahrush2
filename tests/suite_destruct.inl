// Destruction suite — the universal carve ([world/destruct.h]), the sparse
// sub-voxel fields it rides on ([world/subfield.h]), and the hardness table
// ([world/material_props.h]). Included by world_test.cpp; uses its CHECK.

#include <chrono>
#include <thread>
#include "game/lazy_baker.h"
#include "world/lazy_field_rebaker.h"
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
    // remove it, (b) find the survivor now floats unsupported, delete it from
    // the grid and hand it over as debris, (c) collapse the emptied cell to
    // air. This is the "если воксель висит в воздухе" contract end to end.
    {
        World w;
        w.grid().set_cell(10, 10, 10, kMatConcrete);
        w.grid().mask(10, 10, 10).set(sub_bit(4, 4, 4));
        w.grid().mask(10, 10, 10).set(sub_bit(5, 4, 4));
        CHECK(carve_at(w, 10, 10, 10, 4, 4, 4, /*power=*/256, /*seed=*/1,
                       scratch, res));
        CHECK(res.destroyed.size() == 1);
        CHECK(res.destroyed[0].mat == kMatConcrete);
        CHECK(res.detached.size() == 1); // the orphan, render's problem now
        CHECK(res.detached[0].bit == sub_bit(5, 4, 4));
        CHECK(res.detached[0].mat == kMatConcrete);
        CHECK(w.grid().mask(10, 10, 10).empty());
        CHECK(w.grid().cell(10, 10, 10) == kCellAir);
        CHECK(res.dirtyCells.size() == 1);
        CHECK(res.dirtyCells[0] == macro_index(10, 10, 10));
        // Second swing at the same spot: nothing there any more.
        CHECK(!carve_at(w, 10, 10, 10, 4, 4, 4, 256, 2, scratch, res));
    }

    // A single full cell floating in air is one 512-voxel component — exactly
    // the detach limit — so chipping one voxel off casts the other 511 loose.
    {
        World w;
        w.grid().fill_cell(20, 20, 20, kMatConcrete);
        CHECK(carve_at(w, 20, 20, 20, 0, 0, 0, 256, 5, scratch, res));
        CHECK(res.destroyed.size() == 1);
        CHECK(res.detached.size() == 511);
        CHECK(w.grid().cell(20, 20, 20) == kCellAir);
    }

    // The same chip against a TWO-cell block: 1023 survivors exceed the limit,
    // so the structure is judged supported and stands.
    {
        World w;
        w.grid().fill_cell(30, 30, 30, kMatConcrete);
        w.grid().fill_cell(31, 30, 30, kMatConcrete);
        CHECK(carve_at(w, 30, 30, 30, 0, 0, 0, 256, 5, scratch, res));
        CHECK(res.destroyed.size() == 1);
        CHECK(res.detached.empty());
        CHECK(w.grid().mask(31, 30, 30).full());
        CHECK(!w.grid().mask(30, 30, 30).full());
        CHECK(w.grid().cell(30, 30, 30) == kMatConcrete); // partial keeps type
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
    // Three cells in a row so the painted one is ANCHORED: a lone painted cell
    // would (correctly) be cast loose by the detach sweep after the chip.
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
    CHECK(w.grid().cell(13, 10, 10) == kCellAir); // blob is render's now
    CHECK(w.grid().mask(13, 10, 10).empty());
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
    // sides of the wrap. Walls are 2 cells thick per side so neither side is
    // detachable debris.
    World s;
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


// jirnyak.md section 22: LazyFieldRebaker queues lattice nodes from carve
// dirtyCells, rebakes fine flow under a time budget, then closes with nearest
// + coarse. Must not no-op: after drain, pending is empty and rebaked_count
// grows; nearest on a reopened air cell must leave kFlowNone after closing.
static void test_lazy_field_rebaker() {
    using namespace giga::nav;

    MacroGrid grid;
    CoarseGraph coarse{};
    FineNav fine;
    bake_coarse(grid, coarse);
    bake_fine(grid, fine);
    CHECK(!fine.flow.empty());
    CHECK(fine.nearest.size() == kMacroCells);

    LazyFieldRebaker rebaker;
    CHECK(rebaker.is_idle());
    CHECK(rebaker.pending_count() == 0);

    const std::uint32_t key =
        static_cast<std::uint32_t>(macro_index(20, 20, 20));
    const int expectNode = lattice_id(lattice_axis_of(20), lattice_axis_of(20),
                                      lattice_axis_of(20));
    rebaker.mark_dirty_cells(std::vector<std::uint32_t>{key, key});
    CHECK(rebaker.pending_count() == 1);
    CHECK(!rebaker.is_idle());

    grid.fill_cell(20, 20, 20, /*mat*/ 1);
    fine.nearest[macro_index(20, 20, 20)] = kFlowNone;
    grid.clear_cell(20, 20, 20);

    std::size_t steps = 0;
    for (int i = 0; i < 128 && !rebaker.is_idle(); ++i) {
        steps += rebaker.step_lazy_rebake(grid, coarse, fine, /*budgetMs=*/50.0f);
    }
    CHECK(rebaker.is_idle());
    CHECK(rebaker.pending_count() == 0);
    CHECK(rebaker.rebaked_count_total() >= 1);
    CHECK(steps >= 1);
    CHECK(rebaker.closing_pass_count() >= 1);
    CHECK(fine.nearest_node(20, 20, 20) != kFlowNone);

    FineNav emptyFine;
    rebaker.queue_node(expectNode);
    CHECK(rebaker.pending_count() == 1);
    CHECK(rebaker.step_lazy_rebake(grid, coarse, emptyFine, 50.0f) == 0);
    CHECK(rebaker.pending_count() == 1);
    rebaker.clear();
    CHECK(rebaker.is_idle());
}

static void test_lazy_baker() {
    game::LazyFieldBaker<float> baker;
    World w;
    std::vector<std::uint32_t> dirty = { static_cast<std::uint32_t>(macro_index(10, 10, 10)) };
    baker.request_rebake(w, dirty);
    
    int retries = 100;
    while (retries-- > 0) {
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
        baker.update_main_thread();
        if (baker.get().at(10, 10, 10) != 0.0f) {
            break;
        }
    }
    CHECK(baker.get().at(10, 10, 10) != 0.0f);
}

static void test_destruct_all() {
    test_subfield();
    test_carve_roll();
    test_carve_at();
    test_carve_layers();
    test_carve_sphere();
    test_lazy_baker();
    test_lazy_field_rebaker();
}
