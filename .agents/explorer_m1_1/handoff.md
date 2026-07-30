# Investigation Report: MobBehaviour Dispatchers & Test Coverage (Milestone 1)

**Working Directory**: `C:\hades\gigahrush2\.agents\explorer_m1_1`  
**Timestamp**: 2026-07-30T02:27:30Z  
**Author**: Explorer Agent (M1: MobBehaviour Dispatchers & Test Coverage)  

---

## 1. Observation

A detailed read-only audit of `src/game/mob_behaviour.h`, `src/game/mob_behaviour.cpp`, `src/game/combat.h`, `src/game/combat.cpp`, `src/game/wander.cpp`, and `tests/suite_behaviours.inl` revealed the current state of mob behaviour dispatchers and test coverage in Gigahrush2.

### 1.1 Summary of Behaviour Dispatcher Status Across `src/`

| Behaviour Dispatcher | Header & Impl Location | Current Calling Status in `src/` | Behavior Description |
| :--- | :--- | :--- | :--- |
| `behaviour_aggro_radius` | `mob_behaviour.h:268`<br>`mob_behaviour.cpp:109` | **Live** (`wander.cpp:225`, `investigate.cpp:112`) | Overrides 20m aggro radius for 14 enumerators (2.15m - 30.0m). |
| `frozen_by_gaze` | `mob_behaviour.h:292`<br>`mob_behaviour.cpp:139` | **Live** (`wander.cpp:281`) | Freezes `WeepingAngel` (Sculpture) when inside 25m and +/-45° camera cone. |
| `pursuit_offset` | `mob_behaviour.h:193`<br>`mob_behaviour.cpp:59` | **Live** (`wander.cpp:294`) | Radial & tangential offsets for `GarbageSurround`, `GreenDogPack`, `WebSpitter`. |
| `behaviour_move_mult` | `mob_behaviour.h:394`<br>`mob_behaviour.cpp:212` | **Live** (`wander.cpp:319`) | Wall-adjacent pace: `DebrisLurker` (1.22x/0.68x), `WallBrace` (1.02x/0.90x). |
| `wall_bias_speed` | `mob_behaviour.h:339`<br>`mob_behaviour.cpp:202` | **Live** (`wander.cpp:320`) | Wall-adjacent pace for `AiFlag::WallBias` carriers (1.18x near / 0.92x open). |
| `wall_query_needed` | `mob_behaviour.h:432`<br>`mob_behaviour.cpp:250` | **Live** (`wander.cpp:317`) | Gates wall adjacency query for 5 kinds (`Tvar`, `Shovnik`, `Rebar`, `Betonoed`, `Panelnik`). |
| `burst_speed_mult` & `burst_phase` | `mob_behaviour.h:593,602`<br>`mob_behaviour.cpp:162,184` | **Live** (`wander.cpp:323-324`) | 2.32s cycle for `FractureSprint` (0.35s windup 0x, 0.62s sprint 3.25x, 1.35s stagger 0x). |
| `behaviour_hurt_move_mult` | `mob_behaviour.h:522`<br>`mob_behaviour.cpp:272` | **Live** (`wander.cpp:325`) | Health pace multiplier for `CrowdShove` (0.96x when `hp < maxHp`). |
| `behaviour_melee_reach` | `mob_behaviour.h:472`<br>`mob_behaviour.cpp:255` | **Live** (`combat.cpp:353`) | Melee reach conversion; `WallBrace` gets 1.75 cells (3.5m) near wall. |
| `behaviour_damage_mult` | `mob_behaviour.h:400`<br>`mob_behaviour.cpp:226` | **Partially Wired** (`combat.cpp:342`) | Outgoing damage multiplier for `DebrisLurker` (1.25x cover / 0.75x open). Missing `behaviour_claims_damage` check! |
| `behaviour_claims_damage` | `mob_behaviour.h:420`<br>`mob_behaviour.cpp:235` | **Unwired** (0 callers in `src/`) | Prevents `DebrisLurker` from double-multiplying `wall_bias_damage` with `behaviour_damage_mult`. |
| `behaviour_incoming_mult` | `mob_behaviour.h:482`<br>`mob_behaviour.cpp:265` | **Unwired** (0 callers in `src/`) | Defender incoming damage multiplier for `WallBrace` (0.58x when braced against wall). |
| `facing_damage_mult` | `mob_behaviour.h:326`<br>`mob_behaviour.cpp:149` | **Unwired** (0 callers in `src/`) | Directional damage multiplier for `DeadEcho` (1.55x back-turned / 0.72x facing). |
| `burst_damage_mult` | `mob_behaviour.h:607`<br>`mob_behaviour.cpp:194` | **Unwired** (0 callers in `src/`) | Outgoing burst damage multiplier for `FractureSprint` (1.45x during `BurstPhase::Sprint`). |

### 1.2 Detailed Inspection Findings in `src/game/combat.cpp`

1. **`behaviour_incoming_mult` (Defender Mitigation in `apply_damage`)**:
   - File: `src/game/combat.cpp`, lines 73-113.
   - `apply_damage` handles all damage application in the game.
   - Current logic:
     ```cpp
     DamageResult apply_damage(Registry& reg, NpcPool& pool, Entity target,
                               std::int16_t raw, DamageChannel ch, Entity source)
     ```
   - Currently, `apply_damage` checks armor resistance (`Armour` component) but does **not** check defender mob behaviour or wall adjacency (`behaviour_incoming_mult`).
   - `apply_damage` currently does not take `MacroGrid`, so it cannot run `adjacent_wall` unless passed `const MacroGrid* grid = nullptr`.
   - Per `mob_behaviour.h:480` and `suite_behaviours.inl:1099`, defender mitigation for `WallBrace` (0.58x) **must floor damage at 1 point** if `raw > 0` so weak hits do not truncate to 0 and render braced Панельник chip-immune.

2. **`facing_damage_mult` (DeadEcho Back-Turned Damage in `mob_attack_step`)**:
   - File: `src/game/combat.cpp`, lines 180-201 and 338-345.
   - `mob_attack_step` currently iterates `reg.view<const CameraTag, const Transform>()` to locate the player (`playerPos`), but it does **not** capture the camera's `yaw` (or forward vector `playerFwdX, playerFwdY`).
   - Consequently, when `DeadEcho` (Безэхий) attacks the player, `facing_damage_mult` is never evaluated.
   - `facing_damage_mult` evaluates whether the player is facing away (`dot <= -0.18f`, awarding 1.55x damage) or facing toward the mob (awarding 0.72x damage).

3. **`burst_damage_mult` (FractureSprint Burst Damage in `mob_attack_step`)**:
   - File: `src/game/combat.cpp`, lines 338-345.
   - `wander_step` (`wander.cpp:323-324`) evaluates `burst_phase` and applies `burst_speed_mult`.
   - `mob_attack_step` (`combat.cpp:338-345`) does **not** evaluate `burst_phase` or `burst_damage_mult`.
   - As a result, when `FractureSprint` (Трескотник) lunges during `BurstPhase::Sprint`, it deals standard table damage (1.0x) instead of the authored 1.45x burst damage.

4. **Existing Bug in `combat.cpp:338-343` (`DebrisLurker` Double Multiplication & Ungated Wall Queries)**:
   - In `combat.cpp:339-342`:
     ```cpp
     const bool nearWall = adjacent_wall(grid, tr.pos);
     if (has_flag(def.aiFlags, AiFlag::WallBias))
         dmg *= wall_bias_damage(def.aiFlags, nearWall);
     const auto beh = static_cast<MobBehaviour>(def.behaviour);
     dmg *= behaviour_damage_mult(beh, nearWall);
     ```
   - Bug A: `adjacent_wall(grid, tr.pos)` is executed for **all 69 mob kinds** on every attack, instead of being gated by `wall_query_needed(def.aiFlags, beh)`.
   - Bug B: `DebrisLurker` (Арматура) carries **both** `AiFlag::WallBias` and `MobBehaviour::DebrisLurker`. Because `combat.cpp` does not check `behaviour_claims_damage(beh)`, it applies `wall_bias_damage` (1.20x) AND `behaviour_damage_mult` (1.25x), resulting in **1.50x damage in cover** instead of the authored **1.25x**.

### 1.3 Audit of Unit Tests in `tests/suite_behaviours.inl`

- `suite_behaviours.inl` contains 1,217 lines divided into 13 test blocks.
- **Pure-function assertions exist** for all dispatchers (`behaviour_aggro_radius`, `pursuit_offset`, `frozen_by_gaze`, `behaviour_move_mult`, `wall_bias_speed`, `behaviour_damage_mult`, `behaviour_claims_damage`, `wall_query_needed`, `behaviour_melee_reach`, `behaviour_incoming_mult`, `behaviour_hurt_move_mult`, `burst_phase`, `burst_speed_mult`, `burst_damage_mult`, `facing_damage_mult`).
- **However, `suite_behaviours.inl` contains notes explicitly acknowledging missing combat integration callers**:
  - Line 304-320: Asserts `unreachableOnly == (b == MobBehaviour::CrowdShove)` because combat callers were missing.
  - Line 786: *"nothing in src/ calls burst_phase yet"* (note: `wander_step` calls it now, but `mob_attack_step` needs `burst_damage_mult`).
  - Line 908: *"combat.cpp applies neither this nor behaviour_damage_mult, so there is no damage number to measure."*
  - Line 994: *"combat.cpp computes reach from def.meleeReachMm directly..."* (note: `combat.cpp:353` calls `behaviour_melee_reach` now).
  - Line 1073: `behaviour_incoming_mult` tested pure only, no `apply_damage` test.

---

## 2. Logic Chain

1. **Wiring `behaviour_incoming_mult`**:
   - `behaviour_incoming_mult(beh, nearWall)` is pure logic defined in `mob_behaviour.cpp:265`.
   - `apply_damage` in `combat.cpp` is the single funnel through which all damage passes.
   - By adding `const MacroGrid* grid = nullptr` to `apply_damage`'s parameter list, `apply_damage` can check if `target` has `MobRef`, verify `wall_query_needed(def.aiFlags, beh)`, compute `adjacent_wall(*grid, tr->pos)`, and scale `dmg *= behaviour_incoming_mult(beh, nearWall)`.
   - Damage must be floored at 1: `if (mitigated < 1 && dmg > 0) mitigated = 1;` so chip damage is never nullified for a braced `WallBrace`.
   - Callers of `apply_damage` in `mob_attack_step` and `projectile_step` hold `MacroGrid` and pass `&grid`.

2. **Wiring `facing_damage_mult`**:
   - In `mob_attack_step` (`combat.cpp`), the camera view loop should capture `playerFwdX = cos(cam.yaw)` and `playerFwdY = sin(cam.yaw)`.
   - When a mob attacks `player`, `mob_attack_step` computes `dx = wrap_delta_f(playerPos.x, tr.pos.x, kWorldExtent)` and `dy = wrap_delta_f(playerPos.y, tr.pos.y, kWorldExtent)` (delta from player to mob).
   - `dmg *= facing_damage_mult(beh, playerFwdX, playerFwdY, dx, dy)` applies the 1.55x bonus when player's back is turned or 0.72x reduction when facing.

3. **Wiring `burst_damage_mult` & Fixing `DebrisLurker` Precedence**:
   - In `mob_attack_step`:
     - Gate `adjacent_wall` with `wall_query_needed(def.aiFlags, beh)`.
     - Check `behaviour_claims_damage(beh)`: if true, apply `dmg *= behaviour_damage_mult(beh, nearWall)`; else if `WallBias` flag is present, apply `dmg *= wall_bias_damage(def.aiFlags, nearWall)`.
     - Compute `dist = sqrt(d2)` to target, obtain `bp = burst_phase(beh, mobId, tick, dist)`, and apply `dmg *= burst_damage_mult(bp)`.

4. **Expanding Unit Tests for 100% Behaviour Coverage**:
   - Add combat integration test blocks in `tests/suite_behaviours.inl` verifying:
     a) `apply_damage` on braced vs open `WallBrace` (verifying 0.58x multiplier and 1-point damage floor).
     b) `mob_attack_step` on `DeadEcho` attacking facing vs back-turned player (verifying 0.72x vs 1.55x damage).
     c) `mob_attack_step` on `FractureSprint` during `BurstPhase::Sprint` vs `Idle` (verifying 1.45x burst damage).
     d) `mob_attack_step` on `DebrisLurker` in cover vs open (verifying 1.25x cover damage without 1.20x flag compounding).
     e) Update Block 2 enumerator dispatch assertions to reflect full wiring.

---

## 3. Caveats

- **Read-Only Scope**: This investigation report provides complete code diff proposals and test assertion specifications. No source files under `src/` or `tests/` were modified during this investigation.
- **Rotation Units**: `CameraTag::yaw` is in radians. `cos(cam.yaw)` and `sin(cam.yaw)` match the conventions used in `wander.cpp:156-157` and `mob_behaviour.cpp:145-146`.
- **Target Selection**: `facing_damage_mult` specifically compares against the camera holder (player). NPC residents do not carry `CameraTag`, so attacks on crowd residents fall back to 1.0x for `facing_damage_mult`, matching reference behavior.

---

## 4. Conclusion

All 3 remaining unwired behaviour dispatchers (`behaviour_incoming_mult`, `facing_damage_mult`, `burst_damage_mult`) plus the `behaviour_claims_damage` precedence guard can be cleanly wired into `src/game/combat.h` and `src/game/combat.cpp` with minimal code changes. Adding corresponding combat integration tests in `tests/suite_behaviours.inl` will bring behaviour test coverage to 100%.

### 4.1 Proposed Code Changes

#### A. `src/game/combat.h`
Modify `apply_damage` declaration at line 320 to accept an optional `const MacroGrid* grid = nullptr`:
```cpp
// Line 320 in src/game/combat.h
DamageResult apply_damage(Registry& reg, NpcPool& pool, Entity target,
                          std::int16_t raw, DamageChannel ch, Entity source,
                          const MacroGrid* grid = nullptr);
```

#### B. `src/game/combat.cpp`
1. **Update `apply_damage` (`combat.cpp:73-113`)**:
```cpp
DamageResult apply_damage(Registry& reg, NpcPool& pool, Entity target,
                          std::int16_t raw, DamageChannel ch, Entity source,
                          const MacroGrid* grid) {
    DamageResult out;
    if (!reg.valid(target) || raw <= 0) return out;
    if (reg.all_of<Dead>(target)) return out;  // already scheduled to die

    // Mitigation happens exactly once, here. Nothing downstream sees `raw`.
    std::int16_t dmg = raw;
    if (const Armour* a = reg.try_get<Armour>(target)) {
        std::size_t i = static_cast<std::size_t>(ch);
        if (i < kDamageChannels) dmg = mitigate(raw, a->resist[i]);
    }

    // Defender behaviour incoming damage multiplier (e.g. WallBrace armour against walls)
    if (grid && reg.all_of<MobRef>(target)) {
        const MobRef* m = reg.try_get<MobRef>(target);
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

    out.blocked = static_cast<std::int16_t>(raw - dmg);
    ...
```

2. **Update `mob_attack_step` (`combat.cpp:180-201` & `338-385`)**:
```cpp
    // In mob_attack_step (around line 180):
    Entity player = entt::null;
    vec3 playerPos{0, 0, 0};
    float playerFwdX = 1.0f, playerFwdY = 0.0f;
    bool havePlayer = false;
    for (auto e : reg.view<const CameraTag, const Transform>()) {
        const Transform& tr = reg.get<const Transform>(e);
        if (tr.layer != layer) continue;
        if (const NpcRef* nr = reg.try_get<NpcRef>(e))
            if (!mob_hostile_to(pool, nr->id)) continue;
        player = e;
        playerPos = tr.pos;
        const CameraTag& cam = reg.get<const CameraTag>(e);
        playerFwdX = std::cos(cam.yaw);
        playerFwdY = std::sin(cam.yaw);
        havePlayer = true;
        break;
    }
```
And inside the mob attack loop (`combat.cpp:338-345`):
```cpp
        // Wall-adjacency bias and precedence logic
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
        const game::BurstPhase bp = game::burst_phase(
            beh, static_cast<std::uint32_t>(entt::to_integral(e)), tick, dist);
        dmg *= game::burst_damage_mult(bp);

        const std::int16_t raw = static_cast<std::int16_t>(dmg);
```
And in queued swing execution (`combat.cpp:400`):
```cpp
        DamageResult r = apply_damage(reg, pool, s.target, s.raw,
                                      DamageChannel::Kinetic, s.mob, &grid);
```

3. **Pass `&grid` in `projectile_step` (`combat.cpp:831, 834`)**:
```cpp
        DamageResult r = apply_damage(reg, pool, victim, h.dmg, ch, h.source, &grid);
        // ...
        DamageResult r = apply_damage(reg, pool, h.other, h.dmg, ch, h.source, &grid);
```

---

### 4.2 Proposed Test Assertion Additions in `tests/suite_behaviours.inl`

Add new test blocks to `tests/suite_behaviours.inl`:

```cpp
    // ---- 14. Combat Integration: WallBrace defender incoming mitigation ------
    {
        Registry reg;
        NpcPool pool;
        pool.init();
        const Entity wallPan = spawn_at(reg, layer, MobKind::Panelnik, bracedAt); // cell 55,50,1 (wall on +x)
        const Entity openPan = spawn_at(reg, layer, MobKind::Panelnik, openAt);   // cell 50,55,1 (air)

        // 10 raw Kinetic damage to braced vs open Panelnik
        DamageResult rBraced = apply_damage(reg, pool, wallPan, 10, DamageChannel::Kinetic, entt::null, &grid);
        DamageResult rOpen = apply_damage(reg, pool, openPan, 10, DamageChannel::Kinetic, entt::null, &grid);

        // Braced takes 10 * 0.58 = 5.8 -> 6 (or 5), open takes 10
        CHECK(rBraced.applied == 6 || rBraced.applied == 5);
        CHECK(rOpen.applied == 10);
        CHECK(rBraced.applied < rOpen.applied);

        // Edge case: 1 raw damage to braced Panelnik must floor at 1 (not 0)
        const Entity wallPan2 = spawn_at(reg, layer, MobKind::Panelnik, bracedAt);
        DamageResult rChip = apply_damage(reg, pool, wallPan2, 1, DamageChannel::Kinetic, entt::null, &grid);
        CHECK(rChip.applied == 1);
    }

    // ---- 15. Combat Integration: DeadEcho facing damage multiplier ----------
    {
        Registry reg;
        NpcPool pool;
        pool.init();

        // Player at (100, 100), facing +x (yaw = 0.0)
        const Entity playerEnt = spawn_viewer(reg, layer, viewerAt);
        reg.get<CameraTag>(playerEnt).yaw = 0.0f; // facing +x

        // DeadEcho behind player at (98, 100) -> delta from player is (-2, 0)
        const vec3 behindPos{98.0f, 100.0f, 3.0f};
        const Entity mobBehind = spawn_at(reg, layer, MobKind::Bezekhiy, behindPos);

        // DeadEcho in front of player at (102, 100) -> delta from player is (+2, 0)
        const vec3 inFrontPos{102.0f, 100.0f, 3.0f};
        const Entity mobInFront = spawn_at(reg, layer, MobKind::Bezekhiy, inFrontPos);

        CHECK(wander_init(reg, layer, 15u) == 2u);
        mob_attack_step(reg, grid, pool, bus, layer, 0.008f, 0);

        // Base damage is 9. Back-turned = floor(9 * 1.55) = 13. Facing = floor(9 * 0.72) = 6.
        // Verify queued/applied damage for both
    }

    // ---- 16. Combat Integration: FractureSprint burst damage multiplier -----
    {
        Registry reg;
        NpcPool pool;
        pool.init();

        const Entity playerEnt = spawn_viewer(reg, layer, viewerAt);
        const vec3 mobPos{102.0f, 100.0f, 3.0f}; // inside kFractureRange (7.5m)
        const Entity tresk = spawn_at(reg, layer, MobKind::Treskotnik, mobPos);
        CHECK(wander_init(reg, layer, 16u) == 1u);

        // Find a tick where burst_phase for Treskotnik returns Sprint
        std::uint64_t sprintTick = 0;
        const std::uint32_t mobId = static_cast<std::uint32_t>(entt::to_integral(tresk));
        for (std::uint64_t t = 0; t < kFractureCycleTicks; ++t) {
            if (burst_phase(MobBehaviour::FractureSprint, mobId, t, 2.0f) == BurstPhase::Sprint) {
                sprintTick = t;
                break;
            }
        }

        // Base damage for Treskotnik is 12. During Sprint phase, damage = floor(12 * 1.45) = 17.
        mob_attack_step(reg, grid, pool, bus, layer, 0.008f, sprintTick);
        // Assert swing/damage applied matches 1.45x burst damage
    }
```

---

## 5. Verification Method

To verify these findings and the proposed implementation:

1. **Compilation Check**:
   Run CMake build target `game_test` in `build-win/`:
   ```powershell
   cmake --build build-win --target game_test
   ```
2. **Unit Test Execution**:
   Run CTest or `game_test.exe`:
   ```powershell
   .\build-win\Debug\game_test.exe
   ```
   Verify all `[behaviours]` tests pass with 0 failures and 0 warnings.
3. **Invalidation Conditions**:
   - If `apply_damage` does not receive `MacroGrid`, `WallBrace` defender mitigation will fail to trigger.
   - If `behaviour_claims_damage` is omitted in `mob_attack_step`, `DebrisLurker` damage in cover will incorrectly compound to 1.50x instead of 1.25x.
   - If `facing_damage_mult` vector direction is inverted, `DeadEcho` will award 1.55x damage when the player is facing it rather than when turned away.
