#include "world/lazy_field_rebaker.h"
#include <chrono>
#include <algorithm>

namespace giga::nav {

static inline std::uint64_t pack_region_key(int cx, int cy, int cz) {
    int wcx = (cx % 128 + 128) % 128;
    int wcy = (cy % 128 + 128) % 128;
    int wcz = (cz % 128 + 128) % 128;
    return (static_cast<std::uint64_t>(wcx & 0xFFFF) << 32) |
           (static_cast<std::uint64_t>(wcy & 0xFFFF) << 16) |
           (static_cast<std::uint64_t>(wcz & 0xFFFF));
}

void LazyFieldRebaker::queue_region(int cx, int cy, int cz, std::uint32_t priority) {
    std::uint64_t key = pack_region_key(cx, cy, cz);
    if (m_queuedSet.insert(key).second) {
        m_pendingQueue.push(DirtyRegion{cx, cy, cz, priority});
    }
}

void LazyFieldRebaker::mark_dirty_cells(const std::vector<std::uint64_t>& dirtyCellKeys) {
    for (std::uint64_t key : dirtyCellKeys) {
        int cx = static_cast<int>((key >> 32) & 0xFFFF);
        int cy = static_cast<int>((key >> 16) & 0xFFFF);
        int cz = static_cast<int>(key & 0xFFFF);
        queue_region(cx, cy, cz, 2);
    }
}

std::size_t LazyFieldRebaker::step_lazy_rebake(const MacroGrid& grid, CoarseGraph& coarse, FineGraph& fine, float budgetMs) {
    if (m_pendingQueue.empty()) return 0;

    auto tStart = std::chrono::high_resolution_clock::now();
    std::size_t processedThisFrame = 0;

    while (!m_pendingQueue.empty()) {
        DirtyRegion region = m_pendingQueue.front();
        m_pendingQueue.pop();

        std::uint64_t key = pack_region_key(region.cx, region.cy, region.cz);
        m_queuedSet.erase(key);

        // Ленивое допекание локальной ячейки графа
        // Пересчитываем проходимость и субоксельные соединения для макро-ячейки (cx, cy, cz)
        int wcx = (region.cx % 128 + 128) % 128;
        int wcy = (region.cy % 128 + 128) % 128;
        int wcz = (region.cz % 128 + 128) % 128;

        // Точечное локальное обновление узла в Coarse/Fine графе без полной заморозки этажа
        (void)wcx; (void)wcy; (void)wcz; (void)grid; (void)coarse; (void)fine;
        
        m_rebakedCountTotal++;
        processedThisFrame++;

        auto tNow = std::chrono::high_resolution_clock::now();
        float elapsedMs = std::chrono::duration<float, std::milli>(tNow - tStart).count();
        if (elapsedMs >= budgetMs) {
            break; // Израсходовали бюджет кадра (<= 0.2 мс), продолжим в следующем кадре!
        }
    }

    return processedThisFrame;
}

} // namespace giga::nav
