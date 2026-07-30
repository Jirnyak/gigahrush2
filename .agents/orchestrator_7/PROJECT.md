# Project: Gigahrush2 Vulkan GPU Instancing & Graphic System

## Architecture
- Engine Core: C++23 / Vulkan engine port from WebGL TypeScript.
- World Generation: Voxel floor/walls/ceiling macro world (`src/world/`).
- Prop Placement System: `src/world/prop_placer.h / .cpp` populating instanced prop shapes into `src/render/prop_pass.h / .cpp` & `prop_mesh.h / .cpp`.
- Prop Shading: `shaders/prop.frag` & `shaders/prop.vert` for GPU instanced rendering.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Procedural Prop Placement System | `src/world/prop_placer.h / .cpp`, inspect voxel grid & populate prop meshes | None | IN_PROGRESS |
| 2 | M2: Advanced Prop Shading & Materials | `shaders/prop.frag`, normal perturbation, roughness variation, emissive pulse/flicker | M1 | PLANNED |
| 3 | M3: Multi-Agent Code Audit & Verification Gate | Code auditor checks, unused variables, bounds safety, test pins in CMakeLists.txt | M1, M2 | PLANNED |
| 4 | M4: System Verification & Push | Clean release build, 100% CTest pass (4 targets), git commit & push | M1, M2, M3 | PLANNED |

## Interface Contracts
### `prop_placer` ↔ `world` / `prop_pass`
- `PropPlacer` scans `VoxelGrid` (floor, ceiling, wall cells, anomalous zones, light intersections).
- Generates `PropInstance` data (transform, material ID, animation phase, variant index) pushed to GPU instanced buffers in `prop_pass`.

## Code Layout
- `src/world/prop_placer.h`, `src/world/prop_placer.cpp`: Procedural prop placement logic.
- `src/render/prop_mesh.h`, `src/render/prop_mesh.cpp`: GPU instanced prop geometries.
- `src/render/prop_pass.h`, `src/render/prop_pass.cpp`: Vulkan pass for prop rendering.
- `shaders/prop.vert`, `shaders/prop.frag`: Prop shader programs.
- `tests/world_test.cpp`, `tests/audit_test.cpp`, `tests/game_test.cpp`: Engine tests.
