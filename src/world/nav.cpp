#include "world/nav.h"

#include <algorithm>
#include <cstddef>
#include <queue>
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

// The nearest-node field: for every walkable cell, which lattice node's flood
// reaches it first — the cell's geodesic Voronoi anchor on the real geometry.
// ONE multi-source BFS seeded from all 64 node cells at distance 0: a single FIFO
// visits cells in nondecreasing distance, so the anchor that first claims a cell
// is (one of) its nearest. Ties break by the deterministic seed+neighbour order,
// which is all correctness needs — the winner is always AT the min distance and
// reachable from its anchor (same walkability as the flow fields). `nearest` is
// PRE-CLEARED to kFlowNone by the caller, so walls (never claimed) stay kFlowNone
// and it doubles as the "unvisited" marker. Single-threaded => bit-identical.
void bake_nearest(const MacroGrid& g, std::uint8_t* nearest) {
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

    // Nearest-node field: pre-clear to kFlowNone (walls/void stay so), then one
    // deterministic multi-source BFS labels every walkable cell with its anchor.
    out.nearest.assign(kMacroCells, kFlowNone);
    bake_nearest(grid, out.nearest.data());
}

std::uint8_t route_step(const CoarseGraph& coarse, const FineNav& fine,
                        ivec3 from, ivec3 to) {
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

void generate_shaft_waypoint_links(int fromFloor, int toFloor,
                                  std::vector<VerticalWaypointLink>& outLinks) {
    if (fromFloor == toFloor) return;
    const int dir = toFloor > fromFloor ? 1 : -1;
    const Dist floorStepCost = static_cast<Dist>((dir > 0 ? (toFloor - fromFloor) : (fromFloor - toFloor)) * 16);

    // 16 primary elevator shafts distributed across the 32x32 sector grid
    // Hub sectors at sx in {4, 12, 20, 28}, sy in {4, 12, 20, 28}
    constexpr int kHubSectors[4] = {4, 12, 20, 28};
    for (int iyIdx = 0; iyIdx < 4; ++iyIdx) {
        for (int ixIdx = 0; ixIdx < 4; ++ixIdx) {
            const int sx = kHubSectors[ixIdx];
            const int sy = kHubSectors[iyIdx];
            const int cx = sector_coord_x(sx);
            const int cy = sector_coord_y(sy);

            const int depZ = (dir > 0) ? 12 : 4;
            const int arrZ = (dir > 0) ? 4 : 12;

            VerticalWaypointLink link;
            link.fromFloor = fromFloor;
            link.toFloor = toFloor;
            link.fromCell = ivec3{cx, cy, depZ};
            link.toCell = ivec3{cx, cy, arrZ};
            link.kind = VerticalTransitKind::ElevatorShaft;
            link.hubIndex = static_cast<std::uint16_t>(iyIdx * 4 + ixIdx);
            link.cost = floorStepCost;
            outLinks.push_back(link);
        }
    }
}

void generate_vertical_links(const MacroGrid& grid, int floorNumber,
                            int adjacentFloor,
                            std::vector<VerticalWaypointLink>& outLinks) {
    generate_shaft_waypoint_links(floorNumber, adjacentFloor, outLinks);

    if (floorNumber == adjacentFloor) return;
    const int dir = adjacentFloor > floorNumber ? 1 : -1;
    const int absDelta = dir > 0 ? (adjacentFloor - floorNumber) : (floorNumber - adjacentFloor);
    const Dist stairCost = static_cast<Dist>(absDelta * 24);
    const Dist ladderCost = static_cast<Dist>(absDelta * 32);
    const Dist chuteCost = static_cast<Dist>(absDelta * 8);

    // Scan across the 32x32 sector grid for vertical transit points
    for (int sy = 0; sy < kSectorDimY; ++sy) {
        for (int sx = 0; sx < kSectorDimX; ++sx) {
            const int cx = sector_coord_x(sx);
            const int cy = sector_coord_y(sy);
            const int cz = sector_coord_z(0);

            // Stairwells: architectural staircases near sector junctions (every 4 sectors)
            if ((sx % 4 == 2) && (sy % 4 == 2)) {
                const int stX = cx + 4;
                const int stY = cy + 4;
                if (stX < 512 && stY < 512 && !grid.mask(stX % kMacroDim, stY % kMacroDim, cz % kMacroDim).full()) {
                    VerticalWaypointLink stairLink;
                    stairLink.fromFloor = floorNumber;
                    stairLink.toFloor = adjacentFloor;
                    stairLink.fromCell = ivec3{stX, stY, cz};
                    stairLink.toCell = ivec3{stX, stY, cz};
                    stairLink.kind = VerticalTransitKind::Stairwell;
                    stairLink.hubIndex = 0xFFFFu;
                    stairLink.cost = stairCost;
                    outLinks.push_back(stairLink);
                }
            }

            // Maintenance Ladders: vertical service ladders at perimeter utility corridors
            if ((sx % 4 == 0) && (sy % 4 == 0)) {
                const int ldX = cx - 4;
                const int ldY = cy - 4;
                if (ldX >= 0 && ldY >= 0 && !grid.mask(ldX % kMacroDim, ldY % kMacroDim, cz % kMacroDim).full()) {
                    VerticalWaypointLink ladderLink;
                    ladderLink.fromFloor = floorNumber;
                    ladderLink.toFloor = adjacentFloor;
                    ladderLink.fromCell = ivec3{ldX, ldY, cz};
                    ladderLink.toCell = ivec3{ldX, ldY, cz};
                    ladderLink.kind = VerticalTransitKind::Ladder;
                    ladderLink.hubIndex = 0xFFFFu;
                    ladderLink.cost = ladderCost;
                    outLinks.push_back(ladderLink);
                }
            }

            // Gravity Chutes: Unidirectional emergency drop chutes (strictly downwards)
            if (dir < 0 && ((sx % 4 == 3) && (sy % 4 == 3))) {
                const int chX = cx + 2;
                const int chY = cy - 2;
                if (chX < 512 && chY >= 0 && !grid.mask(chX % kMacroDim, chY % kMacroDim, cz % kMacroDim).full()) {
                    VerticalWaypointLink chuteLink;
                    chuteLink.fromFloor = floorNumber;
                    chuteLink.toFloor = adjacentFloor;
                    chuteLink.fromCell = ivec3{chX, chY, cz};
                    chuteLink.toCell = ivec3{chX, chY, cz};
                    chuteLink.kind = VerticalTransitKind::GravityChute;
                    chuteLink.hubIndex = 0xFFFFu;
                    chuteLink.cost = chuteCost;
                    outLinks.push_back(chuteLink);
                }
            }
        }
    }
}

MultiFloorPathStep multi_floor_route_step(const CoarseGraph& coarse,
                                          const FineNav& fine,
                                          int fromFloor, ivec3 fromCell,
                                          int toFloor, ivec3 toCell,
                                          const std::vector<VerticalWaypointLink>& links) {
    MultiFloorPathStep step;
    if (fromFloor == toFloor) {
        step.dir = route_step(coarse, fine, fromCell, toCell);
        step.crossFloor = false;
        step.targetFloor = toFloor;
        step.transitCell = toCell;
        step.transitKind = VerticalTransitKind::ElevatorShaft;
        return step;
    }

    const int verticalDir = toFloor > fromFloor ? 1 : -1;
    const VerticalWaypointLink* bestLink = nullptr;
    std::uint32_t bestScore = 0xFFFFFFFFu;

    const std::uint8_t fNode = fine.nearest_node(fromCell.x, fromCell.y, fromCell.z);

    for (const auto& link : links) {
        if (link.fromFloor != fromFloor) continue;
        const int linkDir = link.toFloor > link.fromFloor ? 1 : -1;
        if (linkDir != verticalDir) continue;

        const std::uint8_t lNode = fine.nearest_node(link.fromCell.x, link.fromCell.y, link.fromCell.z);
        Dist coarseDist = 0;
        if (fNode != kFlowNone && lNode != kFlowNone && fNode < kNodes && lNode < kNodes) {
            coarseDist = coarse.dist[fNode][lNode];
            if (coarseDist == kUnreachable) {
                const int dx = std::abs(fromCell.x - link.fromCell.x);
                const int dy = std::abs(fromCell.y - link.fromCell.y);
                const int dz = std::abs(fromCell.z - link.fromCell.z);
                coarseDist = static_cast<Dist>(dx + dy + dz);
            }
        } else {
            const int dx = std::abs(fromCell.x - link.fromCell.x);
            const int dy = std::abs(fromCell.y - link.fromCell.y);
            const int dz = std::abs(fromCell.z - link.fromCell.z);
            coarseDist = static_cast<Dist>(dx + dy + dz);
        }

        const int ex = std::abs(link.toCell.x - toCell.x);
        const int ey = std::abs(link.toCell.y - toCell.y);
        const int ez = std::abs(link.toCell.z - toCell.z);
        const std::uint32_t remDist = static_cast<std::uint32_t>(ex + ey + ez);

        const std::uint32_t totalScore = static_cast<std::uint32_t>(coarseDist) + link.cost + remDist;
        if (totalScore < bestScore) {
            bestScore = totalScore;
            bestLink = &link;
        }
    }

    VerticalWaypointLink fallbackLink;
    if (bestLink == nullptr) {
        const int sx = sector_axis_of_x(fromCell.x);
        const int sy = sector_axis_of_y(fromCell.y);
        fallbackLink.fromFloor = fromFloor;
        fallbackLink.toFloor = toFloor;
        fallbackLink.fromCell = ivec3{sector_coord_x(sx), sector_coord_y(sy), fromCell.z};
        fallbackLink.toCell = ivec3{sector_coord_x(sx), sector_coord_y(sy), toCell.z};
        fallbackLink.kind = VerticalTransitKind::ElevatorShaft;
        fallbackLink.hubIndex = static_cast<std::uint16_t>(sector_node_id(sx, sy));
        fallbackLink.cost = static_cast<Dist>(std::abs(toFloor - fromFloor) * 16);
        bestLink = &fallbackLink;
    }

    const int dx = std::abs(fromCell.x - bestLink->fromCell.x);
    const int dy = std::abs(fromCell.y - bestLink->fromCell.y);
    const int dz = std::abs(fromCell.z - bestLink->fromCell.z);

    const bool inShaft = (bestLink->kind == VerticalTransitKind::ElevatorShaft &&
                          dx <= 2 && dy <= 2);
    const bool atCell = (dx == 0 && dy == 0 && dz <= 2);

    if (inShaft || atCell) {
        step.dir = kFlowArrived;
        step.crossFloor = true;
        step.targetFloor = bestLink->toFloor;
        step.transitCell = bestLink->toCell;
        step.transitKind = bestLink->kind;
        return step;
    }

    step.dir = route_step(coarse, fine, fromCell, bestLink->fromCell);
    if (step.dir == kFlowNone) {
        const int cdx = bestLink->fromCell.x - fromCell.x;
        const int cdy = bestLink->fromCell.y - fromCell.y;
        const int cdz = bestLink->fromCell.z - fromCell.z;
        const int adx = std::abs(cdx);
        const int ady = std::abs(cdy);
        const int adz = std::abs(cdz);
        if (adx >= ady && adx >= adz && adx > 0) {
            step.dir = (cdx > 0) ? 1 : 0; // +X or -X
        } else if (ady >= adz && ady > 0) {
            step.dir = (cdy > 0) ? 3 : 2; // +Y or -Y
        } else if (adz > 0) {
            step.dir = (cdz > 0) ? 5 : 4; // +Z or -Z
        } else {
            step.dir = kFlowArrived;
        }
    }
    step.crossFloor = false;
    step.targetFloor = fromFloor;
    step.transitCell = bestLink->fromCell;
    step.transitKind = bestLink->kind;
    return step;
}

namespace {
inline float sector_distance_from_center(int sx, int sy) {
    const int cx = sector_coord_x(sx);
    const int cy = sector_coord_y(sy);
    const float dx = static_cast<float>(cx - 256) * 2.0f;
    const float dy = static_cast<float>(cy - 256) * 2.0f;
    return std::sqrt(dx * dx + dy * dy);
}

inline float sector_fuzzy_decay(float dist) {
    if (dist <= 400.0f) return 0.0f;
    constexpr float span = 512.0f - 400.0f;
    const float t = (dist - 400.0f) / span;
    return std::clamp(t, 0.0f, 1.0f);
}
} // namespace

MultiFloorQueryResult query_multi_floor_path(int fromFloor, ivec3 fromCell,
                                            int toFloor, ivec3 toCell,
                                            const std::vector<int>& floorNumbers,
                                            const std::vector<CoarseGraph>& coarseGraphs,
                                            const std::vector<VerticalWaypointLink>& allLinks) {
    (void)coarseGraphs;
    MultiFloorQueryResult result;
    if (floorNumbers.empty()) {
        return result;
    }

    auto floorIndex = [&](int f) -> int {
        for (std::size_t i = 0; i < floorNumbers.size(); ++i) {
            if (floorNumbers[i] == f) return static_cast<int>(i);
        }
        return -1;
    };

    const int sIdx = floorIndex(fromFloor);
    const int tIdx = floorIndex(toFloor);
    if (sIdx < 0 || tIdx < 0) return result;

    if (fromFloor == toFloor) {
        result.reachable = true;
        const int dx = std::abs(fromCell.x - toCell.x);
        const int dy = std::abs(fromCell.y - toCell.y);
        const int dz = std::abs(fromCell.z - toCell.z);
        result.totalDist = static_cast<std::uint32_t>(dx + dy + dz);
        result.floorHops.push_back(fromFloor);
        return result;
    }

    const std::size_t numFloors = floorNumbers.size();
    constexpr std::size_t kNodesPerFloor = static_cast<std::size_t>(kSectorsPerFloor); // 1024
    const std::size_t totalStates = numFloors * kNodesPerFloor;

    const int startSx = sector_axis_of_x(fromCell.x);
    const int startSy = sector_axis_of_y(fromCell.y);
    const int startNode = sector_node_id(startSx, startSy);

    const int targetSx = sector_axis_of_x(toCell.x);
    const int targetSy = sector_axis_of_y(toCell.y);
    const int targetNode = sector_node_id(targetSx, targetSy);

    const std::size_t startState = static_cast<std::size_t>(sIdx) * kNodesPerFloor + static_cast<std::size_t>(startNode);
    const std::size_t targetState = static_cast<std::size_t>(tIdx) * kNodesPerFloor + static_cast<std::size_t>(targetNode);

    // Pre-bucket vertical links by (floorIndex, fromSectorNode) for O(1) adjacency lookup in Dijkstra
    std::vector<std::vector<int>> linksByState(totalStates);
    for (std::size_t li = 0; li < allLinks.size(); ++li) {
        const auto& link = allLinks[li];
        const int srcFIdx = floorIndex(link.fromFloor);
        if (srcFIdx < 0) continue;
        const int linkSx = sector_axis_of_x(link.fromCell.x);
        const int linkSy = sector_axis_of_y(link.fromCell.y);
        const int linkNode = sector_node_id(linkSx, linkSy);
        const std::size_t st = static_cast<std::size_t>(srcFIdx) * kNodesPerFloor + static_cast<std::size_t>(linkNode);
        if (st < totalStates) {
            linksByState[st].push_back(static_cast<int>(li));
        }
    }

    std::vector<std::uint32_t> dist(totalStates, 0xFFFFFFFFu);
    std::vector<int> prev(totalStates, -1);
    std::vector<int> prevLink(totalStates, -1);

    dist[startState] = 0;

    // Min-heap Priority Queue for Dijkstra across 100-floor stack (up to 102,400 states)
    using PQEntry = std::pair<std::uint32_t, std::uint32_t>; // (dist, state)
    std::priority_queue<PQEntry, std::vector<PQEntry>, std::greater<PQEntry>> pq;
    pq.push({0u, static_cast<std::uint32_t>(startState)});

    while (!pq.empty()) {
        const auto [d, u] = pq.top();
        pq.pop();

        if (d > dist[u]) continue;
        if (u == targetState) break;

        const int fIdx = static_cast<int>(u / kNodesPerFloor);
        const int uNode = static_cast<int>(u % kNodesPerFloor);

        // 1. Planar 4-neighbor transitions within the same floor slice
        for (int dir = 0; dir < 4; ++dir) {
            const int vNode = sector_neighbor(uNode, dir);
            if (vNode < 0) continue;

            const int vx = vNode % kSectorDimX;
            const int vy = vNode / kSectorDimX;
            const float vDist = sector_distance_from_center(vx, vy);
            if (vDist >= 505.0f) continue; // Solid outer monolithic concrete wall

            std::uint32_t kStepCost = static_cast<std::uint32_t>(kSectorCellSize); // 16 cells per sector
            if (vDist > 400.0f) {
                const float decay = sector_fuzzy_decay(vDist);
                kStepCost += static_cast<std::uint32_t>(decay * 32.0f);
            }

            const std::size_t vState = static_cast<std::size_t>(fIdx) * kNodesPerFloor + static_cast<std::size_t>(vNode);
            if (dist[u] + kStepCost < dist[vState]) {
                dist[vState] = dist[u] + kStepCost;
                prev[vState] = static_cast<int>(u);
                prevLink[vState] = -1; // Intra-floor step
                pq.push({dist[vState], static_cast<std::uint32_t>(vState)});
            }
        }

        // 2. Vertical transit transitions via ElevatorShaft, Stairwell, Ladder, GravityChute
        for (int li : linksByState[u]) {
            const auto& link = allLinks[static_cast<std::size_t>(li)];
            const int dstFIdx = floorIndex(link.toFloor);
            if (dstFIdx < 0) continue;

            const int dstSx = sector_axis_of_x(link.toCell.x);
            const int dstSy = sector_axis_of_y(link.toCell.y);
            const int dstNode = sector_node_id(dstSx, dstSy);
            const std::size_t vState = static_cast<std::size_t>(dstFIdx) * kNodesPerFloor + static_cast<std::size_t>(dstNode);

            const std::uint32_t cost = dist[u] + static_cast<std::uint32_t>(link.cost);
            if (cost < dist[vState]) {
                dist[vState] = cost;
                prev[vState] = static_cast<int>(u);
                prevLink[vState] = li;
                pq.push({cost, static_cast<std::uint32_t>(vState)});
            }
        }
    }

    if (dist[targetState] == 0xFFFFFFFFu) return result;

    result.reachable = true;
    result.totalDist = dist[targetState];

    int curr = static_cast<int>(targetState);
    std::vector<int> pathStates;
    std::vector<int> pathLinks;
    while (curr >= 0) {
        pathStates.push_back(curr);
        pathLinks.push_back(prevLink[static_cast<std::size_t>(curr)]);
        curr = prev[static_cast<std::size_t>(curr)];
    }
    std::reverse(pathStates.begin(), pathStates.end());
    std::reverse(pathLinks.begin(), pathLinks.end());

    int lastFloor = -999999;
    for (int st : pathStates) {
        const int fl = floorNumbers[static_cast<std::size_t>(st / kNodesPerFloor)];
        if (fl != lastFloor) {
            result.floorHops.push_back(fl);
            lastFloor = fl;
        }
    }
    for (int lk : pathLinks) {
        if (lk >= 0 && static_cast<std::size_t>(lk) < allLinks.size()) {
            result.transitChain.push_back(allLinks[static_cast<std::size_t>(lk)]);
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// AsyncMultiFloorPathQuery
// ---------------------------------------------------------------------------

AsyncMultiFloorPathQuery::~AsyncMultiFloorPathQuery() {
    cancel();
}

AsyncMultiFloorPathQuery::AsyncMultiFloorPathQuery(AsyncMultiFloorPathQuery&& other) noexcept {
    other.cancel();
    busy_ = false;
    ready_ = false;
    result_ = std::move(other.result_);
}

AsyncMultiFloorPathQuery& AsyncMultiFloorPathQuery::operator=(AsyncMultiFloorPathQuery&& other) noexcept {
    if (this != &other) {
        cancel();
        other.cancel();
        busy_ = false;
        ready_ = false;
        result_ = std::move(other.result_);
    }
    return *this;
}

void AsyncMultiFloorPathQuery::join_worker() {
    if (worker_.joinable()) {
        worker_.join();
    }
}

void AsyncMultiFloorPathQuery::cancel() {
    join_worker();
    busy_ = false;
    ready_ = false;
}

void AsyncMultiFloorPathQuery::start(int fromFloor, ivec3 fromCell, int toFloor, ivec3 toCell,
                                     std::vector<int> floorNumbers,
                                     std::vector<CoarseGraph> coarseGraphs,
                                     std::vector<VerticalWaypointLink> allLinks) {
    join_worker();
    busy_ = true;
    ready_ = false;
    result_ = MultiFloorQueryResult{};

    worker_ = std::thread([this, fromFloor, fromCell, toFloor, toCell,
                           fNums = std::move(floorNumbers),
                           cGraphs = std::move(coarseGraphs),
                           vLinks = std::move(allLinks)]() {
        MultiFloorQueryResult res = query_multi_floor_path(fromFloor, fromCell, toFloor, toCell,
                                                           fNums, cGraphs, vLinks);
        this->result_ = std::move(res);
        this->ready_ = true;
        this->busy_ = false;
    });
}

bool AsyncMultiFloorPathQuery::poll(MultiFloorQueryResult& outResult) {
    if (!ready_) return false;
    join_worker();
    outResult = std::move(result_);
    ready_ = false;
    busy_ = false;
    return true;
}

} // namespace giga::nav

