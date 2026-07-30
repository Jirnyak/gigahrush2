## 2026-07-30T02:14:31Z
<USER_REQUEST>
Implement Milestone 1 (R1): Procedural Surface Material & Normal Noise Deepening for Gigahrush2 C++23/Vulkan Engine.

Working directory: C:\hades\gigahrush2
Scope document: C:\hades\gigahrush2\.agents\orchestrator\plan.md
Explorer handoff report: C:\hades\gigahrush2\.agents\explorer_m1_next\handoff.md
Explorer analysis report: C:\hades\gigahrush2\.agents\explorer_m1_next\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Task Details:
1. Update `tools/gen_material_surface.py` to add per-material `chroma_sigma`, `chroma_axis`, and `bump_scale` parameters.
2. Run `tools/gen_material_surface.py` (via `python tools/gen_material_surface.py` or python invocation) to regenerate `shaders/material_surface.glsl`.
3. Update `shaders/cube.frag` to compute mean-preserving lognormal vector RGB chroma modulation on albedo and derivative normal perturbing on face normal `n` for point/ambient lighting.
4. Verify GLSL shaders compile cleanly with zero warnings (`glslc -O shaders/cube.frag -o shaders/cube.frag.spv` and `glslc -O -DGIGA_ALBEDO_ARRAY shaders/cube.frag -o shaders/cube_tex.frag.spv`).
5. Run `cmake -DGIGA_ROOT=C:/hades/gigahrush2 -P tools/check_source_rules.cmake` and verify `GIGA_SOURCE_RULES=PASS`.
6. Run `tools\win\build.bat Release` and run `ctest` to ensure 100% green pass.
7. Record all changes, build outputs, and test results in your handoff report at `C:\hades\gigahrush2\.agents\worker_m1\handoff.md`.
</USER_REQUEST>
