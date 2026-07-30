# Project: Gigahrush2 Subagent Orchestration Wave

## Architecture
- Game Engine: C++23 / Vulkan 1.3
- Modules:
  - Game logic: `src/game/combat.cpp`, `src/game/mob_behaviour.hpp`
  - Tests: `tests/suite_behaviours.inl`, test executables (`world_test`, `audit_test`, `game_test`, `source_rules`)
  - Rendering: `src/render/cube_pass.cpp`, Vulkan pipeline descriptor sets
  - Shaders: `shaders/cube.frag` (SPIR-V compiled / GLSL)
  - Assets: `data/textures/*.ktx2` (6 supercompressed UASTC+zstd maps)

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | MobBehaviour Dispatchers & Tests | Wire `behaviour_incoming_mult` in `apply_damage` (`src/game/combat.cpp`), `facing_damage_mult`, `burst_damage_mult`. Update `tests/suite_behaviours.inl` with explicit assertions. | none | IN_PROGRESS |
| 2 | GPU Texture Sampling Pipeline | Integrate 6 UASTC+zstd KTX2 maps from `data/textures/` into Vulkan material descriptors in `src/render/cube_pass.cpp` and `shaders/cube.frag`. | none | IN_PROGRESS |
| 3 | Build, CTest & Git Release Gate | `tools\win\build.bat Release`, `ctest --test-dir build-win -C Release` 100% green across all 4 targets, git commit & push to origin main. | M1, M2 | PLANNED |

## Interface Contracts
### Combat Logic ↔ MobBehaviour
- `apply_damage`: Must respect `behaviour_incoming_mult` for defender mitigation, `facing_damage_mult` for directional damage, and `burst_damage_mult` for burst damage calculations.
- `suite_behaviours.inl`: Explicit unit test cases asserting numerical correctness of damage multipliers.

### Vulkan Cube Pass ↔ Shaders
- Descriptor Set layout in `cube_pass.cpp`: Combined image samplers bound to textures in `data/textures/` (albedo, normal, roughness, metallic, AO, emissive / 6 KTX2 texture maps).
- Shader `cube.frag`: Uniform samplers matching Vulkan descriptor layout.
