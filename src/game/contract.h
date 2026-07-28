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
// written nowhere. Here `NpcPool` never reclaims a slot and id == slot forever
// ([npcs.md]), so a `NpcId` written into a contract points at that person for the rest
// of the run. There is no rebinding code because there is nothing to rebind.
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

// One job. POD, 24 bytes, no pointers — it serializes with the save verbatim and can
// be copied into a report without a thought.
struct Contract {
    NpcId giver = kInvalidNpc;   // stable for the whole run; see the header
    std::uint16_t subject = 0;   // ItemId for Fetch, MobKind for Hunt, unused for Descend
    std::int32_t target = 0;     // count, or the floor for Descend
    std::int32_t progress = 0;
    std::int32_t reward = 0;     // roubles, paid into RunLedger::banked
    std::uint8_t kind = 0;       // ObjectiveKind
    std::uint8_t state = 0;      // ContractState
    std::uint16_t pad_ = 0;
};
static_assert(sizeof(Contract) == 24, "Contract must stay a tight 24-byte row");

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
// Returns state Offered, or a contract with `giver == kInvalidNpc` when this body has
// nothing to ask (which is most of them; a floor where everyone wants something is a
// job board, not a building).
Contract contract_offer(const NpcPool& pool, NpcId giver, int floorZ,
                        std::uint32_t seed);

// Render an offer as a Russian sentence. `out` must be at least 200 bytes.
bool contract_text(const Contract& c, char* out, std::size_t cap);

// Take an offer into the book. Returns false when the book is full or the offer is
// invalid — a refusal, not an error.
bool contract_accept(ContractBook& book, const Contract& offer);

// Advance every active contract against the world, and pay out the ones that are done.
//
// `inv` is the player's inventory, `led` the run ledger (Descend reads its deepest
// floor, and every reward is paid into its banked total). Returns roubles paid this
// call, which is 0 on the overwhelming majority of ticks.
//
// **Fetch consumes the items.** A courier job that let you keep the cargo would pay
// twice for the same loot — once as the reward and once as the haul — and that is the
// difference between an errand and a bonus.
std::int32_t contract_step(ContractBook& book, const NpcPool& pool, Inventory& inv,
                           RunLedger& led);

// A kill happened. Called from wherever the death is finalized, so Hunt progress is
// driven by the same event the kill feed is.
void contract_on_kill(ContractBook& book, std::uint8_t mobKind);

// A giver died. Their open contracts fail — nobody is left to pay you, and quietly
// paying anyway would make the giver decorative.
void contract_on_giver_died(ContractBook& book, NpcId who);

} // namespace giga::game
