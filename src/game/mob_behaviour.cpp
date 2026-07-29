#include "game/mob_behaviour.h"

#include <cmath>

namespace giga::game {

namespace {

// Reference constants, cited so they can be checked without reopening the source.
constexpr float kSurroundRadius = 1.65f;   // PomoynyRoy ring radius
constexpr float kSurroundBehind = -1.15f;  // its solid-cell fallback
constexpr float kFlankPerp = 1.7f;         // GreenDog perpendicular offset
constexpr float kFlankBehind = 1.2f;       // the one-in-four that cuts behind

// The reference's own ring: 8 slots, chosen by a multiplicative hash of the mob id
// xored with the target id. Precomputed unit vectors rather than a sin/cos per
// monster per tick — the angles never change.
constexpr float kRing[8][2] = {
    { 1.0000000f,  0.0000000f},
    { 0.7071068f,  0.7071068f},
    { 0.0000000f,  1.0000000f},
    {-0.7071068f,  0.7071068f},
    {-1.0000000f,  0.0000000f},
    {-0.7071068f, -0.7071068f},
    { 0.0000000f, -1.0000000f},
    { 0.7071068f, -0.7071068f},
};

} // namespace

PursuitOffset pursuit_offset(MobBehaviour b, std::uint32_t mobId,
                             std::uint32_t victimId, float dirX, float dirY) {
    switch (b) {
        case MobBehaviour::GarbageSurround: {
            // Deterministic and stable: the same monster always takes the same slot
            // against the same target, so the ring does not shimmer frame to frame.
            // That stability is the reason it is a hash of ids rather than of the
            // tick — a per-tick reroll would look like jitter, not encirclement.
            const std::uint32_t slot =
                ((mobId * 1103515245u) ^ victimId) & 7u;
            return {kRing[slot][0] * kSurroundRadius,
                    kRing[slot][1] * kSurroundRadius};
        }
        case MobBehaviour::GreenDogPack: {
            if (dirX == 0.0f && dirY == 0.0f) return {};
            // One dog in four cuts in behind instead of flanking, so a pack does not
            // read as a perfectly symmetric pincer.
            if ((mobId & 3u) == 0u)
                return {-dirX * kFlankBehind, -dirY * kFlankBehind};
            // Perpendicular to the approach; side from the low bit of the id, which
            // splits the pack roughly evenly with no coordination and no state.
            const float s = (mobId & 1u) ? 1.0f : -1.0f;
            return {-dirY * kFlankPerp * s, dirX * kFlankPerp * s};
        }
        default:
            return {};
    }
}

float behaviour_aggro_radius(MobBehaviour b, float defaultRadius) {
    // Ordered by radius, not by enum, so the whole authored spread is readable as a
    // column and a duplicated or transposed number is visible on sight. Every value
    // is `monsterDetectSq`'s, square-rooted; see the table in [mob_behaviour.h] for
    // the reference constant each one comes from.
    //
    // `SourceSwarm` is deliberately ABSENT even though the reference has a case for
    // it: `SWARM_DETECT_SQ` is 20*20 and the global `MONSTER_DETECT` is 20, so a case
    // here would return `defaultRadius` by a longer route and make a dead behaviour
    // look dispatched. Measured, not assumed — it is why `behaviour_is_dead` still
    // names it.
    switch (b) {
        case MobBehaviour::LurkingFurniture: return 2.15f;  // dormant, not awake
        case MobBehaviour::CloseReveal:      return 6.0f;
        case MobBehaviour::DeadEcho:         return 7.5f;
        case MobBehaviour::RootedPlant:      return 7.5f;
        case MobBehaviour::RootHive:         return 8.25f;
        case MobBehaviour::GarbageSurround:  return 13.0f;
        case MobBehaviour::OfficeField:      return 23.0f;
        case MobBehaviour::DocumentHunter:   return 24.0f;
        case MobBehaviour::ProtocolPressure: return 26.0f;
        case MobBehaviour::DocumentScent:    return 28.0f;
        case MobBehaviour::LightFollower:    return 30.0f;
        default:                             return defaultRadius;
    }
}

bool frozen_by_gaze(MobBehaviour b, float fwdX, float fwdY, float dx, float dy) {
    if (b != MobBehaviour::WeepingAngel) return false;
    const float d2 = dx * dx + dy * dy;
    if (d2 > kGazeRange * kGazeRange) return false;
    if (d2 < 1e-6f) return true;   // standing inside it counts as looking at it
    const float inv = 1.0f / std::sqrt(d2);
    const float dot = (dx * inv) * fwdX + (dy * inv) * fwdY;
    return dot >= kGazeCosHalfAngle;
}

float wall_bias_speed(std::uint32_t aiFlags, bool adjacentWall) {
    if (!(aiFlags & static_cast<std::uint32_t>(AiFlag::WallBias))) return 1.0f;
    return adjacentWall ? kWallBiasSpeedNear : kWallBiasSpeedOpen;
}

float wall_bias_damage(std::uint32_t aiFlags, bool adjacentWall) {
    if (!(aiFlags & static_cast<std::uint32_t>(AiFlag::WallBias))) return 1.0f;
    return adjacentWall ? kWallBiasDamage : 1.0f;
}

MoveMult behaviour_move_mult(MobBehaviour b, bool adjacentWall) {
    switch (b) {
        case MobBehaviour::DebrisLurker:
            // Арматура also carries AiFlag::WallBias, and this CLAIMS the pace so the
            // flag's 1.18/0.92 is skipped rather than compounded — the reference's
            // `monsterMoveMult` returns here before it reaches its wallBias branch.
            return {adjacentWall ? kDebrisCoverSpeed : kDebrisOpenSpeed, true};
        case MobBehaviour::WallBrace:
            return {adjacentWall ? kWallBraceSpeed : kWallBraceOpenSpeed, true};
        default:
            return {};
    }
}

float behaviour_damage_mult(MobBehaviour b, bool adjacentWall) {
    switch (b) {
        case MobBehaviour::DebrisLurker:
            return adjacentWall ? kDebrisCoverDamage : kDebrisOpenDamage;
        default:
            return 1.0f;
    }
}

bool wall_query_needed(std::uint32_t aiFlags, MobBehaviour b) {
    if (aiFlags & static_cast<std::uint32_t>(AiFlag::WallBias)) return true;
    return b == MobBehaviour::DebrisLurker || b == MobBehaviour::WallBrace;
}

bool behaviour_is_dead(MobBehaviour b) {
    switch (b) {
        // No reader anywhere in the reference; identical to Plain.
        case MobBehaviour::Melee:
        // No AI implementation to port — only a scripted floor encounter. Also
        // architecturally impossible: destructible geometry would invalidate the
        // per-floor baked flow fields.
        case MobBehaviour::WeakWallBreach:
        // Read at exactly one line, to set a scan cooldown. Nothing to dispatch;
        // the generic ranged path already covers this kind.
        case MobBehaviour::RangedClause:
        // The behaviour is a spawner subsystem keyed on monster stage, not on this
        // flag. Wave 1 added "the flag itself is only a detect radius", which reads
        // as though there were a radius to port; MEASURED, there is not —
        // `SWARM_DETECT_SQ` is 20*20 and the global `MONSTER_DETECT` is 20, the same
        // number, so the flag's only mechanical reader returns the default.
        case MobBehaviour::SourceSwarm:
            return true;
        default:
            return false;
    }
}

bool behaviour_is_dispatched(MobBehaviour b) {
    // The declared inverse of `behaviour_is_dead`, and NOT its negation: 27
    // enumerators are neither dead nor dispatched — authored, portable, and each
    // waiting on one named piece (the roadmap block in [mob_behaviour.h]).
    //
    // Hand-listed rather than derived from the dispatchers, on purpose. Deriving it
    // would make it true by construction and prove nothing; as a separate list,
    // `test_behaviours_all` compares it against what the dispatchers actually return,
    // so a claim that outran the code fails the suite.
    switch (b) {
        // Wave 1 — pursuit offset, gaze freeze, two short radii.
        case MobBehaviour::GarbageSurround:
        case MobBehaviour::GreenDogPack:
        case MobBehaviour::WeepingAngel:
        case MobBehaviour::DeadEcho:
        case MobBehaviour::CloseReveal:
        // Wave 2 — the wall-adjacency pace pair...
        case MobBehaviour::DebrisLurker:
        case MobBehaviour::WallBrace:
        // ...and the eight authored sight radii. OfficeField, RootedPlant and
        // RootHive sit on speed-0 kinds, so they are answered here and still
        // unobservable in wander_step; see [mob_behaviour.h].
        case MobBehaviour::LurkingFurniture:
        case MobBehaviour::RootedPlant:
        case MobBehaviour::RootHive:
        case MobBehaviour::OfficeField:
        case MobBehaviour::DocumentHunter:
        case MobBehaviour::ProtocolPressure:
        case MobBehaviour::DocumentScent:
        case MobBehaviour::LightFollower:
            return true;
        default:
            return false;
    }
}

// The fallback slot exists in the reference for when the ring position lands inside
// a solid cell. It is referenced here so the constant is not dead weight: physics
// already stops a monster that steers into a wall, and it will slide along it, which
// is the same outcome the fallback produces. Kept named for when a solidity query is
// cheap enough to add.
static_assert(kSurroundBehind < 0.0f, "the fallback slot is behind the target");

} // namespace giga::game
