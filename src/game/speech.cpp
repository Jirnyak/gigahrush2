// Speech — the pick. See [speech.h] for why this is a line bank and not a Markov
// chain, and why it is a sibling of `rumour.h` rather than an extension of it.
//
// Everything here is O(1) and allocation-free. The generated table
// ([speech_table.cpp]) has already baked the index, so a pick is: two bucket reads,
// one `hash3`, one modulo, one add.
#include "game/speech.h"
#include <algorithm>

#include "core/rng.h"        // hash3 / rand_below — the stateless mixer
#include "game/ai.h"         // IntentId / kIntentNone / AiBrain — the committed decision
#include "game/embody.h"     // NpcRef — the NpcId -> Entity link
#include "game/needs.h"      // the warn thresholds, so speech invents no numbers
#include "game/samosbor.h"   // SamosborPhase — the clock the three fog kinds read

namespace giga::game {

// ---------------------------------------------------------------------------
// The coupling to the two enums this file switches on, made LOUD.
//
// `SpeechContext` carries `intent` and `samosborPhase` as bare bytes so [speech.h]
// stays light and does not include two headers a concurrent editor may be reshaping.
// The price of that is that a reorder in ai.h or samosbor.h would silently reroute the
// crowd's voice instead of breaking the build — so it is paid here, once, in asserts.
// ai.h states the same thing about its own ordering: "the INDEX is load-bearing".
// ---------------------------------------------------------------------------
static_assert(IntentSafety == 0 && IntentCombat == 1 && IntentFlee == 2 &&
                  IntentToilet == 3 && IntentDrink == 4 && IntentEat == 5 &&
                  IntentSleep == 6 && IntentWork == 7 && IntentHeal == 8 &&
                  IntentSocial == 9 && IntentPatrol == 10 &&
                  IntentFactionAssault == 11 && IntentWander == 12,
              "speech_situation maps IntentId by value; ai.h reordered its enum");
static_assert(kIntentNone == 0xFFu,
              "SpeechContext::intent defaults to kIntentNone; ai.h changed it");
static_assert(static_cast<std::uint8_t>(SamosborPhase::Idle) == 0 &&
                  static_cast<std::uint8_t>(SamosborPhase::Warning) == 1 &&
                  static_cast<std::uint8_t>(SamosborPhase::Active) == 2 &&
                  static_cast<std::uint8_t>(SamosborPhase::Aftermath) == 3,
              "speech_situation maps SamosborPhase by value; samosbor.h reordered it");

namespace {

// Decorrelates the one anti-repeat re-roll from the first draw. Any odd constant with
// good bit spread works; this is the golden-ratio word [core/rng.h] already uses as a
// key mixer, reused rather than invented.
constexpr std::uint32_t kRerollSalt = 0x9e3779b9u;

// The two contiguous ranges a (situation, faction) pick draws from: the faction's own
// lines first, then the wildcard register. Order matters — `speech_line_index` maps a
// draw `k` onto it positionally, and the anti-repeat step walks it.
struct LineUnion {
    std::uint16_t specFirst = 0;
    std::uint16_t specCount = 0;
    std::uint16_t anyFirst = 0;
    std::uint16_t anyCount = 0;
    std::uint32_t total = 0;
};

LineUnion line_union(SpeechSituation s, std::uint16_t faction) {
    // MODULO, not a mask: five factions is not a power of two, and `& 3` is exactly
    // the bug [faction.h] records — it silently folded Wild onto Citizens.
    const std::uint8_t slot =
        static_cast<std::uint8_t>(faction % static_cast<std::uint16_t>(kFactionCount));
    const SpeechBucket& sp = speech_bucket(s, slot);
    const SpeechBucket& an = speech_bucket(s, kSpeechAnySlot);
    LineUnion u;
    u.specFirst = sp.first;
    u.specCount = sp.count;
    u.anyFirst = an.first;
    u.anyCount = an.count;
    u.total = static_cast<std::uint32_t>(sp.count) + static_cast<std::uint32_t>(an.count);
    return u;
}

// Position `k` in [0, total) -> index into kSpeechText.
std::uint16_t at(const LineUnion& u, std::uint32_t k) {
    return k < u.specCount
               ? static_cast<std::uint16_t>(u.specFirst + k)
               : static_cast<std::uint16_t>(u.anyFirst + (k - u.specCount));
}

// Inverse of `at`. Returns `total` (an invalid position) when `idx` is in neither
// range, which is how a stale `SpeechMemory` entry from a DIFFERENT situation is
// rejected instead of being mistaken for a position in this one.
std::uint32_t position_of(const LineUnion& u, std::uint16_t idx) {
    if (u.specCount != 0 && idx >= u.specFirst &&
        idx < static_cast<std::uint16_t>(u.specFirst + u.specCount))
        return static_cast<std::uint32_t>(idx - u.specFirst);
    if (u.anyCount != 0 && idx >= u.anyFirst &&
        idx < static_cast<std::uint16_t>(u.anyFirst + u.anyCount))
        return u.specCount + static_cast<std::uint32_t>(idx - u.anyFirst);
    return u.total;
}

// Severity of a draining reserve: 0 outside the warning band, rising to 1 at empty.
// The band edge is needs.h's OWN constant, so speech and the survival clock cannot
// disagree about when a body is hungry.
float reserve_severity(float value, float warnAt) {
    if (warnAt <= 0.0f || value >= warnAt) return 0.0f;
    const float v = value < 0.0f ? 0.0f : value;
    return (warnAt - v) / warnAt;
}



// Severity of a rising pressure: 0 below the warning band, 1 at kNeedMax.
float pressure_severity(float value, float warnAt) {
    const float span = kNeedMax - warnAt;
    if (span <= 0.0f || value <= warnAt) return 0.0f;
    const float v = value > kNeedMax ? kNeedMax : value;
    return (v - warnAt) / span;
}

} // namespace

// ---------------------------------------------------------------------------

std::uint16_t speech_line_count(SpeechSituation s, std::uint16_t faction) {
    const LineUnion u = line_union(s, faction);
    return static_cast<std::uint16_t>(u.total);
}

std::uint16_t speech_line_index(NpcId speaker, SpeechSituation s,
                                std::uint16_t faction, std::uint32_t seed) {
    const LineUnion u = line_union(s, faction);
    if (u.total == 0) return kSpeechNoLine;  // generator-gated unreachable

    // The situation and faction go into the hash TOGETHER rather than as separate
    // rounds: one body's Ambient line and its Wounded line must be uncorrelated, or a
    // crowd would visibly shift as one when the floor's mood changed.
    const std::uint32_t key = static_cast<std::uint32_t>(s) |
                              (static_cast<std::uint32_t>(faction) << 8);
    const std::uint32_t h = hash3(speaker, key, seed);
    return at(u, rand_below(h, u.total));
}

const char* speech_text(std::uint16_t index) {
    // A generic line beats a mute body, and both beat a null dereference in the HUD's
    // format string. Ambient/ANY is the fallback because the generator guarantees it is
    // non-empty.
    if (index >= kSpeechLineCount)
        return kSpeechText[speech_bucket(SpeechSituation::Ambient, kSpeechAnySlot).first];
    return kSpeechText[index];
}

// ---------------------------------------------------------------------------

SpeechContext speech_context(const Registry& reg, const NpcPool& pool, NpcId speaker,
                             std::uint8_t samosborPhase) {
    SpeechContext c;
    c.samosborPhase = samosborPhase;

    // Same `const_cast` as below and as `dominant_faction` in rumour.cpp: NpcPool
    // exposes its SoA columns only through non-const references.
    NpcPool& p = const_cast<NpcPool&>(pool);
    if (p.valid(speaker)) {
        c.hp = p.hp(speaker);
        c.maxHp = p.max_hp(speaker);
        c.needs = p.needs(speaker);   // `seeded` travels with it, and gates the fallback
    }

    // The committed intent lives on the embodied entity, not the record. One linear
    // pass over the embodied set, at most once per kSpeechCooldownTicks.
    for (auto e : reg.view<const NpcRef, const AiBrain>()) {
        if (reg.get<const NpcRef>(e).id != speaker) continue;
        c.intent = reg.get<const AiBrain>(e).currentIntent;
        break;
    }
    return c;
}

SpeechSituation speech_situation(const SpeechContext& c) {
    // 1. The siren outranks everyone. [rumour.h] makes the same call for `Imminent`:
    //    a body standing in a corridor with the siren going does not gossip.
    if (c.samosborPhase == static_cast<std::uint8_t>(SamosborPhase::Warning))
        return SpeechSituation::Hide;
    if (c.samosborPhase == static_cast<std::uint8_t>(SamosborPhase::Active))
        return SpeechSituation::Fog;

    // 2. Events in progress, before states. Fighting and running are things HAPPENING;
    //    being hurt is a condition. Same strictly-decreasing-urgency rule [rumour.h]
    //    applies to its own override order.
    //
    //    Note what is NOT here: a danger-field threshold. `score_intents` already owns
    //    the danger -> flee mapping, so speech reads the DECISION. A second threshold
    //    here could disagree with the brain and produce a body calmly discussing bread
    //    while sprinting.
    if (c.intent == IntentCombat || c.intent == IntentFactionAssault)
        return SpeechSituation::Combat;
    if (c.intent == IntentFlee || c.intent == IntentSafety)
        return SpeechSituation::Fear;

    // 3. Hurt. Checked before the needs because blood outranks lunch.
    if (c.intent == IntentHeal) return SpeechSituation::Wounded;
    if (c.maxHp > 0 &&
        static_cast<float>(c.hp) <=
            static_cast<float>(c.maxHp) * kSpeechWoundedHpFrac)
        return SpeechSituation::Wounded;

    // 4. The fog has been and gone.
    if (c.samosborPhase == static_cast<std::uint8_t>(SamosborPhase::Aftermath))
        return SpeechSituation::After;

    // 5. Needs, from the committed intent first.
    switch (c.intent) {
        case IntentEat:    return SpeechSituation::Hunger;
        case IntentDrink:  return SpeechSituation::Thirst;
        case IntentSleep:  return SpeechSituation::Sleep;
        case IntentToilet: return SpeechSituation::Relief;
        default: break;
    }

    // 5b. ...and from the raw reserves when there is no brain to ask. `ai_step` is
    //     dormant by default, and a crowd with the brain off should still sound like
    //     bodies rather than furniture.
    //
    //     `seeded` is the gate, and it is not paranoia: an all-zero `Needs` reads as
    //     starving AND parched AND exhausted, which would peg the entire crowd on food
    //     lines. [ai.h] documents the same trap and substitutes a local roll; here the
    //     honest answer is "this body has no needs state, so it has nothing to say
    //     about needs".
    if (c.needs.seeded != 0) {
        float best = 0.0f;
        SpeechSituation pick = SpeechSituation::Ambient;
        // Ties break toward the lower situation index, matching `select_intent`'s
        // argmax rule — so a body equally hungry and thirsty is consistently hungry
        // rather than flickering between the two.
        const float sev[4] = {
            reserve_severity(c.needs.food, kFoodWarnAt),
            reserve_severity(c.needs.water, kWaterWarnAt),
            reserve_severity(c.needs.sleep, kSleepWarnAt),
            std::max(pressure_severity(c.needs.pee, kPeeWarnAt),
                       pressure_severity(c.needs.poo, kPooWarnAt)),
        };
        const SpeechSituation kMap[4] = {
            SpeechSituation::Hunger, SpeechSituation::Thirst,
            SpeechSituation::Sleep, SpeechSituation::Relief,
        };
        for (int i = 0; i < 4; ++i) {
            if (sev[i] > best) {
                best = sev[i];
                pick = kMap[i];
            }
        }
        if (best > 0.0f) return pick;
    }

    // 6. What it was doing.
    if (c.intent == IntentSocial) return SpeechSituation::Social;
    if (c.intent == IntentWork || c.intent == IntentPatrol)
        return SpeechSituation::Work;

    return SpeechSituation::Ambient;
}

// ---------------------------------------------------------------------------

const char* speech_say(SpeechMemory& mem, NpcId speaker, SpeechSituation s,
                       std::uint16_t faction, std::uint32_t seed,
                       std::uint16_t* outIndex) {
    const std::size_t slot =
        static_cast<std::size_t>(speaker) & (kSpeechMemorySlots - 1u);
    // `owner` holds speaker+1, so a zeroed table reads as empty rather than as
    // "speaker 0 last said line 0".
    const std::uint32_t tag = static_cast<std::uint32_t>(speaker) + 1u;
    const bool mine = mem.owner[slot] == tag;
    const std::uint16_t prev = mine ? mem.last[slot] : kSpeechNoLine;

    std::uint16_t idx = speech_line_index(speaker, s, faction, seed);
    if (idx == prev) {
        // One decorrelated re-roll, then a deterministic step. The step is what makes
        // the guarantee absolute instead of "usually different": with the union holding
        // more than one line, position+1 CANNOT be the position we came from.
        idx = speech_line_index(speaker, s, faction, seed ^ kRerollSalt);
        if (idx == prev) {
            const LineUnion u = line_union(s, faction);
            const std::uint32_t p = position_of(u, idx);
            if (u.total > 1 && p < u.total) idx = at(u, (p + 1u) % u.total);
        }
    }

    mem.owner[slot] = tag;
    mem.last[slot] = idx;
    if (outIndex != nullptr) *outIndex = idx;
    return speech_text(idx);
}

const char* speech_say(SpeechMemory& mem, const NpcPool& pool, NpcId speaker,
                       const SpeechContext& ctx, std::uint32_t seed,
                       SpeechSituation* outSituation) {
    // `const_cast` matches `dominant_faction` in rumour.cpp, for the same reason:
    // NpcPool exposes its SoA columns only through non-const references, so a
    // read-only consumer either casts or lies about its own signature. The cast is
    // the smaller lie, and it is confined to this line.
    NpcPool& p = const_cast<NpcPool&>(pool);
    const SpeechSituation s = speech_situation(ctx);
    if (outSituation != nullptr) *outSituation = s;
    const std::uint16_t fac = p.valid(speaker) ? p.faction(speaker) : static_cast<std::uint16_t>(Faction::Citizens);
    return speech_say(mem, speaker, s, fac, seed);
}

} // namespace giga::game
