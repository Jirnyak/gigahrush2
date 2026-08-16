#include "game/impact.h"

#include <cmath>

#include "ecs/components.h"
#include "game/combat.h"
#include "game/embody.h"    // NpcRef
#include "game/mob_spawn.h" // MobRef

namespace giga::game {

// Static scratch for the collect-then-process pattern. 512 exceeds the
// plausible impact count in a single tick (one per active body on the floor).
static constexpr std::size_t kMaxImpactScratch = 512;
static Entity sImpactScratch[kMaxImpactScratch];

std::uint32_t impact_damage_step(Registry& reg, NpcPool& pool,
                                 ParticleBurstQueue* particles) {
    std::uint32_t hurt = 0;
    // Collect first: apply_damage mutates component storage (Dead tags) and the
    // reports are removed as consumed — never mutate while iterating a view.
    auto impactView = reg.view<const Impact>();
    std::size_t count = 0;
    for (auto e : impactView) {
        if (count >= kMaxImpactScratch) break;
        sImpactScratch[count++] = e;
    }

    for (std::size_t i = 0; i < count; ++i) {
        Entity e = sImpactScratch[i];
        if (!reg.valid(e) || !reg.all_of<Impact>(e)) continue;

        const float speed = reg.get<const Impact>(e).speed;
        // Consume the report unconditionally — a free landing must not linger
        // and stack with next tick's.
        reg.remove<Impact>(e);

        if (std::isnan(speed) || std::isinf(speed) || speed <= kImpactFreeSpeed) continue;
        const float eff = speed - kImpactFreeSpeed;
        if (eff <= 0.0f) continue;
        const Mass* m = reg.try_get<Mass>(e);
        if (m == nullptr || std::isnan(m->kg) || std::isinf(m->kg) || m->kg <= 0.0f) continue; // massless: no energy, no law
        // Only things that hold HP take damage; a crate hitting the floor is a
        // future break/debris hook, not a combat event.
        if (!reg.any_of<NpcRef, MobRef>(e)) continue;
        if (reg.all_of<Dead>(e)) continue;

        const float joules = 0.5f * m->kg * eff * eff;
        if (std::isnan(joules) || std::isinf(joules) || joules <= 0.0f) continue;
        int computedDmg = static_cast<int>(joules * kImpactHpPerJoule + 0.5f);
        if (computedDmg <= 0) continue;
        if (computedDmg > 32767) computedDmg = 32767;
        const std::int16_t dmg = static_cast<std::int16_t>(computedDmg);

        // Source = the entity itself: gravity has no body to blame, and the
        // death event still names a killer id the log can print.
        apply_damage(reg, pool, e, dmg, DamageChannel::Kinetic, e, nullptr,
                     particles);
        ++hurt;
    }
    return hurt;
}

} // namespace giga::game
