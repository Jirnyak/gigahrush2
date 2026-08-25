#include "game/rebake.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <utility>
#include <vector>

#include "game/embody.h" // kBodyClearanceSub — габарит всех нав-бейков
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

void RebakeScheduler::set_light_table(const LightVisLamp* lamps, std::size_t n,
                                      std::uint32_t slots,
                                      std::uint32_t tableGen) {
    lampsLive_.assign(lamps, lamps + n);
    lightSlots_ = slots;
    lightTableTag_ = tableGen;
    // Состав таблицы изменился (рождение/смерть лампы) — следующий
    // Rebake-цикл обязан печь свет ПОЛНОСТЬЮ (форма: слоты).
    ++lightTableGen_;
}

void RebakeScheduler::sync_shadow() {
    // Теневая сетка догоняет живую O(1)-копиями ровно карвнутых клеток —
    // зовётся ТОЛЬКО при стоящем воркере (обе start_* сначала джойнят).
    // Идемпотентно: возврат клеток из отменённого цикла копирует их дважды.
    if (shadowGrid_ == nullptr || liveGrid_ == nullptr) return;
    const std::vector<SubMask>& masks = liveGrid_->masks();
    const std::vector<CellType>& types = liveGrid_->types();
    for (std::uint32_t idx : carvedSinceLight_) {
        const int x = static_cast<int>(idx % kMacroDim);
        const int y = static_cast<int>((idx / kMacroDim) % kMacroDim);
        const int z = static_cast<int>(idx / (kMacroDim * kMacroDim));
        shadowGrid_->mask(x, y, z) = masks[idx];
        shadowGrid_->set_cell(x, y, z, types[idx]);
    }
}

void RebakeScheduler::start_light_patch(std::uint64_t worldGen) {
    // Воркер свободен (running_ проверен вызывающим). Карвы уезжают в
    // carvedSnap_ — новые, пришедшие во время полёта, лягут в свежий список
    // и запустят следующий цикл (стандартный приём генераций, гонок нет по
    // построению).
    join_worker();
    discard_pending();
    cancel_.store(false, std::memory_order_relaxed);

    // Тень догоняет мир ДО отъёма списка (sync читает его же); копий мира
    // на главном потоке больше нет (59.21) — только O(1)-долив.
    const auto tSnap = std::chrono::steady_clock::now();
    sync_shadow();
    snapCopyMs_ = ms_between(tSnap, std::chrono::steady_clock::now());
    carvedSnap_ = std::move(carvedSinceLight_);
    carvedSinceLight_.clear();
    std::sort(carvedSnap_.begin(), carvedSnap_.end());
    carvedSnap_.erase(std::unique(carvedSnap_.begin(), carvedSnap_.end()),
                      carvedSnap_.end());
    lampsSnap_ = lampsLive_;
    snapGen_ = worldGen;

    running_ = true;
    mode_ = Mode::LightPatch;
    const int threads = rebakeThreads_;
    worker_ = std::thread([this, threads]() {
        if (shadowGrid_ != nullptr)
            bake_light_visibility_patch(*shadowGrid_, lampsSnap_.data(),
                                        lampsSnap_.size(), carvedSnap_.data(),
                                        carvedSnap_.size(), pendingPatch_,
                                        threads, &cancel_);
        exited_.store(true, std::memory_order_release);
    });
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
    pendingLight_ = LightVisBake{};
    pendingPatch_ = LightVisPatch{};
    // Карвы отменённого цикла — назад в живой список: выброс оставил бы их
    // клетки навсегда непокрытыми патчем (карв-долг обязан быть допечён).
    carvedSinceLight_.insert(carvedSinceLight_.end(), carvedSnap_.begin(),
                             carvedSnap_.end());
    carvedSnap_.clear();
    // shadowGrid_ НЕ трогаем: тень — резидент этажа, воркер её только читал.
    lightDone_.store(false, std::memory_order_relaxed);
    roomsDone_.store(false, std::memory_order_relaxed);
    coarseDone_.store(false, std::memory_order_relaxed);
    exited_.store(false, std::memory_order_relaxed);
    lightSwapped_ = false;
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
    // Карв-долг света — прошлого этажа: Fresh печёт текущую геометрию с нуля.
    carvedSinceLight_.clear();
    carvedSnap_.clear();
    patchChangedCells_.clear();
    lightPatchPending_ = false;

    kind_ = kind;
    floorNumber_ = floorNumber;
    rooms_ = &rooms;

    // Оба живых оракула — с текущей геометрии, на всех ядрах (build сам
    // parallel_for). Двери к этому моменту все открыты (door_build зовётся до
    // begin_floor_nav и оставляет Open), так что премиса all-open впекается в
    // оракулы по построению — и patch_carved_cells её дальше хранит.
    navClear_.build(grid);
    build_body_walk_bits(grid, bodyBits_);
    // Свету битсета мало — его лучи субвоксельные (S2): Fresh печёт прямо с
    // живой сетки (мы на главном потоке); фоновые циклы читают ТЕНЬ —
    // резидентную копию, которую sync_shadow дальше правит O(1) на карв
    // (59.21: копия мира на каждый цикл мертва). Единственная полная копия —
    // здесь, на входе этажа, где кадр и так платит генерацию/загрузку.
    liveGrid_ = &grid;
    shadowGrid_ = std::make_unique<MacroGrid>(grid);

    // Rooms — синхронно, текущая семантика: поля комнат целы до первого тика,
    // который мог бы их читать, и второй истории владения не существует.
    {
        const auto t0 = std::chrono::steady_clock::now();
        bake_room_zones(bodyBits_, kind, floorNumber, rooms);
        roomsMs_ = ms_between(t0, std::chrono::steady_clock::now());
    }

    // Свет — СИНХРОННО на всех ядрах (решение владельца: хитч Fresh 0.1–0.3 с
    // принят; альтернатива «войти со всеми грязными клетками» стоила бы
    // десятки мс КАЖДОГО кадра первые секунды — вывод в плане §4). Цена
    // печатается вслух — правило «бейк без замера прячет свою регрессию».
    {
        bake_light_visibility(grid, lampsLive_.data(), lampsLive_.size(),
                              lightSlots_, lightVis_, /*threads=*/0, nullptr);
        lightGen_ = worldGen;
        lightSwapPending_ = true;
        lightTableBakedGen_ = lightTableGen_; // Fresh = полный бейк состава
        lightTableBakedTag_ = lightTableTag_; // синхронно с живой таблицы
        ++lightFullBakes_;
        std::fprintf(stderr,
                     "[lightvis] floor %d FRESH: %u lamps -> %u lit cells "
                     "(mean %.1f packed %.1f max %u/cell, overflow %u), R_max %.1f m, "
                     "%.0f ms sync\n",
                     floorNumber, lightVis_.lampCount, lightVis_.litCells,
                     lightVis_.meanPerCell, lightVis_.packedMeanPerCell,
                     lightVis_.maxPerCell,
                     lightVis_.overflowCells, lightVis_.rMaxM,
                     lightVis_.bakeMs);
        // Пин видимости (образец GIGA_VERLET_PIN): хэш содержимого клеток
        // после Fresh-бейка; два прогона одного сида обязаны совпасть.
        static const bool kPin = std::getenv("GIGA_LIGHT_VIS_PIN") != nullptr;
        if (kPin)
            std::fprintf(stderr, "[lightvis-pin] floor %d fnv=%016llx\n",
                         floorNumber,
                         static_cast<unsigned long long>(
                             light_vis_fnv(lightVis_)));
    }

    // Живой nav-граф освободить сразу: до свапа ready() == false и толпа
    // стоит, а не ходит по геометрии чужого этажа (семантика AsyncBake).
    std::vector<std::uint8_t>().swap(fine_.flow);
    std::vector<std::uint8_t>().swap(fine_.nearest);

    // Снапшот по значению — воркер не знает про World вообще.
    snapClear_.vals = navClear_.vals;
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
        nav::bake_coarse(snapClear_, kBodyClearanceSub, pendingCoarse_,
                         /*threads=*/0, &cancel_);
        const auto t1 = clock::now();
        nav::bake_fine(snapClear_, kBodyClearanceSub, pendingFine_,
                       /*threads=*/0, &cancel_);
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

    // Снапшот по значению: клиренс-поле нава (4 МиБ, доли мс) + телесный
    // битсет комнат (256 KiB) и копия статик-таблицы ламп (12.5k × 16 Б ≈
    // 200 КБ); субвоксельные лучи света (S2) читают резидентную ТЕНЬ,
    // доливаемую sync_shadow O(1)-копиями карвнутых клеток (59.21 — копия
    // мира на каждый цикл мертва). Дальше живой мир может меняться сколько
    // угодно — воркер его не видит, а расхождение честно останется как
    // bakedGen < worldGen после свапа.
    snapClear_.vals = navClear_.vals;
    snapBody_.words = bodyBits_.words;
    // Тень догоняет мир O(1)-доливом — копия 134 МиБ мертва (59.21).
    const auto tSnap = std::chrono::steady_clock::now();
    sync_shadow();
    snapCopyMs_ = ms_between(tSnap, std::chrono::steady_clock::now());
    lampsSnap_ = lampsLive_;
    // Карв-долг света уезжает в carvedSnap_ (на отмене — вернётся). Свет
    // цикла: ПОЛНЫЙ, если менялся состав таблицы (рождение/смерть лампы) или
    // дедлайн формы; иначе — ПАТЧЕМ этого же долга (гарантия: ни один карв не
    // остаётся непокрытым, каким бы расписанием ни шли циклы). Если долга нет
    // и полный не нужен — секции света в цикле нет вовсе.
    carvedSnap_.insert(carvedSnap_.end(), carvedSinceLight_.begin(),
                       carvedSinceLight_.end());
    carvedSinceLight_.clear();
    std::sort(carvedSnap_.begin(), carvedSnap_.end());
    carvedSnap_.erase(std::unique(carvedSnap_.begin(), carvedSnap_.end()),
                      carvedSnap_.end());
    const bool overdue =
        haveDirty_ && simTick - firstDirtyTick_ >= kRebakeDeadlineTicks;
    cycleLightFull_ = (lightTableGen_ != lightTableBakedGen_) || overdue;
    lightTableGenSnap_ = lightTableGen_;
    lightTableTagSnap_ = lightTableTag_; // состав, который бейк УВИДИТ
    if (!cycleLightFull_ && carvedSnap_.empty())
        lightSwapped_ = true; // свету нечего делать — секция закрыта заранее
    snapGen_ = worldGen;
    lastStartTick_ = simTick;

    running_ = true;
    mode_ = Mode::Rebake;
    const int threads = rebakeThreads_;
    const FloorKind kind = kind_;
    const int number = floorNumber_;
    worker_ = std::thread([this, threads, kind, number]() {
        using clock = std::chrono::steady_clock;
        // Порядок — решение владельца (light-visibility-bake.md §финал):
        // СВЕТ ПЕРВЫМ, перед путями и всем остальным — он заметнее всего, а
        // его свап ужимает раздутые карвами списки клеток и возвращает кадры
        // сразу; затем приоритеты плана §3: rooms -> coarse -> fine.
        const auto tL = clock::now();
        if (shadowGrid_ != nullptr && cycleLightFull_) {
            bake_light_visibility(*shadowGrid_, lampsSnap_.data(),
                                  lampsSnap_.size(), lightSlots_,
                                  pendingLight_, threads, &cancel_);
            if (!cancel_.load(std::memory_order_relaxed)) {
                std::fprintf(
                    stderr,
                    "[lightvis] floor %d gen %llu rebaked FULL: %u lamps -> "
                    "%u lit cells (overflow %u) in %.0f ms @ %d threads\n",
                    number, static_cast<unsigned long long>(snapGen_),
                    pendingLight_.lampCount, pendingLight_.litCells,
                    pendingLight_.overflowCells, pendingLight_.bakeMs,
                    threads);
                lightDone_.store(true, std::memory_order_release);
            }
        } else if (shadowGrid_ != nullptr && !carvedSnap_.empty()) {
            // Таблица не менялась — долг цикла закрывает дельта-патч
            // (та же гарантия покрытия при в разы меньшей работе).
            bake_light_visibility_patch(*shadowGrid_, lampsSnap_.data(),
                                        lampsSnap_.size(), carvedSnap_.data(),
                                        carvedSnap_.size(), pendingPatch_,
                                        threads, &cancel_);
            if (!cancel_.load(std::memory_order_relaxed))
                lightDone_.store(true, std::memory_order_release);
        }
        const auto t0 = clock::now();
        bake_room_zones(snapBody_, kind, number, pendingRooms_, threads,
                        &cancel_);
        const auto t1 = clock::now();
        (void)tL;
        if (!cancel_.load(std::memory_order_relaxed)) {
            roomsMs_ = ms_between(t0, t1);
            roomsDone_.store(true, std::memory_order_release);
        }
        nav::bake_coarse(snapClear_, kBodyClearanceSub, pendingCoarse_,
                         threads, &cancel_);
        const auto t2 = clock::now();
        if (!cancel_.load(std::memory_order_relaxed)) {
            coarseMs_ = ms_between(t1, t2);
            coarseDone_.store(true, std::memory_order_release);
        }
        nav::bake_fine(snapClear_, kBodyClearanceSub, pendingFine_, threads,
                       &cancel_);
        const auto t3 = clock::now();
        if (!cancel_.load(std::memory_order_relaxed)) {
            fineMs_ = ms_between(t2, t3);
            // Строка-замер: по ней уточняются kWorstBakeTicks и производные
            // SLA-константы на реальном железе (S11: вывод, не назначение).
            std::fprintf(stderr,
                         "[rebake] floor %d gen %llu baked: rooms %.0f + "
                         "coarse %.0f + fine %.0f ms = %.1f s @ %d threads | "
                         "shadow sync %.2f ms MAIN\n",
                         number, static_cast<unsigned long long>(snapGen_),
                         roomsMs_, coarseMs_, fineMs_,
                         ms_between(t0, t3) / 1000.0f, threads, snapCopyMs_);
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
        } else if (mode_ == Mode::LightPatch) {
            // Свап дельта-патча: добавки вливаются в ЖИВЫЕ списки на главном
            // потоке (единственная точка записи, тот же закон, что у секций),
            // lightGen поднимается — грязные клетки шара чистеют, GPU-фоллбэк
            // умирает. bakedGen НЕ трогается: nav/rooms патч не печёт, полный
            // цикл останется должен и придёт своим расписанием.
            if (exited_.load(std::memory_order_acquire)) {
                join_worker();
                const std::size_t changed = light_vis_apply_patch(
                    lightVis_, pendingPatch_, lampsSnap_.data(),
                    lampsSnap_.size(), &patchChangedCells_);
                lightGen_ = snapGen_;
                lightPatchPending_ = true; // вызывающий зальёт клетки на GPU
                std::fprintf(
                    stderr,
                    "[lightvis] floor %d gen %llu patch: %u lamps affected -> "
                    "%zu cells changed in %.1f ms @ %d threads | shadow sync "
                    "%.2f ms MAIN\n",
                    floorNumber_, static_cast<unsigned long long>(snapGen_),
                    pendingPatch_.affectedLamps, changed,
                    pendingPatch_.bakeMs, rebakeThreads_, snapCopyMs_);
                carvedSnap_.clear(); // допечены
                pendingPatch_ = LightVisPatch{};
                mode_ = Mode::Idle;
            }
        } else { // Mode::Rebake — посекционно: light -> rooms -> coarse -> fine
            if (!lightSwapped_ &&
                lightDone_.load(std::memory_order_acquire)) {
                if (cycleLightFull_) {
                    lightVis_ = std::move(pendingLight_);
                    pendingLight_ = LightVisBake{};
                    lightSwapPending_ = true; // перезалить GPU-грид целиком
                    lightTableBakedGen_ = lightTableGenSnap_;
                    // Тег состава — СНАПШОТНЫЙ, не текущий (находка №2
                    // аудита 2026-08-23): таблица могла смениться за время
                    // полёта бейка, легшие списки отражают снапшот.
                    lightTableBakedTag_ = lightTableTagSnap_;
                    ++lightFullBakes_;
                } else {
                    // Свет цикла — патчем: те же добавки в живые списки и
                    // частичная заливка, что у одиночного LightPatch.
                    const std::size_t changed = light_vis_apply_patch(
                        lightVis_, pendingPatch_, lampsSnap_.data(),
                        lampsSnap_.size(), &patchChangedCells_);
                    lightPatchPending_ = true;
                    std::fprintf(
                        stderr,
                        "[lightvis] floor %d gen %llu patch-in-cycle: %u "
                        "lamps affected -> %zu cells changed in %.1f ms\n",
                        floorNumber_,
                        static_cast<unsigned long long>(snapGen_),
                        pendingPatch_.affectedLamps, changed,
                        pendingPatch_.bakeMs);
                    pendingPatch_ = LightVisPatch{};
                }
                lightGen_ = snapGen_;
                lightSwapped_ = true;
                carvedSnap_.clear(); // долг покрыт (полным или патчем)
            }
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
                // тень живёт дальше — транзиента цикла больше нет (59.21)
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
    if (rooms_ == nullptr || !navClear_.built() || !bodyBits_.built())
        return false;
    if (bakedGen_ == worldGen) return false; // запечённое актуально
    const bool quiet = simTick - lastMutTick_ >= kRebakeQuietTicks;
    const bool overdue =
        haveDirty_ && simTick - firstDirtyTick_ >= kRebakeDeadlineTicks;
    const bool fullDue = (quiet || overdue) &&
                         simTick - lastStartTick_ >= lastRebakeDurTicks_;
    // 3а. Дельта-патч света (carve-hitch.md §3): дешёвый цикл со своим
    // коротким дебаунсом — грязное окно GPU-фоллбэка сжимается с секунд до
    // долей секунды. Полный цикл ГЛАВНЕЕ: если созрел он — стартует он (и
    // кроет те же карвы целиком), патч лишь заполняет паузу до него.
    if (!fullDue && lightVis_.valid() && !carvedSinceLight_.empty() &&
        simTick - lastMutTick_ >= kLightPatchQuietTicks) {
        start_light_patch(worldGen);
        return false;
    }
    if (!fullDue) return false;
    start_rebake(simTick, worldGen);
    return false;
}

void RebakeScheduler::patch_carved_cells(const MacroGrid& grid,
                                         const DoorSet& doors,
                                         const std::uint32_t* cells,
                                         std::size_t n) {
    if (!navClear_.built() || !bodyBits_.built()) return;
    const std::vector<SubMask>& masks = grid.masks();
    const std::vector<CellType>& types = grid.types();
    // Клетка двери (по индексу, координатам). Премиса all-open ([game/door.h]):
    // оракулы построены на входе этажа при открытых дверях и обязаны её
    // хранить — честный патч по маске закрытой двери впёк бы дверь в фоновый
    // бейк. У гранного клиренса премиса живёт на уровне ГРАНИ: пропускается
    // любая грань, чей ВТОРОЙ конец — клетка двери (её половину перехода
    // считало открытое состояние).
    auto door_at = [&doors](int x, int y, int z) {
        return !doors.index.empty() &&
               doors.index[macro_index(wrap_macro(x), wrap_macro(y),
                                       wrap_macro(z))] != 0u;
    };
    for (std::size_t i = 0; i < n; ++i) {
        const std::size_t idx = cells[i];
        if (!doors.index.empty() && doors.index[idx] != 0u) continue;
        const SubMask& m = masks[idx];
        patch_body_walk_bit(bodyBits_, idx, m);
        // Шесть граней карвнутой клетки: свои три плюс-нибла и плюс-ниблы
        // трёх минус-соседей ([world/clearance.h] patch — та же шестёрка,
        // здесь вручную ради дверного фильтра по граням).
        const int cx = static_cast<int>(idx % kMacroDim);
        const int cy = static_cast<int>((idx / kMacroDim) % kMacroDim);
        const int cz = static_cast<int>(idx / (kMacroDim * kMacroDim));
        for (int axis = 0; axis < 3; ++axis) {
            const int px = axis == 0 ? cx + 1 : cx;
            const int py = axis == 1 ? cy + 1 : cy;
            const int pz = axis == 2 ? cz + 1 : cz;
            if (!door_at(px, py, pz))
                navClear_.set_face(cx, cy, cz, axis,
                                   face_clearance_at(grid, cx, cy, cz, axis));
            const int mx = axis == 0 ? cx - 1 : cx;
            const int my = axis == 1 ? cy - 1 : cy;
            const int mz = axis == 2 ? cz - 1 : cz;
            if (!door_at(mx, my, mz))
                navClear_.set_face(mx, my, mz, axis,
                                   face_clearance_at(grid, mx, my, mz, axis));
        }
    }
    // Долг света — вход дельта-патча (carve-hitch.md §3): карвнутые клетки
    // копятся до ближайшего цикла (патч или полный — кто раньше). ВСЕ клетки,
    // включая дверные: свет живёт по реальной геометрии, премиса all-open —
    // навигационная, не световая. Дедуп — на старте цикла, не здесь.
    carvedSinceLight_.insert(carvedSinceLight_.end(), cells, cells + n);
    (void)types;
}

} // namespace giga::game
