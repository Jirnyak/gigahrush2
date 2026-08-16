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

    // The 2x2 CENTRE column of one Z sub-layer — a POINT attachment needs matter
    // straight along the pull, not somewhere at the cell's rim.
    static constexpr std::uint64_t kCentreZ =
        (std::uint64_t{3} << ((kSubDim / 2 - 1) + (kSubDim / 2 - 1) * kSubDim)) |
        (std::uint64_t{3} << ((kSubDim / 2 - 1) + (kSubDim / 2) * kSubDim));

    // Lowest occupied sub-layer (0..7), or -1 when empty. word i IS layer sz=i
    // (sub_bit packs sx + sy*8 + sz*64). Anything that HANGS from a cell (a
    // wire anchor, a lamp, a pipe hugging a ceiling) must ask for the REAL
    // under-face — partially carved cells (the sandwich lintels) keep their
    // matter in the top layers only, and hanging from the cell PLANE reads as
    // hanging from air (owner's screenshots, 2026-08-03).
    //
    // These two are the Z-FRAME shorthands, kept as raw word loops because they
    // are the hot ones: a -Z world asks them per prop, per frame. The general
    // frame question is face_layer() below.
    int lowest_layer() const {
        for (int sz = 0; sz < kSubDim; ++sz)
            if (words[sz] != 0) return sz;
        return -1;
    }
    int lowest_layer_centre() const {
        for (int sz = 0; sz < kSubDim; ++sz)
            if (words[sz] & kCentreZ) return sz;
        return -1;
    }

    // The first solid sub-layer met coming IN through one FACE of the cell:
    // layers perpendicular to `axis`, scanned from the low side (`dir` < 0) or
    // the high side (`dir` > 0). -1 when the cell is empty.
    //
    // WHICH face a thing hangs from is a gravity-FRAME question, never "the low
    // z one" ([world/gravity.h] GravityFrame): a sideways-pulled floor hangs its
    // dressing off an x or y face and asks here in exactly the same words. Z is
    // the packing axis and stays a single word test per layer; a tangent axis
    // pays a bit loop — at bake time only, never in a tick.
    int face_layer(int axis, int dir, bool centreOnly) const {
        const std::uint64_t zMask = centreOnly ? kCentreZ : ~std::uint64_t{0};
        for (int i = 0; i < kSubDim; ++i) {
            const int s = dir > 0 ? kSubDim - 1 - i : i;
            const bool solid = axis == 2 ? (words[s] & zMask) != 0
                                         : tangent_layer_solid(axis, s, centreOnly);
            if (solid) return s;
        }
        return -1;
    }

    // Is any sub-voxel of the layer `s` along a TANGENT axis (0 or 1) solid?
    // The two axes that are not the packing axis stride across every word.
    bool tangent_layer_solid(int axis, int s, bool centreOnly) const {
        if (centreOnly) {
            const std::uint64_t mask = (axis == 0)
                ? ((std::uint64_t{1} << (kSubDim * (kSubDim / 2 - 1))) |
                   (std::uint64_t{1} << (kSubDim * (kSubDim / 2)))) << s
                : (std::uint64_t{0x18} << (s * kSubDim));
            return (words[kSubDim / 2 - 1] & mask) != 0 || (words[kSubDim / 2] & mask) != 0;
        }
        const std::uint64_t mask = (axis == 0)
            ? (std::uint64_t{0x0101010101010101ULL} << s)
            : (std::uint64_t{0xFFULL} << (s * kSubDim));
        for (int sz = 0; sz < kSubDim; ++sz)
            if (words[sz] & mask) return true;
        return false;
    }

    bool empty() const {
        for (auto w : words) if (w) return false;
        return true;
    }
    bool full() const {
        for (auto w : words)
            if (w != ~std::uint64_t{0}) return false;
        return true;
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

    // --- typed cell access (bounded) --------------------------------------
    CellType cell(int x, int y, int z) const {
        const auto c = clamp_macro(x, y, z);
        return types_[macro_index(c.x, c.y, c.z)];
    }
    void set_cell(int x, int y, int z, CellType t) {
        const auto c = clamp_macro(x, y, z);
        types_[macro_index(c.x, c.y, c.z)] = t;
    }

    // --- sub-voxel occupancy (bounded) ------------------------------------
    const SubMask& mask(int x, int y, int z) const {
        const auto c = clamp_macro(x, y, z);
        return masks_[macro_index(c.x, c.y, c.z)];
    }
    SubMask& mask(int x, int y, int z) {
        const auto c = clamp_macro(x, y, z);
        return masks_[macro_index(c.x, c.y, c.z)];
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
    // through the bounded accessors above.
    std::vector<CellType>& types_mut() { return types_; }
    std::vector<SubMask>& masks_mut() { return masks_; }

private:
    std::vector<CellType> types_;
    std::vector<SubMask> masks_;
};

} // namespace giga
