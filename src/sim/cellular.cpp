#include "sim/cellular.h"

#include <algorithm>
#include <bit>     // std::countr_zero, std::popcount — the sweep's bit iteration
#include <cstring> // std::memcmp, std::memset — the group zero test and the row clear

#include "core/rng.h"         // hash2 / hash_u32 — the deterministic window placement
#include "world/lattice.h"    // lattice_coord, kLatticeSpacing — the columns to protect
#include "world/macro_grid.h" // MacroGrid, SubMask
#include "world/types.h"      // kMacroCells, kMacroDim, macro_index, wrap_macro

namespace giga {
namespace {

// Words in the walkability / writable bitsets: 2,097,152 bits = 32,768 uint64 = 256 KiB.
constexpr std::size_t kOpenWords = (kMacroCells + 63) / 64;

// Words in the hot-group bitset: one bit per 64-cell group. 512 uint64 = 4 KiB.
constexpr std::size_t kGroupWords = (kOpenWords + 63) / 64;

// Flat strides. x is contiguous, y is one row (128 B for a byte field), z is one plane
// (16 KiB), so a plane-ordered sweep keeps the three live z planes (48 KiB) inside L1/L2
// and the +-z probes are the only ones that travel.
constexpr std::size_t kRow = static_cast<std::size_t>(kMacroDim);
constexpr std::size_t kPlane = kRow * kRow;
constexpr std::size_t kSpan = kPlane * kRow;

// The wrap offsets below are derived from these three, so if the flat layout in
// world/types.h ever stops being x + y*N + z*N*N the sweep must not silently start
// spreading into the wrong cells.
static_assert(kSpan == kMacroCells,
              "macro_index must stay x + y*kMacroDim + z*kMacroDim^2");

// One 64-cell GROUP is one word of the walkability bitset, and the sweep is organised
// around it: kWordsPerRow groups tile a row exactly. That tiling is why the row-blocked
// loop may resolve each neighbour row's bitset word ONCE per row — every row, and every
// neighbour row, starts on a word boundary only because kMacroDim divides by 64.
constexpr std::size_t kWordsPerRow = kRow / 64;
static_assert(kRow % 64 == 0,
              "a row must be a whole number of bitset words: the sweep resolves the "
              "neighbour word pairs once per row, which needs every row (and every "
              "+-kRow / +-kPlane neighbour row) to start on a word boundary");
static_assert(kWordsPerRow * 64 == kRow, "kWordsPerRow tiles a row exactly");

// One bit per macro cell, indexed by the same flat macro_index the field uses.
inline bool bit_at(const std::uint64_t* words, std::size_t i) {
    return ((words[i >> 6] >> (i & 63)) & 1ull) != 0ull;
}
inline void bit_set(std::uint64_t* words, std::size_t i) {
    words[i >> 6] |= 1ull << (i & 63);
}
inline void bit_clear(std::uint64_t* words, std::size_t i) {
    words[i >> 6] &= ~(1ull << (i & 63));
}

// One group's worth of zero bytes, for the "is this group entirely 0" memcmp.
// memcmp rather than a value scan on purpose: it asks the BITWISE question in one call
// the compiler turns into eight 64-bit loads.
alignas(64) constexpr std::uint8_t kZeroGroup[64] = {};

// A cell participates unless it is FULLY solid — the same coarse walkability
// [world/nav.h] bakes against and [sim/physics.h] collides against. A wall holds no
// stress and passes no contagion. Nothing in the tree writes a PARTIAL mask today, so
// in practice this is air-vs-solid.
inline bool cell_open(const MacroGrid& g, int x, int y, int z) {
    return !g.mask(x, y, z).full();
}

// Clamp a window extent into [1, kMacroDim]. A zero-sized window would make `writable`
// empty and silently freeze every topology rule, which reads as "the feature is broken"
// rather than as "you asked for nothing".
inline int clamp_extent(int v) { return v < 1 ? 1 : (v > kMacroDim ? kMacroDim : v); }

// Is a cell inside the window? Offsets are wrapped, so a window may straddle the seam.
inline bool in_window(const CellularWindow& win, int x, int y, int z) {
    const int ox = wrapi(x - wrap_macro(win.x), kMacroDim);
    const int oy = wrapi(y - wrap_macro(win.y), kMacroDim);
    const int oz = wrapi(z - wrap_macro(win.z), kMacroDim);
    return ox < clamp_extent(win.w) && oy < clamp_extent(win.h) &&
           oz < clamp_extent(win.d);
}

// Is a coordinate within 1 cell of a lattice axis centre? Centres are
// {16, 48, 80, 112} at spacing 32, so "within 1" is the three-wide band around each,
// and the closed form below is the same statement without a loop over four values:
// x in {15,16,17, 47,48,49, ...} <=> (x + 32 - 16 + 1) mod 32 <= 2.
inline bool near_lattice_axis(int c) {
    return ((wrap_macro(c) + kLatticeSpacing - kLatticeHalf + 1) % kLatticeSpacing) <= 2;
}

// THE SAFETY PROPERTY, in one expression. The nav lattice is carved as a full-height
// shaft at each of the 16 distinct (x,y) node positions, and those shafts are what
// guarantee vertical connectivity on every floor kind ([master_prompt.md] §7 #11
// increment A). Excluding a 3x3 column around each, through all 128 z, costs
// 16 * 9 * 128 = 18,432 cells = 0.88% of the world and makes "a Life sweep walled up a
// lift shaft" structurally impossible rather than merely unlikely.
inline bool lattice_protected(int x, int y) {
    return near_lattice_axis(x) && near_lattice_axis(y);
}

// Squared toroidal cell distance against the keep-out sphere. Called only for a cell
// that would actually FLIP, so this is O(changes) and not O(cells).
inline bool in_keepout(const CellularParams& p, int x, int y, int z) {
    if (p.keepOutR < 0) return false;
    const int dx = wrap_delta(wrap_macro(p.keepOutX), x, kMacroDim);
    const int dy = wrap_delta(wrap_macro(p.keepOutY), y, kMacroDim);
    const int dz = wrap_delta(wrap_macro(p.keepOutZ), z, kMacroDim);
    return dx * dx + dy * dy + dz * dz <= p.keepOutR * p.keepOutR;
}

// The field name a params block resolves to. Empty means "the rule's own field", which
// is what stops "I ran Life over the stress field" from being a silent one-word bug.
inline const std::string& resolved_field(const CellularParams& p, std::string& scratch) {
    if (!p.field.empty()) return p.field;
    scratch = cellular_field_for(p.rule);
    return scratch;
}

// Per-sweep row geometry: the four out-of-row neighbour offsets and the row bases. All
// of it is loop-invariant along x, which is the entire reason the sweeps are row-blocked
// — the per-cell form recomputed six wrap conditionals, six bitset word addresses and
// six shifted bit tests for EVERY cell, and every one of those is a property of (y, z).
struct RowGeom {
    std::size_t i0;                 // flat index of (0, y, z)
    std::size_t ym, yp, zm, zp;     // signed-as-unsigned offsets to the neighbour rows
    std::size_t w0, wym, wyp, wzm, wzp; // their bitset word bases
};

inline RowGeom row_geom(int y, int z) {
    RowGeom g{};
    // ALL THREE axes wrap ([world.md]). Hoisted to the plane and the row, where the wrap
    // is a property of the coordinate rather than of the cell.
    g.zm = (z == 0) ? (kSpan - kPlane) : (std::size_t(0) - kPlane);
    g.zp = (z == kMacroDim - 1) ? (std::size_t(0) - (kSpan - kPlane)) : kPlane;
    g.ym = (y == 0) ? (kPlane - kRow) : (std::size_t(0) - kRow);
    g.yp = (y == kMacroDim - 1) ? (std::size_t(0) - (kPlane - kRow)) : kRow;
    g.i0 = macro_index(0, y, z);
    g.w0 = g.i0 >> 6;
    g.wym = (g.i0 + g.ym) >> 6;
    g.wyp = (g.i0 + g.yp) >> 6;
    g.wzm = (g.i0 + g.zm) >> 6;
    g.wzp = (g.i0 + g.zp) >> 6;
    return g;
}

// ---------------------------------------------------------------------------
// PASS 1 — which 64-cell groups hold anything at all, and the row gate over them.
// ---------------------------------------------------------------------------
//
// THE SKIP THIS BUYS, and its proof. Take a row whose own two groups are bitwise zero,
// and so are the two groups of each of its four out-of-plane neighbour rows (+-y, +-z).
// Then every cell in the row reads 0 from itself and from all of its neighbours in
// every neighbourhood any rule here uses — the 6 faces, and the 8 in-plane Moore
// neighbours, which for a 64-cell run live in exactly those same words because a row is
// only two words wide and the x neighbours of the run wrap within the row. So:
//   * Sandpile: h = 0 < topple, gain = 0, next = 0.
//   * Life:     alive = false, n = 0, B3/S23 gives dead = 0.
//   * Creep:    decayed = 0, no neighbour reaches spreadFrom, next = 0.
// Writing 0 over the whole row is therefore BIT-IDENTICAL to computing it, `total` is
// unchanged, `liveCells` is unchanged and `peak` is unchanged.
//
// WHY IT IS WORTH A WHOLE 2.00 MiB READ: a source-driven floor is almost entirely
// quiet, and both source-driven rules are LOCAL, so state never occupies more than the
// ball its deposits have had time to reach. There is no state in which a Sandpile or
// Creep field is uniformly hot for long, because both are strictly contracting. Life is
// the exception and the honest one — seeded from a real floor's geometry it is
// permanently saturated, which is what the cost block in the suite measures and prints.
//
// AND IT HAS NO INVALIDATION HAZARD, which is why it is a pass and not a cached set: it
// is derived from `src` inside the sweep that uses it, so unlike `open` there is no
// geometry-moved / floor-changed / deposit-behind-my-back case. Nothing can make it
// stale and cellular_add needs to know nothing about it.
void build_hot_groups(const std::uint8_t* src, std::uint64_t* hot) {
    std::memset(hot, 0, kGroupWords * sizeof(std::uint64_t));
    for (std::size_t g = 0; g < kOpenWords; ++g)
        if (std::memcmp(src + g * 64u, kZeroGroup, sizeof(kZeroGroup)) != 0)
            hot[g >> 6] |= 1ull << (g & 63);
}

inline bool group_hot(const std::uint64_t* hot, std::size_t g) {
    return ((hot[g >> 6] >> (g & 63)) & 1ull) != 0ull;
}

// The row gate: 10 bit tests (this row's two groups plus the two of each of the four
// neighbour rows). Deliberately the UNION of every rule's neighbourhood rather than one
// gate per rule — a superset can only ever refuse to skip, never skip wrongly, and one
// gate is one proof to check instead of three.
inline bool row_hot(const std::uint64_t* hot, const RowGeom& g) {
    for (std::size_t k = 0; k < kWordsPerRow; ++k)
        if (group_hot(hot, g.w0 + k) || group_hot(hot, g.wym + k) ||
            group_hot(hot, g.wyp + k) || group_hot(hot, g.wzm + k) ||
            group_hot(hot, g.wzp + k))
            return true;
    return false;
}

// Running totals every sweep reports. Kept in one struct so the three sweeps below share
// the accounting instead of each growing its own copy of it.
struct Tally {
    std::uint64_t total = 0;
    std::uint32_t live = 0;
    std::uint32_t absorbed = 0;
    std::uint32_t born = 0;
    std::uint32_t died = 0;
    std::uint32_t changes = 0;
    std::uint8_t peak = 0;

    inline void account(std::uint8_t v) {
        total += v;
        if (v != 0u) {
            ++live;
            if (v > peak) peak = v;
        }
    }
};

// ---------------------------------------------------------------------------
// RULE 1 — the abelian sandpile (sandpile_perekrytie.ts, 3D and live)
// ---------------------------------------------------------------------------
void sweep_sandpile(World& world, CellularScratch& scratch, const CellularParams& params,
                    const std::uint8_t* __restrict src, std::uint8_t* __restrict dst,
                    Tally& t) {
    const std::uint64_t* __restrict open = scratch.open.data();
    const std::uint64_t* __restrict writable = scratch.writable.data();
    const std::uint64_t* __restrict hot = scratch.hotGroups.data();
    // CLAMPED, not rejected — the engine has no exceptions ([AGENTS.md]), the same
    // stance [sim/diffusion.cpp] takes on an unstable `rate`. The upper bound is where
    // the byte field stops being provably safe: a cell BELOW the threshold gains at most
    // 6 and is not debited, so the largest value the sweep can write is
    // (topple - 1) + 6, and that must stay <= 255. Hence topple <= 250. At 251..255 a
    // cell at 250 ringed by six cells at 251 computes 256 and wraps to 0 — grains
    // appearing from nowhere and the boundedness proof in [sim/cellular.h] false. The
    // shipping value is 6, where the bound is 11, so this only ever fires on a typo.
    const int topple = params.topple < 1 ? 1
                       : params.topple > 250 ? 250
                                             : static_cast<int>(params.topple);
    const int collapseAt = static_cast<int>(params.collapseAt);
    MacroGrid& grid = world.grid();

    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y) {
            const RowGeom g = row_geom(y, z);
            std::uint8_t* __restrict rd = dst + g.i0;
            if (!row_hot(hot, g)) {
                std::memset(rd, 0, kRow);
                continue;
            }
            const std::uint8_t* __restrict rs = src + g.i0;
            const std::uint8_t* __restrict rym = src + g.i0 + g.ym;
            const std::uint8_t* __restrict ryp = src + g.i0 + g.yp;
            const std::uint8_t* __restrict rzm = src + g.i0 + g.zm;
            const std::uint8_t* __restrict rzp = src + g.i0 + g.zp;

            for (std::size_t gi = 0; gi < kWordsPerRow; ++gi) {
                const std::uint64_t self = open[g.w0 + gi];
                const int xg = static_cast<int>(gi) * 64;
                // Zero the whole group up front — two stores — so the body never needs
                // an else-branch for a solid cell. A wall holds nothing.
                std::memset(rd + xg, 0, 64u);
                if (self == 0ull) {
                    // A wholly solid group. cellular_add refuses to put grains in rock,
                    // but tests and hand-written state can, and zeroing them silently
                    // would make the conservation identity false. Count them at the
                    // sink instead, so `total + absorbed` stays EXACT unconditionally.
                    // Costs nothing in practice: this branch is only entered when a
                    // fully solid group holds field data, which never happens through
                    // the sanctioned entry point.
                    if (group_hot(hot, g.w0 + gi))
                        for (int b = 0; b < 64; ++b) t.absorbed += rs[xg + b];
                    continue;
                }
                const std::uint64_t mym = open[g.wym + gi], myp = open[g.wyp + gi];
                const std::uint64_t mzm = open[g.wzm + gi], mzp = open[g.wzp + gi];

                // The two cells of each group whose x neighbour leaves the group: their
                // walkability bit lives in another word and their index may wrap the
                // row, so they take the general path. 2 of 64 cells.
                const auto cell = [&](int x, int b, bool edge) {
                    const std::size_t i = g.i0 + static_cast<std::size_t>(x);
                    // A SOLID cell holds nothing and exchanges nothing. Reachable ONLY
                    // on the `edge` path: bits 1..62 come pre-filtered by the set-bit
                    // iteration below, so this costs nothing on 62 of every 64 cells.
                    //
                    // ITS ABSENCE WAS A REAL BUG, fixed 2026-07-29 and pinned by
                    // test_cellular_all's wall-at-a-group-edge block. Without it the two
                    // edge cells of every group — x in {0, 63, 64, 127} at kMacroDim 128
                    // — were swept even when solid, so a wall there GAINED a grain from
                    // each toppling open neighbour. That grain was then counted twice:
                    // once in `absorbed` (the neighbour shed it toward a solid face) and
                    // once in `total` (the wall stored it), so `total + absorbed` grew
                    // and the conservation identity this rule is judged by was false on
                    // every floor that has a wall at one of those four x values — which
                    // is all of them. [sim/diffusion.cpp]'s edge_cell always had the
                    // guard; this file lost it in transcription.
                    if (edge && !bit_at(open, i)) return; // the group memset wrote its 0
                    const int h = rs[x];
                    int openN = 0;
                    int gain = 0;
                    // -x / +x. Inside the group these are register-only bit tests; at
                    // the two edges they are a flat-index probe that wraps the row.
                    if (edge) {
                        const int xm = (x == 0) ? (kMacroDim - 1) : (x - 1);
                        const int xp = (x == kMacroDim - 1) ? 0 : (x + 1);
                        if (bit_at(open, g.i0 + static_cast<std::size_t>(xm))) {
                            ++openN;
                            if (rs[xm] >= topple) ++gain;
                        }
                        if (bit_at(open, g.i0 + static_cast<std::size_t>(xp))) {
                            ++openN;
                            if (rs[xp] >= topple) ++gain;
                        }
                    } else {
                        if ((self >> (b - 1)) & 1ull) {
                            ++openN;
                            if (rs[x - 1] >= topple) ++gain;
                        }
                        if ((self >> (b + 1)) & 1ull) {
                            ++openN;
                            if (rs[x + 1] >= topple) ++gain;
                        }
                    }
                    if (edge ? bit_at(open, i + g.ym) : ((mym >> b) & 1ull)) {
                        ++openN;
                        if (rym[x] >= topple) ++gain;
                    }
                    if (edge ? bit_at(open, i + g.yp) : ((myp >> b) & 1ull)) {
                        ++openN;
                        if (ryp[x] >= topple) ++gain;
                    }
                    if (edge ? bit_at(open, i + g.zm) : ((mzm >> b) & 1ull)) {
                        ++openN;
                        if (rzm[x] >= topple) ++gain;
                    }
                    if (edge ? bit_at(open, i + g.zp) : ((mzp >> b) & 1ull)) {
                        ++openN;
                        if (rzp[x] >= topple) ++gain;
                    }

                    // THE RULE. A cell at or above the threshold sheds exactly `topple`
                    // grains, one per face, and gains one per toppling OPEN neighbour.
                    // Synchronous and therefore order-independent, which is what makes
                    // the abelian property usable in a double-buffered sweep.
                    const bool topples = h >= topple;
                    int next = h + gain - (topples ? topple : 0);
                    // THE ONE SINK. A grain shed toward a solid face is absorbed by the
                    // concrete. 6 - openN is exactly the number of solid faces, so
                    // `total + absorbed` is conserved to the grain — the identity
                    // test_cellular_all asserts.
                    if (topples) t.absorbed += static_cast<std::uint32_t>(6 - openN);

                    // COLLAPSE. sandpile_perekrytie.ts turns a FLOOR cell into ABYSS;
                    // in 3D the equivalent is clearing the SOLID cell below, which
                    // opens a real hole to the storey below instead of a flat texture
                    // swap. Discharges only when a slab was actually removed, so the
                    // sink stays tied to an observable event.
                    if (collapseAt > 0 && next >= collapseAt) {
                        const std::size_t below = i + g.zm;
                        const int zb = wrap_macro(z - 1);
                        if (!bit_at(open, below) && bit_at(writable, below) &&
                            !in_keepout(params, x, y, zb)) {
                            grid.clear_cell(x, y, zb);
                            ++t.changes;
                            t.absorbed += static_cast<std::uint32_t>(next);
                            next = 0;
                            // The mutated cell is NOT the deciding cell, so patching its
                            // walkability bit here would make the sweep's result depend
                            // on traversal order. Defer to a full rebuild on the next
                            // sweep instead: a collapse needs stress >= collapseAt and
                            // is one-way, so it is rare enough to pay for.
                            scratch.geomDirty = true;
                        }
                    }
                    const std::uint8_t out = static_cast<std::uint8_t>(next);
                    rd[x] = out;
                    t.account(out);
                };

                cell(xg, 0, true); // x order: bit 0, then bits 1..62, then bit 63
                std::uint64_t m = self & 0x7FFFFFFFFFFFFFFEull;
                while (m != 0ull) {
                    const int b = std::countr_zero(m);
                    m &= m - 1ull;
                    cell(xg + b, b, false);
                }
                cell(xg + 63, 63, true);
            }
        }
}

// ---------------------------------------------------------------------------
// RULE 2 — Conway B3/S23 per horizontal storey (conway_life.ts, verbatim rule)
// ---------------------------------------------------------------------------
//
// The transition is `n == 3 || (alive && n == 2)`, which is the reference's
// `nextLifeCell` character for character. The neighbourhood is the 8 in-plane Moore
// neighbours, toroidal in x and y, with NO z coupling — one storey is one plane, and
// a plane is what the reference's whole world is.
//
// Neighbour counting uses the standard separable trick: per row build a 3-wide column
// sum c[x] = a[x-1] + a[x] + a[x+1], then n = c_ym[x] + c_y[x] + c_yp[x] - a_y[x]. That
// is 6 adds per cell for the three sums plus 3 adds and a subtract, against 8 wrapped
// loads and 8 adds for the naive form, and it needs 6 * 128 = 768 bytes of stack and no
// allocation at all.
void sweep_life(World& world, CellularScratch& scratch, const CellularParams& params,
                const std::uint8_t* __restrict src, std::uint8_t* __restrict dst,
                Tally& t) {
    std::uint64_t* __restrict open = scratch.open.data();
    const std::uint64_t* __restrict writable = scratch.writable.data();
    const std::uint64_t* __restrict hot = scratch.hotGroups.data();
    MacroGrid& grid = world.grid();

    std::uint8_t aym[kRow], ay[kRow], ayp[kRow];
    std::uint8_t cym[kRow], cy[kRow], cyp[kRow];

    const auto build = [](const std::uint8_t* row, std::uint8_t* a, std::uint8_t* c) {
        for (int x = 0; x < kMacroDim; ++x) a[x] = row[x] != 0u ? 1u : 0u;
        // Second loop, not fused: c[0] reads a[127], so the whole of `a` must exist
        // before any of `c` is written.
        for (int x = 0; x < kMacroDim; ++x) {
            const int xm = (x == 0) ? (kMacroDim - 1) : (x - 1);
            const int xp = (x == kMacroDim - 1) ? 0 : (x + 1);
            c[x] = static_cast<std::uint8_t>(a[xm] + a[x] + a[xp]);
        }
    };

    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y) {
            const RowGeom g = row_geom(y, z);
            std::uint8_t* __restrict rd = dst + g.i0;
            if (!row_hot(hot, g)) {
                // Every cell in the row and both of its in-plane neighbour rows is 0,
                // so every cell here is dead with 0 live neighbours -> dead. Frozen
                // cells hold 0, which is what they already were.
                std::memset(rd, 0, kRow);
                continue;
            }
            build(src + g.i0 + g.ym, aym, cym);
            build(src + g.i0, ay, cy);
            build(src + g.i0 + g.yp, ayp, cyp);

            for (int x = 0; x < kMacroDim; ++x) {
                const std::size_t i = g.i0 + static_cast<std::size_t>(x);
                const bool alive = ay[x] != 0u;
                if (!bit_at(writable, i)) {
                    // FROZEN. Outside the writable region a cell is not simulated but it
                    // still COUNTS as a neighbour, exactly as conway_life.ts's mask cells
                    // do — that is what makes a real wall a permanent live neighbour and
                    // gives the automaton an edge to grow against instead of a void.
                    const std::uint8_t out = alive ? 1u : 0u;
                    rd[x] = out;
                    t.account(out);
                    continue;
                }
                const int n = static_cast<int>(cym[x]) + static_cast<int>(cy[x]) +
                              static_cast<int>(cyp[x]) - static_cast<int>(ay[x]);
                bool next = (n == 3) || (alive && n == 2);

                if (params.topology) {
                    const bool isSolid = !bit_at(open, i);
                    if (next != isSolid) {
                        if (in_keepout(params, x, y, z)) {
                            // Hold at the grid's current solidity rather than at the
                            // rule's answer, so the field and the world cannot drift
                            // apart inside the protected sphere. conway_life.ts and
                            // living_tunnels.ts both protect a radius around the player
                            // for the same reason: an automaton must not be able to wall
                            // a body in or drop the floor out from under it.
                            next = isSolid;
                        } else {
                            if (next) {
                                grid.fill_cell(x, y, z, params.material);
                                bit_clear(open, i);
                            } else {
                                grid.clear_cell(x, y, z);
                                bit_set(open, i);
                            }
                            ++t.changes;
                            // Patching THIS cell's own bit is order-independent: every
                            // decision above comes from `src`, which nothing mutates,
                            // and no other cell reads this bit. (Sandpile's collapse
                            // cannot do the same because it mutates a DIFFERENT cell —
                            // see the deferred rebuild there.)
                        }
                    }
                }
                if (next && !alive) ++t.born;
                if (!next && alive) ++t.died;
                const std::uint8_t out = next ? 1u : 0u;
                rd[x] = out;
                t.account(out);
            }
        }
}

// ---------------------------------------------------------------------------
// RULE 3 — bounded contact contagion (cell_hazards.ts + danger_field.ts's fade)
// ---------------------------------------------------------------------------
//
// next = max(h - decay, max over open neighbours n of (src[n] >= spreadFrom ?
//            src[n] - spreadDrop : 0)).
//
// Deliberately NOT a diffusion. [sim/diffusion.h] averages, so its front arrives at a
// doorway at a fraction of source strength and a consumer cannot tell "far from a big
// source" from "close to a small one". This is monotone max-plus: the front advances
// exactly one cell per sweep at (source - spreadDrop * distance), so the profile is a
// legible staircase with a hard radius of source/spreadDrop cells, and a doorway passes
// the hazard through at full local strength.
//
// BOUNDED, provably and in two senses. Let M be the field's largest value. The cell
// holding M writes max(M - decay, M - spreadDrop) and no other cell can exceed that, so
// the peak falls by exactly min(decay, spreadDrop) every sweep. With the defaults that
// is 2, so a 255 source is gone in 128 sweeps (25.6 s at 5/s) and NOTHING can grow. A
// decay of 0 makes the hazard permanent in TIME but still bounded in VALUE, because a
// max of existing values minus a non-negative drop can never exceed the current peak.
void sweep_creep(CellularScratch& scratch, const CellularParams& params,
                 const std::uint8_t* __restrict src, std::uint8_t* __restrict dst,
                 Tally& t) {
    const std::uint64_t* __restrict open = scratch.open.data();
    const std::uint64_t* __restrict hot = scratch.hotGroups.data();
    const int decay = static_cast<int>(params.decay);
    const int from = params.spreadFrom < 1 ? 1 : static_cast<int>(params.spreadFrom);
    const int drop = static_cast<int>(params.spreadDrop);

    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y) {
            const RowGeom g = row_geom(y, z);
            std::uint8_t* __restrict rd = dst + g.i0;
            if (!row_hot(hot, g)) {
                std::memset(rd, 0, kRow);
                continue;
            }
            const std::uint8_t* __restrict rs = src + g.i0;
            const std::uint8_t* __restrict rym = src + g.i0 + g.ym;
            const std::uint8_t* __restrict ryp = src + g.i0 + g.yp;
            const std::uint8_t* __restrict rzm = src + g.i0 + g.zm;
            const std::uint8_t* __restrict rzp = src + g.i0 + g.zp;

            for (std::size_t gi = 0; gi < kWordsPerRow; ++gi) {
                const std::uint64_t self = open[g.w0 + gi];
                const int xg = static_cast<int>(gi) * 64;
                std::memset(rd + xg, 0, 64u);
                if (self == 0ull) continue; // a wall holds no hazard
                const std::uint64_t mym = open[g.wym + gi], myp = open[g.wyp + gi];
                const std::uint64_t mzm = open[g.wzm + gi], mzp = open[g.wzp + gi];

                const auto cell = [&](int x, int b, bool edge) {
                    const std::size_t i = g.i0 + static_cast<std::size_t>(x);
                    // The same missing guard as sweep_sandpile's, with a worse symptom:
                    // an unguarded solid edge cell ACCEPTS the infection (its `offer`
                    // loop reads its open neighbours) and stores it, so a creep front hit
                    // a wall at x in {0, 63, 64, 127} and appeared inside it. It could
                    // not leak back out — an open cell only offers to open neighbours —
                    // but a consumer reading "is this cell hazardous" got yes for solid
                    // concrete, and `liveCells` counted it, so the quiet gate stayed
                    // armed forever on a front pressed against such a wall.
                    if (edge && !bit_at(open, i)) return; // a wall holds no hazard
                    const int h = rs[x];
                    int best = h > decay ? (h - decay) : 0;
                    const auto offer = [&](int v) {
                        if (v >= from) {
                            const int cand = v > drop ? (v - drop) : 0;
                            if (cand > best) best = cand;
                        }
                    };
                    if (edge) {
                        const int xm = (x == 0) ? (kMacroDim - 1) : (x - 1);
                        const int xp = (x == kMacroDim - 1) ? 0 : (x + 1);
                        if (bit_at(open, g.i0 + static_cast<std::size_t>(xm)))
                            offer(rs[xm]);
                        if (bit_at(open, g.i0 + static_cast<std::size_t>(xp)))
                            offer(rs[xp]);
                        if (bit_at(open, i + g.ym)) offer(rym[x]);
                        if (bit_at(open, i + g.yp)) offer(ryp[x]);
                        if (bit_at(open, i + g.zm)) offer(rzm[x]);
                        if (bit_at(open, i + g.zp)) offer(rzp[x]);
                    } else {
                        if ((self >> (b - 1)) & 1ull) offer(rs[x - 1]);
                        if ((self >> (b + 1)) & 1ull) offer(rs[x + 1]);
                        if ((mym >> b) & 1ull) offer(rym[x]);
                        if ((myp >> b) & 1ull) offer(ryp[x]);
                        if ((mzm >> b) & 1ull) offer(rzm[x]);
                        if ((mzp >> b) & 1ull) offer(rzp[x]);
                    }
                    const std::uint8_t out = static_cast<std::uint8_t>(best);
                    rd[x] = out;
                    t.account(out);
                };

                cell(xg, 0, true);
                std::uint64_t m = self & 0x7FFFFFFFFFFFFFFEull;
                while (m != 0ull) {
                    const int b = std::countr_zero(m);
                    m &= m - 1ull;
                    cell(xg + b, b, false);
                }
                cell(xg + 63, 63, true);
            }
        }
}

} // namespace

// ---------------------------------------------------------------------------
// Geometry bitsets
// ---------------------------------------------------------------------------

void cellular_refresh_geometry(const MacroGrid& grid, CellularScratch& scratch,
                               const CellularWindow& window) {
    // assign() rather than resize() so a rebuild starts from all-clear and cannot
    // inherit stale bits from the previous floor's geometry or the previous window.
    scratch.open.assign(kOpenWords, 0ull);
    scratch.writable.assign(kOpenWords, 0ull);
    std::uint64_t* op = scratch.open.data();
    std::uint64_t* wr = scratch.writable.data();
    const bool whole = window.whole_world();

    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y) {
            // Hoisted out of the x loop: both are properties of (y, z) alone, and the
            // lattice test is what protects the nav shafts.
            const bool latY = near_lattice_axis(y);
            std::size_t i = macro_index(0, y, z); // x is the contiguous axis
            for (int x = 0; x < kMacroDim; ++x, ++i) {
                if (cell_open(grid, x, y, z)) bit_set(op, i);
                if (latY && near_lattice_axis(x)) continue; // a nav shaft column
                if (whole || in_window(window, x, y, z)) bit_set(wr, i);
            }
        }
    scratch.geomDirty = false;
}

void cellular_mark_cell(const MacroGrid& grid, CellularScratch& scratch, int x, int y,
                        int z) {
    if (scratch.open.empty()) return; // nothing built yet — nothing to patch
    const int cx = wrap_macro(x), cy = wrap_macro(y), cz = wrap_macro(z);
    const std::size_t i = macro_index(cx, cy, cz);
    if (cell_open(grid, cx, cy, cz))
        bit_set(scratch.open.data(), i);
    else
        bit_clear(scratch.open.data(), i);
}

void cellular_on_floor_built(World& world, CellularScratch& scratch,
                             const CellularParams& params) {
    cellular_refresh_geometry(world.grid(), scratch, params.window);
    std::string owned;
    const std::string& name = resolved_field(params, owned);
    // NON-creating: a floor nobody has stressed must not acquire a 2.00 MiB field just
    // by being loaded. Field<T>::fill is a std::fill over the flat vector, so this is
    // one 2.00 MiB streaming write and no allocation.
    if (Field<std::uint8_t>* f = world.fields().find<std::uint8_t>(name))
        f->fill(std::uint8_t{0});
}

void cellular_seed_from_grid(World& world, CellularScratch& scratch,
                             const CellularParams& params) {
    if (!scratch.ready() || scratch.geomDirty)
        cellular_refresh_geometry(world.grid(), scratch, params.window);
    std::string owned;
    const std::string& name = resolved_field(params, owned);
    // CREATING, unlike every other entry point here: Life over an absent field is dead
    // everywhere and would never start, so "seed" means "make it exist and mirror the
    // world".
    Field<std::uint8_t>& f = world.fields().get_or_create<std::uint8_t>(name,
                                                                       std::uint8_t{0});
    std::uint8_t* d = f.data().data();
    const std::uint64_t* op = scratch.open.data();
    for (std::size_t i = 0; i < kMacroCells; ++i)
        d[i] = bit_at(op, i) ? std::uint8_t{0} : std::uint8_t{1};
}

// ---------------------------------------------------------------------------
// Deposits and reads
// ---------------------------------------------------------------------------

std::uint8_t cellular_add(World& world, int x, int y, int z, std::uint8_t amount,
                          const CellularParams& params) {
    const int cx = wrap_macro(x), cy = wrap_macro(y), cz = wrap_macro(z);
    // Refuse a source inside structure. The sweep pins solid cells to 0, so storing it
    // would report state this sweep that provably vanishes on the next one — and a
    // total that oscillates is worse than a source that honestly did not take.
    if (!cell_open(world.grid(), cx, cy, cz)) return 0u;

    std::string owned;
    const std::string& name = resolved_field(params, owned);
    Field<std::uint8_t>& f =
        world.fields().get_or_create<std::uint8_t>(name, std::uint8_t{0});
    std::uint8_t& cell = f.at(cx, cy, cz);
    const int sum = static_cast<int>(cell) + static_cast<int>(amount);
    cell = static_cast<std::uint8_t>(sum > 255 ? 255 : sum);
    return cell;
}

std::uint8_t cellular_at(const World& world, int x, int y, int z,
                         const CellularParams& params) {
    std::string owned;
    const std::string& name = resolved_field(params, owned);
    // The one const_cast. FieldRegistry::find is non-const only because it hands back a
    // mutable Field; nothing on this path writes one. [sim/fluid.cpp] does the same.
    const Field<std::uint8_t>* f =
        const_cast<World&>(world).fields().find<std::uint8_t>(name);
    return f ? f->at(x, y, z) : std::uint8_t{0};
}

bool cellular_pulse_active(const CellularParams& params, std::uint64_t sweep) {
    if (params.pulsePeriodSweeps == 0u) return true;
    const std::uint64_t phase = sweep % params.pulsePeriodSweeps;
    return phase < static_cast<std::uint64_t>(params.pulseActiveSweeps);
}

CellularWindow cellular_window_at(std::uint32_t seed, std::uint32_t token, int w, int h,
                                  int d) {
    CellularWindow win;
    win.w = clamp_extent(w);
    win.h = clamp_extent(h);
    win.d = clamp_extent(d);
    // Stateless (seed, token) hashing, the same primitive the macro tick and the AI
    // stagger use ([core/rng.h]): no stored RNG, and the same pair always yields the
    // same window on every host. The origin may be anywhere, including a position that
    // straddles the torus seam — in_window wraps, so that is a valid window and not an
    // edge case to avoid.
    win.x = static_cast<int>(hash2(seed, token) % static_cast<std::uint32_t>(kMacroDim));
    win.y = static_cast<int>(hash2(seed ^ 0x9e37u, token) %
                            static_cast<std::uint32_t>(kMacroDim));
    win.z = static_cast<int>(hash2(seed ^ 0x85ebu, token) %
                            static_cast<std::uint32_t>(kMacroDim));
    return win;
}

std::uint64_t cellular_digest(const World& world, const CellularParams& params) {
    std::string owned;
    const std::string& name = resolved_field(params, owned);
    const Field<std::uint8_t>* f =
        const_cast<World&>(world).fields().find<std::uint8_t>(name);
    if (f == nullptr) return 0u;
    // FNV-1a 64, in flat index order. Folded over the whole 2.00 MiB rather than a
    // sample, because the point is to catch a one-cell divergence and a sample cannot.
    std::uint64_t hv = 1469598103934665603ull;
    const std::uint8_t* d = f->data().data();
    for (std::size_t i = 0; i < kMacroCells; ++i) {
        hv ^= static_cast<std::uint64_t>(d[i]);
        hv *= 1099511628211ull;
    }
    return hv;
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

CellularStep cellular_step(World& world, CellularScratch& scratch,
                           const CellularParams& params) {
    CellularStep out;
    out.rule = params.rule;
    std::string owned;
    const std::string& name = resolved_field(params, owned);
    // NON-CREATING lookup, deliberately: a layer nobody has stressed pays one string
    // hash per sweep, not 2.00 MiB and 2,097,152 guaranteed-zero cells.
    Field<std::uint8_t>* fp = world.fields().find<std::uint8_t>(name);
    if (fp == nullptr) return out;
    out.present = true;
    Field<std::uint8_t>& f = *fp;

    // A geometry mutation between sweeps is answered here, once, rather than by every
    // caller remembering to rebuild: [game/door.cpp] opens and breaks doors on the tick,
    // and a bitset that missed that spreads a hazard through a shut door or holds it out
    // of an open one.
    if (!scratch.ready() || scratch.geomDirty)
        cellular_refresh_geometry(world.grid(), scratch, params.window);
    if (scratch.back.size() != kMacroCells) scratch.back.resize(kMacroCells);
    if (scratch.hotGroups.size() != kGroupWords) scratch.hotGroups.resize(kGroupWords);

    const std::uint8_t* __restrict src = f.data().data();
    std::uint8_t* __restrict dst = scratch.back.data();

    build_hot_groups(src, scratch.hotGroups.data());

    // The work counts, taken from the bitsets rather than incremented per cell so the
    // inner loops carry no dependency on them. They are the DENOMINATORS every ns/cell
    // figure divides by, and a test asserts them — never a wall-clock figure.
    std::size_t openSwept = 0, writableCount = 0;
    for (std::size_t g = 0; g < kOpenWords; ++g) {
        openSwept += static_cast<std::size_t>(std::popcount(scratch.open[g]));
        writableCount += static_cast<std::size_t>(std::popcount(scratch.writable[g]));
    }

    Tally t;
    switch (params.rule) {
        case CellularRule::Life: sweep_life(world, scratch, params, src, dst, t); break;
        case CellularRule::Creep: sweep_creep(scratch, params, src, dst, t); break;
        case CellularRule::Sandpile:
            sweep_sandpile(world, scratch, params, src, dst, t);
            break;
    }

    // Swap rather than copy: the old field data becomes next sweep's scratch, so the
    // 2.00 MiB pair is allocated once for the lifetime of the World.
    f.data().swap(scratch.back);
    out.total = t.total;
    out.liveCells = t.live;
    out.peak = t.peak;
    out.absorbed = t.absorbed;
    out.born = t.born;
    out.died = t.died;
    out.changes = t.changes;
    out.openCells = static_cast<std::uint32_t>(openSwept);
    out.writableCells = static_cast<std::uint32_t>(writableCount);
    return out;
}

CellularStep cellular_step(World& world, const CellularParams& params) {
    // One code path, so this cannot drift from the scratch form. The cost of the
    // convenience is stated in the header: a 2.00 MiB allocation and a full 128 MiB
    // bitset rebuild, both discarded when this returns.
    CellularScratch once;
    return cellular_step(world, once, params);
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

std::uint8_t cellular_driver_add(CellularDriver& driver, World& world, int x, int y,
                                 int z, std::uint8_t amount) {
    const std::uint8_t level = cellular_add(world, x, y, z, amount, driver.params);
    // A source refused inside rock stored nothing, so there is nothing to spread and
    // nothing to wake. Arming on it would pay a whole sweep to rediscover that the floor
    // is exactly as quiet as it was.
    if (level > 0u) {
        driver.hot = true;
        ++driver.deposits;
    }
    return level;
}

void cellular_driver_on_floor_built(CellularDriver& driver, World& world, LayerId layer) {
    cellular_on_floor_built(world, driver.scratch, driver.params);
    driver.layer = layer;
    driver.last = CellularStep{};
    if (driver.params.rule == CellularRule::Life) {
        // Life is the one rule that is not source-driven: a zeroed field is dead
        // everywhere and no deposit is coming, so the floor's own geometry IS the seed
        // and the gate must be armed here or the automaton never runs at all.
        cellular_seed_from_grid(world, driver.scratch, driver.params);
        driver.hot = true;
    } else {
        // A zeroed field has nothing to spread, so the new floor starts clean and the
        // first producer on it is what wakes the sweep.
        driver.hot = false;
    }
}

bool cellular_tick(CellularDriver& driver, World& world, LayerId layer,
                   std::uint64_t simTick) {
    // The sim is stepping a different layer than the bitsets were built from. Rebuild
    // BEFORE the cadence check, not after: the bitsets must be right by the time
    // anything sweeps, and a rebuild is bake-time work that must not wait for a cadence
    // tick.
    //
    // A BACKSTOP, not the contract — cellular_driver_on_floor_built is. This comparison
    // cannot see a recycled slot ([game/floor_stream.cpp] free_slot / alloc_slot hand
    // the same LayerId back with different geometry) and it does not re-seed Life, so
    // relying on it alone would sweep floor N+2 against floor N's walls.
    if (layer != driver.layer) {
        driver.layer = layer;
        cellular_refresh_geometry(world.grid(), driver.scratch, driver.params.window);
        // One sweep on the new floor, so `last` describes where we ARE. It costs the
        // non-creating early-out when the floor has no field, which is the usual case.
        driver.hot = true;
    }
    if (simTick % static_cast<std::uint64_t>(kCellularSweepTicks) != 0u) return false;
    const std::uint32_t every = driver.everySweeps < 1u ? 1u : driver.everySweeps;
    const std::uint64_t cadence = simTick / static_cast<std::uint64_t>(kCellularSweepTicks);
    if (cadence % static_cast<std::uint64_t>(every) != 0u) return false;
    // THE GATE. Not a cheap sweep — no sweep. A floor nobody has stressed, and a floor
    // whose state has fully expired, both cost zero here rather than a sweep every
    // 200 ms forever.
    if (!driver.hot) return false;

    driver.last = cellular_step(world, driver.scratch, driver.params);
    ++driver.sweeps;
    driver.changes += driver.last.changes;
    // Re-close the gate from the sweep's own report, which is the whole reason
    // CellularStep returns observations instead of void. Three ways a field is provably
    // static: it does not exist, it has emptied, or (Life) it has reached a still life
    // — `born + died == 0` means not one cell changed and not one can, because the rule
    // is a pure function of the field.
    bool stillAlive = driver.last.present && driver.last.liveCells != 0u;
    if (stillAlive && driver.params.rule == CellularRule::Life &&
        driver.last.born == 0u && driver.last.died == 0u)
        stillAlive = false;
    driver.hot = stillAlive;
    return true;
}

} // namespace giga
