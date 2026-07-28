#include "game/event_bus.h"

namespace giga::game {

void EventBus::init() {
    // Size the ring to its fixed capacity once; index [0, kCapacity) is always
    // valid so publish() never reallocates. size_ is the live-count high mark.
    ring_.assign(kCapacity, Event{});
    size_ = 0;
    dropped_ = 0;
    logging_ = false;
    log_.clear();
}

bool EventBus::publish(const Event& e) {
    if (size_ >= kCapacity) {
        // Bounded ring stays bounded: count the drop instead of growing.
        ++dropped_;
        return false;
    }
    ring_[size_++] = e;
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
