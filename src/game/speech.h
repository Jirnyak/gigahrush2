// Speech — the crowd's own voice, as opposed to what the crowd KNOWS.
//
// ## Why this is a sibling of `rumour.h` and not an extension of it
//
// [rumour.h] states its own rule in capitals: **a rumour must be TRUE and CHECKABLE**,
// and "a rumour that is only flavour is a rumour the player learns to skip, and then
// the crowd is scenery again with extra steps." All nine `RumourKind`s are backed by
// live state whose value is *actionable* — a mob kind that really spawned, the floor's
// real loot cap, the samosbor clock's real remainder.
//
// This file is the other half, and it is deliberately the OPPOSITE category: a body
// saying something in character, with no claim to verify. Routing flavour through
// `rumour_for` would have broken rumour's own contract and devalued the one channel
// the player has learned to trust — so the two are separate on purpose, not by
// oversight. The anti-duplication rule that keeps them from becoming two systems for
// one job is mechanical and testable:
//
//   **A speech line never states a checkable number.** No price, no count, no
//   distance, no countdown, no floor label. `data/speech_lines.csv` contains no digit
//   in any line, and `test_speech_all` asserts it byte-wise. If a line would carry a
//   number, it belongs in `rumour.h`.
//
// The structural half of the same firewall is the situation axis below: every one of
// the thirteen is a fact about the SPEAKER (its needs, its health, what it is doing) or
// about the phase of the samosbor happening to it — never a fact about the FLOOR, which
// is what all five of rumour's original kinds are. The two systems therefore cannot
// answer the same question even in principle, which is a stronger guarantee than the
// digit gate, and the reason to reject any future situation named after a floor
// property.
//
// They are also consumed on different channels, which is what stops them competing for
// the same HUD slot: `rumour_for` answers "walk up to the nearest body and hear a
// fact" (one line, `kOverhearCooldownTicks`), while `speech_say` is the murmur of
// whoever happens to be next to you, on its own faster `kSpeechCooldownTicks` clock.
//
// ## Why a context-tagged line bank and not the reference's Markov stack
//
// The reference ships eleven speech modules plus `src/data/markov_compiled_matrix.ts`
// — **16 MB** of pre-compiled n-grams — and its own design doc (`markov.md`) rules
// out the naive form outright: "общий корпус -> Markov -> вся фраза" produces
// "ложные факты, случайная поэзия и одинаковый голос". What it mandates instead is
// template-first with the chain confined to a single agreed slot, policed by five
// validators (grounded-fact, class-path-terminal, repeated-bigram, tone blacklist,
// spoiler).
//
// And its actual shipped CONTENT — `CONTEXT_BARK_FACTION_AMBIENT`, `…_HIDE`,
// `…_WOUNDED`, `CONTEXT_BARK_{HUNGER,THIRST,WOUNDED,FEAR,SAMOSBOR_HIDE}` — is already
// a **(situation x faction) tagged line bank**. The Markov layer sits on top of that
// bank as a rephraser. So the design ports as: take the AXES and the CONTENT, and
// re-implement the MECHANISM as a flat indexed bank. That is one array of `const
// char*`, one 13x6 bucket table, one hash, no allocation, and it cannot emit a false
// fact or broken grammar because there is nothing to assemble.
//
// **What is given up, stated plainly:** no novel sentences. A speaker draws from an
// authored pool, so a (situation, faction) cell with N lines repeats after N. That is
// a content problem — add CSV rows — not an architecture problem. The trade the other
// way would have been 16 MB of matrix, an offline compiler, and five validators to
// stop the chain lying, in a codebase whose whole rumour system exists because the
// reference's 582 authored rumours did nothing.
//
// ## Determinism
//
// The pick is a pure function of `(speaker, situation, faction, seed)` over the
// stateless `hash3` in [core/rng.h]. No stored RNG, no allocation, no per-run drift —
// the same body in the same state says the same thing, which is what makes a line read
// as something that person WOULD say rather than as dice. The one piece of state is
// `SpeechMemory`, a fixed 512-byte anti-repeat cache the caller owns.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "core/tick.h"       // kSimHz — the cooldown is derived, never written out
#include "ecs/registry.h"    // Registry — speech_context resolves NpcId -> Entity
#include "game/faction.h"    // Faction / kFactionCount — the bank's second axis
#include "game/npc_pool.h"   // NpcId, Needs

namespace giga::game {

// ---------------------------------------------------------------------------
// The situation axis — what a body is talking about.
//
// Chosen to match the reference's own shipped pools rather than invented: AMBIENT ..
// COMBAT map one-to-one onto `CONTEXT_BARK_*`, HIDE/FOG/AFTER onto the three samosbor
// phases this engine actually has ([samosbor.h]), and SLEEP/RELIEF onto the two needs
// the reference simulates (`needs.ts`) but never gave a bark pool.
//
// Order is load-bearing twice: it is the generated bucket table's major index, and
// `speech_situation` resolves top-down by URGENCY, so reordering changes what a body
// in two states at once chooses to say.
// ---------------------------------------------------------------------------
enum class SpeechSituation : std::uint8_t {
    Ambient = 0, // nothing in particular — the bulk of a living floor
    Hunger,      // food reserve low / IntentEat
    Thirst,      // water reserve low / IntentDrink
    Sleep,       // sleep reserve low / IntentSleep
    Relief,      // pee/poo pressure high / IntentToilet
    Wounded,     // hp below kSpeechWoundedHpFrac / IntentHeal
    Fear,        // IntentFlee / IntentSafety — running from the danger field
    Combat,      // IntentCombat / IntentFactionAssault
    Hide,        // SamosborPhase::Warning — the siren is going
    Fog,         // SamosborPhase::Active — it is happening now
    After,       // SamosborPhase::Aftermath
    Social,      // IntentSocial
    Work,        // IntentWork / IntentPatrol
    Count
};
inline constexpr std::size_t kSpeechSituationCount =
    static_cast<std::size_t>(SpeechSituation::Count);
static_assert(kSpeechSituationCount == 13,
              "the bucket table's major dimension is generated against this");

// The faction axis is `kFactionCount` real slots plus one wildcard. A pick for
// (situation, faction) draws from the union of the faction's own lines and the
// wildcard's, which is why a faction with no authored line for a situation is never
// mute — it simply speaks the common register.
inline constexpr std::uint8_t kSpeechAnySlot = static_cast<std::uint8_t>(kFactionCount);
inline constexpr std::size_t kSpeechFactionSlots = kFactionCount + 1u;

// Row count of `data/speech_lines.csv`. The `source_rules` ctest compares the two and
// fails on drift, the same way it guards `kItemCount` — see the note at the bottom of
// this file for the exact registration line.
inline constexpr std::size_t kSpeechLineCount = 284;

// Half health. AUTHORED, and deliberately not derived from the AI: `IntentHeal`'s
// score in ai.cpp crosses its own 58-point emergency override at hp/maxHp ~ 0.45, but
// that 105 coefficient is a private constant in another translation unit and coupling
// to it would drift silently. 0.5 speaks slightly BEFORE the brain declares a medical
// emergency, which is the right order: you say "меня задело" and then you go looking
// for a bandage.
inline constexpr float kSpeechWoundedHpFrac = 0.5f;

// How often the murmur turns over. Derived from `kSimHz`, never written out — the
// literal-240-documented-as-"2 s at 120 Hz" drift [rumour.h] records is exactly the
// mistake [core/tick.h] exists to prevent.
//
// 3 s, deliberately NOT rumour's 2 s: if the two HUD lines turned over on the same
// clock they would read as one system flickering rather than two channels.
inline constexpr std::uint32_t kSpeechCooldownTicks =
    3u * static_cast<std::uint32_t>(kSimHz);   // 375 ticks = 3 s, exactly
// The assertion that actually says something: 375 ticks must be three WHOLE seconds of
// integer game-milliseconds. `kSpeechCooldownTicks % 3 == 0` would have been vacuous —
// `3*n` is divisible by 3 for every n — and a vacuous assert is worse than none,
// because it reads as a checked invariant.
static_assert(kSpeechCooldownTicks * static_cast<std::uint32_t>(kSimStepMs) == 3000u,
              "the speech cooldown must be a whole number of game-milliseconds");

// ---------------------------------------------------------------------------
// The generated bank ([speech_table.cpp], from data/speech_lines.csv).
//
// `kSpeechText` is sorted by (situation, factionSlot) with the wildcard last, so every
// (situation, faction) pair is TWO contiguous ranges and the pick needs no
// materialised index list. Dense over sparse, and the whole lookup is two array reads.
// ---------------------------------------------------------------------------
struct SpeechBucket {
    std::uint16_t first;  // index into kSpeechText
    std::uint16_t count;  // 0 is legal for a faction slot, never for the wildcard
};
static_assert(sizeof(SpeechBucket) == 4, "bucket row must stay 4 bytes");

extern const std::array<const char*, kSpeechLineCount> kSpeechText;
extern const std::array<SpeechBucket, kSpeechSituationCount * kSpeechFactionSlots>
    kSpeechBuckets;

// Row-major: [situation][factionSlot]. Bounds-tolerant, mirroring `item_def`.
const SpeechBucket& speech_bucket(SpeechSituation s, std::uint8_t factionSlot);

// How many lines a (situation, faction) pair can draw from — faction-specific plus
// wildcard. Never 0: the generator refuses a situation with no wildcard line, so no
// speaker is ever mute. Exported because that is a property tests must be able to
// check per cell rather than infer.
std::uint16_t speech_line_count(SpeechSituation s, std::uint16_t faction);

// Human-readable situation name, for the HUD and for test failure messages. ASCII.
const char* speech_situation_name(SpeechSituation s);

// ---------------------------------------------------------------------------
// The pick.
// ---------------------------------------------------------------------------

// Sentinel for "no line" — returned only if the bank were empty for a situation,
// which the generator's gate makes unreachable.
inline constexpr std::uint16_t kSpeechNoLine = 0xFFFFu;

// Pure, allocation-free, deterministic in all four arguments. Index into `kSpeechText`.
std::uint16_t speech_line_index(NpcId speaker, SpeechSituation s,
                                std::uint16_t faction, std::uint32_t seed);

// The line at `index`. Never null: an out-of-range index answers the first Ambient
// wildcard line rather than a null pointer, because a mute body is worse than a
// generic one and a crash is worse than both.
const char* speech_text(std::uint16_t index);

// ---------------------------------------------------------------------------
// SpeechContext — the state a line is chosen from. POD, built on demand.
//
// **A default-constructed context answers `Ambient`, and that is deliberate.** All
// zeros in `Needs` means "never rolled" ([npc_pool.h] `seeded`), which would otherwise
// read as starving-and-parched and peg the whole crowd on food lines — the same trap
// [ai.h] documents for an unseeded row and [rumour.h] documents for a default
// `SamosborState`. So the needs branch is gated on `needs.seeded`.
// ---------------------------------------------------------------------------
struct SpeechContext {
    // `AiBrain::currentIntent` (an `IntentId`) or `kIntentNone`. speech.cpp
    // static_asserts the enumerator values it switches on, so a reorder in ai.h is a
    // compile error here rather than a crowd quietly saying the wrong thing.
    std::uint8_t intent = 0xFFu;
    // `SamosborPhase`. 0 == Idle, which is what a caller with no clock should pass.
    std::uint8_t samosborPhase = 0;
    std::int16_t hp = 1;
    std::int16_t maxHp = 1;
    Needs needs{};
};

// Build the context for `speaker` from live state, so a caller does not have to know
// which half of the engine owns which field: health and the survival clock are `NpcPool`
// columns, the committed intent is an `AiBrain` on the embodied entity, and the phase is
// the caller's per-floor `SamosborState::phase`.
//
// One O(embodied bodies) scan to resolve NpcId -> Entity. That is affordable precisely
// because this is called at most once per `kSpeechCooldownTicks` from one proximity
// sweep — never per body per tick. A speaker with no `AiBrain` (brain dormant, or a
// record embodied before `ai_init` ran) gets `kIntentNone`, and `speech_situation`
// falls back to the raw reserves.
SpeechContext speech_context(const Registry& reg, const NpcPool& pool, NpcId speaker,
                             std::uint8_t samosborPhase);

// Resolve the situation, top-down by urgency.
//
// The ORDER is the design, and it is the same rule [rumour.h] states for its own
// overrides: **an event in progress outranks a state**, so a speaker never volunteers
// the less immediate of two true things. Sirens first (nobody gossips through a siren),
// then fighting and fleeing, then being hurt, then the aftermath, then the body's
// needs, then what it was doing.
//
// Needs resolve from the COMMITTED INTENT first and from the raw reserves only as a
// fallback. That is not redundancy: reading the intent means the danger-field ->
// flee mapping and the need -> eat mapping have exactly one owner (`score_intents`),
// and speech reads the decision instead of re-deriving it with a second set of
// thresholds that could disagree. The raw-reserve fallback exists because `ai_step` is
// dormant by default — with the brain off, a body still gets to sound thirsty.
SpeechSituation speech_situation(const SpeechContext& c);

// ---------------------------------------------------------------------------
// SpeechMemory — the anti-repeat cache. The ONLY mutable state in this system.
//
// A direct-mapped table keyed on `speaker & (kSpeechMemorySlots-1)`, holding the last
// line index that speaker used. 512 bytes, no allocation, POD, and trivially
// serialisable if it ever needs to be (it does not — it is transient like a cooldown).
// `owner` holds `speaker + 1` so a zeroed table is correctly "empty" rather than
// "speaker 0 said line 0".
// ---------------------------------------------------------------------------
inline constexpr std::size_t kSpeechMemorySlots = 64;
static_assert((kSpeechMemorySlots & (kSpeechMemorySlots - 1)) == 0,
              "slot count must be a power of two — the index is a mask, not a modulo");

struct SpeechMemory {
    std::uint32_t owner[kSpeechMemorySlots] = {};  // NpcId + 1; 0 == empty
    std::uint16_t last[kSpeechMemorySlots] = {};   // last index this owner spoke
};

// Pick a line and remember it, so the same speaker never says the same line twice in a
// row. On a collision the seed is decorrelated once and, failing that, the index steps
// deterministically to the next entry in the same union — so the guarantee is
// ABSOLUTE, not probabilistic, whenever the (situation, faction) union holds more than
// one line. With exactly one line it repeats, because there is nothing else true to
// say; the generator keeps every wildcard bucket at 5+, so that case cannot arise from
// the shipped CSV.
//
// Deterministic given the same `SpeechMemory` state, which is what makes it testable:
// a fresh memory plus a fixed seed always yields the same line.
const char* speech_say(SpeechMemory& mem, NpcId speaker, SpeechSituation s,
                       std::uint16_t faction, std::uint32_t seed,
                       std::uint16_t* outIndex = nullptr);

// The one call the app makes: resolve the situation from live state, read the speaker's
// faction out of the pool, pick, remember. Returns the line; writes the resolved
// situation to `outSituation` when asked (the HUD wants to show it).
const char* speech_say(SpeechMemory& mem, const NpcPool& pool, NpcId speaker,
                       const SpeechContext& ctx, std::uint32_t seed,
                       SpeechSituation* outSituation = nullptr);

// ---------------------------------------------------------------------------
// `source_rules` registration — NOT yet wired, and this is the note that says so.
//
// `tools/check_source_rules.cmake` already guards items/mobs/weapons/materials against
// CSV-to-header count drift. This table needs the same line, and without it the
// invisible failure mode is live: edit the CSV, forget the generator, and the compiler
// says nothing because `speech_table.cpp` still declares 273 rows.
//
//     _giga_csv_vs_header("data/speech_lines.csv" "src/game/speech.h"
//         "kSpeechLineCount[ \t]*=[ \t]*([0-9]+)" "speech line")
//
// Note for whoever adds it: the CSV is quoted (every `text_ru` cell is wrapped in
// double quotes, because the lines contain commas) and holds 9,196 UTF-8 Cyrillic lead
// bytes. CMake's `file(STRINGS)` splits on non-ASCII bytes — that exact bug read
// `items.csv` as 2465 rows instead of 446 — so the macro's `_giga_read_lines` /
// `file(READ)` reader is the one that must be used, not a fresh `file(STRINGS)`.
// ---------------------------------------------------------------------------

} // namespace giga::game
