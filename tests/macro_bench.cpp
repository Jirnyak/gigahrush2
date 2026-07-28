// Macro-tick benchmark — advance the FULL 2^20 population and report ms/tick.
//
// The macro society sim ([macrosim.md]) runs on its own coarse clock, never the
// 120 Hz frame, so the question this answers is: how cheap is ONE O(n) columnar
// sweep over the whole SoA population? That number decides how often the
// off-screen society can advance without ever touching the render budget.
//
// Headless: links giga_game + giga_core only, no SDL/Vulkan. An executable, not
// a ctest — it measures, it does not pass/fail.
#include <chrono>
#include <cstdint>
#include <cstdio>

#include "game/macro_sim.h"
#include "game/npc_pool.h"

using namespace giga;
using namespace giga::game;

int main() {
    NpcPool pool;
    pool.init();

    // Fill to the active target with a realistic age spread so both mortality and
    // births fire every tick; vary floor/faction so the columns aren't uniform.
    const std::uint32_t target = kNpcActiveTarget;
    for (std::uint32_t i = 0; i < target; ++i) {
        NpcId id = pool.spawn();
        if (id == kInvalidNpc) break;
        pool.age(id) = static_cast<std::uint8_t>(1 + (i % 100u));
        pool.set_floor(id, static_cast<std::uint16_t>(i % 64u));
        pool.faction(id) = static_cast<std::uint16_t>(i % 4u);
        pool.height_mm(id) = 1700;
        pool.max_hp(id) = 100;
        pool.hp(id) = 100;
        pool.level(id) = 1;
    }

    MacroSim macro;
    macro.init(pool);
    MacroParams p;
    p.daysPerTick = 7;  // weekly ticks

    const int warmup = 5;
    const int iters = 200;
    for (int i = 0; i < warmup; ++i) macro.step(pool, p);

    auto t0 = std::chrono::steady_clock::now();
    MacroStats last{};
    for (int i = 0; i < iters; ++i) last = macro.step(pool, p);
    auto t1 = std::chrono::steady_clock::now();

    double ms = std::chrono::duration<double, std::milli>(t1 - t0).count() /
                static_cast<double>(iters);
    std::printf(
        "macro_bench: pool=%u ticks=%d  %.3f ms/tick "
        "(living=%u births=%u deaths=%u simDay=%.0f)\n",
        pool.count(), iters, ms, last.living, last.births, last.deaths, last.day);
    std::printf("  throughput: %.1f M records/sec\n",
                (static_cast<double>(pool.count()) / (ms / 1000.0)) / 1e6);
    return 0;
}
