## 2026-07-29T19:25:30Z
<USER_REQUEST>
You are Worker M4 for Milestone 4: Utility AI Activation & Monster Systems Porting.
Working directory: C:\hades\gigahrush2\.agents\worker_m4

Task:
Implement Utility AI activation in `src/app/main.cpp` and finish porting remaining monster systems (pack target sharing, wet terrain queries & traits, counterplay mechanics) as detailed in Explorer 4's report (`C:\hades\gigahrush2\.agents\explorer_m4_1\handoff.md`).

Instructions:
1. Read `C:\hades\gigahrush2\.agents\explorer_m4_1\handoff.md`.
2. Step 1: In `src/app/main.cpp`:
   - Set `aiCfg.enabled = true`, `aiCfg.hysteresis = true`, `aiCfg.memory = true`, instantiate `AiMemory aiMemory`.
   - Call `game::ai_init(reg, l0)` on initial floor load.
   - Call `game::ai_release(reg, activeLayer)` and `game::ai_init(reg, nl)` during floor travel.
   - Pass `&aiMemory` to `game::ai_step`.
3. Step 2: Implement Pack Behavior Target Sharing for `MobPackMode::Crowd` in `src/game/combat.cpp` / `mob_behaviour.h`.
4. Step 3: Implement Wet Terrain Queries and traits for `Lotochnik` (0.58x damage reduction) & `FogShark` (speed/damage scaling) in `src/game/combat.cpp`.
5. Step 4: Implement Monster Counterplay Mechanics (cutting weapons vs plant roots, fire vs swarm) in `src/game/combat.cpp`.
6. Execute `tools\win\build.bat Release` and run `ctest` across all targets (`world_test`, `audit_test`, `game_test`, `source_rules`).
7. Ensure all builds complete cleanly without errors/warnings, 100% green ctest, and no performance regression.
8. Create a handoff report in `C:\hades\gigahrush2\.agents\worker_m4\handoff.md`.
9. Send a message to the orchestrator upon completion.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
</USER_REQUEST>
