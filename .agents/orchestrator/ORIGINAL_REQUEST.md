# Original User Request

## Follow-up — 2026-07-30T01:59:02Z

# Teamwork Project Prompt — Gigahrush2 Engine Next Phase

Gigahrush2 C++23/Vulkan Engine systematic port, optimization, and feature expansion from original WebGL TypeScript codebase (`C:\hades\gigahrush`).

Working directory: `C:\hades\gigahrush2`
Backlog Guide: `file:///C:/Users/Admin/.gemini/antigravity/brain/5fdea2d8-75a6-417d-9242-a0c9b1503e97/BACKLOG_GUIDE.md`

## Current Status
- `main` HEAD = `7955a90`
- Audit test (`audit_test: 62 checks, 0 failures`), Quest flow, Utility AI (`aiCfg.enabled = true`), Status system, and Vulkan HUD metrics are implemented and verified.

## Requirements

### R1. Procedural Surface Material & Normal Noise Deepening
Enhance procedural shader surface rendering (`shaders/cube.frag` and `tools/gen_material_surface.py`) to add per-material chroma variation and derivative normal perturbing, avoiding flat monochrome cells while respecting the zero-warning and performance budget.

### R2. MacroSim Bench Registration & Headless 2^20 Benchmark
Unpark `tools/branch_port_pending/macro_bench.cpp`, register as `sim_bench` target in `CMakeLists.txt`, and measure per-step macro cost at full 2^20 pool scale (~1M records).

### R3. Samosbor Phase Banner & Event Log Feed in HUD
Wire Samosbor phase transitions (Warning/Active/Seal) into an active screen banner and add the combat/event bus log feed to the ImGui overlay in `src/app/main.cpp`.

## Acceptance Criteria
- [ ] `cmake -DGIGA_ROOT=C:/hades/gigahrush2 -P tools/check_source_rules.cmake` passes.
- [ ] `tools\win\build.bat Release` builds clean and all 4 CTest targets pass 100%.
- [ ] Clean git commit & push to `origin main`.
