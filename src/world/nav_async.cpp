#include "world/nav_async.h"

#include <chrono>

#include "world/macro_grid.h"

namespace giga::nav {

AsyncBake::~AsyncBake() { join_worker(); }

void AsyncBake::join_worker() {
    if (worker_.joinable()) worker_.join();
    running_ = false;
}

void AsyncBake::start(const MacroGrid& grid) {
    // Only one bake at a time. Joining here is what lets the rest of the class
    // avoid copying a 132 MiB grid: the caller cannot regenerate the World while a
    // worker is reading it, because regeneration goes through travel and travel
    // goes through here.
    join_worker();
    done_.store(false, std::memory_order_relaxed);

    // Drop the live graph BEFORE launching. A stale graph is worse than none: it
    // was baked from different geometry, so steering by it walks agents into walls
    // that did not exist when it was made. An empty flow field makes wander_step
    // no-op, which is the honest degradation.
    fine_.flow.clear();
    fine_.flow.shrink_to_fit();

    running_ = true;
    const MacroGrid* g = &grid;
    worker_ = std::thread([this, g] {
        using clock = std::chrono::steady_clock;
        const auto t0 = clock::now();
        bake_coarse(*g, pending_);
        const auto t1 = clock::now();
        bake_fine(*g, pendingFine_);
        const auto t2 = clock::now();

        coarseMs_ = std::chrono::duration<float, std::milli>(t1 - t0).count();
        fineMs_ = std::chrono::duration<float, std::milli>(t2 - t1).count();
        // Release, paired with the acquire in poll(): everything written above must
        // be visible to the main thread before it sees the flag.
        done_.store(true, std::memory_order_release);
    });
}

bool AsyncBake::poll() {
    if (!running_) return false;
    if (!done_.load(std::memory_order_acquire)) return false;

    // Join first, then take ownership. Joining before touching `pending_` is what
    // makes the handover a plain move rather than a synchronised one — after join()
    // the worker provably cannot touch it again.
    join_worker();
    coarse_ = pending_;
    fine_.flow = std::move(pendingFine_.flow);
    pendingFine_.flow.clear();
    return true;
}

} // namespace giga::nav
