#include "game/event_bus.h"

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
    if (size_ >= kCapacity) {
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

} // namespace giga::game
