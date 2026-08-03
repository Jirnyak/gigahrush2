#include "core/rng.h"
#include "game/rumour.h"

#include <cstdio>

#include "core/wrap.h"
#include "ecs/components.h"
#include "game/embody.h"     // NpcRef
#include "game/faction_relations.h"
#include "game/mob_spawn.h"  // MobRef
#include "game/samosbor.h"
#include "world/types.h"

namespace giga::game {

namespace {


// Which kinds actually spawned on this layer. Counted from the live registry rather
// than re-derived from the spawn tables, because the point of a threat rumour is that
// it is true of THIS floor as it currently stands — a mob that was killed before you
// arrived should not be gossip.
std::uint16_t sample_live_mob_kind(const Registry& reg, LayerId layer,
                                   std::uint32_t roll, std::uint32_t& countOut) {
    std::uint32_t seen = 0;
    std::uint16_t pick = 0xFFFFu;
    // Reservoir sampling, one pass, no allocation: the kth candidate replaces the
    // current pick with probability 1/k, which yields a uniform choice without
    // knowing the count up front or storing the candidates.
    for (auto e : reg.view<const MobRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        ++seen;
        if (roll % seen == 0) pick = reg.get<const MobRef>(e).kind;
        roll = hash_u32(roll);
    }
    countOut = seen;
    return pick;
}

} // namespace

// The dominant faction among embodied bodies on this layer.
//
// Body for body unchanged from the version that lived in the anonymous namespace above;
// only the linkage moved, so the Territory rumour keeps answering exactly what it did
// while `src/app/main.cpp` gains the ability to ask the same question. [rumour.h]
Faction dominant_faction(const Registry& reg, const NpcPool& pool, LayerId layer) {
    std::uint32_t tally[kFactionCount] = {};
    for (auto e : reg.view<const NpcRef, const Transform>()) {
        if (reg.get<const Transform>(e).layer != layer) continue;
        const NpcId id = reg.get<const NpcRef>(e).id;
        if (!const_cast<NpcPool&>(pool).valid(id)) continue;
        ++tally[body_row(pool, id)];
    }
    std::size_t best = 0;
    for (std::size_t i = 1; i < kFactionCount; ++i)
        if (tally[i] > tally[best]) best = i;
    return static_cast<Faction>(best);
}

NpcId nearest_speaker(const Registry& reg, LayerId layer) {
    // The listener.
    Entity ear = entt::null;
    vec3 earPos{0, 0, 0};
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        ear = e;
        earPos = t.pos;
        break;
    }
    if (ear == entt::null) return kInvalidNpc;

    NpcId best = kInvalidNpc;
    float bestD2 = kOverhearRange * kOverhearRange;
    for (auto e : reg.view<const NpcRef, const Transform>()) {
        if (e == ear) continue;                  // you do not overhear yourself
        const Transform& t = reg.get<const Transform>(e);
        if (t.layer != layer) continue;
        // Monsters are not embodied records and carry no NpcRef, so they cannot be
        // reached by this view at all — no explicit exclusion needed.
        const float dx = wrap_delta_f(earPos.x, t.pos.x, kWorldExtent);
        const float dy = wrap_delta_f(earPos.y, t.pos.y, kWorldExtent);
        const float dz = wrap_delta_f(earPos.z, t.pos.z, kWorldExtent);
        const float d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        best = reg.get<const NpcRef>(e).id;
    }
    return best;
}

Rumour rumour_for(const Registry& reg, const NpcPool& pool, NpcId speaker,
                  LayerId layer, int floorZ) {
    // The shim. A default SamosborState is phase Idle with count 0, which is exactly
    // the input for which the six-argument form reproduces the old five-way split
    // byte for byte. [rumour.h]
    return rumour_for(reg, pool, speaker, layer, floorZ, SamosborState{});
}

Rumour rumour_for(const Registry& reg, const NpcPool& pool, NpcId speaker,
                  LayerId layer, int floorZ, const SamosborState& sb) {
    Rumour r;
    if (!const_cast<NpcPool&>(pool).valid(speaker)) return r;

    // Deterministic in (speaker, floor): the same person always says the same thing
    // about the same floor. That is what makes a rumour read as something a body
    // KNOWS rather than as dice, and it means walking back to them repeats it.
    const std::uint32_t seed =
        hash_u32(speaker * 0x9e3779b9u ^ static_cast<std::uint32_t>(floorZ * 2654435761u));

    // **THE WARNING OVERRIDES EVERY SPEAKER, and it is the only override that ignores
    // the seed.** For 30 s the whole floor knows the same thing and it is the most
    // actionable sentence the crowd will ever produce, so a body carrying on about
    // crate prices during a siren would not be flavour — it would be the game hiding
    // its own most important beat behind a 25% roll. The variant is safe to name: the
    // Idle -> Warning branch of `samosbor_step` commits to it and rolls its duration
    // BEFORE raising the warning, precisely so the decision the player makes in these
    // seconds is about a variant that is already decided ([samosbor.h]).
    if (sb.phase == static_cast<std::uint8_t>(SamosborPhase::Warning)) {
        r.kind = RumourKind::Imminent;
        r.subject = sb.variant;
        // Round UP, the same way `samosbor_beat_text` does: a line that says "0 s" for
        // the last 999 ms is telling the player the window has shut while it is open.
        r.value = static_cast<std::int32_t>((sb.phaseMs + 999u) / 1000u);
        r.valid = true;
        return r;
    }

    // Which kind of thing this person talks about. Not uniform: a threat warning and
    // the fog schedule are the two most actionable, so they get the larger share.
    const std::uint32_t pick = seed % 100u;
    RumourKind kind;
    if (pick < 30) kind = RumourKind::Threat;
    else if (pick < 55) kind = RumourKind::Fog;
    else if (pick < 75) kind = RumourKind::Wealth;
    else if (pick < 90) kind = RumourKind::Territory;
    else kind = RumourKind::Depth;

    // The FOG slot is the one that follows the clock, and only that slot. The split is
    // not arbitrary: Fog is already the samosbor rumour — it reports this floor's duty
    // cycle — so a speaker who talks about the fog schedule when there is no fog is the
    // same speaker who should talk about THIS fog when there is one. Threat, Wealth,
    // Territory and Depth are facts about the floor and stay facts about the floor, so
    // 75% of the crowd remains a stable, re-checkable source.
    //
    // The band shares are therefore unchanged: no re-tuning, and no existing assertion
    // about the 30/25/20/15/10 split moves.
    if (kind == RumourKind::Fog) {
        if (sb.phase == static_cast<std::uint8_t>(SamosborPhase::Active)) {
            r.kind = RumourKind::Variant;
            r.subject = sb.variant;
            r.value = static_cast<std::int32_t>(sb.count);
            r.valid = true;
            return r;
        }
        // THE FOG IS CLOSE ENOUGH TO PLAN AROUND. Idle only, and that restriction is
        // the whole correctness of the line rather than a scoping preference:
        // `phaseMs` is the remainder of WHATEVER phase is running, so in Aftermath it
        // is that phase's own 12 s countdown and adding the warning window to it names
        // a moment a whole cooldown too early. That exact arithmetic already shipped
        // wrong once: `src/app/main.cpp` labelled the Aftermath remainder "to warning"
        // on the HUD and its own comment records that a screenshot caught it, not a
        // test. Demonstrated failure mode, not a hypothetical one.
        //
        // `phaseMs + kSamosborWarningMs` is EXACT and not an estimate: Warning is
        // carved out of the cooldown and Idle ends by entering it, so the Idle
        // remainder plus the whole 30 s window is the wall time until Active begins
        // ([samosbor.h] `samosbor_arm`). Compared in the subtracted form so a corrupt
        // `phaseMs` cannot wrap the sum — see `kRumourLullSpeakMs`.
        // `phaseTotalMs != 0` is not defensive padding, it is what keeps the
        // five-argument shim honest. A default `SamosborState` is phase Idle with
        // phaseMs == 0, so without this test the shim would report the fog as 30 s
        // away on a clock that was never armed — and `src/app/main.cpp` calls the shim
        // today, so it would be the LIVE behaviour, not a test artefact. Every armed
        // Idle has phaseTotalMs >= kSamosborArmFloorMs - kSamosborWarningMs (3 s),
        // because `samosbor_arm` clamps its argument, so the test costs nothing real.
        if (sb.phase == static_cast<std::uint8_t>(SamosborPhase::Idle) &&
            sb.phaseTotalMs != 0 &&
            sb.phaseMs <= kRumourLullSpeakMs - kSamosborWarningMs) {
            r.kind = RumourKind::Lull;
            // Round UP, the same way `Imminent` and `samosbor_beat_text` do. A
            // countdown that reads low lies in the one direction that costs the player
            // the decision it exists to enable.
            r.value = static_cast<std::int32_t>(
                (sb.phaseMs + kSamosborWarningMs + 999u) / 1000u);
            r.valid = true;
            return r;
        }
        // Bit 16 of the mixed seed, not `seed % 2`: the low bits are what `pick`
        // already consumed, so reusing them would correlate the Veteran half with the
        // band boundary. Still a pure function of (speaker, floor), so a given body
        // keeps its half for as long as the run's count keeps it eligible.
        if (sb.count > 0 && (seed & 0x00010000u) != 0u) {
            r.kind = RumourKind::Veteran;
            // The roster the count has ACTUALLY unlocked, asked of the same function
            // the fog spawner asks ([mob_spawn.h] samosbor_fog_roster). Two 69-row
            // scans of a cache-resident table, at most once every
            // kOverhearCooldownTicks (2 s) — the cheapest possible way to make a
            // rumour checkable, and checkable is this file's whole premise.
            const FogRoster roster =
                samosbor_fog_roster(floorZ, sb.count);
            r.subject = static_cast<std::uint16_t>(roster.n);
            r.value = static_cast<std::int32_t>(sb.count);
            r.valid = true;
            return r;
        }
    }

    switch (kind) {
        case RumourKind::Threat: {
            std::uint32_t live = 0;
            const std::uint16_t k =
                sample_live_mob_kind(reg, layer, hash_u32(seed ^ 0x11u), live);
            // Nothing alive to warn about: fall through to the fog, which is always
            // true. Emitting an empty threat line would be the one thing this system
            // must never do — say something false.
            //
            // Deliberately the DUTY-CYCLE form and not the clock-aware one, even mid
            // samosbor. This branch exists because the statement has to be true with no
            // preconditions at all, and the duty cycle is the only rumour in the file
            // that is a closed form of |z| — no registry, no clock, nothing to be empty.
            // Routing it through the Variant conversion would reintroduce a dependency
            // on exactly the state the fallback is here to not need.
            if (k == 0xFFFFu || live == 0) {
                r.kind = RumourKind::Fog;
                r.value = static_cast<std::int32_t>(
                    samosbor_duty01(floorZ) * 1000.0f);
                r.valid = true;
                return r;
            }
            r.kind = RumourKind::Threat;
            r.subject = k;
            r.value = static_cast<std::int32_t>(live);
            r.valid = true;
            return r;
        }
        case RumourKind::Fog:
            r.kind = kind;
            // Per-mille, so the integer keeps a floor's 1.6% distinguishable from
            // another's 10.0% without carrying a float through a POD.
            r.value = static_cast<std::int32_t>(samosbor_duty01(floorZ) * 1000.0f);
            r.valid = true;
            return r;
        case RumourKind::Wealth:
            r.kind = kind;
            r.value = kLootValueCap[economy_band(floorZ)];
            r.valid = true;
            return r;
        case RumourKind::Territory:
            r.kind = kind;
            r.subject =
                static_cast<std::uint16_t>(dominant_faction(reg, pool, layer));
            r.valid = true;
            return r;
        case RumourKind::Depth:
        default:
            r.kind = RumourKind::Depth;
            // The speaker's own read on how deep is survivable, anchored on where the
            // duty cycle crosses half — which is a real threshold, not a mood.
            r.value = floorZ < 0 ? -34 : 34;
            r.valid = true;
            return r;
    }
}

bool rumour_text(const Rumour& r, char* out, std::size_t cap) {
    if (!r.valid || !out || cap < 160) return false;
    switch (r.kind) {
        case RumourKind::Threat:
            std::snprintf(out, cap,
                          "\xd0\xa2\xd1\x83\xd1\x82 \xd0\xb2\xd0\xbe\xd0\xb4\xd0\xb8"
                          "\xd1\x82\xd1\x81\xd1\x8f %s. \xd0\x98\xd1\x85 %d.",
                          mob_name(static_cast<MobKind>(r.subject)),
                          static_cast<int>(r.value));
            return true;
        case RumourKind::Fog: {
            // Three bands, because the useful information is "often / sometimes /
            // almost always" rather than a percentage nobody can act on.
            const char* how =
                r.value < 100
                    ? "\xd1\x80\xd0\xb5\xd0\xb4\xd0\xba\xd0\xbe"          // rarely
                    : (r.value < 500
                           ? "\xd1\x87\xd0\xb0\xd1\x81\xd1\x82\xd0\xbe"   // often
                           : "\xd0\xbf\xd0\xbe\xd1\x87\xd1\x82\xd0\xb8 "
                             "\xd0\xb2\xd1\x81\xd0\xb5\xd0\xb3\xd0\xb4\xd0\xb0");
            std::snprintf(out, cap,
                          "\xd0\xa1\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1\xd0\xbe"
                          "\xd1\x80 \xd0\xb7\xd0\xb4\xd0\xb5\xd1\x81\xd1\x8c %s "
                          "(%d.%d%%).",
                          how, static_cast<int>(r.value) / 10,
                          static_cast<int>(r.value) % 10);
            return true;
        }
        case RumourKind::Wealth:
            std::snprintf(out, cap,
                          "\xd0\xa5\xd0\xbe\xd1\x80\xd0\xbe\xd1\x88\xd0\xb5\xd0\xb5 "
                          "\xd0\xb7\xd0\xb4\xd0\xb5\xd1\x81\xd1\x8c \xd0\xb8\xd0\xb4"
                          "\xd1\x91\xd1\x82 \xd0\xb4\xd0\xbe %d \xd1\x80\xd1\x83\xd0"
                          "\xb1.",
                          static_cast<int>(r.value));
            return true;
        case RumourKind::Territory:
            std::snprintf(out, cap,
                          "\xd0\xad\xd1\x82\xd0\xbe\xd1\x82 \xd1\x8d\xd1\x82\xd0\xb0"
                          "\xd0\xb6 \xd0\xb4\xd0\xb5\xd1\x80\xd0\xb6\xd0\xb0\xd1\x82"
                          " %s.",
                          faction_name(static_cast<Faction>(r.subject)));
            return true;
        case RumourKind::Imminent:
            // "Через %d с самосбор: %s. Беги к герме."
            //
            // Abbreviated "с" and not "секунд" for a reason that is grammar rather than
            // space: Russian numerals decline, so "через 1 секунд" / "через 3 секунды" /
            // "через 30 секунд" would need three forms and a selector for a HUD line.
            // The abbreviation is invariant, and the same trick is why every other new
            // line here ends its clause on a number instead of on a noun.
            std::snprintf(out, cap,
                          "\xd0\xa7\xd0\xb5\xd1\x80\xd0\xb5\xd0\xb7 %d \xd1\x81 "
                          "\xd1\x81\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1\xd0\xbe"
                          "\xd1\x80: %s. \xd0\x91\xd0\xb5\xd0\xb3\xd0\xb8 \xd0\xba "
                          "\xd0\xb3\xd0\xb5\xd1\x80\xd0\xbc\xd0\xb5.",
                          static_cast<int>(r.value),
                          samosbor_variant_name_ru(
                              static_cast<SamosborVariant>(r.subject)));
            return true;
        case RumourKind::Variant:
            // "Идёт %s: %s." — the display name plus the one clause on what it does.
            // Both come out of [samosbor.h], so the crowd and the HUD alarm name the
            // same variant with the same word; two spellings of "maronary" reaching the
            // player is the drift a shared table exists to stop.
            std::snprintf(out, cap, "\xd0\x98\xd0\xb4\xd1\x91\xd1\x82 %s: %s.",
                          samosbor_variant_name_ru(
                              static_cast<SamosborVariant>(r.subject)),
                          samosbor_variant_effect_ru(
                              static_cast<SamosborVariant>(r.subject)));
            return true;
        case RumourKind::Veteran:
            // "Самосборов %d. Тварей из тумана уже %d."
            //
            // Both numbers are load-bearing and both are checkable against the HUD: the
            // first is the run's `count`, the second the fog roster that count unlocked.
            // Measured at ZMinus50 the pair walks 0/3 -> 3/9 -> 4/14 -> 7/16, so a
            // player who hears it twice twenty minutes apart has been told, in words,
            // that surviving samosbors is what makes the fog worse.
            std::snprintf(out, cap,
                          "\xd0\xa1\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1\xd0\xbe"
                          "\xd1\x80\xd0\xbe\xd0\xb2 %d. \xd0\xa2\xd0\xb2\xd0\xb0"
                          "\xd1\x80\xd0\xb5\xd0\xb9 \xd0\xb8\xd0\xb7 \xd1\x82\xd1"
                          "\x83\xd0\xbc\xd0\xb0\xd0\xbd\xd0\xb0 \xd1\x83\xd0\xb6"
                          "\xd0\xb5 %d.",
                          static_cast<int>(r.value), static_cast<int>(r.subject));
            return true;
        case RumourKind::Lull:
            // Two forms, one case, and the split is at 90 s rather than 60 because a
            // countdown that flips to "1 мин" the instant it passes a minute throws away
            // the resolution exactly where the player needs it. Under 90 s the seconds
            // are the decision; above them the minutes are.
            //
            // "мин" and "с" are invariant abbreviations, so neither form needs the three
            // declined plural stems a spelled-out Russian numeral would — the same reason
            // `Imminent` above abbreviates. Minutes round UP as well, so 4:20 reads
            // "5 мин" and never "4".
            if (r.value < 90)
                // "Самосбор через %d с. Иди к герме." — 54 B of literal.
                std::snprintf(out, cap,
                              "\xd0\xa1\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1"
                              "\xd0\xbe\xd1\x80 \xd1\x87\xd0\xb5\xd1\x80\xd0"
                              "\xb5\xd0\xb7 %d \xd1\x81. \xd0\x98\xd0\xb4\xd0"
                              "\xb8 \xd0\xba \xd0\xb3\xd0\xb5\xd1\x80\xd0\xbc"
                              "\xd0\xb5.",
                              static_cast<int>(r.value));
            else
                // "Самосбор через %d мин. Время ещё есть." — 64 B, the ceiling.
                std::snprintf(out, cap,
                              "\xd0\xa1\xd0\xb0\xd0\xbc\xd0\xbe\xd1\x81\xd0\xb1"
                              "\xd0\xbe\xd1\x80 \xd1\x87\xd0\xb5\xd1\x80\xd0"
                              "\xb5\xd0\xb7 %d \xd0\xbc\xd0\xb8\xd0\xbd. \xd0"
                              "\x92\xd1\x80\xd0\xb5\xd0\xbc\xd1\x8f \xd0\xb5"
                              "\xd1\x89\xd1\x91 \xd0\xb5\xd1\x81\xd1\x82\xd1"
                              "\x8c.",
                              static_cast<int>((r.value + 59) / 60));
            return true;
        case RumourKind::Depth:
        default:
            std::snprintf(out, cap,
                          "\xd0\x93\xd0\xbb\xd1\x83\xd0\xb1\xd0\xb6\xd0\xb5 %d "
                          "\xd0\xbd\xd0\xb5 \xd0\xb2\xd0\xbe\xd0\xb7\xd0\xb2\xd1\x80"
                          "\xd0\xb0\xd1\x89\xd0\xb0\xd1\x8e\xd1\x82\xd1\x81\xd1\x8f.",
                          static_cast<int>(r.value));
            return true;
    }
}

} // namespace giga::game
