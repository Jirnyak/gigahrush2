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

#include "game/antourage/antourage.h" // AntourageBake, WireChain — street wires
#include "game/fast_travel.h" // kFastLobbyR — the hub square footprint
#include "game/floor_gen.h"
#include "world/anchor.h"   // anchor_face_pack — the wire's attachment face
#include "world/destruct.h" // kSubMaterialName
#include "world/lattice.h"
#include "world/materials.h"
#include "world/subfield.h"
#include "world/types.h"
#include "world/world.h"

#include <cstdio>
#include <vector>

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

// Single sub-voxel at arbitrary (SX, SY, L) offsets from a base cell, spilling
// across cell boundaries (same contract as padic_gen.cpp put_sub).
void put_sub(MacroGrid& g, SubField<CellType>& sm, int cx, int cy, int baseZ,
             int SX, int SY, int L, CellType mat) {
    if (L < 0) return;
    const int wz = L & 7;
    const std::uint64_t bit = std::uint64_t{1}
                              << ((SX & 7) + (SY & 7) * kSubDim);
    put_bits(g, sm, cx + (SX >> 3), cy + (SY >> 3), baseZ + (L >> 3), wz, bit,
             mat);
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

// ---- buildings -------------------------------------------------------------
//
// A khrushchevka block: a straight panel slab, kBldgDepth deep, made of
// kSectionLen-long sections with one подъезд (stair core) each. All lengths
// derived from the real thing at 2 m cells / 0.25 m sub-voxels:
inline constexpr int kBldgDepth = 6;   // 12 m — панельная хрущёвка в глубину
inline constexpr int kSectionLen = 6;  // 12 m of facade per подъезд-секция
inline constexpr int kStoreys = 10;    // десятиэтажка
// Storey rise: 2.5 m ceiling + 0.5 m slab = 3.0 m = 12 sub-voxels, so two
// storeys tile exactly three cells and the block tops out at 15 cells.
inline constexpr int kStoreyRise = 12;
inline constexpr int kSlabThick = 2;   // 0.5 m storey slab
inline constexpr int kBldgTopH = kStoreys * kStoreyRise; // 120 subvox = 30 m

struct Building {
    std::uint8_t x0, y0;     // min-corner cell
    std::uint8_t lenX, lenY; // footprint in cells; one of them == kBldgDepth
    std::uint8_t axis;       // 0: facade runs along x (depth = y); 1: along y
    std::int8_t courtSign;   // which side of the DEPTH axis faces the courtyard
};

using Entrance = KhrushiEntrance; // the manifest's public type ([khrushi.h])

struct CityPlan {
    std::uint8_t surf[kMacroDim * kMacroDim];
    bool park[kLatticeDim * kLatticeDim]; // quarter (qi,qj) is a park square
    std::vector<Building> bldgs;
    std::vector<Entrance> doors; // one per подъезд, in bldgs/section order
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

int building_sections(const Building& b) {
    return (b.axis ? b.lenY : b.lenX) / kSectionLen;
}

// One entrance per section: the core's first facade bay, on the courtyard side.
void building_entrances(const Building& b, std::vector<Entrance>& out) {
    const int sections = building_sections(b);
    for (int s = 0; s < sections; ++s) {
        const int cf = s * kSectionLen + 2;
        const int cd = b.courtSign > 0 ? kBldgDepth - 1 : 0;
        Entrance e;
        if (b.axis == 0) {
            e.x = static_cast<std::uint8_t>(b.x0 + cf);
            e.y = static_cast<std::uint8_t>(b.y0 + cd);
            e.dx = 0;
            e.dy = b.courtSign;
        } else {
            e.x = static_cast<std::uint8_t>(b.x0 + cd);
            e.y = static_cast<std::uint8_t>(b.y0 + cf);
            e.dx = b.courtSign;
            e.dy = 0;
        }
        out.push_back(e);
    }
}

// Building footprints per quarter. Three authored patterns picked by hash —
// two parallel slabs (the default), a U of three, or a single long slab with
// a wide yard. Positions jitter inside the quarter, lengths are whole
// sections, and every block keeps ≥1 cell of setback from the sidewalks.
void place_buildings(CityPlan& p, std::uint32_t salt) {
    auto add = [&](int x0, int y0, int lenX, int lenY, int axis, int court) {
        p.bldgs.push_back({static_cast<std::uint8_t>(x0),
                           static_cast<std::uint8_t>(y0),
                           static_cast<std::uint8_t>(lenX),
                           static_cast<std::uint8_t>(lenY),
                           static_cast<std::uint8_t>(axis),
                           static_cast<std::int8_t>(court)});
    };
    for (int qj = 0; qj < kLatticeDim; ++qj)
        for (int qi = 0; qi < kLatticeDim; ++qi) {
            if (p.park[qj * kLatticeDim + qi]) continue;
            const int bx = kQuarterOrigin + qi * kLatticeSpacing;
            const int by = kQuarterOrigin + qj * kLatticeSpacing;
            const std::uint32_t h = hash_u32(
                salt ^ (static_cast<std::uint32_t>(qj * kLatticeDim + qi) + 1u) *
                           0x27220A95u);
            const int pat = static_cast<int>(h & 3u);
            if (pat == 0) {
                // U: north + south slabs, a west block closing the yard.
                add(bx + 8, by + 1, 12, kBldgDepth, 0, +1);
                add(bx + 8, by + 17, 12, kBldgDepth, 0, -1);
                add(bx + 1, by + 6, kBldgDepth, 12, 1, +1);
            } else if (pat == 3) {
                // One long slab, the rest of the quarter is yard.
                const int len = 18;
                const int off = 1 + static_cast<int>((h >> 4) %
                                    static_cast<std::uint32_t>(kQuarterSpan - len - 2));
                add(bx + off, by + 1, len, kBldgDepth, 0, +1);
            } else {
                // Two parallel slabs facing each other across the yard.
                const int lenA = ((h >> 2) & 1u) ? 18 : 12;
                const int offA = 1 + static_cast<int>((h >> 4) %
                                     static_cast<std::uint32_t>(kQuarterSpan - lenA - 2));
                const int lenB = ((h >> 3) & 1u) ? 18 : 12;
                const int offB = 1 + static_cast<int>((h >> 9) %
                                     static_cast<std::uint32_t>(kQuarterSpan - lenB - 2));
                add(bx + offA, by + 1, lenA, kBldgDepth, 0, +1);
                add(bx + offB, by + 17, lenB, kBldgDepth, 0, -1);
            }
        }
    for (const Building& b : p.bldgs) building_entrances(b, p.doors);
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

    place_buildings(p, salt);

    // Yard paths: from every подъезд straight across the courtyard until the
    // sidewalk (or another footprint) stops the line.
    std::vector<std::uint8_t> occ(kMacroDim * kMacroDim, 0);
    for (const Building& b : p.bldgs)
        for (int oy = 0; oy < b.lenY; ++oy)
            for (int ox = 0; ox < b.lenX; ++ox)
                occ[p2(b.x0 + ox, b.y0 + oy)] = 1;
    for (const Entrance& e : p.doors) {
        int x = e.x + e.dx, y = e.y + e.dy;
        for (int step = 0; step < kQuarterSpan; ++step) {
            const std::size_t i = p2(x, y);
            if (occ[i]) break;
            const std::uint8_t s = p.surf[i];
            if (s != kSurfYard && s != kSurfPark) break;
            p.surf[i] = kSurfPath;
            x += e.dx;
            y += e.dy;
        }
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

// ---- building stamp --------------------------------------------------------

// One sub-layer at height H (sub-voxels above the street surface, whose
// absolute base is cell kKhrushiGroundCoord).
void put_hlayer(MacroGrid& g, SubField<CellType>& sm, int x, int y, int H,
                std::uint64_t bits, CellType mat) {
    if (H < 0) return;
    put_bits(g, sm, x, y, kKhrushiGroundCoord + (H >> 3), H & 7, bits, mat);
}

// Wall bands: the outer 2-sub-voxel (0.5 m panel) skin of an edge cell, as one
// 64-bit layer word (bit = sx + 8*sy). Windows are the 4-wide (1 m) middle of
// each facade bay, so the piers between neighbouring bays add up to 1 m.
inline constexpr std::uint64_t kBandXLo = 0x0303030303030303ull; // sx in {0,1}
inline constexpr std::uint64_t kBandXHi = 0xC0C0C0C0C0C0C0C0ull; // sx in {6,7}
inline constexpr std::uint64_t kBandYLo = 0x000000000000FFFFull; // sy in {0,1}
inline constexpr std::uint64_t kBandYHi = 0xFFFF000000000000ull; // sy in {6,7}
inline constexpr std::uint64_t kWinXLo = 0x0000030303030000ull;  // sy in [2,6)
inline constexpr std::uint64_t kWinXHi = 0x0000C0C0C0C00000ull;
inline constexpr std::uint64_t kWinYLo = 0x0000000000003C3Cull;  // sx in [2,6)
inline constexpr std::uint64_t kWinYHi = 0x3C3C000000000000ull;
// Interior door openings are 6 wide (1.5 m): the 4×4×7-sub-voxel body clears
// them with margin, where a 1 m opening would be exactly the body's width.
inline constexpr std::uint64_t kDoorXLo = 0x0003030303030300ull; // sy in [1,7)
inline constexpr std::uint64_t kDoorXHi = 0x00C0C0C0C0C0C000ull;
inline constexpr std::uint64_t kDoorYLo = 0x0000000000007E7Eull; // sx in [1,7)
inline constexpr std::uint64_t kDoorYHi = 0x7E7E000000000000ull;

inline int bcellx(const Building& b, int fa, int dc) {
    return b.axis ? b.x0 + dc : b.x0 + fa;
}
inline int bcelly(const Building& b, int fa, int dc) {
    return b.axis ? b.y0 + fa : b.y0 + dc;
}

// Is (fa, dc) one of the two OPEN core cells of some section (the stair well —
// flights and midlanding — that storey slabs must not cover)?
bool core_open_cell(const Building& b, int fa, int dc) {
    const int lo = b.courtSign > 0 ? kBldgDepth - 3 : 1; // the two non-landing
    if (dc < lo || dc >= lo + 2) return false;           // core depth cells
    const int m = fa % kSectionLen;
    return m == 2 || m == 3;
}

// Apartments: TWO flats per storey per section, mirrored about the core — the
// honest хрущёвка plan scaled to 2 m cells. Flat-local frame: `f` runs along
// the facade away from the core (0 = gable-ward column), `j` runs along the
// depth FROM THE STREET (0..2 street strip, 3..5 courtyard wing):
//
//   j=5 (двор):   санузел(0,5)   прихожая(1,5)  | ПЛОЩАДКА (core)
//   j=4:          кухня  (0,4)   коридор (1,4)  | пролёты
//   j=3:          кладовка(0,3)  коридор (1,3)  | пролёты
//   j=0..2:       спальня(0,*)   зал (1..2,*)   — street strip
//
// Partitions are 0.5 m plaster bands with 1.5 m door openings; kitchen,
// bath and corridor get lino, the rooms parquet. No door leaves: the door
// system stamps whole-cell leaves (door.cpp fill_leaf), which cannot sit in
// a 1.5-cell storey — leaves are an owner question, openings are honest.
void stamp_section_flats(MacroGrid& g, SubField<CellType>& sm,
                         const Building& b, int sec) {
    const int base = sec * kSectionLen;
    const std::uint64_t bandDLo = b.axis ? kBandXLo : kBandYLo;
    const std::uint64_t bandDHi = b.axis ? kBandXHi : kBandYHi;
    const std::uint64_t bandFLo = b.axis ? kBandYLo : kBandXLo;
    const std::uint64_t bandFHi = b.axis ? kBandYHi : kBandXHi;
    const std::uint64_t doorFLo = b.axis ? kDoorYLo : kDoorXLo;
    const std::uint64_t doorFHi = b.axis ? kDoorYHi : kDoorXHi;
    const std::uint64_t toStreet = b.courtSign > 0 ? bandDLo : bandDHi;
    const std::uint64_t doorStreet = b.courtSign > 0
                                         ? (b.axis ? kDoorXLo : kDoorYLo)
                                         : (b.axis ? kDoorXHi : kDoorYHi);
    const std::uint64_t toCourt = b.courtSign > 0 ? bandDHi : bandDLo;

    // depth cell of street-relative index j
    auto DC = [&](int j) { return b.courtSign > 0 ? j : kBldgDepth - 1 - j; };

    // A plaster partition band in one cell, full building height, storey air
    // only (the slabs are their own layer); optional 1.5 m door opening.
    auto wall = [&](int fa, int dc, std::uint64_t band, std::uint64_t door) {
        const int x = bcellx(b, fa, dc), y = bcelly(b, fa, dc);
        for (int H = 0; H < kBldgTopH; ++H) {
            const int hs = H % kStoreyRise;
            if (hs >= 10) continue;
            std::uint64_t bits = band;
            if (door && hs < 9) bits &= ~door;
            put_hlayer(g, sm, x, y, H, bits, kMatPlaster);
        }
    };

    for (int side = 0; side < 2; ++side) {
        auto F = [&](int f) { return base + (side ? kSectionLen - 1 - f : f); };
        const std::uint64_t bandWet = side ? bandFHi : bandFLo;
        const std::uint64_t doorWet = side ? doorFHi : doorFLo;
        const std::uint64_t bandBed = side ? bandFLo : bandFHi;
        const std::uint64_t doorBed = side ? doorFLo : doorFHi;

        // corridor|wet-cells wall, a door onto each wet cell
        for (int j = 3; j <= 5; ++j) wall(F(1), DC(j), bandWet, doorWet);
        // wet partitions: bath|kitchen and kitchen|pantry, blank
        wall(F(0), DC(4), toCourt, 0);
        wall(F(0), DC(3), toCourt, 0);
        // wing|street-strip wall: blank at the gable column, door where the
        // corridor meets the hall (the core cells already carry their wall)
        wall(F(0), DC(3), toStreet, 0);
        wall(F(1), DC(3), toStreet, doorStreet);
        // bedroom|hall wall with its door by the entrance corner
        for (int j = 0; j <= 2; ++j)
            wall(F(0), DC(j), bandBed, j == 2 ? doorBed : 0);

        // floor wearing course, storey by storey: lino for the wet/corridor
        // half, parquet for the rooms (the ground storey repaints the street
        // slab's top sub-layer; upper storeys the slab's top sub-layer)
        auto floor_over = [&](int fa, int dc, CellType mat) {
            const int x = bcellx(b, fa, dc), y = bcelly(b, fa, dc);
            put_bits(g, sm, x, y, kKhrushiSlabZ, kSubDim - 1, ~std::uint64_t{0},
                     mat);
            for (int s = 1; s < kStoreys; ++s)
                put_hlayer(g, sm, x, y, s * kStoreyRise - 1, ~std::uint64_t{0},
                           mat);
        };
        for (int j = 3; j <= 5; ++j) {
            floor_over(F(0), DC(j), kMatLino);
            floor_over(F(1), DC(j), kMatLino);
        }
        for (int j = 0; j <= 2; ++j)
            for (int f = 0; f <= 2; ++f) floor_over(F(f), DC(j), kMatParquet);
    }

    // flat A | flat B divider across the street strip (one wall, not two)
    for (int j = 0; j <= 2; ++j) wall(base + 2, DC(j), bandFHi, 0);
    // section | section divider (the gable columns of inner sections)
    if ((base + kSectionLen) < (b.axis ? b.lenY : b.lenX))
        for (int dc = 0; dc < kBldgDepth; ++dc)
            wall(base + kSectionLen - 1, dc, bandFHi, 0);
}

// ---- street-lamp poles -----------------------------------------------------
//
// The pole is VOXELS, not a prop: a 0.5 m pipe column on the kerb, 5 m tall,
// with a 2 m hook arm reaching over the road. The lamp is the prop, anchored
// to the hook's under-face (S2: carve the pole and the lamp falls); wires run
// hook to hook. Heights derived: lamp face at 4.5 m over the street — an СВ
// pole over a 4 m lane.
void stamp_pole(MacroGrid& g, SubField<CellType>& sm, const KhrushiPole& p) {
    // Base cell chosen so every sub-voxel offset stays non-negative even when
    // the hook points to −x/−y (put_sub spills forward only).
    const int bx = p.dx < 0 ? p.x - 1 : p.x;
    const int by = p.dy < 0 ? p.y - 1 : p.y;
    const int cx0 = (p.x - bx) * kSubDim;
    const int cy0 = (p.y - by) * kSubDim;
    for (int H = 0; H < kKhrushiPoleTopH; ++H)
        for (int a = 3; a <= 4; ++a)
            for (int c = 3; c <= 4; ++c)
                put_sub(g, sm, bx, by, kKhrushiGroundCoord, cx0 + a, cy0 + c, H,
                        kMatPipeMetal);
    // Hook arm: the top two sub-layers, 2 wide, running 2 m towards the road
    // (1.25 m of it over the road cell, where the lamp will hang). The
    // negative arm is the MIRROR of the positive one about the pole centre
    // (3.5): offset o mirrors to 7-o, so 5+i mirrors to 2-i — the first cut
    // used 10-i, which reaches AWAY from the road, and every high-side lamp
    // silently refused to spawn (owner's screenshot, 2026-08-27).
    for (int H = kKhrushiPoleTopH - 2; H < kKhrushiPoleTopH; ++H)
        for (int i = 0; i < 8; ++i)
            for (int w = 3; w <= 4; ++w) {
                const int ox = p.dx ? cx0 + (p.dx > 0 ? 5 + i : 2 - i)
                                    : cx0 + w;
                const int oy = p.dy ? cy0 + (p.dy > 0 ? 5 + i : 2 - i)
                                    : cy0 + w;
                put_sub(g, sm, bx, by, kKhrushiGroundCoord, ox, oy, H,
                        kMatPipeMetal);
            }
}

void stamp_building(MacroGrid& g, SubField<CellType>& sm, const Building& b) {
    const int La = b.axis ? b.lenY : b.lenX;
    const int sections = building_sections(b);
    auto cellx = [&](int fa, int dc) { return b.axis ? b.x0 + dc : b.x0 + fa; };
    auto celly = [&](int fa, int dc) { return b.axis ? b.y0 + fa : b.y0 + dc; };

    // Bands oriented to this building: long facades cut the DEPTH axis, gable
    // ends cut the FACADE axis.
    const std::uint64_t bandDLo = b.axis ? kBandXLo : kBandYLo;
    const std::uint64_t bandDHi = b.axis ? kBandXHi : kBandYHi;
    const std::uint64_t winDLo = b.axis ? kWinXLo : kWinYLo;
    const std::uint64_t winDHi = b.axis ? kWinXHi : kWinYHi;
    const std::uint64_t bandFLo = b.axis ? kBandYLo : kBandXLo;
    const std::uint64_t bandFHi = b.axis ? kBandYHi : kBandXHi;

    // Ground floor gets a parquet wearing course over the street slab.
    for (int fa = 0; fa < La; ++fa)
        for (int dc = 0; dc < kBldgDepth; ++dc)
            put_bits(g, sm, cellx(fa, dc), celly(fa, dc), kKhrushiSlabZ,
                     kSubDim - 1, ~std::uint64_t{0}, kMatParquet);

    // Long facades: panel with a window per bay per storey; the подъезд bay on
    // the courtyard side is an opening at street level instead.
    for (int fa = 0; fa < La; ++fa)
        for (int side = 0; side < 2; ++side) {
            const int dc = side ? kBldgDepth - 1 : 0;
            const int x = cellx(fa, dc), y = celly(fa, dc);
            const std::uint64_t band = side ? bandDHi : bandDLo;
            const std::uint64_t win = side ? winDHi : winDLo;
            const bool court = (b.courtSign > 0) == (side == 1);
            const bool entrance = court && (fa % kSectionLen) == 2;
            for (int H = 0; H < kBldgTopH; ++H) {
                if (entrance && H < 9) continue; // подъездный проём, 2.25 м
                const int hs = H % kStoreyRise;
                if (hs >= 3 && hs <= 8) { // window rows: sill 0.75 m, 1.5 m tall
                    put_hlayer(g, sm, x, y, H, band & ~win, kMatSlabTan);
                    put_hlayer(g, sm, x, y, H, band & win, kMatGlass);
                } else {
                    put_hlayer(g, sm, x, y, H, band, kMatSlabTan);
                }
            }
            // Parapet continues the panel two sub-voxels above the roof.
            for (int H = kBldgTopH; H < kBldgTopH + 2; ++H)
                put_hlayer(g, sm, x, y, H, band, kMatConcrete);
        }

    // Gable ends: blank panel, the хрущёвка way.
    for (int dc = 0; dc < kBldgDepth; ++dc)
        for (int end = 0; end < 2; ++end) {
            const int fa = end ? La - 1 : 0;
            const int x = cellx(fa, dc), y = celly(fa, dc);
            const std::uint64_t band = end ? bandFHi : bandFLo;
            for (int H = 0; H < kBldgTopH; ++H)
                put_hlayer(g, sm, x, y, H, band, kMatSlabTan);
            for (int H = kBldgTopH; H < kBldgTopH + 2; ++H)
                put_hlayer(g, sm, x, y, H, band, kMatConcrete);
        }

    // Storey slabs (s == kStoreys is the roof, covering the stair wells too).
    for (int s = 1; s <= kStoreys; ++s)
        for (int fa = 0; fa < La; ++fa)
            for (int dc = 0; dc < kBldgDepth; ++dc) {
                if (s < kStoreys && core_open_cell(b, fa, dc)) continue;
                for (int H = s * kStoreyRise - kSlabThick; H < s * kStoreyRise;
                     ++H)
                    put_hlayer(g, sm, cellx(fa, dc), celly(fa, dc), H,
                               ~std::uint64_t{0}, kMatConcrete);
            }

    // Stair cores, one per section. Sub-voxel frame: `av` runs along the
    // facade inside the 2-cell core, `du` runs along the depth FROM the
    // courtyard face inward, H is height over the street. Layout per storey
    // (rises 12): landing du [0,8) at the slab, flight A du [8,20) — six
    // 2-deep treads rising 1 each, midlanding du [20,24) at +6, flight B
    // back over the other half of the width to the next landing at +12.
    const int coreDc0 = b.courtSign > 0 ? kBldgDepth - 3 : 0;
    for (int sec = 0; sec < sections; ++sec) {
        auto stair_sub = [&](int av, int du, int H, CellType mat) {
            if (H < 0) return;
            const int fsub = (sec * kSectionLen + 2) * kSubDim + av;
            const int dsub =
                b.courtSign > 0 ? kBldgDepth * kSubDim - 1 - du : du;
            const int SX = b.axis ? dsub : fsub;
            const int SY = b.axis ? fsub : dsub;
            put_sub(g, sm, b.x0, b.y0, kKhrushiGroundCoord, SX, SY, H, mat);
        };
        for (int s = 0; s + 1 < kStoreys; ++s) {
            const int base = s * kStoreyRise;
            for (int k = 0; k < 6; ++k)
                for (int t = 0; t < 2; ++t)
                    for (int th = 0; th < kSlabThick; ++th) {
                        for (int av = 0; av < 8; ++av) // flight A
                            stair_sub(av, 8 + 2 * k + t, base + k - 1 + th,
                                      kMatConcrete);
                        for (int av = 8; av < 16; ++av) // flight B
                            stair_sub(av, 18 - 2 * k + t, base + 5 + k + th,
                                      kMatConcrete);
                    }
            for (int du = 20; du < 24; ++du) // midlanding at base + 6
                for (int av = 0; av < 16; ++av)
                    for (int th = 0; th < kSlabThick; ++th)
                        stair_sub(av, du, base + 4 + th, kMatConcrete);
        }

        // Core walls: plaster sides towards the flats, with a doorway onto
        // every landing; a full wall between the flights and the street-side
        // flats. The landing cell is the courtyard-most core cell.
        const int cf0 = sec * kSectionLen + 2, cf1 = cf0 + 1;
        const int dcLanding = b.courtSign > 0 ? kBldgDepth - 1 : 0;
        for (int i = 0; i < 3; ++i) {
            const int dc = coreDc0 + i;
            const bool landing = dc == dcLanding;
            for (int H = 0; H < kBldgTopH; ++H) {
                // Landing cell: door-height opening each storey, both sides.
                if (landing && H % kStoreyRise < 9) continue;
                put_hlayer(g, sm, cellx(cf0, dc), celly(cf0, dc), H, bandFLo,
                           kMatPlaster);
                put_hlayer(g, sm, cellx(cf1, dc), celly(cf1, dc), H, bandFHi,
                           kMatPlaster);
            }
        }
        const int dcStreet = b.courtSign > 0 ? coreDc0 : 2;
        const std::uint64_t bandS = b.courtSign > 0 ? bandDLo : bandDHi;
        for (int H = 0; H < kBldgTopH; ++H)
            for (int cf : {cf0, cf1})
                put_hlayer(g, sm, cellx(cf, dcStreet), celly(cf, dcStreet), H,
                           bandS, kMatPlaster);

        stamp_section_flats(g, sm, b, sec);
    }
}

} // namespace

// Street wires: hook to hook along every kerb line, the module's antourage on
// top of the generic bake. The pole list is replayed from khrushi_poles —
// poles are emitted 4 per pitch step (road r: vert-lo, vert-hi, horiz-lo,
// horiz-hi), so line (r, k) is every 4th entry and consecutive entries on a
// line are one 8-cell (16 m) span apart; the last span wraps the torus, built
// UNWRAPPED in metres like bake_wires' spans (a wrapped mesh would be a
// 250-metre ghost), with only the anchor cells wrapped.
void khrushi_bake_antourage(const World& /*world*/, int number, unsigned seed,
                            AntourageBake& out) {
    std::vector<KhrushiPole> poles;
    khrushi_poles(seed, number, poles);
    std::uint32_t strung = 0;
    const int pitchSteps = kMacroDim / 8; // poles per line
    const float hookZ =
        static_cast<float>(kKhrushiGroundCoord * kSubDim + kKhrushiPoleTopH -
                           2) *
        (kCellSize / 8.0f); // under-face of the hook arm: 10.5 m absolute

    // Attach at the hook ELBOW — the corner where the arm leaves the pole
    // (0.3 m off the pole face), NOT at the tip: the tip is where the lamp
    // hangs, and a wire pinned there ran straight through the shade
    // (owner's screenshot, 2026-08-27). The line sags behind the lamps.
    auto attach = [&](const KhrushiPole& p, float along) {
        vec3 a{(static_cast<float>(p.x) + 0.5f) * kCellSize +
                   static_cast<float>(p.dx) * 0.3f,
               (static_cast<float>(p.y) + 0.5f) * kCellSize +
                   static_cast<float>(p.dy) * 0.3f,
               hookZ - 0.05f};
        // The along-axis coordinate comes in unwrapped for the wrap span.
        if (p.dx != 0) a.y = along;
        else a.x = along;
        return a;
    };

    for (std::size_t line = 0; line < 16; ++line) {
        const std::size_t r = line / 4, k = line % 4;
        for (int i = 0; i < pitchSteps; ++i) {
            const int j = (i + 1) % pitchSteps;
            const KhrushiPole& pa = poles[(r * pitchSteps + i) * 4 + k];
            const KhrushiPole& pb = poles[(r * pitchSteps + j) * 4 + k];
            const float ta = (static_cast<float>(4 + 8 * i) + 0.5f) * kCellSize;
            const float tb = ta + 8.0f * kCellSize; // unwrapped: wrap span too
            WireChain c{};
            const vec3 a = attach(pa, ta);
            const vec3 b = attach(pb, tb);
            const float spanM = 8.0f * kCellSize;
            // Street cable sag: 5% of the span (0.8 m over 16 m) — a strung
            // line, not the loose indoor flex bake_wires drapes at 15%.
            const float sag = 0.05f * spanM;
            for (int pt = 0; pt < kWirePoints; ++pt) {
                const float s = static_cast<float>(pt) /
                                static_cast<float>(kWirePoints - 1);
                vec3 q{a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s,
                       a.z + (b.z - a.z) * s};
                q.z -= sag * 4.0f * s * (1.0f - s);
                c.p[pt] = q;
            }
            c.restLen = spanM * 1.02f / static_cast<float>(kWirePoints - 1);
            c.massKg = spanM * 0.35f; // cable ~0.35 kg/m, as the generic bake
            // Anchors in the POLE cells (the elbow's support column), so the
            // wire lets go when the pole is carved, not when the road is.
            c.ax0 = pa.x;
            c.ay0 = pa.y;
            c.az0 = static_cast<std::uint8_t>(
                kKhrushiGroundCoord + ((kKhrushiPoleTopH - 1) >> 3));
            c.ax1 = pb.x;
            c.ay1 = pb.y;
            c.az1 = c.az0;
            c.pinMask = 0x81; // both ends at the elbows
            c.face = anchor_face_pack(2, -1); // hangs off the hook's under-face
            c.matId = kMatPipeMetal;
            out.wires.push_back(c);
            ++strung;
        }
    }
    std::fprintf(stderr, "[khrushi] street wires: %u strung, %zu total in bake\n",
                 strung, out.wires.size());
}

// Replay of the plan's entrance list for the module seeder (lamps over the
// подъезды) — deterministic in (seed, number) like everything else.
std::uint32_t khrushi_entrances(unsigned seed, int number,
                                std::vector<KhrushiEntrance>& out) {
    CityPlan p;
    build_city_plan(p, seed, number);
    out.insert(out.end(), p.doors.begin(), p.doors.end());
    return static_cast<std::uint32_t>(p.doors.size());
}

// Pole layout: every 8 cells (16 m — city lamp pitch) along both kerbs of
// every avenue, phase 4 so no pole lands inside a hub square (pad cells are
// node±3; t ≡ 4 (mod 8) keeps |t − node| ≥ 4 for nodes at 16 + 32k). The
// layout is regular by design — jitter would break the wire spans; seed and
// number stay in the signature for the day the module wants variants.
std::uint32_t khrushi_poles(unsigned /*seed*/, int /*number*/,
                            std::vector<KhrushiPole>& out) {
    std::uint32_t n = 0;
    for (int r = 0; r < kLatticeDim; ++r) {
        const int rc = lattice_coord(r);
        const int lo = wrap_macro(rc + kRoadHalfLo - 1); // kerb cell, low side
        const int hi = wrap_macro(rc + kRoadHalfHi + 1); // kerb cell, high side
        for (int t = 4; t < kMacroDim; t += 8) {
            const std::uint8_t tt = static_cast<std::uint8_t>(t);
            out.push_back({static_cast<std::uint8_t>(lo), tt, +1, 0});
            out.push_back({static_cast<std::uint8_t>(hi), tt, -1, 0});
            out.push_back({tt, static_cast<std::uint8_t>(lo), 0, +1});
            out.push_back({tt, static_cast<std::uint8_t>(hi), 0, -1});
            n += 4;
        }
    }
    return n;
}

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

    // Pages: 16k surface-course cells + the building skins (wall/glass/slab
    // mixes on the perimeter and core cells; interiors stay single-material).
    sm.reserve_pages(131072);

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

    // Stage 3 — the blocks.
    for (const Building& b : plan.bldgs) stamp_building(g, sm, b);

    // Stage 4 — street-lamp poles along both kerbs of every avenue.
    std::vector<KhrushiPole> poles;
    khrushi_poles(seed, number, poles);
    for (const KhrushiPole& p : poles) stamp_pole(g, sm, p);

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
