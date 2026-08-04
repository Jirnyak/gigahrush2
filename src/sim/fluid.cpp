#include "sim/fluid.h"

#include <algorithm>
#include <bit>
#include <cmath>
#include <cstring>
#include <vector>

#include "world/field.h"

namespace giga {

namespace {

float capacity_frac(const MacroGrid& g, int x, int y, int z) {
    const SubMask& m = g.mask(x, y, z);
    int solid = 0;
    for (auto w : m.words) solid += std::popcount(w);
    return 1.0f - static_cast<float>(solid) / static_cast<float>(kSubVoxels);
}

} // namespace

const float* fluid_data(const World& world) {
    const Field<float>* f = const_cast<World&>(world).fields().find<float>(kFluidField);
    return f ? f->data().data() : nullptr;
}

float fluid_at(const World& world, int x, int y, int z) {
    return fluid_at(fluid_data(world), x, y, z);
}

FluidStep fluid_step(World& world, FluidScratch& scratch, const FluidParams& params) {
    FluidStep out;
    Field<float>* fp = world.fields().find<float>(params.field);
    if (fp == nullptr) return out;
    out.present = true;
    Field<float>& f = *fp;
    MacroGrid& grid = world.grid();

    const std::vector<float, AlignedAllocator<float, 64>>& src = f.data();
    std::vector<float, AlignedAllocator<float, 64>>& dst = scratch.back;
    if (dst.size() != kMacroCells) dst.resize(kMacroCells);

    constexpr std::size_t kOpenWords = (kMacroCells + 63) / 64;
    constexpr std::size_t kGroupWords = (kOpenWords + 63) / 64;

    if (scratch.hotGroups.size() != kGroupWords) scratch.hotGroups.resize(kGroupWords);
    std::uint64_t* __restrict hot = scratch.hotGroups.data();
    std::memset(hot, 0, kGroupWords * sizeof(std::uint64_t));

    alignas(64) constexpr float kZeroGroup[64] = {};
    for (std::size_t g = 0; g < kOpenWords; ++g) {
        if (std::memcmp(src.data() + g * 64u, kZeroGroup, sizeof(kZeroGroup)) != 0) {
            hot[g >> 6] |= 1ull << (g & 63);
        }
    }
    const auto group_hot = [hot](std::size_t g) {
        return ((hot[g >> 6] >> (g & 63)) & 1ull) != 0ull;
    };

    vec3 gdir = world.gravity().global;
    int downAxis = 2, downSign = -1;
    {
        float ax = std::fabs(gdir.x), ay = std::fabs(gdir.y), az = std::fabs(gdir.z);
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

    const int lat[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
    int a0 = (downAxis == 0) ? 1 : 0;
    int a1 = (downAxis == 2) ? 1 : 2;

    struct Outflows {
        float total_out = 0.0f;
        float down = 0.0f;
        float lat[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    };

    auto calc_outflow = [&](int cx, int cy, int cz) -> Outflows {
        Outflows out_flow;
        std::size_t i = macro_index(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz));
        float amount = src[i];
        if (amount < params.minFlow) return out_flow;

        float remaining = amount;

        std::size_t di = step_cell(cx, cy, cz, downAxis, downSign);
        float belowCap = params.maxPerCell *
            capacity_frac(grid, cx + (downAxis == 0 ? downSign : 0),
                                 cy + (downAxis == 1 ? downSign : 0),
                                 cz + (downAxis == 2 ? downSign : 0));
        float belowFree = std::max(0.0f, belowCap - src[di]);
        float down = std::min(remaining, belowFree);
        if (down > params.minFlow) {
            out_flow.down = down;
            out_flow.total_out += down;
            remaining -= down;
        }
        if (remaining < params.minFlow) return out_flow;

        for (int k = 0; k < 4; ++k) {
            auto& d = lat[k];
            int ax = (d[0] != 0) ? a0 : a1;
            int sign = (d[0] != 0) ? d[0] : d[1];
            std::size_t ni = step_cell(cx, cy, cz, ax, sign);
            float ncap = params.maxPerCell *
                capacity_frac(grid, cx + (ax == 0 ? sign : 0),
                                     cy + (ax == 1 ? sign : 0),
                                     cz + (ax == 2 ? sign : 0));
            float diff = remaining - std::min(src[ni], ncap);
            if (diff > params.minFlow) {
                float move = std::min(remaining, diff * params.viscosity * 0.25f);
                move = std::min(move, std::max(0.0f, ncap - src[ni]));
                if (move > params.minFlow) {
                    out_flow.lat[k] = move;
                    out_flow.total_out += move;
                    remaining -= move;
                }
            }
        }
        return out_flow;
    };

    constexpr std::size_t kRow = static_cast<std::size_t>(kMacroDim);
    constexpr std::size_t kPlane = kRow * kRow;
    constexpr std::size_t kSpan = kPlane * kRow;
    constexpr std::size_t kWordsPerRow = kRow / 64;

    #pragma omp parallel for collapse(2) schedule(static) reduction(+:out.wetCells, out.moved)
    for (int z = 0; z < kMacroDim; ++z) {
        for (int y = 0; y < kMacroDim; ++y) {
            const std::size_t zm = (z == 0) ? (kSpan - kPlane) : (std::size_t(0) - kPlane);
            const std::size_t zp = (z == kMacroDim - 1) ? (std::size_t(0) - (kSpan - kPlane)) : kPlane;
            const std::size_t ym = (y == 0) ? (kPlane - kRow) : (std::size_t(0) - kRow);
            const std::size_t yp = (y == kMacroDim - 1) ? (std::size_t(0) - (kPlane - kRow)) : kRow;
            const std::size_t i0 = macro_index(0, y, z);
            const std::size_t w0 = i0 >> 6;
            const std::size_t wym = (i0 + ym) >> 6, wyp = (i0 + yp) >> 6;
            const std::size_t wzm = (i0 + zm) >> 6, wzp = (i0 + zp) >> 6;
            float* __restrict rd = dst.data() + i0;

            for (std::size_t g = 0; g < kWordsPerRow; ++g) {
                const int xg = static_cast<int>(g) * 64;
                std::memset(rd + xg, 0, 64u * sizeof(float));

                if (!group_hot(w0 + g) &&
                    !group_hot(w0 + (g + kWordsPerRow - 1) % kWordsPerRow) &&
                    !group_hot(w0 + (g + 1) % kWordsPerRow) && !group_hot(wym + g) &&
                    !group_hot(wyp + g) && !group_hot(wzm + g) && !group_hot(wzp + g))
                    continue;

                for (int b = 0; b < 64; ++b) {
                    int x = xg + b;
                    std::size_t i = i0 + x;
                    float amount = src[i];
                    
                    if (amount >= params.minFlow) ++out.wetCells;

                    float next_val = amount;

                    auto my_out = calc_outflow(x, y, z);
                    next_val -= my_out.total_out;
                    out.moved += my_out.total_out;

                    int up_x = x - (downAxis == 0 ? downSign : 0);
                    int up_y = y - (downAxis == 1 ? downSign : 0);
                    int up_z = z - (downAxis == 2 ? downSign : 0);
                    auto up_out = calc_outflow(up_x, up_y, up_z);
                    next_val += up_out.down;

                    for (int k = 0; k < 4; ++k) {
                        int opp_k = k ^ 1;
                        auto& d = lat[k];
                        int ax = (d[0] != 0) ? a0 : a1;
                        int sign = (d[0] != 0) ? d[0] : d[1];
                        
                        int nx = x + (ax == 0 ? sign : 0);
                        int ny = y + (ax == 1 ? sign : 0);
                        int nz = z + (ax == 2 ? sign : 0);
                        
                        auto n_out = calc_outflow(nx, ny, nz);
                        next_val += n_out.lat[opp_k];
                    }

                    if (next_val < params.minFlow) next_val = 0.0f;
                    rd[x] = next_val;
                }
            }
        }
    }

    if (out.moved == 0.0f) return out;

    f.data().swap(scratch.back);
    return out;
}

FluidStep fluid_step(World& world, const FluidParams& params) {
    FluidScratch once;
    return fluid_step(world, once, params);
}

} // namespace giga
