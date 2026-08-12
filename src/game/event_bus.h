// Event bus — the one channel gameplay systems use to tell each other that
// something happened (an NPC died, an item changed hands, a floor was entered),
// without any system holding a pointer to any other.
//
// Design decisions (see the design form in project history):
//   * TRANSIENT by default. Events are published into a fixed-capacity ring and
//     live exactly one drain cycle: a producer pushes this tick, every consumer
//     reads the batch, then clear() wipes it. Nothing accumulates, no allocation
//     in the hot path — the ring is sized once and reused every tick.
//   * FIXED, POD events. Every event is the same small POD (`Event`), a type tag
//     plus a few generic slots. No inheritance, no per-event heap — the ring is
//     one flat array that serializes verbatim, same stance as the NPC pool.
//   * OPTIONAL LOG. Debug/replay want history the transient ring throws away, so
//     the bus can mirror every published event into an append-only log. Off by
//     default (zero cost); when on, it's the only thing that grows.
//   * OVERFLOW DROPS, LOUDLY. If more than `kCapacity` events are published in a
//     single cycle the surplus is dropped and counted (`dropped()`), never
//     grown — a bounded ring must stay bounded. The count surfaces the tuning
//     problem instead of hiding it behind a silent reallocation.
//   * EVERY PUBLISHED TYPE IS COUNTED. `cycle_count`/`total_count` keep a per-type
//     tally so a published event always has at least one reader. Added because an
//     audit found `ItemTransferred` published from three sites (loot.cpp x2,
//     needs.cpp) and consumed by NOTHING: the only drain in the game filtered on
//     `NpcDied` and dropped the rest on the floor. A transient bus where a
//     producer's event is provably never read is worse than no bus — it looks
//     wired. The tally is two increments per publish and turns "does anything read
//     this" into a HUD line. It is a COUNT, not a substitute for a real consumer.
//   * AND EVERY TYPE NOW HAS ONE. The tally answers "is this producer firing"; it
//     does not answer "did anything act on it", and the bullet above says so.
//     `EventFeed` at the bottom of this header is the missing half: it renders
//     every event of every type to a line and KEEPS it across `clear()`, so the
//     three `ItemTransferred` producers are read on the tick they publish instead
//     of being wiped unread. It is deliberately the weakest possible consumer —
//     text on a screen — because a bus's job is to carry, and inventing gameplay
//     reactions to justify each enumerator would be the tail wagging the dog.
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace giga::game {

// Event kinds. Extend as gameplay systems need them; the tag is just a u16 so
// the enum can grow without touching the POD layout.
//
// **Every value below names its producer as a symbol you can grep.** Four of the
// seven (`NpcSpawned`, `NpcMigrated`, `RelationChanged`, `FloorEntered`) were
// published by no code path at all before 2026-07-29, so the enum advertised
// events the engine could not emit. Adding a value without naming its producer
// reintroduces exactly that lie.
//
// Three of the four are produced OUTSIDE this library — the arrival of a floor is
// something only the app shell knows about — and all three go through the single
// `publish_floor_arrival` below rather than through hand-written publishes at each
// site. That is the audit handle: one definition, and its call sites ARE the
// producer list for those three values. main.cpp has THREE arrival sites (the
// first load, the keyboard ride, the `--shot` ride) and its own comments record
// two separate bugs caused by fixing one of them and forgetting the others, which
// is why the payload is assembled here and not there.
//
// The count itself is not guessed either: `NpcPool::count()` is documented as the
// high-water mark of slots ever handed out and never decreases, so its delta
// across a load IS the number of records that load seeded. `alive()` would be the
// wrong figure — it falls when somebody dies.
enum class EventType : std::uint16_t {
    None = 0,
    // A contiguous BATCH of pool records was seeded. Batch and not per-record,
    // because the engine has no single-NPC spawn path: `NpcPool::spawn()` is
    // called only from `seed_floor_from_spec`, which allocates a whole floor's
    // crowd in one bump-allocated range ([floor_stream.h] firstId/count). A
    // per-record event would publish 420 entries for one Residential load,
    // outside any drain cycle, and the next `clear()` would wipe the lot unread.
    // `a` = first record id, `b` = how many, `c` = floor (see event_floor).
    // Producer: `publish_floor_arrival`, from the `NpcPool::count()` delta across
    // the load. Suppressed when the delta is zero, which is every RE-entry to a
    // floor — a module seeds its crowd exactly once ([floor_stream.h]) and every
    // later visit re-embodies the same id range, so a per-visit NpcSpawned would
    // report 420 fresh people who are the same 420 people.
    NpcSpawned,
    // `a` = victim NpcId or kInvalidNpc for a mob, `b` = MobKind or 0xFF,
    // `c` = killer ENTITY id (not a pool id — see relations_drain_deaths).
    // Producer: combat.cpp `finalize_deaths`, the one death point in the tick.
    NpcDied,
    // A record moved between floors. `a` = record id, `b` = from floor,
    // `c` = to floor (both signed-packed, see event_floor).
    // Producer: `publish_floor_arrival`, when `fromFloor != toFloor`. Note this is
    // the RIDE and not a pool-row rewrite: `NpcPool::floor()` is written in exactly
    // one place (population.cpp:111, at seed time) and never updated afterwards, so
    // the row still names the floor the record was seeded on. Do not read the row
    // to recover where somebody is; read this.
    NpcMigrated,
    // Two matrix rows shifted. `a` = row A, `b` = row B, `c` = the new relation
    // value, zero-extended from int8 (recover with event_relation).
    // Producer: faction_relations.cpp `relations_drain_deaths`.
    //
    // That function is the only publisher and it is itself a CONSUMER of NpcDied,
    // so this value is the one place the bus feeds itself. Which is also the trap
    // worth naming: a producer that only runs when somebody calls it is not a
    // producer until somebody does, and `relations_drain_deaths` had no caller
    // outside its own suite — a live `FactionRelations` has to be owned by the app
    // shell and drained beside the other NpcDied consumers, or this enumerator is
    // reachable only from a test.
    RelationChanged,
    // An item moved between two inventories. `a` = from, `b` = to (either may be
    // kInvalidNpc for "the world"), `c` = item id.
    // Producers: loot.cpp `pickup_step` / `use_best_heal`, needs.cpp consumables.
    ItemTransferred,
    // The player / an embodied NPC entered a floor. `a` = floor (signed-packed,
    // see event_floor), `b` = LayerId, `c` = the entering record id.
    // Producer: `publish_floor_arrival`, unconditionally — every arrival is one.
    //
    // `b` is the storage SLOT and `a` is the logical label; they are different
    // concepts and the label is mutable ([floors.md]). A consumer that wants the
    // floor must read `a`.
    FloorEntered,
    // A prop fell out of the world and needs a GPU handoff.
    // a = pos.x, b = pos.y, c = pos.z
    PropDetached,
    // A firearm jammed due to wear or dust.
    // a = shooter NpcId or kInvalidNpc if player.
    WeaponJammed,
};

// How many EventType values there are, for the per-type tally arrays. The
// static_assert is what keeps this honest: add a value past PropDetached and the
// build stops here rather than silently dropping it out of every count.
inline constexpr std::size_t kEventTypeCount = 9;
static_assert(static_cast<std::size_t>(EventType::WeaponJammed) + 1 ==
                  kEventTypeCount,
              "kEventTypeCount must cover every EventType value");

// One event. POD, trivially copyable, 24 bytes. The three `a/b/c` slots are
// generic payload whose meaning depends on `type` (documented per kind at the
// enum above): e.g. for NpcDied `a` = victim id; for ItemTransferred `a` = from,
// `b` = to, `c` = item id.
struct Event {
    EventType type = EventType::None;
    std::uint16_t pad = 0;
    std::uint32_t a = 0;
    std::uint32_t b = 0;
    std::uint32_t c = 0;
    std::uint64_t tick = 0; // producer-stamped time; 0 if the caller omits it
};

class EventBus {
public:
    // Ring capacity for a single drain cycle. Sized once at init(); the surplus
    // in an overfull cycle is dropped, never grown.
    static constexpr std::size_t kCapacity = 4096;

    // Allocate the ring once. Idempotent; also resets counters and the log.
    void init();

    // Publish an event for this cycle. Returns false (and bumps dropped()) if
    // the ring is already full. Mirrors into the log if logging is on.
    bool publish(const Event& e);

    // Convenience overload — build + publish without a temporary at call sites.
    bool publish(EventType type, std::uint32_t a = 0, std::uint32_t b = 0,
                 std::uint32_t c = 0, std::uint64_t tick = 0);

    // The events published this cycle, in publish order. Valid until clear().
    //
    // The pointer is stable for the object's whole life: `init()` sizes the ring
    // to kCapacity and nothing ever resizes it. That is what makes publishing
    // from INSIDE a drain loop safe — a consumer that reacts to an event by
    // publishing another (relations_drain_deaths does exactly this) cannot
    // invalidate the pointer it is reading through. Snapshot `size()` before such
    // a loop or the new events join the batch being drained.
    const Event* events() const { return ring_.data(); }
    std::size_t size() const { return size_; }
    bool empty() const { return size_ == 0; }

    // Drop this cycle's batch. Call once after all consumers have read it.
    // Does NOT touch the optional log, and does NOT reset dropped() — that is a
    // since-init() figure on purpose, because a drop is a sizing problem and a
    // per-cycle counter would hide a slow leak behind a zero.
    void clear() {
        size_ = 0;
        for (std::size_t i = 0; i < kEventTypeCount; ++i) cycle_[i] = 0;
    }

    // Events dropped since init() because the ring was full (a tuning signal).
    std::uint64_t dropped() const { return dropped_; }

    // How many of `t` were published in the current cycle (reset by clear()).
    std::uint32_t cycle_count(EventType t) const {
        const std::size_t i = static_cast<std::size_t>(t);
        return i < kEventTypeCount ? cycle_[i] : 0u;
    }

    // How many of `t` have been published since init(). Never reset by clear(),
    // so this is the figure worth putting on screen: it answers "is this producer
    // firing at all", which a per-cycle count cannot.
    std::uint64_t total_count(EventType t) const {
        const std::size_t i = static_cast<std::size_t>(t);
        return i < kEventTypeCount ? total_[i] : 0u;
    }

    // Optional append-only history. Off by default. When on, every successfully
    // published event is also appended here and kept across clear() calls.
    void set_logging(bool on) { logging_ = on; }
    bool logging() const { return logging_; }
    const std::vector<Event>& log() const { return log_; }
    void clear_log() { log_.clear(); }

private:
    std::vector<Event> ring_;  // fixed capacity, reused each cycle
    std::size_t size_ = 0;     // live events in the ring this cycle
    std::uint64_t dropped_ = 0;
    // Per-type tallies. `cycle_` is this drain cycle, `total_` is since init().
    // Both are indexed by the EventType value, which is why kEventTypeCount is
    // static_assert'd against the last enumerator.
    std::uint32_t cycle_[kEventTypeCount] = {};
    std::uint64_t total_[kEventTypeCount] = {};
    bool logging_ = false;
    std::vector<Event> log_;   // grows only while logging_ is true
};

// --- signed payload in an unsigned slot -------------------------------------
//
// Floor numbers are SIGNED and the demo stack reaches -50, while the event slots
// are `std::uint32_t`. The round trip is exact and these two helpers are the only
// place it is spelled, because getting it wrong is silent: reading a raw slot
// straight back gives 4294967246 for floor -50, which is not a crash, just a
// number a HUD prints and nobody questions. Same class of trap as
// `NpcPool::floor()` being uint16 (floor -50 stored as 65486).
//
// Guaranteed, not merely usual: C++20 mandates two's-complement integers, so
// int32 -> uint32 -> int32 is value-preserving for the whole range.
inline std::uint32_t pack_floor(std::int32_t floorNumber) {
    return static_cast<std::uint32_t>(floorNumber);
}
inline std::int32_t event_floor(std::uint32_t slot) {
    return static_cast<std::int32_t>(slot);
}

// A relation value travels the same way: int8 -> uint32 -> int8.
inline std::uint32_t pack_relation(std::int8_t v) {
    return static_cast<std::uint32_t>(static_cast<std::int32_t>(v));
}
inline std::int8_t event_relation(std::uint32_t slot) {
    return static_cast<std::int8_t>(static_cast<std::int32_t>(slot));
}

// --- typed publish helpers --------------------------------------------------
//
// Thin, inline, and worth existing for one reason only: they put the payload
// contract in the same place as the enum comment, so a call site cannot quietly
// disagree with it. `NpcDied` and `ItemTransferred` deliberately have no helper —
// their producers predate this and already carry the contract in a comment.

// One floor's crowd was seeded. `count` is the delta in NpcPool::count().
inline bool publish_npc_spawned(EventBus& bus, std::uint32_t firstId,
                                std::uint32_t count, std::int32_t floorNumber,
                                std::uint64_t tick) {
    return bus.publish(EventType::NpcSpawned, firstId, count,
                       pack_floor(floorNumber), tick);
}

// A record rode from one floor to another.
inline bool publish_npc_migrated(EventBus& bus, std::uint32_t npcId,
                                 std::int32_t fromFloor, std::int32_t toFloor,
                                 std::uint64_t tick) {
    return bus.publish(EventType::NpcMigrated, npcId, pack_floor(fromFloor),
                       pack_floor(toFloor), tick);
}

// A record arrived on a floor. `layer` is the storage slot, `floorNumber` the
// logical label — pass both, they are not interchangeable ([floors.md]).
inline bool publish_floor_entered(EventBus& bus, std::int32_t floorNumber,
                                  std::uint32_t layer, std::uint32_t npcId,
                                  std::uint64_t tick) {
    return bus.publish(EventType::FloorEntered, pack_floor(floorNumber), layer,
                       npcId, tick);
}

inline bool publish_weapon_jammed(EventBus& bus, std::uint32_t shooterId,
                                  std::uint64_t tick) {
    return bus.publish(EventType::WeaponJammed, shooterId, 0, 0, tick);
}

// --- one floor arrival, one call --------------------------------------------
//
// Everything an arrival publishes: the crowd it seeded (NpcSpawned, only if the
// pool actually grew), the ride that got you here (NpcMigrated, only if you came
// from a different floor), and the arrival itself (FloorEntered, always). Returns
// how many events were published, 1..3.
//
// This exists as ONE function because `src/app/main.cpp` has THREE arrival sites
// and a documented history of fixing one and forgetting the rest — the rumour
// reset and the door build were each shipped broken at the `--shot` site for that
// exact reason, and both are commented in place. Three publishes copied to three
// sites is nine chances to drift; this is one.
//
// `countBefore`/`countAfter` are `NpcPool::count()` either side of the load. It is
// a HIGH-WATER MARK that never decreases, so `after - before` is the number of
// records seeded and is 0 on every re-entry. `firstId` is derived as
// `countBefore`, which is exact because the pool is a bump allocator that never
// reclaims a slot ([npcs.md]).
//
// Pass `fromFloor == toFloor` for a load that is not a ride (the first one).
std::uint32_t publish_floor_arrival(EventBus& bus, std::uint32_t countBefore,
                                   std::uint32_t countAfter,
                                   std::int32_t fromFloor, std::int32_t toFloor,
                                   std::uint32_t layer, std::uint32_t npcId,
                                   std::uint64_t tick);

// --- the consumer -----------------------------------------------------------
//
// Render one event as a line of text. Returns false for a type it cannot render
// (only `None`) or for a null/zero-length buffer, leaving `out` untouched.
//
// A switch and not a table of format strings: the payload slots mean different
// things per type and two of them need `event_floor`/`event_relation` to be read
// at all, so a table would either print the raw u32 (4294967246 for floor -50) or
// need a per-type decoder beside it anyway.
bool event_line(const Event& e, char* out, std::size_t cap);

// The last few events, as text, held across `clear()`.
//
// This is what makes the bus observable. Reading `EventBus::events()` from the
// HUD cannot work: the bus is transient and cleared once per FRAME while the sim
// runs up to 8 fixed steps per frame, so the render pass would see whatever the
// last step happened to leave — almost always nothing. So the feed is drained on
// the sim's clock and keeps its lines until they are pushed out by newer ones.
//
// Fixed storage, no allocation, POD: 6 x 96 B of text + 6 x 8 B of ticks + two
// cursors = 640 B. Sized for a HUD block that stays readable, not for history —
// that is what `set_logging` is for.
struct EventFeed {
    static constexpr std::size_t kLines = 6;
    static constexpr std::size_t kLineLen = 96;

    char line[kLines][kLineLen] = {};
    std::uint64_t at[kLines] = {};   // the sim tick each line was published on
    std::size_t next = 0;            // ring cursor: the slot to overwrite next
    std::size_t live = 0;            // how many slots hold a line, <= kLines
};

// Render this cycle's batch into `feed`. Returns how many lines were written.
//
// Call it LAST — after every other consumer and before `clear()` — because a
// consumer may itself publish: `relations_drain_deaths` reads NpcDied and emits
// RelationChanged, and draining the feed first would render the batch without it.
//
// A cycle with more than kLines events loses the oldest of them, on purpose: a
// feed that dropped the NEWEST would freeze on screen during a firefight, which
// is exactly when it has something to say.
std::size_t feed_drain(EventFeed& feed, const EventBus& bus);

// Line `i`, NEWEST first (i = 0 is the most recent). nullptr past `live`.
const char* feed_line(const EventFeed& feed, std::size_t i);

// The sim tick line `i` was published on, for a HUD that wants to fade old lines.
// 0 past `live`.
std::uint64_t feed_tick(const EventFeed& feed, std::size_t i);

} // namespace giga::game
