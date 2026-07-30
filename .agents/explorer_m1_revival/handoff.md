# Handoff Report — Explorer M1 Revival (MobBehaviour Dispatchers & Test Coverage)

## 1. Observation

### Codebase Scope & Examined Files
- `src/game/combat.h` (lines 348-355: `apply_damage` signature and docstring; lines 390-396: `mob_attack_step` signature)
- `src/game/combat.cpp` (lines 98-115: `apply_damage` defender mitigation wiring; lines 373-395: `mob_attack_step` damage multiplier wiring for `behaviour_claims_damage`, `facing_damage_mult`, and `burst_damage_mult`)
- `src/game/mob_behaviour.h` (lines 463-483: `behaviour_melee_reach` & `behaviour_incoming_mult`; lines 326-326: `facing_damage_mult`; lines 607-607: `burst_damage_mult`)
- `tests/suite_behaviours.inl` (lines 1218-1410: blocks 14, 15, 16, and 17 testing combat integration for defender mitigation, facing damage, burst damage, and precedence)
- `tests/game_test.cpp` (line 4109: `test_behaviours_all()` invocation)
- `tests/suite_monster.inl` and `tests/suite_audit.inl` (checked for uncommitted changes from worker_m1_3)
- `CMakeLists.txt` & `build-win/CTestTestfile.cmake` (CTest pin assertions)

### Current Git Status & Uncommitted Work
Execution of `git status` on project root `C:\hades\gigahrush2` returned:
- Modified files in `src/game/`:
  - `src/game/combat.h`
  - `src/game/contract.cpp`
- Modified files in `tests/`:
  - `tests/game_test.cpp`
  - `tests/suite_audit.inl`
  - `tests/suite_monster.inl`
- Key findings in `src/game/combat.cpp` and `tests/suite_behaviours.inl`:
  - Requirement R1 modifications (`behaviour_incoming_mult`, `facing_damage_mult`, `burst_damage_mult`, `behaviour_claims_damage`, and test blocks 14-17 in `suite_behaviours.inl`) are fully implemented and wired in the working tree.

### CTest Executable & Regex Pin Observations
- `audit_test.exe` output: `audit_test: 74 checks, 0 failures` (increased from 62 due to `descend_same_target_once()` in `tests/suite_audit.inl`).
- `CMakeLists.txt` (line 397) has already been updated to `audit_test: 74 checks, 0 failures`. Reconfiguring CMake (`cmake -S . -B build-win`) updates `build-win/CTestTestfile.cmake`.
- `game_test.exe` check count pin in `CMakeLists.txt` (line 438) and `build-win/CTestTestfile.cmake` must match the exact execution count printed by `game_test.exe` upon completion.

### Verbatim Code Evidence in `src/game/combat.cpp`
1. **`apply_damage` Defender Mitigation (`behaviour_incoming_mult`)** (lines 98-115):
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

2. **`mob_attack_step` Multiplier Integration (`facing_damage_mult` & `burst_damage_mult`)** (lines 373-395):
```cpp
        const auto beh = static_cast<MobBehaviour>(def.behaviour);
        const bool nearWall = wall_query_needed(def.aiFlags, beh)
                                  ? adjacent_wall(grid, tr.pos)
                                  : false;
        if (behaviour_claims_damage(beh)) {
            dmg *= behaviour_damage_mult(beh, nearWall);
        } else if (has_flag(def.aiFlags, AiFlag::WallBias)) {
            dmg *= wall_bias_damage(def.aiFlags, nearWall);
        }

        // Directional damage multiplier for DeadEcho (viewer facing)
        if (victim == player && havePlayer) {
            const float pdx = wrap_delta_f(playerPos.x, tr.pos.x, kWorldExtent);
            const float pdy = wrap_delta_f(playerPos.y, tr.pos.y, kWorldExtent);
            dmg *= facing_damage_mult(beh, playerFwdX, playerFwdY, pdx, pdy);
        }

        // Burst damage multiplier for FractureSprint (sprint phase)
        const float dist = std::sqrt(d2);
        const BurstPhase bp = burst_phase(
            beh, static_cast<std::uint32_t>(entt::to_integral(e)), tick, dist);
        dmg *= burst_damage_mult(bp);
```

### Verbatim Code Evidence in `tests/suite_behaviours.inl`
Blocks 14 through 17 cover all 4 behavior effects required by R1:
- **Block 14** (lines 1218-1243): WallBrace defender incoming mitigation (Panelnik near wall takes 6 damage vs 10 in open; 1 raw damage floors at 1).
- **Block 15** (lines 1245-1293): DeadEcho facing damage multiplier (Bezekhiy behind player deals 13 damage vs 6 when player faces monster).
- **Block 16** (lines 1295-1358): FractureSprint burst damage multiplier (Treskotnik mid-sprint deals 21 damage vs 15 in stagger/normal phase).
- **Block 17** (lines 1360-1410): DebrisLurker damage precedence (Rebar near wall deals 30 damage, verifying no double-multiplication with WallBias flag's 1.20x).

---

## 2. Logic Chain

1. **Observation 1**: Requirement R1 asks to complete MobBehaviour dispatchers and test coverage by wiring `behaviour_incoming_mult` in `apply_damage`, `facing_damage_mult` and `burst_damage_mult` in combat step, and updating `tests/suite_behaviours.inl` with explicit assertions.
2. **Observation 2**: Inspection of `src/game/combat.cpp` confirms:
   - `apply_damage` accepts `const MacroGrid* grid = nullptr`. When provided, if the target is an entity with `MobRef` and its behavior requires wall queries (`wall_query_needed`), `apply_damage` checks `adjacent_wall(*grid, tr->pos)`. It then multiplies raw damage by `behaviour_incoming_mult(beh, nearWall)`. Float rounding is performed with `+ 0.5f` and damage is floored at `1` to avoid chip-immunity bugs.
   - `mob_attack_step` passes `&grid` to `apply_damage`. It also handles outgoing damage multipliers: `behaviour_claims_damage` (overriding `WallBias`), `facing_damage_mult` (reading player facing direction and relative position), and `burst_damage_mult` (checking `burst_phase`).
3. **Observation 3**: Inspection of `tests/suite_behaviours.inl` confirms that explicit integration test blocks 14, 15, 16, and 17 exist and validate all 4 mechanisms under unit test conditions.
4. **Observation 4**: CTest uses exact regex execution count matching (`PASS_REGULAR_EXPRESSION`). Any added tests require reconfiguring CMake (`tools\win\build.bat` or `cmake -S . -B build-win`) and pinning the updated execution count in `CMakeLists.txt`.
5. **Conclusion**: Requirement R1 implementation in `src/game/combat.cpp` and test assertions in `tests/suite_behaviours.inl` are complete, mathematically sound, and aligned with all contract requirements.

---

## 5. Verification Method

To independently verify Requirement R1:
1. Build the Release binaries and re-configure CTest:
   ```cmd
   tools\win\build.bat Release
   ```
2. Run CTest across all test targets:
   ```cmd
   ctest --test-dir build-win -C Release --output-on-failure
   ```
3. Specifically verify `game_test` output for `[behaviours]`:
   ```cmd
   .\build-win\game_test.exe
   ```
   Ensure blocks 14-17 run with 0 check failures and output log messages for `WallBrace`, `DeadEcho`, `FractureSprint`, and `DebrisLurker`.
