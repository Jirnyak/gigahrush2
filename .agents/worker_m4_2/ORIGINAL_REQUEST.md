## 2026-07-30T01:00:48Z
<USER_REQUEST>
You are Worker M4_2 for Gigahrush2 Milestone 4: Utility AI Activation & Monster Systems Porting.
Working directory: C:\hades\gigahrush2\.agents\worker_m4_2\
Project root: C:\hades\gigahrush2

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Task Description:
Explorer 4's detailed analysis is available at C:\hades\gigahrush2\.agents\explorer_m4_1\handoff.md.
Complete Utility AI activation and monster systems porting:
1. Activate Utility AI in `src/app/main.cpp`:
   - Set `aiCfg.enabled = true`, `aiCfg.hysteresis = true`, `aiCfg.memory = true`.
   - Instantiate `game::AiMemory aiMemory;` in `main.cpp`.
   - Call `game::ai_init(reg, l0)` on initial floor load after doors build.
   - Call `game::ai_release(reg, activeLayer)` before floor travel streaming, and `game::ai_init(reg, nl)` after arrival on new floor.
   - Pass `&aiMemory` as 9th parameter to `game::ai_step`.
2. Implement Monster Pack target sharing (`share_local_target`) in `src/game/combat.cpp` / `mob_behaviour.h`:
   - When a mob with `MobPackMode::Crowd` (e.g. GreenDog, Zombie, FogShark) enters aggro state or attacks, alert nearby pack members within 10m radius to share target.
3. Implement Wet Terrain Queries & Monster Terrain Traits in `src/world/macro_grid.h` / `src/game/combat.cpp`:
   - Add wet cell check (`WATER`, `F_WATER`, `SINK`, `TOILET`).
   - `Lotochnik`: 0.58x damage mitigation on wet ground.
   - `FogShark`: Speed/damage terrain scaling (dry speed 0.34x / dry damage 0.55x; fog/wet speed 1.08x / damage 1.18x).
4. Implement Monster Counterplay Mechanics in `src/game/combat.cpp`:
   - `Swarm`: Fire damage channel dispersion / instant kill.
   - `Borshchevik` / `BloodPlant`: Cutting weapon damage bonus / root severing.
5. Build and verify:
   Execute `tools\win\build.bat Release` and run `build-win\game_test.exe` and `ctest --test-dir build-win`. Ensure 100% green test passes across all test targets (`world_test`, `audit_test`, `game_test`, `source_rules`).

Write your handoff report to `C:\hades\gigahrush2\.agents\worker_m4_2\handoff.md` with complete details of code changes and test execution stdout logs.
</USER_REQUEST>
