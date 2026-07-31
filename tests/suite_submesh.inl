// Sub-voxel greedy 3D meshing ([render/sub_mesh.h]) — the pure half of the cube
// pass's PARTIAL-cell emitter. Two properties are load-bearing and pinned here:
//
//   1. EXACT COVER on arbitrary masks: every solid voxel lands in exactly one
//      box, no box contains air, and no two boxes overlap. This is what makes
//      the mesher safe to swap in for the old x-run emitter — same voxels drawn,
//      different (far smaller) box decomposition.
//   2. The shapes that blew the instance budget on the padic floor collapse to
//      the counts the fix promised: a slab is 1 box (was 8 x-runs), a thin wall
//      perpendicular to X is 1 box (was 64), a grate stays 32 — the documented
//      worst-case pattern (voxels.md).

#include "render/sub_mesh.h"

static void submesh_reassemble(const giga::SubMask& m, giga::CellType uniform) {
    using namespace giga;
    using namespace giga::gpu;
    SubMask cover{};
    int boxes = 0;
    bool overlap = false, air = false, badSpan = false;
    mesh_sub_boxes(m, [&](int) { return uniform; }, [&](const SubBox& b) {
        ++boxes;
        if (b.x0 + b.dx > kSubDim || b.y0 + b.dy > kSubDim ||
            b.z0 + b.dz > kSubDim || b.dx == 0 || b.dy == 0 || b.dz == 0)
            badSpan = true;
        for (int z = b.z0; z < b.z0 + b.dz; ++z)
            for (int y = b.y0; y < b.y0 + b.dy; ++y)
                for (int x = b.x0; x < b.x0 + b.dx; ++x) {
                    const int bit = sub_bit(x, y, z);
                    if (!m.test(bit)) air = true;
                    if (cover.test(bit)) overlap = true;
                    cover.set(bit);
                }
    });
    CHECK(!badSpan);
    CHECK(!overlap);
    CHECK(!air);
    // Exact cover: the union of boxes IS the mask.
    CHECK(std::memcmp(cover.words, m.words, sizeof(cover.words)) == 0);
    // At least one box per connected mask, zero for an empty one.
    CHECK((boxes == 0) == m.empty());
}

static void test_submesh_all() {
    using namespace giga;
    using namespace giga::gpu;

    // Full cell: one 8x8x8 box.
    {
        SubMask m;
        m.set_all();
        int boxes = 0;
        SubBox got{};
        mesh_sub_boxes(m, [](int) { return CellType{1}; },
                       [&](const SubBox& b) { ++boxes; got = b; });
        CHECK(boxes == 1);
        CHECK(got.dx == kSubDim && got.dy == kSubDim && got.dz == kSubDim);
    }

    // Floor slab (sz == 0 plane): ONE box, not 8 x-runs.
    {
        SubMask m{};
        for (int sy = 0; sy < kSubDim; ++sy)
            for (int sx = 0; sx < kSubDim; ++sx) m.set(sub_bit(sx, sy, 0));
        int boxes = 0;
        mesh_sub_boxes(m, [](int) { return CellType{9}; },
                       [&](const SubBox&) { ++boxes; });
        CHECK(boxes == 1);
    }

    // Thin wall perpendicular to X (sx in {3,4}, full y/z): ONE box, not 64
    // x-runs — the padic room-wall shape that produced 23.6 M dropped runs.
    {
        SubMask m{};
        for (int sz = 0; sz < kSubDim; ++sz)
            for (int sy = 0; sy < kSubDim; ++sy)
                for (int sx = 3; sx <= 4; ++sx) m.set(sub_bit(sx, sy, sz));
        int boxes = 0;
        SubBox got{};
        mesh_sub_boxes(m, [](int) { return CellType{8}; },
                       [&](const SubBox& b) { ++boxes; got = b; });
        CHECK(boxes == 1);
        CHECK(got.x0 == 3 && got.dx == 2 && got.dy == kSubDim &&
              got.dz == kSubDim);
    }

    // 2D checkerboard grate: 32 isolated voxels, 32 boxes. The documented
    // most-expensive-pattern-per-cell in the game — pinned so a "fix" that
    // silently drops half the grate fails here.
    {
        SubMask m{};
        for (int sy = 0; sy < kSubDim; ++sy)
            for (int sx = 0; sx < kSubDim; ++sx)
                if ((sx + sy) % 2 == 0) m.set(sub_bit(sx, sy, 0));
        int boxes = 0;
        mesh_sub_boxes(m, [](int) { return CellType{16}; },
                       [&](const SubBox&) { ++boxes; });
        CHECK(boxes == 32);
    }

    // Mixed materials split boxes: a full cell whose lower half is material 1
    // and upper half material 2 is exactly two 8x8x4 boxes.
    {
        SubMask m;
        m.set_all();
        auto mat = [](int bit) -> CellType {
            return (bit / (kSubDim * kSubDim)) < kSubDim / 2 ? CellType{1}
                                                             : CellType{2};
        };
        int boxes = 0;
        bool halves = true;
        mesh_sub_boxes(m, mat, [&](const SubBox& b) {
            ++boxes;
            if (b.dz != kSubDim / 2 || b.dx != kSubDim || b.dy != kSubDim)
                halves = false;
        });
        CHECK(boxes == 2);
        CHECK(halves);
    }

    // Exact cover on pseudo-random masks — sparse, dense, and word-aligned
    // patterns all reassemble to the input bit-for-bit with disjoint boxes.
    {
        std::uint32_t rng = 0x5EED5u;
        for (int trial = 0; trial < 64; ++trial) {
            SubMask m{};
            for (std::size_t w = 0; w < kSubMaskWords; ++w) {
                std::uint64_t v = 0;
                for (int half = 0; half < 2; ++half) {
                    rng = rng * 1664525u + 1013904223u;
                    v = (v << 32) | rng;
                }
                // Vary density: AND together 0..2 extra random words.
                for (int d = 0; d < trial % 3; ++d) {
                    rng = rng * 1664525u + 1013904223u;
                    std::uint64_t x = rng;
                    rng = rng * 1664525u + 1013904223u;
                    v &= (x << 32) | rng;
                }
                m.words[w] = v;
            }
            submesh_reassemble(m, CellType{1});
        }
    }
}
