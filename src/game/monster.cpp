#include "game/monster.h"

#include <cmath>
#include <algorithm>

#include "core/math.h"
#include "core/rng.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/embody.h"
#include "game/hunt.h"
#include "game/mob_spawn.h"
#include "game/wander.h"
#include "world/los.h"

namespace giga::game {

namespace {

DogPackTable g_dogPackTable{};

inline float clamp_f(float v, float lo, float hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

} // namespace

// ===========================================================================
// 1. Blind Dog Pack AI Implementation
// ===========================================================================

void dog_pack_init_table() {
    for (auto& slot : g_dogPackTable.packs) {
        slot = DogPackState{};
    }
}

DogPackState& dog_pack_get_state(std::uint8_t packId) {
    return g_dogPackTable.packs[packId];
}

bool dog_pack_is_retreating(std::uint8_t packId) {
    if (packId == 0) return false;
    const DogPackState& s = g_dogPackTable.packs[packId];
    return s.leaderEliminated && s.retreatTimer > 0.0f;
}

void dog_pack_on_leader_killed(std::uint8_t packId, float durationSec) {
    if (packId == 0) return;
    DogPackState& s = g_dogPackTable.packs[packId];
    s.leaderEliminated = true;
    s.retreatTimer = durationSec > 0.0f ? durationSec : 8.0f;
    s.leader = entt::null;
}

void dog_pack_on_member_killed(Registry& reg, Entity killedMob, std::uint8_t packId) {
    if (packId == 0) return;
    DogPackState& s = g_dogPackTable.packs[packId];
    if (s.leader == killedMob || !reg.valid(s.leader)) {
        dog_pack_on_leader_killed(packId, s.retreatDurationSec);
    }
}

void dog_pack_update(Registry& reg, LayerId layer, float dt, std::uint64_t tick) {
    // 1. Update pack table timers
    for (std::size_t i = 1; i < 256; ++i) {
        DogPackState& s = g_dogPackTable.packs[i];
        if (s.retreatTimer > 0.0f) {
            s.retreatTimer -= dt;
            if (s.retreatTimer < 0.0f) {
                s.retreatTimer = 0.0f;
            }
        }
        s.memberCount = 0;
    }

    // 2. Scan entities to maintain pack leader assignments and status
    auto dogView = reg.view<MobRef, Transform, Velocity>();
    for (auto e : dogView) {
        const Transform& tr = dogView.get<Transform>(e);
        if (tr.layer != layer) continue;

        MobRef& mr = dogView.get<MobRef>(e);
        const std::uint8_t pId = mr.pack;
        if (pId == 0) continue;

        const MobKind kind = static_cast<MobKind>(mr.kind);
        const bool isDogKind = (kind == MobKind::GreenDog ||
                                kMobTable[mr.kind].behaviour == static_cast<std::uint8_t>(MobBehaviour::GreenDogPack));
        if (!isDogKind) continue;

        DogPackState& state = g_dogPackTable.packs[pId];
        ++state.memberCount;

        BlindDogPackMember* member = reg.try_get<BlindDogPackMember>(e);
        if (!member) {
            BlindDogPackMember newMem{};
            newMem.circleAngleOffset = static_cast<float>((static_cast<std::uint32_t>(entt::to_integral(e)) % 8u) * (3.14159265f / 4.0f));
            newMem.circleRadius = 4.5f + static_cast<float>((static_cast<std::uint32_t>(entt::to_integral(e)) % 4u) * 0.5f);
            reg.emplace<BlindDogPackMember>(e, newMem);
            member = reg.try_get<BlindDogPackMember>(e);
        }

        // Leader election: lowest valid entity ID or designated leader
        if (!reg.valid(state.leader) && !state.leaderEliminated) {
            state.leader = e;
            if (member) member->isLeader = true;
        } else if (state.leader == e && member) {
            member->isLeader = true;
        } else if (member && state.leader != e) {
            member->isLeader = false;
        }

        // Propagate retreat state
        if (member) {
            member->isRetreating = (state.leaderEliminated && state.retreatTimer > 0.0f);
            member->retreatTimer = state.retreatTimer;
        }
    }
    (void)tick;
}

vec3 dog_pack_calculate_steer(Entity dogEntity, std::uint8_t packId, const vec3& dogPos,
                              const vec3& victimPos, float baseSpeed, std::uint64_t tick,
                              bool isRetreating) {
    const float dx = wrap_delta_f(dogPos.x, victimPos.x, kWorldExtent);
    const float dy = wrap_delta_f(dogPos.y, victimPos.y, kWorldExtent);
    const float distSq = dx * dx + dy * dy;
    const float dist = std::sqrt(distSq);

    if (dist < 1e-4f) {
        return vec3{baseSpeed, 0.0f, 0.0f};
    }

    const float udx = dx / dist;
    const float udy = dy / dist;

    // Retreat mode: pack leader killed -> flee directly away from prey/threat at high speed
    if (isRetreating || (packId != 0 && dog_pack_is_retreating(packId))) {
        const float fleeSpeed = baseSpeed * 1.35f;
        // Direction away from victim is -udx, -udy
        return vec3{-udx * fleeSpeed, -udy * fleeSpeed, 0.0f};
    }

    // Circling / Flanking mode around prey
    const std::uint32_t id = static_cast<std::uint32_t>(entt::to_integral(dogEntity));
    const float orbitRadius = 4.8f;
    const float slotAngle = static_cast<float>((id % 8u) * (3.14159265f / 4.0f));
    const float timeWobble = std::sin(static_cast<float>(tick) * 0.04f + static_cast<float>(id)) * 0.4f;
    const float totalAngle = slotAngle + timeWobble;

    // Feint / Attack lunging window: periodically one dog dashes straight into melee
    const bool isLunging = ((tick + id * 29u) % 150u) < 36u;
    if (isLunging || dist < 2.0f) {
        // Direct rapid approach
        const float lungeSpeed = baseSpeed * 1.25f;
        return vec3{udx * lungeSpeed, udy * lungeSpeed, 0.0f};
    }

    // Target position on the surrounding circle
    const float targetX = victimPos.x + std::cos(totalAngle) * orbitRadius;
    const float targetY = victimPos.y + std::sin(totalAngle) * orbitRadius;

    const float toCircleX = wrap_delta_f(dogPos.x, targetX, kWorldExtent);
    const float toCircleY = wrap_delta_f(dogPos.y, targetY, kWorldExtent);
    const float toCircleDist = std::sqrt(toCircleX * toCircleX + toCircleY * toCircleY);

    // Tangential circling vector
    const float perpSign = (id & 1u) ? 1.0f : -1.0f;
    const float tangX = -udy * perpSign;
    const float tangY = udx * perpSign;

    float steerX = 0.0f;
    float steerY = 0.0f;
    if (toCircleDist > 0.1f) {
        steerX = (toCircleX / toCircleDist) * 0.6f + tangX * 0.4f;
        steerY = (toCircleY / toCircleDist) * 0.6f + tangY * 0.4f;
    } else {
        steerX = tangX;
        steerY = tangY;
    }

    const float steerLen = std::sqrt(steerX * steerX + steerY * steerY);
    if (steerLen > 1e-4f) {
        steerX /= steerLen;
        steerY /= steerLen;
    }

    return vec3{steerX * baseSpeed, steerY * baseSpeed, 0.0f};
}

// ===========================================================================
// 2. Burer AI Implementation
// ===========================================================================

bool burer_trigger_shield(BurerAi& burer, ParticleBurstQueue* particles, const vec3& pos) {
    if (burer.shieldCooldown > 0.0f && !burer.shieldActive) {
        return false;
    }
    burer.shieldActive = true;
    burer.shieldTimer = burer.shieldDuration;
    burer.shieldCooldown = burer.shieldCooldownTime;

    if (particles) {
        particles->push(pos + vec3{0.0f, 0.0f, 0.8f}, vec3{0.0f, 0.0f, 0.5f},
                        ParticleKind::Spark, 20, 0, 0x811c9dc5u);
    }
    return true;
}

std::int16_t burer_mitigate_damage(BurerAi& burer, DamageChannel channel, std::int16_t rawDmg,
                                   const vec3& pos, ParticleBurstQueue* particles) {
    // Check if ranged/kinetic fire triggers shield
    if (channel == DamageChannel::Kinetic || channel == DamageChannel::Buckshot) {
        if (!burer.shieldActive && burer.shieldCooldown <= 0.0f) {
            burer_trigger_shield(burer, particles, pos);
        }
    }

    if (!burer.shieldActive) {
        return rawDmg;
    }

    // Kinetic shield absorbs 95% of incoming kinetic/buckshot damage
    if (channel == DamageChannel::Kinetic || channel == DamageChannel::Buckshot) {
        const float mult = 1.0f - burer.shieldMitigationPct;
        int mitigated = static_cast<int>(static_cast<float>(rawDmg) * mult + 0.5f);
        if (mitigated < 1 && rawDmg > 0) mitigated = 1;

        if (particles) {
            particles->push(pos + vec3{0.0f, 0.0f, 0.8f}, vec3{0.0f, 0.0f, 0.6f},
                            ParticleKind::Spark, 14, 0, 0x9e3779b9u);
        }
        return static_cast<std::int16_t>(mitigated);
    }

    return rawDmg;
}

void burer_telekinetic_pushback(Registry& reg, Entity burerEntity, const vec3& burerPos,
                                LayerId layer, float radius, float force,
                                ParticleBurstQueue* particles, NoiseField* noise) {
    const float radiusSq = radius * radius;

    // 1. Deflect all in-flight projectiles within radius
    auto projView = reg.view<Projectile, Transform, Velocity>();
    for (auto pe : projView) {
        Transform& ptr = projView.get<Transform>(pe);
        if (ptr.layer != layer) continue;

        const float dx = wrap_delta_f(burerPos.x, ptr.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(burerPos.y, ptr.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(burerPos.z, ptr.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > radiusSq || d2 < 1e-4f) continue;

        const float d = std::sqrt(d2);
        const float udx = dx / d;
        const float udy = dy / d;
        const float udz = dz / d;

        Velocity& pv = projView.get<Velocity>(pe);
        const float currSpeed = std::sqrt(pv.v.x * pv.v.x + pv.v.y * pv.v.y + pv.v.z * pv.v.z);
        constexpr float kMaxProjSpeed = 40.0f;
        const float newSpeed = std::min(kMaxProjSpeed, currSpeed > 10.0f ? currSpeed + 5.0f : 25.0f);

        // Invert and repel projectile trajectory away from Burer
        pv.v.x = udx * newSpeed;
        pv.v.y = udy * newSpeed;
        pv.v.z = udz * newSpeed;

        // Re-attribute projectile to Burer
        Projectile& proj = projView.get<Projectile>(pe);
        proj.source = burerEntity;

        if (particles) {
            particles->push(ptr.pos, vec3{udx * 2.0f, udy * 2.0f, 0.5f},
                            ParticleKind::Spark, 12, 0, 0x5bf03635u);
        }
    }

    // 2. Apply telekinetic pushback shockwave to nearby physical entities (excluding projectiles)
    auto bodyView = reg.view<Transform, Velocity>();
    for (auto be : bodyView) {
        if (be == burerEntity) continue;
        if (reg.all_of<Dead>(be)) continue;
        if (reg.all_of<Projectile>(be)) continue;

        Transform& btr = bodyView.get<Transform>(be);
        if (btr.layer != layer) continue;

        const float dx = wrap_delta_f(burerPos.x, btr.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(burerPos.y, btr.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(burerPos.z, btr.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > radiusSq || d2 < 1e-4f) continue;

        const float d = std::sqrt(d2);
        const float falloff = 1.0f - (d / radius);

        float massKg = 70.0f;
        if (const Mass* m = reg.try_get<Mass>(be)) massKg = std::max(10.0f, m->kg);
        const float massScale = 70.0f / massKg;
        const float impulse = force * falloff * massScale;

        Velocity& bv = bodyView.get<Velocity>(be);
        bv.v.x += (dx / d) * impulse;
        bv.v.y += (dy / d) * impulse;
        bv.v.z += std::max(0.0f, (dz / d) * impulse * 0.4f);

        // Clamp entity speed to prevent physics tunneling
        constexpr float kMaxPushSpeed = 22.0f;
        const float speed = std::sqrt(bv.v.x * bv.v.x + bv.v.y * bv.v.y + bv.v.z * bv.v.z);
        if (speed > kMaxPushSpeed) {
            const float invSp = kMaxPushSpeed / speed;
            bv.v.x *= invSp;
            bv.v.y *= invSp;
            bv.v.z *= invSp;
        }
    }

    if (particles) {
        particles->push(burerPos + vec3{0.0f, 0.0f, 0.7f}, vec3{0.0f, 0.0f, 1.0f},
                        ParticleKind::Spark, 24, 0, 0x12345678u);
    }
    if (noise) {
        noise_publish(*noise, layer, burerPos,
                      NoiseProfile{14.0f, 1500, 4, NoiseSource::Explosion},
                      static_cast<std::uint32_t>(entt::to_integral(burerEntity)));
    }
}

void burer_update(Registry& reg, LevelStack& stack, LayerId layer, float dt,
                  std::uint64_t tick, ParticleBurstQueue* particles, NoiseField* noise) {
    auto burerView = reg.view<BurerAi, Transform, MobRef>();
    for (auto e : burerView) {
        const Transform& tr = burerView.get<Transform>(e);
        if (tr.layer != layer) continue;

        BurerAi& burer = burerView.get<BurerAi>(e);

        // Update shield timer
        if (burer.shieldTimer > 0.0f) {
            burer.shieldTimer -= dt;
            if (burer.shieldTimer <= 0.0f) {
                burer.shieldTimer = 0.0f;
                burer.shieldActive = false;
            }
        }
        if (burer.shieldCooldown > 0.0f) {
            burer.shieldCooldown -= dt;
            if (burer.shieldCooldown < 0.0f) {
                burer.shieldCooldown = 0.0f;
            }
        }

        // Update telekinesis pushback cooldown
        if (burer.pushbackCooldown > 0.0f) {
            burer.pushbackCooldown -= dt;
            if (burer.pushbackCooldown < 0.0f) {
                burer.pushbackCooldown = 0.0f;
            }
        }

        // Telekinetic pushback check
        if (burer.pushbackCooldown <= 0.0f) {
            bool hasThreatNearby = false;
            // Check for nearby incoming projectiles
            auto pView = reg.view<const Projectile, const Transform>();
            for (auto pe : pView) {
                const Transform& ptr = pView.get<const Transform>(pe);
                if (ptr.layer != layer) continue;
                const float dx = wrap_delta_f(tr.pos.x, ptr.pos.x, kWorldExtent);
                const float dy = wrap_delta_f(tr.pos.y, ptr.pos.y, kWorldExtent);
                const float dz = wrap_delta_f(tr.pos.z, ptr.pos.z, kWorldExtent);
                if (dx * dx + dy * dy + dz * dz <= burer.telekinesisRadius * burer.telekinesisRadius) {
                    hasThreatNearby = true;
                    break;
                }
            }

            // Check for nearby player / camera holder
            if (!hasThreatNearby) {
                for (auto ce : reg.view<const CameraTag, const Transform>()) {
                    const Transform& ctr = reg.get<const Transform>(ce);
                    if (ctr.layer != layer) continue;
                    const float dx = wrap_delta_f(tr.pos.x, ctr.pos.x, kWorldExtent);
                    const float dy = wrap_delta_f(tr.pos.y, ctr.pos.y, kWorldExtent);
                    if (dx * dx + dy * dy <= 6.0f * 6.0f) {
                        hasThreatNearby = true;
                        break;
                    }
                }
            }

            if (hasThreatNearby) {
                burer_telekinetic_pushback(reg, e, tr.pos, layer, burer.telekinesisRadius,
                                           burer.pushbackForce, particles, noise);
                burer.pushbackCooldown = 3.5f;
            }
        }
    }
    (void)stack;
    (void)tick;
}

// ===========================================================================
// 3. Snork AI Implementation
// ===========================================================================

bool snork_is_in_recovery(const SnorkAi& snork) {
    return snork.state == SnorkLeapState::Recovery || snork.state == SnorkLeapState::Windup;
}

bool snork_calculate_leap(const vec3& from, const vec3& to, float gravityMag,
                          float speed, float extraArc, vec3& outVel, float& outTof) {
    const float dx = wrap_delta_f(from.x, to.x, kWorldExtent);
    const float dy = wrap_delta_f(from.y, to.y, kWorldExtent);
    const float dz = wrap_delta_f(from.z, to.z, kWorldExtent);
    const float distXY = std::sqrt(dx * dx + dy * dy);

    if (distXY < 0.5f) return false;

    float sp = speed > 1.0f ? speed : 14.0f;
    float tof = distXY / sp;
    tof = clamp_f(tof, 0.45f, 1.25f);

    outTof = tof;
    outVel.x = dx / tof;
    outVel.y = dy / tof;
    // Ballistic high vertical arc equation: vz = dz/tof + 0.5 * g * tof + extraArc
    const float g = gravityMag > 0.1f ? gravityMag : 9.81f;
    outVel.z = (dz / tof) + 0.5f * g * tof + extraArc;
    return true;
}

void snork_update(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                  LevelStack& stack, LayerId layer, float dt, std::uint64_t tick,
                  ParticleBurstQueue* particles, NoiseField* noise) {
    Entity player = entt::null;
    vec3 playerPos{0, 0, 0};
    for (auto ce : reg.view<const CameraTag, const Transform>()) {
        const Transform& ctr = reg.get<const Transform>(ce);
        if (ctr.layer != layer) continue;
        player = ce;
        playerPos = ctr.pos;
        break;
    }

    const float gravityMag = 9.81f;

    auto snorkView = reg.view<SnorkAi, Transform, Velocity, MobRef>();
    for (auto e : snorkView) {
        Transform& tr = snorkView.get<Transform>(e);
        if (tr.layer != layer) continue;

        SnorkAi& snork = snorkView.get<SnorkAi>(e);
        Velocity& vel = snorkView.get<Velocity>(e);

        if (snork.leapCooldown > 0.0f) {
            snork.leapCooldown -= dt;
            if (snork.leapCooldown < 0.0f) snork.leapCooldown = 0.0f;
        }

        // Find potential victim (player first, or nearest prey)
        Entity victim = player;
        vec3 victimPos = playerPos;
        if (victim == entt::null) {
            const Prey pr = nearest_prey(reg, pool, layer, tr.pos, snork.maxLeapDist);
            if (pr.e != entt::null) {
                victim = pr.e;
                victimPos = pr.pos;
            }
        }

        switch (snork.state) {
            case SnorkLeapState::Idle: {
                if (snork.leapCooldown <= 0.0f && victim != entt::null) {
                    const float dx = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
                    const float dy = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
                    const float dz = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
                    const float distSq = dx * dx + dy * dy + dz * dz;

                    if (distSq >= snork.minLeapDist * snork.minLeapDist &&
                        distSq <= snork.maxLeapDist * snork.maxLeapDist) {
                        if (los_clear(grid, tr.pos, victimPos)) {
                            snork.state = SnorkLeapState::Windup;
                            snork.stateTimer = snork.windupDuration;
                            snork.leapTarget = victimPos;
                            // Freeze horizontal velocity during crouch windup
                            vel.v.x = 0.0f;
                            vel.v.y = 0.0f;
                        }
                    }
                }
                break;
            }

            case SnorkLeapState::Windup: {
                snork.stateTimer -= dt;
                vel.v.x = 0.0f;
                vel.v.y = 0.0f;

                if (snork.stateTimer <= 0.0f) {
                    vec3 launchVel{0, 0, 0};
                    float tof = 0.0f;
                    if (snork_calculate_leap(tr.pos, snork.leapTarget, gravityMag,
                                             snork.leapSpeed, snork.extraVerticalArc,
                                             launchVel, tof)) {
                        snork.state = SnorkLeapState::Airborne;
                        snork.stateTimer = tof;
                        snork.leapVelocity = launchVel;
                        snork.hitVictimOnLanding = false;
                        vel.v = launchVel;

                        if (particles) {
                            particles->push(tr.pos, vec3{0.0f, 0.0f, 1.0f},
                                            ParticleKind::Debris, 10, 0, 0x9e3779b9u);
                        }
                        if (noise) {
                            noise_publish(*noise, layer, tr.pos,
                                          NoiseProfile{10.0f, 1000, 3, NoiseSource::Footstep},
                                          static_cast<std::uint32_t>(entt::to_integral(e)));
                        }
                    } else {
                        snork.state = SnorkLeapState::Idle;
                        snork.leapCooldown = 1.5f;
                    }
                }
                break;
            }

            case SnorkLeapState::Airborne: {
                snork.stateTimer -= dt;

                // Check landing / collision with target
                float dist = 100.0f;
                if (victim != entt::null) {
                    const float dx = wrap_delta_f(tr.pos.x, victimPos.x, kWorldExtent);
                    const float dy = wrap_delta_f(tr.pos.y, victimPos.y, kWorldExtent);
                    const float dz = wrap_delta_f(tr.pos.z, victimPos.z, kWorldExtent);
                    dist = std::sqrt(dx * dx + dy * dy + dz * dz);

                    if (!snork.hitVictimOnLanding && dist < 1.8f) {
                        apply_damage(reg, pool, victim, static_cast<std::int16_t>(snork.leapDamage),
                                     DamageChannel::Kinetic, e, &grid, particles);
                        snork.hitVictimOnLanding = true;
                    }
                }

                // Check grounded or obstacle contact
                const GravityAffected* ga = reg.try_get<GravityAffected>(e);
                const bool touchGround = (ga && ga->grounded && snork.stateTimer < 0.25f);
                const bool impactHit = reg.all_of<Impact>(e);

                if (snork.stateTimer <= 0.0f || touchGround || impactHit || (dist < 1.4f && snork.hitVictimOnLanding)) {
                    snork.state = SnorkLeapState::Recovery;
                    snork.stateTimer = snork.recoveryDuration;
                    vel.v.x = 0.0f;
                    vel.v.y = 0.0f;
                    vel.v.z = 0.0f;

                    if (particles) {
                        particles->push(tr.pos, vec3{0.0f, 0.0f, 0.8f},
                                        ParticleKind::Debris, 14, 0, 0x12345678u);
                    }
                }
                break;
            }

            case SnorkLeapState::Recovery: {
                snork.stateTimer -= dt;
                // Halt movement during crouch recovery window
                vel.v.x = 0.0f;
                vel.v.y = 0.0f;

                if (snork.stateTimer <= 0.0f) {
                    snork.state = SnorkLeapState::Idle;
                    snork.leapCooldown = 3.0f;
                }
                break;
            }
        }
    }
    (void)stack;
    (void)tick;
}

// ===========================================================================
// 4. Bloodsucker AI Implementation
// ===========================================================================

bool bloodsucker_is_cloaked(const BloodsuckerAi& bs) {
    return bs.isCloaked || bs.cloakAlpha < 0.3f;
}

float bloodsucker_evaluate_strike(BloodsuckerAi& bs, const vec3& attackerPos,
                                 const vec3& victimPos, float victimFwdX, float victimFwdY,
                                 ParticleBurstQueue* particles) {
    // Uncloak immediately upon striking
    bs.isCloaked = false;
    bs.state = BloodsuckerState::Attacking;
    bs.cloakAlpha = 1.0f;
    bs.uncloakTimer = 2.8f;

    // Vector from attacker to victim
    const float toVictimX = wrap_delta_f(attackerPos.x, victimPos.x, kWorldExtent);
    const float toVictimY = wrap_delta_f(attackerPos.y, victimPos.y, kWorldExtent);
    const float dist = std::sqrt(toVictimX * toVictimX + toVictimY * toVictimY);

    if (dist < 1e-4f) return 1.0f;

    const float udx = toVictimX / dist;
    const float udy = toVictimY / dist;

    // Dot product with victim forward: if > 0.2, attacker is behind victim (backstab ambush)
    const float backstabDot = udx * victimFwdX + udy * victimFwdY;
    if (backstabDot > 0.2f) {
        if (particles) {
            particles->push(victimPos + vec3{0.0f, 0.0f, 0.9f}, vec3{0.0f, 0.0f, 1.2f},
                            ParticleKind::Blood, 24, 0, 0xdeadbeefu);
        }
        return bs.backstabMultiplier;
    }

    return 1.0f;
}

void bloodsucker_update(Registry& reg, LayerId layer, float dt, std::uint64_t tick,
                        ParticleBurstQueue* particles, NoiseField* noise) {
    Entity player = entt::null;
    vec3 playerPos{0, 0, 0};
    for (auto ce : reg.view<const CameraTag, const Transform>()) {
        const Transform& ctr = reg.get<const Transform>(ce);
        if (ctr.layer != layer) continue;
        player = ce;
        playerPos = ctr.pos;
        break;
    }

    auto bsView = reg.view<BloodsuckerAi, Transform, MobRef, Renderable>();
    for (auto e : bsView) {
        const Transform& tr = bsView.get<Transform>(e);
        if (tr.layer != layer) continue;

        BloodsuckerAi& bs = bsView.get<BloodsuckerAi>(e);
        Renderable& rend = bsView.get<Renderable>(e);

        if (bs.uncloakTimer > 0.0f) {
            bs.uncloakTimer -= dt;
            if (bs.uncloakTimer < 0.0f) bs.uncloakTimer = 0.0f;
        }

        float distToPrey = 100.0f;
        if (player != entt::null) {
            const float dx = wrap_delta_f(tr.pos.x, playerPos.x, kWorldExtent);
            const float dy = wrap_delta_f(tr.pos.y, playerPos.y, kWorldExtent);
            const float dz = wrap_delta_f(tr.pos.z, playerPos.z, kWorldExtent);
            distToPrey = std::sqrt(dx * dx + dy * dy + dz * dz);
        }

        // Cloaking / Uncloaking state machine
        if (bs.uncloakTimer <= 0.0f && distToPrey >= bs.cloakDistance) {
            // Stalking from distance -> fade into cloak / invisibility
            bs.isCloaked = true;
            bs.state = BloodsuckerState::StalkingCloaked;
            bs.cloakAlpha = std::max(0.05f, bs.cloakAlpha - dt * 2.5f);
        } else if (distToPrey <= bs.decloakDistance || bs.uncloakTimer > 0.0f) {
            // Close in for strike or engaged -> uncloak to full visibility
            bs.isCloaked = false;
            bs.state = BloodsuckerState::Visible;
            bs.cloakAlpha = std::min(1.0f, bs.cloakAlpha + dt * 4.0f);
        }

        // Apply cosmetic alpha fading to Renderable body tint
        rend.color = vec3{
            bs.originalColor.x * bs.cloakAlpha,
            bs.originalColor.y * bs.cloakAlpha,
            bs.originalColor.z * bs.cloakAlpha
        };
    }
    (void)noise;
    (void)particles;
    (void)tick;
}

// ===========================================================================
// Unified Specialized Monster ALife Entry Points
// ===========================================================================

void monster_special_init_entity(Registry& reg, Entity e, MobKind kind) {
    if (!reg.valid(e)) return;

    if (kind == MobKind::GreenDog) {
        if (!reg.all_of<BlindDogPackMember>(e)) {
            reg.emplace<BlindDogPackMember>(e);
        }
    }
    // Burer archetype
    else if (kind == MobKind::Creator || kind == MobKind::Idol || kind == MobKind::KantselyarskiyIdol) {
        if (!reg.all_of<BurerAi>(e)) {
            reg.emplace<BurerAi>(e);
        }
    }
    // Snork archetype
    else if (kind == MobKind::Polzun || kind == MobKind::Kostorez) {
        if (!reg.all_of<SnorkAi>(e)) {
            reg.emplace<SnorkAi>(e);
        }
    }
    // Bloodsucker archetype
    else if (kind == MobKind::Shadow || kind == MobKind::GlubinnayaTen || kind == MobKind::TonkayaTen) {
        if (!reg.all_of<BloodsuckerAi>(e)) {
            BloodsuckerAi bs{};
            if (const Renderable* rend = reg.try_get<Renderable>(e)) {
                bs.originalColor = rend->color;
            }
            reg.emplace<BloodsuckerAi>(e, bs);
        }
    }
}

void monster_special_step(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                          LevelStack& stack, LayerId layer, float dt,
                          std::uint64_t tick, ParticleBurstQueue* particles,
                          NoiseField* noise) {
    dog_pack_update(reg, layer, dt, tick);
    burer_update(reg, stack, layer, dt, tick, particles, noise);
    snork_update(reg, grid, pool, stack, layer, dt, tick, particles, noise);
    bloodsucker_update(reg, layer, dt, tick, particles, noise);
}

} // namespace giga::game
