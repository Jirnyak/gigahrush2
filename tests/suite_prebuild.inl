// prebuild — гейт лифтового Prebuild (инкремент 2, elevators-2x2.md).
//
// Включается в game_test.cpp: CHECK-макрос и using-декларации оттуда. Всё,
// кроме входной точки test_prebuild_all(), живёт в namespace prebuild_test.
//
// Что пинится, и почему только это:
//
//   1. БИТ-ИДЕНТИЧНОСТЬ ПУТЕЙ: этаж, построенный воркером через
//      RebakeScheduler::start_prebuild (мировая половина в нерезидентный
//      слот), == этаж синхронного ensure_loaded — байт в байт по
//      snapshot_floor (типы, маски, суб-материальные страницы: вся геометрия
//      и вся вода правил). Плюс ecs-половина: тот же player-designate, та же
//      численность пула, тот же антураж по счётчикам. Это ЕДИНСТВЕННОЕ
//      определение корректности Prebuild: он обязан быть неотличим от
//      обычного входа на этаж.
//   2. RESTORE-ВЕТКА ИСПОЛНЯЕТСЯ ВОРКЕРОМ: хук set_floor_restore зовётся на
//      НЕ-главном потоке — ключевой замер плана («доминирует чтение снимка
//      6.4 с, Prebuild обязан крыть restore») без этого прятал бы 98% работы
//      на главном. И восстановленное реально ОТЛИЧАЕТСЯ от генерации
//      (снимок с мутацией != прежний мир), иначе «restore прошёл» было бы
//      недоказуемо.
//   3. ПРОТОКОЛ: один Prebuild за раз (второй begin в полёте — отказ),
//      prebuild_floor() отвечает этажом в полёте и kNoFloor после finish,
//      cancel возвращает слот, отменённый планировщиком Prebuild никогда не
//      отдаёт take_prebuilt() == true (результат — мусор по контракту).
//
// Nav здесь НЕ проверяется намеренно: запекание — собственность
// RebakeScheduler (закон дверей), его гейт — suite_rebake.
#include <atomic>
#include <chrono>
#include <functional>
#include <thread>
#include <vector>

#include "game/floor_gen.h"    // generate_floor — эталон «мутация видна»
#include "game/floor_spec.h"   // FloorKind, floor_spec
#include "game/floor_stream.h" // FloorStreamer — предмет теста
#include "game/rebake.h"       // RebakeScheduler::start_prebuild/take_prebuilt
#include "game/save.h"         // snapshot_floor, floor_file_write/read
#include "world/level_stack.h"
#include "world/macro_grid.h"
#include "world/world.h"

namespace prebuild_test {

// Всё, что обязано совпасть между двумя путями загрузки одного этажа.
struct PathResult {
    std::vector<std::uint8_t> snap; // snapshot_floor построенного мира
    NpcId player = kInvalidNpc;     // кого путь назначил игроком
    NpcId poolCount = 0;            // численность пула после сидинга
    std::size_t antInstances = 0;   // антураж по счётчикам (бейк детерминирован)
    std::size_t antWires = 0;
    std::size_t antCloths = 0;
    std::uint32_t pipeCells = 0;
};

// Прогнать ОДИН путь загрузки этажа `number` в собственном свежем мире-стеке
// и снять всё сравнимое. viaPrebuild выбирает путь; restoreFile != nullptr
// вешает хук восстановления из этих байтов (hookOnOtherThread получает, на
// чужом ли потоке хук исполнился). Стек локален и умирает со скоупом — два
// пути никогда не держат четыре World одновременно.
PathResult run_path(bool viaPrebuild, int number, std::uint32_t seed,
                    const std::vector<std::uint8_t>* restoreFile,
                    std::atomic<bool>* hookOnOtherThread) {
    Registry ecs;
    NpcPool pool;
    pool.init();
    FloorRegistry reg;
    LevelStack stack;
    FloorStreamer stream;
    stream.init(stack, /*keepRadius=*/0);
    CHECK(stream.add_module(reg, number, FloorKind::Residential, seed) !=
          kInvalidModule);

    const std::thread::id mainId = std::this_thread::get_id();
    if (restoreFile != nullptr) {
        stream.set_floor_restore(
            [restoreFile, hookOnOtherThread, mainId](World& w, int /*floor*/) {
                if (hookOnOtherThread != nullptr)
                    hookOnOtherThread->store(std::this_thread::get_id() !=
                                             mainId);
                return floor_file_read(restoreFile->data(),
                                       restoreFile->size(), w);
            });
    }

    NpcId playerId = kInvalidNpc;
    LoadResult r;
    if (!viaPrebuild) {
        r = stream.ensure_loaded(stack, reg, ecs, pool, number, playerId);
    } else {
        std::function<void()> job;
        CHECK(stream.prebuild_begin(stack, reg, number, job));
        CHECK(stream.prebuild_floor() == number);
        // Один Prebuild за раз: второй begin в полёте обязан отказать.
        std::function<void()> job2;
        CHECK(!stream.prebuild_begin(stack, reg, number, job2));

        RebakeScheduler sched;
        sched.start_prebuild(std::move(job));
        CHECK(sched.baking());
        // Часы — та же проекция wall-clock -> сим-тики, что в кадровом цикле
        // (8 мс = 1 тик); потолок 120 с даёт КРАСНЫЙ CHECK вместо вечного
        // цикла, если передача владения сломана.
        bool done = false;
        const auto t0 = std::chrono::steady_clock::now();
        while (!done && std::chrono::steady_clock::now() - t0 <
                            std::chrono::seconds(120)) {
            const std::uint64_t tick =
                static_cast<std::uint64_t>(
                    std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - t0)
                        .count()) /
                8u;
            sched.step(tick, /*worldGen=*/0);
            done = sched.take_prebuilt();
            if (!done)
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        CHECK(done);
        r = stream.prebuild_finish(stack, reg, ecs, pool, playerId);
        CHECK(stream.prebuild_floor() == FloorRegistry::kNoFloor);
    }

    CHECK(r.layer != kInvalidLayer);
    CHECK(r.player != entt::null); // свежий пул: путь обязан назначить игрока

    PathResult out;
    snapshot_floor(stack.layer(r.layer), number, out.snap);
    out.player = playerId;
    out.poolCount = pool.count();
    const AntourageBake* ab = stream.antourage_at(reg, number);
    CHECK(ab != nullptr);
    if (ab != nullptr) {
        out.antInstances = ab->instances.size();
        out.antWires = ab->wires.size();
        out.antCloths = ab->cloths.size();
        out.pipeCells = ab->pipeCells;
    }
    return out;
}

void paths_agree(const PathResult& a, const PathResult& b) {
    CHECK(a.snap == b.snap); // мир байт в байт: типы, маски, страницы
    CHECK(a.player == b.player);
    CHECK(a.poolCount == b.poolCount);
    CHECK(a.antInstances == b.antInstances);
    CHECK(a.antWires == b.antWires);
    CHECK(a.antCloths == b.antCloths);
    CHECK(a.pipeCells == b.pipeCells);
}

// Гарантия 1: generate-ветка бит-в-бит между путями.
void generate_branch_bit_identical() {
    const PathResult sync =
        run_path(/*viaPrebuild=*/false, /*number=*/0, 1234u, nullptr, nullptr);
    const PathResult pre =
        run_path(/*viaPrebuild=*/true, /*number=*/0, 1234u, nullptr, nullptr);
    paths_agree(sync, pre);
}

// Гарантия 2: restore-ветка бит-в-бит, и у Prebuild её исполняет ВОРКЕР.
void restore_branch_bit_identical_and_on_worker() {
    // Источник снимка: настоящий этаж + отличимая мутация (пролом первой
    // полностью солидной клетки). Мутация обязательна: без неё «restore
    // прошёл» неотличим от «restore тихо упал и этаж перегенерировался».
    std::vector<std::uint8_t> file;
    {
        World src;
        generate_floor(src, /*number=*/2, floor_spec(FloorKind::Residential),
                       777u);
        std::vector<std::uint8_t> pristine;
        snapshot_floor(src, 2, pristine);
        const auto& masks = src.grid().masks();
        int carved = -1;
        for (std::size_t i = 0; i < kMacroCells && carved < 0; ++i) {
            if (!masks[i].full()) continue;
            const int x = static_cast<int>(i % kMacroDim);
            const int y = static_cast<int>((i / kMacroDim) % kMacroDim);
            const int z = static_cast<int>(i / (kMacroDim * kMacroDim));
            src.grid().clear_cell(x, y, z);
            carved = static_cast<int>(i);
        }
        CHECK(carved >= 0);
        std::vector<std::uint8_t> mutated;
        snapshot_floor(src, 2, mutated);
        CHECK(mutated != pristine); // мутация видна снимку — эталон честен
        floor_file_write(src, 2, file);
    }

    std::atomic<bool> syncHookOnOther{true};  // обязан стать false (main)
    std::atomic<bool> preHookOnOther{false};  // обязан стать true (воркер)
    const PathResult sync = run_path(/*viaPrebuild=*/false, /*number=*/2, 777u,
                                     &file, &syncHookOnOther);
    const PathResult pre = run_path(/*viaPrebuild=*/true, /*number=*/2, 777u,
                                    &file, &preHookOnOther);
    paths_agree(sync, pre);
    CHECK(!syncHookOnOther.load()); // ensure_loaded читает снимок на main
    CHECK(preHookOnOther.load());   // Prebuild читает снимок ВОРКЕРОМ
}

// Гарантия 3: протокол отмены — на обеих сторонах шва.
void cancel_protocol() {
    Registry ecs;
    NpcPool pool;
    pool.init();
    FloorRegistry reg;
    LevelStack stack;
    FloorStreamer stream;
    stream.init(stack, /*keepRadius=*/0);
    CHECK(stream.add_module(reg, 0, FloorKind::Residential, 42u) !=
          kInvalidModule);

    // Сторона стримера: cancel возвращает слот — begin после него живёт, и
    // обычная загрузка тоже (слотов снова два).
    std::function<void()> job;
    CHECK(stream.prebuild_begin(stack, reg, 0, job));
    stream.prebuild_cancel();
    CHECK(stream.prebuild_floor() == FloorRegistry::kNoFloor);
    std::function<void()> job2;
    CHECK(stream.prebuild_begin(stack, reg, 0, job2));
    stream.prebuild_cancel();
    NpcId playerId = kInvalidNpc;
    LoadResult r = stream.ensure_loaded(stack, reg, ecs, pool, 0, playerId);
    CHECK(r.layer != kInvalidLayer);

    // Сторона планировщика: отменённый Prebuild никогда не отдаёт
    // take_prebuilt() — задание неделимо, доработает и будет выброшено.
    stream.unload(stack, reg, ecs, pool, 0);
    std::function<void()> job3;
    CHECK(stream.prebuild_begin(stack, reg, 0, job3));
    RebakeScheduler sched;
    sched.start_prebuild(std::move(job3));
    sched.cancel();
    bool sawPrebuilt = false;
    const auto t0 = std::chrono::steady_clock::now();
    while (sched.baking() && std::chrono::steady_clock::now() - t0 <
                                 std::chrono::seconds(120)) {
        sched.step(/*simTick=*/0, /*worldGen=*/0);
        sawPrebuilt = sawPrebuilt || sched.take_prebuilt();
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    CHECK(!sched.baking());
    CHECK(!sawPrebuilt);
    stream.prebuild_cancel(); // мусорный World выбрасывается со слотом
    CHECK(stream.prebuild_floor() == FloorRegistry::kNoFloor);
}

} // namespace prebuild_test

static void test_prebuild_all() {
    prebuild_test::generate_branch_bit_identical();
    prebuild_test::restore_branch_bit_identical_and_on_worker();
    prebuild_test::cancel_protocol();
    std::printf("prebuild suite done\n");
}
