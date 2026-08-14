#include "game/investigate.h"

#include <cmath>

#include "core/rng.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/embody.h"           // NpcRef
#include "game/faction_relations.h"
#include "game/mob_behaviour.h"
#include "game/mob_spawn.h"        // MobRef
#include "game/wander.h"           // kWanderPeriod, kAggroRadius
#include "world/types.h"

namespace giga::game {

namespace {

} // namespace

InvestigateHeard investigate_hear(const NoiseField& field, MobBehaviour beh, LayerId layer,
                    const vec3& mobPos, std::uint32_t mobId) {
    InvestigateHeard out;
    if (field.quiet()) return out;

    // Безэхий is deaf until revealed, and "revealed" does not exist yet. The
    // reference's own guard is `hasAIFlag(e,'deadEcho') && !revealed -> return
    // false`, so refusing outright IS its pre-reveal behaviour rather than a
    // stand-in for it. When a reveal flag lands this becomes one condition.
    // [noise.h] "What this unblocks".
    if (beh == MobBehaviour::DeadEcho) return out;

    float hearingMult = kInvestigateHearing;
    if (beh == MobBehaviour::GreenDogPack) hearingMult = kDogHearing;
    else if (beh == MobBehaviour::LastSoundBeam) hearingMult = kBeamHearing;

    float dist = 0.0f;
    const Noise* n = loudest_heard(field, layer, mobPos, hearingMult,
                                   kInvestigateMinSeverity, mobId, &dist);
    if (!n) return out;

    out.heard = true;
    out.dx = wrap_delta_f(mobPos.x, n->x, kWorldExtent);
    out.dy = wrap_delta_f(mobPos.y, n->y, kWorldExtent);
    out.dist = dist;
    out.noiseId = n->id;
    out.severity = n->severity;
    return out;
}

std::uint32_t investigate_step(Registry& reg, const NoiseField& field, NpcPool& pool,
                        LayerId layer, std::uint64_t tick) {
    // The gate that makes this system free. Almost every tick nothing is making a
    // noise, and on those ticks this pass does not touch a single entity.
    if (field.quiet()) return 0;

    const std::uint32_t phase = static_cast<std::uint32_t>(tick % kWanderPeriod);

    // The camera holder, resolved once per pass — and with the SAME faction gate
    // wander_step applies. If these two tests ever disagree, a mob is claimed by
    // both systems on the same tick and vibrates between its target and a sound.
    bool haveVictim = false;
    vec3 victimPos{0, 0, 0};
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        if (const NpcRef* nr = reg.try_get<NpcRef>(e))
            if (!mob_hostile_to(pool, nr->id)) continue;
        victimPos = t.pos;
        haveVictim = true;
        break;
    }

    std::uint32_t steered = 0;

    // MobRef is in the view, so this never touches a mob's storage that the view
    // does not already own, and nothing is emplaced or destroyed — no two-phase
    // collect-then-apply needed, and no per-tick allocation. Velocity is written the
    // same way wander_step writes it.
    auto view = reg.view<const MobRef, const Transform, Velocity>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;

        const std::uint32_t id = static_cast<std::uint32_t>(entt::to_integral(e));
        if (giga::hash_u32(id) % kWanderPeriod != phase) continue;

        const MobRef& mr = view.get<const MobRef>(e);
        const MobDef& md = kMobTable[mr.kind];
        // An immobile kind is architecture: a turret, a plant, a carpet. Steering it
        // toward a sound would only make it fight its own zero speed, and a spore
        // carpet that walks is a worse bug than one that ignores a gunshot.
        if (has_flag(md.aiFlags, AiFlag::Immobile)) continue;

        const MobBehaviour beh = static_cast<MobBehaviour>(md.behaviour);

        // Sight beats sound. Same radius, same behaviour override, same faction gate
        // as wander_step — a mob already coming for you is not distracted.
        if (haveVictim) {
            const float ax = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
            const float ay = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
            const float az = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
            const float radius = behaviour_aggro_radius(beh, kAggroRadius);
            if (ax * ax + ay * ay + az * az < radius * radius) continue;
        }

        const InvestigateHeard hh = investigate_hear(field, beh, layer, tr.pos, id);
        if (!hh.heard) continue;

        Velocity& vel = view.get<Velocity>(e);
        const float len = std::sqrt(hh.dx * hh.dx + hh.dy * hh.dy);
        if (hh.dist <= kInvestigateArriveRadius || len < 0.05f) {
            // Arrived. It stands at the sound rather than orbiting the point, which
            // is what "searching" looks like and is also the only stable answer:
            // steering at a target you are standing on is a normalize by zero.
            vel.v.x = 0.0f;
            vel.v.y = 0.0f;
            ++steered;
            continue;
        }

        // Full table speed, as the reference does — its investigation goal walks the
        // path at the monster's own speed and there is no authored "search pace" to
        // port. Inventing one would be a balance decision wearing a port's clothes.
        const float sp = static_cast<float>(md.speedMmps) * 0.001f * kCellSize;
        const bool fearsNoise = mob_fears_noise(beh, hh.severity);
        if (fearsNoise) {
            // Skittish mobs (e.g. GreenDogPack) flee AWAY from severe gunfire / explosions
            vel.v.x = -(hh.dx / len) * sp;
            vel.v.y = -(hh.dy / len) * sp;
        } else {
            vel.v.x = (hh.dx / len) * sp;
            vel.v.y = (hh.dy / len) * sp;
        }
        // z is left to gravity: this is locomotion, not flight. Same rule as
        // wander_step, and it is why a sound one storey up is heard (z counts toward
        // the distance) but cannot be walked to yet.
        ++steered;
    }
    return steered;
}

} // namespace giga::game
