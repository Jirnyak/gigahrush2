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
#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace giga::game {

// Event kinds. Extend as gameplay systems need them; the tag is just a u16 so
// the enum can grow without touching the POD layout.
enum class EventType : std::uint16_t {
    None = 0,
    NpcSpawned,
    NpcDied,
    NpcMigrated,     // moved between floors (macro sim)
    RelationChanged, // affinity shifted between two NPCs
    ItemTransferred, // item moved between two inventories
    FloorEntered,    // the player / an embodied NPC entered a floor
};

// One event. POD, trivially copyable, 24 bytes. The three `a/b/c` slots are
// generic payload whose meaning depends on `type` (documented per kind at the
// call sites): e.g. for NpcDied `a` = victim id; for ItemTransferred `a` = from,
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
    const Event* events() const { return ring_.data(); }
    std::size_t size() const { return size_; }
    bool empty() const { return size_ == 0; }

    // Drop this cycle's batch. Call once after all consumers have read it.
    // Does NOT touch the optional log.
    void clear() { size_ = 0; }

    // Events dropped since init() because the ring was full (a tuning signal).
    std::uint64_t dropped() const { return dropped_; }

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
    bool logging_ = false;
    std::vector<Event> log_;   // grows only while logging_ is true
};

} // namespace giga::game
