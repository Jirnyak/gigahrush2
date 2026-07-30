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

## 2026-07-30T11:35:00Z
You are a Worker agent working on Milestone 1 & 3 (R1: Prop Mesh & Vulkan GPU Instancing, R3: Procedural Prop Placement System).
Your working directory is: C:\hades\gigahrush2\.agents\worker_m1_1
The root project directory is: C:\hades\gigahrush2

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

CONCURRENCY & COMPILATION CONSTRAINTS:
1. SINGLE-COMPILER OWNER RULE: You MUST NOT execute tools\win\build.bat, cmake, ninja, glslc, or ctest. Implement the code changes directly in the source files. The Lead Orchestrator will execute the build and test suite sequentially.
2. Maintain clean, zero-GC C++23 engine code. No exceptions, no RTTI (`/GR-`, `-fno-exceptions`, `ENTT_NOEXCEPTION`).

TASKS:
1. Examine `src/render/prop_mesh.h` and `src/render/prop_mesh.cpp`.
   Ensure all 25 `PropShape` procedural mesh generators (`Cylinder`, `HalfCylinder`, `Arch`, `Barrel`, `StairStep`, `Pipe`, `PipeElbow`, `PipeTee`, `Valve`, `Grate`, `RoundGrate`, `CabinetBox`, `ControlPanel`, `Railing`, `SupportBeam`, `CrateBox`, `CrateLong`, `LockerUnit`, `BenchSlab`, `Terminal`, `SecurityCamera`, `FloodLamp`, `FungalColumn`, `CrystalCluster`, `AcidPool`) are fully implemented with clean parametric geometry, accurate smooth/flat normals, clean UVs, and CCW triangle indices.
2. Examine `src/render/prop_pass.h` and `src/render/prop_pass.cpp`.
   Ensure all 25 shapes are initialized, instance buffers allocated per frame in flight (`kMaxFramesInFlight`), per-instance vertex attribute bindings match `PropInstance` (32 bytes), dynamic draw calls recorded per shape in `record()`, and zero-warning Vulkan resource management.
3. Refactor `src/render/prop_placer.h` and `src/render/prop_placer.cpp`:
   - Advanced/diversify spatial hash across rules (`next_rng` or separate hash seeds per rule) to prevent multi-prop stacking in the same cell.
   - Fix FloodLamp operator precedence bug: `if (solidAbove && (rng % 100 < kCfg.lightChancePct) && (nOpen >= 3 || (x % 8 == 0 && z % 8 == 0)))`.
   - Fix AcidPool floor material check: assign `AcidPool` only when `below == kMatAcidPool`; assign `FungalColumn` when `solidAbove && (rng % 100 < 30)`; default to `CrystalCluster`.
   - Fix pipe sub-type selection to avoid modulo coupling and allow `Valve` spawns.
   - Extend placement rules to utilize all 25 `PropShape` enum values (including `Cylinder`, `HalfCylinder`, `Arch`, `Barrel`, `StairStep`, `Railing`, `LockerUnit`, `BenchSlab`, `SecurityCamera`).
   - Retain 100% deterministic spatial hash placement across seeds.
4. Update `src/app/main.cpp`:
   - Ensure `propPlacer.populate(stack.layer(nl).grid(), propPass, fseed);` is called during automated `--shot --ride` floor transitions (around line 2260-2295) as well as keyboard floor transitions.
5. Write your handoff report to `C:\hades\gigahrush2\.agents\worker_m1_1\handoff.md`.
6. Send a message to the Lead Orchestrator summarizing your changes and referencing the report path.
