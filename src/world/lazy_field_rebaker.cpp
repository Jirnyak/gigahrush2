#include "world/lazy_field_rebaker.h"

#include <chrono>

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
                                               FineNav& fine,
                                               float budgetMs) {
    // Live graph empty => full AsyncBake in flight. Keep queue for after poll().
    if (fine.flow.empty()) return 0;

    const auto tStart = std::chrono::high_resolution_clock::now();
    std::size_t processedThisFrame = 0;

    while (!m_pendingQueue.empty()) {
        const int nodeId = m_pendingQueue.front();
        m_pendingQueue.pop();
        m_queuedSet.erase(nodeId);

        rebake_fine_node(grid, fine, nodeId);
        m_needClosingPass = true;
        m_rebakedCountTotal++;
        processedThisFrame++;

        const auto tNow = std::chrono::high_resolution_clock::now();
        const float elapsedMs =
            std::chrono::duration<float, std::milli>(tNow - tStart).count();
        if (elapsedMs >= budgetMs) break;
    }

    // Closing pass once: nearest Voronoi + coarse edges/all-pairs.
    if (m_pendingQueue.empty() && m_needClosingPass) {
        rebake_nearest(grid, fine);
        rebake_coarse(grid, coarse);
        m_needClosingPass = false;
        m_closingPassCount++;
    }

    return processedThisFrame;
}

} // namespace giga::nav
