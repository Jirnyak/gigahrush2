## 2026-07-30T02:27:59Z
You are a Worker agent for Milestone 1 and Milestone 2 of Gigahrush2.
Your working directory is `C:\hades\gigahrush2\.agents\worker_m1_1`. Please create this folder if needed for your metadata.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Objectives:
1. Implement remaining MobBehaviour dispatchers in `src/game/combat.h` and `src/game/combat.cpp`:
   - Update `apply_damage` signature in `src/game/combat.h` and `src/game/combat.cpp` to accept `const MacroGrid* grid = nullptr`.
   - Add defender incoming damage multiplier (`behaviour_incoming_mult`) in `apply_damage` for `WallBrace` (mitigated = float(dmg) * incMult + 0.5f, floored at 1 if raw > 0).
   - Update `mob_attack_step` in `src/game/combat.cpp`:
     - Capture player camera yaw (`playerFwdX = cos(cam.yaw)`, `playerFwdY = sin(cam.yaw)`).
     - Gate `adjacent_wall` with `wall_query_needed(def.aiFlags, beh)`.
     - Check `behaviour_claims_damage(beh)`: apply `behaviour_damage_mult`, else `wall_bias_damage` (fixing the bug where `DebrisLurker` double-multiplied damage in cover).
     - Apply directional damage multiplier for `DeadEcho`: `dmg *= facing_damage_mult(beh, playerFwdX, playerFwdY, pdx, pdy)`.
     - Apply burst damage multiplier for `FractureSprint`: `dmg *= game::burst_damage_mult(bp)`.
   - Pass `&grid` in `projectile_step` and queued swing execution.
2. Update `tests/suite_behaviours.inl` with explicit test assertions:
   - Add integration test assertions for `WallBrace` defender incoming mitigation in `apply_damage`.
   - Add integration test assertions for `DeadEcho` facing damage multiplier in `mob_attack_step`.
   - Add integration test assertions for `FractureSprint` burst damage multiplier in `mob_attack_step`.
3. Verify GPU Texture Sampling Pipeline (R2):
   - Confirm Vulkan material descriptors in `src/render/cube_pass.cpp` and `shaders/cube.frag` build cleanly.
4. Execute build and test verification:
   - Run `tools\win\build.bat Release`
   - Run `ctest --test-dir build-win -C Release`
   - Ensure 100% green pass rate across all 4 test targets (`world_test`, `audit_test`, `game_test`, `source_rules`).

Requirements:
- Read `C:\hades\gigahrush2\.agents\explorer_m1_1\handoff.md` and `C:\hades\gigahrush2\.agents\explorer_m2_1\handoff.md` for complete technical details.
- Modify the source code files directly using proper file editing tools.
- Write your completion report and handoff to `C:\hades\gigahrush2\.agents\worker_m1_1\handoff.md`. Include exact diffs, build output, and ctest stdout log.
- Update your `progress.md` in `C:\hades\gigahrush2\.agents\worker_m1_1\progress.md` with timestamps.
- When complete, send a message back to parent orchestrator.
