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

    // DESTRUCTION reaches the dressing ([antourage.h] antourage_carve_step —
    // the antourage twin of anchor_validate_step). Empty the first instance's
    // anchor cell by hand, hand the carve's dirty list over, and the piece must
    // report itself dead exactly ONCE, with debris to show for it.
    {
        // A leg, not a joint: two DISTINCT anchor cells, so the "already dead"
        // half of the rule can be exercised by killing them one at a time.
        const AntourageInstance* leg = nullptr;
        for (const AntourageInstance& it : bake.instances)
            if (it.ax0 != it.ax1 || it.ay0 != it.ay1 || it.az0 != it.az1) {
                leg = &it;
                break;
            }
        CHECK(leg != nullptr);
        const AntourageInstance& victim = *leg;
        CHECK(antourage_alive(w.grid(), victim));
        ParticleBurstQueue bursts;
        // A dirty list that names an untouched cell kills nobody.
        const std::uint32_t innocent = static_cast<std::uint32_t>(
            macro_index(victim.ax0, victim.ay0, wrap_macro(victim.az0 + 4)));
        CHECK(antourage_carve_step(w, bake, &innocent, 1, bursts, 7u) == 0);
        CHECK(bursts.count == 0);

        w.grid().set_cell(victim.ax0, victim.ay0, victim.az0, kCellAir);
        const std::uint32_t dirty = static_cast<std::uint32_t>(
            macro_index(victim.ax0, victim.ay0, victim.az0));
        CHECK(!antourage_alive(w.grid(), victim));
        const std::uint32_t dead =
            antourage_carve_step(w, bake, &dirty, 1, bursts, 7u);
        CHECK(dead > 0);  // at least the victim; anchor cells are shared
        // One burst per severed piece, up to the queue's bounded ring.
        CHECK(bursts.count > 0 && bursts.count <= dead);
        std::fprintf(stderr, "[antourage] carve severed %u piece(s)\n", dead);

        // The SECOND carve nearby must not re-kill what is already gone: the
        // victim's other anchor goes now, and the piece — dead since the first
        // op — stays silent.
        ParticleBurstQueue again;
        w.grid().set_cell(victim.ax1, victim.ay1, victim.az1, kCellAir);
        const std::uint32_t dirty2 = static_cast<std::uint32_t>(
            macro_index(victim.ax1, victim.ay1, victim.az1));
        const std::uint32_t dead2 =
            antourage_carve_step(w, bake, &dirty2, 1, again, 9u);
        for (std::uint16_t i = 0; i < again.count; ++i)
            CHECK(again.items[i].pos.x != victim.pos.x ||
                  again.items[i].pos.y != victim.pos.y ||
                  again.items[i].pos.z != victim.pos.z);
        CHECK(again.count == dead2);
    }

    // A verlet chain does NOT die with one anchor: the cut end lets go and it
    // hangs from the other ([antourage.h] wire_live_pins). Death is "nothing
    // is pinned any more" — and the sheet's top row splits the same way.
    {
        World w3;
        generate_floor(w3, 0, floor_spec(FloorKind::Residential), 1337u);
        AntourageBake b3;
        bake_antourage(w3, 0, 1337u, b3);
        CHECK(!b3.wires.empty());
        const WireChain wire = b3.wires.front();
        CHECK(wire_live_pins(w3.grid(), wire) == wire.pinMask); // intact
        CHECK(antourage_alive(w3.grid(), wire));

        w3.grid().set_cell(wire.ax0, wire.ay0, wire.az0, kCellAir);
        const std::uint8_t halfPins = wire_live_pins(w3.grid(), wire);
        CHECK((halfPins & 1u) == 0u);                    // that end let go
        CHECK((halfPins >> (kWirePoints - 1)) & 1u);     // this one still holds
        CHECK(antourage_alive(w3.grid(), wire));         // still hanging
        // ...and a carve that only cuts one end sheds NO debris for the chain
        // (pipes sharing that ceiling cell may still die — check the chain's
        // own midpoint, not the total).
        ParticleBurstQueue q;
        const vec3 mid = wire.p[kWirePoints / 2];
        const std::uint32_t cut0 = static_cast<std::uint32_t>(
            macro_index(wire.ax0, wire.ay0, wire.az0));
        antourage_carve_step(w3, b3, &cut0, 1, q, 3u);
        for (std::uint16_t i = 0; i < q.count; ++i)
            CHECK(q.items[i].pos.x != mid.x || q.items[i].pos.y != mid.y ||
                  q.items[i].pos.z != mid.z);
        const std::uint16_t afterFirst = q.count;

        w3.grid().set_cell(wire.ax1, wire.ay1, wire.az1, kCellAir);
        CHECK(wire_live_pins(w3.grid(), wire) == 0u);
        CHECK(!antourage_alive(w3.grid(), wire));
        const std::uint32_t cut1 = static_cast<std::uint32_t>(
            macro_index(wire.ax1, wire.ay1, wire.az1));
        CHECK(antourage_carve_step(w3, b3, &cut1, 1, q, 4u) > 0);
        CHECK(q.count > afterFirst); // the chain finally shed its debris

        // Cloth: one corner cut leaves the other half of the top row pinned.
        // Pick a sheet the two carves above did not already touch.
        const ClothSheet* intact = nullptr;
        for (const ClothSheet& s : b3.cloths)
            if (w3.grid().cell(s.ax0, s.ay0, s.az0) != kCellAir &&
                w3.grid().cell(s.ax1, s.ay1, s.az1) != kCellAir) {
                intact = &s;
                break;
            }
        CHECK(intact != nullptr);
        const ClothSheet sheet = *intact;
        CHECK(cloth_live_pins(w3.grid(), sheet) == sheet.pinMask);
        w3.grid().set_cell(sheet.ax0, sheet.ay0, sheet.az0, kCellAir);
        const std::uint32_t halfSheet = cloth_live_pins(w3.grid(), sheet);
        CHECK((halfSheet & 0x0Fu) == 0u);   // left half of the top row let go
        CHECK((halfSheet & 0xF0u) != 0u);   // right half still holds
        CHECK(antourage_alive(w3.grid(), sheet));
        w3.grid().set_cell(sheet.ax1, sheet.ay1, sheet.az1, kCellAir);
        CHECK(cloth_live_pins(w3.grid(), sheet) == 0u);
        CHECK(!antourage_alive(w3.grid(), sheet));
    }
}
