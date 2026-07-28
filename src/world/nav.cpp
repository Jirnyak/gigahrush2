#include "world/nav.h"

#include <cstddef>
#include <vector>

#include "core/jobs.h"
#include "world/macro_grid.h"
#include "world/types.h"

namespace giga::nav {
namespace {

// Coarse walkability: an agent can occupy a macro cell unless it is FULLY solid.
// floor_gen carves shafts/lobbies/rooms as air and leaves walls/slabs/pads
// fully solid, so this cleanly separates the traversable void from structure.
inline bool blocked(const MacroGrid& g, int x, int y, int z) {
    return g.mask(x, y, z).full();
}

// The macro cell that represents a lattice node for pathing: its shaft centre,
// which floor_gen guarantees is air on every floor kind (the 3x3 shaft is
// punched to air through every slab, and the hub-pad recolour skips air cells).
inline void node_cell(int id, int& cx, int& cy, int& cz) {
    const LatticeNode n = lattice_unpack(id);
    cx = lattice_coord(n.ix);
    cy = lattice_coord(n.iy);
    cz = lattice_coord(n.iz);
}

// One node's BFS: flood the walkable void from its shaft cell and record the
// geodesic distance to each of its 6 lattice neighbours. Writes ONLY
// out.edge[id][*] — the per-node isolation that makes the parallel bake
// race-free and deterministic (core/jobs.h contract).
void bake_node(const MacroGrid& g, int id, CoarseGraph& out) {
    int sx, sy, sz;
    node_cell(id, sx, sy, sz);
    // A node whose own cell is blocked (should not happen with the carved
    // lattice) leaves every edge unreachable rather than seeding a bad flood.
    if (blocked(g, sx, sy, sz)) {
        for (int d = 0; d < 6; ++d) out.edge[id][d] = kUnreachable;
        return;
    }

    std::vector<Dist> dist(kMacroCells, kUnreachable);
    std::vector<int> q;
    q.reserve(1u << 16);

    const int W = kMacroDim;
    const int start = static_cast<int>(macro_index(sx, sy, sz));
    dist[static_cast<std::size_t>(start)] = 0;
    q.push_back(start);

    // 6-connected flood, every step wrapped onto the torus. A plain FIFO over a
    // growing vector: BFS on unit edges visits each cell once in distance order.
    for (std::size_t head = 0; head < q.size(); ++head) {
        const int ci = q[head];
        const int cz = ci / (W * W);
        const int cy = (ci / W) % W;
        const int cx = ci % W;
        const Dist nd = static_cast<Dist>(dist[static_cast<std::size_t>(ci)] + 1);
        const int nbr[6][3] = {
            {cx - 1, cy, cz}, {cx + 1, cy, cz},
            {cx, cy - 1, cz}, {cx, cy + 1, cz},
            {cx, cy, cz - 1}, {cx, cy, cz + 1},
        };
        for (int k = 0; k < 6; ++k) {
            const int nx = wrap_macro(nbr[k][0]);
            const int ny = wrap_macro(nbr[k][1]);
            const int nz = wrap_macro(nbr[k][2]);
            const std::size_t ni = macro_index(nx, ny, nz);
            if (dist[ni] != kUnreachable) continue; // already reached
            if (blocked(g, nx, ny, nz)) continue;    // not walkable
            dist[ni] = nd;
            q.push_back(static_cast<int>(ni));
        }
    }

    for (int d = 0; d < 6; ++d) {
        int ex, ey, ez;
        node_cell(lattice_neighbor(id, d), ex, ey, ez);
        out.edge[id][d] = dist[macro_index(ex, ey, ez)];
    }
}

// One node's flow field: the same wrapped BFS as bake_node, but instead of
// keeping the distance it records, at every cell it reaches, the direction of
// the step back toward the node (its BFS parent). `slice` is this node's own
// kMacroCells-byte region of FineNav::flow, PRE-CLEARED to kFlowNone by the
// caller — so kFlowNone doubles as the "unvisited" marker and walls (never
// visited) correctly keep it. Writes only `slice`: race-free across nodes.
void bake_fine_node(const MacroGrid& g, int id, std::uint8_t* slice) {
    int sx, sy, sz;
    node_cell(id, sx, sy, sz);
    if (blocked(g, sx, sy, sz)) return; // no field (carve guarantees it is air)

    std::vector<int> q;
    q.reserve(1u << 16);

    const int W = kMacroDim;
    const int start = static_cast<int>(macro_index(sx, sy, sz));
    slice[start] = kFlowArrived;
    q.push_back(start);

    for (std::size_t head = 0; head < q.size(); ++head) {
        const int ci = q[head];
        const int cz = ci / (W * W);
        const int cy = (ci / W) % W;
        const int cx = ci % W;
        for (int d = 0; d < 6; ++d) {
            const int nx = wrap_macro(cx + kNavDir[d][0]);
            const int ny = wrap_macro(cy + kNavDir[d][1]);
            const int nz = wrap_macro(cz + kNavDir[d][2]);
            const std::size_t ni = macro_index(nx, ny, nz);
            if (slice[ni] != kFlowNone) continue; // already reached (or arrived)
            if (blocked(g, nx, ny, nz)) continue;  // wall stays kFlowNone
            // We stepped cur -> nbr in dir d, so nbr routes back in dir (d ^ 1).
            slice[ni] = static_cast<std::uint8_t>(d ^ 1);
            q.push_back(static_cast<int>(ni));
        }
    }
}

} // namespace

void bake_coarse(const MacroGrid& grid, CoarseGraph& out) {
    // 64 independent per-node BFS, fanned across the hardware threads. Each
    // writes a disjoint edge row -> race-free + deterministic.
    parallel_for(kNodes, [&grid, &out](int id) { bake_node(grid, id, out); });

    // Seed all-pairs from the cyclic-lattice edges, then Floyd-Warshall. 64
    // nodes -> 64^3 ~= 260k ops: instant, single-threaded (so deterministic).
    for (int i = 0; i < kNodes; ++i)
        for (int j = 0; j < kNodes; ++j) {
            out.dist[i][j] = (i == j) ? Dist{0} : kUnreachable;
            out.next[i][j] = static_cast<std::uint8_t>(i);
        }
    for (int i = 0; i < kNodes; ++i)
        for (int d = 0; d < 6; ++d) {
            const int j = lattice_neighbor(i, d);
            const Dist w = out.edge[i][d];
            if (w < out.dist[i][j]) {
                out.dist[i][j] = w;
                out.next[i][j] = static_cast<std::uint8_t>(j);
            }
        }
    for (int k = 0; k < kNodes; ++k)
        for (int i = 0; i < kNodes; ++i) {
            if (out.dist[i][k] == kUnreachable) continue;
            const int dik = out.dist[i][k];
            for (int j = 0; j < kNodes; ++j) {
                if (out.dist[k][j] == kUnreachable) continue;
                const int cand = dik + static_cast<int>(out.dist[k][j]);
                if (cand < static_cast<int>(out.dist[i][j])) {
                    out.dist[i][j] = static_cast<Dist>(cand);
                    out.next[i][j] = out.next[i][k];
                }
            }
        }
}

void bake_fine(const MacroGrid& grid, FineNav& out) {
    // Pre-clear once, sequentially: every slice starts kFlowNone, which each
    // node's BFS then uses as its "unvisited" marker.
    out.flow.assign(static_cast<std::size_t>(kNodes) * kMacroCells, kFlowNone);
    std::uint8_t* base = out.flow.data();
    // 64 independent per-node floods, fanned across the hardware threads. Each
    // writes a disjoint kMacroCells slice -> race-free + deterministic.
    parallel_for(kNodes, [&grid, base](int id) {
        bake_fine_node(grid, id,
                       base + static_cast<std::size_t>(id) * kMacroCells);
    });
}

} // namespace giga::nav
