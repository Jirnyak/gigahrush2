# Original User Request

## 2026-07-30T03:59:17Z

You are the Project Orchestrator for Gigahrush2 Subagent Orchestration Wave (Revival).

Working directory: `C:\hades\gigahrush2\.agents\orchestrator_2\`
Project Root: `C:\hades\gigahrush2`
User Request File: `C:\hades\gigahrush2\.agents\ORIGINAL_REQUEST.md`

## Context & Uncommitted Work
- SERVER RESTART HAPPENED. Previous orchestrator was killed.
- `main` HEAD = `8e29244`
- Previous worker `worker_m1_3` left uncommitted changes in:
  - `src/game/combat.h`
  - `src/render/cube_pass.cpp`
  - `src/world/materials.h`
  - `tests/game_test.cpp`
  - `tests/suite_audit.inl`
  - `tests/suite_monster.inl`
  Please inspect and resume from these changes!

## Requirements
1. **R1. Complete Remaining MobBehaviour Dispatchers & Test Coverage**: Wire `behaviour_incoming_mult` for defender mitigation in `apply_damage` (`src/game/combat.cpp`), `facing_damage_mult`, and `burst_damage_mult`. Update `tests/suite_behaviours.inl` with explicit assertions for each behavior effect.
2. **R2. GPU Texture Sampling Pipeline Wire-up**: Integrate the 6 supercompressed UASTC+zstd KTX2 maps from `data/textures/` into Vulkan material descriptors in `src/render/cube_pass.cpp` and `shaders/cube.frag`.
3. **R3. System Verification & CTest Gate**: Ensure `tools\win\build.bat Release` and `ctest --test-dir build-win -C Release` pass 100% green across all 4 test targets (`world_test`, `audit_test`, `game_test`, `source_rules`). Commit and push to `origin main`.
