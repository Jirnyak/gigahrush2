## 2026-07-30T01:26:49Z
<USER_REQUEST>
You are a Worker agent implementing Milestone 2 (R2: Atmospheric Height-Based Fog & Light Scattering).
Your working directory is: C:\hades\gigahrush2\.agents\worker_m2_revival

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Single-Compiler Owner Rule: Strictly respect the Single-Compiler Owner Rule. Execute builds sequentially. Do NOT launch concurrent compiler/ctest instances.

Task Details:
1. Read Explorer M2 handoff report at `C:\hades\gigahrush2\.agents\explorer_m2_1\handoff.md`.
2. Enhance distance fog in `shaders/cube.frag`:
   - Calculate height-based fog density using world-space position `vWorldPos.y` (exponential density increase at lower y / subterranean floor levels).
   - Add headlamp forward light scattering based on camera view direction vector, light/headlamp direction vector, and Henyey-Greenstein / Mie forward scattering phase function.
3. Compile SPIR-V shaders (`glslc -O shaders/cube.frag -o shaders/cube.frag.spv` & `glslc -O -DGIGA_ALBEDO_ARRAY shaders/cube.frag -o shaders/cube_tex.frag.spv`).
4. Run `tools\win\build.bat Release` and `ctest --test-dir build-win -C Release` to verify cleanly passing build and 100% test pass across all 4 targets.
5. Write complete handoff report to `C:\hades\gigahrush2\.agents\worker_m2_revival\handoff.md`.
6. Send a message to parent when finished.
</USER_REQUEST>
