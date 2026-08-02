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
    if (fine.flow.empty()) return 0;
    std::size_t processedThisFrame = 0;

    if (m_closingTask.valid() &&
        m_closingTask.wait_for(std::chrono::seconds(0)) == std::future_status::ready) {
        ClosingResult res = m_closingTask.get();
        if (fine.nearest.size() == res.nearest.size()) {
            std::copy(res.nearest.begin(), res.nearest.end(), fine.nearest.begin());
        }
        coarse = res.coarse;
        m_closingPassCount++;
    }

    if (m_closingTask.valid()) {
        return 0;
    }

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

    if (m_pendingQueue.empty() && !m_activeTask.valid() && m_needClosingPass && !m_closingTask.valid()) {
        const MacroGrid* g = &grid;
        const FineNav* f = &fine;
        m_closingTask = std::async(std::launch::async, [g, f]() {
            ClosingResult res;
            res.nearest.assign(kMacroCells, kFlowNone);
            FineNav local_fine;
            local_fine.flow = f->flow; 
            local_fine.nearest = res.nearest;
            rebake_nearest(*g, local_fine);
            res.nearest = std::move(local_fine.nearest);
            rebake_coarse(*g, res.coarse);
            return res;
        });
        m_needClosingPass = false;
    }

    return processedThisFrame;
}

} // namespace giga::nav
