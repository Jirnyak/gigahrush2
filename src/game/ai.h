// AI — the utility brain for embodied NPCs ([ai.md]). Pure game-layer over the
// ECS: needs decay as SoA columns, a pure scorer ranks intents, argmax +
// hysteresis commits one, and steering writes Controller::wishDir — the SAME
// locomotion path as the player ([controller.md] -> [physics.md]; the player is
// not privileged, [npcs.md]). It runs ONLY on the embodied slice of the live
// floor; the cold pool is the macro tick's abstract job ([macrosim.md]). Because
// it is pure game-layer over EnTT + NpcPool (no SDL/Vulkan) it is exercised
// headless by game_test, exactly like the macro tick.
//
// This file implements increments #12a (the NEEDS layer) and #12b (the utility
// SCORER + selection FSM):
//   * #12a — decaying 0..100 drive columns + their single linear update pass,
//     ported verbatim from `needs.ts` (rates, spawn ranges, the pee/poo
//     digestion model and the STR/AGI/INT decay scaling are the frozen table).
//   * #12b — a pure `score_intents` ranking 13 intents 0..100 and a
//     `select_intent` argmax+hysteresis, ported verbatim from `npc_utility.ts`
//     and `npc_fsm.ts` (every coefficient, pressure curve, the FNV/lowbias32
//     identity jitter and the shipping FSM thresholds are the frozen table).
// The stagger + baked-nav steering + embody/loop wiring (#12c) build on top of
// this same component set.
#pragma once

#include <array>
#include <cstdint>

#include "core/rng.h"       // hash_u32 (== reference mix32), rand01 (== jitter01)
#include "ecs/registry.h"
#include "game/faction.h"   // FactionId / kFactionCount — the scorer's trait table

namespace giga::game {

class NpcPool; // decl only; needs_step reads the character-sheet attribute block

// ---------------------------------------------------------------------------
// Needs — the embodied drives ([ai.md] §1, reference `needs.ts`).
//
// A fixed, extensible block of 0..100 needs, ONE row per embodied agent, stored
// as an ECS component so EnTT keeps them as a packed SoA column that updates in a
// single linear pass — never a per-object update method. Cold records carry no
// fine needs (the macro tick models their lives abstractly); needs materialise
// on embodiment and fold away on de-embodiment, like every other transient
// ([npcs.md]: hp/inventory stay canonical, only transient state folds).
//
// Two flavours share one block, distinguished by INDEX, not a type tag:
//   * RESERVES  (food/water/sleep) start high and DECAY toward 0 = crisis, each
//     slowed by a governing attribute (a hardier NPC hungers slower);
//   * PRESSURES (pee/poo) start low and rise toward 100 = failure, but ONLY by
//     digesting a pending pool the eat intent fills — they do not climb on their
//     own (reference: pee/poo rise only while pendingPee/pendingPoo > 0).
// ---------------------------------------------------------------------------

enum NeedId : std::uint8_t {
    NeedFood = 0,  // reserve: 100 sated -> 0 starving (HP damage at 0)
    NeedWater,     // reserve: 100 hydrated -> 0 parched
    NeedSleep,     // reserve: 100 rested -> 0 exhausted
    NeedPee,       // pressure: 0 empty -> 100 failure; rises via digestion
    NeedPoo,       // pressure: 0 empty -> 100 failure; rises via digestion
    kNeedCount
};

// Reserves occupy [0, kFirstPressure); pressures occupy [kFirstPressure,
// kNeedCount). The split is the one place the two mechanisms diverge in step().
inline constexpr std::uint8_t kFirstPressure = NeedPee;

inline constexpr float kNeedMin = 0.0f;
inline constexpr float kNeedMax = 100.0f;

// The component. A flat float block addressed by NeedId, plus the two digestion
// buffers. Float (not byte) because the per-tick delta is fractional (~0.08/s *
// ~8 ms) and byte truncation would quantise it to zero; a handful of floats over
// the ~16k embodied set is negligible ([performance.md]).
struct Needs {
    std::array<float, kNeedCount> v{};
    float pendingPee = 0.0f; // eating fills it; it digests into NeedPee over time
    float pendingPoo = 0.0f; // eating fills it; it digests into NeedPoo over time
};

// Per-need rate in units per SECOND (reference `needs.ts`, verbatim). For
// reserves this is the decay rate; for pressures it is the DIGESTION rate
// (pending pool -> pressure). DATA, not code — retuning the society is a table
// edit, never a code change.
//   FOOD_RATE 0.08  WATER_RATE 0.12  SLEEP_RATE 0.05  PEE_DIGEST 0.10  POO_DIGEST 0.06
inline constexpr float kNeedRatePerSec[kNeedCount] = {
    0.08f, // food   decay
    0.12f, // water  decay (fastest reserve)
    0.05f, // sleep  decay (slowest reserve)
    0.10f, // pee    digestion (pendingPee -> pee)
    0.06f, // poo    digestion (pendingPoo -> poo)
};

// Attribute-scaled reserve decay (reference: `rate /= (1 + 0.1 * stat)`, so a
// higher stat drains the reserve slower). The reference scales food by STR, water
// by AGI, sleep by INT; pee/poo digestion is NOT attribute-scaled. gigahrush2's
// generic 8-slot attribute block ([npcs.md]) has no named stats — fixing slots
// 0/1/2 = STR/AGI/INT here (the reference RPGStats order) IS the slot->meaning
// data decision `population.cpp` defers. kNeedAttrSlot[n] < 0 disables scaling.
inline constexpr int kNeedAttrSlot[kNeedCount] = {0, 1, 2, -1, -1};
inline constexpr float kNeedAttrPerPoint = 0.1f; // reference 0.1 per stat point

// Deterministic spawn bands per need, matching the reference `freshNeeds()`:
//   food 70..100  water 70..100  sleep 60..100  pee 0..30  poo 0..20
// so a freshly embodied crowd starts out of crisis with per-agent spread.
inline constexpr float kNeedSeedLo[kNeedCount] = {70.0f, 70.0f, 60.0f, 0.0f, 0.0f};
inline constexpr float kNeedSeedHi[kNeedCount] = {100.0f, 100.0f, 100.0f, 30.0f, 20.0f};

// Salt for the deterministic need seed, distinct from every other hash stream
// (worldgen / macro tick) so seeds are uncorrelated with them.
inline constexpr std::uint32_t kSaltNeedSeed = 0x0'11ee'd50u;

// Deterministically seed one agent's needs from its stable id. Same id -> same
// starting needs, every run: reproducible embodiment, zero stored RNG state
// ([ARCHITECTURE.md] §Determinism). Each need draws an independent hash stream so
// they are uncorrelated. The pending pools start empty (fresh gut).
inline void seed_needs(Needs& needs, std::uint32_t id) {
    for (std::uint8_t n = 0; n < kNeedCount; ++n) {
        const float u = rand01(hash3(id, n, kSaltNeedSeed));
        needs.v[n] = kNeedSeedLo[n] + (kNeedSeedHi[n] - kNeedSeedLo[n]) * u;
    }
    needs.pendingPee = 0.0f;
    needs.pendingPoo = 0.0f;
}

// Advance every embodied agent's needs by one sim tick, in a single linear pass
// over the packed Needs column ([ai.md] §Data-oriented): reserves decay
// (attribute-slowed, clamped at 0), pressures digest their pending pool (clamped
// at 100). O(n) over the live set, no search, no per-object dispatch. `pool`
// supplies the attribute block for the reserve scaling; it reads each entity's
// NpcRef to find its row.
void needs_step(Registry& reg, NpcPool& pool, float dt);

// ===========================================================================
// #12b — Utility scorer (13 intents) + selection FSM ([ai.md] §2-3).
//
// A pure, stateless scorer ranks 13 intents 0..100; argmax + hysteresis commits
// one. Ported VERBATIM from the reference `npc_utility.ts` / `npc_fsm.ts`: every
// coefficient, pressure curve, the FNV-1a/lowbias32 identity jitter and the
// shipping FSM thresholds (switch margin 7 — the FSM override, NOT the utility
// default 8 — and emergency score 58) are the frozen table, the same design-doc
// -> exact-extraction -> code flow as the faction matrix ([macrosim.md]).
//
// Inputs the target does not yet expose — mobs/combat (#13), a room-affordance
// model, a minute-of-day clock, the samosbor event — enter through the
// `Perception` seam as zero/"none", so every additive term with a missing input
// contributes 0 and the ranking among the LIVE intents (needs-driven +
// diffusion threat) is exactly the reference's. A later system fills the field
// and its term switches on with NO scorer edit ([ai.md]: universal, baked).
// ===========================================================================

// The 13 intents in the reference's fixed order. The INDEX is load-bearing:
// select_intent breaks argmax ties toward the lower index, and each intent's
// identity-jitter channel is "score:<name>" (kIntentScoreChannel), so reordering
// would reshuffle every agent's behaviour.
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

// Intent names (debug/HUD) and their identity-jitter channels. The channel is
// the reference's runtime "score:"+name; kept as pre-built literals so the hot
// path folds a fixed string with no concatenation.
inline constexpr const char* kIntentName[kIntentCount] = {
    "safety", "combat", "flee",   "toilet", "drink",  "eat",    "sleep",
    "work",   "heal",   "social", "patrol", "faction_assault",  "wander",
};
inline constexpr const char* kIntentScoreChannel[kIntentCount] = {
    "score:safety", "score:combat", "score:flee",   "score:toilet",
    "score:drink",  "score:eat",    "score:sleep",  "score:work",
    "score:heal",   "score:social", "score:patrol", "score:faction_assault",
    "score:wander",
};

// --- Identity hashing for the scorer jitter + re-plan stagger ---------------
// Reuses the shared lowbias32 finaliser (core/rng.h hash_u32 == the reference
// mix32) and rand01 (== the reference jitter01: top 24 bits / 2^24). Only the
// FNV-1a string fold is AI-local: the reference keys its jitter channels by
// string, so we reproduce that byte-for-byte. This is DISTINCT from the Murmur3
// fmix32 used elsewhere — do not cross the two ([ai.md] §Scheduling).
inline constexpr std::uint32_t kFnvPrime   = 16777619u;   // 0x01000193 FNV-1a 32
inline constexpr std::uint32_t kHashGolden = 0x9e3779b9u;  // channel decorrelator

inline void fnv_fold(std::uint32_t& h, const char* s) {
    for (; *s != '\0'; ++s) {
        h ^= static_cast<std::uint32_t>(static_cast<unsigned char>(*s));
        h *= kFnvPrime;
    }
}

// channelSeed(idSeed, channel): fold the channel string into idSeed^golden, then
// finalise with mix32 (== hash_u32). Matches reference channelSeed's string path.
inline std::uint32_t channel_seed(std::uint32_t idSeed, const char* channel) {
    std::uint32_t h = idSeed ^ kHashGolden;
    fnv_fold(h, channel);
    return hash_u32(h);
}

// Per-agent identity seed: the reference `alifeId` channel (npc_utility.ts:196).
// The NpcId (pool slot) is the stable identity, so an agent's jitter/stagger is
// reproducible across embodiments with zero stored RNG state.
inline std::uint32_t identity_seed(std::uint32_t npcId) {
    return hash_u32(0xa11fe000u ^ npcId);
}

// Signed jitter in [-amp, amp] from a channel seed (rand01 == reference jitter01).
inline float jitter_signed(std::uint32_t channelSeed, float amp) {
    return (rand01(channelSeed) * 2.0f - 1.0f) * amp;
}

// --- Faction trait defaults (reference default{Duty,Sociability,...}) --------
// With no occupation layer in the target ([npcs.md]: occupation is #13+), the
// scorer's behavioural traits resolve purely from faction. Rows indexed by
// FactionId; Player/out-of-range fall to the reference "default" branch (which
// equals the Citizen row). Occupation overrides (workDrive, sleep/heal bonuses)
// land with #13 — until then workDrive is the reference default 0.5 everywhere.
struct FactionTraits {
    float duty;
    float sociability;
    float risk;
    float panic;
    float patrolDrive;
    float workDrive;
};
inline constexpr FactionTraits kFactionTraits[kFactionCount] = {
    /* Citizen    */ {0.55f, 0.48f, 0.32f, 0.50f, 0.08f, 0.50f},
    /* Liquidator */ {0.82f, 0.48f, 0.74f, 0.22f, 0.82f, 0.50f},
    /* Cultist    */ {0.62f, 0.32f, 0.60f, 0.35f, 0.58f, 0.50f},
    /* Scientist  */ {0.74f, 0.48f, 0.32f, 0.50f, 0.08f, 0.50f},
    /* Wild       */ {0.55f, 0.25f, 0.60f, 0.35f, 0.42f, 0.50f},
    /* Player     */ {0.55f, 0.48f, 0.32f, 0.50f, 0.08f, 0.50f},
};
inline const FactionTraits& faction_traits(std::uint16_t faction) {
    return kFactionTraits[faction < kFactionCount ? faction
                                                  : static_cast<std::uint16_t>(0)];
}

// --- Perception: the momentary world snapshot the scorer reads --------------
// Built once per agent per re-plan by the driver (#12c) from whatever state the
// engine currently exposes; every field the target cannot yet supply keeps its
// zero/"none"/-1 default, so the corresponding scorer term vanishes. The scorer
// is a PURE function of (Perception, Needs) — it never touches the pool or world
// directly, which is what lets stubbed signals slot in later untouched and lets
// the whole scorer be unit-tested headless. The -1 sentinels reproduce the
// reference's `undefined` branches exactly (threatDistance, minuteOfDay).
struct Perception {
    // -- live now --
    std::uint32_t idSeed = 0;  // identity_seed(NpcId): per-agent jitter channel
    std::uint16_t faction = 0; // -> faction_traits(): duty/sociability/risk/...
    float hp = 0.0f;           // -> healthPressure -> heal/combat/flee
    float maxHp = 0.0f;
    float danger = 0.0f;       // diffusion "danger" field @ cell -> threatPressure

    // -- new per-agent state (from AiBrain), set by the driver --
    std::uint8_t currentIntent = kIntentNone; // for the stickiness bonus
    float stickinessAmount = 0.0f;            // stickiness_amount(stateTimer)
    float minuteOfDay = -1.0f; // <0 == no clock -> every rhythmBias term is 0

    // -- stubbed until #13 (mobs/combat); 0/false/-1 => the term contributes 0 --
    float visibleHostiles = 0.0f; // count of visible hostiles
    float threatDistance = -1.0f; // metres; -1 == reference `undefined`
    float hostilePower = 0.0f;
    float allyPower = 0.0f;
    bool strongerHostile = false;
    bool cornered = false;
    bool armed = false;
    bool orderedCombat = false;
    bool inShelter = false;
    bool isTraveler = false;
    bool factionAssaultTarget = false; // a faction "attack" goal names this agent
    float monster = 0.0f;
    float gunfire = 0.0f;
    float fire = 0.0f;
    float fog = 0.0f;

    // -- stubbed until a room model / target resolution exists --
    bool samosborActive = false;
    bool samosborWarning = false;
    // Room-affordance bias and the chosen target's penalty. Per-intent in the
    // reference; scalar-zero here because the target has neither a room model nor
    // per-intent target resolution yet, so both are 0 for every intent. They
    // become per-intent arrays when rooms/targets land — a later, additive change.
    float localScore = 0.0f;
    float targetPenalty = 0.0f;
};

// --- AiBrain: the minimal per-agent hysteresis + stagger state --------------
// The reference parks this in module WeakMaps; the port makes it an ECS
// component so it materialises on embodiment and folds away with it, like Needs.
// currentIntent + stateTimer drive the switch-margin stickiness; nextDecisionAt
// is the absolute sim-time deadline for the identity-staggered re-plan (#12c).
struct AiBrain {
    std::uint8_t currentIntent = kIntentNone;
    float stateTimer = 0.0f;     // seconds committed to currentIntent
    float nextDecisionAt = 0.0f; // absolute sim time of the next re-plan (#12c)
};

// --- Selection FSM thresholds (the SHIPPING values from npc_fsm.ts) ---------
// The switch margin is the FSM override 7, NOT the npc_utility default 8; using
// 8 diverges at the hysteresis boundary. Emergency intents above kEmergencyScore
// preempt immediately. The re-plan cadence [1.5, 4.0] s and the stickiness curve
// [5, 12] are consumed by the #12c driver (kept here so all frozen constants
// live in one place).
inline constexpr float kSwitchMargin = 7.0f;
inline constexpr float kEmergencyScore = 58.0f;
inline constexpr float kRethinkBaseSec = 1.5f;   // re-plan cadence lower bound
inline constexpr float kRethinkSpreadSec = 2.5f; // + rand01*spread -> [1.5, 4.0]
inline constexpr float kStickBase = 5.0f;        // stickiness at t=0
inline constexpr float kStickCap = 7.0f;         // max growth of the bonus
inline constexpr float kStickPerSec = 0.18f;     // bonus growth per second held

// The survival intents that may preempt the current one without the margin.
inline bool intent_is_emergency(std::uint8_t intent) {
    return intent == IntentSafety || intent == IntentFlee ||
           intent == IntentCombat || intent == IntentHeal;
}

// Stickiness bonus for the current intent given how long it has been held:
// 5 + min(7, stateTimer * 0.18) -> [5, 12] (reference npc_fsm.ts:427).
inline float stickiness_amount(float stateTimer) {
    const float grown = stateTimer * kStickPerSec;
    return kStickBase + (grown < kStickCap ? grown : kStickCap);
}

// Pure scorer: fill out[kIntentCount] with each intent's 0..100 utility. A pure
// function of (perception, needs) — no side effects, no world reads — so it is
// order-independent and trivially testable headless ([ai.md] §2). The current
// intent's stickiness bonus is applied here (via Perception.stickinessAmount),
// matching the reference: select_intent then only needs the raw scores.
void score_intents(const Perception& p, const Needs& needs, float out[kIntentCount]);

// Argmax + hysteresis: choose the next intent from fresh scores and the current
// one. An emergency survival intent scoring >= kEmergencyScore preempts
// immediately; otherwise a challenger must beat the incumbent's score (which
// already carries its stickiness bonus) by kSwitchMargin. Argmax ties favour the
// lower index. Pass kIntentNone for a fresh agent (returns the raw argmax).
std::uint8_t select_intent(const float scores[kIntentCount], std::uint8_t current);

} // namespace giga::game
