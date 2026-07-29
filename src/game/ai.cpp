#include "game/ai.h"

#include <cmath>
#include <vector>

#include "core/math.h"        // vec3, normalize
#include "ecs/components.h"   // Transform, Velocity, CameraTag
#include "game/embody.h"      // NpcRef
#include "game/mob_spawn.h"   // MobRef — the scope exclusion
#include "game/needs.h"       // needs_roll — substitute for an unseeded pool row
#include "sim/diffusion.h"    // diffusion_gradient — the flee steering field
#include "world/field.h"      // Field<float>
#include "world/macro_grid.h" // MacroGrid (open/wall test inside the gradient)
#include "world/types.h"      // wrap_macro, kCellSize

namespace giga::game {

namespace {

// --- Scorer math (reference npc_utility.ts helpers, verbatim) ---------------

inline float maxf(float a, float b) { return a > b ? a : b; }
inline float clamp01f(float v) { return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v); }

// clampScore: NaN -> 0, else clamp to [0, 100].
inline float clamp_score(float s) {
    if (s != s) return 0.0f; // NaN
    return s < 0.0f ? 0.0f : (s > 100.0f ? 100.0f : s);
}

// smoothstep(e0, e1, v) — Hermite ease over the clamped ramp.
inline float smoothstep01(float e0, float e1, float v) {
    const float x = clamp01f((v - e0) / (e1 - e0));
    return x * x * (3.0f - 2.0f * x);
}

// Reserve pressure: a low reserve (v -> 0) maps toward 1.
inline float low_need_pressure(float v) {
    return smoothstep01(0.18f, 0.82f, clamp01f((72.0f - v) / 72.0f));
}
// Bladder pressure: a full column (v -> 100) maps toward 1.
inline float high_need_pressure(float v) {
    return smoothstep01(0.35f, 0.90f, clamp01f(v / 100.0f));
}
// Health pressure: 0 at full HP, 1 at 0 HP.
inline float health_pressure(float hp, float maxHp) {
    return maxHp > 0.0f ? clamp01f(1.0f - hp / maxHp) : 0.0f;
}

// Normalise a heterogeneous "unit-ish" input to [0,1] by magnitude band:
// <=1 already unit, <=100 percent, else byte.
inline float unitish(float v) {
    if (v != v) return 0.0f; // NaN
    const float a = v < 0.0f ? -v : v;
    if (a <= 1.0f) return clamp01f(v);
    if (a <= 100.0f) return clamp01f(v / 100.0f);
    return clamp01f(v / 255.0f);
}

// computeThreatPressure: the max over every danger channel, nudged by
// cornered/shelter, clamped to [0,1]. Only `danger` (the diffusion field) is live
// today; the rest are 0, so this reduces to unitish(danger) plus the
// cornered/shelter bias — exactly the reference with those inputs zeroed.
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
    const float s = m + (p.cornered ? 0.15f : 0.0f) + (p.inShelter ? -0.18f : 0.0f);
    return clamp01f(s);
}

// Salt for the substitute needs roll. Distinct from every other hash stream so
// the substituted values are uncorrelated with worldgen and the macro tick.
inline constexpr std::uint32_t kSaltNeedsSubstitute = 0x0a1eed5u;

// The needs the scorer should read for `id`.
//
// A crowd record's row is almost always `seeded == 0`, i.e. all zeros — which the
// pressure curves read as starving, parched AND exhausted, and would peg the
// entire crowd on eat/drink/sleep forever. [needs.h] deliberately refuses to
// advance the crowd's survival clock ("the honest slice is the clock belongs to
// the body you are playing"), so the row will stay unseeded until that decision
// is revisited.
//
// So an unseeded row is SUBSTITUTED by a deterministic roll from the record id —
// giving each body a stable, plausible personality bias instead of a uniform
// crisis — and the substitute is LOCAL. Nothing is written back: `ai_step`
// mutates no shared state but its own AiBrain and Velocity, which is what keeps
// it safe to run alongside `needs_step` (which owns that row for the camera
// holder) and invisible to the save system.
//
// Divergence worth knowing: this roll is NOT byte-identical to `needs_step`'s
// lazy seed, because that one uses needs.cpp's internal mixer. It does not need
// to be — the two never apply to the same body at the same time (needs_step
// seeds only the camera holder, which is out of this system's scope).
// Takes a mutable pool only because `NpcPool::needs` has no const overload; the
// row is READ and copied, never assigned to.
inline Needs needs_for(NpcPool& pool, NpcId id) {
    const Needs& row = pool.needs(id);
    if (row.seeded != 0) return row;
    return needs_roll(hash2(id, kSaltNeedsSubstitute));
}

} // namespace

// --------------------------------------------------------------------------
// The pure utility scorer. Every coefficient is verbatim from the reference
// `npc_utility.ts` per-intent bodies; the stubbed inputs sit at 0 in Perception,
// so each of their additive terms contributes 0 and the ranking among the live
// intents matches exactly.
// --------------------------------------------------------------------------
void score_intents(const Perception& p, const Needs& needs,
                   float out[kIntentCount]) {
    const FactionTraits& tr = faction_traits(p.faction);

    const float threat = compute_threat_pressure(p);
    const float hpP = health_pressure(p.hp, p.maxHp);
    const float toiletP =
        maxf(high_need_pressure(needs.pee), high_need_pressure(needs.poo));
    const float drinkP = low_need_pressure(needs.water);
    const float eatP = low_need_pressure(needs.food);
    const float sleepP = low_need_pressure(needs.sleep);
    const float urgent = maxf(maxf(maxf(toiletP, drinkP), maxf(eatP, sleepP)), hpP);

    const float vhp = clamp01f(p.visibleHostiles / 4.0f);
    const float ctp = p.threatDistance < 0.0f
                          ? 0.0f
                          : clamp01f((18.0f - p.threatDistance) / 18.0f);
    const bool stronger =
        p.strongerHostile || (p.hostilePower > p.allyPower + 0.15f);

    const float local = p.localScore;   // room affordance — 0 (no room model)
    const float tpen = p.targetPenalty; // target cost — 0 (no target resolution)
    // rhythmBias is 0 for every intent while no minute-of-day clock is exposed
    // (Perception::minuteOfDay < 0); wiring a clock turns the daily routine on
    // with no scorer edit.
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
        sleepP * 76.0f + rhythm /* + occupation sleep bonus (0: no occupations) */ +
        local + stick(IntentSleep) - threat * 30.0f -
        (p.samosborActive ? 18.0f : 0.0f) - tpen);

    out[IntentWork] = clamp_score(
        tr.duty * 34.0f + tr.workDrive * 18.0f + rhythm + local +
        stick(IntentWork) - urgent * 30.0f - threat * 42.0f -
        (p.samosborActive ? 45.0f : 0.0f) - tpen);

    out[IntentHeal] = clamp_score(
        hpP * 105.0f /* + occupation heal-idle bonus (0: no occupations) */ +
        local + stick(IntentHeal) - threat * 10.0f - tpen);

    out[IntentSocial] = clamp_score(
        tr.sociability * 29.0f + rhythm + local + stick(IntentSocial) -
        urgent * 15.0f - threat * 34.0f - (p.samosborActive ? 25.0f : 0.0f) - tpen);

    // Patrol's samosbor penalty is waived for the factions that patrol INTO a
    // samosbor (Liquidators, Cultists).
    const bool patrolSamosborPenalty =
        p.samosborActive &&
        p.faction != static_cast<std::uint16_t>(Faction::Liquidators) &&
        p.faction != static_cast<std::uint16_t>(Faction::Cultists);
    out[IntentPatrol] = clamp_score(
        tr.patrolDrive * 36.0f + tr.duty * 18.0f + rhythm + threat * 10.0f +
        local + stick(IntentPatrol) - urgent * 18.0f -
        (patrolSamosborPenalty ? 24.0f : 0.0f) - tpen);

    // faction_assault: a flat 50 when a faction "attack" goal names this body,
    // else 0. No local/stickiness/target terms — only the identity jitter below.
    out[IntentFactionAssault] = clamp_score(p.factionAssaultTarget ? 50.0f : 0.0f);

    // wander carries its own internal signed jitter (channel "wander_score",
    // amp 3) on top of the shared body.
    const float wanderJitter =
        jitter_signed(channel_seed(p.idSeed, "wander_score"), 3.0f);
    out[IntentWander] = clamp_score(
        9.0f + rhythm + wanderJitter + (p.isTraveler ? 19.0f : 0.0f) + local +
        stick(IntentWander) - urgent * 12.0f - threat * 22.0f - tpen);

    // addIdentityJitter: each intent gets a per-body signed nudge on its own
    // "score:<name>" channel (amp 2.5), then a final clamp. This breaks ties
    // per-body so a uniform crowd does not act in lockstep.
    //
    // Note for anyone measuring thrash: this jitter is constant in TIME (it is a
    // function of identity and intent only), so it cannot itself cause flapping.
    // Time variation comes from the needs, the danger field and the stickiness.
    for (std::uint8_t i = 0; i < kIntentCount; ++i) {
        out[i] = clamp_score(
            out[i] +
            jitter_signed(channel_seed(p.idSeed, kIntentScoreChannel[i]), 2.5f));
    }
}

std::uint8_t select_intent_raw(const float scores[kIntentCount]) {
    std::uint8_t best = 0;
    for (std::uint8_t i = 1; i < kIntentCount; ++i) {
        if (scores[i] > scores[best]) best = i; // strict > => ties favour lower i
    }
    return best;
}

std::uint8_t select_intent(const float scores[kIntentCount],
                           std::uint8_t current) {
    const std::uint8_t best = select_intent_raw(scores);
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
// ai_init / ai_release — attaching and releasing the arbitration token.
// --------------------------------------------------------------------------
std::uint32_t ai_init(Registry& reg, LayerId layer) {
    // Two phases, and it is a crash fix rather than a style choice, the same one
    // `wander_init` documents: `emplace<AiBrain>` on the FIRST body creates that
    // component's storage, and creating a storage can reallocate the registry's
    // pool container and dangle the view being iterated. Phase 1 only reads;
    // phase 2 writes once the view is gone. Runs at floor load, not on the tick.
    std::vector<Entity> fresh;

    auto view = reg.view<const NpcRef, const Transform>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer != layer) continue;
        if (reg.all_of<AiBrain>(e)) continue;   // already has a brain
        if (reg.all_of<CameraTag>(e)) continue; // the player: controller_step owns it
        if (reg.all_of<MobRef>(e)) continue;    // mobs keep wander/investigate
        fresh.push_back(e);
    }

    for (Entity e : fresh) reg.emplace<AiBrain>(e);
    return static_cast<std::uint32_t>(fresh.size());
}

std::uint32_t ai_release(Registry& reg, LayerId layer) {
    std::uint32_t n = 0;
    auto view = reg.view<AiBrain, const Transform>();
    for (auto e : view) {
        if (view.get<const Transform>(e).layer != layer) continue;
        AiBrain& b = view.get<AiBrain>(e);
        if (b.motion == static_cast<std::uint8_t>(MotionOwner::Wander)) continue;
        b.motion = static_cast<std::uint8_t>(MotionOwner::Wander);
        ++n;
    }
    return n;
}

// --------------------------------------------------------------------------
// ai_step — arbitration first, steering second. See ai.h for the contract, and
// the file header for the ownership rule this enforces.
// --------------------------------------------------------------------------
AiTick ai_step(Registry& reg, NpcPool& pool, const Field<float>* danger,
               const MacroGrid& grid, LayerId layer, double now, float dt,
               const AiConfig& cfg) {
    AiTick out;
    // Dormant by default. Returning before the sweep means a disabled AI costs
    // one branch, and it means nothing can be left half-arbitrated: the token is
    // only ever written below. Clearing `enabled` on a running floor needs
    // `ai_release` — see ai.h.
    if (!cfg.enabled) return out;

    // One allocation-free sweep over the packed columns. Nothing here emplaces or
    // destroys a component, so the view cannot be invalidated mid-iteration —
    // that hazard lives in `ai_init`, by construction rather than by comment.
    auto view = reg.view<AiBrain, const NpcRef, const Transform, Velocity>();
    for (auto e : view) {
        const Transform& tr = view.get<const Transform>(e);
        if (tr.layer != layer) continue;

        AiBrain& brain = view.get<AiBrain>(e);

        // Scope re-checked every tick, not just at attach time. `ai_init` refuses
        // to give the camera holder a brain, but possession hands CameraTag to a
        // resident that has been running this brain for minutes — the exact shape
        // of the bug wander.cpp documents at its own CameraTag check. Handing the
        // token back is not optional: a possessed body left holding
        // MotionOwner::Ai would be skipped by wander_step AND steered by
        // controller_step, so it would work by luck until the AI wrote over the
        // player's input.
        if (reg.all_of<CameraTag>(e) || reg.all_of<MobRef>(e)) {
            brain.motion = static_cast<std::uint8_t>(MotionOwner::Wander);
            continue;
        }

        const NpcId id = view.get<const NpcRef>(e).id;
        if (!pool.valid(id)) continue;
        ++out.considered;

        // The macro cell the body stands in — the same pos->cell map fold_back
        // uses, wrapped onto the torus. kCellSize == kEmbodyCellSize; using the
        // world constant keeps this consistent with wander.cpp and physics.
        const int cx = wrap_macro(static_cast<int>(std::floor(tr.pos.x / kCellSize)));
        const int cy = wrap_macro(static_cast<int>(std::floor(tr.pos.y / kCellSize)));
        const int cz = wrap_macro(static_cast<int>(std::floor(tr.pos.z / kCellSize)));

        const float dangerHere = danger != nullptr ? danger->at(cx, cy, cz) : 0.0f;

        // --- Re-plan, on this body's own staggered deadline only -------------
        // The crowd's decisions spread across frames with zero scheduling RAM: the
        // one float below is the whole scheduler. A fresh brain
        // (nextDecisionAt == 0) plans at once.
        if (now >= static_cast<double>(brain.nextDecisionAt)) {
            const std::uint32_t idSeed = identity_seed(id);

            Perception p;
            p.idSeed = idSeed;
            p.faction = pool.faction(id);
            p.hp = static_cast<float>(pool.hp(id));
            p.maxHp = static_cast<float>(pool.max_hp(id));
            p.danger = dangerHere;
            p.currentIntent = brain.currentIntent;
            // Zeroed when hysteresis is off, so the two arms of the measurement
            // differ in exactly the mechanism under test and nothing else.
            p.stickinessAmount =
                cfg.hysteresis ? stickiness_amount(brain.stateTimer) : 0.0f;
            // Every other Perception field stays at its stubbed default, so its
            // scorer term contributes 0 — the faithful-port invariant.

            const Needs needs = needs_for(pool, id);
            float scores[kIntentCount];
            score_intents(p, needs, scores);

            const std::uint8_t next = cfg.hysteresis
                                          ? select_intent(scores, brain.currentIntent)
                                          : select_intent_raw(scores);
            if (next != brain.currentIntent) {
                // The FIRST commit is not a switch. Counting it would put a
                // constant +1 into both arms of the hysteresis measurement and
                // flatter the number; `switches` means genuine changes of mind.
                if (brain.currentIntent != kIntentNone) {
                    ++brain.switches;
                    ++out.switches;
                }
                brain.currentIntent = next;
                brain.stateTimer = 0.0f;
            }
            ++brain.decisions;
            brain.nextDecisionAt = static_cast<float>(
                now + static_cast<double>(cfg.rethinkBaseSec) +
                static_cast<double>(rand01(channel_seed(idSeed, kRethinkChannel))) *
                    static_cast<double>(cfg.rethinkSpreadSec));
            ++out.replanned;
        }
        brain.stateTimer += dt;

        // --- Arbitrate, then steer ------------------------------------------
        // Ownership is decided EVERY tick, not only at re-plan, because the input
        // it depends on (the gradient) evolves between re-plans. The intent is
        // sticky; the ownership derived from it is re-derived, so a flee that
        // loses its gradient hands the body back to wander on the same tick
        // wander runs — which is why ai_step must run first.
        vec3 dir{0.0f, 0.0f, 0.0f};
        bool owned = false;
        if (brain.currentIntent == IntentFlee && danger != nullptr) {
            // Down the gradient: the field is danger, so safety is -grad.
            const vec3 g = diffusion_gradient(*danger, grid, cx, cy, cz);
            const vec3 away{-g.x, -g.y, 0.0f};
            if (away.x * away.x + away.y * away.y > kMinFleeGrad2) {
                dir = normalize(away);
                owned = true;
            }
        }

        if (!owned) {
            // Delegate. wander_step steers this body, exactly as it does today.
            brain.motion = static_cast<std::uint8_t>(MotionOwner::Wander);
            ++out.wanderOwned;
            continue;
        }

        brain.motion = static_cast<std::uint8_t>(MotionOwner::Ai);
        ++out.aiOwned;
        Velocity& vel = view.get<Velocity>(e);
        vel.v.x = dir.x * kFleeSpeed;
        vel.v.y = dir.y * kFleeSpeed;
        // vel.v.z is intentionally untouched — physics_step owns it (gravity and
        // jump). Same rule as wander_step: this is locomotion, not flight.
    }
    return out;
}

} // namespace giga::game
