# Project: gigahrush2 A-Life, Utility AI, Social Systems, Needs & Survival Specifications

## Architecture
- Modules:
  - `src/game/ai.h` & `src/game/ai.cpp`: AI tick, utility intent scoring, panic diffusion, role traits integration.
  - `src/app/main.cpp`: ECS tick loop, social systems, vendor kind restoration, rumour 6-arg call, quest text, toilet prop relief & stain splat.
  - `src/game/needs.h` & `src/game/npc_pool.h`: Needs struct (40 bytes), static asserts, attrition channel bounds.
  - `src/game/macro_sim.h` & `src/game/macro_sim.cpp`: Un-embodied macro simulation, cold-NPC food consumption & starvation model.
  - `src/game/encumbrance.h` & `src/game/encumbrance.cpp`: Encumbrance calculation, crowd NPC footstep noise publish with 1-in-8 stagger.
  - `src/game/room_zone.h`: Typo fix (`kInvalidNpcId` -> `kInvalidNpc`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1. Panic via diffusion publish | `panic_publish_step()` in `ai.cpp`, emergency intent bodies emit `kPanicEmit * dt * ft.panic` into danger field | M1 | ORIGINAL_REQUEST §R1 |
| 2 | R6. Role scoring integration | Fetch/apply role traits (`rt.workDrive`, `rt.patrolDrive`, `rt.sociability`, etc.) to intent utility scores in `ai.cpp` | M1 | ORIGINAL_REQUEST §R6 |
| 3 | R2. Social system fixes | 3 surgical fixes in `main.cpp` (vendorKind restoration, rumour 6-arg, quest_objective_text) | M2 | ORIGINAL_REQUEST §R2 |
| 4 | R3. Needs static asserts & toilet fix | Static asserts in `needs.h`, ToiletPan prop check for relief (70/65 vs 40/35 + stain splat) in `main.cpp` | M2 | ORIGINAL_REQUEST §R3 |
| 5 | R4. Cold-NPC needs & starvation | Binary cold-needs model in `macro_sim.cpp` for un-embodied NPCs + constants in `macro_sim.h` | M3 | ORIGINAL_REQUEST §R4 |
| 6 | R5. NPC footstep noise | Remove `if (camera)` guard on crowd bodies in `encumbrance.cpp`, 1-in-8 stagger, `noise_publish` call | M3 | ORIGINAL_REQUEST §R5 |
| 7 | Build & Test Suite Verification | MSVC clean build, `sizeof(Needs)==40`, `ctest` pass, runtime log verification showing `[aimem]` role lines and patrol intent | M4 | ORIGINAL_REQUEST §Acceptance Criteria |

## Code Layout
- `src/game/ai.h`, `src/game/ai.cpp`
- `src/app/main.cpp`
- `src/game/needs.h`, `src/game/npc_pool.h`
- `src/game/macro_sim.h`, `src/game/macro_sim.cpp`
- `src/game/encumbrance.h`, `src/game/encumbrance.cpp`
- `src/game/room_zone.h`

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | AI Engine Enhancements (R1 Panic & R6 Role Scoring) | `ai.h`, `ai.cpp`, `main.cpp` danger field pass | none | IN_PROGRESS |
| 2 | Social & Needs Systems (R2 & R3) | `main.cpp`, `needs.h`, `npc_pool.h`, `room_zone.h` | M1 | PLANNED |
| 3 | Macro Sim & Physical Dynamics (R4 & R5) | `macro_sim.h`, `macro_sim.cpp`, `encumbrance.h`, `encumbrance.cpp` | M2 | PLANNED |
| 4 | Final Build & Test Verification | MSVC build, ctest, runtime AI log verification (`[aimem]` & patrol intent) | M1, M2, M3 | PLANNED |

## Interface Contracts
- `panic_publish_step`: `void panic_publish_step(Field<float>& danger_field, const Position& pos, float dt, float panic_factor)` or inside `ai_step` with `Field<float>* danger`.
- `relieve_needs`: `void relieve_needs(Needs& needs, float food_relief, float rest_relief)`
- `kColdFedLevel` = 60.0f, `kColdStarveStep` = 20.0f in `macro_sim.h`.
- `noise_publish`: `void noise_publish(NoiseField& noise, const Position& pos, float radius, NoiseSource source)`
