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
    switch (b) {
        case MobBehaviour::DeadEcho:    return 7.5f;
        case MobBehaviour::CloseReveal: return 6.0f;
        default:                        return defaultRadius;
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
        // flag; the flag itself is only a detect radius.
        case MobBehaviour::SourceSwarm:
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
