#include "sim/diffusion.h"

#include <algorithm>
#include <bit>     // std::countr_zero, std::popcount — the sweep's bit iteration
#include <cstring> // std::memcmp, std::memset — the group zero test and the group clear

#include "world/macro_grid.h" // giga::MacroGrid, SubMask
#include "world/types.h"      // kMacroCells, kMacroDim, kCellSize, macro_index, wrap_macro

namespace giga {
namespace {

// Words in the walkability bitset: 2,097,152 bits = 32,768 uint64 = 256 KiB.
constexpr std::size_t kOpenWords = (kMacroCells + 63) / 64;

// Flat strides. x is contiguous, y is one row, z is one plane.
constexpr std::size_t kRow = static_cast<std::size_t>(kMacroDimX);
constexpr std::size_t kPlane = kRow * static_cast<std::size_t>(kMacroDimY);
constexpr std::size_t kSpan = kPlane * static_cast<std::size_t>(kMacroDimZ);

// The wrap offsets in the sweep are derived from these three, so if the flat layout in
// world/types.h ever stops being x + y*kMacroDimX + z*kMacroDimX*kMacroDimY the sweep must not
// silently start diffusing into the wrong cells.
static_assert(kSpan == kMacroCells,
              "macro_index must stay x + y*kMacroDimX + z*kMacroDimX*kMacroDimY");

// One 64-cell GROUP is one word of the walkability bitset, and the sweep is organised
// around it: kWordsPerRow groups tile a row exactly. That tiling is the whole reason
// the row-blocked loop below is allowed to resolve each neighbour row's bitset word
// ONCE per row — every row, and every neighbour row, starts on a word boundary only
// because kMacroDimX divides by 64.
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

// A cell participates unless it is FULLY solid — the same coarse walkability
// [world/nav.h] bakes against and [sim/physics.h] collides against. A wall holds no
// scent and passes no flux. Nothing in the tree writes a PARTIAL mask today, so in
// practice this is air-vs-solid.
inline bool cell_open(const MacroGrid& g, int x, int y, int z) {
    return !g.mask(x, y, z).full();
}

// Macro cell containing a world-space coordinate. Truncation then wrap per-axis.
inline int cell_of_x(float coord) {
    return wrap_macro_x(static_cast<int>(coord / kCellSize));
}
inline int cell_of_y(float coord) {
    return wrap_macro_y(static_cast<int>(coord / kCellSize));
}
inline int cell_of_z(float coord) {
    return wrap_macro_z(static_cast<int>(coord / kCellSize));
}

inline int cell_of(float coord) {
    return wrap_macro_x(static_cast<int>(coord / kCellSize));
}

// The gradient, once, over any walkability oracle. `isOpen(x, y, z)` takes RAW
// (possibly out-of-range) coordinates and wraps internally, exactly as Field::at does,
// so the two halves of every difference below agree about which cell they mean.
//
// Per axis: central difference when both sides are open; one-sided toward the open side
// when the other is a wall (a wall carries no flux, so it must not contribute a slope);
// zero when both sides are walls. Substituting `here` for a walled side is what makes
// the one-sided case fall out of the same expression.
template <class OpenFn>
vec3 gradient_impl(const Field<float>& f, OpenFn isOpen, int x, int y, int z) {
    const float here = f.at(x, y, z);
    auto slope = [&](int ax) -> float {
        int p[3] = {x, y, z};
        int m[3] = {x, y, z};
        p[ax] += 1;
        m[ax] -= 1;
        const bool pOpen = isOpen(p[0], p[1], p[2]);
        const bool mOpen = isOpen(m[0], m[1], m[2]);
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

void diffusion_refresh_walkable(const MacroGrid& grid,
                                DiffusionScratch& scratch) {
    // Re-allocate or re-zero rather than bitwise OR: a re-sweep on a modified floor must not
    // inherit stale open bits from the previous floor's geometry.
    scratch.open.assign(kOpenWords, 0ull);
    std::uint64_t* words = scratch.open.data();
    for (int z = 0; z < kMacroDimZ; ++z)
        for (int y = 0; y < kMacroDimY; ++y) {
            std::size_t i = macro_index(0, y, z); // x is the contiguous axis
            for (int x = 0; x < kMacroDimX; ++x, ++i)
                if (cell_open(grid, x, y, z)) words[i >> 6] |= 1ull << (i & 63);
        }
    scratch.geomDirty = false;
}

void diffusion_mark_cell(const MacroGrid& grid, DiffusionScratch& scratch, int x, int y,
                         int z) {
    if (scratch.open.empty()) return; // nothing built yet — nothing to patch
    const int cx = wrap_macro_x(x);
    const int cy = wrap_macro_y(y);
    const int cz = wrap_macro_z(z);
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
    // O(kMacroCells) cache-streamed bytes and zero syscalls.
    Field<float>* f = world.fields().find<float>(field);
    if (f) f->fill(0.0f);
}

float diffusion_add(World& world, int x, int y, int z, float amount,
                    const std::string& field) {
    if (amount <= 0.0f) return 0.0f;
    const int cx = wrap_macro_x(x);
    const int cy = wrap_macro_y(y);
    const int cz = wrap_macro_z(z);
    // A depositor inside a solid wall deposits NOTHING: gas released inside rock does not
    // exist. The caller is responsible for checking if the cell is air; we enforce it
    // here so an overlooked caller cannot leak mass into stone.
    if (!cell_open(world.grid(), cx, cy, cz)) return 0.0f;
    Field<float>& f = world.fields().get_or_create<float>(field, 0.0f);
    float& cur = f.at(cx, cy, cz);
    cur += amount;
    return cur;
}

float diffusion_add_at(World& world, vec3 pos, float amount,
                       const std::string& field) {
    return diffusion_add(world, cell_of_x(pos.x), cell_of_y(pos.y), cell_of_z(pos.z),
                         amount, field);
}

DiffusionStep diffusion_step(World& world, DiffusionScratch& scratch,
                             const DiffusionParams& params,
                             const SpatialActivityGrid* activity,
                             std::uint64_t tick) {
    DiffusionStep out;
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

    const float* __restrict src = f.data().data();
    float* __restrict dst = scratch.back.data();
    const std::uint64_t* __restrict open = scratch.open.data();

    const float rate = std::clamp(params.rate, 0.0f, kDiffusionMaxRate);
    const float keep = 1.0f - std::clamp(params.decay, 0.0f, 1.0f);
    const float minLevel = params.minLevel;

    double total = 0.0;
    std::uint32_t live = 0;
    std::size_t openSwept = 0;

    // ---- PASS 1: classify 64-cell groups into `hot` ------------------------
    scratch.hotGroups.assign(kGroupWords, 0ull);
    std::uint64_t* hot = scratch.hotGroups.data();
    for (std::size_t g = 0; g < kMacroCells / 64; ++g) {
        const float* p = src + g * 64;
        bool any = false;
        for (int k = 0; k < 64; ++k) {
            if (p[k] >= minLevel) {
                any = true;
                break;
            }
        }
        if (any) hot[g >> 6] |= 1ull << (g & 63);
    }

    const auto group_hot = [hot](std::size_t g) -> bool {
        return ((hot[g >> 6] >> (g & 63)) & 1ull) != 0ull;
    };

    // ---- PASS 2: the sweep, one ROW at a time ------------------------------
    //
    // The per-cell form recomputed six wrap conditionals, six bitset word addresses and
    // six shifted bit tests for EVERY cell. All of that is loop-invariant along x: a
    // row's four out-of-row neighbour rows are fixed by (y, z), and each 64-cell group
    // reads exactly one word from each of them. So the row prologue resolves the four
    // offsets and the row bases once, the group prologue loads the four neighbour words
    // once, and the body is register-only bit tests over a contiguous row.
    for (int z = 0; z < kMacroDimZ; ++z) {
        const std::size_t zm = (z == 0) ? (kSpan - kPlane) : (std::size_t(0) - kPlane);
        const std::size_t zp =
            (z == kMacroDimZ - 1) ? (std::size_t(0) - (kSpan - kPlane)) : kPlane;
        for (int y = 0; y < kMacroDimY; ++y) {
            const int sy = (y / SpatialActivityGrid::kSectorCellsY) % SpatialActivityGrid::kSectorsY;
            const std::size_t ym = (y == 0) ? (kPlane - kRow) : (std::size_t(0) - kRow);
            const std::size_t yp =
                (y == kMacroDimY - 1) ? (std::size_t(0) - (kPlane - kRow)) : kRow;
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

            const auto edge_cell = [&](int x) {
                const std::size_t i = i0 + static_cast<std::size_t>(x);
                if (!bit_open(open, i)) return; // a wall; the group memset already did it
                const int sx = (x / SpatialActivityGrid::kSectorCellsX) % SpatialActivityGrid::kSectorsX;
                if (activity != nullptr && !activity->should_step(sx, sy, tick)) {
                    rd[x] = rs[x];
                    total += static_cast<double>(rs[x]);
                    if (rs[x] > 0.0f) ++live;
                    return;
                }
                const int xm = (x == 0) ? (kMacroDimX - 1) : (x - 1);
                const int xp = (x == kMacroDimX - 1) ? 0 : (x + 1);
                const float c = rs[x];
                float acc = 0.0f;
                if (bit_open(open, i0 + static_cast<std::size_t>(xm))) acc += rs[xm] - c;
                if (bit_open(open, i0 + static_cast<std::size_t>(xp))) acc += rs[xp] - c;
                if (bit_open(open, i + ym)) acc += rym[x] - c;
                if (bit_open(open, i + yp)) acc += ryp[x] - c;
                if (bit_open(open, i + zm)) acc += rzm[x] - c;
                if (bit_open(open, i + zp)) acc += rzp[x] - c;
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

                if (activity != nullptr) {
                    bool anyActive = false;
                    for (int k = 0; k < 4; ++k) {
                        int sx = (static_cast<int>(g) * 4 + k) % SpatialActivityGrid::kSectorsX;
                        if (activity->should_step(sx, sy, tick)) {
                            anyActive = true;
                            break;
                        }
                    }
                    if (!anyActive) {
                        std::memcpy(rd + xg, rs + xg, 64u * sizeof(float));
                        for (int k = 0; k < 64; ++k) {
                            float v = rs[xg + k];
                            total += static_cast<double>(v);
                            if (v > 0.0f) ++live;
                        }
                        continue;
                    }
                }

                const std::uint64_t mym = open[wym + g], myp = open[wyp + g];
                const std::uint64_t mzm = open[wzm + g], mzp = open[wzp + g];

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
                    const int sx = (x / SpatialActivityGrid::kSectorCellsX) % SpatialActivityGrid::kSectorsX;
                    if (activity != nullptr && !activity->should_step(sx, sy, tick)) {
                        rd[x] = rs[x];
                        total += static_cast<double>(rs[x]);
                        if (rs[x] > 0.0f) ++live;
                        continue;
                    }
                    const float c = rs[x];
                    // Discrete Laplacian over the OPEN neighbours only, in the same
                    // order and with the same float operations as the per-cell form it
                    // replaced. Each open pair (a, b) exchanges rate*(b - a) and
                    // rate*(a - b), which is symmetric, so the sum over the field is
                    // preserved exactly; a walled neighbour contributes to neither
                    // side, which is precisely a no-flux boundary. Total mass is
                    // therefore multiplied by `keep` and by nothing else — the property
                    // test_diffusion_all pins.
                    float acc = 0.0f;
                    if ((self >> (b - 1)) & 1ull) acc += rs[x - 1] - c;
                    if ((self >> (b + 1)) & 1ull) acc += rs[x + 1] - c;
                    if ((mym >> b) & 1ull) acc += rym[x] - c;
                    if ((myp >> b) & 1ull) acc += ryp[x] - c;
                    if ((mzm >> b) & 1ull) acc += rzm[x] - c;
                    if ((mzp >> b) & 1ull) acc += rzp[x] - c;
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

DiffusionStep diffusion_step(World& world, const DiffusionParams& params,
                             const SpatialActivityGrid* activity,
                             std::uint64_t tick) {
    // One code path, so this cannot drift from the scratch form. The cost of the
    // convenience is stated in the header: an 8.00 MiB allocation and a full bitset
    // rebuild, both discarded when this returns.
    DiffusionScratch once;
    return diffusion_step(world, once, params, activity, tick);
}

vec3 diffusion_gradient(const Field<float>& f, const MacroGrid& g, int x, int y,
                        int z) {
    return gradient_impl(
        f,
        [&g](int cx, int cy, int cz) {
            return cell_open(g, wrap_macro_x(cx), wrap_macro_y(cy), wrap_macro_z(cz));
        },
        x, y, z);
}

vec3 diffusion_gradient(const Field<float>& f, const DiffusionScratch& scratch, int x,
                        int y, int z) {
    // An unbuilt bitset would report every cell solid and hand back a zero gradient,
    // which reads as "nothing here" instead of as "I do not know". Say the second thing
    // by falling back to a bare central difference over the field alone: with no
    // geometry loaded there are no walls to respect.
    if (!scratch.walkable_ready())
        return gradient_impl(f, [](int, int, int) { return true; }, x, y, z);
    const std::uint64_t* open = scratch.open.data();
    return gradient_impl(
        f,
        [open](int cx, int cy, int cz) {
            return bit_open(open, macro_index(wrap_macro_x(cx), wrap_macro_y(cy),
                                              wrap_macro_z(cz)));
        },
        x, y, z);
}

float diffusion_at(const World& world, int x, int y, int z, const std::string& field) {
    // The one const_cast. FieldRegistry::find is non-const only because it hands back a
    // mutable Field; nothing on this path writes one. [sim/fluid.cpp] does the same.
    const Field<float>* f = const_cast<World&>(world).fields().find<float>(field);
    return f ? f->at(wrap_macro_x(x), wrap_macro_y(y), wrap_macro_z(z)) : 0.0f;
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
    return diffusion_driver_add(driver, world, cell_of_x(pos.x), cell_of_y(pos.y),
                                cell_of_z(pos.z), amount, field);
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
                    std::uint64_t simTick, const DiffusionParams& params,
                    const SpatialActivityGrid* activity) {
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

    driver.last = diffusion_step(world, driver.scratch, params, activity, simTick);
    ++driver.sweeps;
    // Re-close the gate from the sweep's own report, which is the whole reason
    // DiffusionStep returns observations instead of void: `present == false` means this
    // layer has no field at all, and `liveCells == 0` means it has one and it has gone
    // quiet. Nothing can change either until the next deposit arms it again.
    driver.hot = driver.last.present && driver.last.liveCells != 0u;
    return true;
}

} // namespace giga
