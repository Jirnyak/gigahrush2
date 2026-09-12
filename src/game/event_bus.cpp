#include "game/event_bus.h"

#include <cstdio>

// For `kInvalidNpc` only, and in the .cpp rather than the header on purpose: the
// bus stays a dependency-free POD ring that anything may include, while the one
// place that has to KNOW what an empty id slot means — the text renderer — pulls
// the constant from where it is defined instead of restating 0xFFFFFFFF.
#include "game/npc_pool.h"

namespace giga::game {

void EventBus::init() {
    // Size the ring to its fixed capacity once; index [0, kCapacity) is always
    // valid so publish() never reallocates. size_ is the live-count high mark.
    ring_.assign(kCapacity, Event{});
    size_ = 0;
    dropped_ = 0;
    for (std::size_t i = 0; i < kEventTypeCount; ++i) {
        cycle_[i] = 0;
        total_[i] = 0;
    }
    logging_ = false;
    log_.clear();
}

bool EventBus::publish(const Event& e) {
    // Шина ДО init() — кольцо не аллоцировано: считаем полным (дроп со
    // счётчиком), не UB. Вылезло 2026-09-05 посадкой продюсеров деяний:
    // тестовые шины без init() годами были безопасны, пока шаги игнорировали
    // bus; писать в ring_[0] пустого вектора — сегфолт. Прод всегда init()ит
    // — dropped() там от этой ветки не растёт.
    if (ring_.empty() || size_ >= kCapacity) {
        // Bounded ring stays bounded: count the drop instead of growing.
        //
        // A dropped event is NOT tallied into cycle_/total_, deliberately: those
        // count what a consumer could actually see, so `total_count(t) + dropped()`
        // is the number published and the two figures never double-count. A drop is
        // its own signal and reads differently — it means the ring is undersized.
        ++dropped_;
        return false;
    }
    ring_[size_++] = e;
    // Two increments per publish, and the bounds check is what keeps a caller with
    // a bogus u16 tag from writing past the arrays. EventType is an open u16 by
    // design (the header says so), so this cannot be an assert.
    const std::size_t ix = static_cast<std::size_t>(e.type);
    if (ix < kEventTypeCount) {
        ++cycle_[ix];
        ++total_[ix];
    }
    if (logging_) log_.push_back(e);
    return true;
}

bool EventBus::publish(EventType type, std::uint32_t a, std::uint32_t b,
                       std::uint32_t c, std::uint64_t tick) {
    Event e;
    e.type = type;
    e.a = a;
    e.b = b;
    e.c = c;
    e.tick = tick;
    return publish(e);
}

std::uint32_t publish_floor_arrival(EventBus& bus, std::uint32_t countBefore,
                                   std::uint32_t countAfter,
                                   std::int32_t fromFloor, std::int32_t toFloor,
                                   std::uint32_t layer, std::uint32_t npcId,
                                   std::uint64_t tick) {
    std::uint32_t published = 0;

    // The crowd, only if the pool actually grew. `count()` is a high-water mark, so
    // `>` is not defensive — a re-entry leaves it exactly equal and must publish
    // nothing rather than a batch of zero people.
    if (countAfter > countBefore) {
        const std::uint32_t n = countAfter - countBefore;
        // firstId == countBefore because the pool is a bump allocator that never
        // reclaims: the next slot handed out is always the old count ([npcs.md]).
        if (publish_npc_spawned(bus, countBefore, n, toFloor, tick)) ++published;
    }

    // The ride. Suppressed for a load that is not one, which is how the very first
    // floor avoids claiming the player migrated from floor 0 to floor 0.
    if (fromFloor != toFloor && npcId != kInvalidNpc)
        if (publish_npc_migrated(bus, npcId, fromFloor, toFloor, tick)) ++published;

    // The arrival itself, always. `layer` is the storage SLOT and `toFloor` the
    // logical label; both travel because they are different concepts ([floors.md]).
    if (publish_floor_entered(bus, toFloor, layer, npcId, tick)) ++published;

    return published;
}

bool event_line(const Event& e, char* out, std::size_t cap) {
    if (!out || cap == 0) return false;
    switch (e.type) {
        case EventType::NpcSpawned:
            std::snprintf(out, cap, "spawned %u records from #%u on floor %d",
                          e.b, e.a, event_floor(e.c));
            return true;
        case EventType::NpcDied:
            // `b` is 0xFF when the dead thing was not a monster, which is the one
            // payload slot in the game that means "not applicable" rather than a
            // value — printing it as a MobKind would name kind 255.
            if (e.b == 0xFFu)
                std::snprintf(out, cap, "record %u died (killer entity %u)", e.a,
                              e.c);
            else
                std::snprintf(out, cap, "monster kind %u died (killer entity %u)",
                              e.b, e.c);
            return true;
        case EventType::NpcMigrated:
            std::snprintf(out, cap, "record %u rode floor %d -> %d", e.a,
                          event_floor(e.b), event_floor(e.c));
            return true;
        case EventType::RelationChanged:
            std::snprintf(out, cap, "relation %u<->%u now %d", e.a, e.b,
                          static_cast<int>(event_relation(e.c)));
            return true;
        case EventType::ItemTransferred:
            // Either end may be kInvalidNpc for "the world" — a pickup off the floor
            // and a ration being eaten are the same event with one end missing, and
            // printing 4294967295 as an owner id is how that stops being legible.
            if (e.a == kInvalidNpc)
                std::snprintf(out, cap, "item %u picked up by %u", e.c, e.b);
            else if (e.b == kInvalidNpc)
                std::snprintf(out, cap, "item %u consumed by %u", e.c, e.a);
            else
                std::snprintf(out, cap, "item %u: %u -> %u", e.c, e.a, e.b);
            return true;
        case EventType::FloorEntered:
            std::snprintf(out, cap, "record %u entered floor %d (layer %u)", e.c,
                          event_floor(e.a), e.b);
            return true;
        // a/b/c = packed world pos (uint32 casts of pos.x/y/z) from detach_single_prop.
        // [jirnyak.md] section 18 PropDetached — must be feed-visible like every other type.
        case EventType::PropDetached:
            std::snprintf(out, cap, "prop detached at (%u,%u,%u)", e.a, e.b, e.c);
            return true;
        // Деяние (S19): глагол и клетка распакованы из c (см. [event_bus.h]);
        // актор — entt-хэндл (0xFFFFFFFF = никто), жертва — NpcId.
        case EventType::Deed:
            std::snprintf(out, cap, "deed verb %u by entity %u at (%u,%u,%u)",
                          e.c >> 24, e.a, e.c & 0xFFu, (e.c >> 8) & 0xFFu,
                          (e.c >> 16) & 0xFFu);
            return true;
        case EventType::None:
        default:
            return false;
    }
}

std::size_t feed_drain(EventFeed& feed, const EventBus& bus) {
    // The whole batch as it stands. This renders and never publishes, so unlike
    // relations_drain_deaths it has no self-reentry problem to guard against —
    // it just has to run after the consumers that DO publish.
    const std::size_t n = bus.size();
    const Event* ev = bus.events();
    std::size_t wrote = 0;
    for (std::size_t i = 0; i < n; ++i) {
        char tmp[EventFeed::kLineLen];
        if (!event_line(ev[i], tmp, sizeof(tmp))) continue;
        char* dst = feed.line[feed.next];
        std::size_t k = 0;
        for (; k + 1 < EventFeed::kLineLen && tmp[k] != '\0'; ++k) dst[k] = tmp[k];
        dst[k] = '\0';
        feed.at[feed.next] = ev[i].tick;
        feed.next = (feed.next + 1) % EventFeed::kLines;
        if (feed.live < EventFeed::kLines) ++feed.live;
        ++wrote;
    }
    return wrote;
}

const char* feed_line(const EventFeed& feed, std::size_t i) {
    if (i >= feed.live) return nullptr;
    // `next` points at the slot to overwrite, so the NEWEST line is next-1 and the
    // newest-first walk is backwards from there. + kLines before the modulo because
    // the subtraction underflows on an unsigned cursor at 0 — the whole reason this
    // is a function and not an index expression at the call site.
    const std::size_t ix =
        (feed.next + EventFeed::kLines - 1 - i) % EventFeed::kLines;
    return feed.line[ix];
}

std::uint64_t feed_tick(const EventFeed& feed, std::size_t i) {
    if (i >= feed.live) return 0;
    const std::size_t ix =
        (feed.next + EventFeed::kLines - 1 - i) % EventFeed::kLines;
    return feed.at[ix];
}

} // namespace giga::game
