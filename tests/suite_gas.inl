// suite_gas.inl - Gas Chemistry and Anisotropy (spec2.txt §5.2a)
//
#include "world/world.h"
#include "sim/gas.h"
#include "world/gravity.h"
#include "core/math.h"
#include "sim/controller.h"

namespace {

static void test_gas_sealed_extinguish() {
    giga::World world;
    world.gravity().regime = giga::GravityRegime::NegZ;
    giga::GasParams params;

    giga::Field<std::uint32_t>& f = world.fields().get_or_create<std::uint32_t>(params.field);
    f.data().assign(giga::kMacroCells, giga::pack_gas(0, 0, 255, 0));

    // Assume ci=0 is the room
    int ci = 64 | (64 << 7) | (64 << 14);
    
    // Ignite fire in the room
    f.data()[ci] = giga::pack_gas(0, 0, 255, 255);

    // Make walls solid to seal the room
    auto& grid = world.grid();
    // In our CPU step, is_completely_solid checks if masks are 0xFFFFFFFF
    // We can just simulate the step. With a sealed room (no flux from boundaries if we set them solid)
    // Actually we can just run the simulation. If all cells are sealed or just the system is closed
    // (the borders have ambient oxygen but if it's far away, it will take time to diffuse)
    
    // Better: set neighbors to solid to perfectly seal the room.
    const giga::CellStep dirs[6] = { {1,0,0}, {-1,0,0}, {0,1,0}, {0,-1,0}, {0,0,1}, {0,0,-1} };
    for (int i=0; i<6; ++i) {
        int nx = 64 + dirs[i].x;
        int ny = 64 + dirs[i].y;
        int nz = 64 + dirs[i].z;
        int nci = nx | (ny << 7) | (nz << 14);
        for(int m=0; m<giga::kSubMaskWords; ++m) {
            grid.masks_mut()[nci].words[m] = ~std::uint64_t{0};
        }
    }

    // Step until oxygen is depleted and fire is extinguished
    float dt = 1.25f;
    for (int step = 0; step < 18; ++step) {
        giga::gas_step(world, 0, dt, params);
    }

    float toxic, smoke, oxy, heat;
    giga::unpack_gas(f.data()[ci], toxic, smoke, oxy, heat);

    std::fprintf(stderr, "SEALED ROOM: oxy=%f heat=%f smoke=%f toxic=%f\n", oxy, heat, smoke, toxic);

    // Fire should extinguish (heat drops) and oxygen should be low
    CHECK(oxy <= 40.0f);
    CHECK(heat < 200.0f); // It extinguished or is extinguishing
    CHECK(smoke > 0.0f);

}

static void test_gas_displacement() {
    giga::World world;
    giga::GasParams params;
    giga::Field<std::uint32_t>& f = world.fields().get_or_create<std::uint32_t>(params.field);
    f.data().assign(giga::kMacroCells, giga::pack_gas(0, 0, 255, 0));

    int ci = 64 | (64 << 7) | (64 << 14);

    // Make walls solid to prevent infinite diffusion from all sides, except +Z is open
    const giga::CellStep dirs[6] = { {1,0,0}, {-1,0,0}, {0,1,0}, {0,-1,0}, {0,0,1}, {0,0,-1} };
    for (int i=0; i<6; ++i) {
        if (i == 4) continue; // +Z is open
        int nx = 64 + dirs[i].x;
        int ny = 64 + dirs[i].y;
        int nz = 64 + dirs[i].z;
        int nci = nx | (ny << 7) | (nz << 14);
        for(int m=0; m<giga::kSubMaskWords; ++m) {
            world.grid().masks_mut()[nci].words[m] = ~std::uint64_t{0};
        }
    }

    
    // Fill with toxic gas
    f.data()[ci] = giga::pack_gas(255, 0, 255, 0);

    float dt = 1.0f;
    giga::gas_step(world, 0, dt, params);

    float toxic, smoke, oxy, heat;
    giga::unpack_gas(f.data()[ci], toxic, smoke, oxy, heat);

    std::fprintf(stderr, "DISPLACEMENT: oxy=%f heat=%f smoke=%f toxic=%f\n", oxy, heat, smoke, toxic);

    // Oxygen should have been displaced
    CHECK(oxy < 255.0f);
}

static void test_gas_anisotropy() {
    giga::GasParams params;
    params.buoyancy = 0.5f;

    const giga::GravityRegime regimes[] = {
        giga::GravityRegime::NegZ, giga::GravityRegime::PosZ
    };

    for (auto r : regimes) {
        giga::World world;
        world.gravity().regime = r;
        giga::Field<std::uint32_t>& f = world.fields().get_or_create<std::uint32_t>(params.field);
        f.data().assign(giga::kMacroCells, giga::pack_gas(0, 0, 255, 0));

        int cx = 64, cy = 64, cz = 64;
        int ci = cx | (cy << 7) | (cz << 14);
        
        // Spawn smoke (should rise) and toxic (should sink)
        f.data()[ci] = giga::pack_gas(250, 250, 255, 0);

        float dt = 1.0f;
        giga::gas_step(world, 0, dt, params);

        giga::CellStep d = giga::regime_down(r);
        
        // Down neighbor
        int nxDown = cx + d.x, nyDown = cy + d.y, nzDown = cz + d.z;
        int nciDown = nxDown | (nyDown << 7) | (nzDown << 14);
        float tD, sD, oD, hD;
        giga::unpack_gas(f.data()[nciDown], tD, sD, oD, hD);

        // Up neighbor
        int nxUp = cx - d.x, nyUp = cy - d.y, nzUp = cz - d.z;
        int nciUp = nxUp | (nyUp << 7) | (nzUp << 14);
        float tU, sU, oU, hU;
        giga::unpack_gas(f.data()[nciUp], tU, sU, oU, hU);

        // Smoke rises (moves UP, which is opposite of down)
        CHECK(sU > sD);
        
        // Toxic sinks (moves DOWN)
        CHECK(tD > tU);
    }
}

static void test_gas_chemistry_all() {
    test_gas_sealed_extinguish();
    test_gas_displacement();
    test_gas_anisotropy();
}

} // namespace
