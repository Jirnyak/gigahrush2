# Milestone 2 (R2) Technical Analysis: MacroSim Bench Registration & Headless 2^20 Benchmark

**Target Directory:** `C:\hades\gigahrush2`  
**Scope Document:** `C:\hades\gigahrush2\.agents\orchestrator\plan.md`  
**Author:** Teamwork Explorer Agent  
**Timestamp:** 2026-07-30T02:13:40Z  

---

## 1. Executive Summary

Milestone 2 requires unparking `tools/branch_port_pending/macro_bench.cpp`, adapting it to the current C++23/Vulkan `MacroSim` and `NpcPool` engine APIs, registering `macro_bench` alongside `sim_bench` in `CMakeLists.txt`, compiling it cleanly with C++23, and setting up headless benchmarking at full $2^{20}$ pool scale ($\sim 1\text{M}$ records, $950,000$ active NPCs).

Our investigation revealed four key API adaptations required for `macro_bench.cpp` to compile and measure accurately against `src/game/macro_sim.h` and `src/game/npc_pool.h`:
1. **`MacroSim::init()` API signature change:** The branch version invoked `macro.init(pool)`. On `main`, `MacroSim::init()` takes zero parameters (`void init()`), as scratch space and stats reset independently of the pool.
2. **Floor Label Type & Signedness:** `NpcPool::set_floor` takes `std::int16_t label`. The parked bench cast floor numbers as `uint16_t`.
3. **Floor Set Registration vs Obsolete `floorLo`/`floorHi`:** `MacroSim` no longer uses contiguous `floorLo`/`floorHi` parameters in `MacroParams`. Instead, destination floors must be explicitly registered via `macro.set_floors(labels, count)`.
4. **Social Pass Matrix Wiring:** In Phase 3 (social graph formation), `MacroSim::step` requires a non-null pointer to `FactionRelations` (`&factions` seeded from `kBaseFactionMatrix`). Without passing `factions`, `step()` skips the social pass entirely.

---

## 2. Codebase Audit & Inspection Findings

### 2.1 Examination of `tools/branch_port_pending/macro_bench.cpp`

The parked benchmark `tools/branch_port_pending/macro_bench.cpp` measures the headless $O(n)$ columnar sweep cost over the full $2^{20}$ SoA population ($1,048,576$ slots, populated to `kNpcActiveTarget` = $950,000$).

It measures three distinct phases across 200 iterations after a 5-tick warmup:
- **Phase 1: Demographic Sweep** — Aging, mortality, and replacement births.
- **Phase 2: Migration Pass** — Budgeted ring-scan starting multi-tick journeys across 64 floor buckets (`0..63`).
- **Phase 3: Social Pass** — Budgeted ring-scan forming relationship edges towards co-floor peers using generation-checked handles.

### 2.2 Examination of Engine Subsystems

1. **`src/game/macro_sim.h` & `src/game/macro_sim.cpp`**:
   - `MacroSim` advances the global NPC population on a coarse clock (`kMacroPeriodTicks = kSimHz * 2` = 250 ticks = 2.0 s).
   - `init()` takes no arguments: `void init()`.
   - `set_floors(const std::int16_t* labels, std::uint32_t count)` populates the sparse destination set `floors_` and label-to-index lookup `floorIdx_`.
   - `MacroStats step(NpcPool& pool, const MacroParams& params, const FactionRelations* factions = nullptr)` performs the sweep and returns statistics.

2. **`src/game/npc_pool.h`**:
   - SoA allocation with fixed capacity $2^{20} = 1,048,576$ rows.
   - `kNpcActiveTarget` = 950,000 active records.
   - Floor labels are signed `std::int16_t` (`kMinFloor = -127` to `kMaxFloor = 127`).
   - `set_floor(NpcId id, std::int16_t label)` updates both the row value and the per-floor bucket index `floor_bucket(label)`.

3. **`src/game/faction_relations.h`**:
   - Holds `FactionRelations` struct ($6 \times 6$ matrix, 36 bytes POD).
   - `kBaseFactionMatrix` provides the baseline diplomatic standing between factions.

4. **`CMakeLists.txt`**:
   - `sim_bench` is registered at line 474:
     ```cmake
     add_executable(sim_bench tests/sim_bench.cpp)
     target_link_libraries(sim_bench PRIVATE giga_game Threads::Threads)
     giga_target_flags(sim_bench OFF)
     ```
   - `macro_bench` is parked in commented lines 489–491:
     ```cmake
     # add_executable(macro_bench tests/macro_bench.cpp)
     # target_link_libraries(macro_bench PRIVATE giga_game)
     # giga_target_flags(macro_bench OFF)
     ```

5. **`tools/check_source_rules.cmake`**:
   - Scans all `.cpp`, `.h`, and `.inl` files under `src/` and `tests/`.
   - Unparking `macro_bench.cpp` to `tests/macro_bench.cpp` automatically integrates it into `source_rules` checks (file count increases from 167 to 168).

---

## 3. API Discrepancy Matrix & Adaptation Requirements

| Feature / Call | Parked Code (`macro_bench.cpp`) | Modern Engine Code (`src/game/*`) | Required Adaptation |
|---|---|---|---|
| MacroSim Init | `macro.init(pool);` | `macro.init();` | Change to `macro.init();` |
| Floor Setting | `pool.set_floor(id, static_cast<std::uint16_t>(i % 64u));` | `pool.set_floor(id, static_cast<std::int16_t>(i % 64u));` | Cast to `std::int16_t` |
| Floor Band Params | `pm.floorLo = 0; pm.floorHi = 63;` | Obsolete (sparse floor set) | Remove `floorLo`/`floorHi` references; call `macro.set_floors(floors, 64)` |
| Social Matrix Pass | `macro.step(pool, params);` | `macro.step(pool, params, &factions);` | Include `"game/faction_relations.h"`, instantiate `factions = kBaseFactionMatrix`, pass `&factions` in `measure` |

---

## 4. Proposed Implementation Strategy

### 4.1 Unpark & Adapt File (`tests/macro_bench.cpp`)

Move `tools/branch_port_pending/macro_bench.cpp` to `tests/macro_bench.cpp` with the following adapted implementation:

```cpp
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
            last.inTransit, last.day);
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
```

### 4.2 Update `CMakeLists.txt`

Uncomment lines 489–491 in `CMakeLists.txt`:

```cmake
<<<<
    # macro_bench is parked with macro_sim -- see tools/branch_port_pending/README.md.
    # Restore these three lines together with src/game/macro_sim.{h,cpp}:
    #   add_executable(macro_bench tests/macro_bench.cpp)
    #   target_link_libraries(macro_bench PRIVATE giga_game)
    #   giga_target_flags(macro_bench OFF)
====
    # Macro-society benchmark: advance the FULL 2^20 population one coarse tick at a
    # time and report ms/tick. Like sim_bench an executable, not a ctest -- it is a
    # measurement tool.
    add_executable(macro_bench tests/macro_bench.cpp)
    target_link_libraries(macro_bench PRIVATE giga_game)
    giga_target_flags(macro_bench OFF)
>>>>
```

---

## 5. Verification Method & Expected Results

### 5.1 Verification Commands

1. **Source Rules Audit**:
   ```cmd
   cmake -DGIGA_ROOT=C:/hades/gigahrush2 -P tools/check_source_rules.cmake
   ```
   *Expected Result:* `GIGA_SOURCE_RULES=PASS`, `files_scanned=168`.

2. **Full Build (Release)**:
   ```cmd
   tools\win\build.bat Release
   ```
   *Expected Result:* 0 warnings, 0 compilation errors.

3. **Run Macro Sim Headless Benchmark**:
   ```cmd
   build-win\Release\macro_bench.exe
   ```
   *Expected Output Format:*
   ```text
   macro_bench[demographic]: pool=950000 ticks=200  X.XXX ms/tick (living=... births=... deaths=... inTransit=0 simDay=...)
     throughput: Y.Y M records/sec
   macro_bench[migration]: pool=950000 ticks=200  X.XXX ms/tick (living=... births=... deaths=... inTransit=... simDay=...)
     throughput: Y.Y M records/sec
   macro_bench[social]: pool=950000 ticks=200  X.XXX ms/tick (living=... births=... deaths=... inTransit=... simDay=...)
     throughput: Y.Y M records/sec
   ```

4. **CTest Suite Verification**:
   ```cmd
   ctest --test-dir build-win -C Release --output-on-failure
   ```
   *Expected Result:* 100% pass across all 4 registered CTest targets (`world_test`, `audit_findings`, `game_test`, `source_rules`).

---

## 6. Summary of Recommendations for Implementation Phase

1. **Move File**: Move `tools/branch_port_pending/macro_bench.cpp` to `tests/macro_bench.cpp`.
2. **Apply API Fixes**:
   - `macro.init()` (no args).
   - `pool.set_floor(id, static_cast<std::int16_t>(i % 64u))`.
   - Register floors array `0..63` via `macro.set_floors(floors, 64)`.
   - Instantiate `FactionRelations factions = kBaseFactionMatrix;` and pass `&factions` into `measure(ps, "social", &factions)`.
3. **Register Target**: Enable `add_executable(macro_bench tests/macro_bench.cpp)` in `CMakeLists.txt`.
4. **Clean Up**: Remove `tools/branch_port_pending/macro_bench.cpp` after unparking.
