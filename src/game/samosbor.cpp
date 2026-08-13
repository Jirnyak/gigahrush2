#include "game/samosbor.h"

#include <algorithm>
#include <cstdio>   // snprintf — samosbor_beat_text is the only user

#include "core/rng.h"
#include "core/wrap.h"
#include "ecs/components.h"
#include "game/mob_spawn.h"  // MobRef — what counts as a threat
#include "world/field.h"
#include "game/hermetic.h"

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
    return giga::hash_u32(rng.state += 0x9e3779b9u);
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

// Ported verbatim from `SAMOSBOR_VARIANTS[].displayName`. Written as \x escapes and
// not as literal Cyrillic to match `rumour.cpp` and `faction.h`: every player-facing
// STRING in hand-written source in this tree is escaped, while comments carry raw
// UTF-8. That split is not decoration — the escaped form is byte-identical whatever
// the editing host's code page is, and this repository is force-synced between a
// CP1251 Windows box and macOS.
const std::array<const char*, kSamosborVariantCount> kSamosborVariantNamesRu = {{
    // Типовой (ГОСТ-С)
    "\xd0\xa2\xd0\xb8\xd0\xbf\xd0\xbe\xd0\xb2\xd0\xbe\xd0\xb9"
    " (\xd0\x93\xd0\x9e\xd0\xa1\xd0\xa2-\xd0\xa1)",
    // Тяжелый влажный
    "\xd0\xa2\xd1\x8f\xd0\xb6\xd0\xb5\xd0\xbb\xd1\x8b\xd0\xb9"
    " \xd0\xb2\xd0\xbb\xd0\xb0\xd0\xb6\xd0\xbd\xd1\x8b\xd0\xb9",
    // Озоновый пробой
    "\xd0\x9e\xd0\xb7\xd0\xbe\xd0\xbd\xd0\xbe\xd0\xb2\xd1\x8b\xd0\xb9"
    " \xd0\xbf\xd1\x80\xd0\xbe\xd0\xb1\xd0\xbe\xd0\xb9",
    // Красный биологический
    "\xd0\x9a\xd1\x80\xd0\xb0\xd1\x81\xd0\xbd\xd1\x8b\xd0\xb9"
    " \xd0\xb1\xd0\xb8\xd0\xbe\xd0\xbb\xd0\xbe\xd0\xb3\xd0\xb8"
    "\xd1\x87\xd0\xb5\xd1\x81\xd0\xba\xd0\xb8\xd0\xb9",
    // Маронарий
    "\xd0\x9c\xd0\xb0\xd1\x80\xd0\xbe\xd0\xbd\xd0\xb0\xd1\x80\xd0\xb8\xd0\xb9",
    // Истотит
    "\xd0\x98\xd1\x81\xd1\x82\xd0\xbe\xd1\x82\xd0\xb8\xd1\x82",
    // Веретар
    "\xd0\x92\xd0\xb5\xd1\x80\xd0\xb5\xd1\x82\xd0\xb0\xd1\x80",
}};

// Authored, one clause each, lower-case because they land mid-sentence in a rumour.
// Order matches the enum, so index 4 is maronary's "things stop being yours" and not
// meat's — the pairing is the only thing in this table that can be silently wrong, and
// `test_samosborhud_all` pins two of the seven against their variant.
const std::array<const char*, kSamosborVariantCount> kSamosborVariantEffectRu = {{
    // фиолетовый туман и твари по щелям
    "\xd1\x84\xd0\xb8\xd0\xbe\xd0\xbb\xd0\xb5\xd1\x82\xd0\xbe"
    "\xd0\xb2\xd1\x8b\xd0\xb9 \xd1\x82\xd1\x83\xd0\xbc\xd0"
    "\xb0\xd0\xbd \xd0\xb8 \xd1\x82\xd0\xb2\xd0\xb0\xd1\x80"
    "\xd0\xb8 \xd0\xbf\xd0\xbe \xd1\x89\xd0\xb5\xd0\xbb\xd1"
    "\x8f\xd0\xbc",
    // пол мокрый, шаги слышно дальше
    "\xd0\xbf\xd0\xbe\xd0\xbb \xd0\xbc\xd0\xbe\xd0\xba\xd1"
    "\x80\xd1\x8b\xd0\xb9, \xd1\x88\xd0\xb0\xd0\xb3\xd0\xb8 "
    "\xd1\x81\xd0\xbb\xd1\x8b\xd1\x88\xd0\xbd\xd0\xbe \xd0"
    "\xb4\xd0\xb0\xd0\xbb\xd1\x8c\xd1\x88\xd0\xb5",
    // лампы бьют, гермы щёлкают раньше
    "\xd0\xbb\xd0\xb0\xd0\xbc\xd0\xbf\xd1\x8b \xd0\xb1\xd1"
    "\x8c\xd1\x8e\xd1\x82, \xd0\xb3\xd0\xb5\xd1\x80\xd0\xbc"
    "\xd1\x8b \xd1\x89\xd1\x91\xd0\xbb\xd0\xba\xd0\xb0\xd1"
    "\x8e\xd1\x82 \xd1\x80\xd0\xb0\xd0\xbd\xd1\x8c\xd1\x88"
    "\xd0\xb5",
    // стены тёплые, тварей больше обычного
    "\xd1\x81\xd1\x82\xd0\xb5\xd0\xbd\xd1\x8b \xd1\x82\xd1"
    "\x91\xd0\xbf\xd0\xbb\xd1\x8b\xd0\xb5, \xd1\x82\xd0\xb2"
    "\xd0\xb0\xd1\x80\xd0\xb5\xd0\xb9 \xd0\xb1\xd0\xbe\xd0"
    "\xbb\xd1\x8c\xd1\x88\xd0\xb5 \xd0\xbe\xd0\xb1\xd1\x8b"
    "\xd1\x87\xd0\xbd\xd0\xbe\xd0\xb3\xd0\xbe",
    // вещи станут не своими
    "\xd0\xb2\xd0\xb5\xd1\x89\xd0\xb8 \xd1\x81\xd1\x82\xd0"
    "\xb0\xd0\xbd\xd1\x83\xd1\x82 \xd0\xbd\xd0\xb5 \xd1\x81"
    "\xd0\xb2\xd0\xbe\xd0\xb8\xd0\xbc\xd0\xb8",
    // укрытий меньше, чем людей
    "\xd1\x83\xd0\xba\xd1\x80\xd1\x8b\xd1\x82\xd0\xb8\xd0\xb9"
    " \xd0\xbc\xd0\xb5\xd0\xbd\xd1\x8c\xd1\x88\xd0\xb5, \xd1"
    "\x87\xd0\xb5\xd0\xbc \xd0\xbb\xd1\x8e\xd0\xb4\xd0\xb5"
    "\xd0\xb9",
    // что-то исчезнет и оставит белый песок
    "\xd1\x87\xd1\x82\xd0\xbe-\xd1\x82\xd0\xbe \xd0\xb8\xd1"
    "\x81\xd1\x87\xd0\xb5\xd0\xb7\xd0\xbd\xd0\xb5\xd1\x82 "
    "\xd0\xb8 \xd0\xbe\xd1\x81\xd1\x82\xd0\xb0\xd0\xb2\xd0"
    "\xb8\xd1\x82 \xd0\xb1\xd0\xb5\xd0\xbb\xd1\x8b\xd0\xb9 "
    "\xd0\xbf\xd0\xb5\xd1\x81\xd0\xbe\xd0\xba",
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

SamosborState samosbor_enter_floor(const SamosborState& prev, int floorZ,
                                   SamosborRng& rng) {
    SamosborState st;
    // The ONE field that crosses a ride. Everything else in the struct is a
    // function of |z| or of the cycle in progress, and inheriting either would
    // carry the departed floor's rhythm onto the arrival — which is the mistake
    // the other direction, and the reason main.cpp reached for
    // samosbor_new_game in the first place.
    st.count = prev.count;
    // Same arithmetic as samosbor_step's Aftermath branch, so a ride and a
    // completed cycle draw from one distribution rather than two. The aftermath
    // deduction is what keeps a cooldown meaning Active-end-to-Active-start.
    samosbor_arm(st, samosbor_cooldown_ms(floorZ, rng) - kSamosborAftermathMs);
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

// ---------------------------------------------------------------------------
// The beat
// ---------------------------------------------------------------------------

SamosborBeat samosbor_beat(const SamosborState& st) {
    // Saturating, because `phaseMs > phaseTotalMs` is reachable from a hand-built or
    // loaded state and an unsigned wrap here would read as "the phase has been running
    // for 49 days", which every window test below would then pass.
    const std::uint32_t elapsed =
        st.phaseTotalMs > st.phaseMs ? st.phaseTotalMs - st.phaseMs : 0u;

    switch (static_cast<SamosborPhase>(st.phase)) {
        case SamosborPhase::Warning:
            // The WHOLE window, not its first few seconds. 30 s is the one real
            // decision in the loop; a banner that expired after 4 s would have been
            // the beat being missed rather than delivered, and the countdown inside
            // the line is what makes the remaining 26 s useful.
            return SamosborBeat::Warning;

        case SamosborPhase::Active: {
            // The seal outranks the arrival where they collide. They normally cannot:
            // the earliest seal is 8 s before the end (maronary, -2) and the shortest
            // authored Active is kSamosborDurationFloorMs = 12 s. But electric's seal
            // sits 14 s before the end, so a 12 s Active seals on its FIRST tick —
            // `samosbor_step` documents that deliberate behaviour — and on that tick
            // the cost the player has just paid is the more useful of the two facts.
            const std::uint32_t sealAt =
                samosbor_seal_before_end_ms(static_cast<SamosborVariant>(st.variant));
            // Ordering is load-bearing: `st.phaseMs <= sealAt` must be tested BEFORE
            // the subtraction or the unsigned difference wraps for the whole first
            // half of every Active phase and the Seal banner would be permanent.
            if (st.sealed && st.phaseMs <= sealAt &&
                sealAt - st.phaseMs <= kSamosborBeatSealMs)
                return SamosborBeat::Seal;
            if (elapsed < kSamosborBeatImpactMs) return SamosborBeat::Impact;
            return SamosborBeat::None;
        }

        case SamosborPhase::Aftermath:
            return elapsed < kSamosborBeatClearMs ? SamosborBeat::Clear
                                                 : SamosborBeat::None;

        case SamosborPhase::Idle:
        default:
            // NOTHING on Idle, and the fifth beat that is not here is the interesting
            // part. "You survived N samosbors" wants to fire on the Aftermath -> Idle
            // edge, and keyed on early-Idle it is wrong twice: `samosbor_new_game` and
            // `samosbor_enter_floor` both arm straight INTO Idle, so it would announce
            // a survived samosbor on the first frame of a new run and on every single
            // floor arrival. Level-shaped reading cannot tell those three apart, which
            // is the honest limit of doing this without a latch — and Aftermath is
            // where "it just ended" actually lives, so `Clear` already covers the beat
            // that matters. A corrupt phase byte lands here too, and reporting no beat
            // is the right answer for a clock that is about to be re-armed by
            // `samosbor_step`'s own default branch.
            return SamosborBeat::None;
    }
}

bool samosbor_beat_text(const SamosborState& st, char* out, std::size_t cap) {
    if (out == nullptr || cap < kSamosborBeatTextCap) return false;
    const SamosborVariant v = static_cast<SamosborVariant>(st.variant);

    switch (samosbor_beat(st)) {
        case SamosborBeat::Warning: {
            // Round UP. Truncating means the line reads "0 с" for the last 999 ms of
            // the window, i.e. it tells the player the decision is already made while
            // they can still act on it.
            const int secs = static_cast<int>((st.phaseMs + 999u) / 1000u);
            // !! САМОСБОР ЧЕРЕЗ %d С: %s | УКРОЙСЯ | пережито %u
            std::snprintf(out, cap,
                          "!! \xd0\xa1\xd0\x90\xd0\x9c\xd0\x9e\xd0\xa1\xd0\x91\xd0"
                          "\x9e\xd0\xa0 \xd0\xa7\xd0\x95\xd0\xa0\xd0\x95\xd0\x97 %d"
                          " \xd0\xa1: %s | \xd0\xa3\xd0\x9a\xd0\xa0\xd0\x9e\xd0\x99"
                          "\xd0\xa1\xd0\xaf | \xd0\xbf\xd0\xb5\xd1\x80\xd0\xb5\xd0"
                          "\xb6\xd0\xb8\xd1\x82\xd0\xbe %u",
                          secs, samosbor_variant_name_ru(v),
                          static_cast<unsigned>(st.count));
            return true;
        }
        case SamosborBeat::Impact: {
            // `phaseTotalMs`, NOT `phaseMs`: the number that matters on arrival is how
            // long the player is committing to, not how much of the four-second banner
            // is left. At |z| = 50 that is 15 minutes and at z = 0 it is 30 seconds,
            // which is the depth curve delivered as one string.
            const std::uint32_t total = st.phaseTotalMs / 1000u;
            // !! САМОСБОР ЗДЕСЬ: %s | %d:%02d до конца
            std::snprintf(out, cap,
                          "!! \xd0\xa1\xd0\x90\xd0\x9c\xd0\x9e\xd0\xa1\xd0\x91\xd0"
                          "\x9e\xd0\xa0 \xd0\x97\xd0\x94\xd0\x95\xd0\xa1\xd0\xac: %"
                          "s | %d:%02d \xd0\xb4\xd0\xbe \xd0\xba\xd0\xbe\xd0\xbd"
                          "\xd1\x86\xd0\xb0",
                          samosbor_variant_name_ru(v),
                          static_cast<int>(total / 60u),
                          static_cast<int>(total % 60u));
            return true;
        }
        case SamosborBeat::Seal:
            // The accessor, never the raw constant. The seal line is the ONLY place the
            // game tells the player what being caught outside costs, so it has to be
            // billed from the same number `apply_damage` is handed or the tutorial and
            // the mechanic drift.
            // !! ПЕЧАТЬ: без укрытия %d HP
            std::snprintf(out, cap,
                          "!! \xd0\x9f\xd0\x95\xd0\xa7\xd0\x90\xd0\xa2\xd0\xac: "
                          "\xd0\xb1\xd0\xb5\xd0\xb7 \xd1\x83\xd0\xba\xd1\x80\xd1"
                          "\x8b\xd1\x82\xd0\xb8\xd1\x8f %d HP",
                          static_cast<int>(samosbor_unsheltered_pressure(v).hpDamage));
            return true;
        case SamosborBeat::Clear:
            // САМОСБОР КОНЧИЛСЯ: туман уходит
            std::snprintf(out, cap,
                          "\xd0\xa1\xd0\x90\xd0\x9c\xd0\x9e\xd0\xa1\xd0\x91\xd0\x9e"
                          "\xd0\xa0 \xd0\x9a\xd0\x9e\xd0\x9d\xd0\xa7\xd0\x98\xd0"
                          "\x9b\xd0\xa1\xd0\xaf: \xd1\x82\xd1\x83\xd0\xbc\xd0\xb0"
                          "\xd0\xbd \xd1\x83\xd1\x85\xd0\xbe\xd0\xb4\xd0\xb8\xd1"
                          "\x82");
            return true;
        case SamosborBeat::None:
        default:
            return false;
    }
}

float samosbor_beat_pulse01(const SamosborState& st) {
    const SamosborBeat b = samosbor_beat(st);
    if (b == SamosborBeat::None) return 0.0f;
    // Fast only in the TAIL of the warning window. Everywhere else the rate would carry
    // no information, and an alarm that always blinks fast is an alarm the player stops
    // reading — which is the failure this whole section exists to undo.
    const std::uint32_t period =
        (b == SamosborBeat::Warning && st.phaseMs < kSamosborBeatFastPulseMs)
            ? kSamosborBeatFastPulsePeriodMs
            : kSamosborBeatPulseMs;
    const float u =
        static_cast<float>(st.phaseMs % period) / static_cast<float>(period);
    return u < 0.5f ? u * 2.0f : (1.0f - u) * 2.0f;
}

SamosborAlarm samosbor_alarm(const SamosborState& st) {
    SamosborAlarm out;
    const SamosborBeat b = samosbor_beat(st);
    out.beat = static_cast<std::uint8_t>(b);
    if (b == SamosborBeat::None) return out;
    // `on` follows the TEXT and not the beat, which is the one non-obvious line here.
    // samosbor_beat_text refuses a cap below kSamosborBeatTextCap, and `text` is sized
    // at exactly that, so the refusal is unreachable today — but a later edit that
    // shrinks the array would otherwise produce `on == true` with an empty string, i.e.
    // a blank red banner on the frame the player most needs a sentence. Reporting what
    // was actually written costs one assignment.
    out.on = samosbor_beat_text(st, out.text, sizeof(out.text));
    if (!out.on) return out;
    out.pulse = samosbor_beat_pulse01(st);
    return out;
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
    const float spawnMult = static_cast<float>(kSamosborVariants[static_cast<std::size_t>(variant)].spawnMultX100) / 100.0f;
    
    // As noted in samosbor.h, the shipped code computes radius and strength based on fogSeedMult (spawnMult):
    // radius: clamp(round(5*sqrt(fogSeedMult)), 2, 7)
    // strength: clamp(round(200*fogSeedMult), 90, 230)
    int rawRadius = static_cast<int>(std::round(5.0f * std::sqrt(spawnMult)));
    std::uint8_t radius = static_cast<std::uint8_t>(rawRadius < 2 ? 2 : (rawRadius > 7 ? 7 : rawRadius));
    
    int rawStrength = static_cast<int>(std::round(200.0f * spawnMult));
    std::uint8_t strength = static_cast<std::uint8_t>(rawStrength < 90 ? 90 : (rawStrength > 230 ? 230 : rawStrength));

    return SamosborPressure{radius, strength, kSamosborUnshelteredHp, kSamosborUnshelteredPsi};
}

void samosbor_wave_dispatch_cpu(Field<float>& fogField, const HermeticZones& hermeticZones, vec3 waveOrigin, SamosborVariant variant, float phase01) {
    const SamosborPressure pressure = samosbor_unsheltered_pressure(variant);
    const int radius = pressure.fogRadiusCells;
    const float strength = static_cast<float>(pressure.fogStrength) / 255.0f;
    const float spreadRate = 3.0f; // from spec: 3 cells per second
    // We assume phase01 * duration scales the radius, but wait, the spec says wave origin spreads
    // For simplicity we just use radius * phase01 if we want it to grow, or we just fill the static radius.
    // Spec pseudo code: "if d > fogRadiusCells: fogField[cell] = 0"
    // Let's implement static field that decays with distance for now, scaled by strength.
    
    const int ox = wrap_macro(static_cast<int>(std::floor(waveOrigin.x / kCellSize)));
    const int oy = wrap_macro(static_cast<int>(std::floor(waveOrigin.y / kCellSize)));
    const int oz = wrap_macro(static_cast<int>(std::floor(waveOrigin.z / kCellSize)));
    const int radiusSq = radius * radius;

    for (int z = 0; z < kMacroCells; ++z) {
        for (int y = 0; y < kMacroCells; ++y) {
            for (int x = 0; x < kMacroCells; ++x) {
                if (hermeticZones.is_sealed(x, y, z)) {
                    continue;
                }
                // is_lattice_column? 32 spacing, 16 is half
                if ((x % 32) == 16 && (y % 32) == 16) {
                    continue; // inside elevators
                }

                int dx = std::abs(x - ox);
                int dy = std::abs(y - oy);
                int dz = std::abs(z - oz);
                if (dx > kMacroCells / 2) dx = kMacroCells - dx;
                if (dy > kMacroCells / 2) dy = kMacroCells - dy;
                if (dz > kMacroCells / 2) dz = kMacroCells - dz;
                
                int distSq = dx * dx + dy * dy + dz * dz;
                if (distSq > radiusSq) {
                    continue;
                }
                
                float dist = std::sqrt(static_cast<float>(distSq));
                float fogAmount = strength * (1.0f - (dist / static_cast<float>(radius)));
                
                if (fogAmount > 0.0f) {
                    fogField.at(x, y, z) = std::max(fogField.at(x, y, z), fogAmount);
                }
            }
        }
    }
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
