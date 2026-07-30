# Handoff Report: Milestone 1 — MobBehaviour Dispatchers & Test Coverage (R1)

## 1. Observation

Direct inspection of the repository (`C:\hades\gigahrush2`) via `git status`, `git log`, `git diff`, and `view_file` revealed the current state of R1 requirements and uncommitted changes across `src/` and `tests/`.

### A. Current Git Repository State
- **Branch status**: `On branch main`, ahead of `origin/main` by 8 commits.
- **Uncommitted working tree changes**:
  - `src/game/combat.h`: Added `CellHazard` struct and `get_cell_hazard(CellType)` helper function; updated `apply_damage` signature to take `const MacroGrid* grid = nullptr`.
  - `tests/game_test.cpp`: Added `#include "suite_rpg.inl"` and `test_rpg_all()` invocation in `main()`.
  - `tests/suite_monster.inl`: Added hazard test (verifying flying monsters ignore floor hazards) and added `reg.destroy(mobG)` cleanup.
  - `tests/suite_audit.inl`: Added test 5b (`descend_same_target_once()`) for contract deduplication on absolute depth.
- **Header file location**: Note that the mob behaviour header is `src/game/mob_behaviour.h` (not `.hpp`).

### B. Verification of Requirement R1 Wiring in `src/game/combat.cpp`
1. **`behaviour_incoming_mult` (Defender Mitigation)**:
   - **Location**: `src/game/combat.cpp`, lines 98–115 in `apply_damage()`:
     ```cpp
     // Defender behaviour incoming damage multiplier (e.g. WallBrace armour against walls)
     if (grid && reg.all_of<MobRef>(target)) {
         if (const MobRef* m = reg.try_get<MobRef>(target)) {
             const MobDef& def = kMobTable[m->kind];
             const auto beh = static_cast<MobBehaviour>(def.behaviour);
             if (wall_query_needed(def.aiFlags, beh)) {
                 if (const Transform* tr = reg.try_get<Transform>(target)) {
                     const bool nearWall = adjacent_wall(*grid, tr->pos);
                     const float incMult = behaviour_incoming_mult(beh, nearWall);
                     if (incMult != 1.0f) {
                         int mitigated = static_cast<int>(static_cast<float>(dmg) * incMult + 0.5f);
                         if (mitigated < 1 && dmg > 0) mitigated = 1;
                         dmg = static_cast<std::int16_t>(mitigated);
                     }
                 }
             }
         }
     }
     ```
   - **Logic**: Reads the defender's `MobRef` and `MobDef`, checks if `wall_query_needed(def.aiFlags, beh)` is true, evaluates `adjacent_wall(*grid, tr->pos)`, queries `behaviour_incoming_mult(beh, nearWall)` (e.g. WallBrace `kWallBraceIncoming = 0.58f`), and applies damage reduction. Enforces an integer floor of `1` when `dmg > 0` to prevent 0-damage chip immunity.

2. **`facing_damage_mult` (Directional Facing Damage)**:
   - **Location**: `src/game/combat.cpp`, lines 384–388 in `mob_attack_step()`:
     ```cpp
     // Directional damage multiplier for DeadEcho (viewer facing)
     if (victim == player && havePlayer) {
         const float pdx = wrap_delta_f(playerPos.x, tr.pos.x, kWorldExtent);
         const float pdy = wrap_delta_f(playerPos.y, tr.pos.y, kWorldExtent);
         dmg *= facing_damage_mult(beh, playerFwdX, playerFwdY, pdx, pdy);
     }
     ```
   - **Logic**: Evaluated during mob attacks against the player. Player forward vector (`playerFwdX = std::cos(cam.yaw)`, `playerFwdY = std::sin(cam.yaw)`) is captured during the player sweep loop (lines 205–207). Computes toroidal deltas `pdx` and `pdy` from viewer (`playerPos`) to monster (`tr.pos`). DeadEcho (Безэхий) gets 1.55x damage when player's back is turned (dot <= -0.18) and 0.72x damage when player faces it.

3. **`burst_damage_mult` (FractureSprint Burst Phase Damage)**:
   - **Location**: `src/game/combat.cpp`, lines 390–394 in `mob_attack_step()`:
     ```cpp
     // Burst damage multiplier for FractureSprint (sprint phase)
     const float dist = std::sqrt(d2);
     const BurstPhase bp = burst_phase(
         beh, static_cast<std::uint32_t>(entt::to_integral(e)), tick, dist);
     dmg *= burst_damage_mult(bp);
     ```
   - **Logic**: Computes toroidal distance `dist` to target. Queries `burst_phase(beh, mobId, tick, dist)` to determine current phase (`Idle`, `Windup`, `Sprint`, `Stagger`). `burst_damage_mult(bp)` returns 1.45x during `BurstPhase::Sprint` and 1.0x during all other phases.

### C. Inspection of Test Coverage in `tests/suite_behaviours.inl`
Blocks 14 through 17 in `tests/suite_behaviours.inl` (lines 1218–1409) provide full integration test coverage for R1:
- **Block 14 (`WallBrace` Defender Incoming Mitigation)**:
  - Verifies 10 raw Kinetic damage against braced WallBrace (Panelnik near wall at `111.0, 101.0, 3.0`) applies `6` damage (10 * 0.58 = 5.8 -> round 6).
  - Verifies 10 raw Kinetic damage against open WallBrace (Panelnik in air at `101.0, 111.0, 3.0`) applies `10` damage.
  - Verifies 1 raw Kinetic damage against braced WallBrace floors at `1` damage (`rChip.applied == 1`).
- **Block 15 (`DeadEcho` Facing Damage Multiplier)**:
  - Verifies DeadEcho behind player (`yaw = 0.0f`, mob at `98.5, 100.0, 3.0`, delta dx = -1.5) deals `1.55x` base damage (13 HP lost).
  - Verifies DeadEcho in front of player (mob at `101.5, 100.0, 3.0`, delta dx = +1.5) deals `0.72x` base damage (6 HP lost).
- **Block 16 (`FractureSprint` Burst Phase Damage Multiplier)**:
  - Verifies FractureSprint during `BurstPhase::Sprint` deals `1.45x` base damage (39 HP lost).
  - Verifies FractureSprint during `BurstPhase::Stagger` deals `1.00x` base damage (27 HP lost).
- **Block 17 (`DebrisLurker` Damage Multiplier Precedence)**:
  - Verifies DebrisLurker (Rebar) near wall deals `1.25x` base damage in cover (30 HP lost), confirming `behaviour_claims_damage` prevents double multiplication with WallBias flag (which would yield 1.25 * 1.20 = 1.50x = 36 HP lost).
  - Verifies DebrisLurker in open deals `0.75x` base damage (18 HP lost).

---

## 2. Logic Chain

1. **Observation 1**: The user requested an investigation into Requirement R1 (`behaviour_incoming_mult`, `facing_damage_mult`, `burst_damage_mult`), inspection of uncommitted files, and determination of completed vs. missing code/test updates.
2. **Observation 2**: Git history shows recent local commits (`b2b3096d`, `d71b27a0`, `2fb87a66`, `c598745f`, `477927a9`) on `main`.
3. **Reasoning Step A**: Code analysis of `src/game/combat.cpp` confirms that the dispatcher calls for `behaviour_incoming_mult` (lines 98–115), `facing_damage_mult` (lines 384–388), and `burst_damage_mult` (lines 390–394) are fully wired and functional.
4. **Reasoning Step B**: Code analysis of `tests/suite_behaviours.inl` confirms that integration test blocks 14, 15, 16, and 17 explicitly assert the behavior of defender mitigation (including the chip damage floor), facing damage multiplier, burst damage multiplier, and precedence over wall flags.
5. **Reasoning Step C**: Analysis of current working directory status shows uncommitted changes in `src/game/combat.h`, `tests/game_test.cpp`, `tests/suite_monster.inl`, and `tests/suite_audit.inl`.
6. **Conclusion**: R1 implementation and test coverage are 100% complete in the codebase. The worker's task is to verify build/test status, review uncommitted changes, and finalize/commit the milestone.

---

## 3. Caveats

- **File Extension Correction**: The request prompt references `src/game/mob_behaviour.hpp`, but the header file in the repository is named `src/game/mob_behaviour.h`.
- **Pre-existing Local Commits**: R1 wiring and tests were already committed in local commits on `main` ahead of `origin/main`. The working tree contains uncommitted changes for hazard queries (`combat.h`), RPG test suite wiring (`game_test.cpp`), monster hazard assertions (`suite_monster.inl`), and contract descend deduplication (`suite_audit.inl`).

---

## 4. Conclusion

- Requirement R1 is **FULLY IMPLEMENTED** in `src/game/combat.cpp` and **FULLY COVERED** by tests in `tests/suite_behaviours.inl`.
- No further code changes are required for R1 in `src/game/combat.cpp` or `tests/suite_behaviours.inl`.
- The worker should run the build and test suite to verify all checks pass, and proceed with committing the current uncommitted changes.

---

## 5. Verification Method

1. **Inspect Code Locations**:
   - `src/game/combat.cpp`: lines 98–115 (`behaviour_incoming_mult`), lines 384–388 (`facing_damage_mult`), lines 390–394 (`burst_damage_mult`).
   - `tests/suite_behaviours.inl`: lines 1218–1409 (blocks 14–17).
2. **Execute Build & Test Commands**:
   - Compile: `cmake --build build-win --target game_test`
   - Run game unit tests: `build-win\game_test.exe`
   - Run audit tests: `build-win\audit_test.exe`
   - Run full ctest suite: `ctest --test-dir build-win --output-on-failure`
3. **Invalidation Conditions**:
   - Any test failure in `test_behaviours_all()` (blocks 14–17).
   - `incMult` failing to apply defender damage mitigation in `apply_damage`.
   - `facing_damage_mult` failing to scale damage based on `CameraTag::yaw` and toroidal delta.
   - `burst_damage_mult` failing to boost damage during `BurstPhase::Sprint`.
