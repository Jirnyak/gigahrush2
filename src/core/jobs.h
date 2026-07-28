// A tiny BAKE-TIME job system: parallel_for over a fixed index range.
//
// gigahrush2 has exactly two time regimes (performance.md, memory
// `torus-nav-baking`): the LIVE sim tick, where the CPU is the one scarce budget
// and must stay O(n) single-purpose, and BAKE time (floor load / post-samosbor),
// which is off the hot path and unbounded — "peg all cores, spare nothing". This
// helper serves ONLY the second: it fans a [0, n) index range across the hardware
// threads so the nav bake can run its 64 independent per-node BFS in parallel
// (src/world/nav). Never call it from the sim tick.
//
// Determinism contract: the range is split into disjoint CONTIGUOUS chunks, so if
// body(i) only ever writes memory owned by index i, the result is both race-free
// AND independent of thread scheduling — the bake is bit-identical every run.
// Parallelise ACROSS independent units (nodes / fields), NEVER inside one. That
// is the multithreaded-bake golden rule.
//
// Core, dependency-free (std::thread only). Built -fno-exceptions: a failed
// thread spawn or join terminates, which is acceptable off the hot path.
#pragma once

#include <cstddef>
#include <thread>
#include <vector>

namespace giga {

// Run body(i) for every i in [0, n). With threads <= 0 it uses all hardware
// threads (capped at n); threads == 1 forces the serial path. body is shared
// across the workers, so it must be safe to call concurrently for distinct i.
template <class F>
void parallel_for(int n, F body, int threads = 0) {
    if (n <= 0) return;

    int hw = static_cast<int>(std::thread::hardware_concurrency());
    if (hw < 1) hw = 1;
    int t = threads > 0 ? threads : hw;
    if (t > n) t = n;

    if (t <= 1) {
        for (int i = 0; i < n; ++i) body(i);
        return;
    }

    const int chunk = (n + t - 1) / t; // ceil, so the last worker may be shorter
    std::vector<std::thread> pool;
    pool.reserve(static_cast<std::size_t>(t));
    for (int w = 0; w < t; ++w) {
        const int lo = w * chunk;
        int hi = lo + chunk;
        if (hi > n) hi = n;
        if (lo >= hi) break; // n not divisible: trailing workers own nothing
        pool.emplace_back([lo, hi, &body] {
            for (int i = lo; i < hi; ++i) body(i);
        });
    }
    for (std::thread& th : pool) th.join();
}

} // namespace giga
