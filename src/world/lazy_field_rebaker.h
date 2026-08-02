#pragma once

#include <cstdint>
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
// frame step_lazy_rebake spends <= budgetMs rebaking fine flow slices one node
// at a time, then rebuilds nearest + coarse once the queue drains.
class LazyFieldRebaker {
public:
    LazyFieldRebaker() = default;
    ~LazyFieldRebaker() = default;

    // Flat macro_index keys (CarveResult::dirtyCells / LazyFieldBaker packing).
    void mark_dirty_cells(const std::vector<std::uint32_t>& dirtyMacroKeys);

    // Queue a lattice node id in [0, kNodes).
    void queue_node(int nodeId, std::uint32_t priority = 1);

    // Spend up to budgetMs rebaking pending fine nodes. When the queue empties
    // after work, rebuilds nearest + coarse once. Returns fine nodes rebaked.
    // No-op (returns 0) when fine.flow is empty (AsyncBake in flight).
    std::size_t step_lazy_rebake(const MacroGrid& grid, CoarseGraph& coarse,
                                 FineNav& fine, float budgetMs = 0.2f);

    std::size_t pending_count() const { return m_pendingQueue.size(); }
    bool is_idle() const {
        return m_pendingQueue.empty() && !m_needClosingPass;
    }
    std::uint64_t rebaked_count_total() const { return m_rebakedCountTotal; }
    std::uint64_t closing_pass_count() const { return m_closingPassCount; }

    void clear() {
        m_queuedSet.clear();
        std::queue<int> empty;
        std::swap(m_pendingQueue, empty);
        m_needClosingPass = false;
    }

private:
    std::unordered_set<int> m_queuedSet;
    std::queue<int> m_pendingQueue;
    bool m_needClosingPass = false;
    std::uint64_t m_rebakedCountTotal = 0;
    std::uint64_t m_closingPassCount = 0;
};

} // namespace giga::nav
