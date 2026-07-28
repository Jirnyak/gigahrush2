// Samosbor — the depth-scaled pressure clock ([floors.md], [monsters.md]).
//
// Samosbor (самосбор) is the building's signature hazard: a periodic
// floor-wide event where fog comes in, hostiles spawn, and being caught outside
// shelter hurts. It is the reason a descent has a rhythm instead of being a flat
// corridor crawl.
//
// THE WHOLE POINT IS THE DEPTH CURVE, so it is stated first. Duration grows with
// |z| while the cooldown runs inversely, and the product of the two is a duty
// cycle — the fraction of wall time a floor spends under active samosbor:
//
//     |z|   duration        cooldown          duty cycle
//   -----------------------------------------------------
//       0    30 s           30 min             1.6 %
//      10     3 min 24 s    24 min 12 s       12.3 %
//      25     7 min 45 s    15 min 30 s       33.3 %
//      40    12 min  6 s     6 min 48 s       64.0 %
//      50    15 min          1 min            93.8 %
//
// So the surface gets 30 s of hazard per half hour and the extremes are almost
// continuously in samosbor. That gradient IS the descent pressure: there is no
// hardcoded difficulty curve anywhere in this file, no per-floor authored
// threat budget, and no `if (deep)`. Going down is frightening because the clock
// stops giving you gaps.
//
// `samosbor_duty01()` is the exact, rng-free statement of that curve and it is
// **monotonically non-decreasing in |z| by construction** — duration is a
// non-decreasing lerp, cooldown a non-increasing one, and d/(d+c) is monotone in
// both. test_samosbor_all asserts it, because the assertion is what protects the
// design: any later "tidying" of the interpolation that makes a deep floor
// calmer than a shallow one is a silent balance regression that nothing else in
// the game would catch.
//
// DEPTH IS BIDIRECTIONAL. Every function here keys off |z|, so the roof at
// z = +50 is exactly as hostile as the basement at z = -50. Descent is not
// negative-only; `mob_table.h` already builds its head-count/level budgets on
// the same V-shape and this file reuses its `mob_depth01()` rather than shipping
// a second copy of clamp(|z|/50, 0, 1) that could drift away from it.
//
// PROVENANCE, AND WHERE THE REFERENCE CONTRADICTS ITSELF. Ported from the
// TypeScript reference at ../gigahrush, which carries FOUR disagreeing accounts
// of samosbor timing. Measured 2026-07-28:
//
//   * `desdoc.md:439` — duration 30 s..15 min by abs(z), cooldown a random
//     interval up to 30 min at the centre of the route down to a 1 min minimum
//     at abs(z)=50. This is the DESIGN INTENT and it is what this file
//     implements, because it is the only account that produces the ~2%..94%
//     gradient the system exists for.
//   * `samosbor.md` "Timing" and the shipped code
//     (`src/systems/procedural_floors.ts:85-88`) — duration 20 s..5 min,
//     cooldown 45 s..25 min. The reference's own implementation is a scaled-down
//     version of its design doc: it tops out at a ~54% duty cycle at abs(z)=50
//     (see the luck-fork note on `samosbor_cooldown_ms`), so the shipped game
//     never delivers the "deep floors are continuously hostile" contract that
//     `desdoc.md` promises. Not ported.
//   * `balance.md:100-108` — duration 12..90 s, warning 18 s. This is the
//     staleest of the three and predates the depth curve entirely: a flat 90 s
//     ceiling cannot grow with abs(z) at all. Its 12 s low end survives here
//     only as `kSamosborDurationFloorMs`, a backstop.
//
// Numbers that ARE consistent across code and docs and are ported verbatim: the
// new-game timer (120..180 s), the seven variant weights, `durationMult`
// 0.82..1.15, `spawnMult` 0.52..1.18, the 10 s seal-before-end, and the
// unsheltered -4 HP / -3 PSI.
//
// Pure game-layer logic: no SDL/Vulkan/ImGui, no allocation, no exceptions, no
// RTTI. Every timing function is a pure function of (|z|, variant, rng) so the
// curve is testable headless with no World, no Registry and no floor.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <type_traits>

#include "core/math.h"            // vec3
#include "ecs/registry.h"
#include "game/mob_table.h"      // MobDef::minSamosbor, mob_depth01, kFloorZSpan
#include "world/level_stack.h"   // LayerId
#include "world/types.h"         // kCellSize

namespace giga::game {

// ---------------------------------------------------------------------------
// The depth curve — the four numbers everything else follows from
// ---------------------------------------------------------------------------

// Duration at |z| = 0 and at |z| = kFloorZSpan (50). `desdoc.md:439`.
inline constexpr std::uint32_t kSamosborDurationAtSurfaceMs = 30u * 1000u;
inline constexpr std::uint32_t kSamosborDurationAtDepthMs = 15u * 60u * 1000u;

// Cooldown runs the other way: long at the centre of the route, short at the
// extremes. `desdoc.md:439`.
inline constexpr std::uint32_t kSamosborCooldownAtSurfaceMs = 30u * 60u * 1000u;
inline constexpr std::uint32_t kSamosborCooldownAtDepthMs = 60u * 1000u;

// Symmetric jitter on both, so two samosbors on the same floor are not
// metronomic. Deliberately mean-neutral (the multiplier is uniform on
// [1-j, 1+j], so E[mult] = 1) — that is what makes `samosbor_duty01()` an exact
// prediction of the sampled curve rather than an approximation, and it is what
// keeps the depth signal dominant over the noise. Widening this past ~0.35 would
// let a shallow roll outrun a deep one, which is the design failure the
// monotonicity test exists to catch.
inline constexpr float kSamosborJitter = 0.25f;

// ---------------------------------------------------------------------------
// Phase timing
// ---------------------------------------------------------------------------

// The decision window before the event lands: shelter, run, close a door, save
// an NPC, drop loot, or risk it.
//
// **30 s, not 18.** The task brief and `balance.md:103` both say 18 s; the
// shipped code says 30 (`src/systems/samosbor.ts:123`,
// `SAMOSBOR_WARNING_WINDOW = 30`) and `samosbor.md` agrees ("Warning window: 30
// seconds before impact"). The 18 is real but belongs to a different subsystem
// — `src/systems/hermodoor_borer.ts:77`, `PREWARNING_WINDOW = 18`, the gate that
// spawns a borer ahead of a samosbor. Two of three sources plus the code say 30,
// and 30 s is also the value that makes the window a genuine route decision
// rather than a sprint. One constant, so flipping it is one line.
inline constexpr std::uint32_t kSamosborWarningMs = 30u * 1000u;

// Aftermath tail: events, loot, shortages, rumours, marks, local hazards.
//
// AUTHORED HERE, not measured. The reference's aftermath is beat-driven with no
// duration at all — it runs until its beats are spent. 12 s is two beats at the
// reference's own `SAMOSBOR_DIRECTOR_MIN_INTERVAL.aftermath = 6` with
// `PHASE_BUDGET.aftermath = 1`, which is the closest thing to a measured value
// that exists. Say so rather than dressing it up as ported.
inline constexpr std::uint32_t kSamosborAftermathMs = 12u * 1000u;

// The seal moment, `sealBeforeEnd` in the reference: 10 s before the active
// phase ends, shifted by the variant's `sealDeltaSec`. This is when unsheltered
// pressure resolves — see `samosbor_unsheltered_pressure`.
inline constexpr std::uint32_t kSamosborSealBeforeEndMs = 10u * 1000u;

// Aftermath and Warning are carved out of the cooldown (see SamosborState), so
// a cooldown shorter than their sum plus a breath of Idle would make the machine
// inconsistent. 30 + 12 + 3 = 45 s.
//
// Worth noting: 45 s is *exactly* the reference's shipped
// `SAMOSBOR_COOLDOWN_MIN_SEC`. Its floor was authored and this one is structural,
// and they landed on the same number — which is weak evidence the structure is
// the reason the reference picked it.
inline constexpr std::uint32_t kSamosborMinIdleMs = 3u * 1000u;
inline constexpr std::uint32_t kSamosborCooldownFloorMs =
    kSamosborWarningMs + kSamosborAftermathMs + kSamosborMinIdleMs;
static_assert(kSamosborCooldownFloorMs == 45u * 1000u);
static_assert(kSamosborCooldownAtDepthMs >= kSamosborCooldownFloorMs,
              "the deepest cooldown must still fit Aftermath + Warning + Idle");

// `samosbor_arm` takes time-until-Active, which is a cooldown with the aftermath
// already deducted, so its floor is the cooldown floor minus that aftermath.
inline constexpr std::uint32_t kSamosborArmFloorMs =
    kSamosborWarningMs + kSamosborMinIdleMs;
static_assert(kSamosborArmFloorMs + kSamosborAftermathMs == kSamosborCooldownFloorMs,
              "arm floor and cooldown floor must stay two views of one number");

// Backstop only; nothing in the authored curve reaches it (the shortest roll is
// 30 s * 0.75 * 0.82 = 18.5 s at |z| = 0 with the maronary variant). It is
// `balance.md`'s stale 12 s minimum, kept as a floor rather than as a band.
inline constexpr std::uint32_t kSamosborDurationFloorMs = 12u * 1000u;

// New game only: the first event is 120..180 s in, regardless of depth. Verified
// against the code (`src/main.ts:3272`, `120 + rng() * 60`) as well as
// `balance.md:102`. Every subsequent cooldown comes off the depth curve.
inline constexpr std::uint32_t kSamosborFirstTimerMinMs = 120u * 1000u;
inline constexpr std::uint32_t kSamosborFirstTimerMaxMs = 180u * 1000u;

// ---------------------------------------------------------------------------
// Deterministic stream
// ---------------------------------------------------------------------------

// The same splitmix32 scrambler `population.cpp`, `wander.cpp` and
// `mob_spawn.cpp` use, promoted to a header because samosbor needs a *stream*
// (several draws per event, over a whole session) rather than a one-shot hash of
// a seed. POD and trivially copyable so it can be saved and restored, which is
// the only way a reloaded floor keeps the same clock.
//
// Deliberately NOT stored inside SamosborState: the caller owns the stream, one
// per floor, seeded from that floor's seed. That keeps determinism a property of
// the call site instead of a hidden field.
struct SamosborRng {
    std::uint32_t state = 0x9e3779b9u;
};

std::uint32_t samosbor_rand(SamosborRng& rng);

// Uniform on [0, 1). 24 mantissa bits, which is every bit a float can hold.
float samosbor_rand01(SamosborRng& rng);

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

// Seven, matching the reference's `SAMOSBOR_VARIANTS`. Order matches the source
// table so the weights stay comparable; `SamosborVariantDef::variant` re-states
// it for a load-time assert.
//
// These are not colour swaps. Per `samosbor.md`: classic brings purple fog and
// monsters; maronary rewrites identity, actors, items and containers; veretar
// removes and leaves a white residue; istotit creates, heals, marks limited
// shelters and creates social debt.
enum class SamosborVariant : std::uint8_t {
    Classic = 0, Wet, Electric, Meat, Maronary, Istotit, Veretar, Count
};
inline constexpr std::size_t kSamosborVariantCount =
    static_cast<std::size_t>(SamosborVariant::Count);
static_assert(kSamosborVariantCount == 7, "the reference ships exactly 7 variants");

// POD row, pointer-free and 5 bytes so the whole table is 35 B. Multipliers are
// stored fixed-point x100 so the table is integral and bit-identical across
// builds — same convention as `MobDef`.
struct SamosborVariantDef {
    std::uint8_t variant;           // SamosborVariant; must equal the row index
    std::uint8_t weight;            // authored selection weight, 3..60
    std::uint8_t durationMultX100;  // 82..115
    std::uint8_t spawnMultX100;     // 52..118
    std::int8_t  sealDeltaSec;      // -2..+4, shifts the seal moment
};
static_assert(sizeof(SamosborVariantDef) == 5, "variant row must stay 5 bytes");
static_assert(alignof(SamosborVariantDef) == 1);
static_assert(std::is_trivially_copyable_v<SamosborVariantDef>);

// Hand-authored, unlike `kMobTable`/`kItemTable`: seven rows of five bytes is
// not worth a CSV and a generator, and the `source_rules` CSV-drift gate only
// protects tables that have one. If this ever grows per-variant fog fields,
// modifier lists or aftermath beats (the reference has 19 modifiers and 44
// aftermath beats), move it to `data/samosbor_variants.csv` and register it in
// `tools/check_source_rules.cmake` at the same time as the generator, not after.
extern const std::array<SamosborVariantDef, kSamosborVariantCount> kSamosborVariants;

// Stable lowercase snake_case ids, matching the reference's data ids and
// `samosbor.md`'s naming convention. Kept out of the row so it stays
// pointer-free and trivially serializable — same split as `kMobNames`.
extern const std::array<const char*, kSamosborVariantCount> kSamosborVariantNames;

inline const SamosborVariantDef& samosbor_variant_def(SamosborVariant v) {
    return kSamosborVariants[static_cast<std::size_t>(v)];
}
inline const char* samosbor_variant_name(SamosborVariant v) {
    return kSamosborVariantNames[static_cast<std::size_t>(v)];
}

// Sum of the authored weights: 60+20+16+14+4+3+4. Classic is 60/121 = 49.6% of
// rolls and the three rare variants (maronary, istotit, veretar) together are
// 11/121 = 9.1%, which is what keeps them rare enough to still read as events
// rather than as weather.
inline constexpr std::uint32_t kSamosborWeightTotal = 121u;

// One weighted draw over the authored weights. Flat scan of seven rows — no
// alias table, because seven is small enough that the branch predictor wins.
SamosborVariant samosbor_pick_variant(SamosborRng& rng);

// ---------------------------------------------------------------------------
// The curve, as pure functions
// ---------------------------------------------------------------------------

// Mean (jitter-free, variant-free) duration and cooldown at a depth. These are
// the two lerps the whole system is: `samosbor_duration_ms` and
// `samosbor_cooldown_ms` are these values times a mean-1 jitter.
//
// Depth input is `mob_depth01(floorZ)` = clamp(|z| / kFloorZSpan, 0, 1), reused
// from `mob_table.h` rather than re-derived, so the samosbor clock and the
// monster budgets can never disagree about how deep a floor is.
std::uint32_t samosbor_duration_mean_ms(int floorZ);
std::uint32_t samosbor_cooldown_mean_ms(int floorZ);

// **The design invariant, as a number.** Expected fraction of wall time a floor
// at `floorZ` spends in the Active phase: mean_duration / (mean_duration +
// mean_cooldown). 0.016 at z = 0, 0.9375 at |z| = 50.
//
// Monotonically non-decreasing in |z| by construction, and identical for +z and
// -z. Exact, not sampled — the jitter is mean-neutral, so this predicts the
// sampled long-run duty cycle to within Monte-Carlo noise, which
// test_samosbor_all verifies rather than assumes.
//
// Also directly useful: a HUD or a director can read it to say "this floor is
// under samosbor 94% of the time" without running the clock forward.
float samosbor_duty01(int floorZ);

// One sampled active duration: mean(|z|) * jitter * variant.durationMult,
// floored at kSamosborDurationFloorMs.
std::uint32_t samosbor_duration_ms(int floorZ, SamosborVariant variant,
                                  SamosborRng& rng);

// One sampled cooldown: mean(|z|) * jitter, floored at
// kSamosborCooldownFloorMs. Variant-independent — the reference scales duration
// per variant but not the gap, and a variant that changed the *rhythm* of the
// floor rather than the event would be a different design.
//
// NOT PORTED, deliberately: the reference forks this three ways on a luck roll
// (`procedural_floors.ts:610-625`) — 8% "rapid double-strike", 15% "long calm",
// 77% ordinary. Its long-calm branch returns `1200 + rng() * (maxForDepth -
// 1200)` seconds with no clamp, and `maxForDepth` drops below 1200 once
// |z| > ~10, so on every deep floor that branch produces a span of the wrong
// sign and hands back cooldowns of up to 20 minutes — the exact opposite of the
// depth contract, and the single reason the shipped reference tops out near a
// 54% duty cycle instead of 94%. A luck fork is good texture and worth adding
// later, but it has to be **multiplicative** (a depth-independent factor keeps
// d/(d+c*k) monotone) rather than absolute, or it breaks the invariant the
// monotonicity test guards.
std::uint32_t samosbor_cooldown_ms(int floorZ, SamosborRng& rng);

// The first event of a new game: 120..180 s, depth-independent. Use this once,
// at `samosbor_new_game`; every later gap comes from `samosbor_cooldown_ms`.
std::uint32_t samosbor_first_cooldown_ms(SamosborRng& rng);

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

// Idle -> Warning -> Active -> Aftermath -> Idle.
//
// Warning and Aftermath are carved OUT of the cooldown, not added to it: a
// cooldown is the wall time from one Active phase ending to the next beginning,
// so cooldown = Aftermath + Idle + Warning. That is what makes
// `samosbor_duty01()` exactly duration/(duration+cooldown) with no third term,
// and it matches the reference, where the warning fires when the single
// `samosborTimer` falls below 30 rather than from a timer of its own.
enum class SamosborPhase : std::uint8_t { Idle = 0, Warning, Active, Aftermath, Count };

const char* samosbor_phase_name(SamosborPhase p);

// POD, trivially copyable, no pointers — so it drops straight into a save blob
// and into a per-floor array. Nothing here is a handle into the world; the
// clock does not know what floor it is on (the caller passes `floorZ` to
// `samosbor_step`, which is what lets one floor be renumbered without its clock
// noticing — `LayerId` != floor number, [floors.md]).
struct SamosborState {
    std::uint32_t phaseMs = 0;       // time left in the current phase
    std::uint32_t phaseTotalMs = 0;  // what it started at, for HUD fill bars
    std::uint32_t activeMs = 0;      // rolled duration of the pending/running Active
    std::uint16_t count = 0;         // completed samosbors here; feeds MobDef::minSamosbor
    std::uint8_t phase = 0;          // SamosborPhase
    std::uint8_t variant = 0;        // SamosborVariant; meaningful from Warning onward
    bool sealed = false;             // the one-shot seal already resolved this cycle
};
static_assert(std::is_trivially_copyable_v<SamosborState>);

// What changed in one step, so a caller reacts to transitions instead of polling
// phase every frame and diffing it itself. All flags are false on the common
// path (no transition), which is the overwhelming majority of frames — a caller
// can early-out on `!changed`.
struct SamosborTransition {
    std::uint8_t from = 0;        // SamosborPhase at entry
    std::uint8_t to = 0;          // SamosborPhase at exit
    std::uint8_t variant = 0;     // SamosborVariant in play
    std::uint8_t steps = 0;       // phase boundaries crossed; 0 on the common path
    bool changed = false;         // steps != 0
    bool warningBegan = false;    // the decision window opened: HUD, siren, barks
    bool activeBegan = false;     // fog and spawn pressure start NOW
    bool sealed = false;          // resolve shelter and apply unsheltered pressure
    bool activeEnded = false;     // fog and spawn pressure stop; despawn fog mobs
    bool cycleEnded = false;      // aftermath spent; `count` incremented
};

// Arm a fresh clock: phase Idle, `count` 0, first event 120..180 s away.
// Depth-independent on purpose — the very first samosbor of a run lands on the
// same schedule whether you started on the roof or in the void, because the
// depth curve is about where you *go*, not where you spawn.
SamosborState samosbor_new_game(SamosborRng& rng);

// Arm the clock explicitly, for tests, debug and floor load from a save.
// `untilActiveMs` is wall time from now until the next Active phase begins — NOT
// a cooldown: a cooldown includes the aftermath that has already been spent by
// the time the clock re-arms. Sets phase Idle with `untilActiveMs -
// kSamosborWarningMs` left, clamping the argument up to `kSamosborArmFloorMs`.
void samosbor_arm(SamosborState& st, std::uint32_t untilActiveMs);

// THE step. Advance the clock by `dtMs` and report what crossed.
//
// WHERE THIS BELONGS IN THE SIM ORDER. The existing per-tick order is
//
//     input.apply -> controller_step -> wander_step -> physics_step
//       -> player_melee_step -> mob_attack_step -> projectile_step
//       -> loot_dead_mobs -> finalize_deaths -> pickup_step
//
// and `samosbor_step` goes **after `controller_step`, before `wander_step`**.
// Three reasons, in order of how expensive getting it wrong is:
//
//   1. The seal's unsheltered damage goes through `apply_damage`, which only
//      tags `Dead`. Anything that can kill must run before `finalize_deaths`
//      ([combat.h] defect 2) — and with a whole tick of margin, not one slot.
//   2. `wander_step` and `mob_attack_step` will want to read the phase (fog
//      makes a crowd flee and a mob bolder). Deciding the phase for this tick
//      before any behaviour reads it means no system ever sees a stale phase.
//   3. Entities spawned on the `activeBegan` / fog-pressure transitions get a
//      `physics_step` in the same tick, so they land on the floor instead of
//      hanging in the air for one frame.
//
// It takes no Registry and no World on purpose: it is a clock, and every world
// consequence is the caller's reaction to the returned transition. That is what
// keeps it testable with no floor loaded.
//
// No allocation, no exceptions, no RTTI, no virtuals. Bounded at four phase
// crossings per call — one full cycle — so a debug hitch or a load stall cannot
// spin it. `dtMs` beyond that is dropped, which only reaches a real frame if a
// single frame lasted a whole samosbor cycle.
SamosborTransition samosbor_step(SamosborState& st, std::uint32_t dtMs,
                                 int floorZ, SamosborRng& rng);

// True while fog/spawn pressure should be applied.
inline bool samosbor_active(const SamosborState& st) {
    return st.phase == static_cast<std::uint8_t>(SamosborPhase::Active);
}

// 0..1 progress through the current phase, for HUD bars and telegraphs.
float samosbor_phase01(const SamosborState& st);

// ---------------------------------------------------------------------------
// Unsheltered pressure
// ---------------------------------------------------------------------------

// What being caught outside shelter costs. `balance.md:106`, and the HP/PSI
// halves are confirmed by the code (`src/systems/samosbor.ts:148-149`).
inline constexpr std::uint8_t kSamosborFogRadiusCells = 4;
inline constexpr std::uint8_t kSamosborFogStrength = 155;
inline constexpr std::int16_t kSamosborUnshelteredHp = 4;
inline constexpr std::int16_t kSamosborUnshelteredPsi = 3;

// Fog radius in world metres. Authored in cells, and a cell is 2 m here
// ([world/types.h]), so radius 4 is an 8 m bubble.
inline constexpr float kSamosborFogRadiusM =
    static_cast<float>(kSamosborFogRadiusCells) * kCellSize;

struct SamosborPressure {
    std::uint8_t fogRadiusCells;
    std::uint8_t fogStrength;
    std::int16_t hpDamage;
    std::int16_t psiDamage;
};

// The cost of being unsheltered at the seal moment.
//
// ONE-SHOT, NOT A DOT — and this is the detail most likely to be ported wrong.
// `balance.md` reads like per-tick drain; the code applies it exactly once per
// samosbor, at the seal, from a single call site
// (`src/systems/samosbor.ts:1136`, latched at `:2406`). It is a *warning shot*:
// the reference even floors HP at 1 so it cannot kill. Model it as a DoT and a
// 15-minute samosbor at |z| = 50 deals 3600 damage instead of 4.
//
// TWO DOCUMENTED HOLES, not inventions:
//
//   * **PSI has no pool.** `DamageChannel::Psi` exists in [combat.h] as an
//     armour/mitigation channel, but there is no PSI *resource* anywhere in the
//     tree to drain. `psiDamage` is carried so the number lives in one place for
//     the day a pool lands; nothing reads it today. It is not routed through
//     `apply_damage` as Psi-channel HP damage, because that would silently
//     double the HP cost and quietly make the hole invisible.
//   * **Fog has no field.** `fogRadiusCells` / `fogStrength` are render inputs
//     and the sim has no fog field to write. Carried for the same reason.
//     Reference caveat if these are ever reconciled: the shipped code does not
//     use 4/155 either — it computes radius `clamp(round(5*sqrt(fogSeedMult)),
//     2, 7)` and strength `clamp(round(200*fogSeedMult), 90, 230)` per variant
//     (`src/systems/samosbor.ts:4718,4721`). 4/155 is prose only.
SamosborPressure samosbor_unsheltered_pressure(SamosborVariant variant);

// The seal moment as an offset before the end of the Active phase, including the
// variant's shift. Clamped so a negative-delta variant cannot seal after the
// event is over.
std::uint32_t samosbor_seal_before_end_ms(SamosborVariant variant);

// ---------------------------------------------------------------------------
// Threat density budget — the back-off
// ---------------------------------------------------------------------------

// Near-player pressure band. Balance the *active threats near the player*, never
// the total spawn count (`balance.md:383`): a floor with 400 sleeping mobs and 4
// awake ones near you is a fight, the same floor with 40 awake ones on top of
// you is a slideshow.
inline constexpr std::uint8_t kThreatPressureMin = 3;   // normal band floor
inline constexpr std::uint8_t kThreatPressureMax = 7;   // normal band ceiling
inline constexpr std::uint8_t kThreatSpikeMax = 10;     // rare spike, high-risk only

// Back-off thresholds. `balance.md:510`.
inline constexpr std::uint8_t kThreatBackoffOuter = 7;  // >= 7 within the outer radius
inline constexpr std::uint8_t kThreatBackoffNear = 4;   // >= 4 within the near radius
inline constexpr std::uint8_t kThreatBackoffLos = 3;    // >= 3 with a clear line of fire
inline constexpr std::uint8_t kThreatHardMaxOuter = 10; // absolute cap, no exceptions

// Radii, authored in cells by the reference; a cell is 2 m here, so these are a
// 24 m near bubble and a 40 m outer one — roughly "this room" and "this corridor
// run", which is the scale the rule is about.
inline constexpr int kThreatNearRadiusCells = 12;
inline constexpr int kThreatOuterRadiusCells = 20;
inline constexpr float kThreatNearRadiusM =
    static_cast<float>(kThreatNearRadiusCells) * kCellSize;
inline constexpr float kThreatOuterRadiusM =
    static_cast<float>(kThreatOuterRadiusCells) * kCellSize;

// A count of live hostiles around a point. Small enough to build every fog-spawn
// tick and pass by value.
//
// Invariant the predicate relies on: `withinOuter >= withinNear >= 0` and
// `withLos <= withinOuter`. `samosbor_census` maintains it; a hand-built census
// that violates it is asking the predicate a question with no answer.
struct ThreatCensus {
    std::uint8_t withinNear = 0;   // hostiles within kThreatNearRadiusM
    std::uint8_t withinOuter = 0;  // hostiles within kThreatOuterRadiusM (superset)
    std::uint8_t withLos = 0;      // of those, with a clear line of fire
};

// **The predicate that keeps a deep floor playable.** May fog spawn one more
// threat right now?
//
// This is the rule the reference wrote down and never shipped. `balance.md:510`
// specifies it with "должен" — *should* — and there is no spatial spawn gate
// anywhere in the reference's code: only a global 4096-actor soft cap
// (`data/entity_limits.ts:3`) and a one-cell occupancy check
// (`systems/samosbor.ts:4495-4507`). A global cap is not a density budget.
//
// Why it has to exist here, stated plainly: at |z| = 50 a floor is in samosbor
// **94% of the time**, so the fog spawn tick is effectively always running. With
// no local back-off it spawns until the 4096 actor pool is exhausted, all of it
// inside 40 m of the player, and the frame budget dies — the failure mode is not
// "slightly too hard", it is a floor that cannot be entered. The global cap
// cannot save it, because 4096 mobs is fine spread over a floor and fatal in one
// corridor. This is the one function in this file whose absence is a crash
// rather than a balance complaint.
//
// Gates, in order of authority:
//   1. `withinOuter >= kThreatHardMaxOuter` — absolute, ignores `highRisk`.
//   2. `withinNear >= kThreatBackoffNear` — local crowding; you are surrounded.
//   3. `withLos >= kThreatBackoffLos` — already under fire from that many.
//   4. `withinOuter >= kThreatBackoffOuter` — the normal ceiling, lifted to the
//      hard max on a high-risk floor. That lift IS the "rare spike 8..10".
bool samosbor_fog_spawn_allowed(const ThreatCensus& census, bool highRisk);

// How many more threats fog may add before a gate closes. Saturating at 0, so a
// caller loops `for (n = headroom; n > 0; --n)` without re-testing — though
// re-testing per spawn is cheaper than it looks and is what a caller should
// actually do once spawns start displacing each other.
std::uint8_t samosbor_threat_headroom(const ThreatCensus& census, bool highRisk);

// Target near-player pressure for a floor: lerp(3, 7, depth01) scaled by the
// variant's `spawnMult`, capped at 7 (or at 10 on a high-risk floor).
//
// The 3 floor is the *authored band's* floor at spawnMult 1.0, and a quiet
// variant is deliberately allowed below it — istotit's 0.52 is the point of
// istotit ("creates, heals, marks limited shelters"), not a bug to clamp away.
// Never returns 0: a samosbor with no threats at all is not a samosbor.
std::uint8_t samosbor_threat_target(int floorZ, SamosborVariant variant,
                                    bool highRisk);

// Count live mobs around `around` on `layer`, in the two radii. O(live mobs on
// the layer), no allocation, toroidal (`wrap_delta_f` — x/y/z wrap, so a mob 2 m
// away across the seam is 2 m away, not 254 m).
//
// **`withLos` is left at 0 and the LOS gate is therefore dormant.** There is no
// cheap line-of-fire query in the sim yet: `nav.h` is bake-time only and running
// a raycast per mob per fog tick would violate the O(n) tick rule. A caller that
// has a line-of-fire test may fill the field itself and the gate starts working
// with no change here. Documented rather than faked — a census that guessed at
// LOS would make the gate look enforced while enforcing nothing.
ThreatCensus samosbor_census(const Registry& reg, LayerId layer, vec3 around);

// Does the samosbor count on this floor allow this monster kind to spawn?
//
// `MobDef::minSamosbor` is `ecology.minSamosborCount` from the reference: a hard
// gate, not a weight nudge (`data/monster_ecology.ts:1890-1895` returns weight 0
// outright), with 99 meaning never. This is the join between the clock and the
// existing mob table: surviving samosbors is what unlocks the deeper roster, so
// `SamosborState::count` is a progression axis and not just a statistic.
//
// **DO NOT make this a floor's only roster filter at count 0.** Measured over
// `data/mobs.csv`: exactly **1** of the 69 kinds has `minSamosbor == 0`, 67 sit
// in 1..7, and 1 carries the 99 sentinel. So gating a fresh floor on count 0
// collapses its roster from 69 kinds to one. That is also why the reference
// defaults an absent count to **1** rather than 0
// (`data/monster_ecology.ts:1891`) — not a rounding preference, a load-bearing
// workaround for its own content distribution.
//
// This function keeps `count` honest (0 means zero survived events) and leaves
// the choice to the caller, which has two defensible options: seed a floor's
// first population at an effective count of 1, matching the reference, or treat
// this as an *unlock* layer on top of the existing floorMask/spawnWeight roster
// rather than as a replacement for it. `spawn_floor_mobs` does not consult
// `minSamosbor` at all today, so nothing regresses until someone wires it.
bool samosbor_allows_kind(const MobDef& def, std::uint16_t samosborCount);

} // namespace giga::game
