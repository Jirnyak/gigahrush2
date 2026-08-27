// KHRUSHI geometry — the open microdistrict.
//
// Stage pipeline (each stage is a pure function of (seed, number)):
//
//   1. street slab   — one FULL cell of concrete at z = kKhrushiSlabZ across
//                      the whole torus; its top face is the street the player
//                      stands on (z = 3 = kArrivalCoord), its bottom face is
//                      the "sky" the courtyards see far overhead through the
//                      z-wrap. Nothing above it but what the city raises.
//   2. city plan     — the ground SURFACE COURSE, one sub-layer over the slab
//                      (an honest road build-up: wearing course over plate).
//                      Avenues run ALONG the lattice lines, so every road
//                      crossing IS a fast-travel hub — the intersection
//                      becomes a square with the hub pad. Quarters between
//                      the roads are 24×24 cells (48×48 m): yards by default,
//                      ~1 in 4 a park.
//   3. blocks        — (next increments) building footprints per quarter,
//                      ten-storey khrushchevkas raised storey by storey.
//
// Sub-voxel stamping helpers are repeated from padic_gen.cpp on purpose —
// modularity beats DRY ([padic.h] states the law).
#include "core/rng.h"
#include "game/floors/khrushi/khrushi.h"

#include "game/fast_travel.h" // kFastLobbyR — the hub square footprint
#include "game/floor_gen.h"
#include "world/destruct.h" // kSubMaterialName
#include "world/lattice.h"
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

// ---- the city plan ---------------------------------------------------------
//
// Avenues run along BOTH axes on the lattice lines (centres {16,48,80,112}),
// so the road crossings coincide with the 16 fast-travel hubs and each
// crossing is a small square with the pad. Widths are derived, not styled:
// a road is two 4 m lanes = 4 cells, a sidewalk is 4 m = 2 cells (enough for
// two 0.8 m bodies to pass with margin and for lamp poles at the kerb).
inline constexpr int kRoadHalfLo = -2; // road cells rc-2 .. rc+1 (4 wide)
inline constexpr int kRoadHalfHi = 1;
inline constexpr int kWalkW = 2;       // sidewalk band beyond the road edge
// Quarter between two roads: [rc+2+kWalkW, rc+32-2-kWalkW) = 24 cells.
inline constexpr int kQuarterOrigin = 16 + kRoadHalfHi + 1 + kWalkW; // 20
inline constexpr int kQuarterSpan = kLatticeSpacing - (kRoadHalfHi - kRoadHalfLo + 1) - 2 * kWalkW; // 24

// What covers the top sub-layer of the street slab at (x,y).
enum SurfKind : std::uint8_t {
    kSurfYard = 0, // courtyard ground — soil over the plate
    kSurfRoad,     // asphalt wearing course
    kSurfWalk,     // sidewalk slabs
    kSurfPark,     // park ground — soil (kept distinct for later dressing)
    kSurfPath,     // paved path through a park / yard
    kSurfPad,      // fast-travel square — the pad, full cell, unbreakable
};

struct CityPlan {
    std::uint8_t surf[kMacroDim * kMacroDim];
    bool park[kLatticeDim * kLatticeDim]; // quarter (qi,qj) is a park square
};

inline std::size_t p2(int x, int y) {
    return static_cast<std::size_t>(wrap_macro(y)) * kMacroDim +
           static_cast<std::size_t>(wrap_macro(x));
}

// Signed offset of coordinate c from its nearest road centre line.
inline int road_delta(int c) {
    const int rc = lattice_coord(lattice_axis_of(c));
    return wrap_delta(rc, c, kMacroDim);
}

inline bool in_road_band(int d) { return d >= kRoadHalfLo && d <= kRoadHalfHi; }
inline bool in_walk_band(int d) {
    return (d >= kRoadHalfLo - kWalkW && d < kRoadHalfLo) ||
           (d > kRoadHalfHi && d <= kRoadHalfHi + kWalkW);
}

// Quarter index of an interior cell (valid when the cell is off the bands).
inline int quarter_of(int c) {
    return ((c - kQuarterOrigin) & (kMacroDim - 1)) / kLatticeSpacing;
}

void build_city_plan(CityPlan& p, unsigned seed, int number) {
    const std::uint32_t salt =
        hash_u32(static_cast<std::uint32_t>(seed) ^
                 (static_cast<std::uint32_t>(number) * 0x9E3779B9u) ^ 0xC17Au);

    // ~1 in 4 quarters is a park: 4 of 16, picked by pure hash per quarter.
    for (int qj = 0; qj < kLatticeDim; ++qj)
        for (int qi = 0; qi < kLatticeDim; ++qi)
            p.park[qj * kLatticeDim + qi] =
                (hash_u32(salt ^ static_cast<std::uint32_t>(qj * kLatticeDim + qi) * 0x85EBCA6Bu) & 3u) == 0u;

    for (int y = 0; y < kMacroDim; ++y) {
        const int dy = road_delta(y);
        for (int x = 0; x < kMacroDim; ++x) {
            const int dx = road_delta(x);
            std::uint8_t s;
            if (in_road_band(dx) && in_road_band(dy)) {
                s = kSurfRoad; // crossing; the hub square recolours below
            } else if (in_road_band(dx) || in_road_band(dy)) {
                s = kSurfRoad;
            } else if (in_walk_band(dx) || in_walk_band(dy)) {
                s = kSurfWalk;
            } else {
                const int qi = quarter_of(x), qj = quarter_of(y);
                const bool park = p.park[qj * kLatticeDim + qi];
                s = park ? kSurfPark : kSurfYard;
                if (park) {
                    // Park paths: a paved cross through the quarter centre,
                    // 2 cells wide, kerb to kerb.
                    const int lx = (x - kQuarterOrigin) & (kMacroDim - 1);
                    const int ly = (y - kQuarterOrigin) & (kMacroDim - 1);
                    const int mx = lx % kLatticeSpacing, my = ly % kLatticeSpacing;
                    const int mid = kQuarterSpan / 2; // 12: path cells 11..12
                    if (mx == mid - 1 || mx == mid || my == mid - 1 || my == mid)
                        s = kSurfPath;
                }
            }
            p.surf[p2(x, y)] = s;
        }
    }

    // The 16 hub squares: the fast-travel pad footprint (7×7, kFastLobbyR)
    // replaces the crossing surface — geometry and the boarding test agree
    // through fast_travel.h, never through a local copy.
    for (int nj = 0; nj < kLatticeDim; ++nj)
        for (int ni = 0; ni < kLatticeDim; ++ni) {
            const int cx = lattice_coord(ni), cy = lattice_coord(nj);
            for (int oy = -kFastLobbyR; oy <= kFastLobbyR; ++oy)
                for (int ox = -kFastLobbyR; ox <= kFastLobbyR; ++ox)
                    p.surf[p2(cx + ox, cy + oy)] = kSurfPad;
        }
}

// Materials the surface course stamps, per SurfKind.
inline CellType surf_mat(std::uint8_t s) {
    switch (s) {
        case kSurfRoad: return kMatAsphalt;
        case kSurfWalk: return kMatSlabTan;
        case kSurfPark: return kMatSoil;
        case kSurfPath: return kMatSlabTan;
        case kSurfYard: return kMatSoil;
        default: return kMatHubPad;
    }
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

    CityPlan plan;
    build_city_plan(plan, seed, number);

    // Surface-course cells page (two materials); the rest stay single-material.
    sm.reserve_pages(32768);

    // Stages 1+2 — the street slab and its surface course. The slab is one
    // full cell of concrete; the covering (asphalt / sidewalk slabs / soil)
    // is the TOP sub-layer only — 0.25 m of wearing course over the plate,
    // so a carve reveals concrete and the slab's underside (the "sky") stays
    // concrete everywhere. Hub squares are the exception: the pad is the
    // full unbreakable cell, exactly like padic's pads.
    for (int y = 0; y < kMacroDim; ++y)
        for (int x = 0; x < kMacroDim; ++x) {
            const std::uint8_t s = plan.surf[p2(x, y)];
            if (s == kSurfPad) {
                put_cell(g, sm, x, y, kKhrushiSlabZ, kMatHubPad);
                continue;
            }
            for (int wz = 0; wz < kSubDim - 1; ++wz)
                put_bits(g, sm, x, y, kKhrushiSlabZ, wz, ~std::uint64_t{0},
                         kMatConcrete);
            put_bits(g, sm, x, y, kKhrushiSlabZ, kSubDim - 1, ~std::uint64_t{0},
                     surf_mat(s));
        }

    // Hub square corner bollards: one cell tall, at the pad's corners — the
    // square reads as a stop from street level without blocking the cabin.
    for (int nj = 0; nj < kLatticeDim; ++nj)
        for (int ni = 0; ni < kLatticeDim; ++ni) {
            const int cx = lattice_coord(ni), cy = lattice_coord(nj);
            for (int sy = -1; sy <= 1; sy += 2)
                for (int sx = -1; sx <= 1; sx += 2)
                    put_cell(g, sm, cx + sx * kFastLobbyR, cy + sy * kFastLobbyR,
                             kKhrushiGroundCoord, kMatHubPad);
        }

    (void)spec.population; // geometry ignores population; the seeder consumes it
}

} // namespace giga::game
