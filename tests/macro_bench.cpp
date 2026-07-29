// Macro-tick benchmark — advance the FULL 2^20 population and report ms/tick.
//
// The macro society sim ([macrosim.md]) runs on its own coarse clock, never the
// 125 Hz frame, so the question this answers is: how cheap is ONE O(n) columnar
// sweep over the whole SoA population? That number decides how often the
// off-screen society can advance without ever touching the render budget. Three
// phases are measured: the demographic sweep alone, then with the budgeted
// migration pass (#10c) enabled, then with the budgeted social pass (#10d-ii) also
// on, to show each bounded pass adds no O(n) cost.
//
// Headless: links giga_game + giga_core only, no SDL/Vulkan. An executable, not
// a ctest — it measures, it does not pass/fail.
#include <chrono>
#include <cstdint>
#include <cstdio>

#include "game/faction_relations.h"
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
        pool.set_floor(id, static_cast<std::int16_t>(i % 64u));
        pool.faction(id) = static_cast<std::uint16_t>(i % 4u);
        pool.height_mm(id) = 1700;
        pool.max_hp(id) = 100;
        pool.hp(id) = 100;
        pool.level(id) = 1;
    }

    MacroSim macro;
    macro.init();
    MacroParams p;
    p.daysPerTick = 7;  // weekly ticks

    FactionRelations factions = kBaseFactionMatrix;

    auto measure = [&](const MacroParams& params, const char* label,
                       const FactionRelations* fac = nullptr) {
        const int warmup = 5;
        const int iters = 200;
        for (int i = 0; i < warmup; ++i) macro.step(pool, params, fac);
        auto t0 = std::chrono::steady_clock::now();
        MacroStats last{};
        for (int i = 0; i < iters; ++i) last = macro.step(pool, params, fac);
        auto t1 = std::chrono::steady_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t1 - t0).count() /
                    static_cast<double>(iters);
        std::printf(
            "macro_bench[%s]: pool=%u ticks=%d  %.3f ms/tick "
            "(living=%u births=%u deaths=%u inTransit=%u simDay=%.0f)\n",
            label, pool.count(), iters, ms, last.living, last.births, last.deaths,
            last.inTransit, static_cast<double>(last.dayTenths) / 10.0);
        std::printf("  throughput: %.1f M records/sec\n",
                    (static_cast<double>(pool.count()) / (ms / 1000.0)) / 1e6);
    };

    // Phase 1: demographic sweep only (migration off — no floor band configured).
    measure(p, "demographic");

    // Register 0..63 floor band for migration & social passes.
    std::int16_t floors[64];
    for (int i = 0; i < 64; ++i) floors[i] = static_cast<std::int16_t>(i);
    macro.set_floors(floors, 64);

    // Phase 2: migration ON over the full 0..63 band, scanning a big slice each
    // tick so the bounded pass is actually exercised at scale. The realistic
    // 64/tick budget is free next to the O(n) sweep; this deliberately heavier
    // budget is an upper bound on what the migration pass itself costs.
    MacroParams pm = p;
    pm.migrateRecordsPerTick = 65536;
    pm.migrateRatePerYear = 1.0f;
    measure(pm, "migration");

    // Phase 3: social pass ALSO on, with a deliberately heavy 65536-record budget
    // (the realistic 64/tick is free) — an upper bound on what edge formation costs
    // next to the O(n) sweep. Records fan across 64 floors, so buckets are ~16k
    // deep and peer draws hit populated rosters.
    MacroParams ps = pm;
    ps.socialFormRatePerYear = 1.0f;
    ps.socialRecordsPerTick = 65536;
    measure(ps, "social", &factions);
    return 0;
}
