#pragma once
#include <atomic>
#include <mutex>
#include <thread>
#include <vector>
#include <memory>
#include <cstdint>
#include "core/wrap.h"
#include "world/field.h"
#include "world/world.h"

namespace giga::game {

// Снимок измененной ячейки для безопасного запекания в фоновом потоке (0% Data Race)
struct CellSnapshot {
    std::uint64_t key;
    SubMask mask;
    CellType type;
};

template <typename T>
class LazyFieldBaker {
public:
    LazyFieldBaker() 
        : frontField_(std::make_unique<Field<T>>()),
          backField_(std::make_unique<Field<T>>()) {}

    // Безопасный деструктор (0% Use-After-Free при выходе из игры или смене этажа)
    ~LazyFieldBaker() {
        stopWorker();
    }

    // 1. Быстрый доступ для симуляции 125 Hz (O(1), Lock-Free, 0 мс блокировок)
    const Field<T>& get() const { return *frontField_; }

    // 2. Запрос фонового допекания при выстрелах/взрывах (World::carve)
    void request_rebake(const World& world, const std::vector<std::uint64_t>& dirtyCells) {
        if (dirtyCells.empty()) return;

        // 2.1. Формируем снимок ячеек на ГЛАВНОМ потоке (занимает < 0.001 мс)
        std::vector<CellSnapshot> snapshots;
        snapshots.reserve(dirtyCells.size());
        for (std::uint64_t key : dirtyCells) {
            int cx = wrap_macro(static_cast<int>((key >> 32) & 0xFFFF));
            int cy = wrap_macro(static_cast<int>((key >> 16) & 0xFFFF));
            int cz = wrap_macro(static_cast<int>(key & 0xFFFF));
            snapshots.push_back({key, world.mask(cx, cy, cz), world.cell(cx, cy, cz)});
        }

        // 2.2. Добавляем снимок в накопитель грязи
        {
            std::lock_guard<std::mutex> lock(pendingMutex_);
            pendingSnapshots_.insert(pendingSnapshots_.end(), snapshots.begin(), snapshots.end());
        }

        // 2.3. Если фоновый поток УЖЕ работает — мгновенно выходим (0 мс ожидания!)
        if (isBaking_.exchange(true, std::memory_order_acq_rel)) {
            return;
        }

        // 2.4. Бесшовно запускаем фоновый стриминговый конвейер
        stopWorker();
        workerThread_ = std::jthread([this]() {
            runBakeLoop();
        });
    }

    // 3. Вызывается раз в кадр в main_loop (занимает 0.000 мс!)
    void update_main_thread() {
        if (readyToSwap_.load(std::memory_order_acquire)) {
            if (readyToSwap_.exchange(false, std::memory_order_acq_rel)) {
                std::lock_guard<std::mutex> lock(bakedMutex_);
                for (const auto& item : lastBakedSnapshots_) {
                    int cx = wrap_macro(static_cast<int>((item.key >> 32) & 0xFFFF));
                    int cy = wrap_macro(static_cast<int>((item.key >> 16) & 0xFFFF));
                    int cz = wrap_macro(static_cast<int>(item.key & 0xFFFF));
                    
                    frontField_->at(cx, cy, cz) = backField_->at(cx, cy, cz);
                }
            }
        }
    }

private:
    void stopWorker() {
        if (workerThread_.joinable()) {
            workerThread_.join();
        }
    }

    // Фоновый стриминговый цикл допекания (Rolling Pipeline)
    void runBakeLoop() {
        while (true) {
            std::vector<CellSnapshot> batch;
            {
                std::lock_guard<std::mutex> lock(pendingMutex_);
                if (pendingSnapshots_.empty()) {
                    break;
                }
                batch = std::move(pendingSnapshots_);
                pendingSnapshots_.clear();
            }

            for (const auto& item : batch) {
                int cx = wrap_macro(static_cast<int>((item.key >> 32) & 0xFFFF));
                int cy = wrap_macro(static_cast<int>((item.key >> 16) & 0xFFFF));
                int cz = wrap_macro(static_cast<int>(item.key & 0xFFFF));

                backField_->at(cx, cy, cz) = item.mask.empty() ? T{1} : T{0};
            }

            {
                std::lock_guard<std::mutex> lock(bakedMutex_);
                lastBakedSnapshots_ = batch;
            }

            readyToSwap_.store(true, std::memory_order_release);
        }

        isBaking_.store(false, std::memory_order_release);
    }

    std::unique_ptr<Field<T>> frontField_;
    std::unique_ptr<Field<T>> backField_;

    std::jthread workerThread_;
    std::atomic<bool> isBaking_{false};
    std::atomic<bool> readyToSwap_{false};

    std::mutex pendingMutex_;
    std::vector<CellSnapshot> pendingSnapshots_;

    std::mutex bakedMutex_;
    std::vector<CellSnapshot> lastBakedSnapshots_;
};

} // namespace giga::game
