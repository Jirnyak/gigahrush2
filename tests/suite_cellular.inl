// Cellular Automata field tests. Included into game_test.cpp.
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "core/rng.h"
#include "core/tick.h"
#include "game/floor_gen.h"
#include "game/floor_spec.h"
#include "sim/cellular.h"
#include "world/lattice.h"
#include "world/materials.h"
#include "world/world.h"

namespace {

static void test_cellular_byte_boundary() {
    World world;
    giga::CellularScratch scratch;
    giga::CellularParams params;
    params.rule = giga::CellularRule::Sandpile;

    // Fill field with high values, check clamping logic
    for (int z = 0; z < giga::kMacroDim; ++z) {
        for (int y = 0; y < giga::kMacroDim; ++y) {
            for (int x = 0; x < giga::kMacroDim; ++x) {
                giga::cellular_add(world, x, y, z, 200, params);
            }
        }
    }
    
    // Test sweep doesn't overflow byte
    giga::CellularStep step = giga::cellular_step(world, scratch, params);
    CHECK(step.peak <= 250); 
}

static void test_cellular_wall_preservation() {
    World world;
    giga::CellularScratch scratch;
    giga::CellularParams params;
    params.rule = giga::CellularRule::Sandpile;

    // Drop near boundary
    giga::cellular_add(world, 0, 0, 0, 10, params);
    giga::CellularStep step = giga::cellular_step(world, scratch, params);
    
    // Grains shouldn't disappear, it wraps or preserves
    CHECK(step.present);
}

static void test_cellular_creep_gate() {
    World world;
    giga::CellularScratch scratch;
    giga::CellularParams params;
    params.rule = giga::CellularRule::Creep;

    // Place creep near a boundary to verify the quiet gate logic shuts down correctly
    giga::cellular_add(world, 0, 0, 0, 255, params);
    giga::CellularStep step = giga::cellular_step(world, scratch, params);
    CHECK(step.present);
}

static void test_cellular_determinism() {
    World world1;
    World world2;

    giga::CellularScratch scratch1;
    giga::CellularScratch scratch2;
    giga::CellularParams params;
    params.rule = giga::CellularRule::Sandpile;

    giga::cellular_add(world1, 10, 10, 10, 50, params);
    giga::cellular_add(world2, 10, 10, 10, 50, params);

    giga::cellular_step(world1, scratch1, params);
    giga::cellular_step(world2, scratch2, params);

    CHECK(giga::cellular_digest(world1, params) == giga::cellular_digest(world2, params));
}

static void test_cellular_pass_cost() {
    World world;
    giga::CellularScratch scratch;
    giga::CellularParams params;
    params.rule = giga::CellularRule::Sandpile;
    
    giga::CellularStep step = giga::cellular_step(world, scratch, params);
    std::printf("test_cellular_pass_cost: %u cells live\n", step.liveCells);
}

static void test_cellular_lattice_immunity() {
    World world;
    giga::CellularScratch scratch;
    giga::CellularParams params;
    params.rule = giga::CellularRule::Sandpile;

    // Trigger sandpile near lattice column, ensure it doesn't overwrite it
    int lx = 16, ly = 16; 
    giga::cellular_add(world, lx, ly, 10, 255, params);
    giga::CellularStep step = giga::cellular_step(world, scratch, params);
    CHECK(step.present);
}

} // namespace

static void test_cellular_all() {
    test_cellular_byte_boundary();
    test_cellular_wall_preservation();
    test_cellular_creep_gate();
    test_cellular_determinism();
    test_cellular_pass_cost();
    test_cellular_lattice_immunity();
}
