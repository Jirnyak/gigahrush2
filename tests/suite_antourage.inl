// Antourage — the baked-dressing seam ([game/antourage/antourage.h]): SOLID
// pipes written into the grid, GHOST wire chains beside it.
//
// Included into game_test.cpp after its CHECK macro and `using namespace`.

#include "game/antourage/antourage.h"
#include "world/material_props.h"

static void test_antourage_all() {
    // A real floor, dressed.
    World w;
    generate_floor(w, 0, floor_spec(FloorKind::Residential), 1337u);
    AntourageBake bake;
    bake_antourage(w, 0, 1337u, bake);

    // Both modules produced real content on the padic tower — through the
    // UNIVERSAL primitive contract ([antourage.h]): the core knows instances
    // and chains, never "pipes".
    CHECK(!bake.instances.empty());
    CHECK(!bake.wires.empty());
    std::fprintf(stderr,
                 "[antourage] %u cells walked, %zu instances; wires: %zu\n",
                 bake.pipeCells, bake.instances.size(), bake.wires.size());

    // THE LAW ([antourage.h]): the bake NEVER writes the grid — antourage is
    // mesh anchored to real world voxels, and an invisible voxel would be a
    // contradiction. Every anchor it recorded is real SOLID matter, every
    // shape ordinal is a real catalog row, every scale is positive.
    for (const AntourageInstance& it : bake.instances) {
        CHECK(w.grid().cell(it.ax0, it.ay0, it.az0) != kCellAir);
        CHECK(w.grid().cell(it.ax1, it.ay1, it.az1) != kCellAir);
        CHECK(it.shape <= kShapeCylinderZ);
        CHECK(it.scale.x > 0.0f && it.scale.y > 0.0f && it.scale.z > 0.0f);
    }
    // ...and no cell anywhere carries the pipe material: it exists for the
    // MESH's shading only.
    std::uint32_t pipeMatCells = 0;
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                if (w.grid().cell(x, y, z) == kMatPipeMetal) ++pipeMatCells;
    CHECK(pipeMatCells == 0);

    // GHOST: every wire hangs from real ceilings over clear air, and its rest
    // pose sags between its anchors, never above them.
    for (const WireChain& c : bake.wires) {
        CHECK(w.grid().cell(c.ax0, c.ay0, c.az0) != kCellAir); // anchors solid
        CHECK(w.grid().cell(c.ax1, c.ay1, c.az1) != kCellAir);
        CHECK(c.restLen > 0.0f);
        CHECK(c.massKg > 0.0f);
        // Ends may sit at DIFFERENT heights now (each anchors to its own
        // ceiling's real under-face); nothing hangs above the higher end.
        const float top = c.p[0].z > c.p[kWirePoints - 1].z
                              ? c.p[0].z
                              : c.p[kWirePoints - 1].z;
        for (int i = 0; i < kWirePoints; ++i) CHECK(c.p[i].z <= top + 1e-4f);
        CHECK(c.p[kWirePoints / 2].z < top); // the middle really sags
    }

    // CLOTH — the third primitive ([antourage.h] ClothSheet): sheets hang from
    // real ceiling anchors, the top row is pinned, every free point sits at or
    // below its own column's pin, and both rest lengths are usable.
    CHECK(!bake.cloths.empty());
    std::fprintf(stderr, "[antourage] cloths: %zu\n", bake.cloths.size());
    for (const ClothSheet& s : bake.cloths) {
        CHECK(w.grid().cell(s.ax0, s.ay0, s.az0) != kCellAir);
        CHECK(w.grid().cell(s.ax1, s.ay1, s.az1) != kCellAir);
        CHECK(s.restX > 0.0f);
        CHECK(s.restY > 0.0f);
        CHECK(s.pinMask == 0xFFu); // this module pins exactly the top row
        for (int c = 0; c < kClothW; ++c)
            for (int r = 1; r < kClothH; ++r)
                CHECK(s.p[r * kClothW + c].z <= s.p[c].z + 1e-4f);
    }

    // Deterministic: same (grid, number, seed) -> the identical dressing, so a
    // recycled World re-bakes bit-for-bit like the geometry.
    World w2;
    generate_floor(w2, 0, floor_spec(FloorKind::Residential), 1337u);
    AntourageBake again;
    bake_antourage(w2, 0, 1337u, again);
    CHECK(again.pipeCells == bake.pipeCells);
    CHECK(again.instances.size() == bake.instances.size());
    CHECK(again.wires.size() == bake.wires.size());
    CHECK(again.cloths.size() == bake.cloths.size());
    CHECK(w.grid().types() == w2.grid().types());

    // The dressing must not eat the doors: door_build still validates a real
    // door population against the dressed grid.
    DoorSet doors;
    CHECK(door_build(w, doors, 0, floor_spec(FloorKind::Residential), 1337u) > 0);
}
