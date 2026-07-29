#include "game/mob_behaviour.h"

#include <cmath>

// kCellSize — `behaviour_melee_reach` converts cells to metres, which is the ONE unit
// conversion in this file. Every other constant here is already in metres because it
// came from the reference's tile-based detect radii; the melee column is authored in
// cells like the table it lives in. Included in the .cpp and not the header, per
// [AGENTS.md] "Headers minimal", and it is a `giga_core` header so the layering rule is
// satisfied ([tools/check_source_rules.cmake] gates the reverse direction only).
#include "world/types.h"

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

// splitmix64-style scrambler, the same one wander.cpp and investigate.cpp carry.
// Duplicated rather than shared for the reason [investigate.cpp] states about its own
// copy, but with the OPPOSITE requirement: those two must land in the same stagger
// slot, so they must compute the identical hash. This one must NOT — it offsets the
// burst cycle, and if it agreed with the stagger hash then the phase a Трескотник
// sprints in would be locked to the phase it is visited in.
std::uint32_t mix(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

// The salt is what makes it a different hash rather than a different call to the same
// one. Any nonzero constant works; this one is FNV-1a's offset basis, used here for
// nothing but its bit pattern.
constexpr std::uint32_t kBurstSalt = 0x811c9dc5u;

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
        case MobBehaviour::WebSpitter: {
            if (dirX == 0.0f && dirY == 0.0f) return {};
            // The reference's `away` vector is target -> monster, i.e. -dir, and its
            // goal cell is `monster + away*stepAway + perp(away)*side*stepSide`. In the
            // victim's frame that is `victim + away*(dist + stepAway) + perp*...`; the
            // constant kWebStandoff replaces `dist + stepAway`, which is what turns a
            // per-frame chase of a recomputed cell into a fixed orbit radius. See the
            // arithmetic in [mob_behaviour.h] — the radial term is negative, so this is
            // the one offset in this file that can make a monster retreat.
            //
            // `id % 2`, verbatim. Note it is the opposite sense to GreenDogPack's
            // `mobId & 1` (even takes +1 here, -1 there): both are the reference's own
            // rule for their own kind, and neither is a normalisation of the other.
            const float s = (mobId % 2u == 0u) ? 1.0f : -1.0f;
            const float awayX = -dirX;
            const float awayY = -dirY;
            // Perpendicular is (-awayY, +awayX), matching the reference's sign so the
            // two halves of the population circle the same way round it does.
            return {awayX * kWebStandoff - awayY * s * kWebStrafeSide,
                    awayY * kWebStandoff + awayX * s * kWebStrafeSide};
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
        case MobBehaviour::FractureSprint:   return 18.0f;  // wave 3
        case MobBehaviour::OfficeField:      return 23.0f;
        case MobBehaviour::DocumentHunter:   return 24.0f;
        case MobBehaviour::MeatWorm:         return 24.0f;  // wave 3; 30 m if bleeding
        case MobBehaviour::FalsePhase:       return 24.0f;  // wave 3
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

float facing_damage_mult(MobBehaviour b, float fwdX, float fwdY, float dx, float dy) {
    if (b != MobBehaviour::DeadEcho) return 1.0f;
    const float d2 = dx * dx + dy * dy;
    // The reference's `facingDotTo` returns 1 below a 0.001 m separation — standing on
    // top of a monster counts as facing it — so a degenerate delta must NOT award the
    // 1.55. Getting this edge backwards would hand the bonus to exactly the case where
    // the player has already been caught.
    if (d2 < 1e-6f) return kDeadEchoFacedDamage;
    const float inv = 1.0f / std::sqrt(d2);
    const float dot = (dx * inv) * fwdX + (dy * inv) * fwdY;
    return dot <= kDeadEchoBackDot ? kDeadEchoBackDamage : kDeadEchoFacedDamage;
}

BurstPhase burst_phase(MobBehaviour b, std::uint32_t mobId, std::uint64_t tick,
                       float dist) {
    if (b != MobBehaviour::FractureSprint) return BurstPhase::Idle;
    // Out of lunging range it is an ordinary monster closing at its table speed. The
    // gate is `>` so that exactly kFractureRange still winds up, matching the
    // reference's `distSq <= RANGE*RANGE`.
    if (!(dist <= kFractureRange)) return BurstPhase::Idle;
    // Negative or NaN distances cannot reach here: `!(dist <= range)` is false only for
    // a real value in [-inf, range], and a negative distance would be a caller bug
    // rather than a state this can repair. NaN takes the Idle branch, which is the safe
    // one — a NaN speed multiplier would poison Velocity for good.

    // Per-identity phase offset, so a pack does not sprint in unison. The offset is a
    // whole number of ticks inside one cycle, so the cycle length is exact.
    const std::uint64_t offset =
        static_cast<std::uint64_t>(mix(mobId ^ kBurstSalt)) % kFractureCycleTicks;
    const std::uint64_t t = (tick + offset) % kFractureCycleTicks;
    if (t < kFractureWindupTicks) return BurstPhase::Windup;
    if (t < kFractureWindupTicks + kFractureSprintTicks) return BurstPhase::Sprint;
    return BurstPhase::Stagger;
}

float burst_speed_mult(BurstPhase p) {
    switch (p) {
        case BurstPhase::Windup:  return 0.0f;
        case BurstPhase::Sprint:  return kFractureSprintMult;
        case BurstPhase::Stagger: return 0.0f;
        case BurstPhase::Idle:    break;
    }
    return 1.0f;
}

float burst_damage_mult(BurstPhase p) {
    // Only the sprint hits harder. A staggered Трескотник in reach still swings for its
    // authored damage rather than for nothing: the reference holds its attack cooldown
    // at 0.25 s during the stagger instead of zeroing the hit, and a cooldown is the
    // caller's to own.
    return p == BurstPhase::Sprint ? kFractureBurstDamage : 1.0f;
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

bool behaviour_claims_damage(MobBehaviour b) {
    // Deliberately the SAME case list as `behaviour_damage_mult`'s, and hand-written
    // rather than derived from it by probing both wall states — a derived version would
    // reproduce the `!= 1.0f` test this predicate exists to replace. The suite compares
    // the two against each other instead, which catches a case added to one and not the
    // other.
    //
    // WallBrace is absent on purpose: it claims the pace, the reach and the incoming
    // damage, and it has no OUTGOING multiplier in the reference at all
    // (`monsterDmgMult` has no PANELNIK case). Its bruiser half is the reach, not a
    // damage number, and inventing one would be the kind of symmetry that reads as
    // parity and is not.
    return b == MobBehaviour::DebrisLurker;
}

bool wall_query_needed(std::uint32_t aiFlags, MobBehaviour b) {
    if (aiFlags & static_cast<std::uint32_t>(AiFlag::WallBias)) return true;
    return b == MobBehaviour::DebrisLurker || b == MobBehaviour::WallBrace;
}

float behaviour_melee_reach(MobBehaviour b, std::uint16_t baseReachMm,
                            bool adjacentWall) {
    // Cells -> metres, the same conversion combat.cpp does inline. Done here for BOTH
    // branches so the override cannot end up in the other unit; the braced value is
    // authored in cells like the column it replaces, not in metres like the sight radii.
    if (b == MobBehaviour::WallBrace && adjacentWall)
        return kWallBraceReachCells * kCellSize;
    return static_cast<float>(baseReachMm) * 0.001f * kCellSize;
}

float behaviour_incoming_mult(MobBehaviour b, bool adjacentWall) {
    // Unbraced returns exactly 1.0 rather than a small penalty: the reference gives an
    // open-floor Панельник no armour at all, and its open-floor weakness is already
    // spent on the shorter reach and the slower pace.
    return (b == MobBehaviour::WallBrace && adjacentWall) ? kWallBraceIncoming : 1.0f;
}

float behaviour_hurt_move_mult(MobBehaviour b, std::int16_t hp, std::int16_t maxHp) {
    if (b != MobBehaviour::CrowdShove) return 1.0f;
    // A mob with no maximum is a spawn bug; slowing it would hide that. Note this also
    // covers the `hp > maxHp` case (an over-healed or mis-spawned row) by falling
    // through to 1.0 rather than by clamping, so nothing here can invent a speed-up.
    if (maxHp <= 0) return 1.0f;
    return hp < maxHp ? kCrowdShoveHurtSpeed : 1.0f;
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
    // The declared inverse of `behaviour_is_dead`, and NOT its negation: 23
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
        // Wave 3 — the three radii that were never in `monsterDetectSq`...
        case MobBehaviour::MeatWorm:
        case MobBehaviour::FalsePhase:
        // ...FractureSprint, which gets that treatment AND its burst cycle...
        case MobBehaviour::FractureSprint:
        // ...and the standoff, the first offset here with a negative radial term.
        case MobBehaviour::WebSpitter:
        // Wave 4 — the mob's own health as a pace input. THE ONE ENTRY on this list
        // whose every answer comes from a function with no caller in src/, so it is
        // answered here and still indistinguishable from Plain in the running game.
        // WallBrace also gains two dimensions in wave 4 (reach, incoming damage) but
        // was already on this list for its live pace, so the count moves by one.
        case MobBehaviour::CrowdShove:
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
