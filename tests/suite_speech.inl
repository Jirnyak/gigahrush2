// Speech — the crowd's voice. [speech.h] / data/speech_lines.csv / speech_table.cpp.
//
// The system under test carries 9,196 Cyrillic lead bytes; this file carries ZERO —
// measured, not assumed (its only non-ASCII bytes are the em-dashes in these comments).
// Every assertion about the content is made on BYTES, with the one pinned line written
// as `\xNN` escapes, for the reason AGENTS.md records: on this CP1251 host a text-mode
// search for a Cyrillic class is an unreliable instrument (`grep -P` reported ZERO
// matches in files measurably holding thousands of lead bytes), and a comparison
// against a Cyrillic source literal only proves the compiler and the editor agreed
// with each other. Escapes prove the emitted bytes, and keep the assertions immune to
// the BOM/codepage failure mode they exist to detect.
//
// A .inl and not a .cpp for the reason suite_samosbor.inl states: game_test owns the
// CHECK macro, so the include has to land after it.

#include "game/speech.h"

#include "game/ai.h"        // IntentId / AiBrain — the situation ladder's inputs
#include "game/embody.h"    // NpcRef — speech_context's NpcId -> Entity link
#include "game/needs.h"     // kNeedMax / needs_roll / the warn thresholds it shares
#include "game/rumour.h"    // kOverhearCooldownTicks — the channel this must NOT match
#include "game/samosbor.h"  // SamosborPhase — ditto

namespace speech_t {

// Sum of 0xD0/0xD1 lead bytes over every line in the bank. MEASURED, and it moves with
// every content edit — `tools/gen_speech_table.py` prints the figure it wrote, and
// AGENTS.md quotes per-file counts the same way for item_table.cpp (6,608) and
// mob_table.cpp (644). If this fails after a CSV edit, re-measure; if it fails WITHOUT
// one, the Cyrillic did not survive.
// 9196 -> 9610 (+414) 2026-08-17: одиннадцать блатных строк WILD из фольклора
// форка (двенадцатая — анти-торная агитка — в мусор по слову владельца §56).
constexpr int kExpectedCyrillicLeadBytes = 9610;

// One line pinned byte-for-byte: COMBAT x CULTISTS. Escaped rather than pasted, so the
// literal is exactly 40 bytes of UTF-8 no matter what the compiler thinks the source
// encoding is. Every escape here is followed by a backslash, a comma, a space or '!',
// never by a hex digit — which is what stops MSVC swallowing the next character into
// the escape.
const char* const kPinned =
    "\xd0\x98\xd0\xb7\xd1\x8b\xd0\xb4\xd0\xb8, "
    "\xd0\xbd\xd0\xb5\xd0\xb2\xd0\xb5\xd1\x80\xd0\xbd\xd0\xb0\xd1\x8f "
    "\xd0\xbf\xd0\xbb\xd0\xbe\xd1\x82\xd1\x8c!";
constexpr std::size_t kPinnedBytes = 40;

const SpeechSituation kAllSituations[kSpeechSituationCount] = {
    SpeechSituation::Ambient, SpeechSituation::Hunger, SpeechSituation::Thirst,
    SpeechSituation::Sleep,   SpeechSituation::Relief, SpeechSituation::Wounded,
    SpeechSituation::Fear,    SpeechSituation::Combat, SpeechSituation::Hide,
    SpeechSituation::Fog,     SpeechSituation::After,  SpeechSituation::Social,
    SpeechSituation::Work,
};

// Strict UTF-8 structural validation. Returns the number of 0xD0/0xD1 lead bytes, or
// -1 on any malformed sequence. This is the check that actually catches a truncated
// multi-byte character — a length cap applied to a byte count, a CP1251 round-trip, or
// a mangled generator — none of which a strcmp against another Cyrillic literal would.
int utf8_lead_bytes(const char* s) {
    int cyr = 0;
    const unsigned char* p = reinterpret_cast<const unsigned char*>(s);
    while (*p != 0) {
        const unsigned char b = *p;
        int extra = 0;
        if (b < 0x80u) {
            extra = 0;
        } else if ((b & 0xE0u) == 0xC0u) {
            extra = 1;
            if (b == 0xD0u || b == 0xD1u) ++cyr;
        } else if ((b & 0xF0u) == 0xE0u) {
            extra = 2;
        } else if ((b & 0xF8u) == 0xF0u) {
            extra = 3;
        } else {
            return -1;  // continuation byte or 0xF8+ where a lead byte belongs
        }
        ++p;
        for (int i = 0; i < extra; ++i) {
            if ((*p & 0xC0u) != 0x80u) return -1;  // truncated sequence
            ++p;
        }
    }
    return cyr;
}

// ---------------------------------------------------------------------------
// 1. The bytes. Does the Cyrillic survive CSV -> generator -> .cpp -> compiler?
// ---------------------------------------------------------------------------
void test_bytes() {
    int cyrTotal = 0;
    int malformed = 0;
    int withDigit = 0;
    int tooLong = 0;
    int empty = 0;
    int control = 0;
    int pinnedHits = 0;

    for (std::size_t i = 0; i < kSpeechLineCount; ++i) {
        const char* s = kSpeechText[i];
        if (s == nullptr) {
            ++empty;
            continue;
        }
        const std::size_t n = std::strlen(s);
        if (n == 0) ++empty;
        if (n > 140) ++tooLong;

        const int cyr = utf8_lead_bytes(s);
        if (cyr < 0) {
            ++malformed;
        } else {
            cyrTotal += cyr;
        }

        for (std::size_t k = 0; k < n; ++k) {
            const unsigned char c = static_cast<unsigned char>(s[k]);
            // A digit is a checkable claim, and a checkable claim belongs to
            // [rumour.h]. This is the mechanical half of the firewall that keeps the
            // two systems from becoming two systems for one job.
            if (c >= '0' && c <= '9') ++withDigit;
            if (c < 0x20u) ++control;  // no stray newline / tab from the CSV
        }

        if (n == kPinnedBytes && std::memcmp(s, kPinned, kPinnedBytes) == 0)
            ++pinnedHits;
    }

    CHECK(malformed == 0);   // every multi-byte sequence is complete
    CHECK(empty == 0);
    CHECK(tooLong == 0);
    CHECK(control == 0);
    CHECK(withDigit == 0);   // the rumour/speech firewall
    CHECK(cyrTotal == kExpectedCyrillicLeadBytes);
    CHECK(pinnedHits == 1);  // one exact byte match, no duplicate

    // The pinned line must be reachable from the situation and faction it was authored
    // for — a round-trip that survives the strings but scrambles the buckets would
    // still pass every check above.
    bool reachable = false;
    for (std::uint32_t seed = 0; seed < 512u && !reachable; ++seed) {
        const std::uint16_t idx = speech_line_index(
            7u, SpeechSituation::Combat,
            static_cast<std::uint16_t>(Faction::Cultists), seed);
        if (idx < kSpeechLineCount && std::strlen(kSpeechText[idx]) == kPinnedBytes &&
            std::memcmp(kSpeechText[idx], kPinned, kPinnedBytes) == 0)
            reachable = true;
    }
    CHECK(reachable);
}

// ---------------------------------------------------------------------------
// 2. Nobody is ever mute. Every (situation, faction) cell must answer.
// ---------------------------------------------------------------------------
void test_coverage() {
    int cells = 0;
    int thin = 0;
    int mute = 0;

    for (std::size_t si = 0; si < kSpeechSituationCount; ++si) {
        // The wildcard register is what makes coverage a property of the data: a
        // faction with no authored line for a situation falls back to it.
        CHECK(speech_bucket(kAllSituations[si], kSpeechAnySlot).count > 0);

        for (std::uint16_t f = 0; f < static_cast<std::uint16_t>(kFactionCount); ++f) {
            ++cells;
            const std::uint16_t n = speech_line_count(kAllSituations[si], f);
            // Two is the floor, not one: below two `speech_say` cannot honour
            // "never the same line twice in a row".
            if (n < 2) ++thin;

            SpeechMemory mem;
            const char* line = speech_say(mem, 11u, kAllSituations[si], f, 0xC0FFEEu);
            if (line == nullptr || line[0] == 0) ++mute;
        }
    }
    CHECK(cells == static_cast<int>(kSpeechSituationCount * kFactionCount));
    CHECK(cells == 65);
    CHECK(thin == 0);
    CHECK(mute == 0);

    // An out-of-range index answers a real line rather than nullptr — a generic line
    // beats a mute body, and both beat a crash in the HUD's format string.
    CHECK(speech_text(0xFFFFu) != nullptr);
    CHECK(speech_text(0xFFFFu)[0] != 0);
    CHECK(speech_text(static_cast<std::uint16_t>(kSpeechLineCount))[0] != 0);
    // Faction ids past the enum fold by MODULO, not by a mask — the `& 3` bug
    // [faction.h] records folded Wild onto Citizens.
    CHECK(speech_line_count(SpeechSituation::Ambient, 5u) ==
          speech_line_count(SpeechSituation::Ambient, 0u));
    CHECK(speech_line_count(SpeechSituation::Ambient, 4u) !=
          speech_line_count(SpeechSituation::Ambient, 0u));
}

// ---------------------------------------------------------------------------
// 3. Determinism: same seed, same line. The whole system is one hash.
// ---------------------------------------------------------------------------
void test_determinism() {
    int mismatches = 0;
    int outOfRange = 0;

    for (std::uint32_t id = 0; id < 64u; ++id) {
        for (std::size_t si = 0; si < kSpeechSituationCount; ++si) {
            for (std::uint16_t f = 0; f < static_cast<std::uint16_t>(kFactionCount);
                 ++f) {
                const std::uint32_t seed = 0x5EEDu ^ (id * 131u);
                const std::uint16_t a =
                    speech_line_index(id, kAllSituations[si], f, seed);
                const std::uint16_t b =
                    speech_line_index(id, kAllSituations[si], f, seed);
                if (a != b) ++mismatches;
                if (a >= kSpeechLineCount) ++outOfRange;

                // A fresh memory must reproduce the pure pick exactly: nothing about
                // the anti-repeat may perturb a first utterance.
                SpeechMemory m1, m2;
                std::uint16_t i1 = 0xFFFFu, i2 = 0xFFFFu;
                const char* s1 =
                    speech_say(m1, id, kAllSituations[si], f, seed, &i1);
                const char* s2 =
                    speech_say(m2, id, kAllSituations[si], f, seed, &i2);
                if (i1 != a || i2 != a || s1 != s2) ++mismatches;
            }
        }
    }
    CHECK(mismatches == 0);
    CHECK(outOfRange == 0);
}

// ---------------------------------------------------------------------------
// 4. The seed is load-bearing. A different seed must move the line.
// ---------------------------------------------------------------------------
void test_seed_varies() {
    // Per cell, over 128 speakers: how many change their line when the seed changes.
    // With the thinnest cell holding 5 lines, chance alone keeps ~1/5 the same, so a
    // floor of 64/128 is far above noise and far below the ~102 expected — while a
    // seed that was simply ignored would score 0.
    int weakCells = 0;
    int cellsWithNoAlternative = 0;

    for (std::size_t si = 0; si < kSpeechSituationCount; ++si) {
        for (std::uint16_t f = 0; f < static_cast<std::uint16_t>(kFactionCount); ++f) {
            int changed = 0;
            for (std::uint32_t id = 0; id < 128u; ++id) {
                const std::uint16_t a =
                    speech_line_index(id, kAllSituations[si], f, 1u);
                const std::uint16_t b =
                    speech_line_index(id, kAllSituations[si], f, 2u);
                if (a != b) ++changed;
            }
            if (changed < 64) ++weakCells;

            // Stronger, per-speaker form: for ONE fixed speaker there must exist some
            // seed that yields a different line. An aggregate can hide a speaker
            // pinned to a constant.
            const std::uint16_t base =
                speech_line_index(3u, kAllSituations[si], f, 0u);
            bool found = false;
            for (std::uint32_t seed = 1u; seed < 64u && !found; ++seed)
                if (speech_line_index(3u, kAllSituations[si], f, seed) != base)
                    found = true;
            if (!found) ++cellsWithNoAlternative;
        }
    }
    CHECK(weakCells == 0);
    CHECK(cellsWithNoAlternative == 0);
}

// ---------------------------------------------------------------------------
// 5. No speaker says the same line twice in a row.
// ---------------------------------------------------------------------------
void test_no_repeat() {
    int repeats = 0;
    int nullLines = 0;

    for (std::size_t si = 0; si < kSpeechSituationCount; ++si) {
        for (std::uint16_t f = 0; f < static_cast<std::uint16_t>(kFactionCount); ++f) {
            for (std::uint32_t id = 0; id < 32u; ++id) {
                SpeechMemory mem;
                std::uint16_t prev = 0xFFFFu;
                // Same seed every call, which is the adversarial case: without the
                // anti-repeat this loop would return one identical line eight times.
                for (int turn = 0; turn < 8; ++turn) {
                    std::uint16_t idx = 0xFFFFu;
                    const char* s =
                        speech_say(mem, id, kAllSituations[si], f, 0xABCDu, &idx);
                    if (s == nullptr || s[0] == 0) ++nullLines;
                    if (turn > 0 && idx == prev) ++repeats;
                    prev = idx;
                }
            }
        }
    }
    CHECK(repeats == 0);
    CHECK(nullLines == 0);

    // Two speakers sharing one memory slot (ids 64 apart in a 64-slot table) must not
    // corrupt each other: the slot is tagged with speaker+1, so the second speaker's
    // first line is its own pure pick, not a re-roll inherited from the first.
    SpeechMemory shared;
    std::uint16_t iA = 0xFFFFu, iB = 0xFFFFu;
    speech_say(shared, 5u, SpeechSituation::Ambient, 0u, 77u, &iA);
    speech_say(shared, 5u + kSpeechMemorySlots, SpeechSituation::Ambient, 0u, 77u,
               &iB);
    CHECK(iB == speech_line_index(5u + kSpeechMemorySlots, SpeechSituation::Ambient,
                                  0u, 77u));
    // ...and the eviction is real: speaker 5 has lost its history, which is the
    // documented degradation of a direct-mapped cache, not a bug.
    CHECK(shared.owner[5] == 5u + kSpeechMemorySlots + 1u);
}

// ---------------------------------------------------------------------------
// 6. The situation ladder. An event in progress outranks a state.
// ---------------------------------------------------------------------------
void test_situation_ladder() {
    // A default context answers Ambient. This is the trap [speech.h] documents: an
    // all-zero `Needs` means "never rolled", NOT "starving and parched", and reading
    // it the other way would peg the whole crowd on food lines.
    {
        SpeechContext c;
        CHECK(speech_situation(c) == SpeechSituation::Ambient);
        CHECK(c.needs.seeded == 0);
    }

    // The siren outranks everyone, including a body that is starving, fighting and
    // nearly dead. Nobody gossips through a siren.
    {
        SpeechContext c;
        c.intent = IntentCombat;
        c.hp = 1;
        c.maxHp = 100;
        c.needs.seeded = 1;
        c.needs.food = 0.0f;
        c.samosborPhase = static_cast<std::uint8_t>(SamosborPhase::Warning);
        CHECK(speech_situation(c) == SpeechSituation::Hide);
        c.samosborPhase = static_cast<std::uint8_t>(SamosborPhase::Active);
        CHECK(speech_situation(c) == SpeechSituation::Fog);
    }

    // Events in progress, then states.
    {
        SpeechContext c;
        c.hp = 1;
        c.maxHp = 100;  // wounded by any measure...
        c.intent = IntentCombat;
        CHECK(speech_situation(c) == SpeechSituation::Combat);  // ...but fighting wins
        c.intent = IntentFactionAssault;
        CHECK(speech_situation(c) == SpeechSituation::Combat);
        c.intent = IntentFlee;
        CHECK(speech_situation(c) == SpeechSituation::Fear);
        c.intent = IntentSafety;
        CHECK(speech_situation(c) == SpeechSituation::Fear);
        c.intent = kIntentNone;
        CHECK(speech_situation(c) == SpeechSituation::Wounded);  // now the state shows
    }

    // The wounded threshold is a fraction, not an absolute: exactly half is wounded,
    // one point above it is not.
    {
        SpeechContext c;
        c.maxHp = 100;
        c.hp = 50;
        CHECK(speech_situation(c) == SpeechSituation::Wounded);
        c.hp = 51;
        CHECK(speech_situation(c) == SpeechSituation::Ambient);
        c.maxHp = 40;  // a child-sized pool scales with it
        c.hp = 20;
        CHECK(speech_situation(c) == SpeechSituation::Wounded);
        c.hp = 21;
        CHECK(speech_situation(c) == SpeechSituation::Ambient);
        c.maxHp = 0;  // no pool at all must not divide-by-zero into Wounded
        c.hp = 0;
        CHECK(speech_situation(c) == SpeechSituation::Ambient);
    }

    // Aftermath sits below being hurt and above the needs.
    {
        SpeechContext c;
        c.samosborPhase = static_cast<std::uint8_t>(SamosborPhase::Aftermath);
        CHECK(speech_situation(c) == SpeechSituation::After);
        c.hp = 1;
        c.maxHp = 100;
        CHECK(speech_situation(c) == SpeechSituation::Wounded);
    }

    // The committed intent owns the needs mapping — speech reads the DECISION rather
    // than re-deriving it, so there is only one owner of "this body is hungry".
    {
        SpeechContext c;
        c.intent = IntentEat;
        CHECK(speech_situation(c) == SpeechSituation::Hunger);
        c.intent = IntentDrink;
        CHECK(speech_situation(c) == SpeechSituation::Thirst);
        c.intent = IntentSleep;
        CHECK(speech_situation(c) == SpeechSituation::Sleep);
        c.intent = IntentToilet;
        CHECK(speech_situation(c) == SpeechSituation::Relief);
        c.intent = IntentHeal;
        CHECK(speech_situation(c) == SpeechSituation::Wounded);
        c.intent = IntentSocial;
        CHECK(speech_situation(c) == SpeechSituation::Social);
        c.intent = IntentWork;
        CHECK(speech_situation(c) == SpeechSituation::Work);
        c.intent = IntentPatrol;
        CHECK(speech_situation(c) == SpeechSituation::Work);
        c.intent = IntentWander;
        CHECK(speech_situation(c) == SpeechSituation::Ambient);
    }

    // ...and the raw reserves are the fallback, because `ai_step` is dormant by
    // default and a crowd with the brain off should still sound like bodies. The band
    // edges are needs.h's own constants, so speech and the survival clock cannot
    // disagree about when a body is hungry.
    {
        SpeechContext c;
        c.needs.seeded = 1;
        c.needs.food = kNeedMax;
        c.needs.water = kNeedMax;
        c.needs.sleep = kNeedMax;
        CHECK(speech_situation(c) == SpeechSituation::Ambient);  // nothing wrong yet

        c.needs.food = kFoodWarnAt - 0.01f;
        CHECK(speech_situation(c) == SpeechSituation::Hunger);
        c.needs.food = kFoodWarnAt;  // exactly at the edge is NOT yet in the band
        CHECK(speech_situation(c) == SpeechSituation::Ambient);

        c.needs.water = 0.0f;  // empty beats merely-low
        c.needs.food = kFoodWarnAt * 0.9f;
        CHECK(speech_situation(c) == SpeechSituation::Thirst);

        c.needs.water = kNeedMax;
        c.needs.food = kNeedMax;
        c.needs.sleep = 0.0f;
        CHECK(speech_situation(c) == SpeechSituation::Sleep);

        c.needs.sleep = kNeedMax;
        c.needs.pee = kNeedMax;
        CHECK(speech_situation(c) == SpeechSituation::Relief);
        c.needs.pee = 0.0f;
        c.needs.poo = kNeedMax;
        CHECK(speech_situation(c) == SpeechSituation::Relief);
        c.needs.poo = kPooWarnAt;  // at the edge, not past it
        CHECK(speech_situation(c) == SpeechSituation::Ambient);

        // Ties break toward the lower situation index, matching `select_intent`'s
        // argmax rule, so an equally hungry and thirsty body is consistently hungry
        // rather than flickering.
        c.needs.food = 0.0f;
        c.needs.water = 0.0f;
        CHECK(speech_situation(c) == SpeechSituation::Hunger);

        // And the whole branch stays gated: clear `seeded` and the same starving row
        // answers Ambient again.
        c.needs.seeded = 0;
        CHECK(speech_situation(c) == SpeechSituation::Ambient);
    }
}

// ---------------------------------------------------------------------------
// 7. Faction routing. A faction speaks its own register or the common one, never
//    another faction's.
// ---------------------------------------------------------------------------
void test_faction_routing() {
    int leaks = 0;
    int neverSpecific = 0;

    for (std::size_t si = 0; si < kSpeechSituationCount; ++si) {
        const SpeechSituation s = kAllSituations[si];
        const SpeechBucket& any = speech_bucket(s, kSpeechAnySlot);

        for (std::uint8_t f = 0; f < static_cast<std::uint8_t>(kFactionCount); ++f) {
            const SpeechBucket& mine = speech_bucket(s, f);
            bool sawSpecific = false;

            for (std::uint32_t id = 0; id < 256u; ++id) {
                const std::uint16_t idx = speech_line_index(id, s, f, 0x1234u);
                const bool inMine =
                    mine.count != 0 && idx >= mine.first && idx < mine.first + mine.count;
                const bool inAny =
                    any.count != 0 && idx >= any.first && idx < any.first + any.count;
                if (!inMine && !inAny) ++leaks;
                if (inMine) sawSpecific = true;
            }
            // A faction WITH authored lines must actually reach them; one with none
            // legitimately never does.
            if (mine.count != 0 && !sawSpecific) ++neverSpecific;
        }
    }
    CHECK(leaks == 0);
    CHECK(neverSpecific == 0);

    // The bank is contiguous and complete: the buckets tile [0, kSpeechLineCount)
    // exactly, with no gap and no overlap. That is what makes the two-range union a
    // valid substitute for a materialised index list.
    std::vector<int> hits(kSpeechLineCount, 0);
    for (std::size_t si = 0; si < kSpeechSituationCount; ++si) {
        for (std::uint8_t slot = 0;
             slot < static_cast<std::uint8_t>(kSpeechFactionSlots); ++slot) {
            const SpeechBucket& b = speech_bucket(kAllSituations[si], slot);
            for (std::uint16_t k = 0; k < b.count; ++k) {
                const std::size_t idx = static_cast<std::size_t>(b.first) + k;
                if (idx < kSpeechLineCount) ++hits[idx];
            }
        }
    }
    int notExactlyOnce = 0;
    for (std::size_t i = 0; i < kSpeechLineCount; ++i)
        if (hits[i] != 1) ++notExactlyOnce;
    CHECK(notExactlyOnce == 0);
}

// ---------------------------------------------------------------------------
// 8. The pool-facing entry point: read the speaker's faction, resolve, speak.
// ---------------------------------------------------------------------------
void test_pool_entry() {
    NpcPool pool;
    pool.init();
    const NpcId a = pool.spawn();
    const NpcId b = pool.spawn();
    pool.faction(a) = static_cast<std::uint16_t>(Faction::Liquidators);
    pool.faction(b) = static_cast<std::uint16_t>(Faction::Wild);
    pool.hp(a) = 100;
    pool.max_hp(a) = 100;
    pool.hp(b) = 10;
    pool.max_hp(b) = 100;

    SpeechMemory mem;
    SpeechContext ca;
    ca.hp = pool.hp(a);
    ca.maxHp = pool.max_hp(a);
    ca.intent = IntentWork;

    SpeechSituation sa = SpeechSituation::Count;
    const char* la = speech_say(mem, pool, a, ca, 0x77u, &sa);
    CHECK(sa == SpeechSituation::Work);
    CHECK(la != nullptr && la[0] != 0);
    // It must agree with the explicit form fed the same faction — i.e. the overload
    // really does read the pool rather than defaulting to Citizens.
    SpeechMemory ref;
    CHECK(std::strcmp(la, speech_say(ref, a, SpeechSituation::Work,
                                     static_cast<std::uint16_t>(Faction::Liquidators),
                                     0x77u)) == 0);

    SpeechContext cb;
    cb.hp = pool.hp(b);
    cb.maxHp = pool.max_hp(b);
    SpeechSituation sb = SpeechSituation::Count;
    const char* lb = speech_say(mem, pool, b, cb, 0x77u, &sb);
    CHECK(sb == SpeechSituation::Wounded);
    CHECK(lb != nullptr && lb[0] != 0);

    // ---- speech_context: the live-state gatherer -------------------------------
    // Components are emplaced directly rather than via `embody`, so the test isolates
    // the NpcId -> Entity lookup from everything else embodiment does.
    Registry reg;
    Entity ea = reg.create();
    reg.emplace<NpcRef>(ea, NpcRef{a});
    AiBrain brain;
    brain.currentIntent = IntentSocial;
    reg.emplace<AiBrain>(ea, brain);

    {
        const SpeechContext c = speech_context(reg, pool, a, 0u);
        CHECK(c.intent == IntentSocial);           // read off the embodied entity
        CHECK(c.hp == 100 && c.maxHp == 100);      // read off the pool columns
        CHECK(c.samosborPhase == 0);
        CHECK(speech_situation(c) == SpeechSituation::Social);
    }
    {
        // The phase argument is what makes the samosbor kinds reachable at all.
        const SpeechContext c = speech_context(
            reg, pool, a, static_cast<std::uint8_t>(SamosborPhase::Warning));
        CHECK(speech_situation(c) == SpeechSituation::Hide);
    }
    {
        // A record with no embodied entity (brain dormant, or not yet embodied) gets
        // kIntentNone and falls through to the pool state — here, low HP.
        const SpeechContext c = speech_context(reg, pool, b, 0u);
        CHECK(c.intent == kIntentNone);
        CHECK(c.hp == 10 && c.maxHp == 100);
        CHECK(speech_situation(c) == SpeechSituation::Wounded);
    }
    {
        // The pool's survival clock travels into the context, `seeded` included — so a
        // freshly spawned record does NOT read as starving.
        pool.needs(a) = needs_roll(1234u);
        const SpeechContext c = speech_context(reg, pool, a, 0u);
        CHECK(c.needs.seeded == pool.needs(a).seeded);
        CHECK(c.needs.food == pool.needs(a).food);
    }

    // Situation names are ASCII and total, including the out-of-range guard.
    int named = 0;
    for (std::size_t si = 0; si < kSpeechSituationCount; ++si) {
        const char* n = speech_situation_name(kAllSituations[si]);
        if (n != nullptr && n[0] != 0 && utf8_lead_bytes(n) == 0) ++named;
    }
    CHECK(named == static_cast<int>(kSpeechSituationCount));
    CHECK(std::strcmp(speech_situation_name(SpeechSituation::Count), "?") == 0);

    // The cooldown is derived from kSimHz, not written out — the literal-240
    // documented as "2 s at 120 Hz" drift [rumour.h] records is exactly what
    // [core/tick.h] exists to prevent. 3 s, deliberately not rumour's 2 s: two HUD
    // lines turning over on the same clock read as one system flickering.
    //
    // static_assert rather than CHECK because both are compile-time facts, and a
    // runtime `if` over a constant is a C4127 under /W4 — the build is zero-warnings.
    static_assert(kSpeechCooldownTicks == 3u * static_cast<std::uint32_t>(kSimHz),
                  "the speech cooldown must stay derived from kSimHz");
    static_assert(kSpeechCooldownTicks != kOverhearCooldownTicks,
                  "speech and rumour must not turn over on the same clock");
}

} // namespace speech_t

void test_speech_all() {
    speech_t::test_bytes();
    speech_t::test_coverage();
    speech_t::test_determinism();
    speech_t::test_seed_varies();
    speech_t::test_no_repeat();
    speech_t::test_situation_ladder();
    speech_t::test_faction_routing();
    speech_t::test_pool_entry();
}
