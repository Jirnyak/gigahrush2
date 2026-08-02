#include "world/lazy_field_rebaker.h"

#include <chrono>
#include <algorithm>

#include "world/lattice.h"
#include "world/types.h"

namespace giga::nav {

void LazyFieldRebaker::queue_node(int nodeId, std::uint32_t /*priority*/) {
    if (nodeId < 0 || nodeId >= kNodes) return;
    if (m_queuedSet.insert(nodeId).second) {
        m_pendingQueue.push(nodeId);
    }
}

void LazyFieldRebaker::mark_dirty_cells(
    const std::vector<std::uint32_t>& dirtyMacroKeys) {
    for (std::uint32_t key : dirtyMacroKeys) {
        // macro_index: x + y*128 + z*128*128 (world/types.h)
        const int cx =
            static_cast<int>(key % static_cast<std::uint32_t>(kMacroDim));
        const int cy = static_cast<int>(
            (key / static_cast<std::uint32_t>(kMacroDim)) %
            static_cast<std::uint32_t>(kMacroDim));
        const int cz = static_cast<int>(
            key / (static_cast<std::uint32_t>(kMacroDim) *
                   static_cast<std::uint32_t>(kMacroDim)));
        queue_node(lattice_id(lattice_axis_of(cx), lattice_axis_of(cy),
                              lattice_axis_of(cz)),
                   2);
    }
}

std::size_t LazyFieldRebaker::step_lazy_rebake(const MacroGrid& grid,
                                               CoarseGraph& coarse,
                                               FineNav& fine) {
    // Live graph empty => full AsyncBake in flight. Keep queue for after poll().
    if (fine.flow.empty()) return 0;

    std::size_t processedThisFrame = 0;

    // Check if background worker has finished a node
    if (m_activeTask.valid() &&
        m_activeTask.wait_for(std::chrono::seconds(0)) == std::future_status::ready) {
        BakeResult result = m_activeTask.get();
        const std::size_t need = static_cast<std::size_t>(kNodes) * kMacroCells;
        if (fine.flow.size() == need && result.nodeId >= 0 && result.nodeId < kNodes) {
            std::uint8_t* slice = fine.flow.data() + static_cast<std::size_t>(result.nodeId) * kMacroCells;
            std::copy(result.flowData.begin(), result.flowData.end(), slice);
        }
        m_needClosingPass = true;
        m_rebakedCountTotal++;
        processedThisFrame++;
    }

    // Launch a new background task if idle and queue is not empty
    if (!m_activeTask.valid() && !m_pendingQueue.empty()) {
        const int nodeId = m_pendingQueue.front();
        m_pendingQueue.pop();
        m_queuedSet.erase(nodeId);

        const MacroGrid* g = &grid;
        m_activeTask = std::async(std::launch::async, [g, nodeId]() {
            BakeResult res;
            res.nodeId = nodeId;
            res.flowData.assign(kMacroCells, kFlowNone);
            bake_fine_node_async(*g, nodeId, res.flowData.data());
            return res;
        });
    }

    // Closing pass once: nearest Voronoi + coarse edges/all-pairs.
    if (m_pendingQueue.empty() && !m_activeTask.valid() && m_needClosingPass) {
        rebake_nearest(grid, fine);
        rebake_coarse(grid, coarse);
        m_needClosingPass = false;
        m_closingPassCount++;
    }

    return processedThisFrame;
}

} // namespace giga::nav
