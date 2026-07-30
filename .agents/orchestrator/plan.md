# Project Plan: Gigahrush2 Engine Next Phase

## Architecture Overview
C++23 / Vulkan Engine ported from WebGL TypeScript codebase (`C:\hades\gigahrush`).
Next Phase focus: Procedural shader surface rendering & derivative normal noise deepening, MacroSim bench target registration & 2^20 benchmark execution, and Samosbor phase banner & event log feed HUD integration.

## Milestones

| # | Milestone Name | Scope | Dependencies | Status |
|---|----------------|-------|--------------|--------|
| 1 | Procedural Surface Material & Normal Noise Deepening | Enhance `shaders/cube.frag` & `tools/gen_material_surface.py` with per-material chroma variation and derivative normal perturbing | None | PLANNED |
| 2 | MacroSim Bench Registration & Headless 2^20 Benchmark | Unpark `tools/branch_port_pending/macro_bench.cpp`, register `sim_bench` target in `CMakeLists.txt`, measure per-step macro cost at 2^20 scale (~1M records) | None | PLANNED |
| 3 | Samosbor Phase Banner & Event Log Feed in HUD | Wire Samosbor phase transitions (Warning/Active/Seal) into screen banner and combat/event bus log feed into ImGui overlay in `src/app/main.cpp` | None | PLANNED |
| 4 | Source Rules, Full Build, CTest Pass, Forensic Audit & Git Push | Run `check_source_rules.cmake`, build Release cleanly, verify 100% pass across 4 CTest targets, run Forensic Audit, clean git commit & push to `origin main` | M1, M2, M3 | PLANNED |

## Detailed Milestone Descriptions

### Milestone 1: Procedural Surface Material & Normal Noise Deepening (R1)
- Enhance procedural shader surface rendering in `shaders/cube.frag` and `tools/gen_material_surface.py`.
- Add per-material chroma variation and derivative normal perturbing to avoid flat monochrome cells.
- Respect zero-warning and performance budget.

### Milestone 2: MacroSim Bench Registration & Headless 2^20 Benchmark (R2)
- Unpark `tools/branch_port_pending/macro_bench.cpp`.
- Register `sim_bench` target in `CMakeLists.txt`.
- Build and run `sim_bench` to measure per-step macro cost at full 2^20 pool scale (~1M records).

### Milestone 3: Samosbor Phase Banner & Event Log Feed in HUD (R3)
- Wire Samosbor phase transitions (Warning/Active/Seal) into an active screen banner in `src/app/main.cpp`.
- Add combat/event bus log feed to the ImGui overlay in `src/app/main.cpp`.

### Milestone 4: Source Rules, Full Build, CTest Pass, Forensic Audit & Git Push
- Verify `cmake -DGIGA_ROOT=C:/hades/gigahrush2 -P tools/check_source_rules.cmake` returns PASS.
- Verify `tools\win\build.bat Release` builds cleanly.
- Verify all 4 CTest targets pass 100%.
- Perform Forensic Auditor integrity check (must be CLEAN).
- Clean git commit & push to `origin main`.

## Acceptance Criteria
1. `cmake -DGIGA_ROOT=C:/hades/gigahrush2 -P tools/check_source_rules.cmake` passes.
2. `tools\win\build.bat Release` builds clean and all 4 CTest targets pass 100%.
3. Clean git commit & push to `origin main`.
