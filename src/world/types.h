// Core world dimensions and index math.
//
// The world is a sector: a flat 512 x 512 x 16 macro grid (1024m x 1024m x 32m),
// where every macro cell is further subdivided into an 8^3 block of sub-voxels
// tracked as a bit mask.
#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>

#include "core/math.h"
#include "core/wrap.h"

namespace giga {

// Macro grid dimensions: 512 x 512 x 16 cells (1024m x 1024m x 32m sector).
inline constexpr int kMacroDimX = 512;
inline constexpr int kMacroDimY = 512;
inline constexpr int kMacroDimZ = 16;
inline constexpr std::size_t kMacroCells =
    static_cast<std::size_t>(kMacroDimX) * kMacroDimY * kMacroDimZ;

// Sub-voxel block: 8 voxels per axis inside each macro cell => 512 voxels,
// which packs exactly into 8 x uint64_t.
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

// World-space extent of the sector along each axis (1024.0m x 1024.0m x 32.0m).
inline constexpr float kWorldExtentX = kMacroDimX * kCellSize; // 1024.0f
inline constexpr float kWorldExtentY = kMacroDimY * kCellSize; // 1024.0f
inline constexpr float kWorldExtentZ = kMacroDimZ * kCellSize; // 32.0f

// Legacy aliases for backward compatibility during phased migration.
inline constexpr int kMacroDim = kMacroDimX;
inline constexpr float kWorldExtent = kWorldExtentX;

// Check if macro coordinates are within sector boundaries.
inline constexpr bool in_bounds(int x, int y, int z) {
    return x >= 0 && x < kMacroDimX &&
           y >= 0 && y < kMacroDimY &&
           z >= 0 && z < kMacroDimZ;
}

inline constexpr bool in_bounds(ivec3 c) {
    return in_bounds(c.x, c.y, c.z);
}

// Bounded coordinate clamps per axis and 3D.
inline constexpr int clamp_macro_x(int x) {
    return std::clamp(x, 0, kMacroDimX - 1);
}

inline constexpr int clamp_macro_y(int y) {
    return std::clamp(y, 0, kMacroDimY - 1);
}

inline constexpr int clamp_macro_z(int z) {
    return std::clamp(z, 0, kMacroDimZ - 1);
}

inline constexpr ivec3 clamp_macro(int x, int y, int z) {
    return {
        std::clamp(x, 0, kMacroDimX - 1),
        std::clamp(y, 0, kMacroDimY - 1),
        std::clamp(z, 0, kMacroDimZ - 1)
    };
}

inline constexpr ivec3 clamp_macro(ivec3 c) {
    return clamp_macro(c.x, c.y, c.z);
}

// Flat anisotropic index into 512 x 512 x 16 array.
// macro_index(x, y, z) = x + y * kMacroDimX + z * kMacroDimX * kMacroDimY
inline constexpr std::size_t macro_index(int x, int y, int z) {
    return static_cast<std::size_t>(x)
         + static_cast<std::size_t>(y) * kMacroDimX
         + static_cast<std::size_t>(z) * kMacroDimX * kMacroDimY;
}

inline constexpr std::size_t macro_index(ivec3 c) {
    return macro_index(c.x, c.y, c.z);
}

// Flat bit index of a sub-voxel within a macro cell's 8^3 block.
inline constexpr int sub_bit(int sx, int sy, int sz) {
    return sx + sy * kSubDim + sz * kSubDim * kSubDim;
}

// Legacy 1D coordinate wrapper (deprecated, use clamp_macro / in_bounds).
inline int wrap_macro(int c) { return wrapi(c, kMacroDimX); }

} // namespace giga
