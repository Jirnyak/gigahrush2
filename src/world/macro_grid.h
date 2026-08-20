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
        if (centreOnly)
            return face_layer_window(axis, dir, kSubDim / 2 - 1, kSubDim / 2 - 1);
        for (int i = 0; i < kSubDim; ++i) {
            const int s = dir > 0 ? kSubDim - 1 - i : i;
            const bool solid = axis == 2 ? words[s] != 0
                                         : tangent_layer_solid(axis, s, false);
            if (solid) return s;
        }
        return -1;
    }

    // То же, но окно 2×2 в ТОЧКЕ КРЕПЛЕНИЯ (u,v) на тангенциальных осях грани
    // (X-грань → (y,z), Y-грань → (x,z), Z-грань → (x,y); соответствие держит
    // anchor_face_uv в [world/anchor.h], потребители его не дублируют). Окно
    // прижимается к краю грани; центр (kSubDim/2-1)² воспроизводит kCentreZ
    // бит в бит — face_layer(centreOnly) делегирует сюда. Точка, а не центр
    // (решение владельца 2026-08-20, S2): вещь, прибитая в углу 2-метровой
    // грани, живёт и умирает по материи ПОД СОБОЙ, а не в полуметре от себя.
    int face_layer_window(int axis, int dir, int u, int v) const {
        const int u0 = u < 0 ? 0 : (u > kSubDim - 2 ? kSubDim - 2 : u);
        const int v0 = v < 0 ? 0 : (v > kSubDim - 2 ? kSubDim - 2 : v);
        if (axis == 2) {
            const std::uint64_t m =
                (std::uint64_t{3} << (u0 + v0 * kSubDim)) |
                (std::uint64_t{3} << (u0 + (v0 + 1) * kSubDim));
            for (int i = 0; i < kSubDim; ++i) {
                const int s = dir > 0 ? kSubDim - 1 - i : i;
                if (words[s] & m) return s;
            }
            return -1;
        }
        for (int i = 0; i < kSubDim; ++i) {
            const int s = dir > 0 ? kSubDim - 1 - i : i;
            for (int a = u0; a <= u0 + 1; ++a)
                for (int b = v0; b <= v0 + 1; ++b)
                    if (test(axis == 0 ? sub_bit(s, a, b) : sub_bit(a, s, b)))
                        return s;
        }
        return -1;
    }

    // Is any sub-voxel of the layer `s` along a TANGENT axis (0 or 1) solid?
    // The two axes that are not the packing axis stride across every word.
    bool tangent_layer_solid(int axis, int s, bool centreOnly) const {
        const int a0 = centreOnly ? kSubDim / 2 - 1 : 0;
        const int a1 = centreOnly ? kSubDim / 2 : kSubDim - 1;
        for (int a = a0; a <= a1; ++a)
            for (int b = a0; b <= a1; ++b)
                if (test(sub_bit(axis == 0 ? s : a, axis == 0 ? a : s, b)))
                    return true;
        return false;
    }

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
