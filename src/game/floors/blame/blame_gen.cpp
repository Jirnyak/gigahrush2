// BLAME geometry — the megastructure void, sculpted in stages (owner's
// direction, 2026-08-17: "как лепка" — big masses first, voids carved out of
// them, elements answering the surfaces that result).
//
// THE PIPELINE (each stage works on what the previous stages left):
//
//   1. MASSES    — cyclopean primitives OR-ed into a 128^3 occupancy field:
//                  two great walls (full-torus rings along y, full height), a
//                  full-height cross rib, a hanging sky-slab, and a low
//                  platform mass filling the back canyon's floor.
//   2. CARVES    — voids subtracted in sculpting order: the MAIN CHASM (the
//                  guaranteed motif — two facing walls, 28..40 m apart, empty
//                  through all 128 z so a fall wraps forever), a narrow slit
//                  crevasse hugging wall B's back face, interior wells, bore
//                  tunnels through the walls, terrace steps at the platform
//                  edge. Later carves cut earlier masses — the cross rib is
//                  severed by the chasm on purpose.
//   3. GRAMMAR   — elements respond to LOCAL geometry, not to a floorplan:
//                  facing walls get grated bridge decks (some broken mid-span)
//                  and hollow crossing pipes; tall faces get cantilevered
//                  serpentine stairs (padic's closed 2/8 flight math, hung on
//                  the outside of a wall over the abyss) and cornice ledges;
//                  the platform top gets a terraced town of hollow boxes; the
//                  wall interiors get a drunkard labyrinth whose corridors
//                  sometimes punch straight through the face — the corridor
//                  that ends in 100 m of nothing.
//   4. LATTICE   — the mandatory 4x4x4 fast-travel lattice ([lattice.h],
//                  radii from [fast_travel.h]): nodes inside mass get carved
//                  lobbies every 8 cells; nodes hanging in a void get a
//                  free-standing concrete PYLON around the shaft, with catwalks
//                  cast outward to whatever face answers. Arrival z = 3 is a
//                  standable lobby band on every node (save.h kArrivalCoord).
//
// Everything is a pure function of (seed, number), like padic. The sub-voxel
// stamping helpers are deliberately restated here rather than shared with
// padic_gen.cpp — modularity beats DRY, the folder is the module ([blame.h]).
#include "core/rng.h"
#include "game/floors/blame/blame.h"

#include "game/floor_gen.h"
#include "game/room.h"        // room_declare — модуль объявляет свои комнаты (S12.1)
#include "game/fast_travel.h" // kFastShaftR / kFastLobbyR — the shaft footprint
#include "world/medium.h" // kGasField (fluid.h умер)
#include "world/destruct.h" // kSubMaterialName
#include "world/lattice.h"
#include "world/materials.h"
#include "world/subfield.h"
#include "world/types.h"
#include "world/world.h"

#include <cstdint>
#include <vector>

namespace giga::game {

namespace {

inline constexpr int kDim = kMacroDim; // 128 on every axis, wrapped

// One sz layer of a SubMask is one 64-bit word (padic_gen.cpp states the law).
inline constexpr std::uint64_t kAllBits = ~std::uint64_t{0};
// Grate bars: sx even, every sy row — merges to 4 boxes a cell ([voxels.md]).
inline constexpr std::uint64_t kGrateBars = 0x5555555555555555ull;

inline std::uint32_t lcg(std::uint32_t& s) {
    s = s * 1664525u + 1013904223u;
    return s;
}
inline int rnd(std::uint32_t& s, int lo, int hi) { // inclusive
    return lo + static_cast<int>(lcg(s) % static_cast<std::uint32_t>(hi - lo + 1));
}

// ---- the sculpting field -----------------------------------------------------
// A transient 128^3 material field the mass/carve stages work on before any
// grid write. 2 MB, alive only inside generate_blame_floor. kCellAir == void.
struct Sculpt {
    std::vector<CellType> m;
    Sculpt() : m(static_cast<std::size_t>(kDim) * kDim * kDim, kCellAir) {}
    CellType& at(int x, int y, int z) {
        return m[(static_cast<std::size_t>(wrap_macro(z)) * kDim +
                  wrap_macro(y)) * kDim + wrap_macro(x)];
    }
    // Half-open box in UNWRAPPED coordinates; every written cell wraps.
    void box(int x0, int x1, int y0, int y1, int z0, int z1, CellType v) {
        for (int z = z0; z < z1; ++z)
            for (int y = y0; y < y1; ++y)
                for (int x = x0; x < x1; ++x) at(x, y, z) = v;
    }
    bool solid(int x, int y, int z) { return at(x, y, z) != kCellAir; }
};

// ---- the plan ----------------------------------------------------------------
// Scalars only: the element lists (bridges, houses, walks) are derived inside
// their stages from the same rng chain, so the plan stays a readable skeleton.
// All x are PLAN coordinates; `rot` rotates the whole massing on the torus so
// which lattice nodes land in mass vs. void varies per (seed, number).
struct Plan {
    int rot;               // torus rotation of the massing along x
    int tA, gap, tB, slit; // wall A | main chasm | wall B | slit crevasse
    int pSlit0, pPlat0;    // slit start = tA+gap+tB; platform start after slit
    int zPlat;             // platform top (cells)
    int xc, tC;            // wall C: splits the back canyon into two narrow ones
    int yc1, tc1;          // full-height cross rib (y-band)
    int yc2, tc2, zc2;     // sky slab: y-band, hanging at z in [zc2, 128)
    int wellX, wellY, wellW; // interior well inside wall A
    int deckZ[8];          // bridge deck walk levels (generic facing-pair scan)
    int nDecks;
};

void build_plan(Plan& p, unsigned seed, int number) {
    std::uint32_t rng = hash_u32(static_cast<std::uint32_t>(seed) ^
                                 (static_cast<std::uint32_t>(number) * 0x9E3779B9u) ^
                                 0xB1A3Eu);
    if (rng == 0) rng = 0xB1A3Eu;

    p.rot = rnd(rng, 0, kDim - 1);
    // Voids stay NARROW (owner's retune 2026-08-17: "поуже пустоты" — the awe
    // is depth and closeness, not acreage): chasm 18..24 m, slit 6..8 m, and
    // wall C below splits what used to be one 120 m back canyon in two.
    p.tA = rnd(rng, 22, 28);
    p.gap = rnd(rng, 9, 12);
    p.tB = rnd(rng, 18, 24);
    p.slit = rnd(rng, 3, 4);
    p.pSlit0 = p.tA + p.gap + p.tB;
    p.pPlat0 = p.pSlit0 + p.slit;
    p.zPlat = rnd(rng, 18, 24);
    // Wall C: a third full-height ring centred in the back region, leaving two
    // town canyons of roughly (backW - tC) / 2 ≈ 15..22 cells each.
    {
        const int backW = kDim - p.pPlat0;
        p.tC = rnd(rng, 12, 16);
        p.xc = p.pPlat0 + (backW - p.tC) / 2 + rnd(rng, -4, 4);
    }

    p.yc1 = rnd(rng, 4, 36);
    p.tc1 = rnd(rng, 8, 12);
    p.yc2 = p.yc1 + 64 + rnd(rng, -12, 12); // opposite side of the torus
    p.tc2 = rnd(rng, 8, 12);
    p.zc2 = rnd(rng, 56, 80);

    p.wellW = rnd(rng, 10, 13);
    p.wellX = rnd(rng, 4, p.tA - p.wellW - 4);
    p.wellY = rnd(rng, 0, kDim - 1);

    for (int i = 0; i < 7; ++i) p.deckZ[i] = 10 + i * 16 + rnd(rng, 0, 5);
    p.deckZ[7] = p.zPlat - 6; // the terrace level: planks across the slit
    p.nDecks = 8;
}

// ---- stage 1+2: masses, then carves -----------------------------------------

void sculpt_masses(Sculpt& s, const Plan& p) {
    const int r = p.rot;
    // The two great walls: full-torus rings along y, full height.
    s.box(r, r + p.tA, 0, kDim, 0, kDim, kMatConcrete);
    s.box(r + p.tA + p.gap, r + p.pSlit0, 0, kDim, 0, kDim, kMatConcrete);
    // Cross rib (full height) and the hanging sky slab — both full-x rings,
    // both about to be severed by the chasm and slit carves. Their cut faces
    // are what the bridge stage later answers.
    s.box(0, kDim, p.yc1, p.yc1 + p.tc1, 0, kDim, kMatConcrete);
    s.box(0, kDim, p.yc2, p.yc2 + p.tc2, p.zc2, kDim, kMatConcrete);
    // Platform mass: the back canyon's floor, a town's worth of ground. Top
    // layer reads as street slab, not raw pour.
    s.box(r + p.pPlat0, r + kDim, 0, kDim, 0, p.zPlat, kMatConcrete);
    s.box(r + p.pPlat0, r + kDim, 0, kDim, p.zPlat - 1, p.zPlat, kMatSlabTan);
    // Wall C: written last so its concrete wins over the street slab in its
    // own footprint — the town's ground continues INTO the wall, streets end
    // against a face, exactly the "город упирается в стену" read.
    s.box(r + p.xc, r + p.xc + p.tC, 0, kDim, 0, kDim, kMatConcrete);
}

void carve_voids(Sculpt& s, const Plan& p) {
    const int r = p.rot;
    // THE MAIN CHASM — all y, all z. Cuts the cross rib and the sky slab; a
    // body dropped here falls 256 m and arrives from above (z wraps).
    s.box(r + p.tA, r + p.tA + p.gap, 0, kDim, 0, kDim, kCellAir);
    // The slit crevasse along wall B's back face — narrow, also bottomless.
    s.box(r + p.pSlit0, r + p.pSlit0 + p.slit, 0, kDim, 0, kDim, kCellAir);
    // Terrace steps: the platform edge cascades down toward the slit.
    for (int st = 0; st < 3; ++st)
        s.box(r + p.pPlat0 + 2 * st, r + p.pPlat0 + 2 * st + 2, 0, kDim,
              p.zPlat - 6 + 2 * st, p.zPlat, kCellAir);
    // Interior well inside wall A: a full-height square shaft of quiet.
    s.box(r + p.wellX, r + p.wellX + p.wellW, p.wellY, p.wellY + p.wellW, 0,
          kDim, kCellAir);
}

// Bore tunnels: 3x3 passages punched clean through a wall, floor kept solid.
// Wall A bores stay above the platform (its back face meets the town); wall B
// bores link the chasm to the slit at any height.
void carve_bores(Sculpt& s, const Plan& p, std::uint32_t& rng) {
    const int r = p.rot;
    for (int i = 0; i < 3; ++i) {
        const int y = rnd(rng, 0, kDim - 4);
        const int z = rnd(rng, p.zPlat + 4, kDim - 12);
        s.box(r - 1, r + p.tA + 1, y, y + 3, z, z + 3, kCellAir);
    }
    for (int i = 0; i < 2; ++i) {
        const int y = rnd(rng, 0, kDim - 4);
        const int z = rnd(rng, 8, kDim - 12);
        s.box(r + p.tA + p.gap - 1, r + p.pSlit0 + 1, y, y + 3, z, z + 3,
              kCellAir);
    }
}

// Crossing pipes: solid 3x3 metal tubes spanning the chasm, embedded two cells
// into either wall, with a 1x1 crawl hollow and a walkable 2 m-wide top. Mass
// ADDED after the carves — a pipe survives the chasm that cut everything else.
void sculpt_pipes(Sculpt& s, const Plan& p, std::uint32_t& rng) {
    const int r = p.rot;
    for (int i = 0; i < 2; ++i) {
        const int y = rnd(rng, 0, kDim - 4);
        const int z = rnd(rng, 12, kDim - 16);
        s.box(r + p.tA - 2, r + p.tA + p.gap + 2, y, y + 3, z, z + 3,
              kMatPipeMetal);
        s.box(r + p.tA - 2, r + p.tA + p.gap + 2, y + 1, y + 2, z + 1, z + 2,
              kCellAir);
    }
}

// ---- stage 3a: the town ------------------------------------------------------
// Hollow boxes scattered on the platform top on a jittered grid — placement
// answers the ground (solid street below, open sky above), so houses thin out
// under the sky slab's shadow columns and vanish where the cross rib stands.
struct Roof {
    std::uint8_t x, y, w, d, z;
};

void sculpt_town(Sculpt& s, const Plan& p, std::uint32_t& rng,
                 std::vector<Roof>& roofs) {
    const int r = p.rot;
    const int x0 = p.pPlat0 + 8; // clear of the terrace steps
    for (int gy = 2; gy < kDim - 8; gy += 9) {
        for (int gx = x0; gx < kDim - 8; gx += 9) {
            if (rnd(rng, 0, 4) >= 3) continue;
            const int w = rnd(rng, 4, 6), d = rnd(rng, 4, 6);
            const int hc = rnd(rng, 2, 4);
            const int side = rnd(rng, 0, 3);
            const int doorAt = rnd(rng, 1, 2);
            // Keep clear of wall C's faces — that airspace belongs to its
            // serpentine strips and cornices.
            if (gx + w > p.xc - 4 && gx < p.xc + p.tC + 4) continue;
            // Ground must be street, the volume above must be open sky.
            bool fits = true;
            for (int y = gy; y < gy + d && fits; ++y)
                for (int x = gx; x < gx + w && fits; ++x)
                    fits = s.solid(r + x, y, p.zPlat - 1) &&
                           !s.solid(r + x, y, p.zPlat) &&
                           !s.solid(r + x, y, p.zPlat + hc);
            if (!fits) continue;
            // Perimeter walls, hollow interior.
            for (int z = p.zPlat; z < p.zPlat + hc; ++z)
                for (int y = gy; y < gy + d; ++y)
                    for (int x = gx; x < gx + w; ++x)
                        if (x == gx || x == gx + w - 1 || y == gy ||
                            y == gy + d - 1)
                            s.at(r + x, y, z) = kMatSlabTan;
            // One door, 1 cell wide, 2 tall.
            int dx = gx, dy = gy;
            if (side == 0) { dx = gx + doorAt; dy = gy; }
            else if (side == 1) { dx = gx + doorAt; dy = gy + d - 1; }
            else if (side == 2) { dx = gx; dy = gy + doorAt; }
            else { dx = gx + w - 1; dy = gy + doorAt; }
            s.at(r + dx, dy, p.zPlat) = kCellAir;
            s.at(r + dx, dy, p.zPlat + 1) = kCellAir;
            roofs.push_back({static_cast<std::uint8_t>(wrap_macro(r + gx)),
                             static_cast<std::uint8_t>(wrap_macro(gy)),
                             static_cast<std::uint8_t>(w),
                             static_cast<std::uint8_t>(d),
                             static_cast<std::uint8_t>(p.zPlat + hc)});
        }
    }
}

// ---- stage 3b: the labyrinth -------------------------------------------------
// Drunkard corridors inside the two great walls, in 2-cell-tall bands every
// 6 z. A walk that reaches the wall's shell either stops (dead end) or — one
// time in three — carves straight through: the corridor that opens onto the
// abyss with no warning. That opening is the module's thesis in one doorway.
void carve_labyrinth(Sculpt& s, const Plan& p, std::uint32_t& rng) {
    const int r = p.rot;
    struct WallRange { int x0, x1; }; // interior shell kept 2 cells thick
    const WallRange walls[3] = {{2, p.tA - 2},
                               {p.tA + p.gap + 2, p.pSlit0 - 2},
                               {p.xc + 2, p.xc + p.tC - 2}};
    for (int band = 3; band + 2 <= 125; band += 6) {
        for (int w = 0; w < 3; ++w) {
            const WallRange wr = walls[w];
            for (int walk = 0; walk < 9; ++walk) {
                int x = rnd(rng, wr.x0, wr.x1 - 1);
                int y = rnd(rng, 0, kDim - 1);
                for (int seg = 0; seg < 9; ++seg) {
                    const int along = rnd(rng, 3, 8);
                    const int dir = rnd(rng, 0, 3); // -x +x -y +y
                    for (int t = 0; t < along; ++t) {
                        if (dir < 2) {
                            const int nx = x + (dir == 0 ? -1 : 1);
                            if (nx < wr.x0 || nx >= wr.x1) {
                                // The shell. Usually a dead end; sometimes the
                                // corridor keeps going and the wall does not.
                                if (rnd(rng, 0, 2) == 0) {
                                    const int fx = dir == 0 ? wr.x0 - 2
                                                            : wr.x1 + 1;
                                    for (int px = (dir == 0 ? fx : x);
                                         px <= (dir == 0 ? x : fx); ++px)
                                        for (int dz = 0; dz < 2; ++dz)
                                            for (int dy = 0; dy < 2; ++dy)
                                                s.at(r + px, y + dy,
                                                     band + dz) = kCellAir;
                                }
                                break;
                            }
                            x = nx;
                        } else {
                            y += (dir == 2 ? -1 : 1);
                        }
                        for (int dz = 0; dz < 2; ++dz)
                            for (int dy = 0; dy < 2; ++dy)
                                s.at(r + x, y + dy, band + dz) = kCellAir;
                    }
                }
            }
        }
    }
}

// ---- stage 4: lattice lobbies and pylons ------------------------------------
// The fixed 4x4 shaft columns ([lattice.h]) land wherever the rotated massing
// put mass or void — the module answers per node. Lobby bands every 8 cells
// (air at 8k+3..8k+4 over a guaranteed floor at 8k+2) include the arrival band
// z = 3 ([blame.h] kBlameGroundCoord, save.h kArrivalCoord).
struct NodeInfo {
    bool pylon;
};

void sculpt_lattice(Sculpt& s, const Plan& /*p*/, NodeInfo (&nodes)[kLatticeDim][kLatticeDim]) {
    for (int ny = 0; ny < kLatticeDim; ++ny) {
        for (int nx = 0; nx < kLatticeDim; ++nx) {
            const int cx = lattice_coord(nx), cy = lattice_coord(ny);
            int solidCount = 0;
            for (int z = 0; z < kDim; ++z)
                if (s.solid(cx, cy, z)) ++solidCount;
            const bool pylon = solidCount < kDim / 2;
            nodes[ny][nx].pylon = pylon;

            if (pylon) {
                // A free-standing concrete tower around the shaft: 7x7, full
                // height, added only where the sculpt left void (a pylon
                // passing through the platform becomes a tower in the town).
                for (int z = 0; z < kDim; ++z)
                    for (int dy = -3; dy <= 3; ++dy)
                        for (int dx = -3; dx <= 3; ++dx)
                            if (!s.solid(cx + dx, cy + dy, z))
                                s.at(cx + dx, cy + dy, z) = kMatConcrete;
            }
            for (int k = 0; k < 16; ++k) {
                const int zb = 8 * k + 2;
                const int lr = pylon ? 2 : kFastLobbyR; // pylon keeps a shell
                for (int dz = 1; dz <= 2; ++dz)
                    for (int dy = -lr; dy <= lr; ++dy)
                        for (int dx = -lr; dx <= lr; ++dx)
                            s.at(cx + dx, cy + dy, zb + dz) = kCellAir;
                // The floor of the band is not negotiable — arrival stands on it.
                for (int dy = -kFastLobbyR; dy <= kFastLobbyR; ++dy)
                    for (int dx = -kFastLobbyR; dx <= kFastLobbyR; ++dx)
                        if (!s.solid(cx + dx, cy + dy, zb))
                            s.at(cx + dx, cy + dy, zb) = kMatConcrete;
                // Pylon doorways toward the facing walls, every other band.
                if (pylon && (k & 1) == 0) {
                    for (int dx : {-3, -2, 2, 3})
                        for (int dz = 1; dz <= 2; ++dz)
                            s.at(cx + dx, cy, zb + dz) = kCellAir;
                }
            }
            // The shaft itself: 3x3 air through every z, carved LAST so no
            // stage above can seal it.
            for (int z = 0; z < kDim; ++z)
                for (int dy = -kFastShaftR; dy <= kFastShaftR; ++dy)
                    for (int dx = -kFastShaftR; dx <= kFastShaftR; ++dx)
                        s.at(cx + dx, cy + dy, z) = kCellAir;
        }
    }
}

// ---- grid stamping -----------------------------------------------------------
// put_bits / put_sub: restated from padic_gen.cpp (the folder is the module).
void put_bits(MacroGrid& g, SubField<CellType>& sm, int x, int y, int z, int wz,
              std::uint64_t bits, CellType mat) {
    if (bits == 0 || z < 0 || z >= kDim) return;
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
            // Закон чтения (S16.1, sub_material_at [world/destruct.h]):
            // немаскированный атом страницы — ВОЗДУХ, не заливка базой
            // (фантомные кубы при классе 3 — фидбек владельца 2026-08-24).
            for (int i = 0; i < kSubVoxels; ++i)
                if (!m.test(i)) pg[i] = kCellAir;
        }
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

void stamp_sculpt(MacroGrid& g, SubField<CellType>& sm, Sculpt& s) {
    sm.clear();
    for (int z = 0; z < kDim; ++z)
        for (int y = 0; y < kDim; ++y)
            for (int x = 0; x < kDim; ++x) {
                g.clear_cell(x, y, z);
                const CellType v = s.at(x, y, z);
                if (v != kCellAir) g.fill_cell(x, y, z, v);
            }
}

// ---- stage 3c: bridges over the voids ---------------------------------------
// Classification, not coordinates: a deck row is placed only where the sculpt
// really left two solid anchors and a clear run between them — so bridges also
// answer the severed cross rib, the pylons, whatever the carves produced.
void stamp_deck_row(MacroGrid& g, SubField<CellType>& sm, int x0, int x1,
                    int y, int rows, int walkZ) {
    for (int row = 0; row < rows; ++row)
        for (int x = x0; x < x1; ++x)
            put_bits(g, sm, x, y + row, walkZ - 1, 7, kGrateBars, kMatTread);
}

// The bridge stage is a pure SCAN, no coordinates: at every deck level, walk
// each candidate row along x in plan space (plan x = 0 is inside wall A, so no
// air run ever straddles the seam) and span every solid|air...air|solid gap
// that is short enough to be a crossing and tall enough to walk. This is what
// bridges the chasm, the slit, both town canyons, the well — and the pylons,
// because a pylon face is just another solid answer.
void stamp_bridges(MacroGrid& g, SubField<CellType>& sm, Sculpt& s,
                   const Plan& p, std::uint32_t& rng) {
    const int r = p.rot;
    for (int i = 0; i < p.nDecks; ++i) {
        const int z = p.deckZ[i];
        if (z < 2 || z > kDim - 3) continue;
        for (int y = rnd(rng, 0, 9); y < kDim - 1; y += rnd(rng, 11, 17)) {
            if (rnd(rng, 0, 2) == 0) continue;
            int x = 1;
            while (x < kDim) {
                if (!s.solid(r + x - 1, y, z - 1)) { ++x; continue; }
                int b = x; // air run [x, b) from a solid anchor at x-1
                bool clear = true;
                while (b < kDim && !s.solid(r + b, y, z - 1)) {
                    for (int dz = -1; dz <= 2 && clear; ++dz)
                        clear = !s.solid(r + b, y, z + dz) &&
                                !s.solid(r + b, y + 1, z + dz);
                    if (!clear) break;
                    ++b;
                }
                if (!clear || b >= kDim) { x = b + 1; continue; }
                const int len = b - x;
                if (len >= 3 && len <= 44 && rnd(rng, 0, 2) != 0) {
                    stamp_deck_row(g, sm, r + x, r + b, y, 2, z);
                    if (len >= 8 && rnd(rng, 0, 3) == 0) {
                        // Broken mid-span: one cell stripped back, rubble
                        // teeth on the stubs — a 2 m jump over the void.
                        const int bx = r + x + len / 2;
                        for (int row = 0; row < 2; ++row) {
                            const int wx = wrap_macro(bx);
                            const int wy = wrap_macro(y + row);
                            SubMask& m = g.mask(wx, wy, z - 1);
                            m.words[7] = 0;
                            if (m.empty()) {
                                g.clear_cell(wx, wy, z - 1);
                                sm.drop_page(macro_index(wx, wy, z - 1));
                            }
                            put_bits(g, sm, bx - 1, y + row, z - 1, 7,
                                     0x8080808080808080ull, kMatRubble);
                            put_bits(g, sm, bx + 1, y + row, z - 1, 7,
                                     0x0101010101010101ull, kMatRubble);
                        }
                    }
                }
                x = b + 1;
            }
        }
    }
}

// Pylon catwalks: from every other lobby band, cast along +-x until a face
// answers within 40 cells; a clear run becomes a 1-row grate. This is what
// stitches a void pylon to the walls (and to a neighbouring pylon).
void stamp_catwalks(MacroGrid& g, SubField<CellType>& sm, Sculpt& s,
                    const NodeInfo (&nodes)[kLatticeDim][kLatticeDim]) {
    for (int ny = 0; ny < kLatticeDim; ++ny) {
        for (int nx = 0; nx < kLatticeDim; ++nx) {
            if (!nodes[ny][nx].pylon) continue;
            const int cx = lattice_coord(nx), cy = lattice_coord(ny);
            for (int k = 0; k < 16; k += 2) {
                const int z = 8 * k + 3;
                for (int dir : {-1, 1}) {
                    int reach = 0;
                    for (int d = 4; d <= 40; ++d) {
                        if (s.solid(cx + dir * d, cy, z - 1)) { reach = d; break; }
                        if (s.solid(cx + dir * d, cy, z) ||
                            s.solid(cx + dir * d, cy, z + 1))
                            break; // blocked run, no walk here
                    }
                    if (reach == 0) continue;
                    const int x0 = dir > 0 ? cx + 4 : cx - reach + 1;
                    const int x1 = dir > 0 ? cx + reach : cx - 3;
                    stamp_deck_row(g, sm, x0, x1, cy, 1, z);
                }
            }
        }
    }
}

// ---- stage 3d: serpentines and cornices -------------------------------------
// A cantilevered switchback ladder hung on the OUTSIDE of a wall face: padic's
// closed-riser flight (thickness 2/8, rise 1 per going 2) in a 2-cell-deep,
// 10-cell strip of open air — flights and 2x2 landings, the abyss on the third
// side. One leg drops 3 cells; legs alternate direction.
//
// TWO LANES, NOT ONE (owner's live playtest, 2026-08-17): descending and
// returning legs each get their OWN 1-cell lane of the strip's depth — padic's
// flight-A-row / flight-B-row split. The first build put both directions in
// the same lane and the opposing flights CROSSED mid-span at almost the same
// height: stair over stair, no way through. The landings span both lanes, so
// the turn is: walk off lane A, cross the 2x2 landing, step down lane B.
void stamp_serpentine(MacroGrid& g, SubField<CellType>& sm, int cx0, int y0,
                      int zTop, int zBot) {
    zTop -= (zTop - zBot) % 3; // land the last leg exactly on zBot's level
    const int legs = (zTop - zBot) / 3;
    for (int l = 0; l <= legs; ++l) {
        const int lvl = zTop - 3 * l;
        const bool lowSide = (l % 2) == 0;
        const int ly = lowSide ? y0 : y0 + 8;
        for (int row = 0; row < 2; ++row) {
            put_bits(g, sm, cx0, ly + row, lvl - 1, 6, kAllBits, kMatConcrete);
            put_bits(g, sm, cx0, ly + row, lvl - 1, 7, kAllBits, kMatConcrete);
            put_bits(g, sm, cx0 + 1, ly + row, lvl - 1, 6, kAllBits,
                     kMatConcrete);
            put_bits(g, sm, cx0 + 1, ly + row, lvl - 1, 7, kAllBits,
                     kMatConcrete);
        }
        if (l == legs) break;
        // The leg from landing l (walk level `lvl`) down to landing l+1, in
        // this leg's own lane: 8 sub-columns of depth, alternating by parity.
        const int baseZ = lvl - 3;
        const int lane = (l & 1) * 8;
        for (int i = 1; i <= 24; ++i) {
            for (int pair = 0; pair < 2; ++pair) {
                const int sy = lowSide ? 16 + 2 * (24 - i) + pair
                                       : 16 + 2 * (i - 1) + pair;
                for (int SX = lane; SX < lane + 8; ++SX)
                    for (int L = i - 2; L < i; ++L)
                        put_sub(g, sm, cx0, y0, baseZ, SX, sy, L, kMatConcrete);
            }
        }
    }
}

// A cornice: a bare 2 m-deep ledge running along a face — no rail, no roof.
void stamp_cornice(MacroGrid& g, SubField<CellType>& sm, int faceAirX, int y0,
                   int len, int walkZ) {
    for (int y = y0; y < y0 + len; ++y) {
        put_bits(g, sm, faceAirX, y, walkZ - 1, 6, kAllBits, kMatConcrete);
        put_bits(g, sm, faceAirX, y, walkZ - 1, 7, kAllBits, kMatConcrete);
    }
}

// A strip start BETWEEN lattice rows: rows sit 32 apart, a strip is 10 wide,
// so +7..+22 past a row never touches the next row's pylon (7x7 around ±3).
int strip_y(std::uint32_t& rng) {
    return lattice_coord(rnd(rng, 0, kLatticeDim - 1)) + 7 + rnd(rng, 0, 15);
}

void stamp_faces(MacroGrid& g, SubField<CellType>& sm, const Plan& p,
                 std::uint32_t& rng) {
    const int r = p.rot;
    // Serpentines: both chasm faces, the town faces (wall A's back and wall
    // C's), and the well interior.
    for (int i = 0; i < 2; ++i)
        stamp_serpentine(g, sm, r + p.tA, strip_y(rng), 123, 3);
    stamp_serpentine(g, sm, r + p.tA + p.gap - 2, strip_y(rng), 123, 3);
    stamp_serpentine(g, sm, r - 2, strip_y(rng), 123, p.zPlat);
    stamp_serpentine(g, sm, r + p.xc - 2, strip_y(rng), 123, p.zPlat);
    stamp_serpentine(g, sm, r + p.wellX, p.wellY, 123, 3);
    // Cornices: the slit's town-facing wall and the chasm faces, sparse.
    for (int i = 0; i < 3; ++i)
        stamp_cornice(g, sm, r + p.pSlit0, rnd(rng, 0, kDim - 40),
                      rnd(rng, 24, 40), p.zPlat + 8 + 16 * i);
    for (int i = 0; i < 2; ++i)
        stamp_cornice(g, sm, r + p.tA, rnd(rng, 0, kDim - 60),
                      rnd(rng, 32, 56), rnd(rng, 30, 110));
}

// Roof slabs live in the TOP quarter of the top wall cell — the padic sandwich
// convention (a walking surface is words 6..7 of the cell BELOW your feet).
// The first build hung them in the BOTTOM words of the cell above, which is a
// cell that reads solid but has its mass at your ankles: the placement
// resolver seated a body inside it and the body stuck (owner's playtest).
// Interior cells only — the perimeter walls are already full concrete there.
void stamp_roofs(MacroGrid& g, SubField<CellType>& sm,
                 const std::vector<Roof>& roofs) {
    for (const Roof& rf : roofs)
        for (int y = rf.y + 1; y < rf.y + rf.d - 1; ++y)
            for (int x = rf.x + 1; x < rf.x + rf.w - 1; ++x) {
                put_bits(g, sm, x, y, rf.z - 1, 6, kAllBits, kMatSlabTan);
                put_bits(g, sm, x, y, rf.z - 1, 7, kAllBits, kMatSlabTan);
            }
}

// ---- lattice ground truth ----------------------------------------------------
// МОГИЛА ТЕЛЕПОРТ-ОБВЕСА (решение владельца 2026-08-27, как у падика):
// hub-pad перекраска узловых слоёв и четыре синих угловых столба умерли с
// бескабинным телепортом. Остался финальный re-clear шахты — чтобы ни один
// суб-воксельный захлёст палуб/пролётов не запачкал кабинную колонну.
void stamp_lattice_markers(MacroGrid& g, SubField<CellType>& sm) {
    for (int ny = 0; ny < kLatticeDim; ++ny) {
        for (int nx = 0; nx < kLatticeDim; ++nx) {
            const int cx = lattice_coord(nx), cy = lattice_coord(ny);
            for (int z = 0; z < kDim; ++z)
                for (int dy = -kFastShaftR; dy <= kFastShaftR; ++dy)
                    for (int dx = -kFastShaftR; dx <= kFastShaftR; ++dx) {
                        const int x = wrap_macro(cx + dx), y = wrap_macro(cy + dy);
                        g.clear_cell(x, y, z);
                        sm.drop_page(macro_index(x, y, z));
                    }
        }
    }
}

} // namespace

// THE MODULE'S LAWS — same split as padic ([floor_gen.h], three-step entry).
void blame_declare_rules(World& world, int /*number*/, const FloorSpec& /*spec*/,
                         unsigned /*seed*/) {
    world.subfields().get_or_create<CellType>(kSubMaterialName);
    world.gravity().global = vec3{0.0f, 0.0f, -9.81f};
    world.gravity().regime = kBlameGravity;
}

// Rules on top of finished geometry: the void carries no standing water and no
// gas today — but a recycled World slot may still hold the previous floor's
// fluids, and a restored snapshot carries geometry only, so both fields are
// created-or-zeroed on every entry.
void blame_apply_rules(World& world, int /*number*/, const FloorSpec& /*spec*/,
                       unsigned /*seed*/) {
    // Поля воды и газа МЕРТВЫ (чистки 2026-08-24/25): вода — материя
    // автомата, засев газа вырезан стабилизацией.
}

void generate_blame_floor(World& world, int number, const FloorSpec& spec,
                          unsigned seed) {
    MacroGrid& g = world.grid();
    SubField<CellType>& sm =
        world.subfields().get_or_create<CellType>(kSubMaterialName);

    Plan p;
    build_plan(p, seed, number);
    // One rng chain per stage family, all hashed off the same pair, so a stage
    // can be retuned without silently re-rolling every later stage.
    const std::uint32_t salt = hash_u32(static_cast<std::uint32_t>(seed) ^
                                        (static_cast<std::uint32_t>(number) *
                                         0x51ED270Bu));
    std::uint32_t carveRng = hash_u32(salt ^ 0xCA47Eu);
    std::uint32_t townRng = hash_u32(salt ^ 0x70A2u);
    std::uint32_t mazeRng = hash_u32(salt ^ 0x3A2Eu);
    std::uint32_t faceRng = hash_u32(salt ^ 0xFACEu);
    std::uint32_t deckRng = hash_u32(salt ^ 0xDECCu);

    Sculpt s;
    sculpt_masses(s, p);
    carve_voids(s, p);
    carve_bores(s, p, carveRng);
    sculpt_pipes(s, p, carveRng);
    std::vector<Roof> roofs;
    sculpt_town(s, p, townRng, roofs);
    carve_labyrinth(s, p, mazeRng);
    NodeInfo nodes[kLatticeDim][kLatticeDim];
    sculpt_lattice(s, p, nodes);

    // Far fewer paged cells than padic's per-storey sandwich: pages appear only
    // where grammar elements share a cell with another material.
    sm.reserve_pages(200000);
    stamp_sculpt(g, sm, s);

    stamp_bridges(g, sm, s, p, deckRng);
    stamp_catwalks(g, sm, s, nodes);
    stamp_faces(g, sm, p, faceRng);
    stamp_roofs(g, sm, roofs);
    stamp_lattice_markers(g, sm);

    (void)spec.population; // geometry ignores population; the seeder consumes it
}

std::uint32_t blame_rooms(int number, unsigned seed, FloorRooms& out) {
    // Комнаты мегаструктуры (rooms-object C): у пустоты жильё одно — лобби
    // решётки, «герметичная комната под городом» ([blame.md]). sculpt_lattice
    // гарантирует воздух зоны 5x5 на КАЖДОМ узле (у пилона lr=2, у массива 3;
    // зона агностична к геометрии — берём гарантированное ядро, не заглядывая
    // в скульпт) и пол под ним; band k: воздух 8k+3..8k+4. Чистая функция —
    // от (seed, number) здесь не зависит ничего, но сигнатура диспетчера
    // едина, и будущая грамматика комнат города ею воспользуется.
    (void)number;
    (void)seed;
    std::int16_t declared[kVerbCount] = {};
    declared[kVerbShelter] = 10; // гермолобби: за стеной лучше, чем снаружи (S13.3)
    std::uint32_t n = 0;
    for (int ny = 0; ny < kLatticeDim; ++ny)
        for (int nx = 0; nx < kLatticeDim; ++nx) {
            const int cx = lattice_coord(nx), cy = lattice_coord(ny);
            for (int k = 0; k < 16; ++k) {
                const RoomBox box{static_cast<std::uint8_t>(wrap_macro(cx - 2)),
                                  static_cast<std::uint8_t>(wrap_macro(cy - 2)),
                                  static_cast<std::uint8_t>(8 * k + 3),
                                  5, 5, 2};
                if (room_declare(out, &box, 1, kRoomTagHermetic, /*owner=*/0,
                                 declared) != kNoRoom)
                    ++n;
            }
        }
    return n;
}

} // namespace giga::game
