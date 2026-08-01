#pragma once

#include <cstdint>
#include <vector>
#include <unordered_set>
#include <queue>
#include "world/nav.h"
#include "world/macro_grid.h"

namespace giga::nav {

struct CoarseGraph;
struct FineGraph;

// ───────────────────────────────────────────────────────────────────────────────
// ЗОЛОТОЕ ПРАВИЛО ГРАФА ЭЖИРНЯКА: Background Lazy Field Rebaker
// 
// Обеспечивает постепенное фоновое перепекание навигационных полей и 
// графов видимости при длительном разрушении этажа (1024^3) и игре без 
// загрузок при 0% потерь FPS.
// ───────────────────────────────────────────────────────────────────────────────

struct DirtyRegion {
    int cx = 0;
    int cy = 0;
    int cz = 0;
    std::uint32_t priority = 0;
};

class LazyFieldRebaker {
public:
    LazyFieldRebaker() = default;
    ~LazyFieldRebaker() = default;

    // Пометить измененные макро-ячейки после World::carve / взрывов
    void mark_dirty_cells(const std::vector<std::uint64_t>& dirtyCellKeys);

    // Добавить ячейку в очередь перепекания с приоритетом
    void queue_region(int cx, int cy, int cz, std::uint32_t priority = 1);

    // Ленивый пошаговый прогон в кадре (с фиксированным бюджетом времени <= 0.2 мс)
    std::size_t step_lazy_rebake(const MacroGrid& grid, CoarseGraph& coarse, FineGraph& fine, float budgetMs = 0.2f);

    // Остаток очередей на перепекание
    std::size_t pending_count() const { return m_pendingQueue.size(); }
    bool is_idle() const { return m_pendingQueue.empty(); }

    void clear() {
        m_queuedSet.clear();
        std::queue<DirtyRegion> empty;
        std::swap(m_pendingQueue, empty);
    }

private:
    std::unordered_set<std::uint64_t> m_queuedSet;
    std::queue<DirtyRegion> m_pendingQueue;
    std::uint64_t m_rebakedCountTotal = 0;
};

} // namespace giga::nav
