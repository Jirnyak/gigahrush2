// KHRUSHI geometry — the open microdistrict.
//
// Stage pipeline (each stage is a pure function of (seed, number)):
//
//   1. street slab   — one FULL cell of concrete at z = kKhrushiSlabZ across
//                      the whole torus; its top face is the street the player
//                      stands on (z = 3 = kArrivalCoord), its bottom face is
//                      the "sky" the courtyards see far overhead through the
//                      z-wrap. Nothing above it but what the city raises.
//   2. city plan     — (next increments) avenues + sidewalks + squares pitched
//                      to the fast-travel lattice, building footprints per
//                      quarter, blocks raised storey by storey.
//
// Sub-voxel stamping helpers are repeated from padic_gen.cpp on purpose —
// modularity beats DRY ([padic.h] states the law).
#include "game/floors/khrushi/khrushi.h"

#include "game/floor_gen.h"
#include "world/destruct.h" // kSubMaterialName
#include "world/materials.h"
#include "world/subfield.h"
#include "world/types.h"
#include "world/world.h"

namespace giga::game {

namespace {

// ---- grid stamping (same contract as padic_gen.cpp put_bits) ---------------

// OR `bits` into layer word `wz` of cell (x,y,z) as material `mat`. Pages are
// created only when a second material genuinely lands in the cell; unmasked
// page atoms are backfilled to air (S16.1 read law — see padic_gen.cpp).
void put_bits(MacroGrid& g, SubField<CellType>& sm, int x, int y, int z, int wz,
              std::uint64_t bits, CellType mat) {
    if (bits == 0 || z < 0 || z >= kMacroDim) return;
    x = wrap_macro(x);
    y = wrap_macro(y);
    const std::size_t ci = macro_index(x, y, z);
    SubMask& m = g.mask(x, y, z);
    const CellType cur = g.cell(x, y, z);
    CellType* page = sm.page(ci);
    if (!page && cur == kCellAir) {
        g.set_cell(x, y, z, mat);
    } else if (page || cur != mat) {
        CellType* pg = page;
        if (!pg) {
            pg = sm.ensure_page(ci, cur);
            for (int i = 0; i < kSubVoxels; ++i)
                if (!m.test(i)) pg[i] = kCellAir;
        }
        for (int i = 0; i < 64; ++i)
            if ((bits >> i) & 1u) pg[wz * 64 + i] = mat;
    }
    m.words[wz] |= bits;
}

// A full cell of one material: 8 layer words in one call.
void put_cell(MacroGrid& g, SubField<CellType>& sm, int x, int y, int z,
              CellType mat) {
    for (int wz = 0; wz < kSubDim; ++wz)
        put_bits(g, sm, x, y, z, wz, ~std::uint64_t{0}, mat);
}

} // namespace

void khrushi_declare_rules(World& world, int /*number*/,
                           const FloorSpec& /*spec*/, unsigned /*seed*/) {
    // The sub-material registry has to exist before either geometry writer —
    // the generator's put_bits or the snapshot reader's ensure_page.
    world.subfields().get_or_create<CellType>(kSubMaterialName);
    world.gravity().global = vec3{0.0f, 0.0f, -9.81f};
    world.gravity().regime = kKhrushiGravity;
}

void khrushi_apply_rules(World& /*world*/, int /*number*/,
                         const FloorSpec& /*spec*/, unsigned /*seed*/) {
    // No standing media yet. Courtyard puddles are a later increment.
}

void generate_khrushi_floor(World& world, int number, const FloorSpec& spec,
                            unsigned seed) {
    MacroGrid& g = world.grid();
    SubField<CellType>& sm =
        world.subfields().get_or_create<CellType>(kSubMaterialName);

    // Clear to air — including stale material pages from the floor this World
    // object held before (floor streaming recycles Worlds in place).
    sm.clear();
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x) g.clear_cell(x, y, z);

    // Stage 1 — the street slab: one full cell of concrete across the torus.
    // Full-cell cells carry no page (single material), so this is cheap.
    for (int y = 0; y < kMacroDim; ++y)
        for (int x = 0; x < kMacroDim; ++x)
            put_cell(g, sm, x, y, kKhrushiSlabZ, kMatConcrete);

    (void)number;
    (void)seed;
    (void)spec.population; // geometry ignores population; the seeder consumes it
}

} // namespace giga::game
