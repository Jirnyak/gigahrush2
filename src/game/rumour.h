// Rumours — what the crowd knows, and the first reason it exists.
//
// A floor carries up to 420 walking bodies and until now every one of them was
// scenery: they wandered, they could be killed, and they told you nothing. The
// building was populated and mute.
//
// **The reference has 582 authored rumours and NOT ONE of them does anything.** Its
// `RumorReveal` is a rich schema that only picks which line gets spoken and appends a
// parenthetical; `describeRumorReveal` is exported with zero callers. Quests in that
// game reveal the map — rumours never do. So this is not a port. It is the thing the
// authored volume was pointing at and never reached.
//
// The rule here is the opposite one: **a rumour must be TRUE and CHECKABLE.** Every
// line is derived from live state — what actually spawned on this floor, what the loot
// cap actually is, what the samosbor clock actually says — so acting on one pays off
// and ignoring one costs. A rumour that is only flavour is a rumour the player learns
// to skip, and then the crowd is scenery again with extra steps.
//
// Deliberately NO interaction verb. An audit established the game has no talk key, no
// NPC targeting, and no dialogue system; building three of those to deliver one line
// of text would be the expensive way round. Instead the nearest body speaks when you
// come close enough, the way an overheard remark works in a corridor — which is also
// how a crowd should feel.
#pragma once

#include <cstdint>

#include "core/math.h"
#include "core/tick.h"
#include "ecs/registry.h"
#include "game/faction.h"
#include "game/item_table.h"
#include "game/mob_table.h"
#include "game/npc_pool.h"
#include "game/samosbor.h"   // SamosborState — the clock the samosbor kinds read
#include "world/level_stack.h"

namespace giga::game {

// What a rumour is about. Each kind is backed by a different piece of live state, and
// each one is worth acting on — that is the selection criterion, not variety.
enum class RumourKind : std::uint8_t {
    // "There is a <mob> on this floor." Names a kind that ACTUALLY spawned here, so
    // it is a threat warning you can verify by walking into it.
    Threat = 0,
    // "The good stuff down here goes for <N> roubles." The floor's real economy band
    // cap, which is the single number that decides whether descending is worth it.
    Wealth,
    // "The fog comes often here" / "rarely". Derived from the floor's samosbor duty,
    // which spans 1.6% to 93.8% across the stack — the most useful thing anyone
    // could tell you before you commit to a floor.
    Fog,
    // "The <faction> hold this floor." The dominant faction in the live population,
    // counted rather than authored — and it matters, because monsters ignore one of
    // them ([faction_relations.h]).
    Territory,
    // "Deeper than <N> and you do not come back." Names the deepest floor the
    // speaker's own faction is known to reach; a soft route hint.
    Depth,

    // --- the samosbor half. Driven by the LIVE clock rather than by the floor -----
    //
    // The five kinds above are all facts about a FLOOR, which is why they are
    // deterministic in (speaker, floor) and never change while you stand there. These
    // four are facts about the samosbor happening RIGHT NOW, so they move with it —
    // and that is the point. The crowd is the only channel in the game that can tell
    // you what a variant does before it does it, and a resident who has lived through
    // three samosbors knowing nothing about the fourth was the crowd being scenery
    // again with extra steps.
    //
    // Appended, never inserted, so the five existing values keep their numbers.

    // "In <N> s, samosbor: <variant>. Run for the seal." Fires during the WARNING phase
    // for every speaker, because a body standing in a corridor with the siren going
    // does not gossip about loot prices. `value` is seconds until impact, `subject` the
    // SamosborVariant already committed to by `samosbor_step`.
    Imminent,
    // "<variant> is running: <what it does>." Fires during the ACTIVE phase, and it is
    // the only place the game states a variant's effect in words — the difference
    // between maronary and veretar is otherwise invisible until it has already happened
    // to your inventory. `subject` is the variant, `value` the run's samosbor count.
    Variant,
    // "<N> samosbors so far. <M> kinds come out of the fog now." Both numbers are real:
    // `value` is `SamosborState::count` and `subject` is `samosbor_fog_roster(...).n`,
    // the size of the roster that count has actually unlocked ([mob_spawn.h]). This is
    // the one rumour that makes the `minSamosbor` progression axis visible — measured at
    // ZMinus50 the roster is 3 kinds at count 0 and 16 at count 7, and nothing else in
    // the game says so.
    Veteran,
    // "Samosbor in <N>." Fires in IDLE, and only when the wait is short enough to be a
    // decision — see `kRumourLullSpeakMs`. `value` is seconds until the fog lands
    // (Idle remainder plus the whole warning window), `subject` unused.
    //
    // **This is the phase the crowd had nothing to say about, and it is the phase where
    // being told is worth most.** `Imminent` starts at the siren, by which point the
    // route decision is already a sprint; the four floor facts and the duty-cycle line
    // are all true forever and so carry no urgency at all. A body that says "two
    // minutes" is the only channel in the game that turns the clock into a plan: finish
    // the crate or leave it, take the corridor or the stairwell.
    //
    // It is also the one rumour whose FREQUENCY is depth-scaled without a depth term
    // anywhere in it, which is this file's own trick and worth stating. At |z| = 50 the
    // whole Idle phase is 3..33 s (`samosbor_enter_floor`), so the threshold is never
    // not met and the crowd warns you continuously. At z = 0 Idle runs ~22..38 min, so
    // the same threshold speaks in only the last ~13-22% of it and the surface stays
    // quiet. One constant, two behaviours, no `if (deep)`.
    Lull,
    Count
};

// One overheard line. POD, no pointers, no allocation — it is built on demand from
// world state and thrown away, never stored per NPC.
struct Rumour {
    RumourKind kind = RumourKind::Threat;
    // The subject: a MobKind for Threat, a Faction for Territory, a floor for Depth, a
    // SamosborVariant for Imminent and Variant, a fog-roster size for Veteran.
    // Unused for Wealth, Fog and Lull, which carry their number in `value`.
    std::uint16_t subject = 0;
    std::int32_t value = 0;
    bool valid = false;
};

// How close you must be to overhear, metres. Wider than melee reach and narrower than
// the aggro radius on purpose: you should catch remarks while walking past a group,
// not sweep the whole floor from a doorway.
inline constexpr float kOverhearRange = 6.0f;

// Cooldown between overheard lines, in sim ticks. Without one, standing in a crowd
// would replace the line every frame and none of them would be readable — the system
// would produce a flicker rather than information.
//
// Derived from kSimHz rather than written out. It was a literal 240 documented as "2 s
// at 120 Hz", and the sim has run at 125 Hz since [core/tick.h] — so the constant was
// really 1.92 s and the comment was a rate the game does not have. That is the exact
// class of drift tick.h exists to kill.
inline constexpr std::uint32_t kOverhearCooldownTicks =
    2u * static_cast<std::uint32_t>(kSimHz);   // 250 ticks = 2 s, exactly

// How close the next samosbor has to be before the crowd starts counting it down
// (`RumourKind::Lull`). Wall time until the fog lands, warning window included.
//
// AUTHORED, and the number is a decision horizon rather than a tuning dial: 5 minutes is
// about one room cleared, one crate emptied and one corridor walked at 6 m/s, so it is
// the shortest wait at which "finish this or leave now" is still a real choice. Shorter
// and the line arrives after the decision; much longer and it is background noise on
// every shallow floor, which is how a rumour becomes something the player skips.
//
// Stated in ms against `SamosborState::phaseMs`, and deliberately NOT in ticks: this is
// a duration in seconds, and the sim's tick rate is not allowed to change what it means
// ([core/tick.h]).
inline constexpr std::uint32_t kRumourLullSpeakMs = 5u * 60u * 1000u;
// The predicate is written `phaseMs <= kRumourLullSpeakMs - kSamosborWarningMs` and not
// `phaseMs + kSamosborWarningMs <= kRumourLullSpeakMs`, so that a corrupt or truncated
// `phaseMs` near UINT32_MAX cannot wrap the addition into a small number and make a
// 49-day wait read as imminent. The subtraction is compile-time; this is what keeps it
// from being the underflow instead.
static_assert(kRumourLullSpeakMs > kSamosborWarningMs,
              "the lull horizon must be longer than the warning window it contains");

// The dominant faction among the embodied bodies on `layer`, counted rather than
// authored. Ties break toward the lower Faction value; an empty layer answers
// Citizens, which is also the default vendor.
//
// **Exported because the Territory rumour was not its only consumer — it was just the
// only one that could reach it.** This lived in rumour.cpp's anonymous namespace, so
// `src/app/main.cpp` had no way to ask which faction holds a floor, and
// `VendorKind` therefore stayed on Citizen forever: two of its three sell rates were
// dead constants ([vendor.h]). Paired with `vendor_kind_for` on ALL THREE floor
// arrival paths (lift, load, --shot), the rumour becomes information you can act
// on — walk into a Scientist floor and the same haul is worth 8% more.
//
// O(bodies on the layer), one pass, no allocation. Called on arrival, never per tick.
Faction dominant_faction(const Registry& reg, const NpcPool& pool, LayerId layer);

// Build the rumour a given speaker would tell, from live state and the live samosbor
// clock.
//
// Deterministic in (speakerId, floorZ) **while the clock is quiet**: the same person
// says the same thing about the same floor, so a rumour reads as something that body
// KNOWS rather than as dice, and walking back to them repeats it.
//
// THE CLOCK IS THE ONE EXCEPTION, and it is deliberate rather than a hole in the
// contract. Two overrides, both stated here so a caller does not have to read the .cpp
// to know when the promise holds:
//
//   1. **Warning phase overrides everyone.** Every speaker answers `Imminent`. The
//      determinism that matters during a 30 s siren is "everybody tells you the same
//      urgent thing", not "this one still has an opinion about crate prices".
//   2. **The Fog slot follows the clock, and only that slot.** The 25% of speakers
//      whose deterministic pick is `Fog` answer, in priority order: `Variant` while the
//      samosbor is Active; `Lull` while it is Idle and the fog is within
//      `kRumourLullSpeakMs`; `Veteran` on half of the rest (by a seed bit, so it is
//      still per-speaker stable) once the run has a non-zero `count`; and otherwise the
//      floor's duty cycle, unchanged. The other four slots — Threat, Wealth, Territory,
//      Depth — are untouched, so the four rumours that are genuinely floor facts stay
//      floor facts and 75% of the crowd remains a stable, re-checkable source.
//
//      The ORDER is the design, not an implementation detail. An event in progress
//      outranks one that is coming, which outranks a statistic about the run, which
//      outranks a statistic about the floor — i.e. strictly decreasing urgency, so a
//      speaker never volunteers the less actionable of two true things.
//
// All overrides are still TRUE and CHECKABLE, which is this file's actual rule: the
// seconds count down with the clock, the variant is the one `samosbor_step` has already
// committed to, the Lull countdown is the same `phaseMs` the HUD prints, and the Veteran
// roster size is `samosbor_fog_roster`'s own answer for the same floor and count the
// spawner will use.
Rumour rumour_for(const Registry& reg, const NpcPool& pool, NpcId speaker,
                  LayerId layer, int floorZ, const SamosborState& sb);

// The clock-free form, kept so the existing call site keeps compiling unchanged.
//
// **It is a compatibility shim, not the one to call.** It passes a default-constructed
// `SamosborState` — phase Idle, count 0, `phaseTotalMs` 0 — which makes all four
// samosbor kinds unreachable: Idle is not Warning so `Imminent` never fires, not Active
// so `Variant` never fires, count 0 fails `Veteran`'s own gate, and `Lull` additionally
// requires `phaseTotalMs != 0`. Behaviour is therefore byte-identical to what this
// function did before the samosbor kinds existed, which is the point: a caller that
// forgets to pass the clock loses the new lines silently rather than getting wrong ones.
//
// That last clause is the one that needed work rather than a comment. `Lull` fires on a
// SHORT Idle remainder, and a default state's remainder is zero — the shortest there
// is — so the obvious predicate would have made a never-armed clock the most urgent
// state in the machine and told 25% of the crowd the fog was 30 s out. `src/app/main.cpp`
// calls THIS overload today, so that would have shipped. `test_samosborhud_all` pins the
// shim against all four kinds rather than trusting the reasoning.
Rumour rumour_for(const Registry& reg, const NpcPool& pool, NpcId speaker,
                  LayerId layer, int floorZ);

// The nearest speaker within kOverhearRange of the camera holder, or kInvalidNpc.
// Skips the camera holder itself and anything not embodied on this layer.
NpcId nearest_speaker(const Registry& reg, LayerId layer);

// Render a rumour into `out` as a Russian sentence. Returns false when the rumour is
// invalid, in which case `out` is untouched.
//
// Bounded, no allocation, no exceptions. `out` must be at least 160 bytes.
//
// 160 still holds with the samosbor kinds, MEASURED rather than assumed: `Variant` is
// the longest at 121 bytes (12 of literal, plus 41 for the longest display name
// "Красный биологический", plus 68 for the longest effect clause), `Imminent` is 101,
// `Veteran` 69 and `Lull` 65 in its longest ("мин") form: 64 of literal plus one
// digit, since `kRumourLullSpeakMs` caps the minute count at 5. The pre-existing
// `Threat` line is the real ceiling — a monster name out
// of `kMobTable` is unbounded from this file's point of view — and it was already living
// with snprintf's truncation, which is why 160 is a floor on `cap` and not a promise
// that nothing ever truncates.
bool rumour_text(const Rumour& r, char* out, std::size_t cap);

} // namespace giga::game
