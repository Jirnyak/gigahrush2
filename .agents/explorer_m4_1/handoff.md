# Handoff Report: Utility AI Activation & Monster Systems Porting (Milestone 4)

## 1. Observation
Direct findings from inspecting `src/app/main.cpp`, `src/game/ai.h`, `src/game/ai.cpp`, `src/game/mob_table.cpp`, `src/game/mob_behaviour.h`, `src/game/combat.h`/`cpp`, `tests/suite_utilai.inl`, and original TypeScript sources at `C:\hades\gigahrush`:

- **`src/app/main.cpp:799-800`**: `game::AiConfig aiCfg;` is initialized with default `enabled = false`.
- **`src/app/main.cpp:1095`**: `aiTick = game::ai_step(reg, pool, danger, activeGrid, activeLayer, simNow, kSimDt, aiCfg);` is called every tick in the fixed-step loop. When `aiCfg.enabled == false`, `ai_step` immediately returns `AiTick{}`.
- **`src/game/ai.h:317-320`**: `ai_owns_motion(reg, e)` checks if an entity has an `AiBrain` component with `motion == MotionOwner::Ai`.
- **`src/game/wander.cpp:115` & `src/game/faction_relations.cpp:270`**: Both foreign steering systems ALREADY contain the single-writer guard `if (ai_owns_motion(reg, e)) continue;`.
- **`src/game/ai.h:861,870`**: `ai_init(reg, layer)` attaches `AiBrain` components to embodied NPCs on a layer. `ai_release(reg, layer)` releases `AiBrain` components back to `MotionOwner::Wander`. Neither is currently called in `main.cpp`.
- **`src/game/ai.h:913-915`**: `ai_step` takes an optional `AiMemory* mem` as its 9th parameter. Currently `main.cpp` passes `nullptr` (defaulting to memory off).
- **`tests/suite_utilai.inl:1-1534`**: Contains 15 comprehensive test blocks (1005 assertions) validating single-writer rules, hysteresis, identity seeds, memory coalescing, eviction, and survival across re-embodiment.
- **TypeScript original (`C:\hades\gigahrush`) vs C++ (`gigahrush2`) Monster Systems Comparison**:
  - `systems/ai/monster_pack.ts`: `shareLocalTarget` propagates aggro to nearby pack members (`GreenDogPack` r=11m, `FogShark` r=10m, `Zombie` crowd pressure +12% dmg/zombie). In C++, `MobPackMode` exists in `mob_table.h`, but target sharing / alert propagation is absent in `mob_attack_step` / `wander.cpp`.
  - `systems/monster_terrain.ts` & `systems/monster_traits.ts`: `wetTerrainCell` / `wetWaterCell` queries drive `Lotochnik` drain armor (42% damage reduction on wet ground), `FogShark` speed/damage terrain scaling (dry speed 0.34x / fog speed 1.08x), `Panelnik` wall brace (0.58x damage mult) and open floor slow (0.58x speed mult), and `Chervie` net power (powered by Screen/Apparatus). In C++, wet cell queries and terrain traits are unlinked from `combat.cpp` and `physics.cpp`.
  - `systems/monster_counterplay.ts`: Counterplay mechanics for cutting weapons (root cutting on `Borshchevik` and `BloodPlant`) and fire projectiles (`Borshchevik` & `BloodPlant` burning, `FogShark` ignition, `Swarm` instant dispersion/death). In C++, damage channels exist in `combat.h`, but weapon/projectile-specific counterplay triggers are not connected in `apply_damage` or `projectile_step`.

---

## 2. Logic Chain
1. **Utility AI Activation Requirement**:
   - In `main.cpp:1095`, `ai_step` evaluates AI decisions only when `aiCfg.enabled == true`.
   - Without `ai_init(reg, layer)` attached to floor entities, `AiBrain` is absent on entities, so `ai_owns_motion(reg, e)` returns `false` and entities stay delegated to `wander_step`.
   - Therefore, activating Utility AI requires setting `aiCfg.enabled = true`, calling `ai_init(reg, layer)` on floor setup/travel, calling `ai_release(reg, oldLayer)` on floor travel/unload, and instantiating `AiMemory aiMemory;` passed to `ai_step`.

2. **Single-Writer Safety**:
   - `wander_step` (`wander.cpp:115`) and `faction_feud_step` (`faction_relations.cpp:270`) already contain `if (ai_owns_motion(reg, e)) continue;`.
   - Verified by `suite_utilai.inl` Block 4 & 5: When `AiBrain` is present and `motion == MotionOwner::Ai`, `wander_step` skips the body, preventing double-writing of `Velocity` and eliminating movement jitter.

3. **Unported Monster Systems Identification**:
   - **Pack Behavior**: `mob_table.h` defines `MobPackMode::Crowd` and `MobPackMode::Loner`. In TS, `shareLocalTarget` propagates target acquisition to nearby pack members. In C++, when a monster aggros, neighboring pack members do not receive target alerts.
   - **Terrain Traits**: `systems/monster_terrain.ts` defines `wetTerrainCell`. `Lotochnik` relies on standing in water/sink/toilet cells for its 0.58x damage mitigation. `FogShark` relies on water/fog for speed/damage multipliers. C++ lacks the grid cell query for wet terrain.
   - **Counterplay Mechanics**: TS `monster_counterplay.ts` modifies damage and triggers death outcomes for specific weapon/projectile types against specific monsters. C++ `combat.cpp` handles generic channel damage but lacks weapon-type checks (e.g. cutting weapon vs plant roots, fire projectile vs swarm).

---

## 3. Caveats
- Read-only investigation: No modifications were made to `src/` or `tests/` files.
- Navigation bake for a floor lands asynchronously (`AsyncBake`). Crowd steering via AI occurs immediately, while pathing relies on flow fields once `nav.poll()` completes.
- Monster system porting can be executed incrementally without breaking existing combat or physics loops.

---

## 4. Conclusion & Worker Step-by-Step Instructions

### Step 1: Activate Utility AI in `src/app/main.cpp`
1. **Initialize `AiConfig` and `AiMemory`**:
   - File: `src/app/main.cpp` (around line 799-801)
   - Code Anchor:
     ```cpp
     // Change:
     game::AiConfig aiCfg;
     aiCfg.enabled = true; // Set to true to activate Utility AI
     aiCfg.hysteresis = true;
     aiCfg.memory = true;
     
     game::AiMemory aiMemory;
     ```
2. **Attach `AiBrain` on Initial Floor Load**:
   - File: `src/app/main.cpp` (around line 650, after `refresh_floor_containers`)
   - Code Anchor:
     ```cpp
     if (currentSpec)
         doorsBuilt = game::door_build(stack.layer(l0), doors, 0, *currentSpec, kDoorSeed);
     doors.frozen = true;
     game::ai_init(reg, l0); // Attach AiBrain to embodied floor NPCs
     begin_floor_nav(stack.layer(l0), nav);
     ```
3. **Handle Floor Travel (Release & Init)**:
   - File: `src/app/main.cpp` (around line 901-945, inside floor travel block)
   - Code Anchor:
     ```cpp
     // Before streaming travel (on old layer activeLayer):
     game::ai_release(reg, activeLayer);
     
     // After streaming travel completes (on new layer nl):
     LayerId nl = reg.get<Transform>(player).layer;
     refresh_floor_mobs(reg, stack.layer(nl), currentFloor, nl);
     refresh_floor_containers(reg, stack.layer(nl), currentFloor, nl);
     game::ai_init(reg, nl); // Attach AiBrain to new floor NPCs
     ```
4. **Pass `AiMemory` to `ai_step`**:
   - File: `src/app/main.cpp` (around line 1095)
   - Code Anchor:
     ```cpp
     aiTick = game::ai_step(reg, pool, danger, activeGrid, activeLayer, simNow,
                            kSimDt, aiCfg, &aiMemory);
     ```

### Step 2: Implement Pack Behavior Target Sharing
1. **Add `share_local_target` in `src/game/combat.cpp` or `src/game/mob_behaviour.h`**:
   - When a monster with `MobPackMode::Crowd` (e.g. GreenDog, Zombie, FogShark) enters aggro state or attacks in `mob_attack_step`, query nearby entities within pack radius (e.g. 10m).
   - Alert nearby pack members of the same `MobKind` to target the same entity.

### Step 3: Implement Wet Terrain Queries & Monster Terrain Traits
1. **Add `wet_terrain_cell` in `src/world/macro_grid.h` / `src/game/combat.cpp`**:
   - Query cell material/feature (`WATER`, `F_WATER`, `SINK`, `TOILET`).
2. **Apply `Lotochnik` & `FogShark` Terrain Traits in `src/game/combat.cpp`**:
   - In `apply_damage`: If target is `Lotochnik` and cell is wet, scale damage by 0.58f.
   - In `mob_attack_step`: If mob is `FogShark`, check if standing on wet terrain / fog, scale speed and damage accordingly (dry speed 0.34x, dry damage 0.55x, fog speed 1.08x, fog damage 1.18x).

### Step 4: Implement Monster Counterplay Mechanics
1. **Extend `apply_damage` in `src/game/combat.cpp`**:
   - Check damage source item tags / projectile types.
   - If target is `Swarm` and damage channel is `Fire`, deal lethal damage / disperse instantly.
   - If target is `Borshchevik` or `BloodPlant` and attacked by cutting weapon (e.g. knife/axe), trigger root severing / bonus critical damage.

---

## 5. Verification Method

1. **Unit Test Verification**:
   - Build test suite:
     ```cmd
     cmake -B build -DCMAKE_BUILD_TYPE=Debug
     cmake --build build --config Debug --target game_test
     ```
   - Execute test harness:
     ```cmd
     build\Debug\game_test.exe
     ```
   - Verify `suite_utilai` prints `1005 checks, 0 failures` and zero double-writes.

2. **Integration Verification**:
   - Build main application:
     ```cmd
     cmake --build build --config Debug --target gigahrush2
     ```
   - Run headless screenshot capture:
     ```cmd
     build\Debug\gigahrush2.exe --shot test_ai.png --frames 120
     ```
   - Inspect console output for `ai_step` log metrics:
     Confirm `AiTick` reports `considered > 0`, `replanned > 0`, `aiOwned > 0` during active simulation.
