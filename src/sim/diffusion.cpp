#include "sim/diffusion.h"

#include <cstddef>
#include <vector>

#include "world/types.h" // giga::kMacroCells, kMacroDim, macro_index, wrap_macro

namespace giga {
namespace {

// A cell participates in diffusion unless it is FULLY solid — the same coarse
// walkability nav uses (world/nav.h): a wall holds no scent and passes no flux.
inline bool solid(const MacroGrid& g, int x, int y, int z) {
    return g.mask(x, y, z).full();
}

} // namespace

void diffusion_step(World& world, const DiffusionParams& params) {
    Field<float>& f = world.fields().get_or_create<float>(params.field, 0.0f);
    const MacroGrid& grid = world.grid();

    const std::vector<float>& src = f.data();
    // Write into a second buffer read only from `src`, so the net result is
    // independent of visitation order (deterministic across platforms).
    std::vector<float> dst(kMacroCells, 0.0f);

    const float keep = 1.0f - params.decay;

    for (int z = 0; z < kMacroDim; ++z)
    for (int y = 0; y < kMacroDim; ++y)
    for (int x = 0; x < kMacroDim; ++x) {
        const std::size_t i = macro_index(x, y, z);
        if (solid(grid, x, y, z)) { dst[i] = 0.0f; continue; } // wall holds nothing

        const float c = src[i];
        // Discrete Laplacian over the 6 wrapped neighbours, but only OPEN ones
        // exchange: each contributes rate*(neighbour - c); a wall contributes
        // nothing, which is exactly a no-flux (Neumann) boundary at the wall.
        const int nbr[6][3] = {
            {x - 1, y, z}, {x + 1, y, z}, {x, y - 1, z},
            {x, y + 1, z}, {x, y, z - 1}, {x, y, z + 1},
        };
        float acc = 0.0f;
        for (const auto& d : nbr) {
            const int nx = wrap_macro(d[0]);
            const int ny = wrap_macro(d[1]);
            const int nz = wrap_macro(d[2]);
            if (solid(grid, nx, ny, nz)) continue;
            acc += src[macro_index(nx, ny, nz)] - c;
        }
        float next = (c + params.rate * acc) * keep;
        if (next < params.minLevel) next = 0.0f; // evaporate residues to keep it tidy
        dst[i] = next;
    }

    f.data().swap(dst);
}

vec3 diffusion_gradient(const Field<float>& f, const MacroGrid& g, int x, int y,
                        int z) {
    const float here = f.at(x, y, z);
    // Per axis: central difference when both sides are open; one-sided toward the
    // open side when the other is a wall; zero when both sides are walls.
    auto slope = [&](int ax) -> float {
        int p[3] = {x, y, z}, m[3] = {x, y, z};
        p[ax] += 1;
        m[ax] -= 1;
        const bool pOpen =
            !g.mask(wrap_macro(p[0]), wrap_macro(p[1]), wrap_macro(p[2])).full();
        const bool mOpen =
            !g.mask(wrap_macro(m[0]), wrap_macro(m[1]), wrap_macro(m[2])).full();
        const float hp = pOpen ? f.at(p[0], p[1], p[2]) : here;
        const float hm = mOpen ? f.at(m[0], m[1], m[2]) : here;
        if (pOpen && mOpen) return 0.5f * (hp - hm);
        if (pOpen) return hp - here;
        if (mOpen) return here - hm;
        return 0.0f;
    };
    return vec3{slope(0), slope(1), slope(2)};
}

} // namespace giga
