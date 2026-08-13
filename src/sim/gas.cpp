#include "sim/gas.h"
#include "core/jobs.h"
#include "world/lattice.h"
#include "world/gravity.h"
#include "world/destruct.h"
#include <vector>
#include <algorithm>

namespace giga {

void unpack_gas(std::uint32_t v, float& toxic, float& smoke, float& oxy, float& heat) {
    toxic = static_cast<float>(v & 0xFFu);
    smoke = static_cast<float>((v >> 8) & 0xFFu);
    oxy   = static_cast<float>((v >> 16) & 0xFFu);
    heat  = static_cast<float>((v >> 24) & 0xFFu);
}

std::uint32_t pack_gas(float toxic, float smoke, float oxy, float heat) {
    std::uint32_t t = static_cast<std::uint32_t>(std::clamp(toxic, 0.0f, 255.0f));
    std::uint32_t s = static_cast<std::uint32_t>(std::clamp(smoke, 0.0f, 255.0f));
    std::uint32_t o = static_cast<std::uint32_t>(std::clamp(oxy,   0.0f, 255.0f));
    std::uint32_t h = static_cast<std::uint32_t>(std::clamp(heat,  0.0f, 255.0f));
    return t | (s << 8) | (o << 16) | (h << 24);
}

void gas_step(World& world, int layer, float dt, const GasParams& params) {
    Field<std::uint32_t>& gasField = world.fields().get_or_create<std::uint32_t>(params.field);
    auto& data = gasField.data();
    if (data.size() < kMacroCells) data.resize(kMacroCells, pack_gas(0, 0, 255, 0));

    std::vector<std::uint32_t> nextData = data;
    const CellStep gVec = regime_down(world.gravity().regime);
    const SubMask* masks = world.grid().masks().data();
    const std::uint32_t* srcData = data.data();
    std::uint32_t* dstData = nextData.data();

    const CellStep dirs[6] = {
        {1,0,0}, {-1,0,0}, {0,1,0}, {0,-1,0}, {0,0,1}, {0,0,-1}
    };

    parallel_for(128, [&](int cz) {
        const int zBase = cz << 14;
        for (int cy = 0; cy < 128; ++cy) {
            const int yBase = zBase | (cy << 7);
            for (int cx = 0; cx < 128; ++cx) {
                const int ci = yBase | cx;
                if (masks[ci].full()) continue;

                float toxic, smoke, oxy, heat;
                unpack_gas(srcData[ci], toxic, smoke, oxy, heat);

                // Chemistry (Local) BEFORE diffusion
                if (heat > 200.0f && oxy > 40.0f) {
                    oxy -= 12.0f * dt;
                    smoke += 20.0f * dt;
                } else if (oxy <= 40.0f && heat > 0.0f) {
                    heat -= 60.0f * dt;
                }

                if (heat > 180.0f && oxy > 40.0f) {
                    heat += 30.0f * dt;
                }

                if (smoke > 0.0f) smoke -= 2.0f * dt;
                if (toxic > 0.0f) toxic -= 1.0f * dt;

                if (toxic + smoke > 200.0f) {
                    oxy -= 8.0f * dt;
                }

                if (toxic > 100.0f) {
                    oxy -= (toxic - 100.0f) * 0.1f * dt;
                }

                // Gather Diffusion
                float dToxic = 0.0f, dSmoke = 0.0f, dOxy = 0.0f, dHeat = 0.0f;

                for (int i = 0; i < 6; ++i) {
                    const CellStep d = dirs[i];
                    const int nx = (cx + d.x) & 127;
                    const int ny = (cy + d.y) & 127;
                    const int nz = (cz + d.z) & 127;
                    const int nci = nx | (ny << 7) | (nz << 14);

                    if (masks[nci].full()) continue;

                    float nt, ns, no, nh;
                    unpack_gas(srcData[nci], nt, ns, no, nh);

                    const float wRise = (d.x == -gVec.x && d.y == -gVec.y && d.z == -gVec.z) ? 0.0f : (d.x == gVec.x && d.y == gVec.y && d.z == gVec.z) ? params.diffuse * 2.0f : params.diffuse;
                    const float wSink = (d.x == gVec.x && d.y == gVec.y && d.z == gVec.z) ? 0.0f : (d.x == -gVec.x && d.y == -gVec.y && d.z == -gVec.z) ? params.diffuse * 2.0f : params.diffuse;
                    const float wNeutral = params.diffuse;

                    dToxic += (nt - toxic) * wSink * dt;
                    dSmoke += (ns - smoke) * wRise * dt;
                    dOxy   += (no - oxy) * wNeutral * dt;
                    dHeat  += (nh - heat) * wRise * dt;
                }

                dstData[ci] = pack_gas(
                    toxic + dToxic,
                    smoke + dSmoke,
                    oxy + dOxy,
                    heat + dHeat
                );
            }
        }
    });

    data = std::move(nextData);
}

} // namespace giga
