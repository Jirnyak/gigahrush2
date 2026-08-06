#include "game/ai.h"
#include <algorithm>

#include <cmath>
#include <vector>

#include "core/math.h"        // vec3, normalize
#include "core/wrap.h"        // wrap_delta — toroidal cell distance for recall
#include "ecs/components.h"   // Transform, Velocity, CameraTag
#include "game/embody.h"      // NpcRef
#include "game/mob_spawn.h"   // MobRef — the scope exclusion
#include "game/needs.h"       // needs_roll — substitute for an unseeded pool row
#include "game/door.h"        // door_nearest_shelter — hermetic flee target (§23)
#include "game/room_zone.h"   // room affordance table + baked fields (§27 legs a,b)
#include "sim/diffusion.h"    // diffusion_gradient — the flee steering field
#include "world/field.h"      // Field<float>
#include "world/macro_grid.h" // MacroGrid (open/wall test inside the gradient)
#include "world/types.h"      // wrap_macro, kCellSize, kMacroDim
#include "world/world.h"      // World — door_nearest_shelter needs const World&

namespace giga::game {

namespace {

// --- Scorer math (reference npc_utility.ts helpers, verbatim) ---------------


// clampScore: NaN -> 0, else clamp to [0, 100].
inline float clamp_score(float s) {
    if (s != s) return 0.0f; // NaN
    return s < 0.0f ? 0.0f : (s > 100.0f ? 100.0f : s);
}

// smoothstep(e0, e1, v) — Hermite ease over the clamped ramp.
inline float smoothstep01(float e0, float e1, float v) {
    const float x = giga::clamp01((v - e0) / (e1 - e0));
    return x * x * (3.0f - 2.0f * x);
}

// Reserve pressure: a low reserve (v -> 0) maps toward 1.
inline float low_need_pressure(float v) {
    return smoothstep01(0.18f, 0.82f, giga::clamp01((72.0f - v) / 72.0f));
}
// Bladder pressure: a full column (v -> 100) maps toward 1.
inline float high_need_pressure(float v) {
    return smoothstep01(0.35f, 0.90f, giga::clamp01(v / 100.0f));
}
// Health pressure: 0 at full HP, 1 at 0 HP.
inline float health_pressure(float hp, float maxHp) {
    return maxHp > 0.0f ? giga::clamp01(1.0f - hp / maxHp) : 0.0f;
}

// Normalise a heterogeneous "unit-ish" input to [0,1] by magnitude band:
// <=1 already unit, <=100 percent, else byte.
inline float unitish(float v) {
    if (v != v) return 0.0f; // NaN
    const float a = v < 0.0f ? -v : v;
    if (a <= 1.0f) return giga::clamp01(v);
    if (a <= 100.0f) return giga::clamp01(v / 100.0f);
    return giga::clamp01(v / 255.0f);
}

// computeThreatPressure: the max over every danger channel, nudged by
// cornered/shelter, clamped to [0,1]. Only `danger` (the diffusion field) and
// `rememberedThreat` (this file's memory column) are live today; the rest are 0,
// so this reduces to those two plus the cornered/shelter bias — exactly the
// reference with the missing inputs zeroed.
//
// The remembered channel is scaled by kMemThreatWeight for the same reason the
// reference scales gunfire by 0.75 and fog by 0.6: a weaker class of evidence
// belongs in the same max, at a discount, not in a separate term. Because it is a
// MAX and not a sum, a live field of the same magnitude simply dominates — memory
// can never double-count what the body is currently standing in.
inline float compute_threat_pressure(const Perception& p) {
    float m = unitish(p.danger);
    m = std::max(m, unitish(p.monster));
    m = std::max(m, unitish(p.gunfire) * 0.75f);
    m = std::max(m, unitish(p.fire));
    m = std::max(m, unitish(p.fog) * 0.6f);
    m = std::max(m, unitish(p.rememberedThreat) * kMemThreatWeight);
    m = std::max(m, giga::clamp01(p.visibleHostiles / 3.0f) * 0.85f);
    m = std::max(m, p.threatDistance < 0.0f
                    ? 0.0f
                    : giga::clamp01((16.0f - p.threatDistance) / 16.0f));
    const float s = m + (p.cornered ? 0.15f : 0.0f) + (p.inShelter ? -0.18f : 0.0f);
    return giga::clamp01(s);
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

// --- Remembered site -> the intent it affords -------------------------------
// A table rather than a switch, so adding a MemoryKind is one row and no control
// flow ([AGENTS.md] "Data-driven by default"). MemDanger / MemHurt / MemFoe are
// deliberately absent: they are threat and grudge, not affordances, and they are
// handled by name in `apply_recall`.
struct SiteIntent {
    std::uint8_t kind;
    std::uint8_t intent;
};
inline constexpr SiteIntent kSiteIntents[] = {
    {MemFood, IntentEat},
    {MemWater, IntentDrink},
    {MemRest, IntentSleep},
    {MemToilet, IntentToilet},
    {MemAlly, IntentSocial},
};

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
        std::max(high_need_pressure(needs.pee), high_need_pressure(needs.poo));
    const float drinkP = low_need_pressure(needs.water);
    const float eatP = low_need_pressure(needs.food);
    const float sleepP = low_need_pressure(needs.sleep);
    const float urgent = std::max(std::max(std::max(toiletP, drinkP), std::max(eatP, sleepP)), hpP);

    const float vhp = giga::clamp01(p.visibleHostiles / 4.0f);
    const float ctp = p.threatDistance < 0.0f
                          ? 0.0f
                          : giga::clamp01((18.0f - p.threatDistance) / 18.0f);
    const bool stronger =
        p.strongerHostile || (p.hostilePower > p.allyPower + 0.15f);

    // Room affordance and target cost, PER INTENT — the reference's
    // `context.local?.[intent]` / `context.target?.[intent]`. Both arrays are
    // all-zero unless something fills them; memory (`apply_recall`) is the first
    // and currently only supplier, so a body that remembers nothing scores exactly
    // what it scored before these became arrays.
    const auto local = [&](std::uint8_t intent) -> float {
        return p.localScore[intent];
    };
    const auto tpen = [&](std::uint8_t intent) -> float {
        return p.targetPenalty[intent];
    };
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
        local(IntentSafety) + stick(IntentSafety) - tpen(IntentSafety));

    out[IntentCombat] = clamp_score(
        vhp * 34.0f + ctp * 12.0f + (p.armed ? 18.0f : -16.0f) +
        (p.orderedCombat ? 28.0f : 0.0f) + (p.cornered ? 18.0f : 0.0f) +
        tr.risk * 22.0f + tr.duty * 10.0f - hpP * 30.0f - tr.panic * 12.0f -
        (stronger ? 14.0f : 0.0f) + local(IntentCombat) + stick(IntentCombat) -
        tpen(IntentCombat));

    out[IntentFlee] = clamp_score(
        vhp * 24.0f + threat * 42.0f + unitish(p.monster) * 24.0f +
        unitish(p.fire) * 25.0f + hpP * 32.0f + (stronger ? 18.0f : 0.0f) +
        (1.0f - tr.risk) * 15.0f + tr.panic * 18.0f +
        (p.samosborActive ? 8.0f : 0.0f) - (p.armed ? 5.0f : 0.0f) +
        local(IntentFlee) + stick(IntentFlee) - tpen(IntentFlee));

    out[IntentToilet] =
        clamp_score(toiletP * 92.0f + rhythm + local(IntentToilet) +
                    stick(IntentToilet) - threat * 18.0f - tpen(IntentToilet));

    out[IntentDrink] =
        clamp_score(drinkP * 88.0f + rhythm + local(IntentDrink) +
                    stick(IntentDrink) - threat * 16.0f - tpen(IntentDrink));

    out[IntentEat] = clamp_score(eatP * 86.0f + rhythm + local(IntentEat) +
                                 stick(IntentEat) - threat * 16.0f -
                                 tpen(IntentEat));

    out[IntentSleep] = clamp_score(
        sleepP * 76.0f + rhythm /* + occupation sleep bonus (0: no occupations) */ +
        local(IntentSleep) + stick(IntentSleep) - threat * 30.0f -
        (p.samosborActive ? 18.0f : 0.0f) - tpen(IntentSleep));

    out[IntentWork] = clamp_score(
        tr.duty * 34.0f + tr.workDrive * 18.0f + rhythm + local(IntentWork) +
        stick(IntentWork) - urgent * 30.0f - threat * 42.0f -
        (p.samosborActive ? 45.0f : 0.0f) - tpen(IntentWork));

    out[IntentHeal] = clamp_score(
        hpP * 105.0f /* + occupation heal-idle bonus (0: no occupations) */ +
        local(IntentHeal) + stick(IntentHeal) - threat * 10.0f - tpen(IntentHeal));

    out[IntentSocial] = clamp_score(
        tr.sociability * 29.0f + rhythm + local(IntentSocial) +
        stick(IntentSocial) - urgent * 15.0f - threat * 34.0f -
        (p.samosborActive ? 25.0f : 0.0f) - tpen(IntentSocial));

    // Patrol's samosbor penalty is waived for the factions that patrol INTO a
    // samosbor (Liquidators, Cultists).
    const bool patrolSamosborPenalty =
        p.samosborActive &&
        p.faction != static_cast<std::uint16_t>(Faction::Liquidators) &&
        p.faction != static_cast<std::uint16_t>(Faction::Cultists);
    out[IntentPatrol] = clamp_score(
        tr.patrolDrive * 36.0f + tr.duty * 18.0f + rhythm + threat * 10.0f +
        local(IntentPatrol) + stick(IntentPatrol) - urgent * 18.0f -
        (patrolSamosborPenalty ? 24.0f : 0.0f) - tpen(IntentPatrol));

    // faction_assault: a flat 50 when a faction "attack" goal names this body,
    // else 0. No local/stickiness/target terms — only the identity jitter below.
    out[IntentFactionAssault] = clamp_score(p.factionAssaultTarget ? 50.0f : 0.0f);

    // wander carries its own internal signed jitter (channel "wander_score",
    // amp 3) on top of the shared body.
    const float wanderJitter =
        jitter_signed(channel_seed(p.idSeed, "wander_score"), 3.0f);
    out[IntentWander] = clamp_score(
        9.0f + rhythm + wanderJitter + (p.isTraveler ? 19.0f : 0.0f) +
        local(IntentWander) + stick(IntentWander) - urgent * 12.0f -
        threat * 22.0f - tpen(IntentWander));

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

// ==========================================================================
// MEMORY — the DEMAND column, its recorders, and the recall that feeds the
// scorer. See the ai.h banner for the design, the footprint arithmetic and the
// honest list of which kinds have a producer today.
// ==========================================================================

void AiMemory::ensure(NpcId id) {
    if (id < rows_.size()) return;
    // Geometric from the kMemChunk floor. A fixed-chunk resize() copies the whole
    // column at every boundary — the measured trap [npc_pool.h] documents for its
    // own lazy columns (232 copies of the widest column at the 950k target).
    std::size_t want = rows_.empty() ? static_cast<std::size_t>(kMemChunk)
                                     : rows_.size() * 2;
    while (want <= static_cast<std::size_t>(id)) want *= 2;
    if (want > static_cast<std::size_t>(kNpcPoolSize))
        want = static_cast<std::size_t>(kNpcPoolSize);
    rows_.resize(want); // MemoryRow default-constructs to all-MemNone == empty
}

bool AiMemory::remember(NpcId id, std::uint8_t kind, std::uint32_t payload,
                        float strength01, double now) {
    if (kind == MemNone || kind >= kMemKindCount) return false;
    if (id >= kNpcPoolSize) return false; // the column can never cover it
    ensure(id);

    MemoryRow& row = rows_[id];
    const float t = static_cast<float>(now);
    const std::uint32_t pay = payload & kMemPayloadMask;

    // 1. COALESCE. A body standing in a hot cell re-plans every ~2.75 s forever;
    //    without this it would fill all eight slots with the same fact inside 25
    //    seconds and then start evicting real ones. Refresh in place and keep the
    //    STRONGER reading — the reference's `existing.severity = max(...)` /
    //    `existing.lastAt = event.time` shape from room_memory.ts.
    for (int i = 0; i < kMemSlots; ++i) {
        MemoryTrace& s = row.slot[i];
        if (s.kind() != kind || s.payload() != pay) continue;
        if (t - s.seenAt >= mem_ttl_sec(kind)) continue; // dead; stage 2 reuses it
        const float have = s.strength();
        s = mem_trace(kind, pay, have > strength01 ? have : strength01, t);
        ++coalesced_;
        return true;
    }

    // 2. First EMPTY or EXPIRED slot, lowest index. Expiry is checked here rather
    //    than by a sweep pass: there is no tick that walks 2^20 rows, so a trace
    //    dies lazily, exactly when someone looks at or overwrites it.
    for (int i = 0; i < kMemSlots; ++i) {
        MemoryTrace& s = row.slot[i];
        const std::uint8_t k = s.kind();
        if (k != MemNone && t - s.seenAt < mem_ttl_sec(k)) continue;
        s = mem_trace(kind, pay, strength01, t);
        ++writes_;
        return true;
    }

    // 3. EVICT the least useful. The reference's `mostUsefulObservedFact` ranks by
    //    `score (1..100) + freshness (0..30) + insertion index`; this is that rank
    //    run backwards, with strength scaled to 100 so the two terms keep the
    //    reference's relative weighting. DIVERGENCE, deliberate: ties break toward
    //    the LOWER index (the reference's `+ i` favours the later slot), because
    //    lower-index-wins is this file's convention everywhere else —
    //    `select_intent_raw` and the two placement loops above — and one tie rule
    //    per file is what keeps two runs bit-identical.
    int victim = 0;
    float worst = 1e30f;
    for (int i = 0; i < kMemSlots; ++i) {
        const MemoryTrace& s = row.slot[i];
        const float rank =
            s.strength() * 100.0f + mem_freshness(t - s.seenAt);
        if (rank < worst) {
            worst = rank;
            victim = i;
        }
    }
    row.slot[victim] = mem_trace(kind, pay, strength01, t);
    ++writes_;
    ++evictions_;
    return true;
}

std::uint32_t AiMemory::live_traces(NpcId id, double now) const {
    const MemoryRow& r = row(id);
    const float t = static_cast<float>(now);
    std::uint32_t n = 0;
    for (int i = 0; i < kMemSlots; ++i) {
        const std::uint8_t k = r.slot[i].kind();
        if (k == MemNone) continue;
        if (t - r.slot[i].seenAt >= mem_ttl_sec(k)) continue;
        ++n;
    }
    return n;
}

void AiMemory::forget(NpcId id) {
    if (id >= rows_.size()) return;
    rows_[id] = MemoryRow{};
}

bool ai_remember_cell(AiMemory& mem, NpcId id, std::uint8_t kind, int cx, int cy,
                      int cz, float strength01, double now) {
    // A kind belongs to exactly one payload family; filing a cell under MemFoe
    // would make the recall read an NpcId as coordinates. Refuse rather than
    // silently corrupt.
    if (mem_kind_is_actor(kind)) return false;
    return mem.remember(
        id, kind,
        mem_pack_cell(wrap_macro(cx), wrap_macro(cy), wrap_macro(cz)),
        strength01, now);
}

bool ai_remember_actor(AiMemory& mem, NpcId id, std::uint8_t kind, NpcId who,
                       float strength01, double now) {
    if (!mem_kind_is_actor(kind)) return false;
    if (who == kInvalidNpc) return false;
    return mem.remember(id, kind, who & kNpcIdMask, strength01, now);
}

MemoryRecall ai_recall(const AiMemory& mem, NpcId id, int cx, int cy, int cz,
                       double now) {
    MemoryRecall out;
    const MemoryRow& r = mem.row(id);
    const float t = static_cast<float>(now);
    // The away vector is a WEIGHTED SUM of the directions leading away from each
    // remembered danger cell, so three marks in a corridor agree and one mark
    // behind a body that has already moved still points forward.
    float sumX = 0.0f;
    float sumY = 0.0f;

    for (int i = 0; i < kMemSlots; ++i) {
        const MemoryTrace& s = r.slot[i];
        const std::uint8_t kind = s.kind();
        if (kind == MemNone) continue;
        // The packed field is 4 bits wide and kMemKindCount is 9, so a trace built
        // by hand rather than through `remember` (which refuses an out-of-range
        // kind) could carry 9..15 and index `siteStrength` off the end. The TTL
        // check below only catches it for a NON-NEGATIVE age, so this is a separate
        // guard rather than a duplicate one.
        if (kind >= kMemKindCount) continue;
        const float age = t - s.seenAt;
        if (age >= mem_ttl_sec(kind)) continue; // expired: invisible, not deleted
        ++out.live;

        const float str = s.strength();
        // 1 when just seen, 0 at the TTL. The reference's freshness curve,
        // renormalised to a multiplier.
        const float fresh = mem_freshness(age) / kMemFreshnessMax;

        if (mem_kind_is_actor(kind)) {
            const float w = str * fresh;
            if (kind == MemFoe) {
                if (w > out.grudge) {
                    out.grudge = w;
                    out.foe = s.payload();
                }
            } else if (w > out.siteStrength[kind]) {
                out.siteStrength[kind] = w;
                out.siteDistCells[kind] = 0.0f; // a person is not a place
            }
            continue;
        }

        // A place. Toroidal on all three axes — a memory two cells away across the
        // seam must not read as 126 cells away ([AGENTS.md] toroidal invariants).
        const int dx = wrap_delta(cx, mem_cell_x(s.payload()), kMacroDim);
        const int dy = wrap_delta(cy, mem_cell_y(s.payload()), kMacroDim);
        const int dz = wrap_delta(cz, mem_cell_z(s.payload()), kMacroDim);
        const int d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > kMemRecallCells * kMemRecallCells) continue; // too far to matter
        const float dist = std::sqrt(static_cast<float>(d2));
        // 1 at the cell itself, 0 at the recall radius.
        const float prox = 1.0f - dist / static_cast<float>(kMemRecallCells);

        if (kind == MemDanger || kind == MemHurt) {
            const float th = giga::clamp01(str * prox * fresh);
            if (th > out.threat) out.threat = th;
            // A mark on the body's OWN cell contributes 0 to the direction (its
            // delta is the zero vector) while still contributing its full share to
            // `threat`. That is deliberate: it means "this place is bad", which is
            // a reason to leave but not a bearing, so the flee falls back to
            // wander's roaming rather than freezing. Same stance as the flat
            // gradient case ([ai.h] kMinFleeGrad2).
            sumX -= static_cast<float>(dx) * th;
            sumY -= static_cast<float>(dy) * th;
        } else {
            const float w = giga::clamp01(str * fresh);
            if (w > out.siteStrength[kind]) {
                out.siteStrength[kind] = w;
                out.siteDistCells[kind] = dist;
            }
        }
    }

    const float mag2 = sumX * sumX + sumY * sumY;
    if (mag2 > kMinFleeGrad2) {
        const float inv = 1.0f / std::sqrt(mag2);
        out.awayX = sumX * inv;
        out.awayY = sumY * inv;
        out.haveAway = true;
    }
    return out;
}

void apply_recall(const MemoryRecall& r, std::uint16_t faction, Perception& p) {
    p.rememberedThreat = r.threat;
    p.grudge = r.grudge;

    // The grudge split. The reference has no single "grudge" coefficient — it has
    // fear/trust scalars consumed by dialogue and a `risk` trait consumed by the
    // scorer — so rather than invent one, the grudge is spent through the
    // affordance slot at the reference's own `Math.min(10, ...)` cap and DIVIDED by
    // the body's risk tolerance. The same insult therefore turns a Liquidator
    // (risk 0.74) toward combat and a Citizen (risk 0.32) toward flight, which is
    // the behaviour npc.md asks faction to produce.
    if (r.grudge > 0.0f) {
        const FactionTraits& tr = faction_traits(faction);
        const float bonus = r.grudge * kMemAffordanceCap;
        p.localScore[IntentCombat] += bonus * tr.risk;
        p.localScore[IntentFlee] += bonus * (1.0f - tr.risk);
    }

    // A remembered site is an affordance for exactly ONE intent, and the mapping
    // is a table so a new MemoryKind is one row here and nothing else.
    for (const SiteIntent& m : kSiteIntents) {
        const float s = r.siteStrength[m.kind];
        if (s <= 0.0f) continue;
        // += and not =: a future room-affordance model fills the same slots, and
        // knowing where the kitchen is should ADD to standing in one.
        p.localScore[m.intent] += kMemAffordanceCap * s;
        // The reference targetPenalty distance term verbatim: clamp01(d/96)*24,
        // with d in world units. One macro cell is kCellSize metres.
        const float metres = r.siteDistCells[m.kind] * kCellSize;
        p.targetPenalty[m.intent] +=
            giga::clamp01(metres / kMemTargetDistSpan) * kMemTargetDistWeight;
    }
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
               const AiConfig& cfg, AiMemory* mem,
               const DoorSet* doors, const World* world,
               const RoomZones* rooms) {
    AiTick out;
    // Dormant by default. Returning before the sweep means a disabled AI costs
    // one branch, and it means nothing can be left half-arbitrated: the token is
    // only ever written below. Clearing `enabled` on a running floor needs
    // `ai_release` — see ai.h.
    if (!cfg.enabled) return out;

    // Null store OR the config axis off => bit-for-bit the pre-memory pass: no
    // recall, no record, no allocation. The store is the real switch; the flag is
    // what lets one store be measured on and off with nothing else different.
    const bool useMem = (mem != nullptr) && cfg.memory;
    // Rooms are OFF unless a bake landed AND that bake found something. A floor
    // whose mix rolls no kitchen, no bathroom and no flat bakes nothing
    // ([room_zone.h]), so `ready()` is false and this pass is bit-for-bit the
    // pre-rooms one — the degradation is a property of the data, not a branch.
    const bool useRooms = (rooms != nullptr) && rooms->ready();
    const int roomStride = useRooms ? floor_room_stride(rooms->kind) : 0;
    // Hoisted out of the loop so a body that neither re-plans nor flees pays
    // NOTHING for memory — not even zeroing a MemoryRecall. `ai_recall` returns a
    // fully-initialised value, so the assignment below cannot carry stale fields
    // from the previous body; `haveRecall` is what gates every read.
    MemoryRecall recall;

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
        // Hoisted out of the re-plan branch: the SEAT hash needs it on every tick a
        // body is on an errand, not only on the ticks it re-decides. One lowbias32
        // finalise, and it is the same value the score jitter uses, so nothing about
        // any existing decision moves.
        const std::uint32_t idSeed = identity_seed(id);

        // The macro cell the body stands in — the same pos->cell map fold_back
        // uses, wrapped onto the torus. kCellSize == kEmbodyCellSize; using the
        // world constant keeps this consistent with wander.cpp and physics.
        const int cx = wrap_macro(static_cast<int>(std::floor(tr.pos.x / kCellSize)));
        const int cy = wrap_macro(static_cast<int>(std::floor(tr.pos.y / kCellSize)));
        const int cz = wrap_macro(static_cast<int>(std::floor(tr.pos.z / kCellSize)));

        const float dangerHere = danger != nullptr ? danger->at(cx, cy, cz) : 0.0f;

        // --- RECORDER 1: an HP drop, checked EVERY tick ----------------------
        // Damage is an event, not a poll, so the tick it lands on is the only tick
        // whose cell is the fact. `AiBrain::lastHp` is what makes that detectable
        // with no damage bus and no extra column — it is the struct's old `pad_`.
        // The latch happens whether or not memory is on, so switching memory on
        // mid-run cannot file one bogus drop for the body's whole history.
        const std::int16_t hpNow = pool.hp(id);
        if (useMem && hpNow < brain.lastHp) {
            const float maxHp = static_cast<float>(pool.max_hp(id));
            const float lost = static_cast<float>(brain.lastHp - hpNow);
            // Strength is the FRACTION of max HP lost — a real varying number, not
            // a constant standing in for one.
            const float frac = maxHp > 0.0f ? lost / maxHp : 1.0f;
            if (ai_remember_cell(*mem, id, MemHurt, cx, cy, cz, frac, now))
                ++out.remembered;
        }
        brain.lastHp = hpNow;

        // --- RECALL, and only when somebody is going to read it --------------
        // Two consumers, so two conditions: the scorer (a re-plan) and the flee
        // steering direction (already fleeing). Everything else pays zero. At the
        // shipping cadence that is ~0.36 recalls per body per second plus the
        // fleeing slice, not 125 — which is what keeps this O(n) with a small
        // constant instead of a per-tick row scan over the whole crowd.
        const bool wantReplan = now >= static_cast<double>(brain.nextDecisionAt);
        bool haveRecall = false;
        if (useMem && (wantReplan || brain.currentIntent == IntentFlee)) {
            recall = ai_recall(*mem, id, cx, cy, cz, now);
            haveRecall = true;
            ++out.recalled;
        }

        // --- Re-plan, on this body's own staggered deadline only -------------
        // The crowd's decisions spread across frames with zero scheduling RAM: the
        // one float below is the whole scheduler. A fresh brain
        // (nextDecisionAt == 0) plans at once.
        if (wantReplan) {
            Perception p;
            p.idSeed = idSeed;
            p.faction = pool.faction(id);
            p.hp = static_cast<float>(hpNow);
            p.maxHp = static_cast<float>(pool.max_hp(id));
            p.danger = dangerHere;
            p.currentIntent = brain.currentIntent;
            // Zeroed when hysteresis is off, so the two arms of the measurement
            // differ in exactly the mechanism under test and nothing else.
            p.stickinessAmount =
                cfg.hysteresis ? stickiness_amount(brain.stateTimer) : 0.0f;
            // What this body KNOWS, folded into the same Perception seam as
            // everything else. With no memory every added field stays at its zero
            // default, so the ranking is identical to the pre-memory one.
            if (haveRecall) apply_recall(recall, p.faction, p);
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

            // --- RECORDER 2: the danger field at this body's own cell --------
            // Filed AFTER the decision, on the body's own staggered tick — the
            // reference's "direct witnesses update memory, and the fact changes a
            // LATER decision". One re-plan of latency, deliberately: it means the
            // trace can never double-count the live reading that produced it, and
            // it makes the interesting case honest — the body flees on the live
            // field first, and on the memory only once the field has evaporated.
            //
            // `unitish` first, so the bar is scale-independent: the reference
            // refuses to record below severity 2 of 5, which is what 0.20 is.
            if (useMem) {
                const float sev = unitish(dangerHere);
                if (sev >= kMemDangerRecordUnit &&
                    ai_remember_cell(*mem, id, MemDanger, cx, cy, cz, sev, now))
                    ++out.remembered;
            }
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
        bool viaMemory = false;
        if (brain.currentIntent == IntentFlee) {
            // §23 hermetic shelter first: a sealed apartment is a real destination
            // during Samosbor purple fog, not just "away from the gradient". Both
            // world and doors must be live (main wires them; tests pass null and
            // keep the prior gradient/memory path bit-for-bit). Already-inside a
            // sealed room is handled by door_nearest_shelter returning the body's
            // own cell — dx/dy then fall below kMinFleeGrad2 and we fall through.
            if (world != nullptr && doors != nullptr) {
                int ox = cx, oy = cy, oz = cz;
                if (door_nearest_shelter(*world, *doors, cx, cy, cz, ox, oy, oz)) {
                    const float dx = static_cast<float>(wrap_delta(cx, ox, kMacroDim));
                    const float dy = static_cast<float>(wrap_delta(cy, oy, kMacroDim));
                    if (dx * dx + dy * dy > kMinFleeGrad2) {
                        dir = normalize(vec3{dx, dy, 0.0f});
                        owned = true;
                    }
                }
            }
            // Live danger gradient: preferred over memory when no shelter
            // direction is available (no hermetic door on floor, or already there).
            if (!owned && danger != nullptr) {
                // Down the gradient: the field is danger, so safety is -grad.
                const vec3 g = diffusion_gradient(*danger, grid, cx, cy, cz);
                const vec3 away{-g.x, -g.y, 0.0f};
                if (away.x * away.x + away.y * away.y > kMinFleeGrad2) {
                    dir = normalize(away);
                    owned = true;
                }
            }
            // Memory is the last FALLBACK — a field reading is now, a trace is
            // then. This branch is what stops the body handing itself back to
            // wander the instant the diffusion field evaporates, and it is the only
            // new way a body can take MotionOwner::Ai. `IntentFlee` is still the
            // ONLY owning intent, so the single-writer story in [ai.h] is unchanged.
            if (!owned && haveRecall && recall.haveAway) {
                // Already unit length from ai_recall; no second normalize.
                dir = vec3{recall.awayX, recall.awayY, 0.0f};
                owned = true;
                viaMemory = true;
            }
        } else if (useRooms) {
            // --- THE ERRAND: a non-flee intent that has somewhere to be --------
            // This is §27 leg (a). Everything about it is a TABLE read: which room
            // kind satisfies this intent, where the nearest one is, and what one
            // second inside it does. No intent is named in this branch — adding
            // "work happens in a Production room" is a row in kRoomAffordance and
            // not a line here ([room_zone.h]).
            const std::uint16_t want = intent_room_mask(brain.currentIntent);
            const std::uint16_t here =
                want != 0 ? room_bit_at(rooms->kind, rooms->number, cx, cy) : 0;

            if (want != 0 && (here & want) != 0) {
                // ALREADY IN THE RIGHT ROOM — so the goal is no longer the room, it
                // is the MICRO-GOAL: this body's own seat among the room's nine
                // interior cells, hashed from its identity so a hungry crowd
                // spreads across the kitchen instead of converging on one voxel.
                // Stateless by construction; see the [room_zone.h] banner.
                const int rx = cx / roomStride;
                const int ry = cy / roomStride;
                int ox = 0, oy = 0;
                room_seat_offset(idSeed, rx, ry, roomStride, ox, oy);
                const int sx = rx * roomStride + ox;
                const int sy = ry * roomStride + oy;

                // A seat inside solid geometry is unreachable, and a body that
                // cannot reach its seat would push into the wall for the rest of
                // the session. Standing anywhere in the right room is what the
                // recovery actually keys on ([room_zone.h] room_bit_at), so an
                // unreachable seat degrades to "settled where you are" rather than
                // to a permanent shove.
                if (grid.mask(sx, sy, cz).full()) {
                    owned = true; // settled: hold still, the room does the work
                } else {
                    const float tx = (static_cast<float>(sx) + 0.5f) * kCellSize;
                    const float ty = (static_cast<float>(sy) + 0.5f) * kCellSize;
                    const float dx = wrap_delta_f(tr.pos.x, tx, kWorldExtent);
                    const float dy = wrap_delta_f(tr.pos.y, ty, kWorldExtent);
                    const float d2 = dx * dx + dy * dy;
                    owned = true;
                    if (d2 > kSeatArriveM * kSeatArriveM)
                        dir = normalize(vec3{dx, dy, 0.0f});
                    // else: dir stays zero — SETTLED. Owning the body and writing a
                    // zero is the point, not an oversight: handing it back to
                    // wander here would walk it out of the kitchen mid-meal, which
                    // is the one failure mode this whole leg exists to prevent.
                }
                if (owned) ++out.settled;
            } else if (want != 0) {
                // NOT THERE YET — descend the room kind's baked field.
                const RoomRoute r = room_route(*rooms, want, cx, cy, cz);
                if (r.bit != 0 && r.dir < 4) {
                    // A horizontal step. kNavDir 0..3 are +-x/+-y; 4..5 are the
                    // gravity axis, and `Velocity.z` belongs to physics.
                    dir = normalize(vec3{static_cast<float>(nav::kNavDir[r.dir][0]),
                                         static_cast<float>(nav::kNavDir[r.dir][1]),
                                         0.0f});
                    owned = true;
                } else if (r.bit != 0) {
                    // THE VERTICAL STEP, and it is not a rare case: the field is
                    // 6-connected, so a route may legitimately begin by going up a
                    // storey, and a walking body cannot climb one. `wander_step`
                    // measured the same thing (110 of 120 ground-storey residents
                    // get a vertical first step) and takes the same fallback: walk
                    // toward the target room's COLUMN and let physics resolve what
                    // it meets. `targetX/targetY` is exact, not a guess — it is the
                    // nearest room of that kind, brute-forced at bake time.
                    const float tx = (static_cast<float>(r.targetX) + 0.5f) * kCellSize;
                    const float ty = (static_cast<float>(r.targetY) + 0.5f) * kCellSize;
                    const float dx = wrap_delta_f(tr.pos.x, tx, kWorldExtent);
                    const float dy = wrap_delta_f(tr.pos.y, ty, kWorldExtent);
                    if (dx * dx + dy * dy > kMinFleeGrad2) {
                        dir = normalize(vec3{dx, dy, 0.0f});
                        owned = true;
                    }
                }
                // r.bit == 0 means no room of that kind is REACHABLE from here (a
                // sealed pocket, or a floor that has none). Fall through to wander.
            }
            if (owned) ++out.roomOwned;
        }

        ++out.byIntent[brain.currentIntent < kIntentCount
                           ? brain.currentIntent
                           : static_cast<std::uint8_t>(IntentWander)];

        if (!owned) {
            // Delegate. wander_step steers this body, exactly as it does today.
            brain.motion = static_cast<std::uint8_t>(MotionOwner::Wander);
            ++out.wanderOwned;
            continue;
        }

        brain.motion = static_cast<std::uint8_t>(MotionOwner::Ai);
        ++out.aiOwned;
        if (viaMemory) ++out.memoryFled;
        Velocity& vel = view.get<Velocity>(e);
        // Panic reads as panic only while the ordinary pace is ordinary: a body
        // running from a gradient outpaces one walking to the kitchen by 60%.
        // A SETTLED body has `dir` at zero, so this writes a real stop — owning the
        // body and holding it still is what keeps wander from walking it back out
        // of the room mid-meal.
        const float speed =
            brain.currentIntent == IntentFlee ? kFleeSpeed : kErrandSpeed;
        vel.v.x = dir.x * speed;
        vel.v.y = dir.y * speed;
        // vel.v.z is intentionally untouched — physics_step owns it (gravity and
        // jump). Same rule as wander_step: this is locomotion, not flight.
    }
    return out;
}

} // namespace giga::game
