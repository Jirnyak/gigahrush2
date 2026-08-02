#include "world/nav_async.h"

#include <chrono>
#include <utility>

#include "world/macro_grid.h"

namespace giga::nav {

AsyncBake::~AsyncBake() { join_worker(); }

void AsyncBake::join_worker() {
    if (worker_.joinable()) worker_.join();
    running_ = false;
}

void AsyncBake::start(const MacroGrid& grid) {
    // A second start() while a bake is still running is rare (floor change inside
    // a floor change). Join first so the previous worker's writes to pending_*
    // finish before we re-use them — and so the previous worker doesn't outlive
    // a World the caller is about to regenerate.
    join_worker();

    // Drop the live graph immediately. Until poll() lands the new one, ready()
    // is false and the crowd stands still rather than steering by stale geometry.
    fine_.flow.clear();
    fine_.nearest.clear();
    pendingFine_.flow.clear();
    pendingFine_.nearest.clear();

    done_.store(false, std::memory_order_relaxed);
    running_ = true;

    // Capture by pointer: the grid is owned by the caller and must outlive the
    // bake (enforced by the start/travel contract in the header).
    worker_ = std::thread([this, g = &grid]() {
        using clock = std::chrono::steady_clock;
        const auto t0 = clock::now();
        bake_coarse(*g, pending_);
        const auto t1 = clock::now();
        bake_fine(*g, pendingFine_);
        const auto t2 = clock::now();
        coarseMs_ = std::chrono::duration<float, std::milli>(t1 - t0).count();
        fineMs_ = std::chrono::duration<float, std::milli>(t2 - t1).count();
        // release so the main thread's acquire load in poll() sees the finished
        // pending_* buffers.
        done_.store(true, std::memory_order_release);
    });
}

bool AsyncBake::poll() {
    if (!running_) return false;
    if (!done_.load(std::memory_order_acquire)) return false;

    join_worker();
    coarse_ = pending_;
    fine_.flow = std::move(pendingFine_.flow);
    fine_.nearest = std::move(pendingFine_.nearest);
    pendingFine_.flow.clear();
    pendingFine_.nearest.clear();
    return true;
}

} // namespace giga::nav
