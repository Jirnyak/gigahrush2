#include "game/floor_gen.h"

#include <cstddef>
#include <cstdint>

#include "world/materials.h"
#include "world/lattice.h"
#include "world/types.h"
#include "world/world.h"

namespace giga::game {

namespace {

// --- deterministic RNG -----------------------------------------------------
// xorshift32, same stream as worldgen.cpp so generation is reproducible from a
// single integer seed.
struct Rng {
    std::uint32_t s;
    explicit Rng(std::uint32_t seed) : s(seed ? seed : 1u) {}
    std::uint32_t next() {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        return s;
    }
    int below(int n) {
        return n > 0 ? static_cast<int>(next() % static_cast<unsigned>(n)) : 0;
    }
};

// Mix the world seed and the floor number into one stable stream. A floor is a
// pure function of (seed, number): the same pair always rebuilds the same
// geometry, while adjacent floors of the same kind look unrelated. Avalanche is
// splitmix32's finalizer so nearby numbers don't produce correlated layouts.
std::uint32_t floor_seed(unsigned seed, int number) {
    std::uint32_t h = static_cast<std::uint32_t>(seed) +
                      static_cast<std::uint32_t>(number) * 0x9E3779B9u;
    h ^= h >> 16;
    h *= 0x85EBCA6Bu;
    h ^= h >> 13;
    h *= 0xC2B2AE35u;
    h ^= h >> 16;
    return h ? h : 1u;
}

// --- geometry profile ------------------------------------------------------
// One row per FloorKind (enum order). This table IS the theming: retune a whole
// floor family by editing a row, never by branching in the builder below.
//
// `storey` and `stride` MUST divide kMacroDim (128) so the slabs (Z) and wall
// lattice (X/Y) tile the torus seamlessly across the wrap — the top storey's
// ceiling is floor-0's slab, and the east wall meets the west wall. All rows
// below use divisors of 128.
struct FloorGeom {
    int storey;    // Z cells per internal storey (divides 128)
    int stride;    // X/Y room-lattice pitch (divides 128)
    int doorH;     // doorway opening height, cells above the slab
    bool pillars;  // walls are pillars at lattice crossings only (open plate)
    int gapPct;    // % of wall cells knocked out (0 = intact ... high = maze/decay)
    int holePct;   // % of slab cells missing (collapsed floors, vertical holes)
    int rubblePct; // % of interior air cells filled with a debris block
    CellType wall; // material id for this kind's walls  ([voxels.md])
    CellType slab; // material id for this kind's floor/ceiling slabs
};

// The two material columns are what make a floor kind *look* like itself rather
// than only be shaped like itself. Until now every kind wrote the same two cell
// types, so an Industrial plate and a Residential warren rendered in identical
// grey and tan — the maze demo's palette. The albedos behind these ids are
// measured off real photographs where a real material exists (data/materials.csv)
// and authored where none does; see kMaterial in render/cube_pass.cpp.
//
//                         storey stride doorH pillars gap hole rubble  wall  slab
constexpr FloorGeom kGeom[] = {
    /* Residential */ {  4,  8, 2, false,  0,  0, 0, kMatPlaster,     kMatParquet },
    /* Commercial  */ {  8, 16, 3, false,  0,  0, 0, kMatShopShutter, kMatLino    },
    /* Industrial  */ { 16, 32, 5, true,   0,  0, 2, kMatFactoryWall, kMatTread   },
    /* Derelict    */ {  4,  8, 2, false, 38, 12, 9, kMatRust,        kMatRubble  },
};
static_assert(sizeof(kGeom) / sizeof(kGeom[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "geometry table must have exactly one row per FloorKind");

const FloorGeom& geom_for(FloorKind kind) {
    std::size_t i = static_cast<std::size_t>(kind);
    if (i >= static_cast<std::size_t>(FloorKind::Count)) i = 0;
    return kGeom[i];
}

// --- doorway placement ------------------------------------------------------
// Where the opening sits inside one wall segment, in cells from the segment's
// low corner. Range [2, stride-2], matching the original `2 + rng.below(stride-3)`
// — far enough from both lattice crossings that the opening's jambs are real wall
// cells and not a corner.
//
// A PURE HASH and deliberately not a draw from `rng`. door.cpp must enumerate
// exactly these cells at floor load, and replaying the shared xorshift stream
// would tie it to the order the slab / wall / rubble loops consume numbers in —
// retune `rubblePct` and every door on every floor silently moves. See the note on
// floor_doorways in [floor_gen.h].
//
// The four inputs pack into 16 bits (storey <= 31, room <= 31 each, axis <= 1), so
// one splitmix32 finalizer over (fseed ^ key*phi) decorrelates all of them.
int doorway_slot(std::uint32_t fseed, int storey, int rx, int ry, int axis,
                 int stride) {
    const std::uint32_t key = static_cast<std::uint32_t>(storey & 31) |
                              (static_cast<std::uint32_t>(rx & 31) << 5) |
                              (static_cast<std::uint32_t>(ry & 31) << 10) |
                              (static_cast<std::uint32_t>(axis & 1) << 15);
    std::uint32_t h = fseed ^ (key * 0x9E3779B9u);
    h ^= h >> 16;
    h *= 0x7FEB352Du;
    h ^= h >> 15;
    h *= 0x846CA68Bu;
    h ^= h >> 16;
    const int span = stride - 3;
    return 2 + (span > 0 ? static_cast<int>(h % static_cast<unsigned>(span)) : 0);
}

// Visit every doorway of a floor: fn(cx, cy, cz, h, axis).
//
// ONE definition, two callers — generate_floor punches these cells and
// floor_doorways reports them. Sharing the walk (and not just the hash) is what
// makes "the doors are exactly where the openings are" a property of the code
// rather than a claim about two loops that happen to look alike today.
template <class Fn>
void for_each_doorway(const FloorGeom& geom, std::uint32_t fseed, Fn&& fn) {
    if (geom.pillars) return; // an open plate is already fully connected
    const int storeys = kMacroDim / geom.storey;
    const int roomsPerAxis = kMacroDim / geom.stride;
    for (int f = 0; f < storeys; ++f) {
        const int base = f * geom.storey;
        const int z0 = base + 1;               // first air cell above the slab
        int h = geom.doorH;
        if (z0 + h > base + geom.storey) h = base + geom.storey - z0;
        if (h <= 0) continue;
        for (int rx = 0; rx < roomsPerAxis; ++rx)
            for (int ry = 0; ry < roomsPerAxis; ++ry) {
                // Through the wall line x == rx*stride.
                fn(rx * geom.stride,
                   ry * geom.stride +
                       doorway_slot(fseed, f, rx, ry, 0, geom.stride),
                   z0, h, 0);
                // Through the wall line y == ry*stride.
                fn(rx * geom.stride +
                       doorway_slot(fseed, f, rx, ry, 1, geom.stride),
                   ry * geom.stride, z0, h, 1);
            }
    }
}

} // namespace

int floor_room_stride(FloorKind kind) { return geom_for(kind).stride; }

std::uint32_t floor_doorways(int number, const FloorSpec& spec, unsigned seed,
                             std::vector<Doorway>& out) {
    std::uint32_t n = 0;
    for_each_doorway(
        geom_for(spec.kind), floor_seed(seed, number),
        [&](int cx, int cy, int cz, int h, int axis) {
            out.push_back(Doorway{static_cast<std::uint8_t>(wrap_macro(cx)),
                                  static_cast<std::uint8_t>(wrap_macro(cy)),
                                  static_cast<std::uint8_t>(cz),
                                  static_cast<std::uint8_t>(h),
                                  static_cast<std::uint8_t>(axis)});
            ++n;
        });
    return n;
}

void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed) {
    MacroGrid& g = world.grid();
    const FloorGeom& geom = geom_for(spec.kind);
    // Per-kind materials, from the table above.
    const CellType kSlab = geom.slab;
    const CellType kWall = geom.wall;
    constexpr CellType kHubPad = kMatHubPad;
    Rng rng(floor_seed(seed, number));

    const int storey = geom.storey;
    const int stride = geom.stride;
    const int storeys = kMacroDim / storey;

    // 0. Clear to air. Building into a known-empty grid is what makes the result
    //    depend only on (number, kind, seed), so a recycled World regenerates
    //    identically (no dependence on whatever floor used this slot before).
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                g.clear_cell(x, y, z);

    for (int f = 0; f < storeys; ++f) {
        const int base = f * storey;   // z of this storey's slab
        const int top = base + storey; // exclusive; == next storey's slab z

        // Slab: a solid plane at the base of the storey, doubling as the ceiling
        // of the storey below. Derelict floors drop a fraction of slab cells,
        // opening vertical holes where the floor has collapsed.
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x) {
                if (geom.holePct && rng.below(100) < geom.holePct) continue;
                g.fill_cell(x, y, base, kSlab);
            }

        // Interior partitions: full-height walls on the room lattice. In pillar
        // mode only the lattice crossings are solid (an open plate on columns);
        // otherwise the whole grid line is a wall. `gapPct` knocks out a fraction
        // to break the layout into a maze (decay).
        for (int z = base + 1; z < top; ++z)
            for (int y = 0; y < kMacroDim; ++y)
                for (int x = 0; x < kMacroDim; ++x) {
                    const bool onX = (x % stride) == 0;
                    const bool onY = (y % stride) == 0;
                    const bool wall = geom.pillars ? (onX && onY) : (onX || onY);
                    if (!wall) continue;
                    if (geom.gapPct && rng.below(100) < geom.gapPct) continue;
                    g.fill_cell(x, y, z, kWall);
                }

        // Rubble: scatter debris blocks in interior air just above the slab
        // (derelict clutter / industrial machinery), never on the wall lattice.
        if (geom.rubblePct) {
            const int z = base + 1;
            for (int y = 0; y < kMacroDim; ++y)
                for (int x = 0; x < kMacroDim; ++x) {
                    if ((x % stride) == 0 || (y % stride) == 0) continue;
                    if (rng.below(100) < geom.rubblePct) g.fill_cell(x, y, z, kWall);
                }
        }
    }

    // Doorways: open one gap in every wall segment between adjacent rooms so each
    // storey is one connected apartment graph. Skipped in pillar mode — an open
    // plate is already fully connected.
    //
    // One pass over all storeys rather than a step inside the loop above, and that
    // is safe rather than merely tidier: the only later writer is the rubble
    // scatter, which skips every cell on the wall lattice, and a doorway is always
    // on one. The walk and the offset hash are shared with floor_doorways() so the
    // door system cannot disagree with the geometry about where an opening is.
    for_each_doorway(geom, floor_seed(seed, number),
                     [&](int cx, int cy, int cz, int h, int) {
                         for (int z = cz; z < cz + h; ++z)
                             g.clear_cell(cx, cy, z);
                     });

    // Fast-travel / navigation lattice: a FIXED 4x4x4 = 64-node grid, stamped
    // identically into every floor (src/world/lattice.h) and INDEPENDENT of the
    // seed — these hubs replace the old random stairwells. They are both the
    // elevator hub set (elevators.md) and the coarse graph the nav bake rides on
    // (master_prompt #11), so their placement and mutual connectivity must be
    // deterministic and must NOT depend on the RNG.
    //
    // The 64 graph nodes sit at cell centres {16,48,80,112} on each axis;
    // vertically a single full-height shaft per (x,y) column links all four
    // z-levels (and, via the Z wrap, the top storey back to storey 0), so the
    // geometry only has to punch the 4x4 = 16 columns. At each column punch a
    // 3x3 shaft through every slab, then open a 7x7 lobby in each storey's air
    // band while KEEPING the slab, so the shaft always joins the room graph and
    // there is a floor to stand on.
    constexpr int kShaftR = 1; // 3x3 shaft column, punched to air through slabs
    constexpr int kLobbyR = 3; // 7x7 lobby, walls opened per storey (slab kept)
    for (int ny = 0; ny < kLatticeDim; ++ny)
        for (int nx = 0; nx < kLatticeDim; ++nx) {
            const int cx = lattice_coord(nx);
            const int cy = lattice_coord(ny);
            for (int z = 0; z < kMacroDim; ++z)
                for (int dy = -kShaftR; dy <= kShaftR; ++dy)
                    for (int dx = -kShaftR; dx <= kShaftR; ++dx)
                        g.clear_cell(wrap_macro(cx + dx), wrap_macro(cy + dy), z);
            for (int f = 0; f < storeys; ++f) {
                const int base = f * storey;
                for (int z = base + 1; z < base + storey; ++z)
                    for (int dy = -kLobbyR; dy <= kLobbyR; ++dy)
                        for (int dx = -kLobbyR; dx <= kLobbyR; ++dx)
                            g.clear_cell(wrap_macro(cx + dx), wrap_macro(cy + dy),
                                         z);
            }
            // Hub pads: recolour the slab at each of the 4 lattice z-levels
            // (16/48/80/112) across the lobby footprint to a distinct type,
            // leaving the shaft hole open. This makes the 4x4x4 = 64 nodes read
            // as stacked landing pads (4 per shaft column) instead of a flat 4x4
            // of grey shafts, and makes them findable from across the floor.
            for (int nz = 0; nz < kLatticeDim; ++nz) {
                const int z0 = lattice_coord(nz);
                for (int dy = -kLobbyR; dy <= kLobbyR; ++dy)
                    for (int dx = -kLobbyR; dx <= kLobbyR; ++dx) {
                        const int x = wrap_macro(cx + dx);
                        const int y = wrap_macro(cy + dy);
                        if (g.cell(x, y, z0) != kCellAir)
                            g.set_cell(x, y, z0, kHubPad);
                    }
            }
            // The extraction pad — the bank, and ONLY on the hub.
            //
            // Recolours the ground-storey slab (z=0) inside the lobby ring, which
            // is the one pad surface a walking body ever has under its feet: it
            // stands at cell z=1, and on_extraction_pad checks the cell it is in
            // and the one below. The 3x3 shaft hole is already air here and the
            // != air guard leaves it open, so what remains is a 7x7-minus-3x3 ring
            // of 40 cells around each of the 16 shafts.
            //
            // Hub only, and that is the whole loop rather than an optimisation: if
            // you could bank on the floor you looted, carried value would never be
            // at risk for longer than it took to walk to the nearest lobby, and
            // "value is not yours until it is banked" ([extraction.h]) would cost
            // nothing. Riding back up IS the extraction.
            if (number == 0) {
                for (int dy = -kLobbyR; dy <= kLobbyR; ++dy)
                    for (int dx = -kLobbyR; dx <= kLobbyR; ++dx) {
                        const int x = wrap_macro(cx + dx);
                        const int y = wrap_macro(cy + dy);
                        if (g.cell(x, y, 0) != kCellAir)
                            g.set_cell(x, y, 0, kMatExtract);
                    }
            }
            // Elevator column: 4 full-height posts hugging the shaft, so each of
            // the 16 shafts reads as ONE continuous vertical column spanning the
            // whole map (Z wraps, so the column closes into a loop). The 3x3
            // interior stays open to ride / fall through, and the 4 orthogonal
            // sides stay open so the lobby still joins the rooms — only the 4
            // diagonal corners are posted. The pads above mark the 4 stops
            // (nodes) along each column: 16 columns x 4 stops = 64.
            for (int sy = -1; sy <= 1; sy += 2)
                for (int sx = -1; sx <= 1; sx += 2)
                    for (int z = 0; z < kMacroDim; ++z)
                        g.fill_cell(wrap_macro(cx + sx * 2),
                                    wrap_macro(cy + sy * 2), z, kHubPad);
        }

    (void)spec.population; // geometry ignores population; the seeder consumes it
}

} // namespace giga::game
