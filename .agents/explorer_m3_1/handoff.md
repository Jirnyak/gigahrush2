# Handoff Report: Milestone 3 (R3: MacroSim 2^20 Benchmark Registration)

**Working Directory**: `C:\hades\gigahrush2\.agents\explorer_m3_1`  
**Project Directory**: `C:\hades\gigahrush2`  

---

## 1. Observation

### 1.1 Source Location & File Status
- **Source File**: `tests/macro_bench.cpp` (ported from `tools/branch_port_pending/macro_bench.cpp`).
- **Branch Port Status**: `tools/branch_port_pending/macro_bench.cpp` was relocated to `tests/macro_bench.cpp` when `src/game/macro_sim` was brought onto `main`. `tools/branch_port_pending/README.md` documents:
  > "They live under tools/ because src/game is GLOB_RECURSE-compiled, so anything left in the source tree is in the build whether it works or not. Each needs its branch API references rewritten against main tables, then moves back to src/game/."
  `macro_bench.cpp` has already been fully ported and placed in `tests/macro_bench.cpp`.

- **Source File Header & Purpose** (`tests/macro_bench.cpp` lines 1–12):
  ```cpp
  // Macro-tick benchmark — advance the FULL 2^20 population and report ms/tick.
  // ...
  // Headless: links giga_game + giga_core only, no SDL/Vulkan. An executable, not
  // a ctest — it measures, it does not pass/fail.
  ```

### 1.2 Include Headers & Dependencies in `tests/macro_bench.cpp`
Lines 13–22 of `tests/macro_bench.cpp`:
```cpp
#include <chrono>
#include <cstdint>
#include <cstdio>

#include "game/faction_relations.h"
#include "game/macro_sim.h"
#include "game/npc_pool.h"

using namespace giga;
using namespace giga::game;
```
- **Standard Library Includes**: `<chrono>`, `<cstdint>`, `<cstdio>`. All are part of C++23 standard library.
- **Engine Game Layer Includes**:
  - `"game/faction_relations.h"` (provides `FactionRelations` and `kBaseFactionMatrix`)
  - `"game/macro_sim.h"` (provides `MacroSim`, `MacroParams`, `MacroStats`)
  - `"game/npc_pool.h"` (provides `NpcPool`, `kNpcActiveTarget`, `kInvalidNpc`, `NpcId`)

### 1.3 CMake Registration Pattern & Existing Target Definition (`CMakeLists.txt`)
- **Global Compiler & Standard Setup** (`CMakeLists.txt` lines 35–37, 65–66):
  ```cmake
  set(CMAKE_CXX_STANDARD 23)
  set(CMAKE_CXX_STANDARD_REQUIRED ON)
  set(CMAKE_CXX_EXTENSIONS OFF)
  ...
  add_compile_options(/utf-8 /permissive- /Zc:__cplusplus /MP)
  add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN _CRT_SECURE_NO_WARNINGS)
  ```

- **Target Flag Helper Function** (`CMakeLists.txt` lines 94–118):
  ```cmake
  function(giga_target_flags tgt rtti)
      if(MSVC)
          target_compile_options(${tgt} PRIVATE /W4 /EHsc /wd4100)
          if(NOT rtti)
              target_compile_options(${tgt} PRIVATE /GR-)
          endif()
      else()
          target_compile_options(${tgt} PRIVATE -Wall -Wextra -Wno-unused-parameter)
          if(NOT rtti)
              target_compile_options(${tgt} PRIVATE -fno-rtti -fno-exceptions)
          endif()
      endif()
      ...
  endfunction()
  ```

- **Core & Game Library Targets** (`CMakeLists.txt` lines 209–224):
  ```cmake
  add_library(giga_core STATIC ${GIGA_CORE_SOURCES})
  target_include_directories(giga_core PUBLIC ${CMAKE_SOURCE_DIR}/src)
  target_link_libraries(giga_core PUBLIC EnTT::EnTT Threads::Threads)
  
  add_library(giga_game STATIC ${GIGA_GAME_SOURCES})
  target_include_directories(giga_game PUBLIC ${CMAKE_SOURCE_DIR}/src)
  target_link_libraries(giga_game PUBLIC giga_core)
  ```

- **Existing `macro_bench` Registration** (`CMakeLists.txt` lines 480–493):
  ```cmake
  # Macro-society benchmark: advance the FULL 2^20 population one coarse tick at a
  # time and report ms/tick. Like sim_bench an executable, not a ctest -- it is a
  # measurement tool, and a benchmark that fails the build on a slow machine is a
  # benchmark nobody runs.
  #
  # Uses giga_target_flags() rather than the branch raw if(NOT MSVC)
  # target_compile_options: the helper is the one place that knows this project
  # cannot use -fno-exceptions on MSVC (the STL is unsupported under
  # _HAS_EXCEPTIONS=0), so hand-rolling the flags per target is how that deviation
  # gets forgotten.
  add_executable(macro_bench tests/macro_bench.cpp)
  target_link_libraries(macro_bench PRIVATE giga_game)
  giga_target_flags(macro_bench OFF)
  ```

---

## 2. Logic Chain

1. **Observation**: `macro_bench.cpp` is located in `tests/macro_bench.cpp` and `CMakeLists.txt` lines 490–492 contains:
   ```cmake
   add_executable(macro_bench tests/macro_bench.cpp)
   target_link_libraries(macro_bench PRIVATE giga_game)
   giga_target_flags(macro_bench OFF)
   ```
   - **Reasoning**: The source file was moved out of `tools/branch_port_pending` into `tests/macro_bench.cpp` as part of porting the macro-sim to `main`. `tools/` is intentionally excluded from CMake `GLOB_RECURSE` compilation, whereas `tests/` is where executable benchmarks (`sim_bench`, `macro_bench`) and test binaries (`world_test`, `audit_test`, `game_test`) are defined.
   - **Deduction**: The `macro_bench` target is ALREADY registered in `CMakeLists.txt`.

2. **Observation**: `tests/macro_bench.cpp` includes `"game/faction_relations.h"`, `"game/macro_sim.h"`, and `"game/npc_pool.h"`.
   - **Reasoning**: `giga_game` includes `src/` in its `PUBLIC` target include directories (`target_include_directories(giga_game PUBLIC ${CMAKE_SOURCE_DIR}/src)`). Therefore, linking `giga_game` transitively provides access to all `game/*` and `core/*` headers under `src/`.
   - **Deduction**: No additional `target_include_directories` or include paths are needed for `macro_bench`.

3. **Observation**: `macro_bench.cpp` uses standard C++ headers (`<chrono>`, `<cstdint>`, `<cstdio>`), lambda functions, `std::chrono::duration`, and auto type deduction.
   - **Reasoning**: `CMakeLists.txt` enforces `CMAKE_CXX_STANDARD 23` globally for all targets.
   - **Deduction**: All C++23 features used in `macro_bench.cpp` are supported by the project toolchain configuration. No extra compile options or definitions are required.

4. **Observation**: `giga_target_flags(macro_bench OFF)` is called on the target.
   - **Reasoning**: This helper sets warning level `/W4 /EHsc` on MSVC (or `-Wall -Wextra -Wno-unused-parameter` on GCC/Clang) and disables RTTI (`/GR-` or `-fno-rtti`). The `OFF` argument indicates RTTI is disabled for this executable, which matches `giga_core` and `giga_game` rules.
   - **Deduction**: `macro_bench` matches the project target flag policy.

---

## 3. Caveats

- **Source File Path Clarification**: If a task specifically looks for `tools/branch_port_pending/macro_bench.cpp`, note that the file was already ported to `tests/macro_bench.cpp` on `main`. Attempting to register `tools/branch_port_pending/macro_bench.cpp` directly would fail because that file no longer exists in `tools/branch_port_pending/`.
- **Benchmark vs Test Distinction**: `macro_bench` is an executable benchmark tool, NOT a `add_test()` target. It is deliberately omitted from CTest so slow performance runs do not cause false test failures on low-spec hardware.

---

## 4. Conclusion & Recommended Fix Strategy

### Assessment
- **Registration Status**: `macro_bench` is **already fully registered** in `CMakeLists.txt` at lines 490–492:
  ```cmake
  add_executable(macro_bench tests/macro_bench.cpp)
  target_link_libraries(macro_bench PRIVATE giga_game)
  giga_target_flags(macro_bench OFF)
  ```
- **Dependencies & Headers**: All required headers (`<chrono>`, `<cstdint>`, `<cstdio>`, `"game/faction_relations.h"`, `"game/macro_sim.h"`, `"game/npc_pool.h"`) and libraries (`giga_game`) are properly linked and present.
- **C++23 & Flags**: Global C++23 configuration and `giga_target_flags(macro_bench OFF)` ensure zero-warning, no-RTTI clean compilation.

### Action Plan
1. **No CMake Edit Required**: No changes to `CMakeLists.txt` are needed since `macro_bench` is already correctly registered.
2. **Build Target**: To build `macro_bench.exe`, run:
   ```cmd
   cmake --build build-win --target macro_bench
   ```
3. **Execution**: To run the 2^20 population benchmark:
   ```cmd
   build-win\macro_bench.exe
   ```

---

## 5. Verification Method

- **Verify CMake Registration**:
  Inspect `CMakeLists.txt` lines 490–492 using `view_file` to confirm the presence of:
  ```cmake
  add_executable(macro_bench tests/macro_bench.cpp)
  target_link_libraries(macro_bench PRIVATE giga_game)
  giga_target_flags(macro_bench OFF)
  ```

- **Verify Target Build**:
  Execute Ninja / CMake build command:
  ```cmd
  cmake --build build-win --target macro_bench
  ```

- **Verify Executable Output**:
  Run `build-win\macro_bench.exe` and confirm stdout reports demographic, migration, and social pass benchmarks for the 2^20 population (e.g. `macro_bench[demographic]: pool=... ms/tick`).
