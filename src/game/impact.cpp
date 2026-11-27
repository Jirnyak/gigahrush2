#include "game/impact.h"

#include <cmath>
#include <vector>

#include "ecs/components.h"
#include "game/combat.h"
#include "game/embody.h"    // NpcRef
#include "game/mob_spawn.h" // MobRef

namespace giga::game {

std::uint32_t impact_damage_step(Registry& reg, NpcPool& pool,
                                 ParticleBurstQueue* particles) {
    std::uint32_t hurt = 0;
    // Collect first: apply_damage mutates component storage (Dead tags) and the
    // reports are removed as consumed — never mutate while iterating a view.
    std::vector<Entity> reports;
    for (auto e : reg.view<const Impact>()) reports.push_back(e);

    for (Entity e : reports) {
        const float speed = reg.get<const Impact>(e).speed;
        // Consume the report unconditionally — a free landing must not linger
        // and stack with next tick's.
        reg.remove<Impact>(e);

        if (!std::isfinite(speed)) continue;
        const float eff = speed - kImpactFreeSpeed;
        if (!(eff > 0.0f)) continue;
        const Mass* m = reg.try_get<Mass>(e);
        if (m == nullptr) continue; // massless: no energy, no law
        // Only things that hold HP take damage; a crate hitting the floor is a
        // future break/debris hook, not a combat event.
        if (!reg.any_of<NpcRef, MobRef>(e)) continue;

        const float rawDmg = 0.5f * m->kg * eff * eff * kImpactHpPerJoule + 0.5f;
        if (!std::isfinite(rawDmg) || !(rawDmg > 0.0f)) continue;
        const std::int16_t dmg = rawDmg >= 32767.0f
                                     ? std::int16_t{32767}
                                     : static_cast<std::int16_t>(rawDmg);
        if (dmg <= 0) continue;
        // Source = the entity itself: gravity has no body to blame, and the
        // death event still names a killer id the log can print.
        apply_damage(reg, pool, e, dmg, DamageChannel::Kinetic, e, nullptr,
                     particles);
        ++hurt;
    }
    return hurt;
}

} // namespace giga::game
