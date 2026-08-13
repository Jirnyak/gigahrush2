#include "game/encumbrance.h"

#include "core/rng.h"        // hash_u32 — the identity stagger
#include "ecs/components.h"  // Mass, Transform, CameraTag
#include "game/embody.h"     // NpcRef, body_mass_kg
#include "game/item_table.h" // inventory_mass_g
#include "game/needs.h"      // Needs, kNeedMax — the fatigue this charges
#include "game/noise.h"      // noise_publish, NoiseProfile
#include "game/rpg.h"        // RpgStats, carry_capacity_g

namespace giga::game {

EncumbranceEffect encumbrance_of(std::uint32_t carriedG, std::uint32_t capacityG) {
    EncumbranceEffect out;
    if (capacityG == 0) return out; // no budget known: no penalty, not an infinite one

    const float ratio = static_cast<float>(carriedG) / static_cast<float>(capacityG);

    // NOISE is charged from the FIRST gram and scales with the ratio, because it
    // is not a penalty for breaking a rule — it is what carrying things sounds
    // like. Keyed on the ratio rather than raw kilogrammes so a strong character
    // is not punished for the larger budget its Strength bought.
    out.noiseMult = 1.0f + kNoiseLoadGain * ratio;

    if (ratio <= 1.0f) return out; // inside the free band: nothing else applies
    out.overloaded = true;

    // SPEED: capacity/carried, so double the budget is half the pace. Continuous
    // through the threshold — at exactly 1.0 the scale is exactly 1.0, so there is
    // no step to feel — and floored, because a scale approaching zero is a soft
    // lock rather than a penalty.
    float scale = 1.0f / ratio;
    if (scale < kEncumbranceMinScale) scale = kEncumbranceMinScale;
    out.speedScale = scale;

    // FATIGUE: linear in the OVERLOAD, not in the load, so the free band really is
    // free. At double capacity this is exactly kOverloadSleepDrainPerSec.
    out.extraSleepPerSec = kOverloadSleepDrainPerSec * (ratio - 1.0f);
    return out;
}

EncumbranceTick encumbrance_step(Registry& reg, NpcPool& pool, LayerId layer,
                                 float dt, std::uint64_t tick, NoiseField* noiseField) {
    EncumbranceTick out;
    if (dt <= 0.0f) return out;

    // Staggered by IDENTITY, not by position in the view: a body keeps its phase
    // across spawns and deaths, so the per-tick cost is flat instead of lumping
    // whenever the crowd is reshuffled. Same rule as `wander_step`.
    const std::uint32_t phase =
        static_cast<std::uint32_t>(tick % kEncumbrancePeriod);
    // The whole period elapses between two visits, so the fatigue charged here is
    // for the period and not for one tick — otherwise a staggered sweep would bill
    // 1/8 of the drain it should.
    const float slice = dt * static_cast<float>(kEncumbrancePeriod);

    auto view = reg.view<const NpcRef, const Transform, Mass>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer != layer) continue;
        const NpcId id = view.get<const NpcRef>(e).id;
        if (!pool.valid(id) || !pool.alive(id)) continue;
        const bool camera = reg.all_of<CameraTag>(e);
        // The camera holder is visited EVERY tick: its load drives the HUD and the
        // Controller, and a number that lags by 64 ms is a number that flickers
        // when you pick something up. The crowd, which nobody is reading, staggers.
        if (!camera && hash_u32(id) % kEncumbrancePeriod != phase) continue;

        const std::uint32_t carriedG = inventory_mass_g(pool.inventory(id));
        const RpgStats* rs = reg.try_get<RpgStats>(e);
        const std::uint32_t capacityG =
            carry_capacity_g(rs != nullptr ? *rs : RpgStats{});
        const EncumbranceEffect eff = encumbrance_of(carriedG, capacityG);

        // MASS = BODY + LOAD. This is the whole "no new mechanic" half: from here
        // `E = m*v^2/2` and `p = m*v` see the pack without either law changing.
        view.get<Mass>(e).kg =
            body_mass_kg(pool.height_mm(id)) + static_cast<float>(carriedG) * 0.001f;

        ++out.visited;
        if (eff.overloaded) ++out.overloaded;

        // FATIGUE goes on the pool row, where the survival clock lives — so it is
        // the same sleep bar `needs_step` drains and `needs_speed_scale` reads, not
        // a second exhaustion nobody else knows about. Only for a SEEDED row: an
        // unseeded one is a body whose clock has never started, and pushing it
        // negative here would seed it by accident at the wrong value.
        if (eff.extraSleepPerSec > 0.0f) {
            Needs& n = pool.needs(id);
            if (n.seeded != 0) {
                n.sleep -= eff.extraSleepPerSec * (camera ? dt : slice);
                if (n.sleep < 0.0f) n.sleep = 0.0f;
            }
        }

        if (camera) {
            out.sawPlayer = true;
            out.carriedG = carriedG;
            out.capacityG = capacityG;
            out.playerEffect = eff;
        } else if (noiseField && ((tick & 7u) == (id & 7u))) {
            const auto* vel = reg.try_get<Velocity>(e);
            const float v2 = vel ? (vel->v.x * vel->v.x + vel->v.y * vel->v.y + vel->v.z * vel->v.z) : 0.0f;
            if (v2 > 0.25f) {
                NoiseProfile np{6.0f * eff.noiseMult, 400, 1, NoiseSource::Footstep};
                noise_publish(*noiseField, layer, view.get<const Transform>(e).pos, np, id);
            }
        }
    }
    return out;
}

} // namespace giga::game
