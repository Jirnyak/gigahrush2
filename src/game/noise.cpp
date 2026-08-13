#include "game/noise.h"

#include <cmath>

#include "core/wrap.h"
#include "game/ranged_table.h"
#include "world/types.h"

namespace giga::game {

namespace {

// Reference constants, cited so they can be checked without reopening the source
// (../gigahrush/src/systems/noise.ts and src/systems/ai/monster.ts).
constexpr float kWeaponBaseRadius = 9.0f;     // fallback formula's floor
constexpr float kWeaponDmgDivisor = 7.0f;
constexpr float kWeaponPelletCap = 8.0f;
constexpr float kWeaponRadiusCap = 24.0f;     // min(24, ...) in the formula
constexpr std::uint16_t kWeaponTtlMs = 2800;  // 2.8 s

// An explosion is heard four blast radii away — a 5 m grenade is audible at 20 m,
// which is inside the reference's 24 m cap for a firearm and outside its 13 m
// severity-3 band, so a detonation is the loudest thing on the floor without being
// audible across it. Longer-lived than a gunshot (4.0 s against 2.8) because the
// thing that draws a monster to a blast is the silence after it as much as the bang.
constexpr float kBlastRadiusMult = 4.0f;
constexpr float kBlastRadiusCap = 24.0f;
constexpr std::uint16_t kBlastTtlMs = 4000;

constexpr float kBodyRadius = 6.0f;
constexpr std::uint16_t kBodyTtlMs = 1600;

constexpr float kContainerRadius = 7.0f;      // the reference's plain-door profile
constexpr std::uint16_t kContainerTtlMs = 2200;

// The reference's scoring weights, from `findNoiseForActor`.
constexpr float kScoreSeverity = 10.0f;
constexpr float kScoreNearness = 8.0f;
constexpr float kScoreAgePerSec = 0.5f;

std::uint8_t clamp_severity(int s) {
    if (s < 0) return 0;
    if (s > static_cast<int>(kNoiseSeverityMax)) return kNoiseSeverityMax;
    return static_cast<std::uint8_t>(s);
}

} // namespace

std::uint32_t noise_publish(NoiseField& field, LayerId layer, const vec3& pos,
                            const NoiseProfile& p, std::uint32_t actor) {
    // A degenerate profile is refused rather than clamped up to something audible:
    // publishing "a sound with no loudness" is a caller bug, and inventing a radius
    // for it would hide that bug behind plausible behaviour.
    if (!(p.radius > 0.0f) || p.ttlMs == 0 || p.source == NoiseSource::None) {
        ++field.dropped;
        return 0;
    }
    // Layer ids past one byte are refused, not masked. See kNoiseLayerMax: aliasing
    // a floor onto (id % 256) would make a gunshot on one floor audible on another,
    // which is exactly the class of bug the LayerId-is-not-a-floor-number rule
    // exists to prevent.
    if (layer > kNoiseLayerMax) {
        ++field.dropped;
        return 0;
    }

    float radius = p.radius;
    if (radius > kNoiseRadiusCap) radius = kNoiseRadiusCap;
    if (radius < kNoiseRadiusMin) radius = kNoiseRadiusMin;
    const std::uint8_t sev = clamp_severity(p.severity);

    // Find a free slot, and while walking remember the weakest live one in case
    // there is none. One pass, not two.
    std::size_t free = kNoiseCap;
    std::size_t weakest = kNoiseCap;
    std::uint8_t weakestSev = 0xFFu;
    std::uint16_t weakestTtl = 0xFFFFu;
    for (std::size_t i = 0; i < kNoiseCap; ++i) {
        const Noise& s = field.slot[i];
        if (s.id == 0) {
            if (free == kNoiseCap) free = i;
            continue;
        }
        // Weakest = lowest severity, then least remaining life. Ties keep the
        // earlier slot, so eviction is deterministic and a test can pin it.
        if (s.severity < weakestSev ||
            (s.severity == weakestSev && s.ttlMs < weakestTtl)) {
            weakestSev = s.severity;
            weakestTtl = s.ttlMs;
            weakest = i;
        }
    }

    std::size_t at = free;
    if (at == kNoiseCap) {
        // Full. Evict the weakest — UNLESS the incoming noise is weaker still, in
        // which case refusing it is the honest answer. This is the whole reason the
        // policy differs from the event bus (see the header): a ring full of
        // footsteps must never swallow a rifle.
        if (weakest == kNoiseCap) {
            ++field.dropped;
            return 0;
        }
        if (sev < weakestSev ||
            (sev == weakestSev && p.ttlMs <= weakestTtl)) {
            ++field.dropped;
            return 0;
        }
        at = weakest;
        // The evicted slot was live, so liveCount is about to be re-incremented
        // for the replacement; net zero. Decrement here so the two paths converge.
        --field.liveCount;
    }

    Noise& n = field.slot[at];
    n.x = pos.x;
    n.y = pos.y;
    n.z = pos.z;
    n.radius = radius;
    n.id = field.nextId++;
    // nextId is monotonic and never reused, which is what lets a one-shot behaviour
    // store "the last id I reacted to". Wrapping past 2^32 would alias a brand-new
    // noise onto a remembered one; at one id per publish that is unreachable in a
    // session, but skipping 0 keeps "no noise" unambiguous forever.
    if (field.nextId == 0) field.nextId = 1;
    n.actor = actor;
    n.ttlMs = p.ttlMs;
    n.lifeMs = p.ttlMs;
    n.layer = static_cast<std::uint8_t>(layer);
    n.source = static_cast<std::uint8_t>(p.source);
    n.severity = sev;
    n.pad_ = 0;
    ++field.liveCount;
    return n.id;
}

std::uint32_t noise_step(NoiseField& field, std::uint32_t dtMs) {
    if (field.liveCount == 0) return 0;   // the common case, and it costs nothing
    const std::uint16_t d = dtMs > 0xFFFFu ? 0xFFFFu
                                           : static_cast<std::uint16_t>(dtMs);
    std::uint32_t expired = 0;
    for (Noise& s : field.slot) {
        if (s.id == 0) continue;
        if (s.ttlMs > d) {
            s.ttlMs = static_cast<std::uint16_t>(s.ttlMs - d);
            continue;
        }
        // Expired. The slot is zeroed rather than merely id-cleared so a stale
        // position can never be read back through a bug elsewhere.
        s = Noise{};
        ++expired;
        --field.liveCount;
    }
    return expired;
}

void noise_clear(NoiseField& field) {
    for (Noise& s : field.slot) s = Noise{};
    field.liveCount = 0;
    // nextId is deliberately NOT reset. Ids must stay unique across a floor change
    // or a consumer holding "the last id I reacted to" would match a fresh noise on
    // the new floor and silently skip it.
}

NoiseProfile weapon_fire_noise(const RangedDef& d) {
    float pellets = static_cast<float>(d.pellets);
    if (pellets > kWeaponPelletCap) pellets = kWeaponPelletCap;
    float radius = kWeaponBaseRadius +
                   static_cast<float>(d.dmg) / kWeaponDmgDivisor + pellets;
    if (radius > kWeaponRadiusCap) radius = kWeaponRadiusCap;

    // The reference's own banding. There is no `aoeRadius` and no `bfg` among the
    // 29 ProjType::Normal rows ([ranged_table.h] defers all 19 of those), so the
    // severity-5 and severity-4-by-area arms of its expression are unreachable here
    // and are not written out as dead branches.
    NoiseProfile p;
    p.radius = radius;
    p.ttlMs = kWeaponTtlMs;
    p.severity = radius >= 21.0f ? 4u : (radius >= 13.0f ? 3u : 2u);
    p.source = NoiseSource::WeaponFire;
    return p;
}

NoiseProfile blast_noise(float blastRadiusM) {
    float radius = blastRadiusM * kBlastRadiusMult;
    if (radius > kBlastRadiusCap) radius = kBlastRadiusCap;
    NoiseProfile p;
    p.radius = radius;
    p.ttlMs = kBlastTtlMs;
    // Severity 5, the top of the band — and the FIRST thing in the tree to use it.
    // `weapon_fire_noise` above records that the reference's severity-5 arm was
    // unreachable "because there is no aoeRadius among the 29 ProjType::Normal
    // rows". Row 30 has one, so the arm is reachable and this is it.
    p.severity = kNoiseSeverityMax;
    p.source = NoiseSource::Explosion;
    return p;
}

NoiseProfile body_fall_noise() {
    NoiseProfile p;
    p.radius = kBodyRadius;
    p.ttlMs = kBodyTtlMs;
    p.severity = 2;   // exactly the investigation threshold: worth one look
    p.source = NoiseSource::Body;
    return p;
}

NoiseProfile container_open_noise() {
    NoiseProfile p;
    p.radius = kContainerRadius;
    p.ttlMs = kContainerTtlMs;
    p.severity = 2;
    p.source = NoiseSource::Container;
    return p;
}

const char* noise_source_name(NoiseSource s) {
    switch (s) {
        case NoiseSource::None:       return "-";
        case NoiseSource::WeaponFire: return "shot";
        case NoiseSource::Melee:      return "metal";
        case NoiseSource::Footstep:   return "steps";
        case NoiseSource::Door:       return "door";
        case NoiseSource::Container:  return "crate";
        case NoiseSource::Body:       return "body";
        case NoiseSource::Siren:      return "siren";
        case NoiseSource::Explosion:  return "blast";
        case NoiseSource::Decoy:      return "decoy";
        case NoiseSource::Count:      break;
    }
    return "?";
}

float noise_distance(const Noise& n, const vec3& pos) {
    // x/y wrap, z does NOT — the level stack is the 4th axis and a storey is not a
    // torus. Using wrap_delta_f on z would make a sound 250 m overhead read as 6 m
    // away, which on a 128-storey column is a real distance, not a corner case.
    const float dx = wrap_delta_f(pos.x, n.x, kWorldExtent);
    const float dy = wrap_delta_f(pos.y, n.y, kWorldExtent);
    const float dz = n.z - pos.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}

bool noise_audible(const Noise& n, const vec3& pos, float hearingMult) {
    if (n.id == 0) return false;
    const float r = n.radius * (hearingMult > 0.0f ? hearingMult : 1.0f);
    return noise_distance(n, pos) <= r;
}

const Noise* loudest_heard(const NoiseField& field, LayerId layer, const vec3& pos,
                           float hearingMult, std::uint8_t minSeverity,
                           std::uint32_t ignoreActor, float* outDist) {
    if (outDist) *outDist = 0.0f;
    if (field.quiet()) return nullptr;
    if (layer > kNoiseLayerMax) return nullptr;
    const std::uint8_t wantLayer = static_cast<std::uint8_t>(layer);
    const float mult = hearingMult > 0.0f ? hearingMult : 1.0f;

    const Noise* best = nullptr;
    float bestScore = 0.0f;
    float bestDist = 0.0f;
    for (const Noise& s : field.slot) {
        if (s.id == 0) continue;
        if (s.layer != wantLayer) continue;
        if (s.severity < minSeverity) continue;
        // Never your own. Guarded on ignoreActor != 0 because 0 means "no filter"
        // and entt::null truncates to a real integral value — a listener passing 0
        // must not accidentally match every anonymous noise.
        if (ignoreActor != 0 && s.actor == ignoreActor) continue;

        const float r = s.radius * mult;
        const float d = noise_distance(s, pos);
        if (d > r) continue;

        // The reference's weighting, verbatim: severity dominates, nearness breaks
        // ties within a band, and age decays it so a fresh quiet sound can beat a
        // stale loud one. `nearness` is 1 at the source and 0 at the audible edge.
        const float nearness = 1.0f - d / (r > 0.1f ? r : 0.1f);
        const float ageSec =
            static_cast<float>(s.lifeMs - s.ttlMs) * 0.001f;
        const float score = static_cast<float>(s.severity) * kScoreSeverity +
                            nearness * kScoreNearness - ageSec * kScoreAgePerSec;
        if (best && score <= bestScore) continue;
        best = &s;
        bestScore = score;
        bestDist = d;
    }
    if (best && outDist) *outDist = bestDist;
    return best;
}

} // namespace giga::game
