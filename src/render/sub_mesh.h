// Greedy 3D box meshing of one cell's 8^3 sub-voxel mask: the pure logic behind
// the cube pass's PARTIAL-cell emitter, split out from the Vulkan code so it is
// headless-testable, exactly like render/cube_merge.h is for the macro merge.
//
// WHY. The sub-voxel pass used to emit greedy runs along X ONLY. That is fine for
// geometry that happens to lie along X and catastrophic for everything else: a
// 2-sub-voxel-thick wall perpendicular to X is 64 one- and two-voxel runs per
// cell, and a 1-sub-voxel floor slab is 8 runs per cell. The padic floor is built
// almost entirely of exactly those two shapes, replicated on 43 stacked levels —
// measured at 23,659,264 dropped runs against the 2,097,152-instance buffer, i.e.
// whole regions of the world simply not drawn. Greedy 3D boxes make the slab ONE
// box and the wall ONE box, which is a 8-64x cut on precisely the shapes that
// dominate.
//
// WHAT. Classic greedy meshing over an 8^3 occupancy bit mask: scan in z,y,x
// order; the first unclaimed solid voxel seeds a box, which grows +x, then +y
// (whole rows), then +z (whole slabs), claims its volume, and is emitted. Boxes
// are solid same-material volumes by construction — `mat_of` is consulted per
// voxel, so a cell carrying a per-sub-voxel material page ([world/subfield.h])
// splits into per-material boxes with no special casing.
//
// The output is EXACT COVER, not an approximation: every solid voxel lands in
// exactly one box and no box contains an unsolid voxel (suite_submesh.inl pins
// this on random masks). Exposure culling is deliberately NOT this header's
// business — which boxes face air depends on the neighbouring cells' masks, which
// the caller has and this header does not.
//
// The worst case is worth knowing: a 3D checkerboard cannot merge at all — every
// solid voxel is an isolated 1x1x1 box, 256 of them per cell. The padic grate
// pattern is a 2D checkerboard (32 boxes per cell) and is the most expensive
// geometry pattern in the game per cell drawn; see voxels.md.
#pragma once

#include <cstdint>

#include "world/macro_grid.h" // SubMask
#include "world/types.h"

namespace giga::gpu {

// One solid same-material box inside a cell. Coordinates and extents are in
// sub-voxels, so x0+dx <= kSubDim etc. always holds.
struct SubBox {
    std::uint8_t x0, y0, z0; // minimum corner, 0..kSubDim-1
    std::uint8_t dx, dy, dz; // extent, 1..kSubDim
    CellType mat;
};

// Mesh one mask into greedy boxes. `mat_of(bit)` gives the material of a solid
// sub-voxel (a constant lambda for uniform cells, a page lookup for mixed ones);
// `emit(const SubBox&)` receives each box. Returns the number of boxes emitted.
//
// Growth order is +x, then +y, then +z — the same order the scan walks, which is
// what makes the claim test sufficient: a later seed can never sit inside an
// earlier box (it would be claimed), and a growing box checks the claim bit of
// every voxel it swallows, so boxes never overlap.
template <class MatFn, class EmitFn>
int mesh_sub_boxes(const SubMask& m, MatFn&& mat_of, EmitFn&& emit) {
    SubMask claimed{};
    int n = 0;
    for (int sz = 0; sz < kSubDim; ++sz)
        for (int sy = 0; sy < kSubDim; ++sy)
            for (int sx = 0; sx < kSubDim; ++sx) {
                const int b0 = sub_bit(sx, sy, sz);
                if (!m.test(b0) || claimed.test(b0)) continue;
                const CellType mat = mat_of(b0);
                auto joins = [&](int bit) {
                    return m.test(bit) && !claimed.test(bit) &&
                           mat_of(bit) == mat;
                };
                int ex = sx;
                while (ex + 1 < kSubDim && joins(sub_bit(ex + 1, sy, sz))) ++ex;
                int ey = sy;
                while (ey + 1 < kSubDim) {
                    bool ok = true;
                    for (int x = sx; x <= ex && ok; ++x)
                        ok = joins(sub_bit(x, ey + 1, sz));
                    if (!ok) break;
                    ++ey;
                }
                int ez = sz;
                while (ez + 1 < kSubDim) {
                    bool ok = true;
                    for (int y = sy; y <= ey && ok; ++y)
                        for (int x = sx; x <= ex && ok; ++x)
                            ok = joins(sub_bit(x, y, ez + 1));
                    if (!ok) break;
                    ++ez;
                }
                for (int z = sz; z <= ez; ++z)
                    for (int y = sy; y <= ey; ++y)
                        for (int x = sx; x <= ex; ++x)
                            claimed.set(sub_bit(x, y, z));
                emit(SubBox{static_cast<std::uint8_t>(sx),
                            static_cast<std::uint8_t>(sy),
                            static_cast<std::uint8_t>(sz),
                            static_cast<std::uint8_t>(ex - sx + 1),
                            static_cast<std::uint8_t>(ey - sy + 1),
                            static_cast<std::uint8_t>(ez - sz + 1), mat});
                ++n;
            }
    return n;
}

} // namespace giga::gpu
