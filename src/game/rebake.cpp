#include "game/rebake.h"

#include <chrono>
#include <cstdio>
#include <utility>
#include <vector>

#include "world/macro_grid.h"

namespace giga::game {

namespace {
inline float ms_between(std::chrono::steady_clock::time_point a,
                        std::chrono::steady_clock::time_point b) {
    return std::chrono::duration<float, std::milli>(b - a).count();
}
} // namespace

RebakeScheduler::RebakeScheduler() {
    // max(2, hw/2) — вывод в заголовке у set_rebake_threads.
    int hw = static_cast<int>(std::thread::hardware_concurrency());
    if (hw < 1) hw = 1;
    rebakeThreads_ = hw / 2 < 2 ? 2 : hw / 2;
}

RebakeScheduler::~RebakeScheduler() {
    cancel_.store(true, std::memory_order_relaxed);
    join_worker();
}

void RebakeScheduler::join_worker() {
    if (worker_.joinable()) worker_.join();
    running_ = false;
}

void RebakeScheduler::discard_pending() {
    // ОСВОБОДИТЬ, не clear() — разница в 128 MiB, тот же довод, что был у
    // AsyncBake::start(): clear() хранит capacity мёртвыми байтами ровно в
    // самый голодный момент. swap-с-временным, а не shrink_to_fit: shrink —
    // необязательная ПРОСЬБА стандарта, а гарантия памяти, от которой
    // реализация вправе отказаться, — не гарантия.
    std::vector<std::uint8_t>().swap(pendingFine_.flow);
    std::vector<std::uint8_t>().swap(pendingFine_.nearest);
    pendingRooms_ = RoomZones{};
    roomsDone_.store(false, std::memory_order_relaxed);
    coarseDone_.store(false, std::memory_order_relaxed);
    exited_.store(false, std::memory_order_relaxed);
    roomsSwapped_ = false;
    coarseSwapped_ = false;
}

void RebakeScheduler::cancel() {
    if (running_) cancel_.store(true, std::memory_order_relaxed);
}

void RebakeScheduler::start_fresh(const MacroGrid& grid, FloorKind kind,
                                  int floorNumber, RoomZones& rooms,
                                  std::uint64_t worldGen) {
    // Любой бейк в полёте — отменить и джойнить. Отмена узловая, так что join
    // здесь — десятки мс, не секунды: это и есть «F9/травел отменяет и едет».
    cancel_.store(true, std::memory_order_relaxed);
    join_worker();
    cancel_.store(false, std::memory_order_relaxed);
    discard_pending();

    kind_ = kind;
    floorNumber_ = floorNumber;
    rooms_ = &rooms;

    // Оба живых битсета — с текущей геометрии, на всех ядрах (build сам
    // parallel_for). Двери к этому моменту все открыты (door_build зовётся до
    // begin_floor_nav и оставляет Open), так что премиса all-open впекается в
    // битсеты по построению — и patch_carved_cells её дальше хранит.
    nav::build_walk_bits(grid, navBits_);
    build_body_walk_bits(grid, bodyBits_);

    // Rooms — синхронно, текущая семантика: поля комнат целы до первого тика,
    // который мог бы их читать, и второй истории владения не существует.
    {
        const auto t0 = std::chrono::steady_clock::now();
        bake_room_zones(bodyBits_, kind, floorNumber, rooms);
        roomsMs_ = ms_between(t0, std::chrono::steady_clock::now());
    }

    // Живой nav-граф освободить сразу: до свапа ready() == false и толпа
    // стоит, а не ходит по геометрии чужого этажа (семантика AsyncBake).
    std::vector<std::uint8_t>().swap(fine_.flow);
    std::vector<std::uint8_t>().swap(fine_.nearest);

    // Снапшот по значению — воркер не знает про World вообще.
    snapNav_.words = navBits_.words;
    snapGen_ = worldGen;
    bakedGen_ = worldGen;
    lastSeenGen_ = worldGen;
    haveDirty_ = false;
    lastRebakeDurTicks_ = 0;
    lastStartTick_ = 0;

    running_ = true;
    mode_ = Mode::Fresh;
    worker_ = std::thread([this]() {
        using clock = std::chrono::steady_clock;
        const auto t0 = clock::now();
        nav::bake_coarse(snapNav_, pendingCoarse_, /*threads=*/0, &cancel_);
        const auto t1 = clock::now();
        nav::bake_fine(snapNav_, pendingFine_, /*threads=*/0, &cancel_);
        const auto t2 = clock::now();
        if (!cancel_.load(std::memory_order_relaxed)) {
            coarseMs_ = ms_between(t0, t1);
            fineMs_ = ms_between(t1, t2);
        }
        // release: main прочтёт готовые pending_* после acquire в step().
        exited_.store(true, std::memory_order_release);
    });
}

void RebakeScheduler::start_rebake(std::uint64_t simTick,
                                   std::uint64_t worldGen) {
    join_worker(); // не бежит (running_ проверен вызывающим) — страховка
    discard_pending();
    cancel_.store(false, std::memory_order_relaxed);

    // Снапшот обоих битсетов по значению: 2×256 KiB, ~50 мкс. Дальше живые
    // битсеты могут патчиться карвами сколько угодно — воркер их не видит,
    // а расхождение честно останется как bakedGen < worldGen после свапа.
    snapNav_.words = navBits_.words;
    snapBody_.words = bodyBits_.words;
    snapGen_ = worldGen;
    lastStartTick_ = simTick;

    running_ = true;
    mode_ = Mode::Rebake;
    const int threads = rebakeThreads_;
    const FloorKind kind = kind_;
    const int number = floorNumber_;
    worker_ = std::thread([this, threads, kind, number]() {
        using clock = std::chrono::steady_clock;
        // Порядок — приоритеты плана §3: rooms (~0.1 s) первым, чтобы самая
        // дешёвая секция свапнулась раньше всех; fine последним.
        const auto t0 = clock::now();
        bake_room_zones(snapBody_, kind, number, pendingRooms_, threads,
                        &cancel_);
        const auto t1 = clock::now();
        if (!cancel_.load(std::memory_order_relaxed)) {
            roomsMs_ = ms_between(t0, t1);
            roomsDone_.store(true, std::memory_order_release);
        }
        nav::bake_coarse(snapNav_, pendingCoarse_, threads, &cancel_);
        const auto t2 = clock::now();
        if (!cancel_.load(std::memory_order_relaxed)) {
            coarseMs_ = ms_between(t1, t2);
            coarseDone_.store(true, std::memory_order_release);
        }
        nav::bake_fine(snapNav_, pendingFine_, threads, &cancel_);
        const auto t3 = clock::now();
        if (!cancel_.load(std::memory_order_relaxed)) {
            fineMs_ = ms_between(t2, t3);
            // Строка-замер: по ней уточняются kWorstBakeTicks и производные
            // SLA-константы на реальном железе (S11: вывод, не назначение).
            std::fprintf(stderr,
                         "[rebake] floor %d gen %llu baked: rooms %.0f + "
                         "coarse %.0f + fine %.0f ms = %.1f s @ %d threads\n",
                         number, static_cast<unsigned long long>(snapGen_),
                         roomsMs_, coarseMs_, fineMs_,
                         ms_between(t0, t3) / 1000.0f, threads);
        }
        exited_.store(true, std::memory_order_release);
    });
}

bool RebakeScheduler::step(std::uint64_t simTick, std::uint64_t worldGen) {
    // 1. Летопись мутаций: дебаунс меряется от ПОСЛЕДНЕЙ, дедлайн — от ПЕРВОЙ
    // незапечённой.
    if (worldGen != lastSeenGen_) {
        lastSeenGen_ = worldGen;
        lastMutTick_ = simTick;
        if (!haveDirty_) {
            haveDirty_ = true;
            firstDirtyTick_ = simTick;
        }
    }

    // 2. Свап готовых секций — единственная точка записи живых структур.
    if (running_) {
        if (cancel_.load(std::memory_order_relaxed)) {
            // Отменённый результат — мусор по контракту: дождаться выхода
            // воркера и выбросить. Секции, свапнутые ДО отмены, легальны —
            // это цельные бейки старого снапшота.
            if (exited_.load(std::memory_order_acquire)) {
                join_worker();
                discard_pending();
                cancel_.store(false, std::memory_order_relaxed);
                mode_ = Mode::Idle;
            }
        } else if (mode_ == Mode::Fresh) {
            if (exited_.load(std::memory_order_acquire)) {
                join_worker();
                coarse_ = pendingCoarse_;
                fine_.flow = std::move(pendingFine_.flow);
                fine_.nearest = std::move(pendingFine_.nearest);
                bakedGen_ = snapGen_;
                if (bakedGen_ == lastSeenGen_) {
                    haveDirty_ = false;
                } else {
                    // Мутации пришли во время входного бейка: дедлайн-часы
                    // перезапускаются от свапа — цикл догонит сам.
                    haveDirty_ = true;
                    firstDirtyTick_ = simTick;
                }
                mode_ = Mode::Idle;
                return true; // вызывающий делает finish_floor_nav
            }
        } else { // Mode::Rebake — посекционно: rooms -> coarse -> fine
            if (!roomsSwapped_ &&
                roomsDone_.load(std::memory_order_acquire)) {
                *rooms_ = std::move(pendingRooms_);
                pendingRooms_ = RoomZones{};
                roomsSwapped_ = true;
            }
            if (!coarseSwapped_ &&
                coarseDone_.load(std::memory_order_acquire)) {
                coarse_ = pendingCoarse_;
                coarseSwapped_ = true;
            }
            if (exited_.load(std::memory_order_acquire)) {
                join_worker();
                fine_.flow = std::move(pendingFine_.flow);
                fine_.nearest = std::move(pendingFine_.nearest);
                bakedGen_ = snapGen_;
                lastRebakeDurTicks_ = simTick - lastStartTick_;
                mode_ = Mode::Idle;
                // Память на свапе: транзиентный пик (старый+новый fine ~260
                // MiB) уже позади, но capacity — то, что держит аллокатор.
                std::fprintf(
                    stderr,
                    "[rebake] swap: floor %d gen %llu live | %llu ticks "
                    "start->swap | resident %.1f MiB\n",
                    floorNumber_,
                    static_cast<unsigned long long>(bakedGen_),
                    static_cast<unsigned long long>(lastRebakeDurTicks_),
                    static_cast<double>(resident_bytes()) /
                        (1024.0 * 1024.0));
                if (bakedGen_ == lastSeenGen_) {
                    haveDirty_ = false;
                } else {
                    haveDirty_ = true;
                    firstDirtyTick_ = simTick; // цикл перезапустится сам
                }
            }
        }
        return false;
    }

    // 3. Планировщик старта фонового цикла.
    if (!ready()) return false; // нет живого графа — Fresh ещё не свапнулся
    if (rooms_ == nullptr || !navBits_.built() || !bodyBits_.built())
        return false;
    if (bakedGen_ == worldGen) return false; // запечённое актуально
    const bool quiet = simTick - lastMutTick_ >= kRebakeQuietTicks;
    const bool overdue =
        haveDirty_ && simTick - firstDirtyTick_ >= kRebakeDeadlineTicks;
    if (!quiet && !overdue) return false;
    // Мин-интервал = замер последнего цикла (вывод в заголовке).
    if (simTick - lastStartTick_ < lastRebakeDurTicks_) return false;
    start_rebake(simTick, worldGen);
    return false;
}

void RebakeScheduler::patch_carved_cells(const MacroGrid& grid,
                                         const DoorSet& doors,
                                         const std::uint32_t* cells,
                                         std::size_t n) {
    if (!navBits_.built() || !bodyBits_.built()) return;
    const std::vector<SubMask>& masks = grid.masks();
    for (std::size_t i = 0; i < n; ++i) {
        const std::size_t idx = cells[i];
        // Премиса all-open ([game/door.h]): клетка двери в битсетах ВСЕГДА
        // открыта, какой бы ни была живая маска (закрытая дверь солидна).
        // Обоснование — заголовок patch_carved_cells.
        if (!doors.index.empty() && doors.index[idx] != 0u) continue;
        const SubMask& m = masks[idx];
        nav::patch_walk_bit(navBits_, idx, m);
        patch_body_walk_bit(bodyBits_, idx, m);
    }
}

} // namespace giga::game
