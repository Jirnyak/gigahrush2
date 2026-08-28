// Quests — the authored job layer over contracts, and the clock that can end one.
//
// Included into game_test.cpp, so it uses that file's CHECK macro and its
// `using namespace giga` / `using namespace giga::game`. Everything except the single
// entry point `test_quest_all()` lives in `namespace quest_test`.
//
// FIVE load-bearing groups, and they test different kinds of thing:
//
//   * `catalog_is_reachable()` re-checks, against the REAL engine functions, every
//     property tools/gen_quest_table.py mirrors in Python. That mirror is the fast
//     feedback; this is the authority. `item_weight_on_floor` and
//     `samosbor_fog_roster` are the actual code that decides whether a Fetch target can
//     spawn and whether a Hunt target lives at a floor's habitat anchor, so a retune
//     that silently invalidates a quest row lands here and not in the player's log.
//     This is the failure the reference shipped and contract.cpp names in a comment: a
//     quest that can never complete.
//   * `the_chain()` drives a three-step chain end to end through the public API only —
//     no poking states — because the whole reason quests are not contracts is that a
//     job can be the consequence of a finished one.
//   * `the_clock_runs_out()` measures the deadline in TICKS against `kSimHz` rather than
//     asserting a boolean. A deadline that fires "eventually" is not a deadline; the
//     assertion is that a 90-second limit is exactly 11,250 sim steps, which is what
//     pins the feature to `kSimStepMs` being exactly 8.
//   * `round_trip()` proves the save block is lossless with EVERY field distinct,
//     because a round-trip over zeroes passes even when the serializer drops half the
//     struct, and proves the block composes at a non-zero offset inside a larger
//     payload — which is how save.cpp will hold it.
//   * `the_slot_is_recycled()` arms `pool.set_recycling(true)` and requires an authored
//     quest whose giver died in the MACRO sweep to FAIL rather than transfer to the
//     newborn who inherited the id. It is the only group here that tests a POLICY the
//     shipping pool has not turned on yet, and it is the reason `QuestProgress::giver` is
//     an `NpcHandle` — see the A/B measurement in its own banner.
//
// A note on memcmp, because the sibling suite (suite_saveload.inl) is careful to say
// that comparing two `Contract`s with memcmp is a test that can fail for a reason which
// is not a bug. That caveat does NOT apply here: every byte of `QuestProgress`
// (4+4+4+1+1+2) and of `QuestLog` (rows + 8 + 5x4 + 4) is a NAMED field with a default
// member initializer, so there is no implicit padding anywhere in either struct and a
// byte-for-byte comparison is exact. The `static_assert`s in quest.h are what keep that
// true.

#include <cstdio>
#include <cstring>
#include <vector>

#include "core/tick.h"        // kSimHz / kSimStepMs — never a bare literal
#include "game/extraction.h"
#include "game/item_table.h"
#include "game/mob_spawn.h"   // samosbor_fog_roster — the real habitat filter
#include "game/mob_table.h"
#include "game/npc_pool.h"
#include "game/quest.h"

namespace quest_test {

// The reference's own deadline band, in sim seconds ([quest.h]): quest_deadlines.ts
// authors 60..7200 in-fiction minutes and its main.ts advances the clock one minute per
// real second, so the numbers port across unscaled.
constexpr std::uint32_t kMinLimitMs = 60u * 1000u;
constexpr std::uint32_t kMaxLimitMs = 7200u * 1000u;

// Well past the point `samosbor_allows_kind` saturates. [samosbor.h]'s measured unlock
// table reaches each anchor's FULL habitat roster by count 7, so at 64 the fog roster is
// exactly {lives at this floor's anchor} INTERSECT {rollable}, which is the pair of
// properties a Hunt row has to satisfy.
constexpr std::uint16_t kSaturatedSamosbor = 64;

// Is this monster kind in the habitat+rollable roster for this floor? Asked through the
// engine's own roster builder rather than through a copy of `anchor_for_floor`: a second
// mirror of that function in the tests would be a second thing to keep in step with
// mob_spawn.cpp, and the generator already carries one.
bool kind_lives_near(std::uint16_t kind, int floorZ) {
    const FogRoster r = samosbor_fog_roster(floorZ, kSaturatedSamosbor);
    for (std::uint32_t i = 0; i < r.n; ++i)
        if (r.kind[i] == static_cast<std::uint8_t>(kind)) return true;
    return false;
}

// Strict UTF-8 validation, byte by byte. This exists for one specific hazard: a C++ hex
// escape consumes as many hex digits as it can, so `"\xd0\xbead"` is the single
// character `\xd0bead` rather than "о" followed by "ad" — a corruption that compiles
// silently and only shows up as mojibake on screen. quest.cpp keeps every Cyrillic
// fragment in its own named constant to make that unexpressible; this is the check that
// says it worked.
bool valid_utf8(const char* s) {
    if (!s) return false;
    std::size_t i = 0;
    while (s[i] != '\0') {
        const unsigned char c = static_cast<unsigned char>(s[i]);
        unsigned trail = 0;
        if (c < 0x80u) trail = 0;
        else if ((c & 0xE0u) == 0xC0u && c >= 0xC2u) trail = 1;
        else if ((c & 0xF0u) == 0xE0u) trail = 2;
        else if ((c & 0xF8u) == 0xF0u) trail = 3;
        else return false;
        ++i;
        for (unsigned k = 0; k < trail; ++k) {
            if ((static_cast<unsigned char>(s[i]) & 0xC0u) != 0x80u) return false;
            ++i;
        }
    }
    return true;
}

// FNV-1a, written independently of quest.cpp's copy. Two jobs: it shows the production
// fingerprint really is a hash over the table in order rather than "a number that agrees
// with itself", and it lets the reorder case below be forged without touching the real
// table. Same construction save.cpp documents — the terminator is included, which is
// what stops "ab" + "c" hashing the same as "a" + "bc".
std::uint32_t fnv_over(const char* const* names, std::size_t n) {
    std::uint32_t h = 0x811C9DC5u;
    for (std::size_t i = 0; i < n; ++i) {
        for (const char* p = names[i];; ++p) {
            h ^= static_cast<std::uint32_t>(static_cast<std::uint8_t>(*p));
            h *= 0x01000193u;
            if (*p == '\0') break;
        }
    }
    return h;
}

// ---------------------------------------------------------------------------
// 1. Every authored row is reachable, checked against the live engine
// ---------------------------------------------------------------------------
void catalog_is_reachable() {
    static_assert(sizeof(QuestDef) == 24);
    static_assert(sizeof(QuestProgress) == 16);
    static_assert(kQuestCount == 19);
    CHECK(kQuestTable.size() == kQuestCount);
    CHECK(kQuestNames.size() == kQuestCount);
    CHECK(kQuestBriefs.size() == kQuestCount);

    int fetches = 0, hunts = 0, descends = 0, chained = 0, timed = 0, untimed = 0;
    for (std::size_t i = 0; i < kQuestCount; ++i) {
        const QuestId id = static_cast<QuestId>(i + 1);
        CHECK(quest_valid(id));
        const QuestDef& d = quest_def(id);

        // Authored content means authored TEXT. A row with no sentence in it is a
        // procedural contract with extra steps.
        CHECK(quest_name(id) != nullptr && quest_name(id)[0] != '\0');
        CHECK(quest_brief(id) != nullptr && quest_brief(id)[0] != '\0');
        CHECK(valid_utf8(quest_name(id)));
        CHECK(valid_utf8(quest_brief(id)));

        CHECK(d.reward > 0);
        CHECK(d.target > 0);
        CHECK(d.floorLo <= d.floorHi);
        CHECK(d.limitMs == 0u ||
              (d.limitMs >= kMinLimitMs && d.limitMs <= kMaxLimitMs));
        if (d.limitMs == 0u) ++untimed; else ++timed;

        // A prerequisite must name an EARLIER row. That is what makes a cycle
        // inexpressible rather than merely rejected, and the generator enforces it.
        if (d.prereq != kInvalidQuest) {
            CHECK(quest_valid(d.prereq));
            CHECK(static_cast<std::size_t>(d.prereq) < i + 1);
            ++chained;
        }

        // An item reward must exist and must fit one stack, or the count would be
        // silently truncated by `quest_grant_item`.
        if (d.rewardItem != kInvalidItem) {
            CHECK(item_valid(d.rewardItem));
            CHECK(d.rewardCount >= 1);
            CHECK(static_cast<int>(d.rewardCount) <=
                  static_cast<int>(item_def(d.rewardItem).stackMax));
        } else {
            CHECK(d.rewardCount == 0);
        }

        switch (static_cast<ObjectiveKind>(d.kind)) {
            case ObjectiveKind::Fetch: {
                ++fetches;
                CHECK(item_valid(d.subject));
                // **THE IMPOSSIBLE-QUEST GUARD, on the real function.** Depth gates
                // VALUE: past the band cap `item_weight_on_floor` decays the spawn
                // weight exponentially and can reach 0. So the target must be findable
                // on EVERY floor the quest is offered on, not just on the deepest.
                for (int fz = d.floorLo; fz <= d.floorHi; ++fz)
                    CHECK(item_weight_on_floor(d.subject, fz) > 0);
                break;
            }
            case ObjectiveKind::Hunt: {
                ++hunts;
                CHECK(static_cast<std::size_t>(d.subject) < kMobKindCount);
                const MobDef& md = kMobTable[d.subject];
                CHECK(md.dmg > 0);              // never send anyone to hunt scenery
                CHECK(md.spawnWeightX10 != 0);  // 0 is never rolled by any path
                CHECK(md.floorMask != 0);       // a mask naming no anchor matches none
                // And it must LIVE where the quest is handed out. Strictly stronger
                // than contract.cpp, which measured per-floor habitat gating as too
                // expensive for a procedural roll (Hunt offers on -50 collapse 32 -> 5)
                // and tests it globally instead. An authored row pays that cost once,
                // offline, and gets an offer that is never absurd where it is made.
                for (int fz = d.floorLo; fz <= d.floorHi; ++fz)
                    CHECK(kind_lives_near(d.subject, fz));
                break;
            }
            default: {
                ++descends;
                CHECK(d.subject == 0);
                // A DEPTH, not a signed label, and it has to be past the band it is
                // offered in or `quest_accept` would refuse it on the spot.
                const int reach = d.floorLo < 0 ? -d.floorLo : d.floorLo;
                const int reach2 = d.floorHi < 0 ? -d.floorHi : d.floorHi;
                const int deepest = reach > reach2 ? reach : reach2;
                CHECK(d.target > deepest);
                CHECK(d.target <= kFloorZSpan);
                break;
            }
        }
    }
    // All three objective kinds are used, so none of them is a dead enumerator.
    CHECK(fetches > 0 && hunts > 0 && descends > 0);
    CHECK(chained == 5);   // chained quests

    // **The no-deadline exemption is narrowed to chain HEADS, and that is mechanical.**
    // The reference exempts every hand-authored quest from expiry outright
    // (`isHandAuthoredQuest`) so a story cannot be lost to a clock. Here the exemption
    // is data, and it applies only to a row that starts a chain — everything after the
    // first step carries a real clock, so losing one closes the chain.
    CHECK(untimed == 3);
    CHECK(timed == 16);
    for (std::size_t i = 0; i < kQuestCount; ++i) {
        const QuestDef& d = kQuestTable[i];
        if (d.limitMs != 0u) continue;
        CHECK(d.prereq == kInvalidQuest);       // it is a head...
        bool isHead = false;                    // ...of a chain that actually exists
        for (std::size_t j = 0; j < kQuestCount; ++j)
            if (kQuestTable[j].prereq == static_cast<std::uint8_t>(i + 1)) isHead = true;
        CHECK(isHead);
    }
}

// ---------------------------------------------------------------------------
// 2. Offers: deterministic, always takeable, and gated by the chain
// ---------------------------------------------------------------------------
void offers() {
    NpcPool pool;
    pool.init();
    for (int i = 0; i < 512; ++i) (void)pool.spawn();
    const QuestLog fresh{};

    // Deterministic in (giver, floor, seed), like `rumour_for` and `contract_offer`:
    // walking away and coming back cannot reroll it into something better.
    for (NpcId g = 0; g < 64u; ++g) {
        const QuestId a = quest_offer(pool, fresh, g, 0, 0x9E37u);
        const QuestId b = quest_offer(pool, fresh, g, 0, 0x9E37u);
        CHECK(a == b);
    }

    // A dead or unknown body offers nothing.
    CHECK(quest_offer(pool, fresh, kInvalidNpc, 0, 0x9E37u) == kInvalidQuest);
    CHECK(quest_offer(pool, fresh, 100000u, 0, 0x9E37u) == kInvalidQuest);
    NpcPool p2;
    p2.init();
    const NpcId doomed = p2.spawn();
    p2.kill(doomed);
    CHECK(quest_offer(p2, fresh, doomed, 0, 0x9E37u) == kInvalidQuest);

    // Rarer than the procedural stream it sits on: kQuestOfferPct is 8 against
    // contracts' 18. A hash is not a shuffle, so this is a band — but one tight enough
    // to catch the gate stuck open or shut.
    std::uint32_t carrying = 0;
    for (NpcId g = 0; g < 512u; ++g)
        if (quest_offer(pool, fresh, g, 0, 0x9E37u) != kInvalidQuest) ++carrying;
    CHECK(carrying > 10u);
    CHECK(carrying < 120u);

    // **Every offer is takeable.** An offer the accept path refuses is the exact bug
    // contract.cpp's Descend guard exists to document, so the two paths share one
    // eligibility function and this is the assertion that says they agree.
    int offered = 0;
    for (int fz : {0, 1, 2, -8, -14, -26, -36, -50, 14, 30}) {
        for (NpcId g = 0; g < 512u; ++g) {
            const QuestId id = quest_offer(pool, fresh, g, fz, 0x9E37u);
            if (id == kInvalidQuest) continue;
            ++offered;
            CHECK(quest_eligible(fresh, id, fz));
            const QuestDef& d = quest_def(id);
            CHECK(fz >= d.floorLo && fz <= d.floorHi);
            CHECK(d.prereq == kInvalidQuest);   // nothing chained is open on a fresh log
            QuestLog log{};
            RunLedger led{};
            CHECK(quest_accept(log, pool, id, g, fz, led));
        }
    }
    CHECK(offered > 50);   // the whole shipped stack really does hand quests out

    // Every shipped floor has something on it, or the feature is invisible where the
    // player actually is. Floor 0 is the hub and the run starts there.
    for (int fz : {0, 1, 2, -8, -14, -26, -36, -50, 14, 30}) {
        int eligible = 0;
        for (std::size_t i = 0; i < kQuestCount; ++i)
            if (quest_eligible(fresh, static_cast<QuestId>(i + 1), fz)) ++eligible;
        CHECK(eligible > 0);
    }
}

// ---------------------------------------------------------------------------
// 3. A chain, end to end, through the public API only
// ---------------------------------------------------------------------------
// This is the thing contracts structurally cannot do: `contract_offer` is deterministic
// in (giver, floor, seed) and refuses to consult run history, so a job can never be the
// consequence of a finished job. Nothing below pokes a state byte — every transition
// goes through accept / step, which is what makes it a test of the feature rather than
// of the struct.
void the_chain() {
    NpcPool pool;
    pool.init();
    const NpcId giver = pool.spawn();
    QuestLog log{};
    RunLedger led{};
    Inventory inv;

    // pump_1 / pump_2 / pump_3 — the maintenance chain. Resolved by walking the table
    // rather than by hardcoding 1/2/3, so a content edit that reorders the CSV does not
    // silently retarget this test at three unrelated quests.
    QuestId head = kInvalidQuest;
    for (std::size_t i = 0; i < kQuestCount && head == kInvalidQuest; ++i)
        if (kQuestTable[i].limitMs == 0u && kQuestTable[i].prereq == kInvalidQuest &&
            static_cast<ObjectiveKind>(kQuestTable[i].kind) == ObjectiveKind::Fetch &&
            kQuestTable[i].floorLo <= 0 && kQuestTable[i].floorHi >= 0)
            head = static_cast<QuestId>(i + 1);
    CHECK(head != kInvalidQuest);
    QuestId step2 = kInvalidQuest;
    for (std::size_t i = 0; i < kQuestCount && step2 == kInvalidQuest; ++i)
        if (kQuestTable[i].prereq == head) step2 = static_cast<QuestId>(i + 1);
    CHECK(step2 != kInvalidQuest);

    // Step 2 is invisible until step 1 is DONE, and refused if asked for directly.
    CHECK(quest_eligible(log, head, 0));
    CHECK(!quest_eligible(log, step2, 0));
    CHECK(!quest_accept(log, pool, step2, giver, 0, led));

    // Not offered either, over the whole crowd on every floor step 2 lives on.
    for (int i = 0; i < 400; ++i) (void)pool.spawn();
    bool leaked = false;
    for (int fz = kQuestTable[step2 - 1].floorLo; fz <= kQuestTable[step2 - 1].floorHi;
         ++fz)
        for (NpcId g = 0; g < 400u; ++g)
            if (quest_offer(pool, log, g, fz, 0x9E37u) == step2) leaked = true;
    CHECK(!leaked);

    // Take and finish step 1 the way a player would: carry the cargo, stand there, tick.
    CHECK(quest_accept(log, pool, head, giver, 0, led));
    CHECK(quest_state(log, head) == QuestState::Active);
    const QuestDef& h = quest_def(head);
    CHECK(quest_step(log, pool, inv, led, static_cast<std::uint32_t>(kSimStepMs)) == 0);
    for (int k = 0; k < h.target; ++k) {
        CHECK(quest_grant_item(inv, h.subject, 1) == 1);
    }
    CHECK(quest_step(log, pool, inv, led, static_cast<std::uint32_t>(kSimStepMs)) ==
          h.reward);
    CHECK(quest_state(log, head) == QuestState::Complete);
    CHECK(led.banked == h.reward);
    CHECK(log.completed == 1u);
    // FETCH CONSUMES. A courier job that let you keep the cargo would pay twice for the
    // same loot — once as the reward and once as the haul.
    std::int32_t left = 0;
    for (const ItemSlot& s : inv.slots)
        if (s.item == h.subject) left += static_cast<std::int32_t>(s.count);
    CHECK(left == 0);
    // Paid once, not every tick.
    CHECK(quest_step(log, pool, inv, led, static_cast<std::uint32_t>(kSimStepMs)) == 0);

    // ...and now step 2 exists.
    CHECK(quest_eligible(log, step2, 0));
    bool everOffered = false;
    for (NpcId g = 0; g < 400u && !everOffered; ++g)
        if (quest_offer(pool, log, g, 0, 0x9E37u) == step2) everOffered = true;
    CHECK(everOffered);

    // Finish step 2 and collect the ITEM half of the reward, which is the channel a
    // contract does not have.
    const QuestDef& s2 = quest_def(step2);
    CHECK(s2.rewardItem != kInvalidItem);
    CHECK(quest_accept(log, pool, step2, giver, 0, led));
    for (int k = 0; k < s2.target; ++k) (void)quest_grant_item(inv, s2.subject, 1);
    CHECK(quest_step(log, pool, inv, led, static_cast<std::uint32_t>(kSimStepMs)) ==
          s2.reward);
    std::int32_t got = 0;
    for (const ItemSlot& s : inv.slots)
        if (s.item == s2.rewardItem) got += static_cast<std::int32_t>(s.count);
    CHECK(got == static_cast<std::int32_t>(s2.rewardCount));
    CHECK(log.rewardItemsLost == 0u);
    CHECK(log.earned == h.reward + s2.reward);

    // Step 2 was just COMPLETED above, so even on its own shallowest floor it is
    // no longer offerable — a finished chain link never re-offers (only Unseen /
    // Orphaned are eligible, [quest.cpp] quest_eligible).
    CHECK(step2 != kInvalidQuest);
    CHECK(!quest_eligible(log, step2, kQuestTable[step2 - 1].floorLo));

    // A reward that does not fit is COUNTED, never allowed to block a completion — a
    // blocked completion would leave an Active row the player has already finished, and
    // the deadline would then kill it. (The reference blocks instead.)
    Inventory full;
    for (ItemSlot& s : full.slots) s = ItemSlot{1, 1};
    CHECK(quest_grant_item(full, s2.rewardItem, 1) == 0);
}

// ---------------------------------------------------------------------------
// 4. Hunt progress rides the same NpcDied event the kill feed does
// ---------------------------------------------------------------------------
void hunting() {
    NpcPool pool;
    pool.init();
    const NpcId giver = pool.spawn();
    QuestLog log{};
    RunLedger led{};
    Inventory inv;

    // A Hunt row offered on the hub, so the test does not depend on where the player is.
    QuestId hunt = kInvalidQuest;
    for (std::size_t i = 0; i < kQuestCount && hunt == kInvalidQuest; ++i)
        if (static_cast<ObjectiveKind>(kQuestTable[i].kind) == ObjectiveKind::Hunt &&
            kQuestTable[i].floorLo <= 0 && kQuestTable[i].floorHi >= 0 &&
            kQuestTable[i].prereq == kInvalidQuest)
            hunt = static_cast<QuestId>(i + 1);
    CHECK(hunt != kInvalidQuest);
    const QuestDef& d = quest_def(hunt);
    CHECK(quest_accept(log, pool, hunt, giver, 0, led));

    // A different kind earns nothing. Picked as any kind that is not this row's target,
    // so the assertion does not depend on which monster the CSV happens to name.
    std::uint8_t other = 0;
    for (std::size_t k = 0; k < kMobKindCount; ++k)
        if (k != static_cast<std::size_t>(d.subject)) { other = static_cast<std::uint8_t>(k); break; }
    CHECK(other != static_cast<std::uint8_t>(d.subject));
    quest_on_kill(log, other);
    CHECK(log.row[hunt - 1].progress == 0);

    for (int k = 0; k < d.target; ++k)
        quest_on_kill(log, static_cast<std::uint8_t>(d.subject));
    CHECK(log.row[hunt - 1].progress == d.target);
    // And it does not overrun the target, so a HUD never prints 12/8.
    quest_on_kill(log, static_cast<std::uint8_t>(d.subject));
    CHECK(log.row[hunt - 1].progress == d.target);

    CHECK(quest_step(log, pool, inv, led, static_cast<std::uint32_t>(kSimStepMs)) ==
          d.reward);
    CHECK(quest_state(log, hunt) == QuestState::Complete);
    // **Paid into BANKED, not into the bag.** A job's reward is not carried loot and
    // must not be at risk on the walk home — the one thing that makes it safer than
    // looting the same value. [contract.h]
    CHECK(led.banked == d.reward);
    CHECK(log.completed == 1u && log.failed == 0u);
}

// ---------------------------------------------------------------------------
// 5. The clock, measured in ticks
// ---------------------------------------------------------------------------
void the_clock_runs_out() {
    NpcPool pool;
    pool.init();
    const NpcId giver = pool.spawn();
    Inventory inv;

    // The most urgent row in the catalog, whatever it is.
    QuestId urgent = kInvalidQuest;
    std::uint32_t best = 0xFFFFFFFFu;
    for (std::size_t i = 0; i < kQuestCount; ++i) {
        const std::uint32_t l = kQuestTable[i].limitMs;
        if (l != 0u && l < best) { best = l; urgent = static_cast<QuestId>(i + 1); }
    }
    CHECK(urgent != kInvalidQuest);
    const QuestDef& d = quest_def(urgent);
    const int fz = d.floorLo;

    {
        QuestLog log{};
        RunLedger led{};
        CHECK(quest_accept(log, pool, urgent, giver, fz, led));
        CHECK(log.row[urgent - 1].remainingMs == d.limitMs);

        // **THE MEASUREMENT.** Not "it expires eventually" — the number of sim steps a
        // limit takes, which is what pins the deadline to `kSimStepMs` being exactly 8
        // at 125 Hz. At the old 1/120 the same conversion truncated 8.833 to 8 and
        // stretched every authored duration by 4.17 % ([core/tick.h]); a deadline
        // measured in ticks is the kind of thing that bug ate silently.
        std::uint32_t steps = 0;
        std::int32_t paidWhileWaiting = 0;
        while (quest_state(log, urgent) == QuestState::Active && steps < 1000000u) {
            paidWhileWaiting += quest_step(log, pool, inv, led,
                                           static_cast<std::uint32_t>(kSimStepMs));
            ++steps;
        }
        // Accumulated and asserted once rather than per step: 11,250 CHECKs would bury
        // game_test's own tally without saying anything a sum does not.
        CHECK(paidWhileWaiting == 0);
        CHECK(quest_state(log, urgent) == QuestState::Expired);
        CHECK(steps == d.limitMs / static_cast<std::uint32_t>(kSimStepMs));
        CHECK(steps == (d.limitMs / 1000u) * static_cast<std::uint32_t>(kSimHz));
        CHECK(log.row[urgent - 1].remainingMs == 0u);
        CHECK(log.failed == 1u && log.expired == 1u && log.orphaned == 0u);
        CHECK(led.banked == 0);
        CHECK(log.completed == 0u);

        // Expired is TERMINAL. Unlike a dead giver, running out of time is the player's
        // own doing, so the row does not come back.
        CHECK(!quest_eligible(log, urgent, fz));
        CHECK(!quest_accept(log, pool, urgent, giver, fz, led));
        // ...and an expired row is not silently revived by later ticks either.
        CHECK(quest_step(log, pool, inv, led,
                         static_cast<std::uint32_t>(kSimStepMs)) == 0);
        CHECK(log.failed == 1u);
    }

    // `stepMs == 0` freezes every clock, which is what a test measuring something else
    // wants. It must not be readable as "already expired".
    {
        QuestLog log{};
        RunLedger led{};
        CHECK(quest_accept(log, pool, urgent, giver, fz, led));
        std::int32_t paid = 0;
        for (int k = 0; k < 5000; ++k) paid += quest_step(log, pool, inv, led, 0u);
        CHECK(paid == 0);
        CHECK(quest_state(log, urgent) == QuestState::Active);
        CHECK(log.row[urgent - 1].remainingMs == d.limitMs);
    }

    // **`limitMs == 0` really means no deadline**, not "expires on the first tick". The
    // chain heads depend on this: a chain must always be startable.
    {
        QuestId head = kInvalidQuest;
        for (std::size_t i = 0; i < kQuestCount && head == kInvalidQuest; ++i)
            if (kQuestTable[i].limitMs == 0u &&
                static_cast<ObjectiveKind>(kQuestTable[i].kind) == ObjectiveKind::Fetch)
                head = static_cast<QuestId>(i + 1);
        CHECK(head != kInvalidQuest);
        QuestLog log{};
        RunLedger led{};
        Inventory empty;
        CHECK(quest_accept(log, pool, head, giver, quest_def(head).floorLo, led));
        // Long enough to outlast the LONGEST limit in the catalog, derived from the
        // table rather than hardcoded so a content edit cannot quietly make this loop
        // too short to prove anything.
        std::uint32_t worst = 0;
        for (std::size_t k = 0; k < kQuestCount; ++k)
            if (kQuestTable[k].limitMs > worst) worst = kQuestTable[k].limitMs;
        const std::uint32_t steps =
            worst / static_cast<std::uint32_t>(kSimStepMs) + 1000u;
        std::int32_t paid = 0;
        for (std::uint32_t k = 0; k < steps; ++k)
            paid += quest_step(log, pool, empty, led,
                               static_cast<std::uint32_t>(kSimStepMs));
        CHECK(paid == 0);
        CHECK(quest_state(log, head) == QuestState::Active);
        CHECK(log.failed == 0u);
    }

    // The countdown a HUD reads is monotone and rounds UP, so a live quest never shows 0.
    {
        QuestLog log{};
        RunLedger led{};
        CHECK(quest_accept(log, pool, urgent, giver, fz, led));
        std::uint32_t prev = log.row[urgent - 1].remainingMs;
        bool monotone = true;
        for (int k = 0; k < 1000; ++k) {
            (void)quest_step(log, pool, inv, led,
                             static_cast<std::uint32_t>(kSimStepMs));
            const std::uint32_t now = log.row[urgent - 1].remainingMs;
            if (now >= prev) monotone = false;
            prev = now;
        }
        CHECK(monotone);
        CHECK(prev == d.limitMs - 1000u * static_cast<std::uint32_t>(kSimStepMs));
        char t[32] = {};
        CHECK(quest_time_text(prev, t, sizeof(t)));
        CHECK(t[0] != '\0');
        CHECK(valid_utf8(t));
    }
}

// ---------------------------------------------------------------------------
// 6. A dead giver — the problem contract.cpp already solved, answered consistently
// ---------------------------------------------------------------------------
// Consistent on the MECHANISM: both paths fire (the NpcDied event AND the step's own
// liveness check), because a body can also be lost to a floor unload rather than to a
// death and only one of those publishes — contract.cpp's stated reason for checking
// twice. Deliberately DIFFERENT on the terminal state, and quest.h argues why: a
// contract IS its giver, an authored row is not.
void the_giver_dies() {
    Inventory inv;

    // Path A: the step's liveness check.
    {
        NpcPool pool;
        pool.init();
        const NpcId doomed = pool.spawn();
        const NpcId other = pool.spawn();
        QuestLog log{};
        RunLedger led{};
        QuestId q = kInvalidQuest;
        for (std::size_t i = 0; i < kQuestCount && q == kInvalidQuest; ++i)
            if (static_cast<ObjectiveKind>(kQuestTable[i].kind) == ObjectiveKind::Hunt &&
                kQuestTable[i].prereq == kInvalidQuest)
                q = static_cast<QuestId>(i + 1);
        CHECK(q != kInvalidQuest);
        const QuestDef& d = quest_def(q);
        CHECK(quest_accept(log, pool, q, doomed, d.floorLo, led));
        quest_on_kill(log, static_cast<std::uint8_t>(d.subject));
        CHECK(log.row[q - 1].progress == 1);

        pool.kill(doomed);
        CHECK(quest_step(log, pool, inv, led,
                         static_cast<std::uint32_t>(kSimStepMs)) == 0);
        CHECK(quest_state(log, q) == QuestState::Orphaned);
        CHECK(log.failed == 1u && log.orphaned == 1u && log.expired == 0u);
        CHECK(led.banked == 0);
        // The clock and the kill count both go. A new person must not pay for work done
        // for someone else, and a row orphaned near expiry must not arrive already dead.
        CHECK(log.row[q - 1].remainingMs == 0u);
        CHECK(log.row[q - 1].progress == 0);

        // **Takeable again, and that is the deviation.** The failure is counted and the
        // state remembers it, so nothing is silently respawned — what the reference's
        // own design doc forbids. Making it terminal instead would let one random
        // citizen dying anywhere in the building delete authored content for the rest of
        // the run, and `finalize_deaths` runs every tick.
        CHECK(quest_eligible(log, q, d.floorLo));
        CHECK(quest_accept(log, pool, q, other, d.floorLo, led));
        CHECK(quest_state(log, q) == QuestState::Active);
        // The HANDLE for `other`, not the bare id. Written this way on purpose: `other`
        // has never died, so its generation is 0 and `giver == other` would pass by
        // accident — an `NpcHandle` and an `NpcId` are the same `std::uint32_t`, so
        // nothing but the assertion itself can catch that confusion.
        CHECK(log.row[q - 1].giver == pool.handle(other));
        CHECK(npc_handle_id(log.row[q - 1].giver) == other);
        CHECK(log.row[q - 1].remainingMs == d.limitMs);
        CHECK(log.row[q - 1].progress == 0);
        // Counters do not un-count: the run really did lose a job.
        CHECK(log.failed == 1u && log.orphaned == 1u);
        // Finishing it now pays exactly once.
        for (int k = 0; k < d.target; ++k)
            quest_on_kill(log, static_cast<std::uint8_t>(d.subject));
        CHECK(quest_step(log, pool, inv, led,
                         static_cast<std::uint32_t>(kSimStepMs)) == d.reward);
        CHECK(log.completed == 1u);
    }

    // Path B: the NpcDied event, drained by main beside `contract_on_giver_died`. Same
    // outcome, and only the giver's own rows are touched.
    {
        NpcPool pool;
        pool.init();
        const NpcId a = pool.spawn();
        const NpcId b = pool.spawn();
        QuestLog log{};
        RunLedger led{};
        QuestId qa = kInvalidQuest, qb = kInvalidQuest;
        for (std::size_t i = 0; i < kQuestCount; ++i) {
            if (kQuestTable[i].prereq != kInvalidQuest) continue;
            if (kQuestTable[i].floorLo > 0 || kQuestTable[i].floorHi < 0) continue;
            if (qa == kInvalidQuest) qa = static_cast<QuestId>(i + 1);
            else if (qb == kInvalidQuest) qb = static_cast<QuestId>(i + 1);
        }
        CHECK(qa != kInvalidQuest && qb != kInvalidQuest);
        CHECK(quest_accept(log, pool, qa, a, 0, led));
        CHECK(quest_accept(log, pool, qb, b, 0, led));

        quest_on_giver_died(log, kInvalidNpc);          // a no-op, never a wildcard
        CHECK(log.failed == 0u);
        quest_on_giver_died(log, a);
        CHECK(quest_state(log, qa) == QuestState::Orphaned);
        CHECK(quest_state(log, qb) == QuestState::Active);   // b is still alive
        CHECK(log.failed == 1u && log.orphaned == 1u);
        // Idempotent: a second publish for the same body must not double-count.
        quest_on_giver_died(log, a);
        CHECK(log.failed == 1u && log.orphaned == 1u);
    }
}

// ---------------------------------------------------------------------------
// 7. A RECYCLED slot — the ABA hole, and the reason `giver` is a handle
// ---------------------------------------------------------------------------
// The finding [tests/suite_audit.inl] `giver_slot_recycled` closed for contracts, asked
// of quests — because `QuestProgress::giver` was the same bare `NpcId` held across ticks
// and `quest_step`'s poll was the identical `!valid(id) || !alive(id)` line.
//
// The mechanism, in order. [npc_pool.h] never-reclaim is a POLICY, not a property of the
// type, and `set_recycling(true)` suspends it. The giver then dies in the MACRO sweep,
// which publishes no `NpcDied` event ([macro_sim.h]) — so `quest_on_giver_died` never
// fires, exactly as it never fires for a contract — the freed slot is handed to a newborn,
// and a poll that asks "is somebody alive at that index" answers YES. The authored errand
// completes for a stranger who never offered it, which is the reference's own broken quest
// binding that contract.h opens by claiming this engine is immune to.
//
// **MEASURED against the bare-id body**, not reasoned about: this same suite text, linked
// twice against two `quest.cpp` objects differing in exactly one line — `quest_step`'s
// liveness poll, `!pool.handle_valid(p.giver)` against the old
// `!pool.valid(p.giver) || !pool.alive(p.giver)`. Both runs execute 2,823 checks. The
// handle body fails 0; the bare-id body fails FOURTEEN, and the numbers are the finding:
// the row paid 180 rub instead of 0, banked 180 instead of 0, `earned` 180 instead of 0,
// ended in state 2 (Complete) instead of 4 (Orphaned), and counted completed 1 / failed 0
// instead of completed 0 / failed 1. An authored quest was paid out in full to a newborn
// who never offered it — the identical shape contract.cpp measured at 700 rub.
//
// Armed HERE and not in the shipping pool, deliberately: a test is exactly where an
// unshipped policy belongs, and the guard has to be proven against the policy before
// main.cpp turns it on.
void the_slot_is_recycled() {
    NpcPool pool;
    pool.init();
    pool.set_recycling(true);
    CHECK(pool.recycling());

    // A Hunt already AT its target, so the bare-id version does not merely keep the row
    // alive — it PAYS. The finding is a payout to a stranger, not a lingering row, and the
    // assertions below should read as one.
    const NpcId giver = pool.spawn();
    QuestLog log{};
    RunLedger led{};
    Inventory inv;

    QuestId q = kInvalidQuest;
    for (std::size_t i = 0; i < kQuestCount && q == kInvalidQuest; ++i)
        if (static_cast<ObjectiveKind>(kQuestTable[i].kind) == ObjectiveKind::Hunt &&
            kQuestTable[i].prereq == kInvalidQuest)
            q = static_cast<QuestId>(i + 1);
    CHECK(q != kInvalidQuest);
    const QuestDef& d = quest_def(q);
    CHECK(quest_accept(log, pool, q, giver, d.floorLo, led));

    // The STORED field is a (generation, id) pair, and its ID HALF is still exactly the id
    // that was passed in — which is what keeps `quest_offer`'s determinism hash and
    // `quest_on_giver_died`'s event comparison working off a bare id.
    const NpcHandle bound = log.row[q - 1].giver;
    CHECK(bound == pool.handle(giver));
    CHECK(npc_handle_id(bound) == giver);
    CHECK(npc_handle_gen(bound) == pool.generation(giver));
    CHECK(pool.handle_valid(bound));

    for (int k = 0; k < d.target; ++k)
        quest_on_kill(log, static_cast<std::uint8_t>(d.subject));
    CHECK(log.row[q - 1].progress == d.target);   // one quest_step from d.reward

    // The giver dies the way NOTHING reports: in the macro sweep. No NpcDied event is
    // published, so `quest_on_giver_died` is deliberately NOT called here — that is
    // precisely the gap `quest_step`'s poll has to cover on its own.
    pool.kill(giver);
    const NpcId newborn = pool.spawn();
    CHECK(newborn == giver);          // the ABA actually happened, not hypothetically
    CHECK(pool.recycled() == 1u);     // ...out of the free list, not off the tail
    // BOTH halves of the poll the bare-id version ran now pass. That is the whole finding:
    // it would have kept this row and paid it out to whoever this newborn is.
    CHECK(pool.valid(newborn));
    CHECK(pool.alive(newborn));
    // The one bit of state a bare id could not see.
    CHECK(pool.generation(newborn) != npc_handle_gen(bound));
    CHECK(!pool.handle_valid(bound));

    const std::int32_t paid =
        quest_step(log, pool, inv, led, static_cast<std::uint32_t>(kSimStepMs));
    // PRINTED, so a human reading the log gets the measured figure rather than a green
    // tick: the reward that was at stake, and what the row actually did with it.
    std::fprintf(stderr,
                 "[quest] giver id %u recycled into a newborn (gen %u -> %u); the "
                 "authored row paid %d rub of %d and ended in state %u (4 = Orphaned)\n",
                 static_cast<unsigned>(giver),
                 static_cast<unsigned>(npc_handle_gen(bound)),
                 static_cast<unsigned>(pool.generation(newborn)),
                 static_cast<int>(paid), static_cast<int>(d.reward),
                 static_cast<unsigned>(log.row[q - 1].state));
    CHECK(paid == 0);
    CHECK(led.banked == 0);
    CHECK(log.earned == 0);
    CHECK(quest_state(log, q) == QuestState::Orphaned);
    CHECK(log.failed == 1u && log.orphaned == 1u);
    CHECK(log.completed == 0u && log.expired == 0u);
    // RELEASED, not merely unpaid: the clock and the kill count both go, so the newborn
    // never inherits work done for somebody else.
    CHECK(log.row[q - 1].progress == 0);
    CHECK(log.row[q - 1].remainingMs == 0u);

    // And the guard DISCRIMINATES rather than refusing everything: a handle minted from
    // the NEWBORN — same slot, current generation — is valid, and the row is takeable from
    // them, which is the quest-specific deviation (Orphaned, never terminal). Without this
    // every assertion above would also pass against a `handle_valid` that always said no.
    CHECK(pool.handle_valid(pool.handle(newborn)));
    CHECK(quest_eligible(log, q, d.floorLo));
    CHECK(quest_accept(log, pool, q, newborn, d.floorLo, led));
    CHECK(log.row[q - 1].giver == pool.handle(newborn));
    CHECK(log.row[q - 1].giver != bound);      // same id, demonstrably a different person
    for (int k = 0; k < d.target; ++k)
        quest_on_kill(log, static_cast<std::uint8_t>(d.subject));
    CHECK(quest_step(log, pool, inv, led, static_cast<std::uint32_t>(kSimStepMs)) ==
          d.reward);
    CHECK(quest_state(log, q) == QuestState::Complete);
    CHECK(log.completed == 1u);
    CHECK(led.banked == d.reward);
    // Counters do not un-count: the run really did lose the first attempt.
    CHECK(log.failed == 1u && log.orphaned == 1u);

    // **A corpse cannot be BOUND either**, which is the other half of the migration.
    // `pool.handle()` on a dead record returns the generation `kill()` already bumped, so
    // an accept that minted one would write an Active row `quest_step` orphans on the very
    // next tick — billing the run a `failed` for a job it never had. Refused instead, and
    // that refusal is why `quest_accept` takes the pool at all.
    NpcPool p3;
    p3.init();
    const NpcId corpse = p3.spawn();
    p3.kill(corpse);
    QuestLog fresh{};
    RunLedger led2{};
    CHECK(!quest_accept(fresh, p3, q, corpse, d.floorLo, led2));
    CHECK(!quest_accept(fresh, p3, q, 100000u, d.floorLo, led2));   // past high-water
    CHECK(!quest_accept(fresh, p3, q, kInvalidNpc, d.floorLo, led2));
    CHECK(quest_state(fresh, q) == QuestState::Unseen);   // nothing was written
    CHECK(fresh.failed == 0u);
    CHECK(quest_active_count(fresh) == 0);
}

// ---------------------------------------------------------------------------
// 8. Descend — the baseline guard, ported for a measured reason
// ---------------------------------------------------------------------------
void descending() {
    NpcPool pool;
    pool.init();
    const NpcId giver = pool.spawn();
    Inventory inv;

    QuestId q = kInvalidQuest;
    for (std::size_t i = 0; i < kQuestCount && q == kInvalidQuest; ++i)
        if (static_cast<ObjectiveKind>(kQuestTable[i].kind) == ObjectiveKind::Descend &&
            kQuestTable[i].prereq == kInvalidQuest)
            q = static_cast<QuestId>(i + 1);
    CHECK(q != kInvalidQuest);
    const QuestDef& d = quest_def(q);
    const int fz = d.floorLo;

    // A fresh run: takeable, and it pays only once the run actually goes deep.
    {
        QuestLog log{};
        RunLedger led{};
        CHECK(quest_accept(log, pool, q, giver, fz, led));
        CHECK(quest_step(log, pool, inv, led,
                         static_cast<std::uint32_t>(kSimStepMs)) == 0);
        CHECK(log.row[q - 1].progress == 0);
        // One floor short is still short.
        led.deepestFloor = -(d.target - 1);
        CHECK(quest_step(log, pool, inv, led,
                         static_cast<std::uint32_t>(kSimStepMs)) == 0);
        CHECK(log.row[q - 1].progress == d.target - 1);
        led.deepestFloor = -d.target;
        CHECK(quest_step(log, pool, inv, led,
                         static_cast<std::uint32_t>(kSimStepMs)) == d.reward);
        CHECK(led.banked == d.reward);
    }

    // **The guard.** A descent the run has ALREADY made is refused at accept. Without
    // it the row sits Active forever — `quest_step` skips it on `want <= baseline`,
    // `baseline` is stamped once, `RunLedger::deepestFloor` never falls — and then
    // clears as a failure for work the player was never able to do. contract.h records
    // an audit that collected 900 roubles on accept and 900 more on re-accept with the
    // player never moving.
    {
        QuestLog log{};
        RunLedger led{};
        led.deepestFloor = -d.target;      // exactly the target, in |z|
        CHECK(!quest_accept(log, pool, q, giver, fz, led));
        led.deepestFloor = -(d.target + 4);
        CHECK(!quest_accept(log, pool, q, giver, fz, led));
        // Up is depth too, and the ledger keeps only one high-water mark.
        led.deepestFloor = d.target;
        CHECK(!quest_accept(log, pool, q, giver, fz, led));
        CHECK(quest_state(log, q) == QuestState::Unseen);   // nothing was written
        led.deepestFloor = d.target - 1;
        CHECK(quest_accept(log, pool, q, giver, fz, led));
        CHECK(log.row[q - 1].baseline == static_cast<std::uint8_t>(d.target - 1));
    }
}

// ---------------------------------------------------------------------------
// 9. Text — rendered, sized, and byte-valid
// ---------------------------------------------------------------------------
void text() {
    NpcPool pool;
    pool.init();
    const NpcId giver = pool.spawn();
    QuestLog log{};
    RunLedger led{};

    char small[8] = {};
    CHECK(!quest_time_text(1000u, small, sizeof(small)));
    CHECK(!quest_offer_text(1, small, sizeof(small)));
    CHECK(!quest_line(log, 1, small, sizeof(small)));
    CHECK(!quest_offer_text(kInvalidQuest, small, sizeof(small)));
    char big[512] = {};
    CHECK(!quest_offer_text(static_cast<QuestId>(kQuestCount + 1), big, sizeof(big)));

    for (std::uint32_t ms : {0u, 1u, 999u, 1000u, 59999u, 90000u, 600000u, 3600000u,
                             7200000u}) {
        char t[32] = {};
        CHECK(quest_time_text(ms, t, sizeof(t)));
        CHECK(t[0] != '\0');
        CHECK(valid_utf8(t));
        CHECK(std::strlen(t) < sizeof(t) - 1);
    }

    // Every authored row renders, as an offer and as a HUD line, and every byte of every
    // one of them is valid UTF-8 — the hex-escape splice trap.
    for (std::size_t i = 0; i < kQuestCount; ++i) {
        const QuestId id = static_cast<QuestId>(i + 1);
        char obj[128] = {};
        CHECK(quest_objective_text(id, obj, sizeof(obj)));
        CHECK(obj[0] != '\0');
        CHECK(valid_utf8(obj));

        char off[512] = {};
        CHECK(quest_offer_text(id, off, sizeof(off)));
        CHECK(off[0] != '\0');
        CHECK(valid_utf8(off));
        CHECK(std::strlen(off) < sizeof(off) - 1);   // nothing was truncated

        char line[512] = {};
        CHECK(quest_line(log, id, line, sizeof(line)));
        CHECK(valid_utf8(line));
        CHECK(std::strlen(line) < sizeof(line) - 1);
    }

    // The HUD's active count tracks reality.
    CHECK(quest_active_count(log) == 0);
    CHECK(quest_accept(log, pool, 1, giver, quest_def(1).floorLo, led));
    CHECK(quest_active_count(log) == 1);
}

// ---------------------------------------------------------------------------
// 10. The save block
// ---------------------------------------------------------------------------
// `save.h` owns the FILE and is not this lane's to edit, so what is proved here is the
// BLOCK: lossless, deterministic, refusing rather than half-applying, and composable at
// a non-zero offset inside a bigger payload — which is exactly how save.cpp will hold it,
// between the contract book and the player snapshot.
void round_trip() {
    // static_assert and not CHECK: these are all constexpr, so a runtime comparison
    // would be a constant conditional (MSVC /W4 C4127) and the build must stay
    // warning-free. Compile-time is also the right place — a wire size that disagrees
    // with the struct should never link, let alone run.
    static_assert(kQuestRowWire == 14u);
    static_assert(kQuestLogWire == kQuestCount * kQuestRowWire + 28u);
    static_assert(kQuestLogWire == 294u);

    // EVERY field distinct, because a round-trip over zeroes passes even when the
    // serializer drops half the struct. Negative progress is included on purpose: it is
    // an `int32_t`, so the wire has to carry the sign.
    QuestLog a{};
    for (std::size_t i = 0; i < kQuestCount; ++i) {
        a.row[i].remainingMs = static_cast<std::uint32_t>(0x11110000u + i * 7u);
        a.row[i].progress = static_cast<std::int32_t>(i) - 5;
        // A real HANDLE and not a bare id, because that is what the field holds now — and
        // deliberately the SAME 32 bits the bare-id version of this line wrote:
        // (10 << kNpcPoolBits) | 0x000BCD00 + i == 0x00ABCD00 + i. So this documents the
        // new type while proving the wire did not move a single byte.
        a.row[i].giver = npc_handle(static_cast<NpcId>(0x000BCD00u + i), 10u);
        a.row[i].state = static_cast<std::uint8_t>(i % 5u);   // all five states appear
        a.row[i].baseline = static_cast<std::uint8_t>(120u + (i % 8u));
    }
    a.earned = -1234567890123ll;    // int64, and the sign has to survive
    a.completed = 0x01020304u;
    a.failed = 0x05060708u;
    a.expired = 0x090A0B0Cu;
    a.orphaned = 0x0D0E0F10u;
    a.rewardItemsLost = 0x11121314u;

    std::vector<std::uint8_t> buf;
    quest_log_write(a, buf);
    CHECK(buf.size() == kQuestLogWire);

    // Deterministic bytes: two writes of one log agree, which is what makes a checksum
    // over the payload meaningful.
    std::vector<std::uint8_t> buf2;
    quest_log_write(a, buf2);
    CHECK(buf == buf2);

    QuestLog b{};
    CHECK(quest_log_read(buf.data(), buf.size(), b));
    // Legitimate here and NOT in suite_saveload.inl: every byte of both structs is a
    // named field with a default initializer, so there is no implicit padding to differ.
    CHECK(std::memcmp(&a, &b, sizeof(QuestLog)) == 0);
    CHECK(b.earned == a.earned);
    CHECK(b.row[3].progress == a.row[3].progress);
    CHECK(b.row[kQuestCount - 1].giver == a.row[kQuestCount - 1].giver);
    // BOTH halves of the handle survive. The generation is the half a save could drop
    // without anything else noticing — every id would still resolve to a living record,
    // and every stored handle would then match whoever occupies that slot on load.
    CHECK(npc_handle_id(b.row[7].giver) == 0x000BCD07u);
    CHECK(npc_handle_gen(b.row[7].giver) == 10u);

    // Composes at an offset: save.cpp appends this block after others.
    std::vector<std::uint8_t> payload(37u, 0xA5u);
    quest_log_write(a, payload);
    CHECK(payload.size() == 37u + kQuestLogWire);
    QuestLog c{};
    CHECK(quest_log_read(payload.data() + 37, payload.size() - 37, c));
    CHECK(std::memcmp(&a, &c, sizeof(QuestLog)) == 0);

    // A short buffer is REFUSED and the destination is left completely alone. A
    // half-applied load would put the game into a state no run has ever been in.
    QuestLog keep{};
    keep.completed = 99u;
    const QuestLog before = keep;
    CHECK(!quest_log_read(buf.data(), kQuestLogWire - 1, keep));
    CHECK(std::memcmp(&keep, &before, sizeof(QuestLog)) == 0);
    CHECK(!quest_log_read(nullptr, kQuestLogWire, keep));
    CHECK(std::memcmp(&keep, &before, sizeof(QuestLog)) == 0);

    // A state byte no enumerator names is refused, not clamped. Row 0's state sits at
    // offset 4+4+4 = 12; restating the offset here is the point — if the wire is
    // reordered, this is where the test says so.
    std::vector<std::uint8_t> bad = buf;
    bad[12] = static_cast<std::uint8_t>(QuestState::Count);
    CHECK(!quest_log_read(bad.data(), bad.size(), keep));
    CHECK(std::memcmp(&keep, &before, sizeof(QuestLog)) == 0);
    bad[12] = 200u;
    CHECK(!quest_log_read(bad.data(), bad.size(), keep));
    // ...and the last legal value still parses, so the bound is not off by one.
    bad[12] = static_cast<std::uint8_t>(QuestState::Count) - 1u;
    CHECK(quest_log_read(bad.data(), bad.size(), keep));

    // THE STRONG CHECK. `QuestId` is a row index into a hand-ordered CSV, so inserting,
    // deleting, renaming or REORDERING a row silently redefines what a saved id means —
    // and a row COUNT catches only the first two. Re-derived independently, then shown
    // to move on a reorder at constant count, which is the case the count cannot see.
    const std::uint32_t fp = quest_table_fingerprint();
    CHECK(fp == quest_table_fingerprint());          // pure
    CHECK(fp != 0u);
    CHECK(fp == fnv_over(kQuestNames.data(), kQuestCount));
    const char* shuffled[kQuestCount];
    for (std::size_t i = 0; i < kQuestCount; ++i) shuffled[i] = kQuestNames[i];
    const char* tmp = shuffled[0];
    shuffled[0] = shuffled[1];
    shuffled[1] = tmp;
    CHECK(fnv_over(shuffled, kQuestCount) != fp);
    // Titles and not briefs, so fixing a typo in a sentence does not reject every
    // existing save: the fingerprint must be blind to the brief column.
    CHECK(fnv_over(kQuestBriefs.data(), kQuestCount) != fp);
}

// A finished job pays XP as well as roubles, and the difficulty it pays on is
// COMPOSED from context that already exists rather than authored in a column.
//
// The manifesto asks for XP from quests (p.5) and `xp_for_quest` was written for it
// in 2026, then sat with zero callers outside tests until 2026-08-12 — the roadmap
// filed it as "one line" when in fact the ARGUMENT had no source anywhere in the
// tree. What follows pins both halves: that the composite reads the context it
// claims to, and that the XP actually reaches the sheet.
static void xp_for_finishing_a_job() {
    // --- the composite responds to every input it names -----------------------
    // Each pair changes ONE input and nothing else, so a term that silently stops
    // being read fails here instead of quietly flattening the curve. This is the
    // "extensible" half made checkable: a new term adds a pair, it does not rewrite
    // the test.
    const std::uint8_t kFetch = static_cast<std::uint8_t>(ObjectiveKind::Fetch);
    const std::uint8_t kHunt = static_cast<std::uint8_t>(ObjectiveKind::Hunt);

    // depth
    CHECK(objective_difficulty_e1(kFetch, 1u, 1, 60, false) >
          objective_difficulty_e1(kFetch, 1u, 1, 0, false));
    // count
    CHECK(objective_difficulty_e1(kFetch, 1u, 5, 0, false) >
          objective_difficulty_e1(kFetch, 1u, 1, 0, false));
    // a clock
    CHECK(objective_difficulty_e1(kFetch, 1u, 1, 0, true) >
          objective_difficulty_e1(kFetch, 1u, 1, 0, false));
    // kind: hunting is dearer than fetching, all else equal
    CHECK(objective_difficulty_e1(kHunt, 0u, 1, 0, false) >
          objective_difficulty_e1(kFetch, 0u, 1, 0, false));
    // never zero, never wrapped, whatever it is handed
    CHECK(objective_difficulty_e1(kFetch, 0u, 0, 0, false) >= 1u);
    // Absurd inputs CLAMP rather than wrap. The failure this guards is not a crash,
    // it is a huge count coming back as a small difficulty through a uint16 wrap and
    // paying almost nothing — a bug that looks like balance.
    CHECK(objective_difficulty_e1(kHunt, 0xFFFFu, 1 << 20, 9999, true) == 65535u);

    // Descend's `target` is a FLOOR LABEL, not a count — the double meaning
    // [quest.h] warns about. Feeding it into the count term would make "descend to
    // -50" read as fifty items. Excluded by kind, and pinned here because the bug
    // would be invisible: it produces a plausible number, just a wrong one.
    const std::uint8_t kDesc = static_cast<std::uint8_t>(ObjectiveKind::Descend);
    CHECK(objective_difficulty_e1(kDesc, 0u, 50, 20, false) ==
          objective_difficulty_e1(kDesc, 0u, 1, 20, false));

    // --- calibration, printed so the numbers are arguable ---------------------
    // AGENTS.md §Measure: a balance figure nobody can see is a balance figure
    // nobody can dispute. These are real rows from data/quests.csv.
    // The WHOLE authored table, cheapest and dearest, plus the deep synthetic hunt
    // that only contracts produce — printing four consecutive rows told me nothing
    // because the first four are all Fetch, and a calibration that shows one kind is
    // not a calibration.
    std::size_t lowIdx = 0, highIdx = 0;
    std::uint16_t lowD = 0xFFFFu, highD = 0;
    for (std::size_t i = 0; i < kQuestCount; ++i) {
        const QuestDef& q = kQuestTable[i];
        const int a = q.floorLo < 0 ? -q.floorLo : q.floorLo;
        const int b = q.floorHi < 0 ? -q.floorHi : q.floorHi;
        const std::uint16_t v = objective_difficulty_e1(q.kind, q.subject, q.target,
                                                        a > b ? a : b, q.limitMs != 0);
        if (v < lowD) { lowD = v; lowIdx = i; }
        if (v > highD) { highD = v; highIdx = i; }
    }
    for (std::size_t i : {lowIdx, highIdx}) {
        const QuestDef& q = kQuestTable[i];
        const int a = q.floorLo < 0 ? -q.floorLo : q.floorLo;
        const int b = q.floorHi < 0 ? -q.floorHi : q.floorHi;
        const std::uint16_t v = objective_difficulty_e1(q.kind, q.subject, q.target,
                                                        a > b ? a : b, q.limitMs != 0);
        std::printf("[quest] %-8s row %2zu kind=%u target=%d band=%d..%d -> "
                    "difficulty %5.1f -> %4u xp (reward %d rub)\n",
                    i == lowIdx ? "cheapest" : "dearest", i,
                    static_cast<unsigned>(q.kind), q.target,
                    static_cast<int>(q.floorLo), static_cast<int>(q.floorHi),
                    static_cast<double>(v) / 10.0, xp_for_quest(v), q.reward);
    }
    {
        // What a deep contract hunt looks like: five of a heavy kind at |z| = 50.
        const std::uint16_t deep = objective_difficulty_e1(
            kHunt, static_cast<std::uint16_t>(MobKind::Polzun), 5, 50, false);
        std::printf("[quest] %-8s        5x Polzun at |z|=50            -> "
                    "difficulty %5.1f -> %4u xp\n",
                    "contract", static_cast<double>(deep) / 10.0, xp_for_quest(deep));
        // THE SPREAD IS THE ASSERTION. A composite whose hardest job pays like its
        // easiest is a constant wearing five terms — which is exactly what the first
        // version of the rarity term turned out to be, and it passed every
        // single-input check above while doing it.
        //
        // Asserted against the CHEAPEST, not against the dearest authored row: the
        // dearest is an 8-target hunt in a shallow band, and it legitimately rivals a
        // 5-target hunt at |z| = 50. Requiring the deep contract to beat it would be
        // asserting that depth outweighs count, which is a balance opinion nobody has
        // taken. Range is the property; the ordering between those two is not.
        CHECK(highD > lowD * 3u);   // the authored table itself is not flat
        CHECK(deep > lowD * 4u);    // and procedural depth reaches past all of it
    }
    // One mid-tier kill, for scale — the OTHER xp source the manifesto names, so the
    // ratio between them is visible instead of assumed.
    std::printf("[quest] scale: one Tvar kill at level 5 = %u xp; level 2 costs %u\n",
                xp_for_monster_kill(MobKind::Tvar, 5), xp_for_level(2));

    // --- and the XP actually lands on the sheet -------------------------------
    NpcPool pool;
    pool.init();
    QuestLog log{};
    Inventory inv{};
    RunLedger led{};
    const NpcId giver = pool.spawn();

    // The quest is resolved by WALKING THE TABLE, exactly as `the_chain` does, and
    // not by `quest_offer`: an offer is a hash over the giver, so picking the job
    // that way makes the test depend on which NpcId happened to come back. A content
    // edit that reorders the CSV must not silently retarget this at another quest.
    QuestId head = kInvalidQuest;
    for (std::size_t i = 0; i < kQuestCount && head == kInvalidQuest; ++i)
        if (kQuestTable[i].prereq == kInvalidQuest &&
            static_cast<ObjectiveKind>(kQuestTable[i].kind) == ObjectiveKind::Fetch &&
            kQuestTable[i].floorLo <= 0 && kQuestTable[i].floorHi >= 0)
            head = static_cast<QuestId>(i + 1);
    CHECK(head != kInvalidQuest);
    CHECK(quest_accept(log, pool, head, giver, 0, led));
    const QuestDef& d = quest_def(head);
    for (int k = 0; k < d.target; ++k) (void)quest_grant_item(inv, d.subject, 1);

    RpgStats sheet = fresh_rpg();
    const std::uint32_t before = sheet.xp;
    const std::uint8_t levelBefore = sheet.level;
    CHECK(quest_step(log, pool, inv, led, static_cast<std::uint32_t>(kSimStepMs),
                     &sheet) == d.reward);
    CHECK(quest_state(log, head) == QuestState::Complete);
    std::printf("[quest] xp on completion: %u -> %u (level %u -> %u)\n", before,
                sheet.xp, static_cast<unsigned>(levelBefore),
                static_cast<unsigned>(sheet.level));
    // Non-zero, and not the whole of a level: a quest is worth a few kills, never a
    // level, which is the ratio the manifesto's two XP sources imply.
    CHECK(sheet.xp > before || sheet.level > levelBefore);

    // WITHOUT a sheet the money half is byte-identical. The optional argument must
    // buy an addition, never a change — every existing caller passes nullptr.
    QuestLog log2{};
    Inventory inv2{};
    RunLedger led2{};
    CHECK(quest_accept(log2, pool, head, giver, 0, led2));
    for (int k = 0; k < d.target; ++k) (void)quest_grant_item(inv2, d.subject, 1);
    CHECK(quest_step(log2, pool, inv2, led2,
                     static_cast<std::uint32_t>(kSimStepMs)) == d.reward);
    CHECK(led2.banked == led.banked);
}

} // namespace quest_test

static void test_quest_all() {
    quest_test::xp_for_finishing_a_job();
    quest_test::catalog_is_reachable();
    quest_test::offers();
    quest_test::the_chain();
    quest_test::hunting();
    quest_test::the_clock_runs_out();
    quest_test::the_giver_dies();
    quest_test::the_slot_is_recycled();
    quest_test::descending();
    quest_test::text();
    quest_test::round_trip();
}
