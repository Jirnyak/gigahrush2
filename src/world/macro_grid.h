// The macro grid: the single source of truth for world occupancy.
//
// A flat 128^3 array of cells. Each cell carries:
//   - a small integer cell-type id (game-defined: air, rock, water, ...), and
//   - an 8^3 sub-voxel blocker mask packed into kSubMaskWords x uint64_t.
//
// The sub-voxel mask is what makes collision cheap and fine-grained: a solid
// bit means "this 1/8-cell sub-voxel blocks movement". Physics tests a swept
// AABB against these bits with plain bitwise ops, so a fully solid cell and a
// half-carved one cost the same to query.
//
// The grid is data-oriented (structure-of-arrays): cell types and masks live
// in separate contiguous arrays so a system that only cares about occupancy
// never touches type memory, and vice versa.
#pragma once
#include <array>
#include <cstdint>
#include <vector>

#include "world/types.h"

namespace giga {

using CellType = std::uint16_t;
inline constexpr CellType kCellAir = 0;

// One macro cell's sub-voxel occupancy: kSubVoxels bits packed into words.
struct SubMask {
    std::uint64_t words[kSubMaskWords] = {};

    bool empty() const {
        for (auto w : words) if (w) return false;
        return true;
    }
    bool full() const {
        // Every bit up to kSubVoxels must be set.
        for (std::size_t i = 0; i + 1 < kSubMaskWords; ++i)
            if (words[i] != ~std::uint64_t{0}) return false;
        int rem = kSubVoxels - static_cast<int>((kSubMaskWords - 1) * 64);
        std::uint64_t lastFull =
            rem >= 64 ? ~std::uint64_t{0} : ((std::uint64_t{1} << rem) - 1);
        return words[kSubMaskWords - 1] == lastFull;
    }
    bool test(int bit) const {
        return (words[bit >> 6] >> (bit & 63)) & 1u;
    }
    void set(int bit) { words[bit >> 6] |= std::uint64_t{1} << (bit & 63); }
    void clear(int bit) { words[bit >> 6] &= ~(std::uint64_t{1} << (bit & 63)); }
    void set_all() {
        for (auto& w : words) w = ~std::uint64_t{0};
    }
    void clear_all() {
        for (auto& w : words) w = 0;
    }
    // True if any bit overlaps between the two masks (collision fast path).
    bool intersects(const SubMask& o) const {
        for (std::size_t i = 0; i < kSubMaskWords; ++i)
            if (words[i] & o.words[i]) return true;
        return false;
    }
};

class MacroGrid {
public:
    MacroGrid();

    // --- typed cell access (toroidal) --------------------------------------
    CellType cell(int x, int y, int z) const {
        return types_[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
    }
    void set_cell(int x, int y, int z, CellType t) {
        types_[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))] = t;
    }

    // --- sub-voxel occupancy (toroidal) ------------------------------------
    const SubMask& mask(int x, int y, int z) const {
        return masks_[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
    }
    SubMask& mask(int x, int y, int z) {
        return masks_[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
    }

    // Convenience: is a single sub-voxel solid? Coordinates are macro cell +
    // local 0..kSubDim-1 sub index.
    bool solid(int cx, int cy, int cz, int sx, int sy, int sz) const {
        return mask(cx, cy, cz).test(sub_bit(sx, sy, sz));
    }

    // Fill / clear an entire macro cell's sub-voxels and set its type.
    void fill_cell(int x, int y, int z, CellType t);
    void clear_cell(int x, int y, int z);

    // Raw flat access for renderers and serializers.
    const std::vector<CellType>& types() const { return types_; }
    const std::vector<SubMask>& masks() const { return masks_; }

    // Mutable raw access for wholesale state restore (a floor snapshot stamping
    // the grid back, [game/save.h]). Bulk writers only — per-cell mutation goes
    // through the toroidal accessors above.
    std::vector<CellType>& types_mut() { return types_; }
    std::vector<SubMask>& masks_mut() { return masks_; }

private:
    std::vector<CellType> types_;
    std::vector<SubMask> masks_;
};

} // namespace giga
