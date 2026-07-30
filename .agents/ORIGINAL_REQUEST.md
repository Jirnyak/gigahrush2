# Original User Request

## 2026-07-30T02:26:26Z

# Teamwork Project Prompt — Gigahrush2 Subagent Orchestration Wave

Gigahrush2 C++23/Vulkan Engine systematic port, optimization, and feature expansion from original WebGL TypeScript codebase (`C:\hades\gigahrush`).

Working directory: `C:\hades\gigahrush2`
Backlog Guide: `file:///C:/Users/Admin/.gemini/antigravity/brain/5fdea2d8-75a6-417d-9242-a0c9b1503e97/BACKLOG_GUIDE.md`

## Current Status
- `main` HEAD = `8e29244`
- Mob behaviour dispatchers for burst speed (`burst_speed_mult`), hurt move mult (`behaviour_hurt_move_mult`), damage mult (`behaviour_damage_mult`), and melee reach (`behaviour_melee_reach`) are wired and verified!

## Requirements

### R1. Complete Remaining MobBehaviour Dispatchers & Test Coverage
Wire `behaviour_incoming_mult` for defender mitigation in `apply_damage` (`src/game/combat.cpp`), `facing_damage_mult`, and `burst_damage_mult`. Update `tests/suite_behaviours.inl` with explicit assertions for each behavior effect.

### R2. GPU Texture Sampling Pipeline Wire-up
Integrate the 6 supercompressed UASTC+zstd KTX2 maps from `data/textures/` into Vulkan material descriptors in `src/render/cube_pass.cpp` and `shaders/cube.frag`.

### R3. System Verification & CTest Gate
Ensure `tools\win\build.bat Release` and `ctest --test-dir build-win -C Release` pass 100% green across all 4 test targets (`world_test`, `audit_test`, `game_test`, `source_rules`).

## Acceptance Criteria
- [ ] `tools\win\build.bat Release` builds cleanly without warnings or errors.
- [ ] `ctest` passes 100% across all 4 test targets.
- [ ] Changes committed and pushed to `origin main`.

## Follow-up — 2026-07-29T23:36:12Z

SERVER RESTART RECOVERY. Wake up, resume your task, and report findings immediately. We need to fix the game_test.exe segfault and finish the behaviour dispatchers.

## Follow-up — 2026-07-30T03:58:48Z

# Teamwork Project Prompt — Gigahrush2 Subagent Orchestration Wave (Revival)

Gigahrush2 C++23/Vulkan Engine systematic port, optimization, and feature expansion from original WebGL TypeScript codebase (`C:\hades\gigahrush`).

Working directory: `C:\hades\gigahrush2`
Backlog Guide: `file:///C:/Users/Admin/.gemini/antigravity/brain/5fdea2d8-75a6-417d-9242-a0c9b1503e97/BACKLOG_GUIDE.md`

## Current Status
- SERVER RESTART HAPPENED. PREVIOUS ORCHESTRATOR WAS KILLED. You must resume the swarm!
- `main` HEAD = `8e29244`
- Mob behaviour dispatchers for burst speed (`burst_speed_mult`), hurt move mult (`behaviour_hurt_move_mult`), damage mult (`behaviour_damage_mult`), and melee reach (`behaviour_melee_reach`) are wired and verified!
- `worker_m1_3` left uncommitted changes in `src/game/combat.h`, `src/render/cube_pass.cpp`, `src/world/materials.h`, `tests/game_test.cpp`, `tests/suite_audit.inl`, `tests/suite_monster.inl`. Resume from there!

## Requirements

### R1. Complete Remaining MobBehaviour Dispatchers & Test Coverage
Wire `behaviour_incoming_mult` for defender mitigation in `apply_damage` (`src/game/combat.cpp`), `facing_damage_mult`, and `burst_damage_mult`. Update `tests/suite_behaviours.inl` with explicit assertions for each behavior effect.

### R2. GPU Texture Sampling Pipeline Wire-up
Integrate the 6 supercompressed UASTC+zstd KTX2 maps from `data/textures/` into Vulkan material descriptors in `src/render/cube_pass.cpp` and `shaders/cube.frag`.

### R3. System Verification & CTest Gate
Ensure `tools\win\build.bat Release` and `ctest --test-dir build-win -C Release` pass 100% green across all 4 test targets (`world_test`, `audit_test`, `game_test`, `source_rules`).

## Acceptance Criteria
- [ ] `tools\win\build.bat Release` builds cleanly without warnings or errors.
- [ ] `ctest` passes 100% across all 4 test targets.
- [ ] Changes committed and pushed to `origin main`.

## Follow-up — 2026-07-30T05:32:43Z

# Teamwork Project Prompt — Detailed Subagent Charter & Execution Mandate

Gigahrush2 C++23/Vulkan Engine systematic port, graphics enhancement, and feature expansion from the original WebGL TypeScript codebase (`C:\hades\gigahrush`).

Working directory: `C:\hades\gigahrush2`
Integrity mode: development

---

## ⛔ CONCURRENCY & COMPILATION CONSTRAINTS (BINDING ON ALL AGENTS AND CHILD SUBAGENTS)

1. **SINGLE-COMPILER OWNER RULE**:
   - **NO PARALLEL COMPILATION**: Subagents and their child subagents MUST NOT execute `tools\win\build.bat`, `cmake --build`, `ninja`, `cl.exe`, or `ctest` in parallel with any other agent.
   - **NO PROCESS SPAM**: Do NOT spawn subagent fleets that launch concurrent compiler or test executable processes (`game_test.exe`, `world_test.exe`).
   - **DELEGATED BUILD VERIFICATION**: Subagents execute code analysis, AST search, refactoring, and file edits. The Build Owner or Main Agent executes builds and test runs strictly **sequentially** in a single process.

2. **GIT & BRANCH DISCIPLINE**:
   - All work lands directly in `main` branch.
   - Keep the workspace clean: do not commit temporary text files (`check_count.txt`, `crash_log.txt`, `*.log`, `*_out.txt`).
   - Frequently sync with `git pull --rebase origin main` and push verified commits with `git push origin main`.

3. **CODE QUALITY & NO MOCKS POLICY**:
   - Zero tolerance for placeholders, empty stubs, mock fallbacks, or `// TODO` statements inside production logic.
   - All C++ code must compile clean without MSVC compiler warnings or errors (`/W4 /EHsc`).

---

## 🎨 GRAPHICS & RENDERING DIRECTIVES (NEXT-GEN VULKAN VISUALS)

1. **HIGH-END SURFACE SHADING & MATERIALS**:
   - **PBR Specular & Gloss**: `shaders/cube.frag` must provide Blinn-Phong specular highlights (`NdotH`) and micro-roughness modulation for metallic, industrial, and wet materials (`kMatDoor`, `kMatShopShutter`, `kMatTread`, `kMatElectricGrate`, `kMatAcidPool`).
   - **Derivative Normal Perturbing**: Procedural surface families (`surface_height` / `compute_grad_uv`) must perturb geometric normals to create real micro-surface relief without extra VRAM cost.
   - **Triplanar World-Space UVs**: Triplanar UV projection on 2 m cell bounds ensures continuous, seamless texture sampling across walls, floors, and ceilings.
   - **KTX2 Texture Sampling**: `src/render/cube_pass.cpp` binds 2K UASTC+zstd supercompressed KTX2 maps from `data/textures/` into Vulkan material descriptors (`uAlbedo`).

2. **ATMOSPHERIC LIGHTING & FOG**:
   - Camera headlamp light cone with inverse-square quadratic falloff `1 / (1 + d^2/r^2)`.
   - Distance fog to black in linear space before sRGB encoding to swallow the toroidal wrap seam seamlessly.

---

## 🎮 GAMEPLAY & ENGINE FEATURE REQUIREMENTS

### R1. Samosbor Status Banner & Event Log Feed in HUD
- Wire `samosbor_alarm` / `samosbor_beat_text` into the ImGui overlay in `src/app/main.cpp` to render active Samosbor phase transitions (Warning/Active/Seal) with animated pulse text.
- Wire `game::EventFeed` (`feed_drain`) to display live combat and world event logs in the HUD overlay.

### R2. Utility AI & Monster Systems Porting
- Keep `aiCfg.enabled = true` in `src/app/main.cpp` after `ai_init` populates `AiBrain`.
- Complete mob behaviour dispatchers (`behaviour_incoming_mult`, `facing_damage_mult`, `burst_damage_mult`) in `src/game/combat.cpp` and maintain 100% test assertion coverage in `tests/suite_behaviours.inl`.

### R3. MacroSim 2^20 Benchmark Target Registration
- Register `tools/branch_port_pending/macro_bench.cpp` as `macro_bench` target in `CMakeLists.txt`.
- Verify per-step MacroSim performance at full scale.

### R4. System Verification & CTest Gate
- Ensure `tools\win\build.bat Release` compiles clean (0 warnings, 0 errors).
- All 4 CTest targets (`world_test`, `audit_test`, `game_test`, `source_rules`) must pass 100% green. Update regex pins in `CMakeLists.txt` when check counts increase due to added test assertions.

---

## Acceptance Criteria

- [ ] `cmake -DGIGA_ROOT=C:/hades/gigahrush2 -P tools/check_source_rules.cmake` returns `GIGA_SOURCE_RULES=PASS`.
- [ ] `tools\win\build.bat Release` builds cleanly without warnings or errors.
- [ ] `ctest` passes 100% across all 4 test targets.
- [ ] Clean git commit & push to `origin main`.



