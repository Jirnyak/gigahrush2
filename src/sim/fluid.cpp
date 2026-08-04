#include "sim/fluid.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <vector>

#include "world/field.h"

namespace giga {

namespace {

// Fraction of a cell that liquid can occupy = fraction of empty sub-voxels.
// A fully solid cell holds nothing; a carved-out cell holds a full unit.
//
// Worth knowing about today's world: nothing in the tree writes a PARTIAL mask —
// `MacroGrid::fill_cell` sets all 512 bits and `clear_cell` clears all of them —
// so in practice this returns exactly 1.0 (air) or 0.0 (solid). That is what makes
// a walled sump hold its level exactly: every neighbour of a contained cell has
// capacity 0, so the transfer clamp below zeroes every candidate move.
float capacity_frac(const MacroGrid& g, int x, int y, int z) {
    const SubMask& m = g.mask(x, y, z);
    int solid = 0;
    for (auto w : m.words) solid += std::popcount(w);
    return 1.0f - static_cast<float>(solid) / static_cast<float>(kSubVoxels);
}

} // namespace

const float* fluid_data(const World& world) {
    // The one const_cast. FieldRegistry::find is non-const only because it hands back a
    // mutable Field; nothing on this path writes one.
    const Field<float>* f =
        const_cast<World&>(world).fields().find<float>(kFluidField);
    return f ? f->data().data() : nullptr;
}

float fluid_at(const World& world, int x, int y, int z) {
    return fluid_at(fluid_data(world), x, y, z);
}

FluidStep fluid_step(World& world, FluidScratch& scratch, const FluidParams& params) {
    FluidStep out;
    // NON-CREATING lookup, deliberately. `get_or_create` here meant that stepping a
    // layer nobody had seeded allocated a 128^3 float field — 8 MiB — and then swept
    // 2,097,152 guaranteed-zero cells every step. Two of the four FloorKinds seed no
    // water at all, so an unconditional per-tick call has to be free on a dry layer.
    Field<float>* fp = world.fields().find<float>(params.field);
    if (fp == nullptr) return out;
    out.present = true;
    Field<float>& f = *fp;
    MacroGrid& grid = world.grid();

    const std::vector<float>& src = f.data();
    // Delta buffer: every transfer reads only `src`, so the net result is
    // independent of visitation order (deterministic across platforms).
    //
    // Allocated on the FIRST transfer rather than up front, and the touched flat-index
    // range is tracked. A settled pool moves nothing, so it pays one read sweep and
    // neither the 8 MiB zero-fill nor the 16 MiB read-modify-write of the apply pass —
    // which matters because standing water on a floor is the permanent state, not the
    // transient one.
    std::vector<float>& delta = scratch.delta;
    if (delta.size() != kMacroCells) delta.assign(kMacroCells, 0.0f);

    std::size_t lo = kMacroCells, hi = 0;
    auto touch = [&](std::size_t k, float v) {
        delta[k] += v;
        if (k < lo) lo = k;
        if (k > hi) hi = k;
    };

    // "Down" follows gravity's dominant axis; default gravity is -Z, so down is
    // decreasing Z. We resolve it once per step from the global vector.
    vec3 gdir = world.gravity().global;
    int downAxis = 2, downSign = -1;
    {
        float ax = std::fabs(gdir.x), ay = std::fabs(gdir.y),
              az = std::fabs(gdir.z);
        if (ax >= ay && ax >= az) { downAxis = 0; downSign = gdir.x < 0 ? -1 : 1; }
        else if (ay >= az)        { downAxis = 1; downSign = gdir.y < 0 ? -1 : 1; }
        else                      { downAxis = 2; downSign = gdir.z < 0 ? -1 : 1; }
    }

    auto step_cell = [&](int x, int y, int z, int axis, int s) {
        int nx = x + (axis == 0 ? s : 0);
        int ny = y + (axis == 1 ? s : 0);
        int nz = z + (axis == 2 ? s : 0);
        return macro_index(wrap_macro(nx), wrap_macro(ny), wrap_macro(nz));
    };

    for (int z = 0; z < kMacroDim; ++z)
    for (int y = 0; y < kMacroDim; ++y)
    for (int x = 0; x < kMacroDim; ++x) {
        std::size_t i = macro_index(x, y, z);
        float amount = src[i];
        if (amount < params.minFlow) continue;
        ++out.wetCells;

        float remaining = amount;

        // 1) Flow straight down into the cell below, up to its free capacity.
        std::size_t di = step_cell(x, y, z, downAxis, downSign);
        float belowCap = params.maxPerCell *
            capacity_frac(grid, x + (downAxis == 0 ? downSign : 0),
                                 y + (downAxis == 1 ? downSign : 0),
                                 z + (downAxis == 2 ? downSign : 0));
        float belowFree = std::max(0.0f, belowCap - src[di]);
        float down = std::min(remaining, belowFree);
        if (down > params.minFlow) {
            touch(i, -down);
            touch(di, down);
            remaining -= down;
            out.moved += down;
        }
        if (remaining < params.minFlow) continue;

        // 2) Spread the remainder to the four lateral neighbours that hold
        //    less, proportional to the height difference (viscosity-damped).
        const int lat[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        // Lateral axes are the two that are not the down axis.
        int a0 = (downAxis == 0) ? 1 : 0;
        int a1 = (downAxis == 2) ? 1 : 2;
        for (auto& d : lat) {
            int ax = (d[0] != 0) ? a0 : a1;
            int sign = (d[0] != 0) ? d[0] : d[1];
            std::size_t ni = step_cell(x, y, z, ax, sign);
            float ncap = params.maxPerCell *
                capacity_frac(grid, x + (ax == 0 ? sign : 0),
                                     y + (ax == 1 ? sign : 0),
                                     z + (ax == 2 ? sign : 0));
            float diff = remaining - std::min(src[ni], ncap);
            if (diff > params.minFlow) {
                float move = std::min(remaining,
                                      diff * params.viscosity * 0.25f);
                move = std::min(move, std::max(0.0f, ncap - src[ni]));
                if (move > params.minFlow) {
                    touch(i, -move);
                    touch(ni, move);
                    remaining -= move;
                    out.moved += move;
                }
            }
        }
    }

    // Nothing moved: the field is already the answer. Skipping the apply pass is
    // exact, not an approximation — `dst[i] + 0.0f` clamped at zero is `dst[i]` for
    // any non-negative amount, and amounts are non-negative by construction (every
    // seeder writes >= 0 and this pass clamps).
    if (lo > hi) return out;

    std::vector<float>& dst = f.data();
    for (std::size_t i = lo; i <= hi; ++i) {
        dst[i] = std::max(0.0f, dst[i] + delta[i]);
        delta[i] = 0.0f;
    }
    return out;
}

FluidStep fluid_step(World& world, const FluidParams& params) {
    FluidScratch once;
    return fluid_step(world, once, params);
}

} // namespace giga
