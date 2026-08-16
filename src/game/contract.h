// Contracts — a reason to go down that came from a person.
//
// Everything needed for this already existed and none of it was connected. Containers
// put things in rooms, depth decides what they are worth, the survival clock puts a
// deadline on the trip, the extraction pad is where value becomes yours, and rumours
// let a body in a corridor say something true. What was missing is the sentence that
// turns all of that into an errand: *somebody asked you to*.
//
// **The reference's contract binding is broken, and ours is correct by construction.**
// A reconnaissance pass found that its generated quests store `giverId = npc.id` — a
// per-floor bump counter that RESTARTS at 10000 — or a synthetic negative id, while
// only authored plot NPCs get stable registry ids. Its half-fix compares
// `persistentNpcId === 'alife:' + giverId` across two overlapping id spaces, so it can
// match an unrelated NPC; and a `giverPlotNpcId` rebinding field is read on load and
// written nowhere. Ours is a GENERATION-TAGGED HANDLE, which is the one id space in
// which that mismatch cannot be expressed: `giver` is an `NpcHandle` = (generation, id)
// packed into one uint32 ([npc_pool.h]), minted by `pool.handle()` at offer time and
// tested with `pool.handle_valid()` on every step. `kill()` bumps the generation, so a
// handle goes stale the instant that record dies — whether or not its slot is ever
// handed to somebody else. There is still no rebinding code, and now there is a reason
// rather than an assumption.
//
// **This field is what was blocking `pool.set_recycling(true)` in [src/app/main.cpp].**
// It used to be a bare `NpcId`, resting on "the pool never reclaims a slot and id ==
// slot forever" — true when it was written, and no longer true once the intrusive free
// list landed ([npc_pool.h] "Slot recycling"). The hole that left was silent rather than
// loud: `contract_on_giver_died` fires only from the frame-top combat drain, never for a
// macro-sweep death, so a giver killed by the macro tick left an ACTIVE job whose id was
// then handed to a newborn — and `contract_step`'s liveness poll saw a living record at
// that id, kept the job, and paid it out to a person who never offered it. The
// generation test makes that unrepresentable; [tests/suite_audit.inl]
// `giver_slot_recycled` is its witness.
//
// **No interaction verb, and that is not a compromise.** The game has no talk key, no
// NPC targeting and no dialogue tree. Rather than build three systems to deliver one
// sentence, a contract arrives the way a rumour does — overheard from whoever is
// nearest — and is taken with one key. The offer is a thing you walk into.
//
// The three objective kinds are chosen for exactly one reason: each is already
// measurable by a system that exists, so none of them needs new bookkeeping in the
// tick. An objective that needs a new counter is an objective for a later increment.
#pragma once

#include <cstdint>

#include "game/extraction.h"
#include "game/inventory.h"
#include "game/item_table.h"
#include "game/mob_table.h"
#include "game/npc_pool.h"
#include "game/rpg.h"        // RpgStats, xp_for_quest, award_xp — the ONE xp path

namespace giga::game {

enum class ObjectiveKind : std::uint8_t {
    // Bring N of an item back to the extraction pad. Measured by the inventory the
    // extraction step already walks — the deepest hook available, because it makes the
    // reward land at the exact moment the loop's own payoff does.
    Fetch = 0,
    // Kill N of a monster kind. Measured by the kill feed that combat already
    // publishes; the kind is what makes it a specific job rather than a body count.
    Hunt,
    // Reach a floor at least this deep. Measured by `RunLedger::deepestFloor`, which
    // extraction already tracks on every ride.
    Descend,
    Count
};

enum class ContractState : std::uint8_t {
    Offered = 0,   // overheard, not taken
    Active,
    Complete,      // conditions met, reward paid
    Failed,        // the giver died before you delivered
    Count
};

// Multi-stage progression step for contracts
enum class ContractStage : std::uint8_t {
    Objective = 0,    // Stage 0: Find item / Hunt target / Reach depth
    Deliver = 1,      // Stage 1: Deliver to NPC / Return to Giver
    CollectBounty = 2 // Stage 2: Collect bounty / Completed
};

// One job. POD, 24 bytes, no pointers — it serializes with the save verbatim and can
// be copied into a report without a thought.
// A Descend job stamps how deep you ALREADY were when you took it, in `baseline`, and
// pays only for progress beyond that. Without it the job compares against
// `RunLedger::deepestFloor` — a high-water mark for the whole run — so accepting one you
// already satisfy pays instantly, and re-accepting pays again. An audit measured 900
// roubles on accept and 900 more on re-accept with the player never moving.
struct Contract {
    // (generation, id), NOT a bare id — see the header. Costs the save nothing: an
    // NpcHandle is the same 32 bits an NpcId was, so [save.cpp] `visit_contract`'s
    // `ar.u32(c.giver)` and `kContractWire = 21` are byte-identical across this change.
    NpcHandle giver = kInvalidHandle;
    std::uint16_t subject = 0;   // ItemId for Fetch, MobKind for Hunt, unused for Descend
    std::int32_t target = 0;     // count, or the floor for Descend
    std::int32_t progress = 0;
    std::int32_t reward = 0;     // roubles, paid into RunLedger::banked
    std::uint8_t kind = 0;       // ObjectiveKind
    std::uint8_t state = 0;      // ContractState
    // |z| already reached when this job was accepted. Takes one of the two spare
    // padding bytes rather than growing the row, and a uint8 is enough because the
    // floor stack is bounded at +/-127 ([floor_registry.h] kMinFloor/kMaxFloor).
    std::uint8_t baseline = 0;
    std::uint8_t stage = 0;      // ContractStage
};
static_assert(sizeof(Contract) == 24, "Contract must stay a tight 24-byte row");

inline ContractStage contract_stage(const Contract& c) {
    return static_cast<ContractStage>(c.stage);
}

const char* contract_stage_name(ContractStage stage);

// How many can be active at once. Small on purpose: three jobs you remember beats ten
// you cannot, and there is no journal UI to read a longer list from.
inline constexpr int kMaxContracts = 3;

struct ContractBook {
    Contract slot[kMaxContracts]{};
    std::uint32_t completed = 0;
    std::uint32_t failed = 0;
    std::int64_t earned = 0;
};

// Build the contract a given body would offer, from live world state.
//
// Deterministic in (giver, floorZ), like `rumour_for` — the same person always offers
// the same job, so walking away and coming back does not reroll it into something
// better. That is what makes an offer feel like a decision rather than a slot pull.
//
// Returns state Offered, or a contract with `giver == kInvalidHandle` when this body has
// nothing to ask (which is most of them; a floor where everyone wants something is a
// job board, not a building).
//
// **The parameter stays a bare `NpcId` while the stored field is a handle, and that is
// deliberate.** The determinism above is `hash(id, floorZ, seed)`; the id is 20 bits of
// the handle and the generation is the other 12, so hashing a handle instead would
// change every offer in the game and would additionally make a body's job change when an
// UNRELATED record in its slot's history died. Callers hold an id (a proximity sweep, a
// bucket roster), so they pass one; `contract_offer` mints the handle exactly once, at
// the point it writes the field.
//
// **Guaranteed completable, and that guarantee is the whole reason this returns a
// refusal so often.** A Fetch names only items `item_weight_on_floor` can produce at
// this depth, and a Hunt names only a kind the spawn roster can actually roll —
// `spawnWeightX10 != 0` and a non-empty `floorMask`, the same two row fields
// `spawn_floor_mobs` filters on. An audit measured 7 of 318 live Hunt offers naming
// CREATOR or PSEUDOLIFT, both weight 0 and both with dmg > 0 so the only guard in place
// waved them through: an errand whose target does not exist. The habitat half is
// deliberately global rather than per-floor — see contract.cpp for the measurement that
// made per-floor the worse option.
Contract contract_offer(const NpcPool& pool, NpcId giver, int floorZ,
                        std::uint32_t seed);

// Render an offer as a Russian sentence. `out` must be at least 200 bytes.
bool contract_text(const Contract& c, char* out, std::size_t cap);

// Take an offer into the book. Returns false when the book is full, the offer is invalid,
// the exact job is already held from the same giver, or the offer is a Descend whose target
// is already behind the run's deepest point — all refusals, not errors.
//
// That last clause was promised by a comment inside contract_step and implemented nowhere.
// The result was a slot the player could not clear by playing: the step skips it forever on
// `want <= baseline`, `baseline` is stamped exactly once, and `RunLedger::deepestFloor` never
// falls, so Complete was permanently unreachable. It did still fail eventually — when the
// giver died — incrementing `failed` for work the player never had a way to do. Three of
// those brick the three-slot book, and any player walking back up the stack collects them in
// normal play.
//
// Takes the LEDGER, and that is deliberate rather than convenient.
//
// A Descend job must pay only for a descent made after it was taken, which means
// stamping how deep the run had already been. The first version left that to the caller
// — and an audit accepted a job directly, without stamping, and collected 900 roubles
// for a descent that predated the job, then 900 more on re-accept. A rule the caller has
// to remember is a rule that gets forgotten; taking the ledger here makes forgetting it
// impossible to express.
bool contract_accept(ContractBook& book, const Contract& offer, const RunLedger& led);

// Advance every active contract against the world, and pay out the ones that are done.
//
// `inv` is the player's inventory, `led` the run ledger (Descend reads its deepest
// floor, and every reward is paid into its banked total). Returns roubles paid this
// call, which is 0 on the overwhelming majority of ticks.
//
// **Fetch consumes the items.** A courier job that let you keep the cargo would pay
// twice for the same loot — once as the reward and once as the haul — and that is the
// difference between an errand and a bonus.
struct FactionRelations;

std::int32_t contract_step(ContractBook& book, const NpcPool& pool, Inventory& inv,
                           RunLedger& led, RpgStats* rpg = nullptr,
                           FactionRelations* rel = nullptr);

// ---------------------------------------------------------------------------
// How hard is this job — composed from context that already exists
// ---------------------------------------------------------------------------
// Returns difficulty in TENTHS, which is exactly what `xp_for_quest` takes
// ([rpg.h]: `round(20 * difficulty)` with difficulty arriving x10).
//
// THIS FUNCTION IS THE PRINCIPLE, not a helper. ARCHITECTURE.md §Манифест: "максимум
// контекста, минимум систем", clarified by the owner 2026-08-12 — the number of
// SYSTEMS is bounded, the number of INPUTS is not. So difficulty is not a column
// somebody authors and not one signal picked over another; it is every piece of
// context the engine already has about a job, added up. Nothing below introduces a
// table, a column or a counter. Each term names the system it reads:
//
//   kind      ObjectiveKind          — the one enum of objectives (this file)
//   depth     mob_depth01            — the same |z| curve that drives monsters,
//                                      loot and resident level (manifest p.5:
//                                      "|absN| этажа = уровень опасности")
//   subject   mob_hp_at_level        — for Hunt: how tough THAT creature is here
//             ItemDef::spawnWeight   — for Fetch: how rare THAT item is to find
//   target    the row's own count    — five of a thing is harder than one
//   timed     the row's own deadline — a clock is pressure
//
// ADDING A TERM IS ONE LINE HERE, and that is the acceptance criterion for the
// "расширяемо" half of the requirement: reputation with the giver, the player's own
// level, whether the floor is sealed, how far the subject spawns from the giver —
// each is a `d +=` beside its comment, not a redesign.
//
// `depthAbsZ` is |z|, because depth is symmetric: the roof is as far from safety as
// the basement, which is the same reading `record_floor` already takes. Callers that
// genuinely do not know it pass 0 and lose exactly the depth term; they do not get a
// wrong answer, they get a shallower one.
std::uint16_t objective_difficulty_e1(std::uint8_t kind, std::uint16_t subject,
                                      std::int32_t target, int depthAbsZ, bool timed);

// A kill happened. Called from wherever the death is finalized, so Hunt progress is
// driven by the same event the kill feed is.
void contract_on_kill(ContractBook& book, std::uint8_t mobKind);

// A giver died. Their open contracts fail — nobody is left to pay you, and quietly
// paying anyway would make the giver decorative.
//
// Takes a bare POOL ID, not a handle, because that is what the event ring carries
// (`NpcDied.a`, drained at the frame top in [src/app/main.cpp]) — by the time the event
// is read the record is already dead, so `pool.handle(id)` would mint the corpse's NEW
// generation and match nothing. The comparison is therefore against the ID HALF of the
// stored handle, `npc_handle_id(c.giver) == who`. It cannot become a wildcard: an id is
// masked to kNpcPoolBits, so a `who` of `kInvalidNpc` matches no slot at all.
//
// This is a fast path, not the guard. `contract_step`'s `handle_valid` poll is what
// actually catches a dead giver — including the macro-sweep deaths that publish no event.
void contract_on_giver_died(ContractBook& book, NpcId who, FactionRelations* rel = nullptr,
                            const NpcPool* pool = nullptr);

} // namespace giga::game
