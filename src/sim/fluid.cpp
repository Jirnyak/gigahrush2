#include "sim/fluid.h"

#include <algorithm>
#include <bit>
#include <vector>

#include "world/field.h"

namespace giga {

namespace {

// Fraction of a cell that liquid can occupy = fraction of empty sub-voxels.
// A fully solid cell holds nothing; a carved-out cell holds a full unit.
float capacity_frac(const MacroGrid& g, int x, int y, int z) {
    const SubMask& m = g.mask(x, y, z);
    int solid = 0;
    for (auto w : m.words) solid += std::popcount(w);
    return 1.0f - static_cast<float>(solid) / static_cast<float>(kSubVoxels);
}

} // namespace

void fluid_step(World& world, const FluidParams& params) {
    Field<float>& f = world.fields().get_or_create<float>(params.field, 0.0f);
    MacroGrid& grid = world.grid();

    const std::vector<float>& src = f.data();
    // Delta buffer: every transfer reads only `src`, so the net result is
    // independent of visitation order (deterministic across platforms).
    std::vector<float> delta(kMacroCells, 0.0f);

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
            delta[i] -= down;
            delta[di] += down;
            remaining -= down;
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
                    delta[i] -= move;
                    delta[ni] += move;
                    remaining -= move;
                }
            }
        }
    }

    std::vector<float>& dst = f.data();
    for (std::size_t i = 0; i < kMacroCells; ++i)
        dst[i] = std::max(0.0f, dst[i] + delta[i]);
}

} // namespace giga
