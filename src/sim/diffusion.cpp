#include "sim/diffusion.h"

#include <algorithm>

#include "world/macro_grid.h" // giga::MacroGrid, SubMask
#include "world/types.h"      // kMacroCells, kMacroDim, kCellSize, macro_index, wrap_macro

namespace giga {
namespace {

// Words in the walkability bitset: 2,097,152 bits = 32,768 uint64 = 256 KiB.
constexpr std::size_t kOpenWords = (kMacroCells + 63) / 64;

// One bit per macro cell, indexed by the same flat macro_index the field uses.
inline bool bit_open(const std::uint64_t* words, std::size_t i) {
    return ((words[i >> 6] >> (i & 63)) & 1ull) != 0ull;
}

// NOT DONE, and recorded so the next agent does not redo the experiment: replacing the
// per-neighbour branch below with a branchless `float(bit) * (src[n] - c)` multiply is
// bit-identical (a walled neighbour contributes +-0.0, which changes no float sum) but
// measured NO faster. Six interleaved A/B pairs on this host, medians 34.6 ms branchy vs
// 35.5 ms branchless — indistinguishable. An earlier non-interleaved pair suggested
// 24 ms vs 17 ms, which was machine load drifting between the two runs, not the code.
// If someone profiles this properly, the thing to measure first is the +-z neighbour
// reads (64 KiB apart in an 8 MiB buffer), not the branches.

// A cell participates unless it is FULLY solid — the same coarse walkability
// [world/nav.h] bakes against and [sim/physics.h] collides against. A wall holds no
// scent and passes no flux. Nothing in the tree writes a PARTIAL mask today, so in
// practice this is air-vs-solid.
inline bool cell_open(const MacroGrid& g, int x, int y, int z) {
    return !g.mask(x, y, z).full();
}

// Macro cell containing a world-space coordinate. Truncation then wrap, matching
// [game/door.cpp] / [game/combat.cpp] / [game/wander.cpp] exactly — a different
// rounding here would put a corpse's danger one cell off from where the body is.
inline int cell_of(float coord) {
    return wrap_macro(static_cast<int>(coord / kCellSize));
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

void diffusion_refresh_walkable(const MacroGrid& grid, DiffusionScratch& scratch) {
    // assign() rather than resize() so a rebuild starts from all-solid and cannot
    // inherit stale open bits from the previous floor's geometry.
    scratch.open.assign(kOpenWords, 0ull);
    std::uint64_t* words = scratch.open.data();
    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y) {
            std::size_t i = macro_index(0, y, z); // x is the contiguous axis
            for (int x = 0; x < kMacroDim; ++x, ++i)
                if (cell_open(grid, x, y, z)) words[i >> 6] |= 1ull << (i & 63);
        }
    scratch.geomDirty = false;
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

    const std::vector<float>& src = f.data();
    std::vector<float>& dst = scratch.back;
    const std::uint64_t* open = scratch.open.data();

    // Clamped, not rejected: there is no exception to raise ([AGENTS.md]) and a rate
    // above 1/6 makes the explicit 6-neighbour stencil unstable, so the checkerboard
    // mode would grow every sweep instead of the field spreading. Clamping turns that
    // typo into "spreads a little slower than asked".
    const float rate = std::clamp(params.rate, 0.0f, kDiffusionMaxRate);
    const float keep = 1.0f - std::clamp(params.decay, 0.0f, 1.0f);

    // Flat strides. x is contiguous, y is one row, z is one plane — 512 B and 64 KiB
    // respectively at kMacroDim = 128, so a plane-ordered sweep keeps the three live z
    // planes (192 KiB) inside L2 and the +-z probes are the only ones that travel.
    constexpr std::size_t kRow = static_cast<std::size_t>(kMacroDim);
    constexpr std::size_t kPlane = kRow * kRow;
    constexpr std::size_t kSpan = kPlane * kRow;
    // The wrap offsets below are derived from these three, so if the flat layout in
    // world/types.h ever stops being x + y*N + z*N*N the sweep must not silently start
    // diffusing into the wrong cells.
    static_assert(kSpan == kMacroCells,
                  "macro_index must stay x + y*kMacroDim + z*kMacroDim^2");

    // DOUBLE accumulator for a float field, on purpose. Summing up to 2,097,152 floats
    // in float loses precision as the running total grows past the individual terms — a
    // widely spread field is exactly the case where `total` matters and exactly the
    // case where a float sum is worst. One double register costs nothing against
    // 16 MiB of memory traffic.
    double total = 0.0;
    std::uint32_t live = 0;
    std::uint32_t openSwept = 0;

    for (int z = 0; z < kMacroDim; ++z)
        for (int y = 0; y < kMacroDim; ++y) {
            std::size_t i = macro_index(0, y, z);
            for (int x = 0; x < kMacroDim; ++x, ++i) {
                if (!bit_open(open, i)) {
                    dst[i] = 0.0f; // a wall holds nothing, and exchanges nothing
                    continue;
                }
                ++openSwept;

                // The six wrapped face neighbours as flat offsets. ALL THREE axes wrap
                // ([world.md]); the branch is taken only on the two boundary planes of
                // each axis, so it predicts perfectly and this stays a single add.
                const std::size_t nb[6] = {
                    (x == 0) ? i + (kRow - 1) : i - 1,
                    (x == kMacroDim - 1) ? i - (kRow - 1) : i + 1,
                    (y == 0) ? i + (kPlane - kRow) : i - kRow,
                    (y == kMacroDim - 1) ? i - (kPlane - kRow) : i + kRow,
                    (z == 0) ? i + (kSpan - kPlane) : i - kPlane,
                    (z == kMacroDim - 1) ? i - (kSpan - kPlane) : i + kPlane,
                };

                const float c = src[i];
                // Discrete Laplacian over the OPEN neighbours only. Each open pair
                // (a, b) exchanges rate*(b - a) and rate*(a - b), which is symmetric,
                // so the sum over the field is preserved exactly; a walled neighbour
                // contributes to neither side, which is precisely a no-flux boundary.
                // Total mass is therefore multiplied by `keep` and by nothing else —
                // the property test_diffusion_all pins.
                float acc = 0.0f;
                for (const std::size_t n : nb)
                    if (bit_open(open, n)) acc += src[n] - c;

                float next = (c + rate * acc) * keep;
                // Clamps residue AND any small negative excursion, so the field cannot
                // accumulate a tail of denormals that costs time and means nothing.
                if (next < params.minLevel) next = 0.0f;
                dst[i] = next;
                total += static_cast<double>(next);
                // next is either exactly 0 or >= minLevel after the clamp above, so
                // this IS the "cells >= minLevel" count the header promises.
                if (next > 0.0f) ++live;
            }
        }

    // Swap rather than copy: the old field data becomes next sweep's scratch, so the
    // 8.00 MiB pair is allocated once for the lifetime of the World.
    f.data().swap(scratch.back);
    out.total = static_cast<float>(total);
    out.liveCells = live;
    out.openCells = openSwept;
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
        [&g](int cx, int cy, int cz) {
            return cell_open(g, wrap_macro(cx), wrap_macro(cy), wrap_macro(cz));
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
            return bit_open(open, macro_index(wrap_macro(cx), wrap_macro(cy),
                                              wrap_macro(cz)));
        },
        x, y, z);
}

float diffusion_at(const World& world, int x, int y, int z, const std::string& field) {
    // The one const_cast. FieldRegistry::find is non-const only because it hands back a
    // mutable Field; nothing on this path writes one. [sim/fluid.cpp] does the same.
    const Field<float>* f = const_cast<World&>(world).fields().find<float>(field);
    return f ? f->at(x, y, z) : 0.0f;
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
