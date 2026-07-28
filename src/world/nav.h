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

#include <cstdint>

#include "world/lattice.h"

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

} // namespace nav
} // namespace giga
