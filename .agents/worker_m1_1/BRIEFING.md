# BRIEFING — 2026-07-30T02:28:05Z

## Mission
Implement remaining MobBehaviour dispatchers in `src/game/combat.h` and `src/game/combat.cpp`, update integration tests in `tests/suite_behaviours.inl`, verify GPU Texture Sampling Pipeline, and run build/test suite.

## 🔒 My Identity
- Archetype: Implementer / QA / Specialist
- Roles: implementer, qa, specialist
- Working directory: C:\hades\gigahrush2\.agents\worker_m1_1
- Original parent: 598c629e-4438-4246-9083-4459562fdc95
- Milestone: M1 & M2

## 🔒 Key Constraints
- NO CHEATING: All implementations must be genuine. No hardcoded test results, facade implementations, or circumventing tasks.
- Modify source code files directly using proper file editing tools.
- Minimal change principle: only modify what is necessary.

## Current Parent
- Conversation ID: 598c629e-4438-4246-9083-4459562fdc95
- Updated: 2026-07-30T02:28:05Z

## Task Summary
- **What to build**:
  1. `apply_damage` signature in `combat.h` / `combat.cpp` accepting `const MacroGrid* grid = nullptr`.
  2. Defender incoming damage multiplier (`behaviour_incoming_mult`) in `apply_damage` for `WallBrace` (floored at 1 if raw > 0).
  3. Update `mob_attack_step` in `combat.cpp`: capture player camera yaw, gate `adjacent_wall` with `wall_query_needed`, check `behaviour_claims_damage`, apply `facing_damage_mult` for `DeadEcho`, apply `burst_damage_mult` for `FractureSprint`.
  4. Pass `&grid` in `projectile_step` and queued swing execution.
  5. Add integration test assertions in `tests/suite_behaviours.inl` for `WallBrace`, `DeadEcho`, `FractureSprint`.
  6. Confirm GPU Texture Sampling Pipeline builds cleanly.
  7. Run `tools\win\build.bat Release` and `ctest --test-dir build-win -C Release`.
- **Success criteria**: 100% green pass rate across all 4 test targets (`world_test`, `audit_test`, `game_test`, `source_rules`).

## Change Tracker
- **Files modified**: TBD
- **Build status**: TBD
- **Pending issues**: None

## Quality Status
- **Build/test result**: TBD
- **Tests added/modified**: TBD

## Loaded Skills
- None
