#include "sim/diffusion.h"

#include <algorithm>
#include <bit>     // std::countr_zero, std::popcount — the sweep's bit iteration
#include <chrono>  // the walkable rebuild prints its own cost, like [rooms]
#include <cstdio>
#include <cstring> // std::memcmp, std::memset — the group zero test and the group clear

#include "world/clearance.h"  // face_clearance_at — единый закон потока (occupancy)
#include "world/macro_grid.h" // giga::MacroGrid, SubMask
#include "world/types.h"      // kMacroCells, kMacroDim, kCellSize, macro_index, wrap_macro

namespace giga {
namespace {

// Words in the walkability bitset: 2,097,152 bits = 32,768 uint64 = 256 KiB.
constexpr std::size_t kOpenWords = (kMacroCells + 63) / 64;

// Flat strides. x is contiguous, y is one row, z is one plane — 512 B and 64 KiB
// respectively at kMacroDim = 128, so a plane-ordered sweep keeps the three live z
// planes (192 KiB) inside L2 and the +-z probes are the only ones that travel.
constexpr std::size_t kRow = static_cast<std::size_t>(kMacroDim);
constexpr std::size_t kPlane = kRow * kRow;
constexpr std::size_t kSpan = kPlane * kRow;

// The wrap offsets in the sweep are derived from these three, so if the flat layout in
// world/types.h ever stops being x + y*N + z*N*N the sweep must not silently start
// diffusing into the wrong cells.
static_assert(kSpan == kMacroCells,
              "macro_index must stay x + y*kMacroDim + z*kMacroDim^2");

// One 64-cell GROUP is one word of the walkability bitset, and the sweep is organised
// around it: kWordsPerRow groups tile a row exactly. That tiling is the whole reason
// the row-blocked loop below is allowed to resolve each neighbour row's bitset word
// ONCE per row — every row, and every neighbour row, starts on a word boundary only
// because kMacroDim divides by 64.
constexpr std::size_t kWordsPerRow = kRow / 64;
static_assert(kRow % 64 == 0,
              "a row must be a whole number of walkability words: the sweep resolves "
              "the six neighbour word pairs once per row, which needs every row (and "
              "every +-kRow / +-kPlane neighbour row) to start on a word boundary");
static_assert(kWordsPerRow * 64 == kRow, "kWordsPerRow tiles a row exactly");

// One bit per macro cell, indexed by the same flat macro_index the field uses.
inline bool bit_open(const std::uint64_t* words, std::size_t i) {
    return ((words[i >> 6] >> (i & 63)) & 1ull) != 0ull;
}

// One group's worth of zeroes, for the "is this group entirely 0" memcmp below.
// memcmp rather than a float scan on purpose: it asks the BITWISE question, and
// "all 256 bytes are zero" is the precondition the skip's proof needs (it rules out
// -0.0f, denormals and NaN in one test, where `!= 0.0f` would let -0.0f through).
alignas(64) constexpr float kZeroGroup[64] = {};

// Words in the non-zero-group bitset: one bit per 64-cell group.
constexpr std::size_t kGroupWords = (kOpenWords + 63) / 64;

// WHY THE SWEEP IS SHAPED THE WAY IT IS, measured rather than reasoned. Same binary,
// every form interleaved round-robin so machine load cannot land on one arm, timed with
// QueryThreadCycleTime (which excludes the cycles this thread was descheduled for) and
// quoted as min-of-11-rounds. 12th-gen i7-12700H, MSVC 19.44 /O2 /Ob2 /GL, linked
// /LTCG, real Residential floor, 1,253,822 of 2,097,152 cells open (59.8%). Each form's
// whole 8.00 MiB output was memcmp'd against the per-cell form's, and all four
// DiffusionStep members compared, so every figure below is for a BIT-IDENTICAL result:
//
//   form                                        sparse field     saturated field
//   per-cell, six wrap conditionals per cell    33.8 ns/cell     13.4 ns/cell
//   row-blocked + set-bit iteration              17.5  (1.93x)    6.6  (2.02x)
//   + the zero-group skip                         2.19 (15.4x)    7.1  (1.86x)
//
// "sparse" is the suite's own scenario — 16 sources, 0.2% of open cells non-zero, which
// is also what every published ms/sweep figure for this file was measured on. Because
// the skip is data-dependent, the SATURATED column (every open cell at 1.0, nothing
// skippable) is measured too and is the number a budget must be built on: the skip's
// worst case is 8% slower than not having it and still 1.86x faster than the per-cell
// form, so it is never a regression against what shipped.
//
// TWO experiments that did NOT pay, recorded so nobody redoes them:
//   * `__restrict` on the three base pointers alone: 0.97x, i.e. nothing. Aliasing
//     between the field vector and the scratch back buffer was never the problem.
//   * Branchless neighbour terms — `float(bit) * (src[n] - c)`, or the equivalent
//     AND of the term's bits with a 0/-1 mask. Bit-identical (a walled neighbour
//     contributes +-0.0f, and acc is never -0.0f because it starts +0.0f and x-x is
//     +0.0f) and measurably SLOWER: 1.34x against the row-blocked form's 1.93x. The
//     six neighbour branches predict well enough that removing them costs more in
//     extra work than it saves in mispredicts. This confirms the earlier interleaved
//     A/B that reached the same conclusion from the per-cell form.
//
// AND THE HEADLINE CORRECTION, because it is worth more than any of the above: the
// 18-44 ms band this file used to quote is mostly the SCHEDULER, not the loop. The
// identical binary, unpinned, measured 20.9-30.5 ms/sweep; pinned to one P-core with
// SetThreadAffinityMask it measured 10.4-13.6 ms. A sweep that lands on an E-core, or
// on a P-core at a de-boosted clock, is ~2x the same sweep on a boosted P-core. That is
// why test_diffusion_all asserts work counts and merely PRINTS milliseconds.

// Два РАЗНЫХ вопроса, бывших одним предикатом (ложная посылка «никто не
// пишет частичную маску» — К1-10; карв пишет её тысячами, и запах тёк сквозь
// лепленые стены, §60):
//  - ЁМКОСТЬ, поклеточно: клетка держит поле, если в маске есть воздух.
//  - ПОТОК, погранно: переход открыт газу при face_clearance >= 1 — сквозной
//    воздушной колонке через полуокна обеих клеток ([world/clearance.h] —
//    ЕДИНСТВЕННОЕ место, где живёт закон; газу хватает одного атома, S2).
inline bool cell_open(const MacroGrid& g, int x, int y, int z) {
    return !g.mask(x, y, z).full();
}
inline bool face_open(const MacroGrid& g, int x, int y, int z, int axis) {
    return face_clearance_at(g, x, y, z, axis) >= 1;
}

// Macro cell containing a world-space coordinate. Truncation then wrap, matching
// [game/door.cpp] / [game/combat.cpp] / [game/wander.cpp] exactly — a different
// rounding here would put a corpse's danger one cell off from where the body is.
inline int cell_of(float coord) {
    return wrap_macro(static_cast<int>(coord / kCellSize));
}

// The gradient, once, over any FACE oracle. `openFace(x, y, z, axis)` takes RAW
// (possibly out-of-range) coordinates of the axis-МЛАДШЕЙ клетки грани and wraps
// internally, exactly as Field::at does, so the two halves of every difference
// below agree about which faces they mean.
//
// Per axis: central difference when both faces pass flux; one-sided toward the
// open face when the other is walled (a wall carries no flux, so it must not
// contribute a slope); zero when both are walled. Substituting `here` for a
// walled side is what makes the one-sided case fall out of the same expression.
template <class FaceFn>
vec3 gradient_impl(const Field<float>& f, FaceFn openFace, int x, int y, int z) {
    const float here = f.at(x, y, z);
    auto slope = [&](int ax) -> float {
        int p[3] = {x, y, z};
        int m[3] = {x, y, z};
        p[ax] += 1;
        m[ax] -= 1;
        // Грань (here → p) лежит у here; грань (m → here) — у m.
        const bool pOpen = openFace(x, y, z, ax);
        const bool mOpen = openFace(m[0], m[1], m[2], ax);
        const float hp = pOpen ? f.at(p[0], p[1], p[2]) : here;
        const float hm = mOpen ? f.at(m[0], m[1], m[2]) : here;
        if (pOpen && mOpen) return 0.5f * (hp - hm);
        if (pOpen) return hp - here;
        if (mOpen) return here - hm;
        return 0.0f;
    };
    return vec3{slope(0), slope(1), slope(2)};
}

} // namespace

void diffusion_refresh_walkable(const MacroGrid& grid, DiffusionScratch& scratch) {
    // Prints its own cost (async-rebake phase A): this rebuild is the full-floor
    // fallback that per-cell diffusion_mark_cell exists to avoid, and the
    // scheduler needs its real number, not a guess.
    const auto t0 = std::chrono::steady_clock::now();
    // assign() rather than resize() so a rebuild starts from all-solid and cannot
    // inherit stale open bits from the previous floor's geometry.
    scratch.open.assign(kOpenWords, 0ull);
    scratch.faceX.assign(kOpenWords, 0ull);
    scratch.faceY.assign(kOpenWords, 0ull);
    scratch.faceZ.assign(kOpenWords, 0ull);
    std::uint64_t* words = scratch.open.data();
    std::uint64_t* fx = scratch.faceX.data();
    std::uint64_t* fy = scratch.faceY.data();
    std::uint64_t* fz = scratch.faceZ.data();
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y) {
            std::size_t i = macro_index(0, y, z); // x is the contiguous axis
            for (int x = 0; x < kMacroDim; ++x, ++i) {
                const std::uint64_t bit = 1ull << (i & 63);
                if (cell_open(grid, x, y, z)) {
                    words[i >> 6] |= bit;
                    // Грани считаются только от непустой ёмкости: у полной
                    // клетки все три плюс-грани глухие по закону (полуокно
                    // без воздуха), сам вызов — лишняя эрозия на 40% клеток.
                    if (face_open(grid, x, y, z, 0)) fx[i >> 6] |= bit;
                    if (face_open(grid, x, y, z, 1)) fy[i >> 6] |= bit;
                    if (face_open(grid, x, y, z, 2)) fz[i >> 6] |= bit;
                }
            }
        }
    scratch.geomDirty = false;
    const double ms = std::chrono::duration<double, std::milli>(
                          std::chrono::steady_clock::now() - t0)
                          .count();
    std::fprintf(stderr, "[diffuse] walkable bitset rebuilt in %.1f ms\n", ms);
}

void diffusion_mark_cell(const MacroGrid& grid, DiffusionScratch& scratch, int x, int y,
                         int z) {
    if (scratch.open.empty()) return; // nothing built yet — nothing to patch
    const int cx = wrap_macro(x);
    const int cy = wrap_macro(y);
    const int cz = wrap_macro(z);
    const std::size_t i = macro_index(cx, cy, cz);
    const std::uint64_t bit = 1ull << (i & 63);
    if (cell_open(grid, cx, cy, cz))
        scratch.open[i >> 6] |= bit;
    else
        scratch.open[i >> 6] &= ~bit;
}

void diffusion_on_floor_built(World& world, DiffusionScratch& scratch,
                              const std::string& field) {
    diffusion_refresh_walkable(world.grid(), scratch);
    // NON-creating: a floor nobody has wounded must not acquire an 8.00 MiB field just
    // by being loaded. Field<T>::fill is a std::fill over the flat vector, so this is
    // one 8.00 MiB streaming write and no allocation.
    if (Field<float>* f = world.fields().find<float>(field)) f->fill(0.0f);
}

float diffusion_add(World& world, int x, int y, int z, float amount,
                    const std::string& field) {
    const int cx = wrap_macro(x);
    const int cy = wrap_macro(y);
    const int cz = wrap_macro(z);
    // Refuse a source inside structure. The sweep pins solid cells to 0, so storing it
    // would report mass this sweep that provably vanishes on the next one — and a
    // total that oscillates is worse than a source that honestly did not take.
    if (!cell_open(world.grid(), cx, cy, cz)) return 0.0f;

    Field<float>& f = world.fields().get_or_create<float>(field, 0.0f);
    float& cell = f.at(cx, cy, cz);
    cell += amount;
    if (cell < 0.0f) cell = 0.0f; // a negative level has no meaning for any consumer
    return cell;
}

float diffusion_add_at(World& world, vec3 pos, float amount,
                       const std::string& field) {
    return diffusion_add(world, cell_of(pos.x), cell_of(pos.y), cell_of(pos.z), amount,
                         field);
}

DiffusionStep diffusion_step(World& world, DiffusionScratch& scratch,
                             const DiffusionParams& params) {
    DiffusionStep out;
    // NON-CREATING lookup, deliberately: see the diffusion_add comment in the header.
    // A layer nobody has wounded pays one string hash per sweep, not 8.00 MiB and
    // 2,097,152 zero cells.
    Field<float>* fp = world.fields().find<float>(params.field);
    if (fp == nullptr) return out;
    out.present = true;
    Field<float>& f = *fp;

    // A geometry mutation between sweeps is answered here, once, rather than by every
    // caller remembering to rebuild: door_step opens and breaks doors on the tick
    // ([game/door.cpp] fill_cell / clear_cell), and a bitset that missed that diffuses
    // danger through a shut door or holds it out of an open one.
    if (!scratch.walkable_ready() || scratch.geomDirty)
        diffusion_refresh_walkable(world.grid(), scratch);
    if (scratch.back.size() != kMacroCells) scratch.back.resize(kMacroCells);

    if (scratch.hotGroups.size() != kGroupWords) scratch.hotGroups.resize(kGroupWords);

    // Raw pointers, and __restrict because these two buffers genuinely cannot alias:
    // one is the Field's vector, the other the scratch's, and the swap happens after
    // the loop. Measured worth nothing on its own (0.97x) — kept only because it is
    // free and true, not as an optimisation.
    const float* __restrict src = f.data().data();
    float* __restrict dst = scratch.back.data();
    const std::uint64_t* __restrict open = scratch.open.data();
    const std::uint64_t* __restrict faceXp = scratch.faceX.data();
    const std::uint64_t* __restrict faceYp = scratch.faceY.data();
    const std::uint64_t* __restrict faceZp = scratch.faceZ.data();

    // Clamped, not rejected: there is no exception to raise ([AGENTS.md]) and a rate
    // above 1/6 makes the explicit 6-neighbour stencil unstable, so the checkerboard
    // mode would grow every sweep instead of the field spreading. Clamping turns that
    // typo into "spreads a little slower than asked".
    const float rate = std::clamp(params.rate, 0.0f, kDiffusionMaxRate);
    const float keep = 1.0f - std::clamp(params.decay, 0.0f, 1.0f);
    const float minLevel = params.minLevel;

    // ---- PASS 1: which 64-cell groups hold anything at all -----------------
    //
    // THE SKIP THIS BUYS, and its proof. If a group's 256 bytes are bitwise zero, and
    // so are the seven groups any of its cells can read from (the two x-adjacent groups
    // in the row, and the same group index in the +-y and +-z neighbour ROWS), then
    // every cell in it has c == +0.0f and every neighbour term is (+0.0f - +0.0f) ==
    // +0.0f. So acc == +0.0f, next == (+0.0f + rate*+0.0f) * keep == +0.0f for ANY
    // finite rate and keep — including keep == 0 — and the clamp cannot turn +0.0f into
    // anything else. Writing 0.0f over the whole group is therefore BIT-IDENTICAL to
    // computing it, `total` is unchanged (adding +0.0 to a double is a no-op) and
    // `live` is unchanged. Solid cells in the group were going to be zeroed anyway.
    //
    // WHY IT IS WORTH A WHOLE 8.00 MiB READ: a real floor is almost entirely quiet. The
    // suite's own scenario has 2,592 non-zero cells against 1,253,822 open ones —
    // 0.2%. Diffusion is a LOCAL stencil, so danger never occupies more than the L1
    // ball its deposits have had time to reach; there is no state in which a floor is
    // uniformly hot for long, because `keep` is pulling every cell down at the same
    // time. Measured 15.4x on that scenario, and 1.86x — still faster than the
    // per-cell form it replaced — when every open cell is above minLevel.
    //
    // AND IT HAS NO INVALIDATION HAZARD, which is the whole reason it is a pass and not
    // a cached set. It is derived from `src` inside the sweep that uses it, so unlike
    // scratch.open there is no geometry-moved / floor-changed / deposit-behind-my-back
    // case: nothing can make it stale, and diffusion_add needs to know nothing about it.
    std::uint64_t* __restrict hot = scratch.hotGroups.data();
    std::memset(hot, 0, kGroupWords * sizeof(std::uint64_t));
    for (std::size_t g = 0; g < kOpenWords; ++g)
        if (std::memcmp(src + g * 64u, kZeroGroup, sizeof(kZeroGroup)) != 0)
            hot[g >> 6] |= 1ull << (g & 63);
    const auto group_hot = [hot](std::size_t g) {
        return ((hot[g >> 6] >> (g & 63)) & 1ull) != 0ull;
    };

    // DOUBLE accumulator for a float field, on purpose. Summing up to 2,097,152 floats
    // in float loses precision as the running total grows past the individual terms — a
    // widely spread field is exactly the case where `total` matters and exactly the
    // case where a float sum is worst. One double register costs nothing against
    // 16 MiB of memory traffic. It stays a single ORDERED chain rather than four
    // partial sums: splitting it was measured at 1.31x against the row-blocked form's
    // 1.93x, i.e. the chain is not the bottleneck, so there is no reason to pay a
    // different `total` for it.
    double total = 0.0;
    std::uint32_t live = 0;

    // The work count is the popcount of the walkability bitset, which is exactly the
    // set of cells this sweep is responsible for. Counting it here rather than
    // incrementing per cell keeps the inner loop free of a dependency on it; the two
    // are equal by construction because every open cell is either computed or proved
    // to be 0 by the skip above.
    std::size_t openSwept = 0;
    for (std::size_t g = 0; g < kOpenWords; ++g)
        openSwept += static_cast<std::size_t>(std::popcount(open[g]));

    // ---- PASS 2: the sweep, one ROW at a time ------------------------------
    //
    // The per-cell form recomputed six wrap conditionals, six bitset word addresses and
    // six shifted bit tests for EVERY cell. All of that is loop-invariant along x: a
    // row's four out-of-row neighbour rows are fixed by (y, z), and each 64-cell group
    // reads exactly one word from each of them. So the row prologue resolves the four
    // offsets and the row bases once, the group prologue loads the four neighbour words
    // once, and the body is register-only bit tests over a contiguous row.
    for (int z = 0; z < kMacroDim; ++z) {
        // ALL THREE axes wrap ([world.md]). Hoisted to the plane and the row, where the
        // wrap is a property of the coordinate rather than of the cell.
        const std::size_t zm = (z == 0) ? (kSpan - kPlane) : (std::size_t(0) - kPlane);
        const std::size_t zp =
            (z == kMacroDim - 1) ? (std::size_t(0) - (kSpan - kPlane)) : kPlane;
        for (int y = 0; y < kMacroDim; ++y) {
            const std::size_t ym = (y == 0) ? (kPlane - kRow) : (std::size_t(0) - kRow);
            const std::size_t yp =
                (y == kMacroDim - 1) ? (std::size_t(0) - (kPlane - kRow)) : kRow;
            const std::size_t i0 = macro_index(0, y, z);
            const std::size_t w0 = i0 >> 6;
            const std::size_t wym = (i0 + ym) >> 6, wyp = (i0 + yp) >> 6;
            const std::size_t wzm = (i0 + zm) >> 6, wzp = (i0 + zp) >> 6;
            const float* __restrict rs = src + i0;
            const float* __restrict rym = src + i0 + ym;
            const float* __restrict ryp = src + i0 + yp;
            const float* __restrict rzm = src + i0 + zm;
            const float* __restrict rzp = src + i0 + zp;
            float* __restrict rd = dst + i0;

            // The two cells of each 64-cell group whose x neighbour leaves the group:
            // their walkability bit lives in another word and their index may wrap the
            // row, so they take the general path. 2 of 64 cells.
            //
            // CALLED IN x ORDER, before and after the group body, and that is not
            // cosmetic: `total` is one ordered chain of double adds, so visiting bit 63
            // before bits 1..62 would change its last bits. Cells in x order means the
            // sequence of adds is the open cells in increasing x, exactly as the
            // per-cell form did them, which is what makes `total` bit-identical by
            // construction rather than by luck.
            const auto edge_cell = [&](int x) {
                const std::size_t i = i0 + static_cast<std::size_t>(x);
                if (!bit_open(open, i)) return; // a wall; the group memset already did it
                const int xm = (x == 0) ? (kMacroDim - 1) : (x - 1);
                const int xp = (x == kMacroDim - 1) ? 0 : (x + 1);
                const float c = rs[x];
                // Гейт потока — ГРАННЫЙ бит; бит грани лежит у младшей клетки
                // оси, поэтому «минус»-сосед проверяется по СВОЕМУ индексу.
                float acc = 0.0f;
                if (bit_open(faceXp, i0 + static_cast<std::size_t>(xm))) acc += rs[xm] - c;
                if (bit_open(faceXp, i)) acc += rs[xp] - c;
                if (bit_open(faceYp, i + ym)) acc += rym[x] - c;
                if (bit_open(faceYp, i)) acc += ryp[x] - c;
                if (bit_open(faceZp, i + zm)) acc += rzm[x] - c;
                if (bit_open(faceZp, i)) acc += rzp[x] - c;
                float next = (c + rate * acc) * keep;
                if (next < minLevel) next = 0.0f;
                rd[x] = next;
                total += static_cast<double>(next);
                if (next > 0.0f) ++live;
            };

            for (std::size_t g = 0; g < kWordsPerRow; ++g) {
                const std::uint64_t self = open[w0 + g];
                const int xg = static_cast<int>(g) * 64;
                // Zero the whole group up front — 256 B, two stores — so the body never
                // needs an else-branch for a solid cell and the two skips below are one
                // `continue` each. A wall holds nothing and exchanges nothing.
                std::memset(rd + xg, 0, 64u * sizeof(float));
                // Wholly solid — 8,192 of the 32,768 groups on the Residential floor
                // test_diffusion_all times, because floor_gen's storey slabs make whole
                // z planes solid and a solid plane is 256 whole groups.
                if (self == 0ull) continue;
                if (!group_hot(w0 + g) &&
                    !group_hot(w0 + (g + kWordsPerRow - 1) % kWordsPerRow) &&
                    !group_hot(w0 + (g + 1) % kWordsPerRow) && !group_hot(wym + g) &&
                    !group_hot(wyp + g) && !group_hot(wzm + g) && !group_hot(wzp + g))
                    continue; // provably all zero — see the PASS 1 proof above
                // Гранные слова группы: x-грани свои (бит b = грань b→b+1),
                // минус-грани y/z лежат в СЛОВЕ МИНУС-СОСЕДА по своей оси.
                const std::uint64_t fxw = faceXp[w0 + g];
                const std::uint64_t fym = faceYp[wym + g], fyp = faceYp[w0 + g];
                const std::uint64_t fzm = faceZp[wzm + g], fzp = faceZp[w0 + g];

                edge_cell(xg); // x order: bit 0, then bits 1..62, then bit 63

                // Bits 1..62: iterate the SET bits rather than all 64 positions, so a
                // solid cell costs one `blsr` and no branch at all. 40% of this floor
                // is solid, so that is 40% of the iterations gone. countr_zero yields
                // the lowest set bit first, so this too runs in increasing x.
                std::uint64_t m = self & 0x7FFFFFFFFFFFFFFEull;
                while (m != 0ull) {
                    const int b = std::countr_zero(m);
                    m &= m - 1ull;
                    const int x = xg + b;
                    const float c = rs[x];
                    // Discrete Laplacian over the OPEN FACES only, in the same
                    // order and with the same float operations as before. Обе
                    // клетки пары читают ОДИН гранный бит, so each open pair
                    // exchanges rate*(b - a) and rate*(a - b) symmetric, and
                    // the sum over the field is preserved exactly; a walled
                    // face contributes to neither side — precisely a no-flux
                    // boundary. Total mass is therefore multiplied by `keep`
                    // and by nothing else — the property test_diffusion pins.
                    float acc = 0.0f;
                    if ((fxw >> (b - 1)) & 1ull) acc += rs[x - 1] - c;
                    if ((fxw >> b) & 1ull) acc += rs[x + 1] - c;
                    if ((fym >> b) & 1ull) acc += rym[x] - c;
                    if ((fyp >> b) & 1ull) acc += ryp[x] - c;
                    if ((fzm >> b) & 1ull) acc += rzm[x] - c;
                    if ((fzp >> b) & 1ull) acc += rzp[x] - c;
                    float next = (c + rate * acc) * keep;
                    // Clamps residue AND any small negative excursion, so the field
                    // cannot accumulate a tail of denormals that costs time and means
                    // nothing.
                    if (next < minLevel) next = 0.0f;
                    rd[x] = next;
                    total += static_cast<double>(next);
                    // next is either exactly 0 or >= minLevel after the clamp above, so
                    // this IS the "cells >= minLevel" count the header promises.
                    if (next > 0.0f) ++live;
                }

                edge_cell(xg + 63);
            }
        }
    }

    // Swap rather than copy: the old field data becomes next sweep's scratch, so the
    // 8.00 MiB pair is allocated once for the lifetime of the World.
    f.data().swap(scratch.back);
    out.total = static_cast<float>(total);
    out.liveCells = live;
    out.openCells = static_cast<std::uint32_t>(openSwept);
    return out;
}

DiffusionStep diffusion_step(World& world, const DiffusionParams& params) {
    // One code path, so this cannot drift from the scratch form. The cost of the
    // convenience is stated in the header: an 8.00 MiB allocation and a full bitset
    // rebuild, both discarded when this returns.
    DiffusionScratch once;
    return diffusion_step(world, once, params);
}

vec3 diffusion_gradient(const Field<float>& f, const MacroGrid& g, int x, int y,
                        int z) {
    return gradient_impl(
        f,
        [&g](int cx, int cy, int cz, int ax) {
            return face_open(g, wrap_macro(cx), wrap_macro(cy), wrap_macro(cz),
                             ax);
        },
        x, y, z);
}

vec3 diffusion_gradient(const Field<float>& f, const DiffusionScratch& scratch, int x,
                        int y, int z) {
    // Unbuilt bitsets would report every face walled and hand back a zero gradient,
    // which reads as "nothing here" instead of as "I do not know". Say the second thing
    // by falling back to a bare central difference over the field alone: with no
    // geometry loaded there are no walls to respect.
    if (!scratch.walkable_ready())
        return gradient_impl(f, [](int, int, int, int) { return true; }, x, y, z);
    const std::uint64_t* fX = scratch.faceX.data();
    const std::uint64_t* fY = scratch.faceY.data();
    const std::uint64_t* fZ = scratch.faceZ.data();
    return gradient_impl(
        f,
        [fX, fY, fZ](int cx, int cy, int cz, int ax) {
            const std::uint64_t* v = ax == 0 ? fX : (ax == 1 ? fY : fZ);
            return bit_open(v, macro_index(wrap_macro(cx), wrap_macro(cy),
                                           wrap_macro(cz)));
        },
        x, y, z);
}

float diffusion_at(const World& world, int x, int y, int z, const std::string& field) {
    // The one const_cast. FieldRegistry::find is non-const only because it hands back a
    // mutable Field; nothing on this path writes one. [sim/fluid.cpp] does the same.
    const Field<float>* f = const_cast<World&>(world).fields().find<float>(field);
    // Обёрнутые координаты: незавёрнутый вызов с клеткой за периодом читал
    // мимо поля (фикс из аудита форка, переписан на наш единый wrap_macro).
    return f ? f->at(wrap_macro(x), wrap_macro(y), wrap_macro(z)) : 0.0f;
}

float diffusion_driver_add(DiffusionDriver& driver, World& world, int x, int y, int z,
                           float amount, const std::string& field) {
    const float level = diffusion_add(world, x, y, z, amount, field);
    // A source refused inside rock stored nothing, so there is nothing to spread and
    // nothing to wake. Arming on it would pay a 20 ms sweep to rediscover that the floor
    // is exactly as quiet as it was.
    if (level > 0.0f) {
        driver.hot = true;
        ++driver.deposits;
    }
    return level;
}

float diffusion_driver_add_at(DiffusionDriver& driver, World& world, vec3 pos,
                              float amount, const std::string& field) {
    // Through diffusion_driver_add rather than beside it, so the arming rule above has
    // one implementation and the two entry points cannot drift on it.
    return diffusion_driver_add(driver, world, cell_of(pos.x), cell_of(pos.y),
                                cell_of(pos.z), amount, field);
}

void diffusion_driver_on_floor_built(DiffusionDriver& driver, World& world, LayerId layer,
                                     const std::string& field) {
    diffusion_on_floor_built(world, driver.scratch, field);
    driver.layer = layer;
    // A zeroed field has nothing to spread, so the new floor starts free and the first
    // producer on it is what wakes the sweep. `last` is cleared too: leaving the departed
    // floor's report in place would have a HUD state a live cell count for a floor that
    // no longer exists.
    driver.hot = false;
    driver.last = DiffusionStep{};
}

bool diffusion_tick(DiffusionDriver& driver, World& world, LayerId layer,
                    std::uint64_t simTick, const DiffusionParams& params) {
    // The sim is stepping a different layer than the bitset was built from. Rebuild
    // BEFORE the cadence check, not after: the bitset must be right by the time anything
    // sweeps, and a rebuild is bake-time work that must not wait for a cadence tick.
    //
    // A BACKSTOP, not the contract — diffusion_driver_on_floor_built is. This comparison
    // cannot see a recycled slot ([game/floor_stream.cpp] free_slot / alloc_slot hand the
    // same LayerId back with different geometry), so relying on it alone would sweep
    // floor N+2 against floor N's walls.
    if (layer != driver.layer) {
        driver.layer = layer;
        diffusion_refresh_walkable(world.grid(), driver.scratch);
        // One sweep on the new floor, so `last` describes where we ARE. It costs the
        // non-creating early-out when the floor has no field, which is the usual case.
        driver.hot = true;
    }
    if (simTick % static_cast<std::uint64_t>(kDiffusionSweepTicks) != 0) return false;
    // THE GATE. Not a cheap sweep — no sweep. A floor nobody has bled on, and a floor
    // whose danger has fully evaporated, both cost zero here rather than 20 ms every
    // 200 ms forever.
    if (!driver.hot) return false;

    driver.last = diffusion_step(world, driver.scratch, params);
    ++driver.sweeps;
    // Re-close the gate from the sweep's own report, which is the whole reason
    // DiffusionStep returns observations instead of void: `present == false` means this
    // layer has no field at all, and `liveCells == 0` means it has one and it has gone
    // quiet. Nothing can change either until the next deposit arms it again.
    driver.hot = driver.last.present && driver.last.liveCells != 0u;
    return true;
}

} // namespace giga
