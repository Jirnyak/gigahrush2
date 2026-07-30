# Project Plan: Gigahrush2 Procedural Prop Swarm & Graphics Pipeline

## Architecture Overview
Gigahrush2 C++23 / Vulkan Engine Enterprise Graphics System & Procedural Prop Swarm.
Core requirements focus on 25 procedural prop mesh generators, GPU-instanced prop rendering pass, advanced atmospheric vertex & fragment shaders, macro-grid procedural prop placement engine, and comprehensive unit test assertion coverage.

## Milestones

| # | Milestone Name | Scope | Dependencies | Status |
|---|----------------|-------|--------------|--------|
| 1 | R1: Procedural Prop Mesh Generators & GPU Instancing | `src/render/prop_mesh.cpp` & `prop_pass.cpp` (25 shape generators, Vulkan vertex/instance buffers, pipeline setup, dynamic draw calls) | None | DONE |
| 2 | R2: Advanced Atmospheric Shader Pipeline | `shaders/prop.vert` & `shaders/prop.frag` (Toroidal wrap, triplanar mapping, derivative normal perturbation, roughness/specular lighting, animated emissive, height fog, sRGB output) | M1 | DONE |
| 3 | R3: Procedural Prop Placement System | `src/render/prop_placer.cpp` (Deterministic spatial hashing, macro cell scanning, rule-based prop placement for ceiling/floor/wall/anomaly/support/corner clutter) | M1, M2 | DONE |
| 4 | R4: Test Coverage, Build, Source Rules & Forensic Audit | `tests/suite_props.inl` & `CMakeLists.txt` (Full assertion coverage across all 25 shapes, attribute validity, determinism, capacity limits, regex check count update, source rules check, build clean, 100% CTest pass, Forensic Auditor CLEAN verdict) | M1, M2, M3 | DONE |

## Detailed Milestone Descriptions

### Milestone 1: Procedural Prop Mesh Generators & GPU Instancing (R1)
- Verified and refined all 25 procedural shape generators in `src/render/prop_mesh.cpp` (Cylinder, HalfCylinder, Arch, Barrel, StairStep, Pipe, PipeElbow, PipeTee, Valve, Grate, RoundGrate, CabinetBox, ControlPanel, Railing, SupportBeam, CrateBox, CrateLong, LockerUnit, BenchSlab, Terminal, SecurityCamera, FloodLamp, FungalColumn, CrystalCluster, AcidPool).
- Vertex and index creation is robust, smooth/flat normals calculated properly, UV/normal attributes align with vertex input layout.
- `prop_pass.cpp` handles device buffer creation, per-instance vertex binding (32 bytes `PropInstance`), per-shape draw calls, and zero-warning memory lifecycle.

### Milestone 2: Advanced Atmospheric Shader Pipeline (R2)
- `shaders/prop.vert`: Per-instance attributes (locations 0-8), Y-axis rotation matrix, toroidal wrap minimal-image transformation (`nearest_image`), push constants matching `cube.vert` exactly.
- `shaders/prop.frag`: Material surface textures via `material_surface.glsl`, triplanar projection, procedural derivative normal perturbing, material-calibrated roughness & Blinn-Phong specular, time-animated emissive (flicker, breathing pulse, acid pop), atmospheric height fog, Henyey-Greenstein light scattering, sRGB gamma correction, and IGN dithering.

### Milestone 3: Procedural Prop Placement System (R3)
- `src/render/prop_placer.cpp`: Scans 128^3 toroidal `MacroGrid` cells.
- Applies rule-based placement for ceiling conduit/pipes, floor grates/drainage, wall cabinets/panels, flood lamps, anomalous zones (crystals, acid pools, fungal columns), structural support beams, and corner storage crates.
- Uses salt-differentiated 3D spatial hashing (`spatial_hash`). Cell bounds, matrix wrapping, and proper material/emissive attributes verified.

### Milestone 4: Test Suite Assertion Coverage, Build, Source Rules & Forensic Audit (R4)
- `tests/suite_props.inl`: Comprehensive unit assertions covering all 25 shapes, placer non-null, determinism across seeds, placement rules, bounds checking, attribute struct layout (`sizeof(PropInstance) == 32`), and capacity limits.
- `CMakeLists.txt`: Updated `PASS_REGULAR_EXPRESSION` for `world_test` to match `44176/44176 checks passed`.
- `tools/check_source_rules.cmake` returns PASS (no exceptions, no RTTI, core dependency-free).
- Full clean Release build and 100% pass across all CTest targets verified.
- Forensic Auditor integrity verification: `VERDICT: CLEAN`.

## Acceptance Criteria
1. All 25 prop shapes generated cleanly with valid geometry, normals, and index buffers — VERIFIED.
2. `prop.vert` and `prop.frag` compile cleanly to SPIR-V via `glslc` with atmospheric fog and lighting effects — VERIFIED.
3. `PropPlacer::populate` places props deterministically without out-of-bounds access — VERIFIED.
4. `suite_props.inl` tests pass 100% with exact check count registered in `CMakeLists.txt` — VERIFIED.
5. `tools\win\build.bat Release` builds with 0 warnings and all CTest targets pass — VERIFIED.
6. Forensic Auditor reports CLEAN verdict with zero integrity violations — VERIFIED.
