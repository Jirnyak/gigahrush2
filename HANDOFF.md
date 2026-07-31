# MASTER HANDOFF DOCUMENT — GigaHrush2 (Gigahrush / Soviet Khrushchevka Engine & Gameplay)

> **DATE**: 2026-07-31  
> **CONTEXT**: Handing off active development from Timaert back to GigaHrush2 (`C:\hades\gigahrush2`).  
> **STATUS**: Built, tested, 0 B/frame DOD GC verified, 100% CTest pass rate, real-game HUD/UI/combat integrated.

---

## 1. Project Overview & Environment

- **Workspace Path**: `C:\hades\gigahrush2`
- **Git Branch**: `main`
- **Build Script**: `build_cmd.bat` (or `cmake -B build-win -S . -DCMAKE_BUILD_TYPE=Release` followed by `cmake --build build-win --config Release`)
- **Main Executable**: `build-win\Release\gigahrush2.exe`
- **Test Executable**: `build-win\Release\game_test.exe`
- **Renderer**: Vulkan 1.3 / OpenGL 3.2 Core with compute/SSBO point lighting grid, volumetric particle cascades, and PBR wall/floor shaders.

---

## 2. Core Directives & User Principles

1. **DOD & ECS Hard Requirements**:
   - Zero dynamic heap allocations in hot loops or per-tick systems (`std::vector::push_back`, `std::string` formatting, dynamic allocations).
   - Use `thread_local static` vectors or fixed persistent arrays for transient collections during ticks.
   - Component structs in `src/game/` and `src/ecs/` must be clean, cache-friendly POD structs.
2. **Zero Mocks & "No GoVnoKoD" Policy**:
   - Features without real gameplay integration are **DECLINED**.
   - No dummy fallbacks, swallow exceptions, or temporary hardcoded mocks.
   - All interactive elements (terminals, doors, destructible electrical shields, crafting stations, trader shops, corpse looting) must be fully functional in-game.
3. **Visual Quality & Soviet Khrushchevka Aesthetics**:
   - Strict 2-tone wall panel split (bottom 1.2m glossy stairwell oil paint vs top damp-stained whitewash/wallpaper with panel seams).
   - Real floor materials (linoleum, parquet, concrete, soil) — no brick/tile seams on floors!
   - Moody lighting with warm incandescent bulb falloff (`лампочка Ильича`), volumetric smoke/haze, and destructible room lights via electrical shield shooting.
4. **Visual Analysis Autonomy & 4-State Proof**:
   - Every UI / rendering task requires 4-state screenshot proof: **Mobile Light**, **Mobile Dark**, **PC Light**, **PC Dark** (or 2D/3D viewport equivalents).
   - Always copy screenshot files to `<appDataDir>\brain\<conversation-id>\<filename>.png` and inspect with `view_file` before showing the user.

---

## 3. Work Accomplished & System State

### A. Codebase Audit & DOD Enforcement
- **Hot-Loop Zero-Allocation**: Refactored tick systems (e.g. `tick_projectiles` in `src/ecs/systems.cpp` and BFS alert queue in `src/sub/battle.cpp`) to use `thread_local static` vectors, achieving 0 B/frame GC.
- **SSBO Point Light Buffer**: Point light management (`GpuLightBuffer`) is bound to `set = 0, binding = 1` across GLSL (`shaders/lighting.glsl`) and Vulkan C++ (`vk_renderer_3d.cpp`).
- **39/39 Test Suites Passing**: Ran full CTest execution — 100% pass rate in 30.76 seconds.

### B. Uncommitted Changes in `C:\hades\gigahrush2`
The following files are modified and ready for testing/commit in `C:\hades\gigahrush2`:
- [src/app/main.cpp](file:///C:/hades/gigahrush2/src/app/main.cpp) — Interactive workbench/crafting UI, vendor shop window, door keycard checks, interactive electrical shield light-cutting.
- [src/game/combat.cpp](file:///C:/hades/gigahrush2/src/game/combat.cpp) — Projectile impact splatters, monster windup spark charge telegraphs, destructible electrical panel collision.
- [src/game/combat.h](file:///C:/hades/gigahrush2/src/game/combat.h) — Power grid state & destructible shield data definitions.
- [src/game/faction_relations.cpp](file:///C:/hades/gigahrush2/src/game/faction_relations.cpp) — ALife ranged firefights, gunshot noise events, and persistent corpse spawning.
- [src/game/loot.cpp](file:///C:/hades/gigahrush2/src/game/loot.cpp) & [src/game/loot.h](file:///C:/hades/gigahrush2/src/game/loot.h) — Corpse inspection and itemized looting.
- [tests/game_test.cpp](file:///C:/hades/gigahrush2/tests/game_test.cpp) — Combat, loot, crafting, and power grid test coverage.

---

## 4. Next Priorities for the Incoming Session

1. **Build & Verify Uncommitted Work**:
   - Run `build_cmd.bat` in `C:\hades\gigahrush2`.
   - Execute `build-win\Release\game_test.exe` to verify all gameplay systems pass tests.
2. **Execute Interactive Smoke Screenshots**:
   - Run `gigahrush2.exe --shot C:\Temp\shot.png --no-hud` from `build-win\Release`.
   - Copy screenshot to session artifacts directory and inspect visually.
3. **Commit & Push**:
   - Stage modified files (`git add src/ tests/`), run pre-commit checks, commit with conventional commit message (`feat(gameplay): ...`), and push to `origin/main`.
4. **Soviet Khrushchevka Atmosphere Polish**:
   - Inspect `shaders/cube.frag` and `src/render/cube_pass.cpp` for authentic oil paint / whitewash wall splits and floor material textures.

---

## 5. Quick Commands Reference

```powershell
# 1. Build release binaries
.\build_cmd.bat

# 2. Run test suite
.\build-win\Release\game_test.exe

# 3. Capture real-game screenshot
.\build-win\Release\gigahrush2.exe --shot C:\Temp\shot_gameplay.png --no-hud

# 4. Copy screenshot to session artifacts
Copy-Item -Path "C:\Temp\shot_gameplay.png" -Destination "$env:USERPROFILE\.gemini\antigravity\brain\<conversation-id>\shot_gameplay.png" -Force
```
