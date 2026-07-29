#include "game/ai.h"

#include <cmath>
#include <cstddef>

#include "core/math.h"       // vec3, normalize
#include "ecs/components.h"  // Transform, Velocity, CameraTag
#include "game/embody.h"     // NpcRef, kEmbodyCellSize — the pos<->cell mapping
#include "game/npc_pool.h"   // NpcPool::attrs (STR/AGI/INT reserve scaling)
#include "sim/diffusion.h"   // diffusion_gradient — the flee steering field
#include "world/field.h"     // Field<float> (the "danger" field)
#include "world/macro_grid.h" // MacroGrid (open/wall test for the gradient)
#include "world/types.h"     // wrap_macro — toroidal cell wrap

namespace giga::game {

namespace {

// Clamp a reserve back into its band after decay. A reserve only decreases, so
// only the floor can bite, but clamp both ends for safety (cheap, predictable).
constexpr float clamp_need(float x) {
    if (x < kNeedMin) return kNeedMin;
    if (x > kNeedMax) return kNeedMax;
    return x;
}

// Digest up to `amount` from a pending pool into its pressure need, clamped at
// kNeedMax — the reference's `dp = min(pending, rate*dt); need += dp; pending -=
// dp`. Pressures rise ONLY while their pool is non-empty, so a fresh gut (empty
// pool) holds pee/poo flat until the eat intent (#12b) fills it.
inline void digest(float& level, float& pending, float amount) {
    if (pending <= 0.0f || amount <= 0.0f) return;
    const float dp = pending < amount ? pending : amount;
    level += dp;
    if (level > kNeedMax) level = kNeedMax;
    pending -= dp;
}

// --- Scorer math (reference npc_utility.ts helpers, verbatim) ---------------

inline float maxf(float a, float b) { return a > b ? a : b; }
inline float clamp01f(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

// clampScore: NaN -> 0, else clamp to [0, 100] (reference :1158).
inline float clamp_score(float s) {
    if (s != s) return 0.0f; // NaN
    return s < 0.0f ? 0.0f : (s > 100.0f ? 100.0f : s);
}

// smoothstep(e0, e1, v) — Hermite ease over the clamped ramp (reference :1168).
inline float smoothstep01(float e0, float e1, float v) {
    const float x = clamp01f((v - e0) / (e1 - e0));
    return x * x * (3.0f - 2.0f * x);
}

// Reserve pressure: a low reserve (v -> 0) maps toward 1 (reference :1072).
inline float low_need_pressure(float v) {
    return smoothstep01(0.18f, 0.82f, clamp01f((72.0f - v) / 72.0f));
}
// Bladder pressure: a full column (v -> 100) maps toward 1 (reference :1077).
inline float high_need_pressure(float v) {
    return smoothstep01(0.35f, 0.90f, clamp01f(v / 100.0f));
}
// Health pressure: 0 at full HP, 1 at 0 HP (reference :1064).
inline float health_pressure(float hp, float maxHp) {
    return maxHp > 0.0f ? clamp01f(1.0f - hp / maxHp) : 0.0f;
}

// Normalise a heterogeneous "unit-ish" input to [0, 1] by magnitude band
// (reference :1146): <=1 already unit, <=100 percent, else byte.
inline float unitish(float v) {
    if (v != v) return 0.0f; // NaN
    const float a = v < 0.0f ? -v : v;
    if (a <= 1.0f) return clamp01f(v);
    if (a <= 100.0f) return clamp01f(v / 100.0f);
    return clamp01f(v / 255.0f);
}

// computeThreatPressure (reference :1045): the max over every danger channel,
// nudged by cornered/shelter, clamped to [0, 1]. Only `danger` (the diffusion
// field) is live in the target today; the rest are 0 until #13, so this reduces
// to unitish(danger) plus the cornered/shelter bias — exactly the reference with
// those inputs zeroed.
inline float compute_threat_pressure(const Perception& p) {
    float m = unitish(p.danger);
    m = maxf(m, unitish(p.monster));
    m = maxf(m, unitish(p.gunfire) * 0.75f);
    m = maxf(m, unitish(p.fire));
    m = maxf(m, unitish(p.fog) * 0.6f);
    m = maxf(m, clamp01f(p.visibleHostiles / 3.0f) * 0.85f);
    m = maxf(m, p.threatDistance < 0.0f
                    ? 0.0f
                    : clamp01f((16.0f - p.threatDistance) / 16.0f));
    const float s =
        m + (p.cornered ? 0.15f : 0.0f) + (p.inShelter ? -0.18f : 0.0f);
    return clamp01f(s);
}

// --- #12c steering helpers --------------------------------------------------

// A per-agent horizontal wander heading (unit vector). Deterministic from the
// identity seed and the re-plan count, so it holds STEADY between re-plans (the
// agent walks a straight leg) and re-rolls when `decisions` advances (it turns) —
// all with zero stored heading state, exactly the stateless-hash stance the whole
// AI uses ([core/rng.h]). hash2(idSeed, decisions) decorrelates the angle stream
// from the score/cadence jitter channels.
inline vec3 wander_heading(std::uint32_t idSeed, std::uint16_t decisions) {
    const float angle = rand01(hash2(idSeed, decisions)) * 6.28318531f; // [0, 2pi)
    return vec3{std::cos(angle), std::sin(angle), 0.0f};
}

} // namespace

void needs_step(Registry& reg, NpcPool& pool, float dt) {
    // One linear pass over the packed (NpcRef, Needs) columns ([ai.md]
    // §Data-oriented): EnTT stores each component contiguously, so this is a
    // straight sweep of memory — no per-object dispatch, no search.
    auto view = reg.view<NpcRef, Needs>();
    for (auto e : view) {
        const NpcId id = view.get<NpcRef>(e).id;
        auto& needs = view.get<Needs>(e);
        const auto& attrs = pool.attrs(id);

        // Reserves decay unconditionally, each slowed by its governing attribute:
        // rate /= (1 + perPoint * stat) (reference needs.ts: STR slows food, AGI
        // water, INT sleep). A zeroed stat leaves the base rate untouched.
        for (std::uint8_t n = 0; n < kFirstPressure; ++n) {
            float rate = kNeedRatePerSec[n];
            const int slot = kNeedAttrSlot[n];
            if (slot >= 0) {
                const float stat =
                    static_cast<float>(attrs[static_cast<std::size_t>(slot)]);
                rate /= (1.0f + kNeedAttrPerPoint * stat);
            }
            needs.v[n] = clamp_need(needs.v[n] - rate * dt);
        }

        // Pressures rise ONLY by digesting their pending pool (attribute-neutral,
        // per the reference). Empty pools hold pee/poo flat until something eats.
        digest(needs.v[NeedPee], needs.pendingPee, kNeedRatePerSec[NeedPee] * dt);
        digest(needs.v[NeedPoo], needs.pendingPoo, kNeedRatePerSec[NeedPoo] * dt);
    }
}

// --------------------------------------------------------------------------
// #12b — the pure utility scorer. Every coefficient below is verbatim from the
// reference `npc_utility.ts` per-intent bodies; the stubbed inputs (mobs, fire,
// samosbor, rooms, clock) sit at 0 in Perception, so each of their additive
// terms contributes 0 and the ranking among the live intents matches exactly.
// --------------------------------------------------------------------------
void score_intents(const Perception& p, const Needs& needs,
                   float out[kIntentCount]) {
    const FactionTraits& tr = faction_traits(p.faction);

    // Derived pressures (reference scoreNpcUtilities :576-711).
    const float threat = compute_threat_pressure(p);
    const float hpP = health_pressure(p.hp, p.maxHp);
    const float toiletP = maxf(high_need_pressure(needs.v[NeedPee]),
                               high_need_pressure(needs.v[NeedPoo]));
    const float drinkP = low_need_pressure(needs.v[NeedWater]);
    const float eatP = low_need_pressure(needs.v[NeedFood]);
    const float sleepP = low_need_pressure(needs.v[NeedSleep]);
    const float urgent =
        maxf(maxf(maxf(toiletP, drinkP), maxf(eatP, sleepP)), hpP);

    const float vhp = clamp01f(p.visibleHostiles / 4.0f);
    const float ctp = p.threatDistance < 0.0f
                          ? 0.0f
                          : clamp01f((18.0f - p.threatDistance) / 18.0f);
    const bool stronger =
        p.strongerHostile || (p.hostilePower > p.allyPower + 0.15f);

    // Terms common to (almost) every body.
    const float local = p.localScore;   // room affordance — 0 (no room model)
    const float tpen = p.targetPenalty;  // target cost — 0 (no target resolution)
    // rhythmBias is 0 for every intent while no minute-of-day clock is exposed
    // (Perception.minuteOfDay < 0); wiring a clock turns the daily routine on
    // with no scorer edit. See [ai.md] §Scheduling.
    const float rhythm = 0.0f;
    const auto stick = [&](std::uint8_t intent) -> float {
        return p.currentIntent == intent ? p.stickinessAmount : 0.0f;
    };

    out[IntentSafety] = clamp_score(
        (p.samosborActive ? 72.0f : 0.0f) + (p.samosborWarning ? 34.0f : 0.0f) +
        threat * 44.0f + unitish(p.fire) * 26.0f + unitish(p.fog) * 16.0f +
        local + stick(IntentSafety) - tpen);

    out[IntentCombat] = clamp_score(
        vhp * 34.0f + ctp * 12.0f + (p.armed ? 18.0f : -16.0f) +
        (p.orderedCombat ? 28.0f : 0.0f) + (p.cornered ? 18.0f : 0.0f) +
        tr.risk * 22.0f + tr.duty * 10.0f - hpP * 30.0f - tr.panic * 12.0f -
        (stronger ? 14.0f : 0.0f) + local + stick(IntentCombat) - tpen);

    out[IntentFlee] = clamp_score(
        vhp * 24.0f + threat * 42.0f + unitish(p.monster) * 24.0f +
        unitish(p.fire) * 25.0f + hpP * 32.0f + (stronger ? 18.0f : 0.0f) +
        (1.0f - tr.risk) * 15.0f + tr.panic * 18.0f +
        (p.samosborActive ? 8.0f : 0.0f) - (p.armed ? 5.0f : 0.0f) + local +
        stick(IntentFlee) - tpen);

    out[IntentToilet] = clamp_score(toiletP * 92.0f + rhythm + local +
                                    stick(IntentToilet) - threat * 18.0f - tpen);

    out[IntentDrink] = clamp_score(drinkP * 88.0f + rhythm + local +
                                   stick(IntentDrink) - threat * 16.0f - tpen);

    out[IntentEat] = clamp_score(eatP * 86.0f + rhythm + local +
                                 stick(IntentEat) - threat * 16.0f - tpen);

    out[IntentSleep] = clamp_score(
        sleepP * 76.0f + rhythm /* + occ.sleepScoreBonus (0: no occupation) */ +
        local + stick(IntentSleep) - threat * 30.0f -
        (p.samosborActive ? 18.0f : 0.0f) - tpen);

    out[IntentWork] = clamp_score(
        tr.duty * 34.0f + tr.workDrive * 18.0f + rhythm + local +
        stick(IntentWork) - urgent * 30.0f - threat * 42.0f -
        (p.samosborActive ? 45.0f : 0.0f) - tpen);

    out[IntentHeal] = clamp_score(
        hpP * 105.0f /* + (hpP<0.01 ? occ.healIdleScoreBonus : 0) (0: no occ) */ +
        local + stick(IntentHeal) - threat * 10.0f - tpen);

    out[IntentSocial] = clamp_score(
        tr.sociability * 29.0f + rhythm + local + stick(IntentSocial) -
        urgent * 15.0f - threat * 34.0f - (p.samosborActive ? 25.0f : 0.0f) -
        tpen);

    // Patrol's samosbor penalty is waived for the factions that patrol INTO a
    // samosbor (Liquidators, Cultists) — reference npc_utility.ts:520.
    const bool patrolSamosborPenalty =
        p.samosborActive && p.faction != FactionLiquidator &&
        p.faction != FactionCultist;
    out[IntentPatrol] = clamp_score(
        tr.patrolDrive * 36.0f + tr.duty * 18.0f + rhythm + threat * 10.0f +
        local + stick(IntentPatrol) - urgent * 18.0f -
        (patrolSamosborPenalty ? 24.0f : 0.0f) - tpen);

    // faction_assault: a flat 50 when a faction "attack" goal names this agent,
    // else 0. No local/stickiness/target terms — only the identity jitter below.
    out[IntentFactionAssault] = clamp_score(p.factionAssaultTarget ? 50.0f : 0.0f);

    // wander carries its own internal signed jitter (channel "wander_score",
    // amp 3) on top of the shared body (reference :556).
    const float wanderJitter =
        jitter_signed(channel_seed(p.idSeed, "wander_score"), 3.0f);
    out[IntentWander] = clamp_score(
        9.0f + rhythm + wanderJitter + (p.isTraveler ? 19.0f : 0.0f) + local +
        stick(IntentWander) - urgent * 12.0f - threat * 22.0f - tpen);

    // addIdentityJitter (reference :967): each intent gets a per-agent signed
    // nudge on its own "score:<name>" channel (amp 2.5), then a final clamp. This
    // breaks ties per-agent so a uniform crowd does not act in lockstep.
    for (std::uint8_t i = 0; i < kIntentCount; ++i) {
        out[i] = clamp_score(
            out[i] + jitter_signed(channel_seed(p.idSeed, kIntentScoreChannel[i]),
                                   2.5f));
    }
}

// #12b — argmax + hysteresis (reference bestNpcUtilityIntent / shouldSwitch /
// selectNpcUtilityIntent, :728-779, with the FSM's switch margin 7).
std::uint8_t select_intent(const float scores[kIntentCount],
                           std::uint8_t current) {
    std::uint8_t best = 0;
    for (std::uint8_t i = 1; i < kIntentCount; ++i) {
        if (scores[i] > scores[best]) best = i; // strict > => ties favour lower i
    }
    if (current >= kIntentCount) return best; // no valid current (kIntentNone)
    if (best == current) return current;
    // Emergency survival intents preempt immediately, bypassing the margin.
    if (intent_is_emergency(best) && scores[best] >= kEmergencyScore) return best;
    // Otherwise a challenger must beat the incumbent (which already carries its
    // stickiness bonus from the scorer) by the switch margin.
    if (scores[best] > scores[current] + kSwitchMargin) return best;
    return current;
}

// --------------------------------------------------------------------------
// #12c — the per-frame steering driver. Runs the pure #12b scorer/selection on
// the embodied live-floor slice, staggered by identity, and turns the committed
// intent into motion by writing Velocity. See ai.h for the contract.
// --------------------------------------------------------------------------
void ai_step(Registry& reg, NpcPool& pool, const Field<float>* danger,
             const MacroGrid& grid, double now, float dt) {
    // One packed sweep over (NpcRef, Needs, AiBrain, Transform, Velocity), like
    // needs_step. The player owns a CameraTag and is driven by input, so skip it
    // (same "skip the camera-holder" filter the body pass uses) — there is no
    // player special case, only the presence of the camera component.
    auto view = reg.view<NpcRef, Needs, AiBrain, Transform, Velocity>();
    for (auto e : view) {
        if (reg.all_of<CameraTag>(e)) continue; // the player: input drives it

        const NpcId id = view.get<NpcRef>(e).id;
        const Needs& needs = view.get<Needs>(e);
        AiBrain& brain = view.get<AiBrain>(e);
        const Transform& tr = view.get<Transform>(e);
        Velocity& vel = view.get<Velocity>(e);
        const std::uint32_t idSeed = identity_seed(id);

        // The macro cell the body stands in — the SAME pos->cell map fold_back
        // uses (floor(pos / cell size)), wrapped onto the torus.
        const int cx =
            wrap_macro(static_cast<int>(std::floor(tr.pos.x / kEmbodyCellSize)));
        const int cy =
            wrap_macro(static_cast<int>(std::floor(tr.pos.y / kEmbodyCellSize)));
        const int cz =
            wrap_macro(static_cast<int>(std::floor(tr.pos.z / kEmbodyCellSize)));

        // Re-plan only when this agent's identity-staggered deadline has passed,
        // so the crowd's decisions spread across frames with zero scheduling RAM
        // ([ai.md] §Scheduling). A fresh brain (nextDecisionAt 0) plans at once.
        if (now >= static_cast<double>(brain.nextDecisionAt)) {
            Perception p;
            p.idSeed = idSeed;
            p.faction = pool.faction(id);
            p.hp = static_cast<float>(pool.hp(id));
            p.maxHp = static_cast<float>(pool.max_hp(id));
            p.danger = danger != nullptr ? danger->at(cx, cy, cz) : 0.0f;
            p.currentIntent = brain.currentIntent;
            p.stickinessAmount = stickiness_amount(brain.stateTimer);
            // Every other Perception field stays at its stubbed default (#13), so
            // its scorer term contributes 0 — the faithful-port invariant.

            float scores[kIntentCount];
            score_intents(p, needs, scores);
            const std::uint8_t next = select_intent(scores, brain.currentIntent);
            if (next != brain.currentIntent) {
                brain.currentIntent = next;
                brain.stateTimer = 0.0f; // committed to a new intent just now
            }
            ++brain.decisions; // advances the wander leg + telemetry
            brain.nextDecisionAt = static_cast<float>(
                now + static_cast<double>(kRethinkBaseSec) +
                static_cast<double>(rand01(channel_seed(idSeed, kRethinkChannel))) *
                    static_cast<double>(kRethinkSpreadSec));
        }
        brain.stateTimer += dt;

        // --- Steering: write the horizontal Velocity; v.z is left to gravity ---
        // Flee runs DOWN the baked danger gradient (agents move toward safety);
        // every other intent roams the per-identity wander heading. When flee has
        // no usable gradient (uniform/zero danger) it falls through to the roam so
        // a fleeing agent still moves rather than freezing.
        vec3 dir{0.0f, 0.0f, 0.0f};
        if (brain.currentIntent == IntentFlee && danger != nullptr) {
            const vec3 g = diffusion_gradient(*danger, grid, cx, cy, cz);
            const vec3 away{-g.x, -g.y, 0.0f};
            if (away.x * away.x + away.y * away.y > 1e-10f) dir = normalize(away);
        }
        if (dir.x == 0.0f && dir.y == 0.0f)
            dir = wander_heading(idSeed, brain.decisions);

        vel.v.x = dir.x * kNpcWalkSpeed;
        vel.v.y = dir.y * kNpcWalkSpeed;
        // vel.v.z intentionally untouched — physics_step owns it (gravity + jump).
    }
}

} // namespace giga::game
