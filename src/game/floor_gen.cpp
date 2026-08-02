#include "game/floor_gen.h"
#include "core/rng.h"

#include <bit>
#include <cstddef>
#include <cstdint>

#include "game/floors/padic/padic.h" // generate_padic_floor — the module's row below
#include "sim/fluid.h"  // kFluidField — one name for the liquid field, four consumers
#include "world/field.h"
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
    std::uint32_t h = giga::hash_u32(static_cast<std::uint32_t>(seed) +
                      static_cast<std::uint32_t>(number) * 0x9E3779B9u);
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
    int gapPct;    // % of wall cells knocked out (0 = intact ... high = maze/decay)
    int holePct;   // % of slab cells missing (collapsed floors, vertical holes)
    int sumps;     // walled pools of standing water on the ground storey (0 = dry)
    int sumpR;     // basin half-width in cells; the water patch is (2R+1)^2
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
// The `sumps`/`sumpR` pair is what makes the cellular fluid sim reachable in the
// shipped mode at all (see `Standing water` in [floor_gen.h]). Only the two kinds
// whose fiction carries plumbing get water: an Industrial plate has burst process
// pipes and containment bunds (4 basins of 5x5 = 100 cells), a Derelict floor has
// flooded sumps in a half-collapsed warren (12 basins of 3x3 = 108 cells). A
// Residential warren and a Commercial hall stay dry, and that is load-bearing rather
// than thematic: fluid_step does not create the field it cannot find, so those two
// kinds pay one hash lookup per step instead of 8 MiB.
//
//                         storey stride doorH gap hole sump sumpR  wall  slab
constexpr FloorGeom kGeom[] = {
    /* Residential */ {  4,  8, 2,  0,  0,  0, 0, kMatPlaster,     kMatParquet },
    /* Commercial  */ {  8, 16, 3,  0,  0,  0, 0, kMatShopShutter, kMatLino    },
    /* Industrial  */ { 16, 32, 5,  0,  0,  4, 2, kMatFactoryWall, kMatTread   },
    /* Derelict    */ {  4,  8, 2, 38, 12, 12, 1, kMatRust,        kMatRubble  },
    /* Padic       */ {  2,  4, 1, 50, 25,  0, 0, kMatRust,        kMatRubble  },
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
    std::uint32_t h = giga::hash_u32(fseed ^ (key * 0x9E3779B9u));
    const int span = stride - 3;
    return 2 + (span > 0 ? static_cast<int>(h % static_cast<unsigned>(span)) : 0);
}

// --- the fixed lattice's footprint -----------------------------------------
// Hoisted out of generate_floor because the sump seeder has to stay OFF it, and two
// copies of "3" is how a basin ends up half inside an elevator lobby.
constexpr int kShaftR = 1; // 3x3 shaft column, punched to air through slabs
constexpr int kLobbyR = 3; // 7x7 lobby, walls opened per storey (slab kept)

// Splitmix32 finalizer. The same avalanche doorway_slot uses, exposed once because
// the room taxonomy and the sump placement both need a PURE hash rather than a draw
// from `rng` — see the note on doorway_slot for why replaying the shared xorshift
// stream couples a consumer to the order every other loop consumes numbers in.
std::uint32_t mix32(std::uint32_t h) {
    h ^= h >> 16;
    h *= 0x7FEB352Du;
    h ^= h >> 15;
    h *= 0x846CA68Bu;
    h ^= h >> 16;
    return h;
}

// Toroidal separation on one axis, 0 .. kMacroDim/2. Both operands are already
// normalized, which is what wrap_delta assumes.
int axis_gap(int a, int b) {
    const int d = wrap_delta(a, b, kMacroDim);
    return d < 0 ? -d : d;
}

// Would a square of half-width `r` centred on (cx, cy) touch any of the 16 lattice
// columns' 7x7 lobby footprints? Two axis-aligned squares overlap exactly when they
// overlap on BOTH axes, so this is one gap test per axis per column — 16 columns,
// checked at floor generation, a handful of sumps.
bool overlaps_lattice(int cx, int cy, int r) {
    const int reach = kLobbyR + r;
    for (int ny = 0; ny < kLatticeDim; ++ny)
        for (int nx = 0; nx < kLatticeDim; ++nx)
            if (axis_gap(cx, lattice_coord(nx)) <= reach &&
                axis_gap(cy, lattice_coord(ny)) <= reach)
                return true;
    return false;
}

// Visit every doorway of a floor: fn(cx, cy, cz, h, axis).
//
// ONE definition, two callers — generate_floor punches these cells and
// floor_doorways reports them. Sharing the walk (and not just the hash) is what
// makes "the doors are exactly where the openings are" a property of the code
// rather than a claim about two loops that happen to look alike today.
template <class Fn>
void for_each_doorway(const FloorGeom& geom, std::uint32_t fseed, Fn&& fn) {
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

// --- room taxonomy ----------------------------------------------------------
// One weighted row per FloorKind: which RoomBits this kind's lattice produces and in
// what proportion. The theming lives here, never as a branch in floor_room_mask.
//
// The weights are NOT free, and the constraint is measured rather than aesthetic. The
// filter these bits drive returns weight 0 on a mismatch, so a room whose bit matches
// little in a table generates little — and each bit's real pool is small. Measured on
// data/mobs.csv against the six habitat anchors, average heads per pack by room bit at
// anchor Z0: storage 4.72, common 4.21, corridor 3.74, production 1.42, bathroom 1.22,
// smoking 1.00, against 3.84 for the unfiltered roster. So a Derelict mix leaning on
// bathrooms would quietly shrink every pack on the floor by a third. Each row below
// therefore leans on the bits its fiction shares with the content tables:
//
//   Residential  living/kitchen/bathroom/common/corridor/storage — an apartment
//   Commercial   office/common/storage/hq/smoking/medical        — a ministry floor
//   Industrial   production/storage/corridor/smoking             — a works
//   Derelict     the residential warren gone to storage and rot
struct RoomMix { RoomBit bit; std::uint8_t w; };

constexpr RoomMix kRoomsResidential[] = {
    {RoomBit::Living, 30},   {RoomBit::Kitchen, 16}, {RoomBit::Bathroom, 12},
    {RoomBit::Common, 14},   {RoomBit::Corridor, 10}, {RoomBit::Storage, 18},
};
constexpr RoomMix kRoomsCommercial[] = {
    {RoomBit::Office, 34},   {RoomBit::Common, 16},  {RoomBit::Storage, 16},
    {RoomBit::Hq, 10},       {RoomBit::Smoking, 8},  {RoomBit::Medical, 16},
};
constexpr RoomMix kRoomsIndustrial[] = {
    {RoomBit::Production, 44}, {RoomBit::Storage, 26}, {RoomBit::Corridor, 16},
    {RoomBit::Smoking, 14},
};
constexpr RoomMix kRoomsDerelict[] = {
    {RoomBit::Storage, 30},  {RoomBit::Corridor, 26}, {RoomBit::Common, 24},
    {RoomBit::Production, 14}, {RoomBit::Bathroom, 6},
};
// Four bits, not two: the taxonomy invariant (suite_fluidrooms §5) is that every
// kind's authored bits all appear on a floor, with 4 as the floor — a kind
// narrower than that starves the per-room item/mob filters of variety.
constexpr RoomMix kRoomsPadic[] = {
    {RoomBit::Corridor, 34}, {RoomBit::Storage, 30},
    {RoomBit::Common, 20},   {RoomBit::Production, 16},
};

struct RoomMixRow { const RoomMix* tab; std::uint8_t n; };

template <std::size_t N>
constexpr RoomMixRow room_row(const RoomMix (&a)[N]) {
    return {a, static_cast<std::uint8_t>(N)};
}

constexpr RoomMixRow kRoomMix[] = {
    room_row(kRoomsResidential), room_row(kRoomsCommercial),
    room_row(kRoomsIndustrial),  room_row(kRoomsDerelict),
    room_row(kRoomsPadic),
};
static_assert(sizeof(kRoomMix) / sizeof(kRoomMix[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "room-mix table must have exactly one row per FloorKind");
static_assert(static_cast<std::uint16_t>(RoomBit::Hq) == (1u << 10),
              "kFloorRoomBits assumes Hq is the highest RoomBit");

// --- standing water ---------------------------------------------------------
// Z of the water: the ground storey's first air cell, one above the slab floor_gen
// lays at z=0. The same cell containers stand on and mobs are placed in
// (`kGroundZ` in container.cpp / mob_spawn.cpp), because that is the one storey the
// game actually puts a body on.
constexpr int kSumpZ = 1;

// Draws per sump before it is dropped. A draw can fail the lattice test or collide with
// a basin already placed, and the valid area is most of a room: for Industrial
// (stride 32, basin outer 3) the centre is confined to a 25x25 local window of which a
// 13x13 block is lobby, so a single draw fails with p = 0.27 and eight draws with
// p = 3e-5. Simulated over the exact hash for five (seed, number) pairs per kind, all
// 4 Industrial and all 12 Derelict basins placed every time.
constexpr int kSumpTries = 8;

// Most basins one kind may ask for. A fixed array rather than a vector: the collision
// test is O(placed) over at most this many, and the clamp is what keeps a future row
// edit from writing past the end of it.
constexpr int kSumpMax = 32;

// Seed this floor's standing water. Runs LAST in generate_floor, after the lattice, so
// nothing can carve through a basin wall afterwards.
void seed_floor_sumps(World& world, const FloorGeom& geom, std::uint32_t fseed) {
    Field<float>* wet = world.fields().find<float>(kFluidField);
    if (geom.sumps <= 0) {
        // A recycled World slot keeps its FIELDS — generate_floor clears the grid and
        // nothing else — so a dry kind moving into a slot a flooded one just left has
        // to wipe the water. Without this the floor stops being a pure function of
        // (seed, number, kind): the puddles would be wherever the previous tenant's
        // last fluid_step happened to leave them, which is a function of how long the
        // player stood on that floor.
        if (wet != nullptr) wet->fill(0.0f);
        return;
    }
    if (wet == nullptr)
        wet = &world.fields().get_or_create<float>(kFluidField, 0.0f);
    else
        wet->fill(0.0f);

    MacroGrid& g = world.grid();
    const int r = geom.sumpR;
    const int outer = r + 1;  // the kerb ring sits at Chebyshev radius r+1
    const int stride = geom.stride;
    const int perAxis = kMacroDim / stride;

    // The basin's outer square must fit strictly inside the room interior, local
    // [1, stride-1]. A kerb cell ON a wall line would be indistinguishable from wall,
    // and a kerb cell in a DOORWAY would be worse than cosmetic: door.cpp enumerates
    // the openings from floor_doorways() and would place a leaf inside a cell this
    // function had just filled solid.
    const int loLocal = 1 + outer;
    const int hiLocal = stride - 1 - outer;
    if (hiLocal < loLocal) return;  // this kind's rooms are too small to hold a basin
    const int span = hiLocal - loLocal + 1;

    // The OUTFALL carries double its share and the rest of the basin is scaled down to
    // match, so the total is exactly `inner * kFloorSumpLevel` and the solver has real
    // work to do. Authoring the SETTLED level and deriving the seed is the right way
    // round: the settled number is the one a consumer, a test and an eye can see.
    //
    // Seeding a basin already level would be cheaper and would prove nothing — the
    // solver would find no gradient and this whole lane would ship a field nobody
    // stepped. Seeding it all in one cell is the other extreme and costs too much:
    // every moving step invalidates the cube pass's instance cache at 28.6 ms a rebuild
    // ([render/cube_pass.h]), so settle time is frame time. Measured on fluid.cpp's
    // exact transfer rule against the 0.5 basin capacity below — doubled outfall: 27
    // steps for a 3x3 and 41 for a 5x5, mass conserved exactly and the settled level
    // 0.400000 per cell in both. All-in-the-outfall was 50 and 105 for the same shape.
    const int inner = (2 * r + 1) * (2 * r + 1);
    const float unit = kFloorSumpLevel * static_cast<float>(inner) /
                       static_cast<float>(inner + 1);

    // Centres already placed. Two basins that overlap are not two basins: the second
    // one's kerb is written straight over the first one's water cell, leaving a SOLID
    // cell holding liquid whose outward neighbours still have capacity — so the pool
    // drains out into the room and the containment this whole shape exists for is gone.
    // Found by simulating the placement hash rather than by playing: it happens on
    // stride 8, where a room offers only 3x3 centres, so two sumps drawing the same room
    // always collide. Measured 1 collision across 5 seeds before this test existed.
    int placedX[kSumpMax] = {};
    int placedY[kSumpMax] = {};
    int placedN = 0;
    const int wantSumps = geom.sumps > kSumpMax ? kSumpMax : geom.sumps;

    for (int s = 0; s < wantSumps; ++s) {
        for (int t = 0; t < kSumpTries; ++t) {
            const std::uint32_t h =
                mix32(fseed ^ (static_cast<std::uint32_t>(s) * 0x9E3779B9u) ^
                      (static_cast<std::uint32_t>(t) * 0x27220A95u));
            // Four disjoint byte fields, so the room draw and the in-room offset are
            // independent rather than two views of the same bits.
            const int rx =
                static_cast<int>((h & 0xFFu) % static_cast<std::uint32_t>(perAxis));
            const int ry = static_cast<int>(((h >> 8) & 0xFFu) %
                                            static_cast<std::uint32_t>(perAxis));
            const int cx = rx * stride + loLocal +
                           static_cast<int>(((h >> 16) & 0xFFu) %
                                            static_cast<std::uint32_t>(span));
            const int cy = ry * stride + loLocal +
                           static_cast<int>(((h >> 24) & 0xFFu) %
                                            static_cast<std::uint32_t>(span));
            if (overlaps_lattice(cx, cy, outer)) continue;
            // Two squares of half-width `outer` share a cell exactly when both axis
            // gaps are <= 2*outer; touching kerbs (gap 2*outer+1) are both solid wall
            // and harmless, so only real overlap is refused.
            bool collides = false;
            for (int j = 0; j < placedN && !collides; ++j)
                collides = axis_gap(cx, placedX[j]) <= 2 * outer &&
                           axis_gap(cy, placedY[j]) <= 2 * outer;
            if (collides) continue;
            placedX[placedN] = cx;
            placedY[placedN] = cy;
            ++placedN;

            for (int dy = -outer; dy <= outer; ++dy)
                for (int dx = -outer; dx <= outer; ++dx) {
                    const int x = wrap_macro(cx + dx);
                    const int y = wrap_macro(cy + dy);
                    const bool ring = dx < -r || dx > r || dy < -r || dy > r;
                    // The basin FLOOR, unconditionally. A Derelict floor drops 12% of
                    // its slab cells, and a sump over a hole is not a sump: the water
                    // falls straight through, and because Z wraps "below" the ground
                    // storey is the TOP one, so it would drain into a storey the
                    // player is not on and never settle anywhere.
                    g.fill_cell(x, y, 0, geom.slab);
                    if (ring) {
                        g.fill_cell(x, y, kSumpZ, geom.wall);
                        continue;
                    }
                    // **The basin cell is PARTIALLY carved, and that is what makes the
                    // liquid visible at all.** cube_pass emits only cells whose
                    // sub-mask is non-empty (`is_visible_surface`), so fluid sitting in
                    // an AIR cell tints nothing — which is also why the maze test bed's
                    // two seeded puddles have never rendered. A half-solid cell is
                    // drawn, is tinted by the field, and still holds 0.5 of a unit.
                    //
                    // HALF, not one layer, and the number comes off the jump arc rather
                    // than off the look: the kerb's top face is at 4.0 m, so a body that
                    // falls in through a Derelict slab hole has to climb out. `Jump`
                    // gives 5.0 m/s against 9.81 m/s^2 = a 1.27 m apex
                    // ([ecs/components.h], [world/gravity.h]). Four solid sub-layers put
                    // the basin floor at 3.0 m — a 1.0 m step out, inside the arc. One
                    // layer would have looked better (0.875 capacity, a deeper blue) and
                    // made a 1.75 m pit that soft-locks whoever lands in it.
                    //
                    // One sub-voxel Z layer is exactly 64 bits = one mask word
                    // (`sub_bit` packs sx + sy*8 + sz*64), so "keep the bottom half" is
                    // words[0..3] and clear words[4..7]. Nothing else in the tree writes
                    // a partial mask yet; `capacity_frac` in fluid.cpp was written for
                    // exactly this and had never been exercised.
                    g.fill_cell(x, y, kSumpZ, geom.slab);
                    SubMask& m = g.mask(x, y, kSumpZ);
                    for (std::size_t wi = kSubMaskWords / 2; wi < kSubMaskWords; ++wi)
                        m.words[wi] = 0;
                    wet->at(x, y, kSumpZ) = unit;
                }
            wet->at(cx, cy, kSumpZ) = unit * 2.0f;  // the outfall
            break;
        }
    }
}

} // namespace

int floor_room_stride(FloorKind kind) { return geom_for(kind).stride; }

std::uint32_t floor_sump_cells(FloorKind kind) {
    const FloorGeom& geom = geom_for(kind);
    if (geom.sumps <= 0) return 0;
    // The same clamp the seeder applies, or the exported ceiling would be a number no
    // floor can reach.
    const int n = geom.sumps > kSumpMax ? kSumpMax : geom.sumps;
    const int inner = 2 * geom.sumpR + 1;
    return static_cast<std::uint32_t>(n * inner * inner);
}

int floor_room_bit_index(std::uint16_t mask) {
    if (mask == 0) return -1;
    const int i = std::countr_zero(mask);
    return i < static_cast<int>(kFloorRoomBits) ? i : -1;
}

std::uint16_t floor_room_mask(FloorKind kind, int number, int rx, int ry) {
    std::size_t k = static_cast<std::size_t>(kind);
    if (k >= static_cast<std::size_t>(FloorKind::Count)) k = 0;
    const RoomMixRow& row = kRoomMix[k];

    // A pure hash of the room's identity, with each input on its own odd multiplier so
    // a floor's rooms decorrelate from its neighbour's at the same (rx, ry).
    const std::uint32_t h =
        mix32(static_cast<std::uint32_t>(k) * 0x9E3779B9u ^
              static_cast<std::uint32_t>(number) * 0x85EBCA6Bu ^
              static_cast<std::uint32_t>(rx) * 0x27220A95u ^
              static_cast<std::uint32_t>(ry) * 0x165667B1u);

    std::uint32_t total = 0;
    for (std::uint8_t i = 0; i < row.n; ++i) total += row.tab[i].w;
    std::uint32_t pick = total ? h % total : 0u;
    for (std::uint8_t i = 0; i < row.n; ++i) {
        if (pick < row.tab[i].w) return static_cast<std::uint16_t>(row.tab[i].bit);
        pick -= row.tab[i].w;
    }
    return static_cast<std::uint16_t>(row.tab[0].bit);
}

std::uint32_t floor_doorways(int number, const FloorSpec& spec, unsigned seed,
                             std::vector<Doorway>& out) {
    if (spec.kind == FloorKind::Padic) {
        return padic_doorways(number, seed, out);
    }
    
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

void generate_default_floor(World& world, int number, const FloorSpec& spec,
                            unsigned seed) {
    MacroGrid& g = world.grid();
    const FloorGeom& geom = geom_for(spec.kind);
    // Per-kind materials, from the table above.
    const CellType kSlab = geom.slab;
    const CellType kWall = geom.wall;
    constexpr CellType kHubPad = kMatHubPad;
    const std::uint32_t fseed = floor_seed(seed, number);
    Rng rng(fseed);

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
                CellType cellSlab = kSlab;
                const std::uint32_t slabHash = mix32(fseed ^ (static_cast<std::uint32_t>(x) * 0x165667B1u) ^
                                                     (static_cast<std::uint32_t>(y) * 0x27220A95u) ^
                                                     (static_cast<std::uint32_t>(base) * 0x9E3779B9u));
                const int slabPick = static_cast<int>(slabHash % 100u);
                if (spec.kind == FloorKind::Residential) {
                    // Parquet wood planks (80%), linoleum/rubber tile (20%)
                    if (slabPick < 80) cellSlab = kMatParquet;
                    else cellSlab = kMatLino;
                } else if (spec.kind == FloorKind::Commercial) {
                    // Linoleum/rubber tile (80%), parquet wood planks (20%)
                    if (slabPick < 80) cellSlab = kMatLino;
                    else cellSlab = kMatParquet;
                } else if (spec.kind == FloorKind::Industrial) {
                    // Tread plate (80%), linoleum/rubber tile (20%)
                    if (slabPick < 80) cellSlab = kMatTread;
                    else cellSlab = kMatLino;
                } else if (spec.kind == FloorKind::Derelict) {
                    // Rubble debris floor (100%)
                    cellSlab = kMatRubble;
                }
                g.fill_cell(x, y, base, cellSlab);
            }

        // Interior partitions: full-height walls on the room lattice.
        // `gapPct` knocks out a fraction to break the layout into a maze (decay).
        for (int z = base + 1; z < top; ++z)
            for (int y = 0; y < kMacroDim; ++y)
                for (int x = 0; x < kMacroDim; ++x) {
                    const bool onX = (x % stride) == 0;
                    const bool onY = (y % stride) == 0;
                    const bool wall = (onX || onY);
                    if (!wall) continue;
                    if (geom.gapPct && rng.below(100) < geom.gapPct) continue;
                    CellType cellWall = kWall;
                    const std::uint32_t wallHash = mix32(fseed ^ (static_cast<std::uint32_t>(x) * 0x9E3779B9u) ^
                                                         (static_cast<std::uint32_t>(y) * 0x85EBCA6Bu) ^
                                                         (static_cast<std::uint32_t>(z) * 0x7FEB352Du));
                    const int wallPick = static_cast<int>(wallHash % 100u);
                    if (spec.kind == FloorKind::Residential) {
                        // Plaster whitewash (80%), shutter/tile (20%)
                        if (wallPick < 80) cellWall = kMatPlaster;
                        else cellWall = kMatShopShutter;
                    } else if (spec.kind == FloorKind::Commercial) {
                        // Shutter/tile (70%), plaster (30%)
                        if (wallPick < 70) cellWall = kMatShopShutter;
                        else cellWall = kMatPlaster;
                    } else if (spec.kind == FloorKind::Industrial) {
                        // Factory corrugated wall (75%), shutter (25%)
                        if (wallPick < 75) cellWall = kMatFactoryWall;
                        else cellWall = kMatShopShutter;
                    } else if (spec.kind == FloorKind::Derelict) {
                        // Weathered rust (100%)
                        cellWall = kMatRust;
                    }
                    g.fill_cell(x, y, z, cellWall);
                }

    }

    // Doorways: open one gap in every wall segment between adjacent rooms so each
    // storey is one connected apartment graph.
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
    // kShaftR / kLobbyR live at file scope now: the sump seeder below has to stay
    // clear of this footprint, and a second literal 3 is how a basin ends up half
    // inside an elevator lobby.
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

    // Standing water, LAST. It writes solid kerb cells and re-lays slab under its own
    // footprint, so it has to run after every carving pass — the lattice included —
    // or a shaft would be punched through a basin wall and drain it. It also wipes the
    // field on a dry kind, which is the recycled-slot correctness half; see
    // seed_floor_sumps.
    seed_floor_sumps(world, geom, floor_seed(seed, number));

    (void)spec.population; // geometry ignores population; the seeder consumes it
}

// ---------------------------------------------------------------------------
// Floor Generator Dispatch
// ---------------------------------------------------------------------------
using FloorGeneratorFunc = void (*)(World&, int, const FloorSpec&, unsigned);

constexpr FloorGeneratorFunc kGenerators[] = {
    generate_default_floor, // Residential
    generate_default_floor, // Commercial
    generate_default_floor, // Industrial
    generate_default_floor, // Derelict
    generate_padic_floor,   // Padic
};
static_assert(sizeof(kGenerators) / sizeof(kGenerators[0]) ==
                  static_cast<std::size_t>(FloorKind::Count),
              "generator table must have exactly one row per FloorKind");

void generate_floor(World& world, int number, const FloorSpec& spec,
                    unsigned seed) {
    std::size_t k = static_cast<std::size_t>(spec.kind);
    if (k >= static_cast<std::size_t>(FloorKind::Count)) k = 0;
    kGenerators[k](world, number, spec, seed);
}

} // namespace giga::game
