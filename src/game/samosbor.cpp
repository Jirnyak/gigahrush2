#include "game/samosbor.h"

#include <algorithm>

#include "core/wrap.h"
#include "ecs/components.h"
#include "game/mob_spawn.h"  // MobRef — what counts as a threat

namespace giga::game {

namespace {

// Linear interpolation between two millisecond endpoints, in double so a 30-min
// span does not lose resolution to float's 24-bit mantissa (1'800'000 ms is
// representable, but 1'800'000 * 0.9999 is not distinctly).
std::uint32_t lerp_ms(std::uint32_t a, std::uint32_t b, float t) {
    const double da = static_cast<double>(a);
    const double db = static_cast<double>(b);
    const double v = da + (db - da) * static_cast<double>(t);
    return static_cast<std::uint32_t>(v + 0.5);
}

// Mean-1 jitter multiplier, uniform on [1 - kSamosborJitter, 1 + kSamosborJitter).
//
// Mean-neutrality is load-bearing, not cosmetic: it is what makes
// samosbor_duty01() an exact prediction of the sampled long-run duty cycle
// instead of a rough one, which in turn is what lets the monotonicity test assert
// against a closed form rather than against a noisy Monte-Carlo estimate.
float jitter_mult(SamosborRng& rng) {
    return 1.0f - kSamosborJitter + samosbor_rand01(rng) * (2.0f * kSamosborJitter);
}

std::uint32_t scale_ms(std::uint32_t base, float mult, std::uint32_t floorMs) {
    const double v = static_cast<double>(base) * static_cast<double>(mult);
    const std::uint32_t r = static_cast<std::uint32_t>(v + 0.5);
    return r < floorMs ? floorMs : r;
}

// Enter a phase, resetting the countdown pair together so phaseTotalMs can never
// drift out of step with phaseMs (which would show as a HUD bar that overfills).
void enter(SamosborState& st, SamosborPhase p, std::uint32_t ms) {
    st.phase = static_cast<std::uint8_t>(p);
    st.phaseMs = ms;
    st.phaseTotalMs = ms;
}

} // namespace

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

std::uint32_t samosbor_rand(SamosborRng& rng) {
    // splitmix32. Advance first, so a freshly-constructed Rng does not hand back
    // its own seed as the first draw.
    std::uint32_t x = (rng.state += 0x9e3779b9u);
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

float samosbor_rand01(SamosborRng& rng) {
    // Top 24 bits: every bit a float mantissa can hold, and the high bits of a
    // scrambler are the ones with the best distribution.
    return static_cast<float>(samosbor_rand(rng) >> 8) * (1.0f / 16777216.0f);
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

// Weights, durationMult and spawnMult are the reference's authored values
// (src/data/samosbor_variants.ts:269-432), verified against balance.md:107-108.
//
// spawnMult here is the BASE value. The reference multiplies it by its active
// modifiers, which widens the effective range from 0.52..1.18 to 0.24..1.49 (meat
// reaches 1.18*1.1*1.15 and istotit falls to 0.52*0.55*0.85). Modifiers are not
// ported — there are 19 of them and they are a separate system — so the base
// values are what this table carries, and a future modifier layer must multiply
// on top rather than rewriting these rows.
const std::array<SamosborVariantDef, kSamosborVariantCount> kSamosborVariants = {{
    //                                       weight  durX100  spawnX100  sealDelta
    {static_cast<std::uint8_t>(SamosborVariant::Classic),   60, 100, 100,  0},
    {static_cast<std::uint8_t>(SamosborVariant::Wet),       20, 108, 105,  2},
    {static_cast<std::uint8_t>(SamosborVariant::Electric),  16,  95, 100,  4},
    {static_cast<std::uint8_t>(SamosborVariant::Meat),      14, 115, 118,  0},
    {static_cast<std::uint8_t>(SamosborVariant::Maronary),   4,  82,  78, -2},
    {static_cast<std::uint8_t>(SamosborVariant::Istotit),    3,  92,  52,  3},
    {static_cast<std::uint8_t>(SamosborVariant::Veretar),    4,  96,  78, -1},
}};

const std::array<const char*, kSamosborVariantCount> kSamosborVariantNames = {{
    "classic", "wet", "electric", "meat", "maronary", "istotit", "veretar",
}};

SamosborVariant samosbor_pick_variant(SamosborRng& rng) {
    const std::uint32_t roll = samosbor_rand(rng) % kSamosborWeightTotal;
    std::uint32_t acc = 0;
    for (std::size_t i = 0; i < kSamosborVariantCount; ++i) {
        acc += kSamosborVariants[i].weight;
        if (roll < acc) return static_cast<SamosborVariant>(i);
    }
    // Unreachable while the weights sum to kSamosborWeightTotal, which a static
    // check in the test pins. Classic is the safe fallback rather than an assert:
    // a missing samosbor is a worse failure than a mis-weighted one.
    return SamosborVariant::Classic;
}

// ---------------------------------------------------------------------------
// The curve
// ---------------------------------------------------------------------------

std::uint32_t samosbor_duration_mean_ms(int floorZ) {
    return std::max(kSamosborDurationFloorMs,
                    lerp_ms(kSamosborDurationAtSurfaceMs, kSamosborDurationAtDepthMs,
                            mob_depth01(floorZ)));
}

std::uint32_t samosbor_cooldown_mean_ms(int floorZ) {
    return std::max(kSamosborCooldownFloorMs,
                    lerp_ms(kSamosborCooldownAtSurfaceMs, kSamosborCooldownAtDepthMs,
                            mob_depth01(floorZ)));
}

float samosbor_duty01(int floorZ) {
    // Both operands are clamped lerps of the same monotone depth01: duration
    // non-decreasing, cooldown non-increasing. d/(d+c) is increasing in d and
    // decreasing in c, so the quotient is non-decreasing in |z| for every
    // floorZ — no sampling, no tolerance, no way for a later edit to break
    // monotonicity without changing one of the two lerps.
    const double d = static_cast<double>(samosbor_duration_mean_ms(floorZ));
    const double c = static_cast<double>(samosbor_cooldown_mean_ms(floorZ));
    return static_cast<float>(d / (d + c));
}

std::uint32_t samosbor_duration_ms(int floorZ, SamosborVariant variant,
                                  SamosborRng& rng) {
    const SamosborVariantDef& def = samosbor_variant_def(variant);
    const float mult = jitter_mult(rng) *
                       (static_cast<float>(def.durationMultX100) * 0.01f);
    return scale_ms(samosbor_duration_mean_ms(floorZ), mult, kSamosborDurationFloorMs);
}

std::uint32_t samosbor_cooldown_ms(int floorZ, SamosborRng& rng) {
    return scale_ms(samosbor_cooldown_mean_ms(floorZ), jitter_mult(rng),
                    kSamosborCooldownFloorMs);
}

std::uint32_t samosbor_first_cooldown_ms(SamosborRng& rng) {
    return lerp_ms(kSamosborFirstTimerMinMs, kSamosborFirstTimerMaxMs,
                   samosbor_rand01(rng));
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

const char* samosbor_phase_name(SamosborPhase p) {
    switch (p) {
        case SamosborPhase::Idle:      return "idle";
        case SamosborPhase::Warning:   return "warning";
        case SamosborPhase::Active:    return "active";
        case SamosborPhase::Aftermath: return "aftermath";
        default:                       return "invalid";
    }
}

void samosbor_arm(SamosborState& st, std::uint32_t untilActiveMs) {
    // `untilActiveMs` is the wall time from NOW until the next Active phase
    // begins. Warning is the tail of it, so Idle is the remainder. Callers that
    // arm from the end of an Aftermath must subtract the aftermath they already
    // spent — which is exactly what makes a drawn cooldown come out as the true
    // Active-end-to-Active-start gap, and therefore what makes
    // samosbor_duty01() = duration / (duration + cooldown) with no third term.
    const std::uint32_t until = std::max(untilActiveMs, kSamosborArmFloorMs);
    enter(st, SamosborPhase::Idle, until - kSamosborWarningMs);
    st.sealed = false;
}

SamosborState samosbor_new_game(SamosborRng& rng) {
    SamosborState st;
    samosbor_arm(st, samosbor_first_cooldown_ms(rng));
    return st;
}

std::uint32_t samosbor_seal_before_end_ms(SamosborVariant variant) {
    const int delta = samosbor_variant_def(variant).sealDeltaSec;
    const int ms = static_cast<int>(kSamosborSealBeforeEndMs) + delta * 1000;
    return static_cast<std::uint32_t>(ms < 0 ? 0 : ms);
}

float samosbor_phase01(const SamosborState& st) {
    if (st.phaseTotalMs == 0) return 1.0f;
    const float used = static_cast<float>(st.phaseTotalMs - st.phaseMs);
    return clamp01(used / static_cast<float>(st.phaseTotalMs));
}

SamosborTransition samosbor_step(SamosborState& st, std::uint32_t dtMs, int floorZ,
                                 SamosborRng& rng) {
    SamosborTransition out;
    out.from = st.phase;
    out.to = st.phase;
    out.variant = st.variant;

    // Bounded at one full cycle. Not a while(dt) loop: a caller that passes a
    // 40-minute dt (a load stall, a debug time-skip) would otherwise walk the
    // clock forward for as many cycles as it takes, allocating nothing but
    // burning the frame it was trying to recover. Dropping the remainder after
    // four crossings is the honest failure — the samosbor you skipped did not
    // happen, rather than happening invisibly.
    constexpr int kMaxCrossings = 4;

    for (int guard = 0; guard < kMaxCrossings; ++guard) {
        const bool expired = dtMs >= st.phaseMs;
        if (expired) {
            dtMs -= st.phaseMs;
            st.phaseMs = 0;
        } else {
            st.phaseMs -= dtMs;
            dtMs = 0;
        }

        // Seal on the POST-countdown value, so it lands in the same step it is
        // due rather than one tick later. A phase whose whole duration is shorter
        // than its seal window (kSamosborDurationFloorMs is 12 s and electric's
        // seal sits at 14 s) seals on its first tick instead of never — the seal
        // is the only pressure moment in the cycle and skipping it silently would
        // make a short samosbor free.
        if (st.phase == static_cast<std::uint8_t>(SamosborPhase::Active) && !st.sealed) {
            const std::uint32_t sealAt =
                samosbor_seal_before_end_ms(static_cast<SamosborVariant>(st.variant));
            if (st.phaseMs <= sealAt) {
                st.sealed = true;
                out.sealed = true;
            }
        }

        if (!expired) break;

        switch (static_cast<SamosborPhase>(st.phase)) {
            case SamosborPhase::Idle: {
                // Commit to a variant and roll its duration at the START of the
                // warning, not at the start of the active phase. The warning text
                // names the expected variant, so the decision the player makes in
                // those 30 s has to be about a variant that is already decided.
                const SamosborVariant v = samosbor_pick_variant(rng);
                st.variant = static_cast<std::uint8_t>(v);
                st.activeMs = samosbor_duration_ms(floorZ, v, rng);
                st.sealed = false;
                enter(st, SamosborPhase::Warning, kSamosborWarningMs);
                out.warningBegan = true;
                out.variant = st.variant;
                break;
            }
            case SamosborPhase::Warning:
                enter(st, SamosborPhase::Active, st.activeMs);
                out.activeBegan = true;
                break;
            case SamosborPhase::Active:
                enter(st, SamosborPhase::Aftermath, kSamosborAftermathMs);
                out.activeEnded = true;
                break;
            case SamosborPhase::Aftermath:
                // A survived samosbor is progression, not a statistic: `count`
                // is what MobDef::minSamosbor gates the deeper roster on.
                if (st.count < 0xFFFFu) ++st.count;
                // The aftermath just spent is part of the cooldown, so hand
                // samosbor_arm only what is LEFT of it. Adding the aftermath on
                // top instead would stretch every gap by 12 s and quietly bias
                // the duty cycle down — most visibly at |z| = 50, where 12 s is a
                // fifth of the whole cooldown.
                samosbor_arm(st, samosbor_cooldown_ms(floorZ, rng) -
                                     kSamosborAftermathMs);
                out.cycleEnded = true;
                break;
            default:
                // Corrupt phase byte (a bad save, a memset). Re-arm rather than
                // sit in an unreachable state forever.
                samosbor_arm(st, samosbor_cooldown_ms(floorZ, rng));
                break;
        }

        ++out.steps;
        if (dtMs == 0) break;
    }

    out.to = st.phase;
    out.changed = out.steps != 0;
    return out;
}

// ---------------------------------------------------------------------------
// Unsheltered pressure
// ---------------------------------------------------------------------------

SamosborPressure samosbor_unsheltered_pressure(SamosborVariant variant) {
    // Variant-independent today. The parameter is here because the reference's
    // fog seed IS per-variant (via fogSeedMult) and the day a fog field lands
    // this is where that lookup goes — a signature change at that point would
    // touch every call site instead of one function body.
    (void)variant;
    return SamosborPressure{kSamosborFogRadiusCells, kSamosborFogStrength,
                            kSamosborUnshelteredHp, kSamosborUnshelteredPsi};
}

// ---------------------------------------------------------------------------
// Threat density budget
// ---------------------------------------------------------------------------

bool samosbor_fog_spawn_allowed(const ThreatCensus& census, bool highRisk) {
    if (census.withinOuter >= kThreatHardMaxOuter) return false;
    if (census.withinNear >= kThreatBackoffNear) return false;
    if (census.withLos >= kThreatBackoffLos) return false;
    const std::uint8_t outerGate = highRisk ? kThreatSpikeMax : kThreatBackoffOuter;
    return census.withinOuter < outerGate;
}

std::uint8_t samosbor_threat_headroom(const ThreatCensus& census, bool highRisk) {
    if (!samosbor_fog_spawn_allowed(census, highRisk)) return 0;
    const std::uint8_t outerGate = highRisk ? kThreatSpikeMax : kThreatBackoffOuter;
    // Two independent ceilings; the binding one wins. Both are guaranteed to be
    // above the current count by the predicate above, so neither subtraction can
    // wrap.
    const std::uint8_t outerRoom =
        static_cast<std::uint8_t>(outerGate - census.withinOuter);
    const std::uint8_t nearRoom =
        static_cast<std::uint8_t>(kThreatBackoffNear - census.withinNear);
    return std::min(outerRoom, nearRoom);
}

std::uint8_t samosbor_threat_target(int floorZ, SamosborVariant variant,
                                    bool highRisk) {
    const float base = lerp(static_cast<float>(kThreatPressureMin),
                            static_cast<float>(kThreatPressureMax),
                            mob_depth01(floorZ));
    const float spawnMult =
        static_cast<float>(samosbor_variant_def(variant).spawnMultX100) * 0.01f;
    const int cap = highRisk ? kThreatSpikeMax : kThreatPressureMax;
    const int want = static_cast<int>(base * spawnMult + 0.5f);
    return static_cast<std::uint8_t>(std::clamp(want, 1, cap));
}

ThreatCensus samosbor_census(const Registry& reg, LayerId layer, vec3 around) {
    ThreatCensus out;
    // Squared radii, so the whole scan is multiplies and compares with no sqrt.
    const float nearR2 = kThreatNearRadiusM * kThreatNearRadiusM;
    const float outerR2 = kThreatOuterRadiusM * kThreatOuterRadiusM;

    auto view = reg.view<const MobRef, const Transform>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;
        // Toroidal on all three axes: a mob 2 m away across the seam is 2 m
        // away, not kWorldExtent - 2. Getting this wrong makes the back-off
        // silently stop working near a wrap boundary, which is 3 of every 128
        // cells.
        const float dx = wrap_delta_f(around.x, tr.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(around.y, tr.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(around.z, tr.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > outerR2) continue;
        if (out.withinOuter < 0xFFu) ++out.withinOuter;
        if (d2 <= nearR2 && out.withinNear < 0xFFu) ++out.withinNear;
    }
    // withLos stays 0 — see the header. The sim has no cheap line-of-fire query
    // and faking one here would make the LOS gate look enforced while enforcing
    // nothing.
    return out;
}

bool samosbor_allows_kind(const MobDef& def, std::uint16_t samosborCount) {
    return samosborCount >= static_cast<std::uint16_t>(def.minSamosbor);
}

} // namespace giga::game
