// Core world dimensions and index math.
//
// The world is a monolith: a single flat 128^3 macro grid, where every macro
// cell is further subdivided into an 8^3 block of sub-voxels tracked as a bit
// mask. These two constants are the only knobs; everything else derives from
// them. Flipping kSubDim to 16 (512-voxel blocks) is a one-line change here,
// though it grows the per-cell mask (see macro_grid.h).
#pragma once
#include <cstddef>
#include <cstdint>

#include "core/wrap.h"

namespace giga {

// Macro grid: 128 cells per axis, wrapped (torus).
inline constexpr int kMacroDim = 128;
inline constexpr std::size_t kMacroCells =
    static_cast<std::size_t>(kMacroDim) * kMacroDim * kMacroDim;

// Sub-voxel block: 8 voxels per axis inside each macro cell => 512 voxels,
// which packs exactly into 8 x uint64_t. Change to 16 for 4096-voxel blocks.
inline constexpr int kSubDim = 8;
inline constexpr int kSubVoxels = kSubDim * kSubDim * kSubDim;
inline constexpr std::size_t kSubMaskWords = (kSubVoxels + 63) / 64;

// World-space size of one macro cell along an axis (arbitrary units). One
// sub-voxel is therefore kCellSize / kSubDim. Physics and rendering share this
// so a unit in the ECS Transform maps directly onto the grid.
// One macro cell is ~2 metres on a side (matching the reference game's block
// scale), so one sub-voxel is 2 / kSubDim = 0.25 m. Gravity, jump, and move
// speeds are expressed in metres, so keeping the cell physical makes those
// numbers read as real m/s and m/s^2.
inline constexpr float kCellSize = 2.0f;
inline constexpr float kVoxelSize = kCellSize / static_cast<float>(kSubDim);

// World-space extent of the whole torus along one axis. Entity positions wrap
// modulo this, so moving off any face re-enters from the opposite one.
inline constexpr float kWorldExtent = kMacroDim * kCellSize;

// Flat index into a 128^3 array. Caller must pass in-range coordinates; use
// wrap_macro() first for toroidal access.
inline std::size_t macro_index(int x, int y, int z) {
    return static_cast<std::size_t>(x)
         + static_cast<std::size_t>(y) * kMacroDim
         + static_cast<std::size_t>(z) * kMacroDim * kMacroDim;
}

// Wrap a macro coordinate onto the torus.
inline int wrap_macro(int c) { return wrapi(c, kMacroDim); }

// Flat bit index of a sub-voxel within a macro cell's 8^3 block.
inline int sub_bit(int sx, int sy, int sz) {
    return sx + sy * kSubDim + sz * kSubDim * kSubDim;
}

} // namespace giga
