#include "world/nav.h"

#include <algorithm>
#include <cstddef>
#include <vector>

#include "core/jobs.h"
#include "world/macro_grid.h"
#include "world/types.h"
#include "world/walk_bits.h"

namespace giga::nav {
namespace {

// Coarse walkability during a bake: one bit of the WalkBits oracle. The LAW
// (an agent can occupy a macro cell unless it is FULLY solid — floor_gen
// carves shafts/lobbies/rooms as air and leaves walls/slabs/pads fully solid,
// so this cleanly separates the traversable void from structure) lives in
// `cell_open` below; here the answer is already precomputed, which is both
// what makes the bake snapshottable (the worker never touches the grid) and
// cheaper: one bit test per BFS visit instead of a word-loop over the mask.
inline bool blocked(const WalkBits& b, int x, int y, int z) {
    return !b.at(macro_index(x, y, z));
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
void bake_node(const WalkBits& g, int id, CoarseGraph& out) {
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
void bake_fine_node(const WalkBits& g, int id, std::uint8_t* slice) {
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

// The nearest-node field: for every walkable cell, which lattice node's flood
// reaches it first — the cell's geodesic Voronoi anchor on the real geometry.
// ONE multi-source BFS seeded from all 64 node cells at distance 0: a single FIFO
// visits cells in nondecreasing distance, so the anchor that first claims a cell
// is (one of) its nearest. Ties break by the deterministic seed+neighbour order,
// which is all correctness needs — the winner is always AT the min distance and
// reachable from its anchor (same walkability as the flow fields). `nearest` is
// PRE-CLEARED to kFlowNone by the caller, so walls (never claimed) stay kFlowNone
// and it doubles as the "unvisited" marker. Single-threaded => bit-identical.
void bake_nearest(const WalkBits& g, std::uint8_t* nearest) {
    std::vector<int> q;
    q.reserve(1u << 16);
    const int W = kMacroDim;

    for (int id = 0; id < kNodes; ++id) {
        int sx, sy, sz;
        node_cell(id, sx, sy, sz);
        if (blocked(g, sx, sy, sz)) continue; // no anchor here (carve guarantees air)
        const std::size_t si = macro_index(sx, sy, sz);
        if (nearest[si] != kFlowNone) continue; // one cell can host only one anchor
        nearest[si] = static_cast<std::uint8_t>(id);
        q.push_back(static_cast<int>(si));
    }

    for (std::size_t head = 0; head < q.size(); ++head) {
        const int ci = q[head];
        const int cz = ci / (W * W);
        const int cy = (ci / W) % W;
        const int cx = ci % W;
        const std::uint8_t owner = nearest[ci]; // propagate this cell's anchor
        for (int d = 0; d < 6; ++d) {
            const int nx = wrap_macro(cx + kNavDir[d][0]);
            const int ny = wrap_macro(cy + kNavDir[d][1]);
            const int nz = wrap_macro(cz + kNavDir[d][2]);
            const std::size_t ni = macro_index(nx, ny, nz);
            if (nearest[ni] != kFlowNone) continue; // already claimed (nearer or tie)
            if (blocked(g, nx, ny, nz)) continue;    // wall stays kFlowNone
            nearest[ni] = owner;
            q.push_back(static_cast<int>(ni));
        }
    }
}

} // namespace

// The one walkability law, in one place. `build_walk_bits` and
// `patch_walk_bit` both route through here, so the bulk sweep and the O(1)
// dirty-cell drain can never disagree about what a wall is.
bool cell_open(const SubMask& m) { return !m.full(); }

void build_walk_bits(const MacroGrid& grid, WalkBits& out) {
    out.build([&grid](int x, int y, int z) {
        return cell_open(grid.mask(x, y, z));
    });
}

void patch_walk_bit(WalkBits& bits, std::size_t cell, const SubMask& m) {
    bits.set(cell, cell_open(m));
}

void bake_coarse(const MacroGrid& grid, CoarseGraph& out) {
    // One predicate sweep, then the oracle bake — the grid is read exactly
    // once per cell and never again, which is the property phase C's snapshot
    // depends on.
    WalkBits open;
    build_walk_bits(grid, open);
    bake_coarse(open, out);
}

void bake_coarse(const WalkBits& open, CoarseGraph& out) {
    // 64 independent per-node BFS, fanned across the hardware threads. Each
    // writes a disjoint edge row -> race-free + deterministic.
    parallel_for(kNodes, [&open, &out](int id) { bake_node(open, id, out); });

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
    WalkBits open;
    build_walk_bits(grid, open);
    bake_fine(open, out);
}

void bake_fine(const WalkBits& open, FineNav& out) {
    // Pre-clear once, sequentially: every slice starts kFlowNone, which each
    // node's BFS then uses as its "unvisited" marker.
    out.flow.assign(static_cast<std::size_t>(kNodes) * kMacroCells, kFlowNone);
    std::uint8_t* base = out.flow.data();
    // 64 independent per-node floods, fanned across the hardware threads. Each
    // writes a disjoint kMacroCells slice -> race-free + deterministic.
    parallel_for(kNodes, [&open, base](int id) {
        bake_fine_node(open, id,
                       base + static_cast<std::size_t>(id) * kMacroCells);
    });

    // Nearest-node field: pre-clear to kFlowNone (walls/void stay so), then one
    // deterministic multi-source BFS labels every walkable cell with its anchor.
    out.nearest.assign(kMacroCells, kFlowNone);
    bake_nearest(open, out.nearest.data());
}

std::uint8_t route_step(const CoarseGraph& coarse, const FineNav& fine,
                        ivec3 from, ivec3 to) {
    // EMPTY BAKE IS A NO-OP, NOT UB — the same contract wander_step keeps: an
    // async bake in flight means "no route yet", never an index into nothing.
    // Found by the e2e contract test, which crashed here instead of reading
    // kFlowNone back.
    if (fine.flow.empty() || fine.nearest.empty()) return kFlowNone;

    // Already standing on the destination cell.
    if (from.x == to.x && from.y == to.y && from.z == to.z) return kFlowArrived;

    // The anchors nearest each endpoint. kFlowNone means the endpoint is inside
    // solid (no flood ever claimed it) — nothing to route to/from.
    const std::uint8_t tNode = fine.nearest_node(to.x, to.y, to.z);
    const std::uint8_t fNode = fine.nearest_node(from.x, from.y, from.z);
    if (tNode == kFlowNone || fNode == kFlowNone) return kFlowNone;

    // Different connected components: no path exists. The all-pairs coarse table
    // answers this in O(1) and states the intent; fine.at below would also return
    // kFlowNone for a cross-component query, so this is a fast, explicit guard.
    if (coarse.dist[fNode][tNode] == kUnreachable) return kFlowNone;

    // Same component: descend the destination anchor's GLOBAL flow field. Being a
    // BFS parent chain rooted at tNode, it is a shortest-path pointer toward tNode
    // from EVERY reachable cell, so the step is optimal, cycle-free, and always
    // arrives (monotone descent — no per-region flapping). The coarse check above
    // is what keeps this HPA*: were the fields ever truncated to local tiles, we
    // would instead descend coarse_next(fNode, tNode)'s field and re-pick at each
    // region boundary (with consumer hysteresis); the global fields let us skip
    // straight to the target anchor here.
    return fine.at(tNode, from.x, from.y, from.z);
}

} // namespace giga::nav
