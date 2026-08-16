// PADIC geometry — the dormitory tower, per the owner's sketch (2026-07-31).
//
// VERTICAL MODULE: a storey is EXACTLY 3 cells (6 m), storeys at b = 0,3,...,123.
// The top cell of each storey carries the two-slab sandwich in its top quarter:
// sub-layer sz=6 is this storey's CEILING (plaster/whitewash) and sz=7 is the
// NEXT storey's floor (lino in corridors, parquet in apartments). Two materials
// in one cell means a "sub_material" page per sandwich cell ([world/subfield.h])
// — the owner accepted that cost explicitly over splitting the sandwich across
// the cell boundary. Free interior height is 8+8+6 = 22 sub-voxels = 5.5 m.
// Cells 126..127 are the attic: a 2-cell crawl whose top carries the sandwich
// that serves as storey 0's floor (the torus wraps in z).
//
// PLAN: ONE plan shared by every storey (a real padik repeats its floorplan).
// Corridors 2 cells wide run along the elevator lattice lines (x and y ∈
// {16,17, 48,49, 80,81, 112,113}), so every lattice lobby lands on a corridor
// crossing. The 30x30 blocks between are BSP-split into apartments (solid
// walls, one entry door onto a corridor-facing perimeter edge) and each
// apartment into rooms (a door per split — kitchen/rooms parquet, the two
// smallest rooms lino: toilet and kitchen niche). Walls are thin — 2 sub-voxels
// (0.5 m), centred in their cell — and run floor to ceiling.
//
// STAIRS: the classic padik shaft, one per chosen block (staggered, 8 per
// floor): a 4x2-cell box south of an X-corridor. Two 1-cell-wide flights of 11
// steps each (rise 1/8, going 2/8) plus the landing as the 12th riser = 24
// risers = exactly one storey. Flights are 2/8-thick sloped slabs — closed
// risers, per "пролёты сплошные", but the space under them stays open, which is
// also what gives the flight above your head its 3 m of clearance. The shaft is
// vertically continuous: no sandwich over the flights, so the stairwell spirals
// the full torus. Some flights are procedurally buried under rubble.
//
// GRATES: the corridor floor strips are bars — 1/8 solid, 1/8 gap, alternating
// along x ("1/8 0 1/8 0"), with NO ceiling slab beneath, so you look down
// through them into the storey below. Bars, deliberately not a checkerboard:
// the checkerboard is the most expensive render pattern in the game
// ([voxels.md] §Rendering) and bars merge to 4 boxes a cell.
//
// HOLES: some floors are breached — ragged sub-voxel blobs (unions of discs at
// 0.25 m resolution, never neat rectangles) punched through both sandwich
// layers, varying per storey.
#include "core/rng.h"
#include "game/floors/padic/padic.h"

#include "game/floor_gen.h"
#include "game/fast_travel.h"   // kFastShaftR / kFastLobbyR — the shaft footprint
#include "sim/fluid.h"
#include "world/destruct.h" // kSubMaterialName
#include "world/lattice.h"
#include "world/materials.h"
#include "world/subfield.h"
#include "world/types.h"
#include "world/world.h"

#include <cstring>
#include <vector>

namespace giga::game {

namespace {

// ---- storey layout ---------------------------------------------------------
inline constexpr int kStorey = 3;      // cells per storey
inline constexpr int kLastBase = (kMacroDimZ > 2) ? ((kMacroDimZ - 3) / kStorey) * kStorey : 0;  // storeys at b = 0,3,...,kLastBase; top attic
inline constexpr int kCeilW = 6;       // sandwich: ceiling sub-layer == mask word 6
inline constexpr int kFloorW = 7;      // sandwich: floor sub-layer  == mask word 7

// One sz layer of a SubMask is exactly one 64-bit word (sub_bit = sx + 8*sy +
// 64*sz), so a layer-wide stamp is a single OR. These are the three patterns
// the generator lives on:
inline constexpr std::uint64_t kAllBits = ~std::uint64_t{0};
// Thin wall bits inside one layer: sy in {3,4} / sx in {3,4}.
inline constexpr std::uint64_t kWallY34 = 0x000000FFFF000000ull;
inline constexpr std::uint64_t kWallX34 = 0x1818181818181818ull;
// Grate bars: sx even, every sy row ("1/8 0 1/8 0" along x).
inline constexpr std::uint64_t kGrateBars = 0x5555555555555555ull;
// Stair entry strip: sx in [0,5) — the shared landing at the shaft mouth.
inline constexpr std::uint64_t kEntryX04 = 0x1F1F1F1F1F1F1F1Full;

// Corridor bands hug the lattice lines so every lobby is a corridor crossing.
inline constexpr int kCorr0 = kLatticeHalf; // 16: corridor cells {16,17} etc.

inline std::uint32_t lcg(std::uint32_t& s) {
    s = s * 1664525u + 1013904223u;
    return s;
}
inline int rnd(std::uint32_t& s, int lo, int hi) { // inclusive
    return lo + static_cast<int>(lcg(s) % static_cast<std::uint32_t>(hi - lo + 1));
}

struct PlanWall {
    std::uint8_t axis; // 0: wall line x==c spanning y; 1: wall line y==c spanning x
    int c;
    int a0;   // start along the span axis (wrapped)
    int len;  // cells covered (unwrapped length)
};
struct PlanStair {
    int x, y; // box cells [x, x+3] times rows {y (flight A), y+1 (flight B)}
};
struct Plan {
    std::vector<PlanWall> walls;
    std::vector<Doorway> doors;      // z ignored here; stamped per storey
    std::vector<PlanStair> stairs;
    std::vector<std::uint8_t> floorMat;  // per plan cell; 0 = open shaft column
    std::vector<std::uint8_t> grate;     // corridor grate strips
    std::vector<std::uint8_t> opening;   // doorway/entry-gap cells: no wall at z=b..b+1
    // block index (0..15) of each cell, 0xFF = corridor — hole placement uses it
    std::vector<std::uint8_t> blockOf;
};

inline std::size_t p2(int x, int y) {
    return static_cast<std::size_t>(wrap_macro(y)) * kMacroDim + wrap_macro(x);
}

// A rectangle of WALL LINES, in unwrapped coordinates (a block on the torus seam
// runs past 127 and every emitted cell wraps). Interior cells are strictly
// inside the lines.
struct Rect {
    int x0, x1, y0, y1;
};

void add_wall(Plan& p, int axis, int c, int a0, int a1) {
    p.walls.push_back({static_cast<std::uint8_t>(axis), wrap_macro(c), wrap_macro(a0),
                       a1 - a0 + 1});
}
void add_door(Plan& p, int x, int y, int axis) {
    p.doors.push_back({static_cast<std::uint16_t>(wrap_macro(x)),
                       static_cast<std::uint16_t>(wrap_macro(y)), 0, 2,
                       static_cast<std::uint8_t>(axis)});
    p.opening[p2(x, y)] = 1;
}

// Guillotine BSP. `doors`: punch a connecting door in every split wall (room
// mode); apartment mode leaves siblings solid. minSpan is in wall lines, so the
// smallest leaf interior is minSpan-1 cells.
void bsp(Plan& p, std::uint32_t& rng, Rect r, int minSpan, bool doors,
         std::vector<Rect>& leaves) {
    const int w = r.x1 - r.x0, h = r.y1 - r.y0;
    const bool canX = w >= 2 * minSpan, canY = h >= 2 * minSpan;
    if (!canX && !canY) {
        leaves.push_back(r);
        return;
    }
    bool splitX = canX;
    if (canX && canY) splitX = w > h || (w == h && (lcg(rng) & 1u));
    if (splitX) {
        const int s = r.x0 + minSpan + rnd(rng, 0, w - 2 * minSpan);
        add_wall(p, 0, s, r.y0, r.y1);
        if (doors) add_door(p, s, rnd(rng, r.y0 + 1, r.y1 - 1), 0);
        bsp(p, rng, {r.x0, s, r.y0, r.y1}, minSpan, doors, leaves);
        bsp(p, rng, {s, r.x1, r.y0, r.y1}, minSpan, doors, leaves);
    } else {
        const int s = r.y0 + minSpan + rnd(rng, 0, h - 2 * minSpan);
        add_wall(p, 1, s, r.x0, r.x1);
        if (doors) add_door(p, rnd(rng, r.x0 + 1, r.x1 - 1), s, 1);
        bsp(p, rng, {r.x0, r.x1, r.y0, s}, minSpan, doors, leaves);
        bsp(p, rng, {r.x0, r.x1, s, r.y1}, minSpan, doors, leaves);
    }
}

void fill_mat(Plan& p, const Rect& r, std::uint8_t mat, bool interiorOnly) {
    const int pad = interiorOnly ? 1 : 0;
    for (int y = r.y0 + pad; y <= r.y1 - pad; ++y)
        for (int x = r.x0 + pad; x <= r.x1 - pad; ++x)
            p.floorMat[p2(x, y)] = mat;
}

// One apartment: subdivide into rooms, tag the two smallest as wet rooms
// (lino: toilet + kitchen niche), and punch the entry door on a corridor-facing
// perimeter edge of the block.
void furnish_apartment(Plan& p, std::uint32_t& rng, const Rect& apt,
                       const Rect& block) {
    std::vector<Rect> rooms;
    bsp(p, rng, apt, 5, /*doors=*/true, rooms);
    // Two smallest rooms go lino. Plain selection sort over a handful.
    for (int pass = 0; pass < 2 && pass < static_cast<int>(rooms.size()); ++pass) {
        std::size_t best = 0;
        long bestArea = 0x7FFFFFFF;
        for (std::size_t i = 0; i < rooms.size(); ++i) {
            const long a = static_cast<long>(rooms[i].x1 - rooms[i].x0) *
                           (rooms[i].y1 - rooms[i].y0);
            if (a < bestArea) { bestArea = a; best = i; }
        }
        fill_mat(p, rooms[best], kMatLino, /*interiorOnly=*/true);
        rooms.erase(rooms.begin() + static_cast<long>(best));
    }
    // Entry: an edge lying on the block perimeter (every perimeter line faces a
    // corridor). Fallback — a landlocked apartment (rare) opens into its
    // neighbour instead: communal.
    struct Edge { int axis, c, lo, hi; };
    Edge cand[4];
    int n = 0;
    if (apt.x0 == block.x0) cand[n++] = {0, apt.x0, apt.y0, apt.y1};
    if (apt.x1 == block.x1) cand[n++] = {0, apt.x1, apt.y0, apt.y1};
    if (apt.y0 == block.y0) cand[n++] = {1, apt.y0, apt.x0, apt.x1};
    if (apt.y1 == block.y1) cand[n++] = {1, apt.y1, apt.x0, apt.x1};
    if (n == 0) cand[n++] = {0, apt.x0, apt.y0, apt.y1};
    const Edge e = cand[lcg(rng) % static_cast<std::uint32_t>(n)];
    const int at = rnd(rng, e.lo + 1, e.hi - 1);
    if (e.axis == 0) add_door(p, e.c, at, 0);
    else add_door(p, at, e.c, 1);
}

// The plan is a pure function of (seed, number) — the SAME pair every consumer
// holds. That is only safe because there is exactly ONE floor seed in the app:
// door_build now reaches floor_doorways with streamer.floor_seed_of(), the seed
// the geometry was generated from. (A second "door seed" once existed and put
// walls and doors in two different buildings — 1302 of ~26k doorways survived
// the coincidence. One floor, one seed.)
void build_plan(Plan& p, unsigned seed, int number) {
    p.floorMat.assign(static_cast<std::size_t>(kMacroDim) * kMacroDim, kMatLino);
    p.grate.assign(p.floorMat.size(), 0);
    p.opening.assign(p.floorMat.size(), 0);
    p.blockOf.assign(p.floorMat.size(), 0xFF);
    std::uint32_t rng = hash_u32(static_cast<std::uint32_t>(seed) ^
                             (static_cast<std::uint32_t>(number) * 0x9E3779B9u) ^
                             0x7AD1Cu);
    if (rng == 0) rng = 0x7AD1Cu; // an all-zero LCG stream is a degenerate plan

    // Corridor grates: bars every 16 cells along each corridor, both rows, off
    // the lattice lines (x%16 in {8,9} never hits a corridor band).
    for (int i = 0; i < kLatticeDim; ++i) {
        const int c = kCorr0 + i * kLatticeSpacing;
        for (int t = 0; t < kMacroDim; ++t) {
            if (t % 16 == 8 || t % 16 == 9) {
                p.grate[p2(t, c)] = p.grate[p2(t, c + 1)] = 1;
                p.grate[p2(c, t)] = p.grate[p2(c + 1, t)] = 1;
            }
        }
    }

    // Blocks: 4x4, each 30x30 wall lines, bounded by corridors on all sides.
    for (int bj = 0; bj < kLatticeDim; ++bj) {
        for (int bi = 0; bi < kLatticeDim; ++bi) {
            const int bx = kCorr0 + bi * kLatticeSpacing + 2;
            const int by = kCorr0 + bj * kLatticeSpacing + 2;
            const Rect block{bx, bx + 29, by, by + 29};
            const std::uint8_t bIdx =
                static_cast<std::uint8_t>(bj * kLatticeDim + bi);
            for (int y = block.y0; y <= block.y1; ++y)
                for (int x = block.x0; x <= block.x1; ++x) {
                    p.floorMat[p2(x, y)] = kMatParquet;
                    p.blockOf[p2(x, y)] = bIdx;
                }
            // Perimeter walls.
            add_wall(p, 0, block.x0, block.y0, block.y1);
            add_wall(p, 0, block.x1, block.y0, block.y1);
            add_wall(p, 1, block.y0, block.x0, block.x1);
            add_wall(p, 1, block.y1, block.x0, block.x1);

            Rect main = block;
            const bool hasStair = ((bi + bj) & 1) == 0;
            if (hasStair) {
                // Stair box on the north edge (facing the X-corridor): rows
                // by+1, by+2 between ring walls, entry gap in the perimeter.
                const int sx = bx + 13;
                p.stairs.push_back({wrap_macro(sx), wrap_macro(by + 1)});
                add_wall(p, 1, by + 3, block.x0, block.x1); // strip boundary
                add_wall(p, 0, sx - 1, by, by + 3);          // shaft ring west
                add_wall(p, 0, sx + 4, by, by + 3);          // shaft ring east
                p.opening[p2(sx, by)] = 1;                   // corridor mouth
                for (int ly = by + 1; ly <= by + 2; ++ly)
                    for (int lx = sx; lx <= sx + 3; ++lx)
                        p.floorMat[p2(lx, ly)] = 0; // open shaft column
                // The two strip remainders beside the shaft become shallow
                // corridor-facing rooms (storage, концьержки).
                std::vector<Rect> strip;
                bsp(p, rng, {block.x0, sx - 1, by, by + 3}, 6, true, strip);
                bsp(p, rng, {sx + 4, block.x1, by, by + 3}, 6, true, strip);
                for (const Rect& s : strip) {
                    const int at = rnd(rng, s.x0 + 1, s.x1 - 1);
                    add_door(p, at, by, 1); // each opens onto the corridor
                }
                main.y0 = by + 3;
            }

            // Apartments (solid between), then rooms (doored) inside each.
            std::vector<Rect> apts;
            bsp(p, rng, main, 9, /*doors=*/false, apts);
            for (const Rect& a : apts) furnish_apartment(p, rng, a, block);
        }
    }
}

// ---- grid stamping -----------------------------------------------------------

// OR `bits` into layer word `wz` of cell (x,y,z) as material `mat`. Pages are
// created only when a second material genuinely lands in the cell, and a page's
// content is fully deterministic — the render stretch relies on byte-identical
// pages ([render/cube_pass.cpp]).
void put_bits(MacroGrid& g, SubField<CellType>& sm, int x, int y, int z, int wz,
              std::uint64_t bits, CellType mat) {
    if (bits == 0 || z < 0 || z >= kMacroDimZ) return;
    x = wrap_macro(x);
    y = wrap_macro(y);
    const std::size_t ci = macro_index(x, y, z);
    SubMask& m = g.mask(x, y, z);
    const CellType cur = g.cell(x, y, z);
    CellType* page = sm.page(ci);
    if (!page && cur == kCellAir) {
        g.set_cell(x, y, z, mat);
    } else if (page || cur != mat) {
        CellType* pg = page ? page : sm.ensure_page(ci, cur);
        for (int i = 0; i < 64; ++i)
            if ((bits >> i) & 1u) pg[wz * 64 + i] = mat;
    }
    m.words[wz] |= bits;
}

void put_sub(MacroGrid& g, SubField<CellType>& sm, int cx, int cy, int baseZ,
             int SX, int SY, int L, CellType mat) {
    if (L < 0) return;
    const int wz = L & 7;
    const std::uint64_t bit = std::uint64_t{1}
                              << ((SX & 7) + (SY & 7) * kSubDim);
    put_bits(g, sm, cx + (SX >> 3), cy + (SY >> 3), baseZ + (L >> 3), wz, bit,
             mat);
}

// The sandwich of one storey, at cell layer zc (== b+2, or 127 for the attic).
void stamp_sandwich(MacroGrid& g, SubField<CellType>& sm, const Plan& p,
                    int zc) {
    for (int y = 0; y < kMacroDim; ++y) {
        for (int x = 0; x < kMacroDim; ++x) {
            const std::size_t i2 = p2(x, y);
            const std::uint8_t mat = p.floorMat[i2];
            if (mat == 0) continue; // stair shaft: open, landings stamped there
            if (p.grate[i2]) {
                // Bars with nothing underneath: look straight down a storey.
                put_bits(g, sm, x, y, zc, kFloorW, kGrateBars,
                         kMatElectricGrate);
                continue;
            }
            put_bits(g, sm, x, y, zc, kFloorW, kAllBits,
                     static_cast<CellType>(mat));
            put_bits(g, sm, x, y, zc, kCeilW, kAllBits, kMatPlaster);
        }
    }
}

// Thin walls, floor to ceiling (22 sub-voxels), with door/entry gaps at
// z = b..b+1 and the lintel kept at b+2.
void stamp_walls(MacroGrid& g, SubField<CellType>& sm, const Plan& p, int b) {
    for (const PlanWall& w : p.walls) {
        const std::uint64_t pat = w.axis == 0 ? kWallX34 : kWallY34;
        for (int k = 0; k < w.len; ++k) {
            const int x = w.axis == 0 ? w.c : wrap_macro(w.a0 + k);
            const int y = w.axis == 0 ? wrap_macro(w.a0 + k) : w.c;
            const bool gap = p.opening[p2(x, y)] != 0;
            if (!gap) {
                for (int wz = 0; wz < 8; ++wz) {
                    put_bits(g, sm, x, y, b, wz, pat, kMatPlaster);
                    put_bits(g, sm, x, y, b + 1, wz, pat, kMatPlaster);
                }
            }
            for (int wz = 0; wz < 6; ++wz) {
                const CellType lintelMat = (gap && wz < 2) ? kMatDoor : kMatPlaster;
                put_bits(g, sm, x, y, b + 2, wz, pat, lintelMat);
            }
        }
    }
}

// One stairwell for one storey: two 11-step flights of 2/8-thick sloped slab,
// the mid landing as the 12th riser (level 12, 3 m), arrival at level 24 onto
// the entry strip stamped into the sandwich layer. Hash-chosen flights are
// buried under rubble.
void stamp_stair(MacroGrid& g, SubField<CellType>& sm, const PlanStair& st,
                 int b, std::uint32_t storeyHash) {
    const int X = st.x, Y = st.y;
    // Flight A (row Y, sub rows 0..7), rising +x: step i tops out at level i.
    for (int i = 1; i <= 11; ++i) {
        for (int dx = 0; dx < 2; ++dx) {
            const int SX = 5 + 2 * (i - 1) + dx;
            for (int SY = 0; SY < 8; ++SY)
                for (int L = i - 2; L < i; ++L)
                    put_sub(g, sm, X, Y, b, SX, SY, L, kMatConcrete);
        }
    }
    // Mid landing: both rows, level 12 top, 2/8 thick.
    for (int SX = 27; SX < 32; ++SX)
        for (int SY = 0; SY < 16; ++SY)
            for (int L = 10; L < 12; ++L)
                put_sub(g, sm, X, Y, b, SX, SY, L, kMatConcrete);
    // Flight B (row Y+1, sub rows 8..15), rising -x from the mid landing.
    for (int k = 1; k <= 11; ++k) {
        for (int dx = 0; dx < 2; ++dx) {
            const int SX = 27 - 2 * k + dx;
            for (int SY = 8; SY < 16; ++SY)
                for (int L = 10 + k; L < 12 + k; ++L)
                    put_sub(g, sm, X, Y, b, SX, SY, L, kMatConcrete);
        }
    }
    // Entry strip: the shared landing at the shaft mouth — this storey's slab
    // at b+2 is the level-24 arrival of THIS storey's climb and the departure
    // landing of the storey above. Concrete both layers: uniform, no page.
    for (int row = 0; row < 2; ++row) {
        put_bits(g, sm, X, Y + row, b + 2, kCeilW, kEntryX04, kMatConcrete);
        put_bits(g, sm, X, Y + row, b + 2, kFloorW, kEntryX04, kMatConcrete);
    }
    // Procedural blockage: ~1 flight in 7 is buried. A 2 m stepped rubble mound
    // over the middle steps — impassable without carving through it.
    if ((storeyHash & 7u) == 0u) {
        const bool onA = (storeyHash & 8u) == 0u;
        for (int i = 4; i <= 8; ++i) {
            for (int dx = 0; dx < 2; ++dx) {
                const int SX = onA ? 5 + 2 * (i - 1) + dx : 27 - 2 * i + dx;
                const int SY0 = onA ? 0 : 8;
                const int Lb = onA ? i : 12 + i;
                for (int SY = SY0; SY < SY0 + 8; ++SY)
                    for (int L = Lb; L < Lb + 8; ++L)
                        put_sub(g, sm, X, Y, b, SX, SY, L, kMatRubble);
            }
        }
    }
}

// Ragged holes: unions of discs at sub-voxel resolution punched through both
// sandwich layers — "не просто квадраты". Varies per storey by hash.
void punch_holes(MacroGrid& g, SubField<CellType>& sm, const Plan& p, int zc,
                 std::uint32_t h) {
    for (int blk = 0; blk < kLatticeDim * kLatticeDim; ++blk) {
        std::uint32_t r = hash_u32(h ^ (0xB10Cu + static_cast<std::uint32_t>(blk)));
        if ((r % 5u) >= 2u) continue; // 40% of blocks per storey get one hole
        const int bi = blk % kLatticeDim, bj = blk / kLatticeDim;
        const int bx = kCorr0 + bi * kLatticeSpacing + 2;
        const int by = kCorr0 + bj * kLatticeSpacing + 2;
        // Blob centre, in unwrapped sub-voxel coordinates, well inside the block.
        r = hash_u32(r);
        const int cxs = (bx + 4 + static_cast<int>(r % 22u)) * kSubDim + 4;
        r = hash_u32(r);
        const int cys = (by + 4 + static_cast<int>(r % 22u)) * kSubDim + 4;
        struct Disc { int x, y, r; };
        Disc d[4];
        r = hash_u32(r);
        const int nd = 2 + static_cast<int>(r % 3u);
        int reach = 0;
        for (int k = 0; k < nd; ++k) {
            r = hash_u32(r);
            d[k].x = cxs + static_cast<int>(r % 17u) - 8;
            r = hash_u32(r);
            d[k].y = cys + static_cast<int>(r % 17u) - 8;
            r = hash_u32(r);
            d[k].r = 5 + static_cast<int>(r % 8u);
            const int e = (k == 0 ? 0 : 8) + d[k].r;
            if (e > reach) reach = e;
        }
        const int c0x = (cxs - reach) >> 3, c1x = (cxs + reach) >> 3;
        const int c0y = (cys - reach) >> 3, c1y = (cys + reach) >> 3;
        for (int cy = c0y; cy <= c1y; ++cy) {
            for (int cx = c0x; cx <= c1x; ++cx) {
                if (p.floorMat[p2(cx, cy)] == 0) continue; // stair shaft
                std::uint64_t cut = 0;
                for (int sy = 0; sy < kSubDim; ++sy)
                    for (int sx = 0; sx < kSubDim; ++sx) {
                        const int ax = cx * kSubDim + sx, ay = cy * kSubDim + sy;
                        for (int k = 0; k < nd; ++k) {
                            const int dx = ax - d[k].x, dy = ay - d[k].y;
                            if (dx * dx + dy * dy <= d[k].r * d[k].r) {
                                cut |= std::uint64_t{1} << (sx + sy * kSubDim);
                                break;
                            }
                        }
                    }
                if (!cut) continue;
                const int wx = wrap_macro(cx), wy = wrap_macro(cy);
                SubMask& m = g.mask(wx, wy, zc);
                m.words[kCeilW] &= ~cut;
                m.words[kFloorW] &= ~cut;
                if (m.empty()) {
                    const std::size_t ci = macro_index(wx, wy, zc);
                    g.clear_cell(wx, wy, zc);
                    sm.drop_page(ci);
                }
            }
        }
    }
}

// The mandatory fast-travel lattice ([torus-nav-baking]): open shaft columns,
// lobbies cleared per storey, hub pads and the four corner posts.
void stamp_lattice(MacroGrid& g, SubField<CellType>& sm, int number) {
    // The radii come from [game/fast_travel.h], not from locals here. They used to be
    // locals, and that made the geometry and the "are you at a shaft" test two
    // independent numbers that happened to agree — the same shape as
    // padic_module.cpp's local `kLatticeDim`, which shadows the real one and would
    // not follow a change to it.
    constexpr int kShaftR = kFastShaftR;
    constexpr int kLobbyR = kFastLobbyR;
    for (int ny = 0; ny < kLatticeDim; ++ny) {
        for (int nx = 0; nx < kLatticeDim; ++nx) {
            const int cx = lattice_coord(nx);
            const int cy = lattice_coord(ny);
            for (int z = 0; z < kMacroDimZ; ++z)
                for (int dy = -kShaftR; dy <= kShaftR; ++dy)
                    for (int dx = -kShaftR; dx <= kShaftR; ++dx) {
                        const int x = wrap_macro(cx + dx), y = wrap_macro(cy + dy);
                        g.clear_cell(x, y, z);
                        sm.drop_page(macro_index(x, y, z));
                    }
            for (int b = 0; b <= kLastBase; b += kStorey) {
                for (int dy = -kLobbyR; dy <= kLobbyR; ++dy)
                    for (int dx = -kLobbyR; dx <= kLobbyR; ++dx) {
                        const int x = wrap_macro(cx + dx), y = wrap_macro(cy + dy);
                        for (int z = b; z < b + 2; ++z) {
                            g.clear_cell(x, y, z);
                            sm.drop_page(macro_index(x, y, z));
                        }
                        // b+2: strip wall lintels, keep the sandwich — the
                        // lobby keeps its ceiling and the storey above keeps
                        // its floor.
                        SubMask& m = g.mask(x, y, b + 2);
                        for (int wz = 0; wz < 6; ++wz) m.words[wz] = 0;
                        if (m.empty()) {
                            g.clear_cell(x, y, b + 2);
                            sm.drop_page(macro_index(x, y, b + 2));
                        }
                    }
            }
            // Hub pads: recolour whatever is solid at the node layers. A paged
            // cell recolours by dropping the page — the pad marker wins.
            for (int nz = 0; nz < kLatticeDim; ++nz) {
                const int z0 = lattice_coord_z(nz);
                for (int dy = -kLobbyR; dy <= kLobbyR; ++dy)
                    for (int dx = -kLobbyR; dx <= kLobbyR; ++dx) {
                        const int x = wrap_macro(cx + dx), y = wrap_macro(cy + dy);
                        if (g.cell(x, y, z0) != kCellAir) {
                            sm.drop_page(macro_index(x, y, z0));
                            g.set_cell(x, y, z0, kMatHubPad);
                        }
                    }
            }
            if (number == 0) {
                // Extraction marker: the walking floor of storey 0 is the attic
                // sandwich at z=127 — recolour it, plus whatever stands at z=0.
                for (int dy = -kLobbyR; dy <= kLobbyR; ++dy)
                    for (int dx = -kLobbyR; dx <= kLobbyR; ++dx) {
                        const int x = wrap_macro(cx + dx), y = wrap_macro(cy + dy);
                        for (const int z : {0, kMacroDimZ - 1})
                            if (g.cell(x, y, z) != kCellAir) {
                                sm.drop_page(macro_index(x, y, z));
                                g.set_cell(x, y, z, kMatExtract);
                            }
                    }
            }
            for (int sy = -1; sy <= 1; sy += 2)
                for (int sx = -1; sx <= 1; sx += 2)
                    for (int z = 0; z < kMacroDimZ; ++z) {
                        const int x = wrap_macro(cx + sx * 2);
                        const int y = wrap_macro(cy + sy * 2);
                        sm.drop_page(macro_index(x, y, z));
                        g.fill_cell(x, y, z, kMatHubPad);
                    }
        }
    }
}

} // namespace

// THE MODULE'S LAWS, declared BEFORE any geometry exists.
//
// A floor is a sub-game with its own rules ([floors.md]); this is where it says
// what they are. Split out of the generator on 2026-08-06 because the two were
// fused, and that fusion is what forced a visited floor to be GENERATED before
// its snapshot could be laid over it: the frame lives here, the voxels do not,
// so a restored floor can now get its laws without rebuilding geometry it is
// about to throw away.
//
// Runs on EVERY floor entry, generated or restored. Idempotent by construction:
// get_or_create returns the resident registry, and the frame is two assignments.
void padic_declare_rules(World& world, int /*number*/, const FloorSpec& /*spec*/,
                         unsigned /*seed*/) {
    // The sub-material registry has to exist before either geometry writer —
    // the generator's put_bits or the snapshot reader's ensure_page — touches it.
    world.subfields().get_or_create<CellType>(kSubMaterialName);

    // The regime is runtime state ([world/gravity.h]) — this is its entry-time
    // default; the game may flip it later and consumers re-read it, they never
    // cache the module constant. It is NOT in the floor snapshot, and must not
    // be: gravity is a property of the MODULE, not of the saved bytes.
    world.gravity().global = vec3{0.0f, 0.0f, -9.81f};
    world.gravity().regime = kPadicGravity;
}

// THE MODULE'S RULES LAID ON TOP OF FINISHED GEOMETRY.
//
// Runs after the floor exists, whether it was generated fresh or restored from a
// snapshot — so a revisited floor gets its water and gas back even though the
// snapshot carries geometry only. Positions come from the module's own lattice
// and plan, not from reading the grid, so this is deterministic in
// (seed, number) exactly like the geometry and the doorways are.
void padic_apply_rules(World& world, int number, const FloorSpec& /*spec*/,
                       unsigned seed) {
    Plan p;
    build_plan(p, seed, number);

    // Seed water and gas fluids in staircases and elevator shafts
    Field<float>* wet = world.fields().find<float>(kFluidField);
    if (wet == nullptr) wet = &world.fields().get_or_create<float>(kFluidField, 0.0f);
    else wet->fill(0.0f);

    Field<float>* gas = world.fields().find<float>(kGasField);
    if (gas == nullptr) gas = &world.fields().get_or_create<float>(kGasField, 0.0f);
    else gas->fill(0.0f);

    // Seed water in lattice elevator pit (z=0..2) and stair landing sumps
    for (int ny = 0; ny < kLatticeDim; ++ny) {
        for (int nx = 0; nx < kLatticeDim; ++nx) {
            int cx = lattice_coord(nx);
            int cy = lattice_coord(ny);
            for (int z = 0; z <= 2; ++z) {
                std::size_t idx = macro_index(wrap_macro(cx), wrap_macro(cy), z);
                wet->data()[idx] = 0.8f;
            }
        }
    }
    for (const PlanStair& st : p.stairs) {
        for (int row = 0; row < 2; ++row) {
            for (int dx = 0; dx < 4; ++dx) {
                std::size_t idx = macro_index(wrap_macro(st.x + dx), wrap_macro(st.y + row), 1);
                wet->data()[idx] = 0.5f;
            }
        }
    }

    // Seed buoyant gas in elevator shafts (z=3..15)
    for (int ny = 0; ny < kLatticeDim; ++ny) {
        for (int nx = 0; nx < kLatticeDim; ++nx) {
            int cx = lattice_coord(nx);
            int cy = lattice_coord(ny);
            for (int z = 3; z <= 15; ++z) {
                std::size_t idx = macro_index(wrap_macro(cx), wrap_macro(cy), z);
                gas->data()[idx] = 0.6f;
            }
        }
    }

}

void generate_padic_floor(World& world, int number, const FloorSpec& spec,
                          unsigned seed) {
    MacroGrid& g = world.grid();
    SubField<CellType>& sm =
        world.subfields().get_or_create<CellType>(kSubMaterialName);

    // Clear to air — including stale material pages from the floor this World
    // object held before (floor streaming recycles Worlds in place).
    sm.clear();
    for (int z = 0; z < kMacroDimZ; ++z)
        for (int y = 0; y < kMacroDimY; ++y)
            for (int x = 0; x < kMacroDimX; ++x) g.clear_cell(x, y, z);

    Plan p;
    build_plan(p, seed, number);
    // Every sandwich cell will page (ceiling != floor material by design).
    sm.reserve_pages(700000);

    const std::uint32_t floorSalt =
        hash_u32(static_cast<std::uint32_t>(seed) ^
             (static_cast<std::uint32_t>(number) * 0x51ED270Bu));

    for (int b = 0; b <= kLastBase; b += kStorey) {
        const std::uint32_t sh = hash_u32(floorSalt ^ static_cast<std::uint32_t>(b));
        stamp_sandwich(g, sm, p, b + 2);
        punch_holes(g, sm, p, b + 2, sh);
        stamp_walls(g, sm, p, b);
        for (std::size_t s = 0; s < p.stairs.size(); ++s)
            stamp_stair(g, sm, p.stairs[s], b,
                        hash_u32(sh ^ (0x57A12u + static_cast<std::uint32_t>(s))));
    }
    // Attic: the 2-cell crawl whose sandwich is storey 0's floor. No holes —
    // the arrival floor stays solid. Stair entry strips so the ground-storey
    // landings have something to stand on.
    stamp_sandwich(g, sm, p, kMacroDimZ - 1);
    for (const PlanStair& st : p.stairs)
        for (int row = 0; row < 2; ++row) {
            put_bits(g, sm, st.x, st.y + row, kMacroDimZ - 1, kCeilW, kEntryX04,
                     kMatConcrete);
            put_bits(g, sm, st.x, st.y + row, kMacroDimZ - 1, kFloorW, kEntryX04,
                     kMatConcrete);
        }

    stamp_lattice(g, sm, number);

    (void)spec.population; // geometry ignores population; the seeder consumes it
}

std::uint32_t padic_doorways(int number, unsigned seed,
                             std::vector<Doorway>& out) {
    Plan p;
    build_plan(p, seed, number);
    std::uint32_t n = 0;
    for (int b = 0; b <= kLastBase; b += kStorey)
        for (const Doorway& d : p.doors) {
            Doorway w = d;
            w.cz = static_cast<std::uint8_t>(b);
            w.h = 2;
            out.push_back(w);
            ++n;
        }
    return n;
}

} // namespace giga::game
