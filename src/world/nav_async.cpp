#include "world/nav_async.h"

#include <chrono>
#include <cstdint>
#include <utility>
#include <vector>

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
    //
    // FREE IT, do not merely clear() it — that distinction is 128 MiB.
    // `std::vector::clear()` sets size to 0 and keeps capacity, so the old code held
    // the previous floor's entire 128 MiB flow field, as dead bytes, for the whole
    // ~3.7 s the worker spent allocating and filling the NEXT 128 MiB beside it. The
    // peak was therefore 256 MiB where half of it was garbage nobody could read
    // (ready() is false the whole time). poll() move-assigns, which frees the old
    // buffer — so the waste was invisible at every point except the one that matters,
    // the bake itself, which is also when the rest of a floor load is at its
    // hungriest.
    //
    // swap-with-a-temporary rather than shrink_to_fit(): shrink_to_fit is a
    // non-binding REQUEST the standard lets an implementation ignore, and a memory
    // guarantee that an implementation may decline is not a guarantee.
    // [performance.md] — RAM is the one budget that bounds the dense model.
    std::vector<std::uint8_t>().swap(fine_.flow);
    std::vector<std::uint8_t>().swap(fine_.nearest);
    std::vector<std::uint8_t>().swap(pendingFine_.flow);
    std::vector<std::uint8_t>().swap(pendingFine_.nearest);

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
