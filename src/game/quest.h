// Quests — the authored half of "somebody asked you to", and a clock that can run out.
//
// ---------------------------------------------------------------------------
// THE DECISION, UP FRONT: A LAYER OVER CONTRACTS, NOT A SECOND JOB SYSTEM
// ---------------------------------------------------------------------------
// [contract.h] already turns the world into errands, and it is closer to a quest
// system than its name suggests. This file does NOT re-answer any question contract.h
// answered. It reuses `ObjectiveKind` verbatim, measures progress off the same three
// systems (inventory for Fetch, the `NpcDied` event ring for Hunt,
// `RunLedger::deepestFloor` for Descend), and pays into the same `RunLedger::banked`.
// There is exactly one enum of objectives in this engine and one place each of them is
// measured. What is layered on top is the four things a hash cannot produce:
//
//   1. AUTHORED CONTENT. `contract_offer` is 100 % procedural and *must* be: its whole
//      completability guarantee comes from only ever naming what
//      `item_weight_on_floor` and the spawn roster can produce. A designer naming a
//      target has no such construction, so the guarantee is re-earned at BUILD time by
//      `tools/gen_quest_table.py` against `data/items.csv` and `data/mobs.csv`. That is
//      why the catalog is a CSV and a generator, like every other content table here.
//      The gate is strictly stronger than what a procedural roll can afford: a Hunt row
//      must live at the habitat anchor of *every* floor in its offer band, which
//      contract.cpp measured as too expensive for a roll (Hunt offers on -50 collapse
//      32 -> 5) and which an authored row pays for once, offline.
//   2. CHAINS. A `prereq` link, so a job can be the consequence of a finished one.
//      `contract_offer` is deterministic in (giver, floor, seed) and deliberately
//      refuses to consult run history, because an offer that shifted for invisible
//      reasons would be illegible. A chain gate is the opposite of invisible: you
//      finished step 1, so step 2 appeared. So it is gated at OFFER here rather than
//      refused at accept the way contract.cpp handles a stale Descend — showing the
//      player step 5 and then refusing it would teach nothing.
//   3. DEADLINES. The mechanic contracts have no field for. See the clock note below.
//   4. AN ITEM REWARD. A contract pays roubles only. A quest can also hand you a thing,
//      which is how the reference's `rewardItem` works and the only reward channel this
//      engine has besides money (it has no XP and no per-person relation column).
//
// **Why not simply extend `Contract`?** Three reasons, in order of weight.
//   * `Contract` is a `static_assert(sizeof == 24)` POD whose ON-DISK footprint is
//     pinned at `kContractWire = 21` ([save.h]). A deadline field would change the
//     meaning of a shipped byte layout for a field that is 0 on 100 % of the rows
//     `contract_offer` can produce — it has no clock in scope and no reason to grow one.
//     A new block changes no existing byte.
//   * A contract IS its giver: generated from them, priced off the floor they stand on,
//     failed when they die. An authored row exists in the table whether anybody is alive
//     to ask, and the giver is bound at accept. Those are different lifetimes, and
//     `QuestState` below has to say so.
//   * The book is three slots because "three jobs you remember beats ten you cannot".
//     A quest log has to be dense over the whole catalog anyway (chains need
//     `is step 1 done` in O(1)), so it has no slot pressure to inherit.
//
// ---------------------------------------------------------------------------
// THE CLOCK: SIM TIME, IN INTEGER MILLISECONDS
// ---------------------------------------------------------------------------
// A deadline is stored as a countdown in whole milliseconds and decremented by
// `giga::kSimStepMs` once per sim step. Four reasons, and the fourth is a measurement
// that rules out the obvious alternative:
//
//   1. It is the clock the player's own actions run on. A deadline you can beat by
//      playing faster has to tick at the rate you play.
//   2. Integer milliseconds is already this engine's timer unit — every mob cooldown,
//      windup, reload and samosbor phase is one ([core/tick.h]) — and at 125 Hz
//      `kSimStepMs` is EXACTLY 8, so the countdown is lossless. That is the entire
//      reason tick.h exists: at the old 1/120 the same conversion truncated 8.833 to 8
//      and stretched every authored duration by 4.17 %.
//   3. Milliseconds, not ticks, so the wire stays rate-independent. `SaveHeader::tickHz`
//      is documented as advisory *"the moment a tick count ... enters this format, this
//      field becomes load-bearing"* ([save.h]). Storing ms instead means a save written
//      at 125 Hz still means the same amount of time at any other rate, and that
//      sentence stays unspent.
//   4. **NOT `MacroSim::day_tenths()`, and the reason is granularity rather than
//      taste.** `kMacroPeriodTicks` is `kSimHz * 2` and `MacroParams::daysPerTick`
//      defaults to 7, so the coarse clock advances 70 tenth-days every 2.0 s of wall
//      time. Its smallest possible increment is SEVEN in-fiction days, which is coarser
//      than every deadline the reference authors — its band is 60 minutes to 5 days —
//      so a 24-hour deadline would expire on the next macro step no matter what the
//      player did, and so would a 5-day one. A clock whose tick is larger than every
//      interval you want to measure cannot measure any of them. Independently,
//      [AGENTS.md] forbids coupling macrosim to the sim tick in either direction.
//
// The authored band is the reference's own, unscaled, and that is a lucky and checkable
// fact rather than a coincidence: `quest_deadlines.ts` authors 60 through 7200
// in-fiction minutes, and `main.ts` advances `clock.totalMinutes += dt` with `dt` in
// real seconds under its own comment *"1 real second = 1 game minute"*. So its band is
// 60..7200 REAL seconds — 1 minute to 2 hours of play — which sits naturally against
// this engine's survival window of 9.7..13.9 minutes on water and 14.6..20.8 on food
// ([needs.h]). A 24-hour reference deadline is 24 minutes of play: a bit more than one
// full trip.
//
// **`limitMs == 0` means no deadline, and that is a PORT rather than a loophole.** The
// reference exempts hand-authored quests from expiry outright (`isHandAuthoredQuest`,
// quest_deadlines.ts:31) so a story cannot be lost to a clock. Here that exemption is
// data, not a code branch, and it is narrowed to the head of each chain: a chain must
// always be startable, but every step after the first carries a real clock, and losing
// one closes the chain. That is the consequence the reference's own design doc asks for
// ("принять смерть как consequence"), applied to time instead of to a body.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <vector>

// ObjectiveKind, NpcId/NpcPool, RunLedger, Inventory, ItemId, MobKind — all of it, and
// deliberately through contract.h rather than around it. Sharing that header IS the
// anti-duplication decision documented above; a forward declaration here would let the
// two files' notions of an objective drift apart, which is the failure being avoided.
#include "game/contract.h"

namespace giga::game {

// Row index into the quest catalog. **1-based**, like `ItemId` and for the same reason:
// 0 is the "no quest" sentinel, so it can never name a row.
using QuestId = std::uint8_t;
inline constexpr QuestId kInvalidQuest = 0;

// Generated from data/quests.csv. Keep in step with EXPECTED_ROWS in
// tools/gen_quest_table.py.
//
// **THE ROW-COUNT DRIFT CHECK IS NOT ARMED FOR QUESTS YET — do not read this the way
// you read `kItemCount`.** [tools/check_source_rules.cmake] Rule 7 registers FIVE
// CSV/header pairs (items, mobs, weapons_melee, weapons_ranged, materials) and quests is
// not among them, so the ctest that holds those five to their CSV says nothing about this
// one. Two of the three drift directions are still caught, and it is worth being precise
// about which:
//   * CSV rows added/removed without bumping EXPECTED_ROWS -> the generator refuses to
//     run at all. Caught.
//   * EXPECTED_ROWS bumped and the table regenerated without bumping kQuestCount here ->
//     `std::array<QuestDef, kQuestCount>` gets too many initializers. Hard compile error.
//   * **CSV edited and the generator never re-run -> INVISIBLE.** Nothing in the build
//     looks at data/quests.csv, so a row added straight to the CSV leaves a stale
//     quest_table.cpp compiling green. That is exactly the hole Rule 7 exists to close
//     and the gate's own closing comment demands ("Add every new CSV-generated table here
//     at the same time as the generator, not afterwards").
// The one-line fix belongs in a file this lane does not own; it is in the handoff as the
// Rule 7 hunk. Delete this whole note once it lands.
inline constexpr std::size_t kQuestCount = 20;
static_assert(kQuestCount <= 255,
              "QuestDef::prereq is a QuestId in one byte and 0 is kInvalidQuest");

// Lifecycle. FIVE states where `ContractState` has four, and both differences are
// deliberate:
//
//   * There is no `Offered`. A contract has to store its offer because the offer IS the
//     job — rolled from a hash and gone if not kept. A quest offer is just a `QuestId`
//     naming a row that is already on disk, so there is nothing to hold: the caller
//     keeps the id, and the log stays untouched until accept.
//   * `Failed` splits into `Expired` and `Orphaned`, because only one of them is the
//     player's fault and they must not clear the same way. See `quest_on_giver_died`.
enum class QuestState : std::uint8_t {
    Unseen = 0,   // never taken
    Active,
    Complete,     // conditions met, reward paid
    Expired,      // the deadline ran out. TERMINAL, and the point of the feature.
    // The giver died before you delivered. Counted as a failure — and takeable again,
    // which is the one place quests deviate from contracts. See quest_on_giver_died.
    Orphaned,
    Count
};

// One authored quest. POD, 24 bytes, no pointers — the same shape and the same size as
// `Contract`, so it serializes verbatim and copies into a report without a thought.
//
// `subject` is an `ItemId` for Fetch and a `MobKind` for Hunt, exactly as
// `Contract::subject` is, and unused for Descend. That double meaning is a known save
// hazard ([save.h] says so at length); it is repeated here rather than fixed because
// fixing it means interning string ids across `ItemSlot` and `Contract` too, and one
// half-migrated id space would be worse than one consistent hazard.
struct QuestDef {
    std::uint32_t limitMs;      //  0  deadline; 0 = none (see the banner)
    std::int32_t target;        //  4  count, or DEPTH |z| for Descend
    std::int32_t reward;        //  8  roubles, paid into RunLedger::banked
    std::uint16_t subject;      // 12  ItemId (Fetch) / MobKind (Hunt) / unused
    std::uint16_t rewardItem;   // 14  ItemId, kInvalidItem = money only
    std::uint8_t rewardCount;   // 16  how many of rewardItem, 0 when there is none
    std::uint8_t kind;          // 17  ObjectiveKind
    std::uint8_t prereq;        // 18  QuestId that must be Complete first; 0 = none
    std::int8_t floorLo;        // 19  offer band, SIGNED floor labels, inclusive
    std::int8_t floorHi;        // 20  int8 covers kMinFloor..kMaxFloor exactly
    std::uint8_t pad_[3];       // 21
};
static_assert(sizeof(QuestDef) == 24, "QuestDef must stay a tight 24-byte row");
static_assert(alignof(QuestDef) == 4);

// Generated by tools/gen_quest_table.py. Row N is QuestId N+1.
extern const std::array<QuestDef, kQuestCount> kQuestTable;

// Russian display text, parallel to kQuestTable and kept out of `QuestDef` so the row
// stays pointer-free and trivially serializable — same split as `kItemNames`.
// `kQuestNames` is the short title, `kQuestBriefs` the sentence the giver says.
extern const std::array<const char*, kQuestCount> kQuestNames;
extern const std::array<const char*, kQuestCount> kQuestBriefs;

inline bool quest_valid(QuestId id) {
    return id != kInvalidQuest && static_cast<std::size_t>(id) <= kQuestCount;
}
inline const QuestDef& quest_def(QuestId id) {
    return kQuestTable[static_cast<std::size_t>(id) - 1];
}
inline const char* quest_name(QuestId id) {
    return kQuestNames[static_cast<std::size_t>(id) - 1];
}
inline const char* quest_brief(QuestId id) {
    return kQuestBriefs[static_cast<std::size_t>(id) - 1];
}

// Per-row run state. 16 bytes, POD, no pointers.
struct QuestProgress {
    // Milliseconds left on the clock. Meaningful only while `state == Active` and only
    // when the row's `limitMs != 0` — the DEF decides whether there is a deadline at
    // all, so a zero here can never be mistaken for "already expired" by a load.
    std::uint32_t remainingMs = 0;
    std::int32_t progress = 0;
    // Bound at accept and never rebound, so this names that person for the rest of the
    // run — and it is a GENERATION-TAGGED HANDLE, which is what makes that sentence true
    // rather than conditional on a pool policy.
    //
    // It used to be a bare `NpcId`, resting on [npc_pool.h] never-reclaim. That is the
    // DEFAULT policy and not a property of the type: `set_recycling(true)` suspends it,
    // and a recycled id is a REUSED id. The hole was silent rather than loud, exactly as
    // it was for `Contract::giver` before the same migration: `quest_on_giver_died` fires
    // only from the frame-top combat drain, so a giver killed by the MACRO sweep publishes
    // no event, the slot goes to a newborn, and `quest_step`'s poll — then
    // `!valid(id) || !alive(id)` — saw a living record at that index, kept the row, and
    // paid an authored quest out to a stranger who never offered it. Which is the
    // reference's own broken quest binding that contract.h opens by claiming this engine
    // is immune to.
    //
    // `pool.handle_valid()` makes that unrepresentable: `kill()` bumps the generation
    // whether or not the slot is reused, so one test answers "is this still the person I
    // was holding?" for three distinct failures — an id past the high-water mark, a
    // cleared alive bit, and a reclaimed slot. [tests/suite_quest.inl]
    // `the_slot_is_recycled` is the witness. It closes ONE of the bare-NpcId stores
    // [src/app/main.cpp] gates `set_recycling(true)` on — **not the last one**, and that
    // gate's own list is the count of record, not this header. Do not read a single
    // closed field as permission to arm recycling; open the gate and read it.
    //
    // Costs the save nothing, and that is MEASURED rather than argued: an `NpcHandle` is
    // the same 32 bits an `NpcId` was, so `visit_quest_row`'s `ar.u32(p.giver)` emits the
    // identical bytes. One log with every field distinct serialises to the same 308 bytes
    // with the same FNV-1a digest (0397A7BC) before and after this change, at
    // `kQuestRowWire = 14`, `sizeof(QuestProgress) == 16` and `sizeof(QuestLog) == 352`;
    // `quest_table_fingerprint()` is unmoved at 54E84EEA.
    NpcHandle giver = kInvalidHandle;
    std::uint8_t state = 0;     // QuestState
    // |z| already reached when this was accepted, so a Descend objective pays only for
    // a descent made afterwards. Stamped from the ledger by `quest_accept` for the
    // reason contract.h gives: a rule the caller has to remember is a rule that gets
    // forgotten, and an audit measured 900 roubles twice over for standing still.
    std::uint8_t baseline = 0;
    std::uint8_t pad_[2] = {0, 0};
};
static_assert(sizeof(QuestProgress) == 16, "QuestProgress must stay a tight 16-byte row");
static_assert(alignof(QuestProgress) == 4);

// The whole quest log: one row per authored quest, DENSE.
//
// Dense and not a slot array, for three reasons that all point the same way
// ([AGENTS.md] "dense over sparse", [performance.md]): a chain prerequisite is then an
// O(1) index instead of a scan; "have I already done this" needs no separate bitmap;
// and there is no "log full" refusal to design, which matters because refusing a chain
// step for lack of a slot would brick the chain. At `kQuestCount = 20` the whole thing
// is 352 bytes, so density costs nothing worth counting.
//
// **There is deliberately no cap on concurrent active quests.** The deadline IS the
// limiter, and it is a better one than a slot count: it charges you for over-committing
// instead of merely forbidding it.
struct QuestLog {
    QuestProgress row[kQuestCount]{};
    std::int64_t earned = 0;              // roubles this log has paid out
    std::uint32_t completed = 0;
    std::uint32_t failed = 0;             // expired + orphaned
    std::uint32_t expired = 0;            // ...of which the clock killed
    std::uint32_t orphaned = 0;           // ...of which a dead giver released
    // Reward items that did not fit in the bag and were lost. Counted rather than
    // hidden: `quest_step` grants what fits and completes anyway, because blocking
    // completion on a full inventory would leave an Active row the player has already
    // finished, and the deadline would then kill it. A silent loss is worse than a
    // counted one. (The reference blocks instead — `questRewardsFitAfterHandoff`.)
    std::uint32_t rewardItemsLost = 0;
    std::uint32_t pad_ = 0;
};
static_assert(sizeof(QuestLog) == kQuestCount * sizeof(QuestProgress) + 32,
              "QuestLog is the whole quest run state and the save format pins its "
              "shape; grow it on purpose and bump kSaveVersion in the same edit");

inline QuestState quest_state(const QuestLog& log, QuestId id) {
    return quest_valid(id) ? static_cast<QuestState>(log.row[id - 1].state)
                           : QuestState::Count;
}

// Share of bodies carrying an authored quest, when one is eligible at all. Lower than
// `kOfferPct`'s 18 % for contracts on purpose: authored content is meant to be rarer
// than the procedural stream it sits on top of, and there are only kQuestCount of them
// in the whole building.
inline constexpr std::uint32_t kQuestOfferPct = 8;

// ---------------------------------------------------------------------------
// Offering and taking
// ---------------------------------------------------------------------------

// Is this row takeable right now, ignoring the giver? Floor band, chain prerequisite,
// and a state of either `Unseen` or `Orphaned`.
//
// Exposed rather than kept private because `quest_offer` and `quest_accept` must agree
// exactly — an offer the accept path refuses is the bug contract.cpp's Descend guard
// exists to document — and because a test can then assert the eligibility rule
// directly instead of inferring it from a hash.
bool quest_eligible(const QuestLog& log, QuestId id, int floorZ);

// Which authored quest, if any, the body `giver` is carrying on floor `floorZ`.
//
// Deterministic in (giver, floor, seed) GIVEN the log, exactly like `rumour_for` and
// `contract_offer` — the same person on the same floor always offers the same thing, so
// walking away and coming back cannot reroll it into something better. The log
// participates because a chain must advance; that is legible state (you finished step 1)
// and not the invisible history contract.h refuses to consult.
//
// Returns kInvalidQuest for a dead or invalid giver, for a body that is not carrying
// anything (which is most of them), and when nothing in the catalog is eligible here.
QuestId quest_offer(const NpcPool& pool, const QuestLog& log, NpcId giver, int floorZ,
                    std::uint32_t seed);

// Take a quest. Returns false when the id is invalid, the row is not eligible on this
// floor (band, chain, or a state that is neither Unseen nor Orphaned), the giver is
// `kInvalidNpc` or not a living record, or the objective is a Descend whose depth the run
// has already reached — all refusals, not errors.
//
// **The `giver` PARAMETER stays a bare `NpcId` while the STORED field is a handle**, for
// contract.cpp's reason: callers hold an id (a proximity sweep, a floor bucket roster, the
// same id they just passed to `quest_offer`, which hashes it), so they pass one, and the
// (generation, id) pair is minted here — exactly once, at the point the field is written.
//
// **It DOES take the pool, and that is the change the handle forced.** The old signature
// did not, matching `contract_accept`, which can afford to: its handle was already minted
// by `contract_offer` and travels inside the `Contract` it is handed. A quest offer is
// just a `QuestId`, so there is no struct to carry a handle in and the mint has nowhere
// else to live. Passing the pool makes forgetting to mint unexpressible — the same
// argument the LEDGER paragraph below makes for `baseline` — and it is what lets a giver
// who died between offer and accept be REFUSED rather than minted from a corpse:
// `pool.handle()` on a dead record returns the already-bumped generation, so accepting
// one would write an Active row that `quest_step` orphans on the very next tick, billing
// the run a `failed` for a job it never had. `quest_step`'s liveness poll still has to
// exist regardless, because a body can be lost to a floor unload rather than to a death
// and only one of those publishes.
//
// The Descend clause is contract_accept's guard, ported for the same measured reason: the
// step skips a satisfied-at-accept Descend forever, `baseline` is stamped exactly once,
// and `RunLedger::deepestFloor` never falls, so the row would sit Active until something
// killed it and then count as a failure for work the player was never able to do.
//
// Takes the LEDGER for the same reason contract_accept does: stamping `baseline` here
// makes forgetting to stamp it impossible to express.
bool quest_accept(QuestLog& log, const NpcPool& pool, QuestId id, NpcId giver, int floorZ,
                  const RunLedger& led);

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

// Advance every active quest and pay out the ones that are done. Returns roubles paid
// this call, which is 0 on the overwhelming majority of ticks.
//
// `stepMs` is how much sim time this call represents. Call it once per SIM STEP with
// `giga::kSimStepMs` (exactly 8 at 125 Hz) — the same cadence and the same place
// `contract_step` is called from, right after the extraction step, so a Fetch quest
// pays at the moment the loop's own payoff lands. It is a parameter rather than a
// constant read from tick.h so a test can run a 20-minute deadline down in one call
// instead of 150,000, and so the caller cannot quietly change the meaning of a deadline
// by moving the call to a different clock.
//
// Order inside one row is fixed and load-bearing: giver liveness, then the deadline,
// then the objective. A dead giver beats a dead clock because the errand stopped
// existing before the clock mattered, and a row must not be billed as `expired` when
// there was nobody left to deliver to.
//
// **The liveness step is `pool.handle_valid(p.giver)`, and it is THE recycling guard.**
// One test for three distinct ways the person can stop being the person: an id past the
// high-water mark, a cleared alive bit, and — the one a bare id could never see — a stale
// GENERATION, i.e. the slot was reclaimed and handed to somebody else. Deaths in the macro
// sweep publish no `NpcDied` event ([macro_sim.h]), so for those this poll is the ONLY
// guard; `quest_on_giver_died` is a fast path, not the guarantee.
//
// **Fetch consumes the items**, for contract.cpp's reason: a courier job that let you
// keep the cargo would pay twice for the same loot.
std::int32_t quest_step(QuestLog& log, const NpcPool& pool, Inventory& inv,
                        RunLedger& led, std::uint32_t stepMs);

// A kill happened. Same event, same payload, same drain as `contract_on_kill` — main
// already reads `NpcDied` off the bus once per frame and this hooks the same batch
// rather than inventing a second notion of "something died".
void quest_on_kill(QuestLog& log, std::uint8_t mobKind);

// A giver died. Their active quests become `Orphaned`.
//
// **This is where quests deviate from contracts, and the deviation is the point.**
// `contract_on_giver_died` marks the job Failed forever, because a contract IS its
// giver — generated from them, deterministic in them, and there is nobody left to pay.
// An authored row is not its giver: the errand exists in `data/quests.csv` whether or
// not anybody is alive to ask. So the FAILURE IS REAL AND COUNTED — `failed` and
// `orphaned` both rise, and a chain stalls until the row is taken again — but the state
// is `Orphaned` rather than terminal, and `quest_eligible` treats it as takeable, so a
// different body can offer it later. `Orphaned` and not a reset to `Unseen` so the row
// REMEMBERS that it fell through once: that is player-visible information, and it keeps
// the enumerator from advertising a state nothing produces.
//
// That is what the reference's own design doc demands and nothing more: *"Нельзя тихо
// респавнить quest giver как будто смерти не было"* — the death must not be silent, and
// it is not. Making it permanent instead would mean one random citizen dying anywhere in
// the building can delete authored content for the rest of the run, and `finalize_deaths`
// runs every tick.
//
// Neither the clock nor the progress survives the release: a re-taken quest starts over.
// Carrying the remainder over would mean a row orphaned near expiry is effectively
// already dead, which is a punishment for something the player did not do; carrying the
// kill count over would mean a new person paying for work done for someone else.
//
// Takes a bare POOL ID, not a handle, because that is what the event ring carries
// (`NpcDied.a`, drained at the frame top in [src/app/main.cpp]) — by the time the event is
// read the record is already dead, so `pool.handle(who)` would mint the corpse's BUMPED
// generation and match nothing. The comparison is therefore against the ID HALF of the
// stored handle, `npc_handle_id(p.giver) == who`. It cannot become a wildcard: an id is
// masked to kNpcPoolBits, so a `who` of `kInvalidNpc` matches no slot at all — and this
// function refuses that value outright anyway.
//
// This is a fast path, not the guard, and the asymmetry is the reason: it fires only for a
// death that publishes, i.e. the combat drain, never for a macro-sweep death.
// `quest_step`'s `handle_valid` poll is what actually catches a dead giver.
void quest_on_giver_died(QuestLog& log, NpcId who);

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

// Put `count` of `item` into the bag, filling partial stacks of the same item before
// taking a fresh slot. Returns how many actually LANDED, which is less than `count` when
// the bag is full — see `QuestLog::rewardItemsLost` for why a shortfall is counted
// rather than being allowed to block a completion.
//
// Exposed because it is the only reward channel besides money and a test has to be able
// to assert that a reward arrived, not merely that a quest closed.
int quest_grant_item(Inventory& inv, ItemId item, int count);

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
// Russian, and rendered from the def rather than stored per-row, so a re-take costs no
// memory. All three return false on a buffer too small to hold the worst case and leave
// `out` untouched, never truncated-and-plausible.

// A countdown, rounded UP to the second so a live quest never reads "0". `cap` >= 24.
// Ported from `formatQuestMinutes`, in sim seconds rather than in-fiction minutes.
bool quest_time_text(std::uint32_t ms, char* out, std::size_t cap);

// Just the objective fragment — the target and the count, or the depth. `cap` >= 96.
bool quest_objective_text(QuestId id, char* out, std::size_t cap);

// The offer, as the sentence a body says. `cap` >= 320.
bool quest_offer_text(QuestId id, char* out, std::size_t cap);

// One active row, for the HUD: title, objective, progress, reward, time left.
// `cap` >= 320.
bool quest_line(const QuestLog& log, QuestId id, char* out, std::size_t cap);

// How many rows are Active. O(kQuestCount); for the HUD, not for the tick.
int quest_active_count(const QuestLog& log);

// ---------------------------------------------------------------------------
// Save format — the block, not the file
// ---------------------------------------------------------------------------
// [save.h] owns the file and lives in a different lane, so the serializer for THIS
// block lives here: `save.cpp` calls the two functions below between the contract book
// and the player snapshot, and its own header gains `questCount` + `questFingerprint`
// beside the existing item/mob pair. The wire is field-by-field little-endian with no
// padding, byte-identical in style to save.cpp's own `Writer`, so a save written by the
// MSVC build stays readable by the Clang build.
//
// Adding this block is a wire change: `kSaveVersion` must go 1 -> 2 in the same edit.
//
// **`giver` becoming an `NpcHandle` is NOT part of that wire change.** An `NpcHandle` is
// the same 32 bits an `NpcId` was — the generation lives in the 12 bits a 20-bit id never
// used ([npc_pool.h]) — so `visit_quest_row`'s `ar.u32(p.giver)` emits the identical four
// bytes at the identical offset and both constants below are unmoved. The format this
// block WILL have is therefore unaffected: no `kSaveVersion` bump is owed to the handle,
// and the `kSaveVersion 1 -> 2` above is owed to the block's mere existence exactly as it
// was before. One real consequence for the day the pool itself joins the format, and
// [npc_pool.h] already states it from its own side: the generation column has to travel,
// because a load that resets generations to 0 hands every stored handle a false match.

inline constexpr std::size_t kQuestRowWire = 14;   // 3x4 + 2   (pad_ dropped)
inline constexpr std::size_t kQuestLogWire =
    kQuestCount * kQuestRowWire + 8 + 5 * 4;       // rows + earned + five counters

// FNV-1a over every quest TITLE, in table order.
//
// The strong check, for the reason [save.h] spells out for `item_table_fingerprint`: a
// `QuestId` is a row index into a hand-ordered CSV, so inserting, deleting, renaming or
// REORDERING a row silently redefines what a saved id means. A count catches only the
// first two. Titles and not briefs, so fixing a typo in a sentence does not reject
// every existing save — a title is the row's identity, a brief is its copy.
std::uint32_t quest_table_fingerprint();

// APPEND the log to `out`. Exactly `kQuestLogWire` bytes; cannot fail.
void quest_log_write(const QuestLog& log, std::vector<std::uint8_t>& out);

// Parse `kQuestLogWire` bytes. Returns false and leaves `log` COMPLETELY untouched on a
// short buffer or an out-of-range state byte — a half-applied load would put the game
// into a state no run has ever been in.
bool quest_log_read(const std::uint8_t* bytes, std::size_t n, QuestLog& log);

} // namespace giga::game
