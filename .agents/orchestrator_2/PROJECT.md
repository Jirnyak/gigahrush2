# Project: Gigahrush2 Subagent Orchestration Wave (Revival)

## Architecture
- Game Engine: C++23 / Vulkan 1.3
- Key Modules:
  - Combat & Mob Behaviours: `src/game/combat.h`, `src/game/combat.cpp`, `src/game/mob_behaviour.hpp`
  - Tests: `tests/game_test.cpp`, `tests/suite_behaviours.inl`, `tests/suite_audit.inl`, `tests/suite_monster.inl`
  - Vulkan Rendering: `src/render/cube_pass.cpp`, `src/world/materials.h`
  - Shaders: `shaders/cube.frag`
  - Textures: `data/textures/*.ktx2` (6 UASTC+zstd KTX2 maps)

## Code Layout
- `src/game/`: combat system logic and entity damage dispatch
- `src/render/`: Vulkan render passes, descriptor set bindings, sampler setup
- `src/world/`: material system definitions
- `shaders/`: GLSL / SPIR-V shaders
- `tests/`: CTest suites (`world_test`, `audit_test`, `game_test`, `source_rules`)

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration & Inspection | Inspect existing uncommitted work from `worker_m1_3`, verify combat logic state and texture sampling state. | none | IN_PROGRESS |
| 2 | MobBehaviour Dispatchers & Test Coverage | Wire `behaviour_incoming_mult` in `apply_damage` (`src/game/combat.cpp`), `facing_damage_mult`, `burst_damage_mult`. Update `tests/suite_behaviours.inl` with explicit assertions. | M1 | PLANNED |
| 3 | GPU Texture Sampling Pipeline | Integrate 6 UASTC+zstd KTX2 maps from `data/textures/` into Vulkan material descriptors in `src/render/cube_pass.cpp` and `shaders/cube.frag`. | M1 | PLANNED |
| 4 | Verification, Audit & Gate Release | Run build script `tools\win\build.bat Release`, `ctest --test-dir build-win -C Release` 4/4 green, review, forensic audit, git commit and push to `origin main`. | M2, M3 | PLANNED |

## Interface Contracts
### Combat Logic ↔ MobBehaviour
- `apply_damage`: Must apply `behaviour_incoming_mult` for defender mitigation, `facing_damage_mult` for directional damage, and `burst_damage_mult` for burst damage calculations.
- `suite_behaviours.inl`: Unit test cases asserting numerical correctness of damage multipliers.

### Vulkan Cube Pass ↔ Shaders
- Descriptor Set layout in `cube_pass.cpp`: Combined image samplers bound to textures in `data/textures/` (albedo, normal, roughness, metallic, AO, emissive / 6 KTX2 texture maps).
- Shader `cube.frag`: Uniform samplers matching Vulkan descriptor layout.
