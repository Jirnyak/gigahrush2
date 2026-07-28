#include "game/floor_gen.h"

#include <cstddef>
#include <cstdint>

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
    int shafts;    // vertical stairwell shafts punched through every slab
};

//                         storey stride doorH pillars gap hole rubble shafts
constexpr FloorGeom kGeom[] = {
    /* Residential */ {  4,  8, 2, false,  0,  0, 0,  6},
    /* Commercial  */ {  8, 16, 3, false,  0,  0, 0,  8},
    /* Industrial  */ { 16, 32, 5, true,   0,  0, 2, 10},
    /* Derelict    */ {  4,  8, 2, false, 38, 12, 9,  4},
};
static_assert(sizeof(kGeom) / sizeof(kGeom[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "geometry table must have exactly one row per FloorKind");

const FloorGeom& geom_for(FloorKind kind) {
    std::size_t i = static_cast<std::size_t>(kind);
    if (i >= static_cast<std::size_t>(FloorKind::Count)) i = 0;
    return kGeom[i];
}

} // namespace

void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed) {
    MacroGrid& g = world.grid();
    constexpr CellType kSlab = 4; // floor/ceiling slab (tan)
    constexpr CellType kWall = 1; // concrete wall / rubble (grey)

    const FloorGeom& geom = geom_for(spec.kind);
    Rng rng(floor_seed(seed, number));

    const int storey = geom.storey;
    const int stride = geom.stride;
    const int storeys = kMacroDim / storey;
    const int roomsPerAxis = kMacroDim / stride;

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

        // Doorways: open one gap in every wall segment between adjacent rooms so
        // the storey is one connected apartment graph. Skipped in pillar mode —
        // an open plate is already fully connected.
        if (!geom.pillars) {
            const int doorTop = base + 1 + geom.doorH;
            for (int rx = 0; rx < roomsPerAxis; ++rx)
                for (int ry = 0; ry < roomsPerAxis; ++ry) {
                    // Door through the vertical wall (x == rx*stride).
                    const int wx = rx * stride;
                    const int dy = ry * stride + 2 + rng.below(stride - 3);
                    for (int z = base + 1; z < doorTop && z < top; ++z)
                        g.clear_cell(wx, dy, z);
                    // Door through the horizontal wall (y == ry*stride).
                    const int wy = ry * stride;
                    const int dx = rx * stride + 2 + rng.below(stride - 3);
                    for (int z = base + 1; z < doorTop && z < top; ++z)
                        g.clear_cell(dx, wy, z);
                }
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

    // Stairwell shafts: 2x2 columns punched through every slab so you can move
    // between storeys. Because Z wraps, a full-height shaft also links the top
    // storey back down to storey 0.
    for (int i = 0; i < geom.shafts; ++i) {
        const int rx = rng.below(roomsPerAxis);
        const int ry = rng.below(roomsPerAxis);
        const int sx = rx * stride + stride / 2;
        const int sy = ry * stride + stride / 2;
        for (int z = 0; z < kMacroDim; ++z)
            for (int dy = 0; dy < 2; ++dy)
                for (int dx = 0; dx < 2; ++dx)
                    g.clear_cell(wrap_macro(sx + dx), wrap_macro(sy + dy), z);
    }

    (void)spec.population; // geometry ignores population; the seeder consumes it
}

} // namespace giga::game
