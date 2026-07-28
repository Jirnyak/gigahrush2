// Asynchronous navigation bake — takes the floor-entry freeze off the main thread.
//
// The bake itself is not slow because it is naive: it is already fanned across
// every hardware thread by `core/jobs.h` ([nav.h]). It is slow because it is a lot
// of work — 64 wrapped BFS for the coarse graph and 64 more for the flow fields,
// each sweeping a 128^3 grid. Measured on a 20-thread machine: **coarse ~1.9 s +
// fine ~1.8 s**, so every elevator ride cost a ~3.7 s frozen frame.
//
// `performance.md` declares load time unbounded, so this was within contract — but
// a multi-second hitch on every floor change is still the worst thing the player
// feels. This moves it to a worker and lets the game run meanwhile.
//
// The trade is honest and worth stating: while a bake is in flight the floor has
// **no navigation**, so its crowd stands still. `wander_step` already no-ops on an
// empty flow field, so that degradation is automatic rather than special-cased. The
// player can move, look, fight and loot immediately; the residents catch up.
//
// Deliberately NOT double-buffered by copying the grid. A 128^3 `MacroGrid` is
// ~132 MiB, and copying it to protect the worker would trade a 3.7 s freeze for a
// large allocation and memcpy on every ride. Instead the contract is: the caller
// must not mutate or regenerate the `World` while a bake is in flight, and `start()`
// enforces it by joining any running worker first. Floor regeneration only happens
// on travel, and travel goes through `start()`.
#pragma once

#include <atomic>
#include <thread>

#include "world/nav.h"

namespace giga {

class MacroGrid;

namespace nav {

// Owns the live graph the tick reads and the pending one a worker fills.
//
// Single-consumer by design: the sim tick reads `coarse()`/`fine()` and nothing
// else touches them. Ownership passes at exactly one point — inside `poll()`, on
// the main thread, after the worker has been joined.
class AsyncBake {
public:
    AsyncBake() = default;
    ~AsyncBake();
    AsyncBake(const AsyncBake&) = delete;
    AsyncBake& operator=(const AsyncBake&) = delete;

    // Begin baking `grid` on a worker. Clears the live graph first, so the tick
    // immediately sees "no navigation" rather than the previous floor's — steering
    // agents by a graph baked from different geometry would walk them into walls.
    //
    // Joins any in-flight bake before starting (blocking, and rare: it only
    // happens if a floor change lands inside another floor change). `grid` must
    // outlive the bake and must not be mutated until `ready()` — see the header
    // note on why this is a contract rather than a copy.
    void start(const MacroGrid& grid);

    // Hand a finished bake over to the live side. Cheap and safe to call every
    // frame; returns true on the frame the swap actually happened, which is the
    // caller's cue to re-seed whatever depends on navigation.
    bool poll();

    // True while a worker is running.
    bool baking() const { return running_; }

    // True when the live graph is usable. False between `start()` and the `poll()`
    // that completes it — which is exactly when the crowd stands still.
    bool ready() const { return !fine_.flow.empty(); }

    const CoarseGraph& coarse() const { return coarse_; }
    const FineNav& fine() const { return fine_; }

    // Milliseconds the last completed bake took, split by stage. For the HUD, so
    // the cost stays visible instead of becoming folklore.
    float last_coarse_ms() const { return coarseMs_; }
    float last_fine_ms() const { return fineMs_; }

private:
    void join_worker();

    CoarseGraph coarse_{};   // live: read by the sim tick
    FineNav fine_{};
    CoarseGraph pending_{};  // written by the worker, never read by the tick
    FineNav pendingFine_{};

    std::thread worker_;
    std::atomic<bool> done_{false};
    bool running_ = false;
    float coarseMs_ = 0.0f;
    float fineMs_ = 0.0f;
};

} // namespace nav
} // namespace giga
