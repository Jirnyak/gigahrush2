// The fixed navigation / fast-travel lattice.
//
// A FIXED 4x4x4 = 64-node grid stamped identically into every floor module,
// INDEPENDENT of the world seed. The hubs sit at the same place on every floor,
// so a rider always knows where they are and fast-travel between the same node
// on different floors is positionally stable (elevators.md).
//
// The lattice is deliberately ONE structure serving two roles:
//   * the fast-elevator hub set (elevators.md), and
//   * the coarse graph for baked navigation (master_prompt.md #7 #11).
// It is a cyclic (Z/4)^3 torus graph — every node has 6 wrapped neighbours —
// which is exactly the structure that lets path/field baking avoid a spanning
// tree's antipode "seams" on the 3-torus. See memory `torus-nav-baking`.
//
// This header is pure constexpr geometry with no game meaning and no state; the
// game layer (floor_gen, elevators, nav) attaches meaning on top. Core-only: no
// SDL/Vulkan/ImGui, dependency-free beyond world dimensions + toroidal wrap.
#pragma once

#include "core/wrap.h"   // wrapi (constexpr)
#include "world/types.h" // kMacroDim

namespace giga {

// Nodes per axis, and the total node count.
inline constexpr int kLatticeDim = 4;
inline constexpr int kLatticeCount = kLatticeDim * kLatticeDim * kLatticeDim; // 64

// Cell spacing between adjacent nodes on one axis, and half of it. Spacing 32
// divides every FloorKind's storey height (4/8/16) and room stride (8/16/32),
// so a node always lands on a slab + room line — see floor_gen.cpp.
inline constexpr int kLatticeSpacing = kMacroDim / kLatticeDim; // 32
inline constexpr int kLatticeHalf = kLatticeSpacing / 2;        // 16

static_assert(kMacroDim % kLatticeDim == 0,
              "the lattice must tile the torus evenly");
static_assert(kLatticeSpacing * kLatticeDim == kMacroDim, "spacing sanity");

// Cell-centre coordinate (one axis) of lattice index i in [0, kLatticeDim).
// Centres are {16, 48, 80, 112}: the midpoint of each spacing-wide band, so
// every node sits as far as possible from its neighbours on the torus.
inline constexpr int lattice_coord(int i) {
    return i * kLatticeSpacing + kLatticeHalf;
}

// Nearest lattice index on one axis to a macro coordinate. Each node owns the
// contiguous band [i*spacing, (i+1)*spacing); because the centre is the band
// midpoint, that band IS the node's Voronoi cell on the torus.
inline constexpr int lattice_axis_of(int c) {
    return wrapi(c, kMacroDim) / kLatticeSpacing;
}

// Pack / unpack a node's (ix,iy,iz) in [0,kLatticeDim)^3 to a flat id in [0,64).
inline constexpr int lattice_id(int ix, int iy, int iz) {
    return (iz * kLatticeDim + iy) * kLatticeDim + ix;
}

struct LatticeNode {
    int ix, iy, iz;
};

inline constexpr LatticeNode lattice_unpack(int id) {
    return {id % kLatticeDim, (id / kLatticeDim) % kLatticeDim,
            id / (kLatticeDim * kLatticeDim)};
}

// The 6 face-neighbours of a node on the cyclic (Z/4)^3 torus graph. `dir` in
// [0,6) selects -x,+x,-y,+y,-z,+z. The wrap on every axis is what makes the
// coarse graph seam-free — there is no boundary node, so no cut cycle.
inline constexpr int lattice_neighbor(int id, int dir) {
    LatticeNode n = lattice_unpack(id);
    switch (dir) {
        case 0: n.ix = wrapi(n.ix - 1, kLatticeDim); break;
        case 1: n.ix = wrapi(n.ix + 1, kLatticeDim); break;
        case 2: n.iy = wrapi(n.iy - 1, kLatticeDim); break;
        case 3: n.iy = wrapi(n.iy + 1, kLatticeDim); break;
        case 4: n.iz = wrapi(n.iz - 1, kLatticeDim); break;
        case 5: n.iz = wrapi(n.iz + 1, kLatticeDim); break;
        default: break;
    }
    return lattice_id(n.ix, n.iy, n.iz);
}

} // namespace giga
