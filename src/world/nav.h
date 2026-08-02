// Baked coarse navigation over the 64-node lattice — L1 of the nav bake.
//
// The fixed 4x4x4 lattice (world/lattice.h) is a cyclic (Z/4)^3 torus graph and
// doubles as the HPA* coarse graph for navigation. This header bakes that graph
// from a floor's REAL geometry: for each of the 64 nodes a wrapped BFS through
// the macro grid measures the true geodesic distance to its 6 lattice
// neighbours (kUnreachable when no air path exists), then an all-pairs
// shortest-path pass yields an O(1) next-hop table the tick can steer by.
//
// Because the lattice is CYCLIC — no spanning tree over the torus — the coarse
// graph has no antipode "seam", the failure the reference hit and documented.
// See master_prompt.md #11 and memory `torus-nav-baking`.
//
// Bake-time only: run at floor load / post-samosbor (never on the sim tick),
// parallel ACROSS nodes (core/jobs.h). Deterministic: each BFS writes exactly
// one node's row, so the result is bit-identical regardless of scheduling.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "core/math.h" // ivec3 (route_step cell coordinates)
#include "world/lattice.h"
#include "world/types.h"

namespace giga {
class MacroGrid;

namespace nav {

// One coarse node per lattice node.
inline constexpr int kNodes = kLatticeCount; // 64

// Geodesic distance in macro cells. The 6-connected diameter of a 128^3 torus
// is 3*64 = 192, so a uint16 holds any real distance with room to spare and
// 0xFFFF is a clean, unambiguous "unreachable" sentinel.
using Dist = std::uint16_t;
inline constexpr Dist kUnreachable = 0xFFFFu;

// The baked coarse graph. A few KB of POD, baked per live floor and kept
// resident for the tick to query.
struct CoarseGraph {
    // edge[node][dir]: geodesic cell-distance to lattice_neighbor(node, dir)
    // through the real wrapped geometry, or kUnreachable if there is no air path.
    Dist edge[kNodes][6];
    // All-pairs shortest path over the cyclic 64-node graph.
    Dist dist[kNodes][kNodes];
    // next[i][j]: the neighbour NODE to step to from i heading toward j
    // (i itself when i == j or j is unreachable).
    std::uint8_t next[kNodes][kNodes];
};

// Full bake: 64 wrapped BFS through the grid (one per node, parallel across
// nodes) -> edge weights; then Floyd-Warshall -> all-pairs dist + next-hop.
// A macro cell is coarse-walkable when it is not fully solid (mask not full);
// each node is represented by its shaft-centre air cell. Bake-time only.
void bake_coarse(const MacroGrid& grid, CoarseGraph& out);

// O(1) tick query: the next node to move to from `from` heading toward `to`.
inline int coarse_next(const CoarseGraph& g, int from, int to) {
    return g.next[from][to];
}

// --- L2 fine navigation: per-node flow fields --------------------------------
//
// Where the coarse graph gets an agent from node to node, the flow fields get
// it cell-to-cell WITHIN the void toward a chosen node. One dense field per
// lattice node covers the whole 128^3 grid: at every walkable cell it stores
// the direction of the next step along a SHORTEST wrapped path to that node.
// Movement is then O(1) per tick — descend the field of `coarse_next`'s target
// — with no per-agent search (master_prompt #11; feeds the #12 movement AI).

// The 6 unit steps, in the SAME order the BFS and lattice neighbours use:
// -x,+x,-y,+y,-z,+z. A flow byte in [0,6) indexes this table; note reverse(d)
// == (d ^ 1), which the bake relies on to point a cell back toward its parent.
inline constexpr int kNavDir[6][3] = {
    {-1, 0, 0}, {1, 0, 0}, {0, -1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1},
};

// Flow bytes that are not a step direction.
inline constexpr std::uint8_t kFlowArrived = 6;   // this cell IS the node
inline constexpr std::uint8_t kFlowNone = 0xFFu;  // wall, or unreachable void

// The 64 baked flow fields (128 MiB) plus a 2 MiB nearest-node field, ~130 MiB
// resident per live floor — affordable by design (performance.md: RAM/disk are
// the generous budgets, the CPU tick is the scarce one). This is exactly the
// reference's abandoned "64-anchor packed flow fields", abandoned only for a
// browser's memory ceiling.
struct FineNav {
    std::vector<std::uint8_t> flow; // node-major: flow[node*kMacroCells + cell]

    // Nearest-node field: for every cell, the lattice node whose wrapped-geodesic
    // flood reached it first (its Voronoi anchor on the real geometry), or
    // kFlowNone in solid / unreachable void. 128^3 * 1 B = 2 MiB. This is what
    // lets an agent standing at ANY cell enter the route: its nearest anchor is
    // the flow field to descend. Baked by one deterministic multi-source BFS in
    // bake_fine, over the SAME walkability as the flow fields — so a cell's
    // nearest anchor is always reachable from it, i.e. at(nearest_node(c), c) is
    // never kFlowNone. Cell-indexed (NOT node-major): one entry per macro cell.
    std::vector<std::uint8_t> nearest;

    // Flow byte at a cell for routing toward `node`. Coordinates are wrapped, so
    // callers can pass raw (possibly out-of-range) cell indices.
    std::uint8_t at(int node, int x, int y, int z) const {
        return flow[static_cast<std::size_t>(node) * kMacroCells +
                    macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
    }

    // The nearest lattice node to a cell (its Voronoi anchor), or kFlowNone if the
    // cell is solid / unreachable. Coordinates are wrapped.
    std::uint8_t nearest_node(int x, int y, int z) const {
        return nearest[macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z))];
    }
};

// Bake all 64 flow fields from the floor geometry: one wrapped BFS per node,
// parallel ACROSS nodes — each owns a disjoint 2M-cell slice, so the run is
// race-free and bit-identical regardless of scheduling. Allocates ~128 MiB into
// out.flow; then a single deterministic multi-source BFS fills the 2 MiB
// out.nearest. Bake-time only (floor load / post-samosbor), never on the tick.
void bake_fine(const MacroGrid& grid, FineNav& out);

// --- Lazy / partial rebake (jirnyak.md §22) ---------------------------------
// Full bake_fine is ~130 MiB and seconds of BFS — too heavy per carve. These
// helpers re-touch only what geometry change invalidated so LazyFieldRebaker
// can amortize work under a per-frame budget without freezing the render thread.
void bake_fine_node_async(const MacroGrid& grid, int id, std::uint8_t* slice);
void rebake_fine_node(const MacroGrid& grid, FineNav& fine, int nodeId);
void rebake_nearest(const MacroGrid& grid, FineNav& fine);
void rebake_coarse(const MacroGrid& grid, CoarseGraph& coarse);

// --- Routing: enter the baked nav from any cell -----------------------------
//
// route_step is the O(1)/tick query the movement AI (#12) calls: "I am at cell
// `from` and want to reach cell `to` — which of the 6 unit steps do I take now?"
// It composes the two baked layers: the destination's nearest ANCHOR (via the
// nearest-node field) selects which of the 64 flow fields to descend, and the
// coarse all-pairs table answers reachability in O(1). The returned byte is a
// step dir 0..5 (index into kNavDir), kFlowArrived once `from` sits on the target
// anchor's own cell, or kFlowNone when `to` is unreachable from `from` (different
// components, or either endpoint inside solid).
//
// The anchor residual: because only the 64 fixed anchors carry flow fields, a
// `to` that is not itself an anchor cell is reached only up to its nearest anchor
// (<= one lattice half-spacing, 16 cells away); the final short leg is the
// caller's local approach. Targets that matter for nav (hubs, POIs) can sit ON
// anchors. Cells are macro-grid coordinates (wrapped internally), not world-space
// metres — the caller converts a Transform.pos with floor()/kCellSize first.
std::uint8_t route_step(const CoarseGraph& coarse, const FineNav& fine,
                        ivec3 from, ivec3 to);

} // namespace nav
} // namespace giga
