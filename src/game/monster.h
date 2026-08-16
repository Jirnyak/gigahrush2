// Specialized monster behavior routines & ALife state machines:
// 1. Blind Dog Pack AI: Pack coordination, circling behavior around prey, retreat on leader death.
// 2. Burer AI: Kinetic shield activation when taking ranged fire, telekinetic projectile pushback.
// 3. Snork AI: Leap attack calculation with high vertical arc, crouch-pounce recovery.
// 4. Bloodsucker AI: Invisibility/cloaking state transition when stalking, uncloak on backstab/strike.
//
// Zero dynamic allocations, deterministic updates, strict POD component design.
#pragma once

#include <cstdint>
#include "core/math.h"
#include "ecs/registry.h"
#include "ecs/components.h"
#include "game/combat.h"
#include "game/mob_table.h"
#include "world/types.h"
#include "world/macro_grid.h"
#include "world/level_stack.h"
#include "game/noise.h"

namespace giga::game {

class NpcPool;

// ===========================================================================
// 1. Blind Dog Pack AI
// ===========================================================================

struct BlindDogPackMember {
    bool isLeader = false;
    float circleAngleOffset = 0.0f; // Angular offset around prey (radians)
    float circleRadius = 5.0f;      // Preferred circling distance (metres)
    float retreatTimer = 0.0f;      // Remaining retreat duration (seconds)
    bool isRetreating = false;      // True if fleeing because leader died
};

struct DogPackState {
    Entity leader = entt::null;
    bool leaderEliminated = false;
    float retreatDurationSec = 8.0f;
    float retreatTimer = 0.0f;
    std::uint32_t memberCount = 0;
    std::uint64_t lastAlertTick = 0;
    vec3 lastPreyPos{0, 0, 0};
    std::uint32_t preyEntityId = 0;
    bool hasActivePrey = false;
};

// Global pack coordination table for up to 256 packs
struct DogPackTable {
    DogPackState packs[256]{};
};

void dog_pack_init_table();
DogPackState& dog_pack_get_state(std::uint8_t packId);
void dog_pack_update(Registry& reg, LayerId layer, float dt, std::uint64_t tick);
bool dog_pack_is_retreating(std::uint8_t packId);
void dog_pack_on_leader_killed(std::uint8_t packId, float durationSec = 8.0f);
void dog_pack_on_member_killed(Registry& reg, Entity killedMob, std::uint8_t packId);
vec3 dog_pack_calculate_steer(Entity dogEntity, std::uint8_t packId, const vec3& dogPos,
                              const vec3& victimPos, float baseSpeed, std::uint64_t tick,
                              bool isRetreating);

// ===========================================================================
// 2. Burer AI
// ===========================================================================

struct BurerAi {
    float shieldTimer = 0.0f;          // Active shield duration remaining (s)
    float shieldCooldown = 0.0f;       // Cooldown before shield can reactivate (s)
    float pushbackCooldown = 0.0f;     // Cooldown between telekinetic pulses (s)
    bool shieldActive = false;         // True when kinetic shield is active
    float shieldDuration = 3.5f;       // Authored shield duration (s)
    float shieldCooldownTime = 5.0f;   // Authored cooldown (s)
    float shieldMitigationPct = 0.95f; // 95% kinetic/projectile mitigation
    float telekinesisRadius = 12.0f;   // Pushback & deflection radius (m)
    float pushbackForce = 22.0f;       // Telekinetic pushback speed impulse (m/s)
};

void burer_update(Registry& reg, LevelStack& stack, LayerId layer, float dt,
                  std::uint64_t tick, ParticleBurstQueue* particles, NoiseField* noise);
bool burer_trigger_shield(BurerAi& burer, ParticleBurstQueue* particles, const vec3& pos);
std::int16_t burer_mitigate_damage(BurerAi& burer, DamageChannel channel, std::int16_t rawDmg,
                                   const vec3& pos, ParticleBurstQueue* particles);
void burer_telekinetic_pushback(Registry& reg, Entity burerEntity, const vec3& burerPos,
                                LayerId layer, float radius, float force,
                                ParticleBurstQueue* particles, NoiseField* noise);

// ===========================================================================
// 3. Snork AI
// ===========================================================================

enum class SnorkLeapState : std::uint8_t {
    Idle = 0,
    Windup,     // Crouched preparation for leap (0.35s)
    Airborne,   // Ballistic leap with high vertical arc
    Recovery    // Crouched landing recovery (0.9s)
};

struct SnorkAi {
    SnorkLeapState state = SnorkLeapState::Idle;
    float stateTimer = 0.0f;
    float leapCooldown = 0.0f;
    vec3 leapTarget{0, 0, 0};
    vec3 leapVelocity{0, 0, 0};
    float minLeapDist = 3.5f;       // Minimum distance to trigger leap (m)
    float maxLeapDist = 14.0f;      // Maximum distance for leap attack (m)
    float leapSpeed = 15.0f;        // Base horizontal launch speed (m/s)
    float extraVerticalArc = 5.5f;  // Extra vertical velocity boost for high parabolic arc (m/s)
    float windupDuration = 0.35f;   // Windup crouch duration (s)
    float recoveryDuration = 0.90f; // Landing recovery crouch duration (s)
    float leapDamage = 28.0f;       // Landing pounce damage
    bool hitVictimOnLanding = false;
};

void snork_update(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                  LevelStack& stack, LayerId layer, float dt, std::uint64_t tick,
                  ParticleBurstQueue* particles, NoiseField* noise);
bool snork_is_in_recovery(const SnorkAi& snork);
bool snork_calculate_leap(const vec3& from, const vec3& to, float gravityMag,
                          float speed, float extraArc, vec3& outVel, float& outTof);

// ===========================================================================
// 4. Bloodsucker AI
// ===========================================================================

enum class BloodsuckerState : std::uint8_t {
    Visible = 0,
    StalkingCloaked,  // Cloaked/invisible while stalking prey from distance (> 3m)
    Uncloaking,       // Materializing immediately before attack (0.2s)
    Attacking,        // Fully visible during melee frenzy
    FadeToCloak       // Fading back into invisibility after hit/cooldown
};

struct BloodsuckerAi {
    BloodsuckerState state = BloodsuckerState::Visible;
    float stateTimer = 0.0f;
    float cloakAlpha = 1.0f;          // 1.0 = visible, 0.05 = near invisible
    float uncloakTimer = 0.0f;        // Time to stay visible after attacking (s)
    float backstabMultiplier = 2.2f;  // Damage multiplier when striking from behind/stealth
    float decloakDistance = 2.8f;     // Distance to decloak when closing in (m)
    float cloakDistance = 4.0f;       // Distance to cloak when stalking (m)
    bool isCloaked = false;
    vec3 originalColor{0.8f, 0.8f, 0.82f};
};

void bloodsucker_update(Registry& reg, LayerId layer, float dt, std::uint64_t tick,
                        ParticleBurstQueue* particles, NoiseField* noise);
bool bloodsucker_is_cloaked(const BloodsuckerAi& bs);
float bloodsucker_evaluate_strike(BloodsuckerAi& bs, const vec3& attackerPos,
                                 const vec3& victimPos, float victimFwdX, float victimFwdY,
                                 ParticleBurstQueue* particles);

// ===========================================================================
// Unified Specialized Monster ALife Entry Points
// ===========================================================================

void monster_special_init_entity(Registry& reg, Entity e, MobKind kind);
void monster_special_step(Registry& reg, const MacroGrid& grid, NpcPool& pool,
                          LevelStack& stack, LayerId layer, float dt,
                          std::uint64_t tick, ParticleBurstQueue* particles,
                          NoiseField* noise);

} // namespace giga::game
