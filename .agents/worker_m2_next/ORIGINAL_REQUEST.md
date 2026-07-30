# Implementation Task for Worker M2 Next: Unpark Utility AI in src/app/main.cpp

## Scope & Instructions
Target file: `src/app/main.cpp`

Apply the exact 3 code modifications described in `C:\hades\gigahrush2\.agents\explorer_m2_next\handoff.md`:
1. In `src/app/main.cpp` around line ~807, set `aiCfg.enabled = true;`:
   ```cpp
   game::AiConfig aiCfg;
   aiCfg.enabled = true;
   game::AiTick aiTick{};
   ```
2. In `src/app/main.cpp` around line ~337 (`finish_floor_nav`), invoke `game::ai_init(reg, layer)`:
   ```cpp
   std::uint32_t finish_floor_nav(Registry& reg, LayerId layer, std::uint32_t seed,
                                  const nav::AsyncBake& bake) {
       std::uint32_t n = game::wander_init(reg, layer, seed);
       std::uint32_t aiCount = game::ai_init(reg, layer);
       std::fprintf(stderr,
                    "[nav] bake coarse %.0f ms | fine %.0f ms | %u agents wandering | %u AI brains attached "
                    "(async, off the main thread)\n",
                    bake.last_coarse_ms(), bake.last_fine_ms(), n, aiCount);
       return n;
   }
   ```
3. In `src/app/main.cpp` around line ~660 (initial floor 0 load setup), invoke `game::ai_init(reg, l0)`:
   ```cpp
               if (currentSpec)
                   doorsBuilt = game::door_build(stack.layer(l0), doors, 0,
                                                 *currentSpec, kDoorSeed);
               doors.frozen = true;
               begin_floor_nav(stack.layer(l0), nav);
               game::ai_init(reg, l0);
           }
   ```

## Build & Test Verification Requirements
1. Run `tools\win\build.bat Release notest` and verify clean MSVC compilation.
2. Run `ctest --output-on-failure` and verify 100% pass rate across all 4 test targets (`world_test`, `audit_findings`, `game_test`, `source_rules`).
3. Save your handoff report to `C:\hades\gigahrush2\.agents\worker_m2_next\handoff.md` with build logs and ctest outputs.
4. Update `C:\hades\gigahrush2\.agents\worker_m2_next\progress.md`.

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
