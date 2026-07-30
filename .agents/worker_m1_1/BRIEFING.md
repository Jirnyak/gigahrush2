# BRIEFING — 2026-07-30T11:35:00Z

## Mission
Milestone 1 & 3: Implement/verify 25 PropShape mesh generators, Vulkan instanced rendering in prop_pass, procedural prop placement refactoring in prop_placer, and floor transition populating in main.cpp.

## 🔒 My Identity
- Archetype: Implementer / QA / Specialist
- Roles: implementer, qa, specialist
- Working directory: C:\hades\gigahrush2\.agents\worker_m1_1
- Original parent: 061b5f73-4c33-4ff9-9b30-9a4ec05ba62f
- Milestone: M1 & M3

## 🔒 Key Constraints
- NO CHEATING: All implementations must be genuine. No hardcoded test results, facade implementations, or circumventing tasks.
- SINGLE-COMPILER OWNER RULE: MUST NOT execute tools\win\build.bat, cmake, ninja, glslc, or ctest. Code changes directly in source files.
- Maintain clean, zero-GC C++23 engine code (`/GR-`, `-fno-exceptions`, `ENTT_NOEXCEPTION`).

## Current Parent
- Conversation ID: 061b5f73-4c33-4ff9-9b30-9a4ec05ba62f
- Updated: 2026-07-30T11:35:00Z

## Task Summary
- **What to build**:
  1. Prop Mesh (`src/render/prop_mesh.h`, `src/render/prop_mesh.cpp`): Ensure all 25 `PropShape` procedural mesh generators are fully implemented with clean parametric geometry, accurate normals, clean UVs, and CCW triangles.
  2. Prop Pass (`src/render/prop_pass.h`, `src/render/prop_pass.cpp`): Ensure all 25 shapes initialized, per-frame instance buffers allocated, vertex attributes match `PropInstance` (32 bytes), dynamic draw calls recorded per shape in `record()`, clean Vulkan resource management.
  3. Prop Placer (`src/render/prop_placer.h`, `src/render/prop_placer.cpp`): Spatial hash diversification across rules, fix FloodLamp precedence bug, fix AcidPool material check, fix pipe sub-type selection & Valve spawns, extend placement rules to use all 25 shapes, retain deterministic hash placement.
  4. App Main (`src/app/main.cpp`): Ensure `propPlacer.populate` called on automated `--shot --ride` floor transitions & keyboard floor transitions.
- **Success criteria**: All 25 shapes properly generated, rendered, placed, and floor transitions populated.

## Change Tracker
- **Files modified**: TBD
- **Build status**: Pending Orchestrator Build
- **Pending issues**: None

## Quality Status
- **Build/test result**: Pending Orchestrator
- **Tests added/modified**: TBD

## Loaded Skills
- None
