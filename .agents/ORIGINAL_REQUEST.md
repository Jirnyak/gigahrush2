# Original User Request

## Initial Request — 2026-07-30T11:29:05Z

Gigahrush2 C++23/Vulkan Engine Enterprise Graphics System & Procedural Prop Swarm.

Working directory: C:\hades\gigahrush2
Integrity mode: development

## CONCURRENCY & COMPILATION CONSTRAINTS
1. SINGLE-COMPILER OWNER RULE: Subagents MUST NOT execute tools\win\build.bat, cmake, ninja, or ctest. All builds are executed strictly sequentially by the Lead Orchestrator.
2. Maintain clean, zero-GC C++23 engine code.

## Requirements
R1. Procedural Prop Mesh Generators & GPU Instancing (src/render/prop_mesh.cpp & prop_pass.cpp)
R2. Advanced Atmospheric Shader Pipeline (shaders/prop.vert & prop.frag)
R3. Procedural Prop Placement System (src/render/prop_placer.cpp)
R4. Test Suite Assertion Coverage (tests/suite_props.inl & CMakeLists.txt)

Verify all files under C:\hades\gigahrush2 and provide complete, clean, non-stubbed updates.

## Follow-up — 2026-07-30T12:03:30Z

Massive feature expansion and content porting for the Gigahrush2 C++23/Vulkan engine.

Working directory: C:\hades\gigahrush2
Integrity mode: benchmark

### Requirements

#### R1. Content Porting from Legacy Gigahrush
Port the best and most critical gameplay logic, monster AI routines, crafting mechanics, and procedural content logic from the old `C:\hades\gigahrush` repository into the new `C:\hades\gigahrush2` C++ engine architecture.

#### R2. Vulkan Graphics & Texturing 
Implement triplanar texture mapping using the provided KTX2 textures in `data/textures`. Expand the PBR shaders in `shaders/prop.frag` and `shaders/cube.frag` to support dynamic emissive flickering, high-quality specular models, and distance fog integration.

#### R3. Procedural Prop Swarm Generation
Finish the mesh generation and placement algorithms for the remaining Phase 3/4 props (e.g., SupportBeam, Terminal, SecurityCamera, FungalColumn). Ensure proper spatial hashing and non-overlapping cell occupancy. 

#### R4. Zero-GC & C++23 Standards
All new C++ code (minimum target ~1500 lines) must strictly adhere to project rules: NO dynamic memory allocations (0B per frame) in the hot path, no exceptions, no RTTI.

### Acceptance Criteria

#### Execution & Verification
- At least 1500 lines of highly optimized, zero-GC C++23 code must be committed.
- All `ctest` suites (`world_test`, `audit_findings`, `game_test`, `source_rules`) must pass 100% green without any manual bypasses.
- At least 3 successful visual screenshot verifications (`gigahrush2.exe --shot`) must be generated and logged to prove Vulkan rendering integrity.
- The `teamwork_preview` agent must effectively coordinate specialized subagents to implement these features without bottlenecks.

