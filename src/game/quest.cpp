#include "game/quest.h"

#include <cstdio>
#include <cstring>

namespace giga::game {

namespace {

// The same 32-bit finalizer contract.cpp uses. Duplicated rather than shared because
// it is a file-static there and hoisting it would be an edit to contract.cpp for no
// behavioural reason; both are the well-known lowbias32 constants, so the two cannot
// drift into disagreement about anything that matters.
#include "core/rng.h"
// ---------------------------------------------------------------------------
// Russian text fragments, as hex escapes
// ---------------------------------------------------------------------------
// ASCII source, exactly like contract.cpp's `contract_text`. This file is HAND-written,
// so the Cyrillic that ships in this lane lives only in machine-written files
// (data/quests.csv and the generated quest_table.cpp) where an encoding accident cannot
// be introduced by a careless editor.
//
// **Every fragment is its own named constant and never spliced into a format string.**
// A C++ hex escape eats as many hex digits as it can, so `"\xd0\xbead"` is one
// character `\xd0bead` and not "о" followed by "ad" — a silent corruption that compiles.
// Keeping the escapes out of the format strings entirely makes that mistake
// unexpressible rather than merely avoided.
constexpr const char kRub[] = "\xd1\x80\xd1\x83\xd0\xb1.";                 // "rub."
constexpr const char kSrok[] = "\xd1\x81\xd1\x80\xd0\xbe\xd0\xba";         // "srok"
constexpr const char kDepth[] =
    "\xd0\xb3\xd0\xbb\xd1\x83\xd0\xb1\xd0\xb8\xd0\xbd\xd0\xb0";           // "glubina"
constexpr const char kLQuote[] = "\xc2\xab";                              // guillemets
constexpr const char kRQuote[] = "\xc2\xbb";
constexpr const char kHourCh[] = "\xd1\x87";                              // ch
constexpr const char kMinCh[] = "\xd0\xbc";                               // m
constexpr const char kSecCh[] = "\xd1\x81";                               // s

// Longest thing any of the text helpers builds. A title is at most a line, a brief at
// most a sentence, and the objective at most a name plus a count; 320 covers all three
// concatenated with room to spare, and the helpers REFUSE a smaller buffer rather than
// truncating into something plausible.
constexpr std::size_t kTextCap = 320;
constexpr std::size_t kObjCap = 96;
constexpr std::size_t kTimeCap = 24;

// A row's own objective sentence fragment, without title or reward.
bool objective_text(const QuestDef& d, char* out, std::size_t cap) {
    if (!out || cap < kObjCap) return false;
    switch (static_cast<ObjectiveKind>(d.kind)) {
        case ObjectiveKind::Fetch:
            if (!item_valid(d.subject)) return false;
            std::snprintf(out, cap, "%s x%d", item_name(d.subject),
                          static_cast<int>(d.target));
            return true;
        case ObjectiveKind::Hunt:
            if (static_cast<std::size_t>(d.subject) >= kMobKindCount) return false;
            std::snprintf(out, cap, "%s x%d",
                          mob_name(static_cast<MobKind>(d.subject)),
                          static_cast<int>(d.target));
            return true;
        case ObjectiveKind::Descend:
            std::snprintf(out, cap, "%s %d", kDepth, static_cast<int>(d.target));
            return true;
        default:
            return false;
    }
}

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------
// One traversal, two directions — the pattern save.cpp documents at length: a
// hand-written write/read pair is where save formats break, because the two halves
// drift by one field and the result is a load that succeeds with every later field
// shifted. With one `visit_*` that bug is not expressible.
//
// `Writer` / `Reader` are re-declared here because save.cpp's are file-static and
// save.cpp is not this lane's to edit. They are byte-for-byte the same convention:
// little-endian, one field at a time, no padding and no host byte order in the file.
// Hoisting one copy into an internal header is a real cleanup and is reported as such.
class Writer {
public:
    explicit Writer(std::vector<std::uint8_t>& out) : out_(&out) {}

    void u8(const std::uint8_t& v) { out_->push_back(v); }
    void u32(const std::uint32_t& v) {
        for (int i = 0; i < 4; ++i)
            out_->push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu));
    }
    void u64(const std::uint64_t& v) {
        for (int i = 0; i < 8; ++i)
            out_->push_back(static_cast<std::uint8_t>((v >> (i * 8)) & 0xFFu));
    }
    // Signed -> unsigned is modular and always has been; unsigned -> signed is
    // well-defined since C++20 mandated two's complement, and this tree is C++23. So a
    // negative count round-trips exactly.
    void i32(const std::int32_t& v) { u32(static_cast<std::uint32_t>(v)); }
    void i64(const std::int64_t& v) { u64(static_cast<std::uint64_t>(v)); }

private:
    std::vector<std::uint8_t>* out_;
};

// Bounds-checked in ONE place — `u8` — so no visitor has to know how long the buffer
// is. Once `ok_` is false every later field reads as zero and the parse is discarded.
class Reader {
public:
    Reader(const std::uint8_t* p, std::size_t n) : p_(p), n_(n) {}

    void u8(std::uint8_t& v) {
        if (at_ >= n_) {
            ok_ = false;
            v = 0;
            return;
        }
        v = p_[at_++];
    }
    void u32(std::uint32_t& v) {
        std::uint8_t b[4] = {};
        for (int i = 0; i < 4; ++i) u8(b[i]);
        v = static_cast<std::uint32_t>(b[0]) |
            (static_cast<std::uint32_t>(b[1]) << 8) |
            (static_cast<std::uint32_t>(b[2]) << 16) |
            (static_cast<std::uint32_t>(b[3]) << 24);
    }
    void u64(std::uint64_t& v) {
        std::uint8_t b[8] = {};
        for (int i = 0; i < 8; ++i) u8(b[i]);
        v = 0;
        for (int i = 7; i >= 0; --i)
            v = (v << 8) | static_cast<std::uint64_t>(b[i]);
    }
    void i32(std::int32_t& v) {
        std::uint32_t u = 0;
        u32(u);
        v = static_cast<std::int32_t>(u);
    }
    void i64(std::int64_t& v) {
        std::uint64_t u = 0;
        u64(u);
        v = static_cast<std::int64_t>(u);
    }

    bool ok() const { return ok_; }
    std::size_t at() const { return at_; }

private:
    const std::uint8_t* p_;
    std::size_t n_;
    std::size_t at_ = 0;
    bool ok_ = true;
};

// `pad_` is deliberately NOT written: it carries no meaning, and emitting it would put
// two bytes of nothing per row into every save. That is why kQuestRowWire is 14 and
// sizeof(QuestProgress) is 16.
//
// `p.giver` is an `NpcHandle`, which is the same `std::uint32_t` an `NpcId` was, so this
// stays one `u32` at the same offset and the wire did not move when the field gained its
// generation half ([quest.h] save banner).
template <class Ar, class Row>
void visit_quest_row(Ar& ar, Row& p) {
    ar.u32(p.remainingMs);
    ar.i32(p.progress);
    ar.u32(p.giver);
    ar.u8(p.state);
    ar.u8(p.baseline);
}

template <class Ar, class Log>
void visit_quest_log(Ar& ar, Log& log) {
    for (auto& r : log.row) visit_quest_row(ar, r);
    ar.i64(log.earned);
    ar.u32(log.completed);
    ar.u32(log.failed);
    ar.u32(log.expired);
    ar.u32(log.orphaned);
    ar.u32(log.rewardItemsLost);
}

// FNV-1a, including each string's terminator so the row boundary is part of the hash —
// the same construction and the same reason save.cpp's `fnv1a_cstr` gives: without the
// terminator "ab" + "c" hashes identically to "a" + "bc".
std::uint32_t fnv1a_cstr(std::uint32_t h, const char* s) {
    if (!s) return h;
    for (const char* p = s;; ++p) {
        h ^= static_cast<std::uint32_t>(static_cast<std::uint8_t>(*p));
        h *= 0x01000193u;
        if (*p == '\0') break;
    }
    return h;
}

} // namespace

// ---------------------------------------------------------------------------
// Eligibility, offering, taking
// ---------------------------------------------------------------------------

bool quest_eligible(const QuestLog& log, QuestId id, int floorZ) {
    if (!quest_valid(id)) return false;
    const QuestDef& d = quest_def(id);
    if (floorZ < static_cast<int>(d.floorLo) || floorZ > static_cast<int>(d.floorHi))
        return false;

    // Unseen or Orphaned. Orphaned is takeable again on purpose — the failure is
    // already counted and visible, and making a dead citizen delete authored content
    // for the rest of the run is the opposite of a consequence. [quest.h]
    const std::uint8_t st = log.row[static_cast<std::size_t>(id) - 1].state;
    if (st != static_cast<std::uint8_t>(QuestState::Unseen) &&
        st != static_cast<std::uint8_t>(QuestState::Orphaned))
        return false;

    if (d.prereq != kInvalidQuest) {
        if (!quest_valid(d.prereq)) return false;
        if (log.row[static_cast<std::size_t>(d.prereq) - 1].state !=
            static_cast<std::uint8_t>(QuestState::Complete))
            return false;
    }
    return true;
}

QuestId quest_offer(const NpcPool& pool, const QuestLog& log, NpcId giver, int floorZ,
                    std::uint32_t seed) {
    // `valid` and `alive` are both const on NpcPool, so no const_cast is needed here.
    // (contract_offer casts the constness away and does not have to; noted, not copied.)
    if (giver == kInvalidNpc || !pool.valid(giver) || !pool.alive(giver))
        return kInvalidQuest;

    // Deterministic in (giver, floor, seed), like `rumour_for` and `contract_offer`: the
    // same person on the same floor always offers the same thing, so walking away and
    // coming back cannot reroll it into something better. A different multiplier from
    // contract.cpp's so a body's quest roll and its contract roll are independent.
    const std::uint32_t h = giga::hash_u32(static_cast<std::uint32_t>(giver) * 0x9e3779b9u ^
                                static_cast<std::uint32_t>(floorZ) * 0xa24baed1u ^ seed);
    if ((h % 100u) >= kQuestOfferPct) return kInvalidQuest;   // not carrying anything

    // Reservoir choice over the eligible rows: one pass, no vector, no allocation, and
    // uniform over however many happen to be eligible on this floor right now.
    QuestId pick = kInvalidQuest;
    std::uint32_t seen = 0;
    for (std::size_t i = 0; i < kQuestCount; ++i) {
        const QuestId id = static_cast<QuestId>(i + 1);
        if (!quest_eligible(log, id, floorZ)) continue;
        ++seen;
        if (giga::hash_u32(h ^ seen) % seen == 0u) pick = id;
    }
    return pick;
}

bool quest_accept(QuestLog& log, const NpcPool& pool, QuestId id, NpcId giver, int floorZ,
                  const RunLedger& led) {
    // A living body, checked BEFORE anything is written, because the handle minted below
    // is only meaningful for one: `pool.handle()` on a corpse returns the generation
    // `kill()` already bumped, so the row would be Active for exactly one tick and then
    // billed as `orphaned` for a job that was never takeable. A refusal, not an error.
    if (giver == kInvalidNpc || !pool.valid(giver) || !pool.alive(giver)) return false;
    if (!quest_eligible(log, id, floorZ)) return false;
    const QuestDef& d = quest_def(id);

    // Stamped from the ledger rather than by the caller, so it cannot be forgotten.
    // |z| because depth is bidirectional; clamped to a byte because the stack is bounded
    // at +/-127 ([floor_registry.h]). Hoisted above the Descend refusal because that
    // refusal has to compare against the exact value that would be written —
    // recomputing it differently there is how this guard would go subtly wrong.
    const int already = led.deepestFloor < 0 ? -led.deepestFloor : led.deepestFloor;
    const std::uint8_t baseline =
        static_cast<std::uint8_t>(already > 127 ? 127 : already);

    // A descent the run has already made is REFUSED here, exactly as contract_accept
    // refuses it and for the measured reason contract.h records: quest_step skips such a
    // row forever on `want <= baseline`, `baseline` is written once, and
    // `RunLedger::deepestFloor` never falls — so Complete is unreachable and the row
    // eventually clears as a FAILURE for work the player could never have done.
    if (d.kind == static_cast<std::uint8_t>(ObjectiveKind::Descend)) {
        const int want = d.target < 0 ? -d.target : d.target;
        if (want <= static_cast<int>(baseline)) return false;
    }

    // A re-taken (previously Orphaned) row starts over: fresh clock, fresh progress. See
    // quest_on_giver_died for why carrying the remainder would be a punishment for
    // something the player did not do.
    QuestProgress& p = log.row[static_cast<std::size_t>(id) - 1];
    p = QuestProgress{};
    p.state = static_cast<std::uint8_t>(QuestState::Active);
    // Minted HERE and nowhere else: the bare id is what `quest_offer` hashed and what the
    // caller holds, this is the (generation, id) pair that outlives the tick. `giver` is
    // known live from the guard at the top, so `handle()` reads a real generation rather
    // than the 0 an out-of-range id would return. [quest.h]
    p.giver = pool.handle(giver);
    p.baseline = baseline;
    p.remainingMs = d.limitMs;
    return true;
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

int quest_grant_item(Inventory& inv, ItemId item, int count) {
    if (!item_valid(item) || count <= 0) return 0;
    const std::uint16_t unplaced = inventory_give(inv, item, static_cast<std::uint16_t>(count));
    return count - static_cast<int>(unplaced);
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

std::int32_t quest_step(QuestLog& log, const NpcPool& pool, Inventory& inv,
                        RunLedger& led, std::uint32_t stepMs, RpgStats* rpg) {
    std::int32_t paid = 0;

    for (std::size_t i = 0; i < kQuestCount; ++i) {
        QuestProgress& p = log.row[i];
        if (p.state != static_cast<std::uint8_t>(QuestState::Active)) continue;
        const QuestDef& d = kQuestTable[i];

        // 1. THE GIVER, FIRST. A giver who died between ticks releases the quest.
        // Checked here as well as on the death event, for contract.cpp's reason: a body
        // can also be lost to a floor unload rather than to a death, and only one of
        // those publishes. Ordered ahead of the deadline so a row is never billed as
        // `expired` when there was nobody left to deliver to.
        //
        // **THE recycling guard.** `handle_valid` is one test for three distinct ways the
        // person can stop being the person: an id past the high-water mark, a cleared
        // alive bit, and — the one a bare id could never see — a stale GENERATION, i.e.
        // the slot was reclaimed and handed to somebody else. `kill()` bumps the counter
        // whether or not the slot is reused, so this covers a plain death too and the old
        // `!valid(id) || !alive(id)` pair is strictly subsumed. Deaths in the macro sweep
        // publish no NpcDied event ([macro_sim.h]), so for those this poll is the ONLY
        // guard, and before the handle it was a poll that answered "somebody is alive at
        // that index" when the question was "is my giver alive". [quest.h]
        if (!pool.handle_valid(p.giver)) {
            p.state = static_cast<std::uint8_t>(QuestState::Orphaned);
            p.remainingMs = 0;
            p.progress = 0;
            ++log.failed;
            ++log.orphaned;
            continue;
        }

        // 2. THE CLOCK. Only rows whose DEF carries a limit have one, so a zero
        // `remainingMs` on a no-deadline row can never be mistaken for "already
        // expired" — including by a load. `stepMs == 0` freezes every clock, which is
        // what a test wants when it is measuring something else.
        if (d.limitMs != 0) {
            if (p.remainingMs <= stepMs) {
                p.remainingMs = 0;
                p.state = static_cast<std::uint8_t>(QuestState::Expired);
                ++log.failed;
                ++log.expired;
                continue;
            }
            p.remainingMs -= stepMs;
        }

        // 3. THE OBJECTIVE. Measured by the same three systems contract_step measures
        // through — there is one notion of each objective in this engine.
        switch (static_cast<ObjectiveKind>(d.kind)) {
            case ObjectiveKind::Fetch: {
                std::int32_t have = 0;
                for (const ItemSlot& s : inv.slots)
                    if (s.item == d.subject) have += static_cast<std::int32_t>(s.count);
                p.progress = have;
                if (have < d.target) continue;
                // CONSUME. A courier job that let you keep the cargo would pay twice
                // for the same loot — once as the reward and once as the haul.
                std::int32_t need = d.target;
                for (ItemSlot& s : inv.slots) {
                    if (need <= 0) break;
                    if (s.item != d.subject) continue;
                    const std::int32_t take =
                        static_cast<std::int32_t>(s.count) < need
                            ? static_cast<std::int32_t>(s.count)
                            : need;
                    s.count = static_cast<std::uint16_t>(
                        static_cast<std::int32_t>(s.count) - take);
                    if (s.count == 0) s.item = kInvalidItem;
                    need -= take;
                }
                break;
            }
            case ObjectiveKind::Hunt:
                if (p.progress < d.target) continue;
                break;
            case ObjectiveKind::Descend: {
                // |z|, because depth is bidirectional here and `RunLedger` keeps only
                // ONE high-water mark. That is why data/quests.csv authors a Descend as
                // a DEPTH rather than as a signed label: comparing the sign as well
                // would make an up-quest permanently unsatisfiable for any run that
                // went deeper down first, which is strictly worse than the ambiguity.
                const int reached =
                    led.deepestFloor < 0 ? -led.deepestFloor : led.deepestFloor;
                const int want = d.target < 0 ? -d.target : d.target;
                if (reached < want) {
                    p.progress = reached;
                    continue;
                }
                if (want <= static_cast<int>(p.baseline)) continue;
                p.progress = reached;
                break;
            }
            default:
                continue;
        }

        p.state = static_cast<std::uint8_t>(QuestState::Complete);
        // Paid straight into the banked total, for contract.h's reason: a job's reward
        // is not carried loot and must not be at risk on the walk home.
        const std::uint32_t reward = rpg != nullptr
            ? static_cast<std::uint32_t>((static_cast<std::uint64_t>(d.reward) * int_contract_reward_mult_e3(*rpg) + 500u) / 1000u)
            : d.reward;
        led.banked += reward;
        log.earned += reward;
        ++log.completed;
        paid += reward;

        // The item half of the reward goes into the BAG, not into the bank — it is a
        // thing, not money, and it is at risk like everything else you carry.
        if (d.rewardItem != kInvalidItem && d.rewardCount != 0) {
            const int wanted = static_cast<int>(d.rewardCount);
            const int landed = quest_grant_item(inv, d.rewardItem, wanted);
            log.rewardItemsLost += static_cast<std::uint32_t>(wanted - landed);
        }

        // XP, through the ONE path that awards it ([rpg.cpp] award_xp, the only thing
        // that levels anyone up). Manifest p.5 asks for XP from quests as well as
        // kills; `xp_for_quest` was written for it and had no caller outside tests
        // until 2026-08-12.
        //
        // Depth comes from the row's own AUTHORED BAND, not from where the player
        // happens to be standing: `floorLo`/`floorHi` are what the designer said this
        // job is about, and the deeper end is the one that characterises it. Using the
        // live floor instead would make the same quest worth more because it was
        // handed in downstairs, which is a farm, not a difficulty.
        if (rpg != nullptr) {
            const int lo = d.floorLo < 0 ? -d.floorLo : d.floorLo;
            const int hi = d.floorHi < 0 ? -d.floorHi : d.floorHi;
            award_xp(*rpg, xp_for_quest(objective_difficulty_e1(
                               d.kind, d.subject, d.target, lo > hi ? lo : hi,
                               /*timed=*/d.limitMs != 0)));
        }
    }
    return paid;
}

void quest_on_kill(QuestLog& log, std::uint8_t mobKind) {
    for (std::size_t i = 0; i < kQuestCount; ++i) {
        QuestProgress& p = log.row[i];
        if (p.state != static_cast<std::uint8_t>(QuestState::Active)) continue;
        const QuestDef& d = kQuestTable[i];
        if (d.kind != static_cast<std::uint8_t>(ObjectiveKind::Hunt)) continue;
        if (d.subject != static_cast<std::uint16_t>(mobKind)) continue;
        if (p.progress < d.target) ++p.progress;
    }
}

void quest_on_giver_died(QuestLog& log, NpcId who) {
    if (who == kInvalidNpc) return;
    for (std::size_t i = 0; i < kQuestCount; ++i) {
        QuestProgress& p = log.row[i];
        if (p.state != static_cast<std::uint8_t>(QuestState::Active)) continue;
        // The ID HALF of the handle, because `who` is a bare pool id off the event ring
        // and the record is ALREADY DEAD when this runs — `pool.handle(who)` would mint
        // the corpse's bumped generation and match nothing. `npc_handle_id` masks to
        // kNpcPoolBits, so a `who` of kInvalidNpc could never match a stored handle even
        // without the early return above: never a wildcard.
        //
        // Coarser than `handle_valid`, and harmlessly so. The one case it over-matches is
        // a row whose giver died silently (a macro sweep publishes no event) into a slot
        // that was recycled, whose NEW occupant then dies in combat — and the verdict it
        // reaches there, Orphaned, is the same one quest_step's handle_valid poll reaches
        // for that row on the very next tick. It cannot pay a stranger, only release
        // earlier.
        if (npc_handle_id(p.giver) != who) continue;
        p.state = static_cast<std::uint8_t>(QuestState::Orphaned);
        p.remainingMs = 0;
        p.progress = 0;
        ++log.failed;
        ++log.orphaned;
    }
}

int quest_active_count(const QuestLog& log) {
    int n = 0;
    for (std::size_t i = 0; i < kQuestCount; ++i)
        if (log.row[i].state == static_cast<std::uint8_t>(QuestState::Active)) ++n;
    return n;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

bool quest_time_text(std::uint32_t ms, char* out, std::size_t cap) {
    if (!out || cap < kTimeCap) return false;
    // Rounded UP, so a HUD never shows "0s" on a quest that is still alive.
    const std::uint32_t total = (ms + 999u) / 1000u;
    const unsigned h = static_cast<unsigned>(total / 3600u);
    const unsigned m = static_cast<unsigned>((total % 3600u) / 60u);
    const unsigned s = static_cast<unsigned>(total % 60u);
    // Hours are not folded into days. The authored band tops out at 7200 s = 2 h
    // ([quest.h]), so days would be a unit nothing can currently reach, and an
    // unbounded hour count stays unambiguous if that ever changes.
    if (h > 0) std::snprintf(out, cap, "%u%s %02u%s", h, kHourCh, m, kMinCh);
    else if (m > 0) std::snprintf(out, cap, "%u%s %02u%s", m, kMinCh, s, kSecCh);
    else std::snprintf(out, cap, "%u%s", s, kSecCh);
    return true;
}

bool quest_objective_text(QuestId id, char* out, std::size_t cap) {
    if (!quest_valid(id)) return false;
    return objective_text(quest_def(id), out, cap);
}

bool quest_offer_text(QuestId id, char* out, std::size_t cap) {
    if (!quest_valid(id) || !out || cap < kTextCap) return false;
    const QuestDef& d = quest_def(id);
    char obj[kObjCap] = {};
    if (!objective_text(d, obj, sizeof(obj))) return false;

    char clock[kTimeCap + 16] = {};
    if (d.limitMs != 0) {
        char t[kTimeCap] = {};
        if (quest_time_text(d.limitMs, t, sizeof(t)))
            std::snprintf(clock, sizeof(clock), " | %s %s", kSrok, t);
    }
    std::snprintf(out, cap, "%s%s%s %s [%s] %d %s%s", kLQuote, quest_name(id), kRQuote,
                  quest_brief(id), obj, static_cast<int>(d.reward), kRub, clock);
    return true;
}

bool quest_line(const QuestLog& log, QuestId id, char* out, std::size_t cap) {
    if (!quest_valid(id) || !out || cap < kTextCap) return false;
    const QuestDef& d = quest_def(id);
    const QuestProgress& p = log.row[static_cast<std::size_t>(id) - 1];
    char obj[kObjCap] = {};
    if (!objective_text(d, obj, sizeof(obj))) return false;

    char clock[kTimeCap + 16] = {};
    if (d.limitMs != 0) {
        char t[kTimeCap] = {};
        if (quest_time_text(p.remainingMs, t, sizeof(t)))
            std::snprintf(clock, sizeof(clock), " | %s %s", kSrok, t);
    }
    std::snprintf(out, cap, "%s%s%s [%s] %d/%d %d %s%s", kLQuote, quest_name(id),
                  kRQuote, obj, static_cast<int>(p.progress),
                  static_cast<int>(d.target), static_cast<int>(d.reward), kRub, clock);
    return true;
}

// ---------------------------------------------------------------------------
// Save block
// ---------------------------------------------------------------------------

std::uint32_t quest_table_fingerprint() {
    std::uint32_t h = 0x811C9DC5u;
    for (std::size_t i = 0; i < kQuestCount; ++i) h = fnv1a_cstr(h, kQuestNames[i]);
    return h;
}

void quest_log_write(const QuestLog& log, std::vector<std::uint8_t>& out) {
    Writer w(out);
    visit_quest_log(w, log);
}

bool quest_log_read(const std::uint8_t* bytes, std::size_t n, QuestLog& log) {
    if (!bytes || n < kQuestLogWire) return false;

    // Parsed into a LOCAL and only assigned once every byte has been accepted. A
    // half-applied load would put the game into a state no run has ever been in, which
    // is the same stance `save_read` takes for the file as a whole.
    QuestLog tmp{};
    Reader r(bytes, kQuestLogWire);
    visit_quest_log(r, tmp);
    if (!r.ok() || r.at() != kQuestLogWire) return false;
    for (std::size_t i = 0; i < kQuestCount; ++i)
        if (tmp.row[i].state >= static_cast<std::uint8_t>(QuestState::Count))
            return false;

    log = tmp;
    return true;
}

} // namespace giga::game
