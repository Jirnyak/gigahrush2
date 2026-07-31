// Run merging for the world pass: the pure logic behind CubePass's stretched
// boxes, split out from the Vulkan code so it is headless-testable.
//
// WHY. The world pass emitted one 36-vertex unit cube per visible-surface cell.
// Measured on this machine at 717,638 instances that is 25.8 M vertices per frame
// and 8.0 ms of GPU time, and the pass is GEOMETRY-bound, not fragment-bound —
// deleting the entire procedural surface layer from cube.frag moved it by +0.05 ms,
// i.e. upwards, inside the noise. Fewer vertices is the only lever that moves this
// number, and a 40-cell wall emitting 40 boxes is where they are.
//
// WHAT. A greedy 1-D run merge: adjacent cells that agree on everything the shader
// can observe become ONE stretched box. Not a full 2-D/3-D greedy mesher — runs
// only, along the best of the three axes per run — because 1-D runs already collapse
// the slab planes and the wall lattice that dominate the count, and every extra
// dimension multiplies the ways AO and the toroidal placement can go wrong.
//
// THE MERGE MUST BE INVISIBLE, and that is a stronger claim than "looks fine".
// Three separate things had to be true, each of which is a real trap:
//
//  1. AMBIENT OCCLUSION. cube.vert bakes corner occlusion per-vertex from the
//     cell's 3x3x3 neighbour mask. A stretched box has vertices only at its ENDS,
//     so anything the mask says about the cells in between is lost, and the value
//     is linearly interpolated along the run instead of being re-evaluated per
//     cell. Two conditions make that interpolation EXACT rather than approximate:
//       (a) every cell in the run agrees on the mask bits corner_ao() can read,
//       (b) those bits mirror across the merge axis (ao_axis_symmetric below),
//     because (b) is precisely what makes the per-vertex AO constant along the run,
//     and a linear ramp between two equal values is that value everywhere. Drop (b)
//     and a long wall gets a smooth end-to-end AO gradient where the unmerged
//     version had a per-cell sawtooth — the "long walls glow at the seams" failure.
//
//  2. MATERIAL AND COLOUR. Bits 27..31 of `occ` are the material id and the shader
//     picks a surface family from it, so a run may not span two materials or the id
//     is a lie. Colour is compared through its inputs (cell type + fluid amount)
//     rather than its output, which is exact and needs no extra cache: the colour
//     is a pure function of those two.
//
//  3. THE PROCEDURAL SURFACES survive stretching for a reason that is worth stating
//     because it is load-bearing and easy to destroy: cube.frag derives its uv from
//     vWorldPos, i.e. from WORLD space, never from the cube-local [0,1] corner. A
//     box twenty cells long therefore sweeps twenty cells' worth of uv and the
//     parquet planks and tread-plate lozenges keep their true pitch. If anyone ever
//     switches that uv to a cube-local parameterisation, every merged box smears.
//
// AND THE ONE THAT IS A TRADE-OFF, NOT A PROOF: the minimal-image rule. cube.vert
// draws each instance at its nearest toroidal image, and a box has ONE image for all
// its vertices — it cannot be torn apart per cell without tearing the box apart.
// Cells more than half a wrap period from the camera along the merge axis therefore
// get drawn at the far image instead of the near one. Everything past kWorldExtent/2
// is fully black fog, so the error is confined to a shell of thickness
// (span-1) * kCellSize / 2 just inside the fog-black radius; kMaxRunCells is what
// bounds it, and test_greedy_all() measures the bound rather than asserting it away.
#pragma once

#include <cstdint>

#include "world/types.h"

namespace giga::gpu {

// Longest run, in cells, that may be merged into one box.
//
// This is a SEAM budget, not a performance knob. A box is placed at the nearest
// toroidal image of its centre, so a cell k cells from that centre can be drawn up
// to k * kCellSize past the minimal-image radius kWorldExtent/2 = 128 m, where its
// correct image would have been just inside it. Fog is full black at 128 m and
// starts at 76.8 m, so with a cap of 8 cells the worst possible artefact is a cell
// missing at 121 m, where (1 - fog) is 0.135 — at most ~13% of a surface that is
// already within a few LSBs of black. Raise the cap to 32 and that becomes 60% of a
// visible surface at 97 m, which is a hole. Measured instance counts say the cap
// costs almost nothing: this world's natural runs are 5-7 cells (an 8-cell room
// lattice), so 8 is where the curve has already flattened.
inline constexpr int kMaxRunCells = 8;
static_assert(kMaxRunCells >= 1 && kMaxRunCells <= 255,
              "a run length must fit the uint8 span lane in CubeInstance");
static_assert(kMaxRunCells <= kMacroDim,
              "a run longer than the grid would cover the same cell twice");

// --- the neighbour-mask bit layout -----------------------------------------
// Identical to cube_pass.cpp occupancy_mask() and cube.vert occluder(): bit
// ((dz+1)*9 + (dy+1)*3 + (dx+1)) is set when that neighbour is solid.
constexpr std::uint32_t ao_bit(int dx, int dy, int dz) {
    return 1u << ((dz + 1) * 9 + (dy + 1) * 3 + (dx + 1));
}

// The bits corner_ao() in cube.vert can actually READ, which is fewer than the 26
// that are written. It samples n+u, n+v and n+u+v for an axis-aligned face normal n
// and two tangents u, v drawn from the other two axes — so every offset it touches
// has exactly TWO or THREE non-zero components. The six single-axis face offsets
// (+-X, +-Y, +-Z alone) and the centre are never read by anything.
//
// That matters twice over. It is what the merge compares (two cells may differ in a
// bit no shader looks at and still be mergeable), and it is why build_instances can
// mask the unread bits off before upload: an instance then carries only bits that
// have a defined meaning for the whole box, instead of whichever cell of the run
// happened to be scanned first. suite_greedy re-derives this set from an independent
// replica of corner_ao's offset arithmetic, so the two cannot drift silently.
constexpr std::uint32_t ao_read_bits() {
    std::uint32_t m = 0;
    for (int dz = -1; dz <= 1; ++dz)
        for (int dy = -1; dy <= 1; ++dy)
            for (int dx = -1; dx <= 1; ++dx) {
                const int nz = (dx != 0) + (dy != 0) + (dz != 0);
                if (nz >= 2) m |= ao_bit(dx, dy, dz);
            }
    return m;
}
inline constexpr std::uint32_t kAoReadBits = ao_read_bits();

// Where the material id rides in the same uint32 (cube_pass.cpp kMatIdShift).
inline constexpr int kMatIdShift = 27;
inline constexpr std::uint32_t kMatIdBits = ~0u << kMatIdShift;

// Everything a merge must agree on inside `occ`: the AO bits the shader reads plus
// the material id. Nothing else in the word is observable.
inline constexpr std::uint32_t kMergeBits = kAoReadBits | kMatIdBits;

// The "this cell is a visible surface" flag, parked on bit 13 — the centre of the
// 3x3x3 mask, which is this cell itself and is neither written nor read as
// occupancy. It lets one uint32 per cell carry both the AO input and the surface
// test, which is what makes the whole 128^3 classification fit in an 8 MB cache
// that the merge scan can then re-read for free. Cleared before upload.
inline constexpr std::uint32_t kSurfaceFlag = ao_bit(0, 0, 0);
static_assert((kSurfaceFlag & kMergeBits) == 0,
              "the surface flag must not collide with an observable bit");

// "This visible cell is PARTIAL — draw its actual sub-voxel bits, not a full
// box." Parked on another bit no shader reads (the +x single-axis face offset,
// one of the six kAoReadBits excludes). A partial cell deliberately does NOT
// carry kSurfaceFlag, which is what keeps it out of the run merge below with
// zero changes to the scan: run_length breaks on a missing surface flag, and
// the outer loop never starts a run there. The sub-voxel pass in
// CubePass::build_instances is the only reader. Cleared before upload, like
// kSurfaceFlag.
inline constexpr std::uint32_t kPartialFlag = ao_bit(1, 0, 0);
static_assert((kPartialFlag & kMergeBits) == 0,
              "the partial flag must not collide with an observable bit");
static_assert(kPartialFlag != kSurfaceFlag,
              "the two classification flags need distinct dead bits");

// Distance in bit positions between the -1 and +1 planes of `axis`: the bit index
// is a base-3 digit string, so the axis's digit is worth 3^axis and stepping it
// from -1 to +1 is two of those.
inline constexpr int kAoMirrorShift[3] = {2, 6, 18};

// The -1 half of the bits that must mirror for a run along `axis` to keep AO exact:
// offsets whose `axis` component is -1 and whose other two components are not both
// zero. The (0,0) case is excluded deliberately — those are the two face offsets
// along the merge axis, which corner_ao never reads and which necessarily differ at
// the two ends of a run.
constexpr std::uint32_t ao_mirror_low(int axis) {
    std::uint32_t m = 0;
    for (int dz = -1; dz <= 1; ++dz)
        for (int dy = -1; dy <= 1; ++dy)
            for (int dx = -1; dx <= 1; ++dx) {
                const int d[3] = {dx, dy, dz};
                if (d[axis] != 0) continue;
                if (dx == 0 && dy == 0 && dz == 0) continue;
                int off[3] = {dx, dy, dz};
                off[axis] = -1;
                m |= ao_bit(off[0], off[1], off[2]);
            }
    return m;
}
inline constexpr std::uint32_t kAoMirrorLow[3] = {
    ao_mirror_low(0), ao_mirror_low(1), ao_mirror_low(2)};

// Does this neighbourhood look the same from both directions along `axis`? See
// condition (b) at the top: this is what makes the per-vertex AO of a stretched box
// constant along the run, and therefore exactly equal to the per-cell AO it
// replaces rather than a smooth approximation of it.
inline bool ao_axis_symmetric(std::uint32_t occ, int axis) {
    const std::uint32_t lo = kAoMirrorLow[axis];
    const int sh = kAoMirrorShift[axis];
    return ((occ & lo) << sh) == (occ & (lo << sh));
}

// --- the greedy scan --------------------------------------------------------
// One 128^3 bit per cell, marking cells already swallowed by an earlier run.
inline constexpr std::size_t kClaimWords = (kMacroCells + 63) / 64;

inline bool claim_test(const std::uint64_t* claimed, std::size_t i) {
    return (claimed[i >> 6] >> (i & 63)) & 1u;
}
inline void claim_set(std::uint64_t* claimed, std::size_t i) {
    claimed[i >> 6] |= std::uint64_t{1} << (i & 63);
}

// How far a run starting at (x,y,z) can reach along `axis`.
//
// `occ` is the caller's per-cell classification cache (kSurfaceFlag + AO bits +
// material id) and `same` is a predicate on flat cell indices deciding whether two
// cells' *colour inputs* agree — cell type and fluid amount, which the render pass
// owns and this header deliberately does not.
template <class SameFn>
int run_length(const std::uint32_t* occ, const std::uint64_t* claimed, int x, int y,
               int z, int axis, int maxRun, SameFn&& same) {
    const std::size_t i0 = macro_index(x, y, z);
    const std::uint32_t k0 = occ[i0];
    if (!ao_axis_symmetric(k0, axis)) return 1;
    int c[3] = {x, y, z};
    int len = 1;
    while (len < maxRun) {
        c[axis] = wrap_macro(c[axis] + 1);
        const std::size_t i = macro_index(c[0], c[1], c[2]);
        if (i == i0) break; // wrapped the whole grid; never cover a cell twice
        if (claim_test(claimed, i)) break;
        const std::uint32_t k = occ[i];
        if (!(k & kSurfaceFlag)) break;
        if (((k ^ k0) & kMergeBits) != 0) break;
        if (!same(i0, i)) break;
        ++len;
    }
    return len;
}

// Greedy best-axis run merge over the whole grid.
//
// Visits cells in z,y,x order; the first unclaimed surface cell starts a run, the
// longest of the three axis runs wins, and its cells are claimed. Scanning x
// innermost while allowing y and z runs is exactly why the claim bitmap has to
// exist: a run along y swallows cells the x scan has not reached yet.
//
// `emit(flatIndex, x, y, z, span)` receives the box; `span` is in CELLS and has
// exactly one entry greater than 1. Returns the number of boxes emitted, stopping
// at `maxBoxes`.
template <class SameFn, class EmitFn>
std::uint32_t merge_surface_runs(const std::uint32_t* occ, std::uint64_t* claimed,
                                 int maxRun, std::uint32_t maxBoxes, SameFn&& same,
                                 EmitFn&& emit) {
    for (std::size_t i = 0; i < kClaimWords; ++i) claimed[i] = 0;
    std::uint32_t boxes = 0;
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y)
            for (int x = 0; x < kMacroDim; ++x) {
                const std::size_t i0 = macro_index(x, y, z);
                if (!(occ[i0] & kSurfaceFlag)) continue;
                if (claim_test(claimed, i0)) continue;
                int bestAxis = 0, bestLen = 1;
                for (int axis = 0; axis < 3; ++axis) {
                    const int len =
                        run_length(occ, claimed, x, y, z, axis, maxRun, same);
                    if (len > bestLen) { bestLen = len; bestAxis = axis; }
                }
                std::uint8_t span[3] = {1, 1, 1};
                span[bestAxis] = static_cast<std::uint8_t>(bestLen);
                int c[3] = {x, y, z};
                for (int k = 0; k < bestLen; ++k) {
                    claim_set(claimed, macro_index(c[0], c[1], c[2]));
                    c[bestAxis] = wrap_macro(c[bestAxis] + 1);
                }
                emit(i0, x, y, z, span);
                if (++boxes == maxBoxes) return boxes;
            }
    return boxes;
}

} // namespace giga::gpu
