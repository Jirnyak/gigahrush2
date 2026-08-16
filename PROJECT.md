# Project: GigaHrush 2 Visual Overhaul & Biome Shading

## Architecture
- **Engine**: Vulkan C++23 3D Megastructure Engine.
- **Rendering System**: Hybrid raymarching / voxel SDF / rasterized geometry pipeline (`shaders/raymarch.frag`, `shaders/cube.frag`, `shaders/volumetric_fog.glsl`, `shaders/post_pass.frag`).
- **Lighting & Atmosphere**: 3D GPU `LightGrid` point lights, dynamic player flashlight beam cone, volumetric fog integration.
- **World Generation**: Procedural megastructure carving, voxel chunks, multi-floor architecture (Floor 0: Soviet Stairwell/Падик, Floor 2: Heavy Factory/Завод, Floor 4: Hydroponics Lab/Лаборатория).
- **Execution / Automation**: CLI harness (`--shot <file.png> --frames 5`, `--floor <N>`, `--action <act>`, `--no-crt`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Floor 0 Stairwell (Падик) Shading | Two-tone oil enamel / whitewash wall division, chipped paint flakes, concrete floor slabs, modular tiles | M3 | R1 |
| 2 | Floor 2 Factory (Завод) Shading | Heavy industrial steel, rust gradients, warning hazard stripes, metallic specular response, steam/pipe aesthetics | M3 | R1 |
| 3 | Floor 4 Lab (Лаборатория) Shading | Ceramic sterile tiles, bio-luminescent greenish tint, glass vat surfaces | M3 | R1 |
| 4 | Shader SPIR-V Compilation | Verify all shaders compile via `glslc` into SPIR-V with 0 errors | M3 | R1 |
| 5 | Flashlight & LightGrid Refinement | High spatial contrast, directional beam cone, fluorescent/hazard/beacon point lights | M4 | R2 |
| 6 | Volumetric Fog Tuning | Atmospheric dust, light shafts without washing out geometry or crushing blacks | M4 | R2 |
| 7 | Camera Spawn & Hallway Placement | Place camera in open carved hallway (not stuck inside solid wall type=1 full=1) | M2 | R3 |
| 8 | Release CMake Build | `cmake --build build --config Release --target gigahrush2` with 0 errors | M2, M5 | R3 |
| 9 | Headless Capture Suite | Run automated capture on Floor 0 and Floor 2 with `--no-crt` and authentic Soviet CRT | M5 | R3 |
| 10 | Action & Simulation Verification | Verify `--action mag`, `--action grenade`, `--action wall`, `--action save` execute cleanly | M5 | R3 |
| 11 | Multimodal Visual Inspection | Review generated screenshots, iterate until visuals are crisp, atmospheric, high-fidelity | M5 | R4 |
| 12 | Line Budget & Git Cleanliness | Keep `src/app/main.cpp` <= 7,000 lines, commit cleanly to `main` | M6 | Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Survey & Architecture Audit | Map codebase, shaders, camera/spawn logic, capture harness | none | IN_PROGRESS |
| 2 | Camera Spawn & Positioning Fix | Fix camera spawning inside solid walls; position safely in carved corridors | M1 | PLANNED |
| 3 | Multi-Biome Shaders & Material Overhaul | Overhaul Floor 0, Floor 2, Floor 4 materials in `raymarch.frag` & `cube.frag` | M1 | PLANNED |
| 4 | Volumetrics & Lighting Contrast | Tune `volumetric_fog.glsl`, flashlight cone, and LightGrid | M3 | PLANNED |
| 5 | Automated Capture & Visual Inspection | Capture screenshots across floors and actions; inspect & iterate visual quality | M2, M3, M4 | PLANNED |
| 6 | Verification, Commit & Handoff | Clean commit to `main`, budget check, full audit gate validation | M5 | PLANNED |

## Code Layout
- `shaders/`: GLSL shaders (`raymarch.frag`, `cube.frag`, `volumetric_fog.glsl`, `post_pass.frag`, etc.)
- `src/app/main.cpp`: Application entry, CLI argument handling, game loop, camera spawn
- `src/render/`: Vulkan render pipelines, LightGrid, buffer management
- `src/world/`: Procedural megastructure generation, floor biomes, carving logic
- `build/`: CMake build output directory
