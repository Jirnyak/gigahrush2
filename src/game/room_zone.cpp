#include "game/room_zone.h"

#include <cstddef>

#include "core/jobs.h"        // parallel_for — bake-time only, one job per room bit
#include "core/rng.h"         // hash2/hash3 — the seat is a hash, not stored state
#include "game/needs.h"       // kNeedMax — one clamp band for every needs writer
#include "world/macro_grid.h" // MacroGrid — the bake's walkability test
#include "world/types.h"      // kMacroDim, kMacroCells, macro_index, wrap_macro

namespace giga::game {

namespace {

// Walkability, IDENTICAL to `nav::bake_fine`'s: a macro cell is traversable unless
// it is FULLY solid. Not "similar to" — the same predicate, because a body steered
// by a room field and a body steered by the nav flow field must agree about what a
// wall is, or one of the two walks into geometry the other routes around.
inline bool blocked(const MacroGrid& g, int x, int y, int z) {
    return g.mask(x, y, z).full();
}

// Salt for the seat hash. Its own stream, so a body's seat is uncorrelated with its
// re-plan phase, its score jitter and worldgen.
inline constexpr std::uint32_t kSaltSeat = 0x5ea70000u;

} // namespace

// ---------------------------------------------------------------------------
// Recovery — table reads, no branches on room kind.
// ---------------------------------------------------------------------------

bool room_restores(std::uint16_t bit) {
    const int i = floor_room_bit_index(bit);
    if (i < 0) return false;
    const RoomRecovery& r = kRoomRecovery[i];
    return r.food != 0.0f || r.water != 0.0f || r.sleep != 0.0f ||
           r.pee != 0.0f || r.poo != 0.0f || r.pendingPee != 0.0f ||
           r.pendingPoo != 0.0f;
}

void room_recover(Needs& n, std::uint16_t bit, float dt) {
    if (dt <= 0.0f) return;
    const int i = floor_room_bit_index(bit);
    if (i < 0) return;
    const RoomRecovery& r = kRoomRecovery[i];

    // Local clamp rather than a call into needs.cpp's file-static: the band is the
    // same [0, kNeedMax] and it is stated once, here, for this file's five writers.
    const auto add = [](float& v, float d) {
        v += d;
        if (v < 0.0f) v = 0.0f;
        if (v > kNeedMax) v = kNeedMax;
    };

    add(n.food, r.food * dt);
    add(n.water, r.water * dt);
    add(n.sleep, r.sleep * dt);
    add(n.pee, -r.pee * dt);
    add(n.poo, -r.poo * dt);
    // The queues are NOT clamped to kNeedMax: they are a backlog, and `digest`
    // meters them out ([needs.h]). Clamping them here would silently forgive the
    // consequence of eating, which is the whole point of the kitchen row.
    n.pendingPee += r.pendingPee * dt;
    n.pendingPoo += r.pendingPoo * dt;
}

// ---------------------------------------------------------------------------
// Where the rooms are.
// ---------------------------------------------------------------------------

std::uint16_t room_bit_at(FloorKind kind, int number, int x, int y) {
    const int stride = floor_room_stride(kind);
    const int wx = wrap_macro(x);
    const int wy = wrap_macro(y);
    // A wall line belongs to no room. Without this a body in the corridor OUTSIDE
    // a kitchen reads as standing in it, and both the arrival test and the recovery
    // would fire one cell early on every axis.
    if (wx % stride == 0 || wy % stride == 0) return 0;
    return floor_room_mask(kind, number, wx / stride, wy / stride);
}

void room_seat_offset(std::uint32_t idSeed, int rx, int ry, int stride, int& ox,
                      int& oy) {
    const int span = stride - 1; // interior width: offsets 1..stride-1
    if (span <= 0) {
        ox = 0;
        oy = 0;
        return;
    }
    const std::uint32_t h = hash3(idSeed ^ kSaltSeat,
                                  static_cast<std::uint32_t>(rx),
                                  static_cast<std::uint32_t>(ry));
    ox = 1 + static_cast<int>(h % static_cast<std::uint32_t>(span));
    oy = 1 + static_cast<int>((h >> 16) % static_cast<std::uint32_t>(span));
}

std::size_t RoomZones::resident_bytes() const {
    std::size_t n = 0;
    for (std::size_t i = 0; i < kFloorRoomBits; ++i) {
        n += flow[i].capacity();
        n += nearRoom[i].capacity() * sizeof(std::uint16_t);
    }
    return n;
}

// ---------------------------------------------------------------------------
// The bake.
// ---------------------------------------------------------------------------

namespace {

// Nearest room carrying the bit, for every room of the lattice. Brute force over
// (roomsPerAxis^2)^2 — 1,048,576 wrapped comparisons at stride 4, ~1 ms — because
// it is EXACT and a BFS over 1024 nodes would not be measurably faster while being
// one more thing to get wrong on a torus.
void bake_near(const std::uint8_t* present, int roomsPerAxis,
               std::vector<std::uint16_t>& out) {
    const int n = roomsPerAxis * roomsPerAxis;
    out.assign(static_cast<std::size_t>(n), 0u);
    for (int ry = 0; ry < roomsPerAxis; ++ry) {
        for (int rx = 0; rx < roomsPerAxis; ++rx) {
            int bestX = rx, bestY = ry, bestD = 1 << 30;
            for (int ty = 0; ty < roomsPerAxis; ++ty) {
                for (int tx = 0; tx < roomsPerAxis; ++tx) {
                    if (present[static_cast<std::size_t>(ty) * roomsPerAxis + tx] ==
                        0)
                        continue;
                    // Toroidal on both axes: the room lattice wraps because the
                    // world does ([AGENTS.md] "x/y/z wrap"). Squared distance, so
                    // no sqrt and no tie-break drift from rounding.
                    const int dx = wrapi(tx - rx + roomsPerAxis / 2, roomsPerAxis) -
                                   roomsPerAxis / 2;
                    const int dy = wrapi(ty - ry + roomsPerAxis / 2, roomsPerAxis) -
                                   roomsPerAxis / 2;
                    const int d = dx * dx + dy * dy;
                    if (d < bestD) {
                        bestD = d;
                        bestX = tx;
                        bestY = ty;
                    }
                }
            }
            out[static_cast<std::size_t>(ry) * roomsPerAxis + rx] =
                static_cast<std::uint16_t>(bestX | (bestY << 8));
        }
    }
}

// One bit's flow field: a multi-source wrapped BFS seeded from EVERY walkable cell
// of that room kind at once. Same loop as `nav::bake_fine_node` with a seed SET
// instead of a seed cell — which is exactly why the flow byte convention is shared
// rather than re-invented.
void bake_flow(const MacroGrid& g, FloorKind kind, int number, std::uint16_t bit,
               int stride, std::vector<std::uint8_t>& out) {
    out.assign(kMacroCells, nav::kFlowNone);
    std::vector<int> q;
    q.reserve(1u << 18);

    const int W = kMacroDim;
    for (int z = 0; z < W; ++z) {
        for (int y = 0; y < W; ++y) {
            if (y % stride == 0) continue; // wall line: no room
            for (int x = 0; x < W; ++x) {
                if (x % stride == 0) continue;
                if (floor_room_mask(kind, number, x / stride, y / stride) != bit)
                    continue;
                if (blocked(g, x, y, z)) continue;
                const std::size_t ci = macro_index(x, y, z);
                out[ci] = nav::kFlowArrived;
                q.push_back(static_cast<int>(ci));
            }
        }
    }
    if (q.empty()) return;

    for (std::size_t head = 0; head < q.size(); ++head) {
        const int ci = q[head];
        const int cz = ci / (W * W);
        const int cy = (ci / W) % W;
        const int cx = ci % W;
        for (int d = 0; d < 6; ++d) {
            const int nx = wrap_macro(cx + nav::kNavDir[d][0]);
            const int ny = wrap_macro(cy + nav::kNavDir[d][1]);
            const int nz = wrap_macro(cz + nav::kNavDir[d][2]);
            const std::size_t ni = macro_index(nx, ny, nz);
            if (out[ni] != nav::kFlowNone) continue; // reached, or a seed
            if (blocked(g, nx, ny, nz)) continue;    // wall stays kFlowNone
            // We stepped cur -> nbr in dir d, so nbr routes back in dir (d ^ 1).
            out[ni] = static_cast<std::uint8_t>(d ^ 1);
            q.push_back(static_cast<int>(ni));
        }
    }
}

} // namespace

void bake_room_zones(const MacroGrid& grid, FloorKind kind, int number,
                     RoomZones& out) {
    // Clear FIRST. A recycled RoomZones that kept one field from the previous floor
    // would steer this floor's crowd by the last floor's kitchens — the exact class
    // of stale-bake bug [world/nav.h] documents for its own fields.
    for (std::size_t i = 0; i < kFloorRoomBits; ++i) {
        out.flow[i].clear();
        out.flow[i].shrink_to_fit();
        out.nearRoom[i].clear();
        out.nearRoom[i].shrink_to_fit();
    }
    out.kind = kind;
    out.number = number;
    out.baked = 0;

    const int stride = floor_room_stride(kind);
    if (stride <= 1) return;
    const int roomsPerAxis = kMacroDim / stride;
    const std::size_t roomCount =
        static_cast<std::size_t>(roomsPerAxis) * roomsPerAxis;

    // Which affordance bits this floor actually CONTAINS. A kind whose room mix
    // never rolls Kitchen ([floor_gen.cpp] kRoomsIndustrial) bakes no kitchen field
    // and costs nothing — the consumers then degrade to the pre-rooms behaviour on
    // their own, with no special case anywhere.
    // uint8, not vector<bool>: the per-bit slices are handed to workers as raw
    // pointers, and vector<bool> is a bitfield with no `data()` to hand out.
    std::vector<std::uint8_t> present(roomCount * kFloorRoomBits, 0u);
    std::uint16_t have = 0;
    for (int ry = 0; ry < roomsPerAxis; ++ry) {
        for (int rx = 0; rx < roomsPerAxis; ++rx) {
            const std::uint16_t m = floor_room_mask(kind, number, rx, ry);
            if ((m & kRoomFieldMask) == 0) continue;
            const int bi = floor_room_bit_index(m);
            if (bi < 0) continue;
            present[static_cast<std::size_t>(bi) * roomCount +
                    static_cast<std::size_t>(ry) * roomsPerAxis + rx] = 1u;
            have = static_cast<std::uint16_t>(have | m);
        }
    }
    if (have == 0) return;

    // One job per bit. Each writes only its own two vectors, so the bake is
    // race-free and bit-identical regardless of scheduling — the same per-slice
    // isolation `nav::bake_fine` relies on ([core/jobs.h] contract).
    parallel_for(static_cast<int>(kFloorRoomBits), [&](int bi) {
        const std::uint16_t bit = static_cast<std::uint16_t>(1u << bi);
        if ((have & bit) == 0) return;
        bake_flow(grid, kind, number, bit, stride, out.flow[bi]);
        bake_near(present.data() + static_cast<std::size_t>(bi) * roomCount,
                  roomsPerAxis, out.nearRoom[bi]);
    });
    out.baked = have;
}

// ---------------------------------------------------------------------------
// The tick query.
// ---------------------------------------------------------------------------

RoomRoute room_route(const RoomZones& z, std::uint16_t mask, int x, int y,
                     int z_) {
    RoomRoute out;
    const std::uint16_t want = static_cast<std::uint16_t>(mask & z.baked);
    if (want == 0) return out;

    const int stride = floor_room_stride(z.kind);
    if (stride <= 1) return out;
    const int roomsPerAxis = kMacroDim / stride;
    const std::size_t ci = macro_index(wrap_macro(x), wrap_macro(y), wrap_macro(z_));
    const int rx = wrap_macro(x) / stride;
    const int ry = wrap_macro(y) / stride;
    const std::size_t ri = static_cast<std::size_t>(ry) * roomsPerAxis + rx;

    // Bits in index order; an ARRIVED reading wins outright over any step, so a body
    // standing in one of two acceptable rooms never walks to the other.
    for (std::size_t bi = 0; bi < kFloorRoomBits; ++bi) {
        const std::uint16_t bit = static_cast<std::uint16_t>(1u << bi);
        if ((want & bit) == 0) continue;
        if (z.flow[bi].empty() || z.nearRoom[bi].size() <= ri) continue;
        const std::uint8_t f = z.flow[bi][ci];
        if (f == nav::kFlowNone) continue;

        const std::uint16_t packed = z.nearRoom[bi][ri];
        const int tx = static_cast<int>(packed & 0xFFu) * stride + stride / 2;
        const int ty = static_cast<int>((packed >> 8) & 0xFFu) * stride + stride / 2;

        if (f == nav::kFlowArrived) {
            out.bit = bit;
            out.dir = f;
            out.targetX = tx;
            out.targetY = ty;
            return out;
        }
        if (out.bit == 0) {
            out.bit = bit;
            out.dir = f;
            out.targetX = tx;
            out.targetY = ty;
        }
    }
    return out;
}

} // namespace giga::game
