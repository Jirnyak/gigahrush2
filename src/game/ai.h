// Utility AI — the intent ARBITER for embodied NPC bodies ([ai.md], #12).
//
// ===========================================================================
// READ THIS FIRST: WHO OWNS `Velocity`.
// ===========================================================================
// This file exists because main already has systems that steer. Dropping a
// second steerer in would make two systems write the same body's horizontal
// `Velocity` on the same tick, and the symptom is a creature that vibrates —
// a bug that reads as broken physics and is not. The parked branch driver
// (`tools/branch_port_pending/ai.cpp`) was exactly that second writer, which is
// why `main.cpp` parked it instead of calling it.
//
// The measured writer list on main (2026-07-29, per-tick passes only):
//
//   controller_step   src/sim/controller.cpp    view<Transform,Velocity,Controller,CameraTag>
//                     -> the camera holder ONLY (needs BOTH Controller and
//                        CameraTag). Unconditional every tick. The player.
//   wander_step       src/game/wander.cpp      view<Transform,Velocity,WanderTarget>
//                     -> layer-filtered, skips CameraTag, identity-staggered
//                        1-in-kWanderPeriod(8). EVERY visited body is written
//                        (each branch either steers or explicitly zeroes x/y).
//                        This is the crowd's real steerer: flow-field roaming,
//                        pack cohesion, mob pursuit, gaze-freeze, wall-bias pace.
//   investigate_step  src/game/investigate.cpp view<const MobRef,const Transform,Velocity>
//                     -> MOBS ONLY. Never touches a body without MobRef, so it
//                        cannot collide with this file's scope. Deliberately
//                        shares wander's stagger phase to override it.
//   physics_step      src/sim/physics.cpp      view<Transform,Velocity> excl SelfIntegrating
//                     -> reads to integrate; writes v.z (gravity/jump) and zeroes
//                        an axis on collision. The integrator, not a steerer.
//   slow_step         src/game/combat.cpp      view<Slowed,Transform,Velocity>
//                     -> CLAMPS magnitude, idempotent by construction. A
//                        post-filter, not an owner. NOT wired in main.cpp today.
//   faction_feud_step src/game/faction_relations.cpp view<Transform,Velocity,const NpcRef>
//                     -> IS a second NPC writer, and it is LIVE: main.cpp calls it
//                        every tick (main.cpp ~line 1022, after wander_step and
//                        investigate_step, before physics_step), and it writes
//                        `Velocity& vel = view.get<Velocity>(e)` at
//                        faction_relations.cpp ~line 270. Its scope is EXACTLY this
//                        file's — an NpcRef body — so it needs the SAME one-line
//                        guard wander_step gets below, and it needs it on the day
//                        `AiConfig::enabled` is first set true. An earlier revision
//                        of this comment claimed it was unwired; that was wrong, and
//                        it is the one hole in the single-writer claim below.
//                        Gated on a staggered fight licence plus an enemy in range,
//                        so the overlap is a handful of bodies per tick — and because
//                        it runs LAST the symptom is not vibration but a flee that is
//                        silently cancelled: the AI's write is simply discarded.
//   one-shot, not per-tick: embody.cpp / mob_spawn.cpp / loot.cpp emplace a
//                        zeroed Velocity at creation; combat.cpp emplaces a
//                        projectile's launch velocity; save.cpp zeroes on load.
//
// THE RULE THIS FILE ENFORCES: for a given body on a given tick, exactly one
// system writes horizontal `Velocity`. It is enforced by a TOKEN, not by call
// order — call order is not a contract (main.cpp already reorders this loop for
// samosbor, and a last-writer-wins arrangement breaks silently the next time it
// moves, while also paying for a write nobody reads).
//
// STATE OF THAT RULE — CORRECTED, and the previous revision was wrong in a way worth
// recording. It claimed the token mechanism was complete and that `wander_step`'s
// guard was "proven from both sides by suite_utilai.inl", leaving only
// `faction_feud_step` outstanding. In fact `ai_owns_motion` had NO caller anywhere in
// `src/`: every reference to it lived inside `suite_utilai.inl`, which applies the
// guard in its own harness. The suite therefore proved the RULE and not the WIRING,
// while this header read as though the wiring existed — so unparking `ai_step` would
// have produced exactly the vibration the whole design exists to prevent.
//
// Both call sites are real now: `src/game/wander.cpp` and
// `src/game/faction_relations.cpp` each carry `if (ai_owns_motion(reg, e)) continue;`.
// The mechanism is whole in the tree, not only in the test's model of it.
//
// Both guards are ADDITIVE while `ai_init` has no caller: no `AiBrain` means
// `ai_owns_motion` returns false, so both passes are bit-for-bit what they were. That
// is deliberate — the guards land BEFORE the AI is switched on, so the day `ai_step`
// is unparked is a one-line change against arbitration that is already green, instead
// of three interacting changes landing together.
//
// The token is `AiBrain::motion`. `ai_step` runs BEFORE `wander_step`, decides
// per body whether it or wander steers this tick, and writes the token. Then:
//
//   * `ai_step` writes Velocity iff `motion == MotionOwner::Ai`;
//   * `wander_step` skips a body iff `ai_owns_motion(reg, e)` — one line.
//
// Two properties make this safe to land:
//
//   1. NO `AiBrain` COMPONENT => `ai_owns_motion` is false => wander_step
//      behaves EXACTLY as it does today. `AiBrain` is attached only by
//      `ai_init`, so if `ai_init` is never called the guard is a load of a null
//      pointer and nothing else changes. That is what makes default-off real
//      rather than aspirational.
//   2. SCOPE IS EMBODIED NPC BODIES: `NpcRef` and NOT `MobRef` and NOT
//      `CameraTag`. Mobs keep the existing wander/investigate arbitration
//      untouched (they have their own behaviour tables, [mob_behaviour.h]); the
//      player keeps `controller_step`. So the foreign steering systems that need a
//      guard are `wander_step` and `faction_feud_step` — two `continue`s, no more,
//      and BOTH ARE IN PLACE as of this revision,
//      because `investigate_step` is excluded by TYPE (it views `const MobRef`) and
//      `controller_step` needs BOTH `Controller` and `CameraTag`. See "STATE OF THAT
//      RULE" above for how this claim was wrong before both guards were real.
//
// ===========================================================================
// WHAT THE BRAIN ACTUALLY DECIDES
// ===========================================================================
// A pure scorer ranks 13 intents 0..100; argmax + hysteresis commits one. Ported
// from the reference `npc_utility.ts` / `npc_fsm.ts` per-intent bodies. Inputs
// the engine cannot yet supply (mob perception, a room-affordance model, a
// minute-of-day clock) enter through the `Perception` seam at zero/none/-1, so
// their additive terms contribute 0 and the ranking among the LIVE inputs
// (needs + the diffusion danger field + faction traits) is the reference's.
//
// Only ONE intent currently earns Ai ownership: `IntentFlee`, which steers down
// the baked diffusion danger gradient ([diffusion.md]) — a motion no other
// system in the tree produces. Every other intent delegates to `wander_step`,
// because wander already owns the flow-field roaming this engine has and
// duplicating it here would be a worse copy. That is the honest state: the brain
// currently decides WHETHER a body flees, and wander decides where everyone else
// walks. Intents gain their own destinations (and their own ownership) when #13
// content gives them reachable target cells.
//
// STORAGE: needs are NOT re-homed here. `Needs` is a NpcPool row on purpose
// ([needs.h]: the elevator destroys and rebuilds the player body, so a component
// would reset the survival clock every floor ride). This file only READS that
// row, and never advances it — widening the survival clock to the crowd is a
// separate decision [needs.h] explicitly defers. A crowd row is usually
// `seeded == 0` (all zeros), which would read as "starving, parched and
// exhausted" and peg the whole crowd on eat/drink; so an unseeded row is
// substituted by a deterministic local roll from the record id. Local, not
// written back: the scorer mutates no shared state.
#pragma once

#include <cstdint>

#include "core/rng.h"          // hash_u32 / hash2 / rand01 — stateless identity hashing
#include "ecs/registry.h"      // Registry, Entity
#include "game/faction.h"      // Faction / kFactionCount — the trait table's index
#include "game/npc_pool.h"     // NpcPool, NpcId, Needs (the pool row this reads)
#include "world/level_stack.h" // LayerId

// Pointer/reference parameters need only a declaration, so the header stays
// light; ai.cpp includes world/field.h + world/macro_grid.h for the definitions.
namespace giga {
template <class T> class Field;
class MacroGrid;
} // namespace giga

namespace giga::game {

// ---------------------------------------------------------------------------
// The 13 intents, in the reference's fixed order.
//
// The INDEX is load-bearing twice over: `select_intent` breaks argmax ties
// toward the lower index, and each intent's identity-jitter channel is
// "score:<name>" (kIntentScoreChannel), so reordering reshuffles every agent's
// behaviour.
// ---------------------------------------------------------------------------
enum IntentId : std::uint8_t {
    IntentSafety = 0,
    IntentCombat,
    IntentFlee,
    IntentToilet,
    IntentDrink,
    IntentEat,
    IntentSleep,
    IntentWork,
    IntentHeal,
    IntentSocial,
    IntentPatrol,
    IntentFactionAssault,
    IntentWander,
    kIntentCount
};

// "no committed intent yet" sentinel for AiBrain::currentIntent.
inline constexpr std::uint8_t kIntentNone = 0xFFu;

inline constexpr const char* kIntentName[kIntentCount] = {
    "safety", "combat", "flee",   "toilet", "drink",  "eat",   "sleep",
    "work",   "heal",   "social", "patrol", "assault", "wander",
};
// The reference keys its jitter channels by the runtime string "score:"+name.
// Pre-built literals so the hot path folds a fixed string with no concatenation.
inline constexpr const char* kIntentScoreChannel[kIntentCount] = {
    "score:safety", "score:combat", "score:flee",   "score:toilet",
    "score:drink",  "score:eat",    "score:sleep",  "score:work",
    "score:heal",   "score:social", "score:patrol", "score:faction_assault",
    "score:wander",
};

// ---------------------------------------------------------------------------
// MotionOwner — the arbitration token. See the file header.
//
// `Wander` is 0 so a zero-initialised `AiBrain` delegates: the failure mode of
// forgetting to set the token is "behaves like today", never "frozen crowd".
// ---------------------------------------------------------------------------
enum class MotionOwner : std::uint8_t {
    Wander = 0, // wander_step writes this body's horizontal Velocity
    Ai = 1,     // ai_step writes it; wander_step must skip the body
};

// ---------------------------------------------------------------------------
// AiBrain — the whole per-body brain state, and it is deliberately tiny.
//
// The reference parks this in module WeakMaps; here it is an ECS component so it
// materialises on `ai_init` and folds away with the entity, like Velocity.
// `nextDecisionAt` is the ONLY scheduling state: no wheel, no queue, no per-body
// timer list. `switches` is telemetry that exists to be measured — a hysteresis
// claim you cannot count is not a claim.
// ---------------------------------------------------------------------------
struct AiBrain {
    std::uint8_t currentIntent = kIntentNone;
    std::uint8_t motion = static_cast<std::uint8_t>(MotionOwner::Wander);
    std::uint16_t decisions = 0; // re-plan count
    std::uint16_t switches = 0;  // times currentIntent actually CHANGED
    std::uint16_t pad_ = 0;
    float stateTimer = 0.0f;     // seconds committed to currentIntent
    float nextDecisionAt = 0.0f; // absolute sim time of the next re-plan
};
static_assert(sizeof(AiBrain) == 16, "the whole brain is 16 bytes per body");

// THE GUARD other steering systems call. One line at the top of their per-entity
// body: `if (ai_owns_motion(reg, e)) continue;`.
//
// A body with no AiBrain returns false, which is what makes this additive: with
// `ai_init` never called, every existing steerer is bit-for-bit unchanged.
inline bool ai_owns_motion(const Registry& reg, Entity e) {
    const AiBrain* b = reg.try_get<AiBrain>(e);
    return b != nullptr && b->motion == static_cast<std::uint8_t>(MotionOwner::Ai);
}

// --- Identity hashing -------------------------------------------------------
// Reuses the shared lowbias32 finaliser ([core/rng.h] hash_u32 == the reference
// mix32) and rand01 (== the reference jitter01). Only the FNV-1a string fold is
// AI-local, because the reference keys its jitter channels by string and we
// reproduce that byte-for-byte. DISTINCT from the Murmur3 fmix32 used elsewhere.
inline constexpr std::uint32_t kFnvPrime = 16777619u;    // FNV-1a 32
inline constexpr std::uint32_t kHashGolden = 0x9e3779b9u; // channel decorrelator

inline void fnv_fold(std::uint32_t& h, const char* s) {
    for (; *s != '\0'; ++s) {
        h ^= static_cast<std::uint32_t>(static_cast<unsigned char>(*s));
        h *= kFnvPrime;
    }
}

// channelSeed(idSeed, channel): fold the channel string into idSeed^golden, then
// finalise with mix32. Matches the reference channelSeed string path.
inline std::uint32_t channel_seed(std::uint32_t idSeed, const char* channel) {
    std::uint32_t h = idSeed ^ kHashGolden;
    fnv_fold(h, channel);
    return hash_u32(h);
}

// Per-agent identity seed (the reference `alifeId` channel). The NpcId is the
// stable identity, so an agent's jitter is reproducible across embodiments with
// zero stored RNG state — the same body behaves the same way after an elevator.
inline std::uint32_t identity_seed(std::uint32_t npcId) {
    return hash_u32(0xa11fe000u ^ npcId);
}

// Signed jitter in [-amp, amp] (rand01 == the reference jitter01).
inline float jitter_signed(std::uint32_t channelSeed, float amp) {
    return (rand01(channelSeed) * 2.0f - 1.0f) * amp;
}

// --- Faction traits ---------------------------------------------------------
// With no occupation layer yet ([npcs.md]), the scorer's behavioural traits
// resolve purely from faction. The table is kFactionCount + 1 rows wide because
// `kFactionPlayerRow` ([faction_relations.h]) is a real index a pool row can
// hold; the player row equals the Citizen row, which is the reference's
// "default" branch. `workDrive` is the reference default 0.5 everywhere until
// occupations land.
inline constexpr std::size_t kAiTraitRows = kFactionCount + 1;
struct FactionTraits {
    float duty;
    float sociability;
    float risk;
    float panic;
    float patrolDrive;
    float workDrive;
};
inline constexpr FactionTraits kFactionTraits[kAiTraitRows] = {
    /* Citizens    */ {0.55f, 0.48f, 0.32f, 0.50f, 0.08f, 0.50f},
    /* Liquidators */ {0.82f, 0.48f, 0.74f, 0.22f, 0.82f, 0.50f},
    /* Cultists    */ {0.62f, 0.32f, 0.60f, 0.35f, 0.58f, 0.50f},
    /* Scientists  */ {0.74f, 0.48f, 0.32f, 0.50f, 0.08f, 0.50f},
    /* Wild        */ {0.55f, 0.25f, 0.60f, 0.35f, 0.42f, 0.50f},
    /* Player row  */ {0.55f, 0.48f, 0.32f, 0.50f, 0.08f, 0.50f},
};
// Clamp rather than modulo: folding an out-of-range faction onto Citizens would
// repeat the `faction & 3` bug that silently made Wild behave like a citizen.
inline const FactionTraits& faction_traits(std::uint16_t faction) {
    const std::size_t i = static_cast<std::size_t>(faction);
    return kFactionTraits[i < kAiTraitRows ? i : kAiTraitRows - 1];
}

// ---------------------------------------------------------------------------
// Perception — the momentary snapshot the scorer reads.
//
// Built once per body per re-plan from whatever the engine exposes today. Every
// field the engine cannot supply keeps its zero/none/-1 default so the
// corresponding term vanishes; the -1 sentinels reproduce the reference's
// `undefined` branches exactly. The scorer is a PURE function of
// (Perception, Needs) — it never touches the pool or the world — which is what
// lets a later system fill a field and switch its term on with NO scorer edit,
// and what lets the whole ranking be unit-tested headless.
// ---------------------------------------------------------------------------
struct Perception {
    // -- live today --
    std::uint32_t idSeed = 0;  // identity_seed(NpcId)
    std::uint16_t faction = 0; // -> faction_traits()
    float hp = 0.0f;
    float maxHp = 0.0f;
    float danger = 0.0f; // the diffusion "danger" field at the body's cell

    // -- per-body state from AiBrain, set by the driver --
    std::uint8_t currentIntent = kIntentNone;
    float stickinessAmount = 0.0f; // 0 when hysteresis is disabled
    float minuteOfDay = -1.0f;     // <0 == no clock -> every rhythm term is 0

    // -- stubbed: 0/false/-1 => the term contributes 0 --
    float visibleHostiles = 0.0f;
    float threatDistance = -1.0f; // metres; -1 == reference `undefined`
    float hostilePower = 0.0f;
    float allyPower = 0.0f;
    bool strongerHostile = false;
    bool cornered = false;
    bool armed = false;
    bool orderedCombat = false;
    bool inShelter = false;
    bool isTraveler = false;
    bool factionAssaultTarget = false;
    float monster = 0.0f;
    float gunfire = 0.0f;
    float fire = 0.0f;
    float fog = 0.0f;
    bool samosborActive = false;
    bool samosborWarning = false;
    // Room-affordance bias and the chosen target's cost. Per-intent in the
    // reference; scalar-zero here because there is neither a room model nor
    // per-intent target resolution yet. They become per-intent arrays when
    // rooms/targets land — additive, no coefficient changes.
    float localScore = 0.0f;
    float targetPenalty = 0.0f;
};

// --- Selection FSM thresholds (the SHIPPING values from npc_fsm.ts) ---------
// The switch margin is the FSM override 7, NOT the npc_utility default 8; using
// 8 diverges at the hysteresis boundary.
inline constexpr float kSwitchMargin = 7.0f;
inline constexpr float kEmergencyScore = 58.0f;
inline constexpr float kRethinkBaseSec = 1.5f;   // re-plan cadence lower bound
inline constexpr float kRethinkSpreadSec = 2.5f; // + rand01*spread -> [1.5, 4.0]
inline constexpr float kStickBase = 5.0f;        // stickiness at t=0
inline constexpr float kStickCap = 7.0f;         // max growth of the bonus
inline constexpr float kStickPerSec = 0.18f;     // growth per second held

// The re-plan stagger's jitter channel: a distinct hash stream from the score
// jitter, so cadence phase is uncorrelated with the score nudges.
inline constexpr const char* kRethinkChannel = "utility_rethink";

// Flee pace, m/s. Matched to `wander.cpp`'s kNpcWalkSpeed (1.35) times a panic
// factor: a body running from a danger gradient should visibly outpace a body
// strolling to a lattice node, or the intent is invisible. DATA, retune freely.
inline constexpr float kFleeSpeed = 1.35f * 1.6f;

// Below this squared gradient magnitude the danger field carries no usable
// direction (uniform or empty), and flee hands ownership BACK to wander rather
// than writing a zero velocity — a frozen body is a worse answer than a
// strolling one.
inline constexpr float kMinFleeGrad2 = 1e-10f;

// The survival intents that may preempt the current one without the margin.
inline bool intent_is_emergency(std::uint8_t intent) {
    return intent == IntentSafety || intent == IntentFlee ||
           intent == IntentCombat || intent == IntentHeal;
}

// Stickiness bonus for the current intent: 5 + min(7, t*0.18) -> [5, 12].
inline float stickiness_amount(float stateTimer) {
    const float grown = stateTimer * kStickPerSec;
    return kStickBase + (grown < kStickCap ? grown : kStickCap);
}

// Pure scorer: fill out[kIntentCount] with each intent's 0..100 utility. No side
// effects, no world reads, order-independent. The current intent's stickiness
// bonus is applied HERE (via Perception::stickinessAmount) so `select_intent`
// only needs raw scores — matching the reference.
void score_intents(const Perception& p, const Needs& needs, float out[kIntentCount]);

// Plain argmax, ties toward the lower index. This is selection with hysteresis
// DISABLED, and it is public because proving the hysteresis does something means
// measuring both arms.
std::uint8_t select_intent_raw(const float scores[kIntentCount]);

// Argmax + hysteresis. An emergency survival intent scoring >= kEmergencyScore
// preempts immediately; otherwise a challenger must beat the incumbent (which
// already carries its stickiness bonus) by kSwitchMargin. Pass kIntentNone for a
// fresh body (returns the raw argmax).
std::uint8_t select_intent(const float scores[kIntentCount], std::uint8_t current);

// ---------------------------------------------------------------------------
// The driver.
// ---------------------------------------------------------------------------

// `enabled` DEFAULTS TO FALSE. The system is wired, tested and dormant until a
// caller opts in — [AGENTS.md] "keep the build green at every step" applied to
// behaviour: a dormant tested system beats one that fights physics.
//
// `hysteresis` is a real switch and not a debug flag: it is the axis the test
// measures. With it off, stickiness is zeroed AND selection is raw argmax, so
// the two arms differ in exactly the mechanism under test.
//
// The cadence is configurable because the shipping [1.5, 4.0] s cadence is
// 187..500 ticks at kSimHz, so a 100-tick measurement would contain at most one
// re-plan and could not distinguish anything. Setting both to 0 makes every tick
// a re-plan, which is the only way "switches per 100 ticks" is a number.
struct AiConfig {
    bool enabled = false;
    bool hysteresis = true;
    float rethinkBaseSec = kRethinkBaseSec;
    float rethinkSpreadSec = kRethinkSpreadSec;
};

// What one `ai_step` did. Returned rather than only published so a HUD or a test
// can print it without re-scanning the registry.
struct AiTick {
    std::uint32_t considered = 0; // bodies in scope on this layer
    std::uint32_t replanned = 0;  // bodies whose deadline came due
    std::uint32_t switches = 0;   // committed intent actually CHANGED
    std::uint32_t aiOwned = 0;    // bodies ai_step steered (wander skipped them)
    std::uint32_t wanderOwned = 0; // bodies delegated to wander_step
};

// Attach an `AiBrain` to every embodied NPC body on `layer` that lacks one, and
// return how many were attached. Call after the floor is populated, alongside
// `wander_init`.
//
// Explicit rather than lazy inside `ai_step` for two reasons. (1) Emplacing a
// component mid-view can reallocate the registry's pool container and dangle the
// view being iterated — the crash discipline combat.cpp/wander.cpp document at
// length; doing it in a separate entry point makes the hazard structural rather
// than a comment. (2) It keeps `ai_step` a single allocation-free sweep, so the
// per-tick cost is one pass and not two ([AGENTS.md] "do not allocate per-frame
// in hot paths").
//
// Scope: `NpcRef` and NOT `MobRef` and NOT `CameraTag`. Mobs and the player are
// deliberately excluded — see the file header.
std::uint32_t ai_init(Registry& reg, LayerId layer);

// Hand every AiBrain on `layer` back to `MotionOwner::Wander` and return how
// many were released.
//
// This exists because disabling `ai_step` mid-run is otherwise a trap: the token
// is persistent state, so a body left holding `MotionOwner::Ai` would be skipped
// by `wander_step` forever and stand still. Call this when clearing
// `AiConfig::enabled`, or on unload.
std::uint32_t ai_release(Registry& reg, LayerId layer);

// One arbitration + steering pass over the embodied NPC bodies on `layer`.
//
// MUST RUN BEFORE `wander_step`, and that ordering is part of the contract, not
// a preference: the token this writes is read by wander on the SAME tick, so a
// body handed back mid-tick is steered by wander immediately instead of coasting
// for a frame.
//
// Per body: re-plan if its identity-staggered deadline has passed (build a
// Perception, score, select, reschedule), then set the token, then — if it owns
// the body — write horizontal Velocity from the negated diffusion danger
// gradient. `v.z` is left to gravity, exactly as wander does.
//
// `danger` may be null (the floor seeded no diffusion field) -> threat reads 0,
// nobody flees, every body delegates to wander, and the pass is a no-op on
// Velocity. That is the scorer's stubbed-input stance, not a special case.
//
// Pure game layer over EnTT + NpcPool + a read-only field/grid, so it is
// exercised headless by `game_test`.
AiTick ai_step(Registry& reg, NpcPool& pool, const Field<float>* danger,
               const MacroGrid& grid, LayerId layer, double now, float dt,
               const AiConfig& cfg = {});

} // namespace giga::game
