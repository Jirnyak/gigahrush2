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

namespace giga {
class MacroGrid;
}

namespace giga::game {

// Forward declarations — full types needed only in samosbor.cpp.
struct DoorSet;
class NpcPool;
struct StatusSet;
struct RoomZones;

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

// Russian DISPLAY names, ported verbatim from the reference's
// `SAMOSBOR_VARIANTS[].displayName` (`src/data/samosbor_variants.ts:272, 291, 309,
// 327, 349, 380, 404`). Parallel to `kSamosborVariantNames`, which stays the stable
// ASCII id — the two do different jobs, and collapsing them is how a save file ends
// up holding a localised string.
//
// Ported and not translated, because a translation would lose the content: "Типовой
// (ГОСТ-С)" is a state-standard joke about a routine event and "Озоновый пробой" is
// the electrical-breakdown term, neither of which "classic" or "electric" recovers.
//
// PLAYER-VISIBLE, and that is the whole reason they exist. `src/app/main.cpp` printed
// `kSamosborVariantNames` — "maronary" — on a HUD whose item, monster and faction
// names all come out of the Russian content tables, so the one word naming the event
// the player was standing inside was the only Latin word on the line.
extern const std::array<const char*, kSamosborVariantCount> kSamosborVariantNamesRu;

// One clause each on what the variant actually DOES, for the crowd to repeat
// ([rumour.h] `RumourKind::Variant`).
//
// **AUTHORED here, not ported**, and the distinction matters because the line above
// is the opposite. The reference does carry per-variant prose — `warningLines` and
// `gameplaySignal` in the same table — but at 60..120 characters each it does not fit
// a 160-byte rumour that already spends 41 bytes on a display name. Each clause is a
// compression of the effect `samosbor.md` documents for that variant, i.e. the same
// source the `SamosborVariant` enum comment above cites. A summary of shipped design,
// not an invention, and not a port either.
extern const std::array<const char*, kSamosborVariantCount> kSamosborVariantEffectRu;

inline const SamosborVariantDef& samosbor_variant_def(SamosborVariant v) {
    return kSamosborVariants[static_cast<std::size_t>(v)];
}
inline const char* samosbor_variant_name(SamosborVariant v) {
    return kSamosborVariantNames[static_cast<std::size_t>(v)];
}

// BOUNDS-CLAMPED, unlike the three accessors above, and that is not tidiness.
// `SamosborState::variant` is a raw `std::uint8_t` that a truncated save, a memset or
// a `SamosborState{}` written by hand can put outside 0..6 — `samosbor_step` already
// carries a `default:` branch for precisely that on the phase byte, so the failure is
// treated as reachable elsewhere in this file. These two are read once per FRAME by
// the HUD, and an out-of-range index is a read past a 7-pointer array handed straight
// to `snprintf("%s")`. One compare is cheaper than that class of crash, and the
// existing unclamped accessors stay as they are because their callers pass an enum
// they just built.
inline const char* samosbor_variant_name_ru(SamosborVariant v) {
    const std::size_t i = static_cast<std::size_t>(v);
    return kSamosborVariantNamesRu[i < kSamosborVariantCount ? i : 0u];
}
inline const char* samosbor_variant_effect_ru(SamosborVariant v) {
    const std::size_t i = static_cast<std::size_t>(v);
    return kSamosborVariantEffectRu[i < kSamosborVariantCount ? i : 0u];
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
//
// TWO DIFFERENT SCOPES LIVE IN ONE STRUCT, and mixing them up is how
// `minSamosbor` stayed dead. The **timer** (phaseMs/phaseTotalMs/activeMs/phase/
// variant/sealed) is per-floor: it is a function of |z| and must be re-rolled on
// arrival, which is what `samosbor_enter_floor` does. `count` is **per-run**: it
// is the progression axis `MobDef::minSamosbor` gates the roster on, so resetting
// it on a floor ride cancels the unlock permanently. Measured over the GENERATED
// `kMobTable` (not `data/mobs.csv` — see the SCULPTURE note below) against
// `anchor_for_floor`'s six habitat anchors: rows with `spawnWeightX10 > 0` whose
// `floorMask` includes the anchor, then gated by `samosbor_allows_kind`:
//
//     anchor   roster   allowed at count 0 / 1 / 2 / 3 / 4 / 7
//   ---------------------------------------------------------------
//      -50       16        0    0    3    9   14   16
//      -36       29        0    4   12   17   22   29
//      -26       42        1   11   26   31   36   42
//        0       42        0   12   31   38   40   42
//      +14       23        0   10   21   23   23   23
//      +30       26        0    2   13   22   26   26
//
// RE-MEASURED 2026-07-29, and the top three rows MOVED -- which is the whole reason a
// table like this carries a date. They used to read 15 / 28 / 41 with a 2 in the -50
// count-2 column, because SCULPTURE was quantized out of the generated table (see
// below). It no longer is. Its mask is exactly ZMinus26|ZMinus36|ZMinus50 with
// minSamosbor 2 (`mob_table.cpp` idx 53), so those three anchors each gained one
// roster slot and one more allowed kind at every count >= 2. The three roster totals
// and the whole -50 row are pinned by `test_samosbor2_all`; the -36 / -26 interior
// columns are the old sweep plus that single row, not a fresh sweep.
//
// So a per-floor `count` means every floor you walk onto has an **empty** fog
// roster on five of the six anchors, and at |z| = 50 — the floor that is in
// samosbor 94% of the time — it stays empty at count 1 as well. That is not a
// balance nudge, it is the whole subsystem producing nothing. Run-scoped `count`
// plus the relaxation rule on `samosbor_fog_roster` is what makes the column live.
//
// **The row that used to prove "read the table, not the CSV" now proves the
// generator was fixed.** SCULPTURE (`data/mobs.csv` idx 53) is authored at spawn
// weight 0.05. A naive `int(round(0.05 * 10))` is `round(0.5)`, and Python rounds
// half to EVEN, so it stored as 0 -- the same value `spawnWeightX10 == 0` uses to
// mean "hand-placed, never rolled". The row cost a table slot, a name and a
// behaviour and was unrollable by every spawner in the tree, `spawn_floor_mobs`
// included. `tools/gen_mob_table.py` now routes the column through `fixed_nonzero`,
// which floors a non-zero authored weight at one quantum, and the generated table
// carries `spawnWeightX10 == 1` (pinned by `test_samosbor2_all`). Kept as a comment
// because the TRAP is generic and the CSV gives no hint it fired: any authored value
// under half a quantum vanishes into the "never rolled" sentinel. [mob_spawn.h] still
// cites this as a live rounding accident on `samosbor_fog_roster` and is now wrong
// there; that file is not this lane's to edit.
struct SamosborState {
    std::uint32_t phaseMs = 0;       // time left in the current phase
    std::uint32_t phaseTotalMs = 0;  // what it started at, for HUD fill bars
    std::uint32_t activeMs = 0;      // rolled duration of the pending/running Active
    std::uint16_t count = 0;         // samosbors survived THIS RUN; feeds MobDef::minSamosbor
    std::uint8_t phase = 0;          // SamosborPhase
    std::uint8_t variant = 0;        // SamosborVariant; meaningful from Warning onward
    bool sealed = false;             // the one-shot seal already resolved this cycle
};
static_assert(std::is_trivially_copyable_v<SamosborState>);

// What changed in one step, so a caller reacts to transitions instead of polling
// phase every frame and diffing it itself. All flags are false on the common
// path (no transition), which is the overwhelming majority of frames — a caller
// can early-out on `!changed`.
//
// THE FLAGS ARE NOT REDUNDANT WITH `from`/`to`, and that is the reason they are
// worth their bytes. On a single-crossing step they are derivable
// (`activeBegan == changed && to == Active`), and a single crossing is what every
// ordinary 8 ms tick produces, because the shortest phase in the machine is
// `kSamosborMinIdleMs` = 3 s. But `samosbor_step` walks up to four crossings in one
// call, and on a `steps >= 2` step — a load stall, a debug time-skip, a frame that
// took longer than 3 s — `from` and `to` are the endpoints and the intermediate
// phases are gone. A caller that reconstructed `activeBegan` from `to` would miss
// exactly the transition it most needs (fog spawn pressure starting), on exactly the
// frames where missing it is invisible. Read the flags, not the pair.
//
// All three of `warningBegan` / `activeBegan` / `activeEnded` are consumed by
// `samosbor_fog_tick` ([mob_spawn.h]) — the fog population exists only between
// `activeBegan` and `activeEnded`, and `warningBegan` is the safety net that
// enforces it from the other side.
//
// **AND THAT IS THE ONLY CONSUMER THEY SHOULD EVER HAVE.** Measured 2026-07-29, before
// this lane wired the spawner: `src/app/main.cpp` read exactly two of the ten fields,
// `cycleEnded` into a HUD counter and `sealed` into the unsheltered damage call, and
// `samosbor_fog_tick` had no call site in `src/` at all. The other eight fields were
// never purposeless; six of them (`from`, `to`, `variant`, `steps`, `changed`, and the
// three edges) are the contract that function is written against, so the fog spawner,
// its density back-off, its `minSamosbor` roster unlock and its
// despawn-on-`activeEnded` were written, tested, and unreachable from a running game.
// The fix was one line at the call site, not a change here.
//
// **THAT ONE LINE HAS A TRAP IN IT, AND IT IS A ONE-KEYWORD MISTAKE.** The obvious
// shape for a caller is `if (samosbor_active(st)) samosbor_fog_tick(...)`, and it turns
// the spawner into an unbounded population leak. `activeEnded` is delivered on the tick
// `samosbor_step` moves the phase to Aftermath, so on the ONE tick that carries the
// despawn edge `samosbor_active(st)` is already false and the guard drops it. The heads
// are then never removed by anything, and the next cycle adds its own on top. The call
// must be UNCONDITIONAL: every gate the tick needs is inside it, including the
// not-Active early-out (which runs *after* the cleanup, deliberately) and the invalid
// anchor no-op. `test_samosborhud_all` drives two complete cycles both ways and pins
// the difference, because the guarded form is the version that looks correct.
//
// The size of the leak, measured rather than adjectival: the fog tops the population up
// to `samosbor_threat_target` (7, or 10 on a high-risk floor) inside the 40 m census
// bubble every `kFogSpawnPeriodTicks` (2 s), and a stationary player therefore
// saturates at 7 and stops. A player who keeps walking retires the bubble every ~13 s
// at 6 m/s, so a 15-minute Active phase at |z| = 50 refills it ~68 times: on the order
// of 470 heads per cycle, against an authored floor budget of 194, with the shared
// 4096-entity pool ~9 cycles away. Removed in full at `activeEnded`; kept in full if
// the guard swallows it.
//
// **A HUD must not read these either.** A readout wants the LEVEL (what phase is it,
// how long is left) and reconstructing that from edges costs a latch that can disagree
// with the clock. `samosbor_beat` / `samosbor_alarm` below are the level-shaped
// reading, and they need none of these fields.
struct SamosborTransition {
    std::uint8_t from = 0;        // SamosborPhase at entry
    std::uint8_t to = 0;          // SamosborPhase at exit
    std::uint8_t variant = 0;     // SamosborVariant in play
    std::uint8_t steps = 0;       // phase boundaries crossed; 0 on the common path
    bool changed = false;         // steps != 0
    bool warningBegan = false;    // decision window open: HUD, siren, clear stale fog mobs
    bool activeBegan = false;     // fog and spawn pressure start NOW (first fog tick)
    bool sealed = false;          // resolve shelter and apply unsheltered pressure
    bool activeEnded = false;     // fog and spawn pressure stop; despawn fog mobs
    bool cycleEnded = false;      // aftermath spent; `count` incremented
};

// Arm a fresh clock: phase Idle, `count` 0, first event 120..180 s away.
// Depth-independent on purpose — the very first samosbor of a run lands on the
// same schedule whether you started on the roof or in the void, because the
// depth curve is about where you *go*, not where you spawn.
//
// **Once per RUN.** Call `samosbor_enter_floor` on a floor ride; calling this
// instead is the two-defect mistake documented there.
SamosborState samosbor_new_game(SamosborRng& rng);

// Arm the clock for a floor the player has just ARRIVED on. The timer is re-rolled
// from `floorZ`'s own cooldown curve; `count` is carried across from `prev`.
//
// This exists because `samosbor_new_game` on every ride is wrong twice over, and
// both defects are silent:
//
//   1. **It zeroes `count`.** `MobDef::minSamosbor` is a per-run unlock (see
//      SamosborState), and a stack of 10 demo floors means the player rides
//      constantly, so a reset-per-ride pins the roster at count 0 forever — which
//      is an *empty* fog roster on five of six habitat anchors. The whole
//      `min_samosbor` column of `data/mobs.csv` (69 rows) becomes dead data.
//   2. **It hands out the easiest gap in the game.** `samosbor_new_game` is the
//      flat 120..180 s new-game timer, not a depth roll — its own doc says "use
//      this once". At |z| = 50 the authored cooldown is 60 s, so re-arming with the
//      new-game timer gives 2-3x the calm that floor is ever supposed to give, and
//      riding down-and-back-up is a free reset of the depth pressure the whole file
//      exists to produce. Arming off `samosbor_cooldown_ms` instead puts the first
//      samosbor 33..63 s after arrival at |z| = 50 and 22..38 min after it at z = 0.
//
// Arms via `samosbor_arm(cooldown - kSamosborAftermathMs)`, exactly as the
// Aftermath branch of `samosbor_step` does, so a ride and a completed cycle produce
// the same distribution of gaps. The subtraction cannot underflow: the smallest
// cooldown is `kSamosborCooldownFloorMs` (45 s) and the difference is
// `kSamosborArmFloorMs` (33 s) on the nose.
SamosborState samosbor_enter_floor(const SamosborState& prev, int floorZ,
                                   SamosborRng& rng);

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
// The beat — what the clock is telling the player RIGHT NOW
// ---------------------------------------------------------------------------

// The samosbor is the central clock of the game and until now the player's entire
// information about it was one debug line reading `samosbor warning classic 43%`. The
// 30 s warning window is the single most consequential decision in the loop — shelter,
// run, shut a door, drop the haul, or take the hit — and it was being delivered in the
// same weight of text as the frame time.
//
// **A HUD READS LEVEL, NOT EDGE, which is why nothing here takes a
// SamosborTransition.** This lane was briefed to give `warningBegan` / `activeBegan` /
// `activeEnded` a HUD consumer. They should not have one, and the reason is worth
// stating once: an edge obliges its reader to keep a latch, and a latch in
// `src/app/main.cpp` is a fourth copy of the clock that can disagree with the other
// three. Every beat below is recovered from `SamosborState` alone — `phase`, `phaseMs`,
// `phaseTotalMs`, `sealed`, `variant`, `count` — which is exactly the information the
// edge carried, minus the bookkeeping. Consequences, all of them load-bearing: the
// banner cannot go stale, cannot be missed by a frame that skipped a tick or by
// `samosbor_step`'s four-crossing clamp, survives a save/load with no extra field, and
// costs the call site ONE inserted line instead of a declaration plus an update plus a
// draw.
//
// The edge flags are not dead and must not be deleted. They have exactly one consumer
// that genuinely needs them — `samosbor_fog_tick` ([mob_spawn.h]), which creates and
// destroys entities and so must act once per crossing, not once per frame. That is the
// dividing line: **a side effect needs the edge, a readout needs the level.**
enum class SamosborBeat : std::uint8_t {
    None = 0,   // nothing worth an alarm line
    Warning,    // the decision window is open
    Impact,     // the fog just arrived
    Seal,       // the one-shot unsheltered cost just resolved
    Clear,      // aftermath: the fog is leaving and its mobs are gone
    Count
};

// How long the three edge-shaped beats stay up. Warning is deliberately NOT in this
// list: it holds for its whole 30 s window (see `samosbor_beat`).
//
// AUTHORED, and the only constraint that is structural rather than taste is the
// static_assert below — a Clear window longer than the Aftermath phase would be a
// banner the phase cannot outlive, so it would silently truncate instead of expiring.
inline constexpr std::uint32_t kSamosborBeatImpactMs = 4u * 1000u;
inline constexpr std::uint32_t kSamosborBeatSealMs = 3u * 1000u;
inline constexpr std::uint32_t kSamosborBeatClearMs = 4u * 1000u;
static_assert(kSamosborBeatClearMs < kSamosborAftermathMs,
              "the Clear banner must expire inside the Aftermath phase, not with it");
static_assert(kSamosborBeatImpactMs < kSamosborDurationFloorMs,
              "the Impact banner must expire inside even the shortest Active phase");

// Pulse cadence for the alarm colour. 1 Hz normally; 4 Hz over the last 5 s of the
// WARNING window only, which is the one place in the cycle where the rate carries
// information — the player has 5 s left to be somewhere else.
inline constexpr std::uint32_t kSamosborBeatPulseMs = 1000u;
inline constexpr std::uint32_t kSamosborBeatFastPulseMs = 5u * 1000u;
inline constexpr std::uint32_t kSamosborBeatFastPulsePeriodMs = 250u;
static_assert(kSamosborBeatFastPulseMs < kSamosborWarningMs,
              "the fast pulse is the TAIL of the warning window, not the whole of it");

// Minimum `cap` for `samosbor_beat_text`. 160 to match `rumour_text`, which is the
// other Russian one-liner on the same HUD.
//
// MEASURED, not guessed. The longest beat is Warning at 121 bytes: 73 bytes of literal
// after the three conversions are removed, plus 41 for the longest display name
// ("Красный биологический"), plus 2 for the seconds and 5 for a saturated `count`. The
// rest are 98 (Impact), 47 (Seal) and 58 (Clear). 160 leaves 38 bytes of margin, which
// is one more display name's worth if a variant is ever renamed.
inline constexpr std::size_t kSamosborBeatTextCap = 160;

// What beat the clock is on. Pure, no allocation, one switch plus at most one table
// lookup — cheap enough that `samosbor_beat_text` and `samosbor_beat_pulse01` each
// call it rather than making the caller thread a result through.
SamosborBeat samosbor_beat(const SamosborState& st);

// Render the current beat into `out` as a Russian alarm line. False when the beat is
// `None` (and then `out` is untouched, so a caller can hold the previous line if it
// wants to) or when `cap < kSamosborBeatTextCap`.
//
// Bounded, no allocation, no exceptions. The numbers in it are the real ones: the
// warning counts DOWN with `phaseMs`, the impact line states the whole Active
// duration, and the seal line prints `samosbor_unsheltered_pressure().hpDamage` rather
// than a hardcoded 4 — so the one-shot cost is taught to the player from the same
// constant the damage is billed from.
bool samosbor_beat_text(const SamosborState& st, char* out, std::size_t cap);

// 0..1 alarm pulse, for a colour or an alpha. 0 when there is no beat.
//
// Derived from `phaseMs` rather than from a caller-side timer, which is what keeps the
// whole beat system stateless: the pulse is a triangle wave on the countdown itself, so
// it is frame-rate independent, identical on a replay, and correct after a load. A
// triangle and not a sine on purpose — a linear ramp reads as an alarm lamp, a sine
// reads as breathing — and it also means no <cmath> in a header that has none.
float samosbor_beat_pulse01(const SamosborState& st);

// The whole alarm as ONE value, so the call site is ONE inserted line.
//
// **This exists for a call-site reason, not a logic one, and the reason is worth a
// paragraph because it is the difference between the beat shipping and the beat sitting
// in this file unread.** Delivered as `samosbor_beat_text` + `samosbor_beat_pulse01` the
// banner costs the caller a 160-byte buffer declaration, a call, a branch and a draw --
// four lines threaded into an existing HUD block, which is exactly the shape of change
// that gets deferred. Bundled, it is:
//
//     if (const auto a_ = samosbor_alarm(st); a_.on)
//         ImGui::TextColored(col, "%s", a_.text);
//
// one line, no buffer at the call site, no latch, nothing to keep in sync.
//
// **The array is BY VALUE and that is the whole design.** The tempting signature is
// `const char* samosbor_alarm(...)`, and every implementation of it is wrong here: a
// `static` buffer is not reentrant and lies on a replay, and a pointer to anything local
// dangles. 168 bytes copied once per HUD frame is ~10 KB/s at 60 Hz, against a function
// that already runs one `snprintf` -- the copy is not the cost, the `snprintf` is, and
// that happens either way.
//
// `pulse` rides along rather than being a second call because the colour and the text
// must describe the SAME beat. Two calls cannot actually disagree inside one frame, but
// they can be reordered around a `samosbor_step` by a later edit, and then the banner
// reads Warning while the colour pulses at the Impact rate. One call, one answer.
//
// `text` is empty and `pulse` is 0 when the beat is `None`, so `on` is the only test a
// caller needs. Pure, no allocation, no exceptions, no RTTI.
struct SamosborAlarm {
    char text[kSamosborBeatTextCap] = {};  // NUL-terminated Russian line; empty when off
    float pulse = 0.0f;                    // samosbor_beat_pulse01, 0..1
    std::uint8_t beat = 0;                 // SamosborBeat
    bool on = false;                       // beat != None, i.e. `text` has content
};
// No size assert: this is a HUD value, never serialized and never inside a size-gated
// blob, so pinning its padding would add a failure mode and buy nothing. Trivial
// copyability IS pinned, because "returned by value, holds no pointer" is the property
// the paragraph above argues for and a later member could quietly break it.
static_assert(std::is_trivially_copyable_v<SamosborAlarm>);

SamosborAlarm samosbor_alarm(const SamosborState& st);

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

// ---------------------------------------------------------------------------
// Atmospheric Hazard Dynamics, Stage Progression & Post-Processing
// ---------------------------------------------------------------------------

// Samosbor stage progression matching the full atmospheric storm lifecycle.
// Idle -> Warning -> Active (onset) -> Peak (maximum crisis) -> Dissipation -> Aftermath
enum class SamosborStage : std::uint8_t {
    Idle = 0,
    Warning,      // Siren / alarm sounds, barometric pressure begins dropping
    Active,       // Fog onset, toxic gas diffusion, pressure depression accelerates
    Peak,         // Vortex maximum: minimal pressure, peak ambient toxicity, heavy aberration & screen shake
    Dissipation,  // Hazard receding, pressure recovering, toxicity clearing
    Aftermath,    // Hazard cleared, residual haze settling, count incremented
    Count
};
inline constexpr std::size_t kSamosborStageCount =
    static_cast<std::size_t>(SamosborStage::Count);

// Atmospheric post-processing and physical parameters for rendering and HUD.
struct SamosborAtmosphere {
    SamosborStage stage = SamosborStage::Idle;
    float pressureKpa = 101.325f;     // Floor barometric pressure (101.3 kPa standard, drops down to ~30-60 kPa in Peak)
    float toxicity01 = 0.0f;          // Ambient toxicity level [0.0, 1.0] (scaled by variant and depth)
    float fogDensity = 0.0f;          // Volumetric fog density [0.0, 1.0]
    float chromaticAberration = 0.003f;// Radial chromatic aberration for post-processing shader
    float screenShake = 0.0f;         // Screen/camera shake amplitude (metres / radians)
    float fogScale = 1.0f;            // Visual fog distance multiplier (1.0 normal, 0.34 in peak)
};

inline constexpr float kSamosborFogSqueeze = 0.34f;

const char* samosbor_stage_name(SamosborStage s);
SamosborStage samosbor_current_stage(const SamosborState& st);
float samosbor_floor_pressure_drop(int floorZ, SamosborVariant variant, SamosborStage stage);
float samosbor_ambient_toxicity(int floorZ, SamosborVariant variant, SamosborStage stage, float phase01 = 0.5f);
SamosborAtmosphere samosbor_compute_atmosphere(const SamosborState& st, int floorZ, float timeSec = 0.0f);

// Blast door hermetic seal check: hermetic sealing prevents toxic gas diffusion
// into shelter rooms (distance <= 4 cells / dx²+dy²+dz² <= 16 to a shut/locked hermetic door).
bool samosbor_is_sheltered(const vec3& pos, const DoorSet& doors,
                           const MacroGrid* grid = nullptr,
                           const RoomZones* rooms = nullptr);

// Continuous Active-phase environmental pressure applied every sim tick.
// Unsealed entities take 0.5 HP/s base drain + variant need drains.
// Sheltered entities in hermetically sealed rooms/sectors take zero damage.
void samosbor_environmental_step(Registry& reg, NpcPool& pool,
                                  const DoorSet& doors, LayerId layer,
                                  const SamosborState& sam, float dt,
                                  StatusSet* playerStatus = nullptr,
                                  const MacroGrid* grid = nullptr,
                                  const RoomZones* rooms = nullptr);

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
// That claim was **unfalsifiable until 2026-07-29**, because nothing in `src/`
// called this or anything that called it: the only caller was
// `samosbor_threat_headroom`, which had no caller of its own. An untested crash
// guard is not a guard. `samosbor_fog_tick` ([mob_spawn.h]) is now the live caller,
// it re-tests this predicate after **every** individual spawn rather than trusting
// the headroom it computed at entry, and `test_samosbor2_all` drives it against a
// census above and below the target.
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
// **NOT a per-tick call.** `samosbor_fog_tick` runs it once every
// `kFogSpawnPeriodTicks` (250 ticks = 2 s at kSimHz), and the cadence is a design
// gate before it is a perf one. Estimated cost per sweep, from the work in the loop
// (three `wrap_delta_f`, each a float divide plus a floor, then three multiplies and
// two compares): ~30-40 ns per mob, so ~20 us at the demo's 600-head cap and
// ~140 us at the 4096 budget. Per tick that would be 0.25%-1.75% of one core —
// survivable, and NOT the reason for the cadence. The reason is that spawning up to
// four heads every 8 ms reads as monsters teleporting in; at 2 s the same budget
// reads as pressure building. Estimated, not profiled: no profiler was run.
//
// Optional `grid`: when non-null, tests los_clear on hostiles within near radius
// and populates withLos. Null keeps withLos at 0.
ThreatCensus samosbor_census(const Registry& reg, LayerId layer, vec3 around,
                             const MacroGrid* grid = nullptr);

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
// **AND THE 69-KIND FIGURE UNDERSTATES IT.** A fog roster is already narrowed by
// `floorMask` and `spawnWeightX10 > 0` before this gate sees it, and per habitat
// anchor that leaves 15..42 kinds — of which **zero** pass at count 0 on five of the
// six anchors, and zero at count 1 as well on ZMinus50. The full table is in the
// SamosborState comment above. So "collapses to one kind" is the global view; the
// view that matters to a spawner is "collapses to none".
//
// This function keeps `count` honest (0 means zero survived events) and leaves the
// resolution to the caller. `samosbor_fog_roster` ([mob_spawn.h]) is that caller and
// it resolves it by **relaxation, not by a magic default**: build the gated roster,
// and if it came out empty, re-evaluate the gate at the roster's own minimum
// `minSamosbor` — the floor's first unlock. The ordering is preserved, so every count
// above that minimum still admits strictly more kinds, and no floor can ever produce
// an empty fog roster. Measured at ZMinus50: count 0 and 1 draw from the 2 kinds
// whose minSamosbor is 2 (SHADOW, TONKAYA_TEN), count 3 from 8, count 7 from all 15.
// The reference's "default an absent count to 1" workaround
// (`monster_ecology.ts:1891`) does NOT solve this — it is still 0 kinds at ZMinus50 —
// which is evidence its content distribution and its habitat masks were never checked
// against each other.
//
// `spawn_floor_mobs` still does not consult `minSamosbor`: the floor-load roster is
// deliberately ungated, so the unlock layer applies to fog arrivals only and a fresh
// floor's authored population is unchanged.
bool samosbor_allows_kind(const MobDef& def, std::uint16_t samosborCount);

} // namespace giga::game
