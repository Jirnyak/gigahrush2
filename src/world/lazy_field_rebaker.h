#pragma once

#include <cstdint>
#include <future>
#include <queue>
#include <unordered_set>
#include <vector>

#include "world/macro_grid.h"
#include "world/nav.h"

namespace giga::nav {

// jirnyak.md §22 — Background Lazy Field Rebaker
//
// On wall destroy / geometry change of a 1024^3 floor, nav must NOT block the
// render thread. Dirty lattice nodes are queued from carve dirtyCells; each
// frame step_lazy_rebake checks if a background thread has finished rebaking
// a slice and memcopies it. No BFS work happens on the main thread.
class LazyFieldRebaker {
public:
    LazyFieldRebaker() = default;
    ~LazyFieldRebaker() = default;

    // Flat macro_index keys (CarveResult::dirtyCells / LazyFieldBaker packing).
    void mark_dirty_cells(const std::vector<std::uint32_t>& dirtyMacroKeys);

    // Queue a lattice node id in [0, kNodes).
    void queue_node(int nodeId, std::uint32_t priority = 1);

    // Check if the background worker has finished a node. If so, apply it.
    // If idle and queue has items, spawn a background task for the next node.
    // When the queue empties, rebuilds nearest + coarse once.
    // Returns fine nodes applied this frame. No-op when fine.flow is empty.
    std::size_t step_lazy_rebake(const MacroGrid& grid, CoarseGraph& coarse,
                                 FineNav& fine);

    std::size_t pending_count() const { return m_pendingQueue.size(); }
    bool is_idle() const {
        return m_pendingQueue.empty() && !m_needClosingPass && !m_activeTask.valid();
    }
    std::uint64_t rebaked_count_total() const { return m_rebakedCountTotal; }
    std::uint64_t closing_pass_count() const { return m_closingPassCount; }

    void clear() {
        m_queuedSet.clear();
        std::queue<int> empty;
        std::swap(m_pendingQueue, empty);
        m_needClosingPass = false;
        // NOTE: we let any active future finish naturally, we just ignore its result later
        // if it writes to something, wait, it returns BakeResult by value, so no dangling refs.
    }

private:
    struct BakeResult {
        int nodeId;
        std::vector<std::uint8_t> flowData;
    };
    std::future<BakeResult> m_activeTask;

    struct ClosingResult {
        std::vector<std::uint8_t> nearest;
        CoarseGraph coarse;
    };
    std::future<ClosingResult> m_closingTask;

    std::unordered_set<int> m_queuedSet;
    std::queue<int> m_pendingQueue;
    bool m_needClosingPass = false;
    std::uint64_t m_rebakedCountTotal = 0;
    std::uint64_t m_closingPassCount = 0;
};

} // namespace giga::nav
