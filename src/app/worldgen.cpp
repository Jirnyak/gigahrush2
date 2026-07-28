#include "app/worldgen.h"

#include <cstdint>
#include <vector>

#include "world/types.h"
#include "world/world.h"

namespace giga {

namespace {

// --- deterministic RNG -----------------------------------------------------
// xorshift32, bit-compatible with the reference generator (gigahrush/core/rand
// .ts). Keeps generation reproducible from a single integer seed.
struct Rng {
    std::uint32_t s;
    explicit Rng(unsigned seed) : s(seed ? seed : 1u) {}
    std::uint32_t next() {
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        return s;
    }
    int below(int n) { return static_cast<int>(next() % static_cast<unsigned>(n)); }
};

// ===========================================================================
//  Maze module (kept for tests): a fully-connected 3D labyrinth.
// ===========================================================================

// The maze lives on a coarse lattice: macro cells at EVEN coordinates are
// "rooms", the odd cell between two rooms is the "wall" that gets knocked out
// to join them. 128 is even, so there are 64 rooms per axis and the lattice
// wraps cleanly on the torus (room 63 steps to room 0).
constexpr int kRoomsPerAxis = kMacroDim / 2; // 64
constexpr int kRoomCount = kRoomsPerAxis * kRoomsPerAxis * kRoomsPerAxis;

int room_index(int rx, int ry, int rz) {
    return rx + ry * kRoomsPerAxis + rz * kRoomsPerAxis * kRoomsPerAxis;
}
int wrap_room(int r) {
    int m = r % kRoomsPerAxis;
    return m < 0 ? m + kRoomsPerAxis : m;
}

void generate_maze(World& world, unsigned seed) {
    MacroGrid& g = world.grid();
    constexpr CellType kRock = 1;
    Rng rng(seed);

    // 1. Fill everything solid. We carve air out of this monolith.
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                g.fill_cell(x, y, z, kRock);

    // 2. Recursive-backtracker over the room lattice (explicit stack).
    std::vector<std::uint8_t> visited(kRoomCount, 0);
    std::vector<int> stack;
    stack.reserve(kRoomCount);

    auto carve_room = [&](int rx, int ry, int rz) {
        g.clear_cell(rx * 2, ry * 2, rz * 2);
    };

    int startR = rng.below(kRoomCount);
    visited[startR] = 1;
    stack.push_back(startR);
    carve_room(startR % kRoomsPerAxis,
               (startR / kRoomsPerAxis) % kRoomsPerAxis,
               startR / (kRoomsPerAxis * kRoomsPerAxis));

    const int dir[6][3] = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0},
                           {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};

    while (!stack.empty()) {
        int cur = stack.back();
        int cz = cur / (kRoomsPerAxis * kRoomsPerAxis);
        int cy = (cur / kRoomsPerAxis) % kRoomsPerAxis;
        int cx = cur % kRoomsPerAxis;

        int cand[6], ncand = 0;
        for (int d = 0; d < 6; ++d) {
            int nx = wrap_room(cx + dir[d][0]);
            int ny = wrap_room(cy + dir[d][1]);
            int nz = wrap_room(cz + dir[d][2]);
            if (!visited[room_index(nx, ny, nz)]) cand[ncand++] = d;
        }
        if (ncand == 0) { stack.pop_back(); continue; }

        int d = cand[rng.below(ncand)];
        int nx = wrap_room(cx + dir[d][0]);
        int ny = wrap_room(cy + dir[d][1]);
        int nz = wrap_room(cz + dir[d][2]);

        g.clear_cell(wrap_macro(cx * 2 + dir[d][0]),
                     wrap_macro(cy * 2 + dir[d][1]),
                     wrap_macro(cz * 2 + dir[d][2]));
        carve_room(nx, ny, nz);

        int nr = room_index(nx, ny, nz);
        visited[nr] = 1;
        stack.push_back(nr);
    }

    // 3. Braiding: open ~18% of wall cells (exactly one odd coord) for loops.
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x) {
                int odd = (x & 1) + (y & 1) + (z & 1);
                if (odd == 1 && rng.below(100) < 18) g.clear_cell(x, y, z);
            }

    auto& fluid = world.fields().get_or_create<float>("fluid", 0.0f);
    fluid.at(30, 30, 90) = 1.0f;
}

// ===========================================================================
//  Floor-stack module: a toroidal stack of khrushchevka floors.
// ===========================================================================

// Each floor is a 2D apartment plan extruded to a fixed height and stacked
// along Z. kFloorHeight must divide kMacroDim so the stack tiles the torus
// exactly (the top floor's ceiling IS floor 0's slab, seamless on wrap).
constexpr int kFloorHeight = 4;                  // 8 metres per storey
constexpr int kFloorCount = kMacroDim / kFloorHeight; // 32 floors
static_assert(kMacroDim % kFloorHeight == 0,
              "floor height must divide the world so the stack wraps cleanly");

// Apartment grid inside one floor: 1-cell concrete walls on a `kRoomStride`
// lattice, single-cell doorways joining neighbouring rooms. kRoomStride must
// divide kMacroDim so the wall lattice is seamless across the x/y wrap.
constexpr int kRoomStride = 16;                  // 32-metre rooms
constexpr int kRoomsX = kMacroDim / kRoomStride; // 8 x 8 apartments per floor
static_assert(kMacroDim % kRoomStride == 0, "room stride must divide the world");

void generate_floor_stack(World& world, unsigned seed) {
    MacroGrid& g = world.grid();
    constexpr CellType kSlab = 4;   // floor/ceiling slab (tan)
    constexpr CellType kWall = 1;   // interior concrete wall (grey)
    Rng rng(seed);

    for (int f = 0; f < kFloorCount; ++f) {
        int base = f * kFloorHeight;      // z of this floor's slab
        int top = base + kFloorHeight;    // exclusive; == next floor's slab z

        // Slab: a solid concrete plane at the base of the storey. This doubles
        // as the ceiling of the floor below (and, on wrap, of the top floor).
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x)
                g.fill_cell(x, y, base, kSlab);

        // Interior partitions: full-height walls on the room lattice. Rooms
        // (the stride-1 blocks between walls) stay air. z runs base+1..top-1.
        for (int z = base + 1; z < top; ++z)
            for (int y = 0; y < kMacroDim; ++y)
                for (int x = 0; x < kMacroDim; ++x)
                    if (x % kRoomStride == 0 || y % kRoomStride == 0)
                        g.fill_cell(x, y, z, kWall);

        // Doorways: open one cell in every wall segment between adjacent rooms,
        // so the whole floor is one connected apartment graph. Door height is 2
        // cells (4 m) from the slab up. Offsets jitter per floor for variety.
        int doorH = base + 1 + 2;
        for (int rx = 0; rx < kRoomsX; ++rx)
            for (int ry = 0; ry < kRoomsX; ++ry) {
                // Door in the vertical wall (x = rx*stride) into the room to
                // its right: pick a y inside this room band.
                int wx = rx * kRoomStride;
                int dy = ry * kRoomStride + 2 + rng.below(kRoomStride - 3);
                for (int z = base + 1; z < doorH && z < top; ++z)
                    g.clear_cell(wx, dy, z);

                // Door in the horizontal wall (y = ry*stride).
                int wy = ry * kRoomStride;
                int dx = rx * kRoomStride + 2 + rng.below(kRoomStride - 3);
                for (int z = base + 1; z < doorH && z < top; ++z)
                    g.clear_cell(dx, wy, z);
            }
    }

    // Stairwells: punch vertical shafts through every slab at a few room-centre
    // columns so you can travel between storeys. Because z wraps, a shaft that
    // pierces all kFloorCount slabs also connects the top floor back to floor 0.
    const int shaftCount = 6;
    for (int i = 0; i < shaftCount; ++i) {
        int rx = rng.below(kRoomsX);
        int ry = rng.below(kRoomsX);
        int sx = rx * kRoomStride + kRoomStride / 2;
        int sy = ry * kRoomStride + kRoomStride / 2;
        // A 2x2 opening through every slab, full column height (all z).
        for (int z = 0; z < kMacroDim; ++z)
            for (int dy = 0; dy < 2; ++dy)
                for (int dx = 0; dx < 2; ++dx)
                    g.clear_cell(sx + dx, sy + dy, z);
    }

    // A little fluid puddle on the slab of the spawn floor (see main.cpp spawn).
    auto& fluid = world.fields().get_or_create<float>("fluid", 0.0f);
    fluid.at(24, 24, 41) = 1.0f;
}

} // namespace

void generate_demo_world(World& world, unsigned seed, WorldGenMode mode) {
    switch (mode) {
    case WorldGenMode::FloorStack: generate_floor_stack(world, seed); break;
    case WorldGenMode::Maze:
    default:                       generate_maze(world, seed); break;
    }
}

} // namespace giga
