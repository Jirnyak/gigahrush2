# Project: GigaHrush 2 — Resolution of Architectural Problems (11, 15, 21, 29)

## Architecture
GigaHrush 2 is a high-performance, Data-Oriented Design (DOD) entity-component-system (ECS) engine.
- Pure POD components in `src/ecs/components.h`.
- Free-function `*_step` simulation systems without dynamic allocations in the 125 Hz hot loop (`kSimDt = 1.0f / 125.0f`).
- Vector gravity frame projection via `GravityFrame`, `regime_frame(r)`, `world.gravity().at(pos)` supporting all 8 isotropic regimes (`NegX`, `PosX`, `NegY`, `PosY`, `NegZ`, `PosZ`, `Zero`, `Custom`).
- Toroidal wrapping on X/Y/Z (`wrap_delta_f`, `wrap_macro`) with linear W.
- Strict presentation vs simulation decoupling: `src/app/main.cpp` coordinates Vulkan rendering + SDL3 loop; `src/game/` (`giga_game`) owns all simulation, world streaming, entity lifecycle, and save/load logic.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Deep Gravity Frame Isotropy | CameraTag::eyeOffset, compute_camera up vector, prop_system angular impulse/projectile pops/ceiling lights, prop.frag fog, cull.comp yaw-box, and GPU compute passes (particle/wire/cloth/gas) | M1 (Problem 15) | ORIGINAL_REQUEST §R2, problems.md Prob 15 |
| F2 | Multi-Floor Symmetry & Layer Independence | Fix container.cpp Z wrap, remove LayerId{0} fallbacks across main.cpp/combat.cpp, direct --floor initialization, unified elevator/travel transitions | M2 (Problem 11) | ORIGINAL_REQUEST §R1, problems.md Prob 11 |
| F3 | MacroSim Slicing & Amortized Aging | Chunked ring cursor (agingRecordsPerTick = 4096) for demographic sweep in MacroSim::step; maintain <0.05ms budget at 2^20 scale with exact population accounting and deterministic hashing | M3 (Problem 21) | ORIGINAL_REQUEST §R3, problems.md Prob 21 |
| F4 | Modular Decomposition of main.cpp | Extract floor lifecycle, possession, interaction, monster traits, and save IO from main.cpp into dedicated giga_game modules in src/game/; reduce main.cpp <2,500 lines | M4 (Problem 29) | ORIGINAL_REQUEST §R4, problems.md Prob 29 |
| F5 | E2E Regression, Audit & Hardening | 100% green pass on world_test, audit_test, game_test, e2e_test, check_source_rules, check_wired; formal problem closure in problems.md | M5 (Final Milestone) | ORIGINAL_REQUEST Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Problem 15: Deep Gravity Frame Isotropy | CameraTag, compute_camera, prop_system, shaders (prop.frag, cull.comp), compute passes | None | IN_PROGRESS |
| M2 | Problem 11: Multi-Floor Symmetry & Layer Independence | container.cpp wrap_delta_f(dz), LayerId dynamic resolution, direct boot floor, elevator travel unification | M1 | PLANNED |
| M3 | Problem 21: MacroSim Slicing & Amortized Aging | MacroSim aging ring cursor, agingRecordsPerTick, demographic stationarity, FNV-1a cycle indexing | None | PLANNED |
| M4 | Problem 29: Modular Decomposition of main.cpp | Extract floor_lifecycle, possession, interaction, monster_traits, save_io into src/game/ | M1, M2 | PLANNED |
| M5 | E2E Full Verification, Formal Closure & Iron Gate | 100% test pass, zero heap allocs in hot loop, update problems.md, commit | M1, M2, M3, M4 | PLANNED |

## Interface Contracts
### Gravity Frame ↔ Systems
- `compute_camera(reg, aspect, up)` accepts the layer's gravity `up` vector derived from `world.gravity().at(playerPos)`.
- `prop_system` impulses and angular velocity use `frame.up`, `frame.tangent0`, and `frame.tangent1`.
- Compute push constants pass `vec4 grav` to `particle_sim.comp`, `wire_sim.comp`, `cloth_sim.comp`, `gas_sim.comp`.

### Floor & World Lifecycle ↔ Simulation
- `perform_floor_transition(World& world, Registry& reg, LayerId from, LayerId to, int targetFloor)` unifies transition and persistence logic.
- All floor queries dynamic against `FloorRegistry` and `LevelStack`.
- No `LayerId{0}` fallback when active layer is known.

### MacroSim ↔ Fixed-Step Sim Loop
- `MacroSim::step(pool, params, rel)` runs amortized sweep: `cursor = (cursor + agingRecordsPerTick) % n`.
- Cycles tracked via `cycleCount_`; deterministic hashing uses `cycleCount_ ^ id`.
- Stationarity maintained via exact running counts and closed-loop replacement births.

### Main Coordinator ↔ Game Modules
- `main.cpp` calls free functions from `src/game/`:
  - `giga::refresh_floor_entities(world, reg, layer, ...)`
  - `giga::tick_monster_traits(reg, dt)`
  - `giga::dispatch_player_interaction(world, reg, player, ...)`
  - `giga::save_world_state(...)` / `giga::load_world_state(...)`
- Zero SDL3/Vulkan/ImGui headers in `src/game/`.

## Code Layout
- `src/ecs/components.h`: POD components
- `src/sim/camera.h`, `src/sim/camera.cpp`: Camera projection
- `src/game/prop_system.cpp`: Prop physics, fixtures, interactions
- `src/game/container.cpp`: Containers and looting
- `src/game/macro_sim.h`, `src/game/macro_sim.cpp`: Macro-simulation
- `src/game/floor_lifecycle.h`, `src/game/floor_lifecycle.cpp`: Floor lifecycle & entity refresh
- `src/game/possession.h`, `src/game/possession.cpp`: Survivor possession & player transfer
- `src/game/interaction.h`, `src/game/interaction.cpp`: Player interactions & terminal toggles
- `src/game/monster_traits.h`, `src/game/monster_traits.cpp`: Monster autonomous traits
- `src/game/save_io.h`, `src/game/save_io.cpp`: Run state & floor disk I/O
- `src/app/main.cpp`: Presentation coordinator, render passes, window loop
- `shaders/`: GLSL compute and raster shaders
