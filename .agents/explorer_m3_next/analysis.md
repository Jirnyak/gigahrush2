# Milestone 3 (R3) Analysis: Samosbor Phase Banner & Event Log Feed in HUD

## Executive Summary
This analysis details the exact architecture, state mechanisms, data structures, and implementation strategy for Milestone 3 (R3) of the Gigahrush2 C++23 / Vulkan Engine codebase (`C:\hades\gigahrush2`).
The milestone focuses on two core HUD capabilities:
1. **Samosbor Phase Banner Overlay**: Wiring the Samosbor hazard state machine (`SamosborState`, `SamosborBeat`, `SamosborAlarm`) into a prominent, animated top-screen HUD banner overlay in `src/app/main.cpp`.
2. **Combat & Event Bus Log Feed**: Draining the transient `game::EventBus` ring into `game::EventFeed` and rendering a live, fading combat/event log feed in the ImGui overlay in `src/app/main.cpp`.

---

## 1. System Codebase & State Architecture Analysis

### A. Samosbor Hazard State Machine (`src/game/samosbor.h`, `src/game/samosbor.cpp`)
- **State Representation**:
  - `game::SamosborState` is a 16-byte POD containing:
    - `phase` (`SamosborPhase`: `Idle=0`, `Warning=1`, `Active=2`, `Aftermath=3`).
    - `variant` (`SamosborVariant`: `Classic=0`, `Wet=1`, `Electric=2`, `Meat=3`, `Maronary=4`, `Istotit=5`, `Veretar=6`).
    - `phaseMs`, `phaseTotalMs`, `activeMs`: Phase timers and totals.
    - `count`: Samosbors survived in the current run (unlocks monster rosters).
    - `sealed`: One-shot boolean for seal moment resolution.
- **Simulation Step**:
  - Advanced in `src/app/main.cpp` inside the fixed 125 Hz sim step loop via:
    `const game::SamosborTransition tr_ = game::samosbor_step(samosbor, dtMs, currentFloor, sbRng);`
- **Level-Based Alarm Extraction**:
  - `game::samosbor_alarm(const SamosborState& st)` returns a self-contained `game::SamosborAlarm` struct:
    - `on` (`bool`): `true` when a banner beat is active (`Warning`, `Impact`, `Seal`, `Clear`).
    - `text` (`char[160]`): Authored Russian alarm sentence (e.g. `ВНИМАНИЕ! САМОСБОР (ГОСТ-С) ЧЕРЕЗ 28с — НАЙДИТЕ УКРЫТИЕ!`).
    - `pulse` (`float`): 0..1 triangle-wave oscillator for UI color pulsing (1 Hz normally, 4 Hz fast pulse in the last 5s of Warning).
    - `beat` (`SamosborBeat`: `None`, `Warning`, `Impact`, `Seal`, `Clear`).
- **Current Defect / Gap in `src/app/main.cpp`**:
  - Lines 1889–1920 in `src/app/main.cpp` currently output only a basic 2-line inline debug text `ImGui::TextColored(...)` buried inside the main "gigahrush2" debug window.
  - No dedicated top-screen banner overlay is rendered.

### B. Event Bus & Event Feed (`src/game/event_bus.h`, `src/game/event_bus.cpp`)
- **Event Bus Engine (`game::EventBus`)**:
  - Ring buffer of 4096 `Event` POD structures (`NpcDied`, `NpcSpawned`, `NpcMigrated`, `RelationChanged`, `ItemTransferred`, `FloorEntered`).
  - Cleared once per frame in `main.cpp` at line 859 via `bus.clear()`.
- **Event Log Storage (`game::EventFeed`)**:
  - `game::EventFeed` is a built-in 640-byte POD struct in `event_bus.h` holding up to `kLines = 6` lines of `kLineLen = 96` text characters each along with publication `simTick` stamps.
  - Extracted via `game::feed_drain(eventFeed, bus)` which translates transient `Event` records into readable strings (via `event_line`).
  - Read via `game::feed_line(eventFeed, i)` and `game::feed_tick(eventFeed, i)` for $i \in [0, \text{live}-1]$ (newest first).
- **Current Defect / Gap in `src/app/main.cpp`**:
  - `game::EventFeed` is neither instantiated nor drained in `src/app/main.cpp`.
  - All `EventBus` events published during sim steps (e.g. `NpcDied`, `ItemTransferred`, `FloorEntered`) are cleared at line 859 without ever being drained into a log or displayed to the user.

---

## 2. Implementation Strategy & Technical Design

### A. Samosbor Phase Banner Overlay Implementation
1. **Call Site Placement**:
   - Inside `src/app/main.cpp`, right after the main "gigahrush2" debug window render or inside the ImGui frame section.
2. **Alarm Level Resolution**:
   - Query `const game::SamosborAlarm alarm = game::samosbor_alarm(samosbor);` every frame.
3. **ImGui Banner Overlay Window**:
   - Create a dedicated borderless overlay window anchored at top-center (`fbw * 0.5f, 45.0f`):
     ```cpp
     ImGui::SetNextWindowPos(ImVec2(fbw * 0.5f, 45.0f), ImGuiCond_Always, ImVec2(0.5f, 0.0f));
     ImGui::Begin("##SamosborBanner", nullptr,
                  ImGuiWindowFlags_NoDecoration |
                  ImGuiWindowFlags_AlwaysAutoResize |
                  ImGuiWindowFlags_NoSavedSettings |
                  ImGuiWindowFlags_NoFocusOnAppearing |
                  ImGuiWindowFlags_NoNav |
                  ImGuiWindowFlags_NoMove);
     ```
4. **Visual Styling & Color Palette**:
   - Map `alarm.beat` and `alarm.pulse` to distinct background and text colors:
     - **Warning (`SamosborBeat::Warning`)**: Pulsing Warning Red/Amber (`ImVec4(0.85f * alarm.pulse + 0.15f, 0.15f, 0.05f, 0.85f)`). Text: High contrast Gold/White.
     - **Impact (`SamosborBeat::Impact`)**: Solid Crimson/Red (`ImVec4(0.75f, 0.05f, 0.05f, 0.90f)`).
     - **Seal (`SamosborBeat::Seal`)**: Pulsing Magenta/Violet (`ImVec4(0.60f, 0.10f, 0.60f, 0.90f)`).
     - **Clear (`SamosborBeat::Clear`)**: Calming Emerald/Cyan (`ImVec4(0.10f, 0.50f, 0.40f, 0.80f)`).
   - Display `alarm.text` prominently in center alignment.
   - Include phase progress bar / timing subtitle when active or warning:
     `game::samosbor_phase01(samosbor)` progress bar.

### B. Combat & Event Bus Log Feed Implementation
1. **Instantiation**:
   - Declare `game::EventFeed eventFeed{};` alongside `game::EventBus bus;` in `src/app/main.cpp`.
2. **Drain Integration**:
   - In `main.cpp`, invoke `game::feed_drain(eventFeed, bus);` immediately after `relations_drain_deaths` (line 858) and immediately before `bus.clear()` (line 859).
   - *Crucial Ordering Constraint*: Calling `feed_drain` right before `bus.clear()` ensures that events generated during death finalization or relation drain within the frame's sim steps are captured before clearing.
3. **ImGui Log Feed Overlay Window**:
   - Create a dedicated log feed window in the lower-left overlay space (`ImVec2(15.0f, fbh - 170.0f)`):
     ```cpp
     ImGui::SetNextWindowPos(ImVec2(15.0f, static_cast<float>(fbh) - 170.0f), ImGuiCond_FirstUseEver);
     ImGui::Begin("Combat & Event Log", nullptr, ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoCollapse);
     ```
   - Iterate lines $i = 0 \dots \text{eventFeed.live} - 1$:
     - Retrieve line text `const char* lineStr = game::feed_line(eventFeed, i);`
     - Retrieve line tick `std::uint64_t lineTick = game::feed_tick(eventFeed, i);`
     - Calculate age `std::uint64_t ageTicks = simTick - lineTick;`
     - Compute alpha fade over time (e.g. 100% opacity for 250 ticks / 2s, fading to 30% over 1000 ticks / 8s).
     - Format and color code event types (e.g. Combat/Kills in Red, Items in Amber, Migration/Floor in Cyan/Green).

---

## 3. Verification Plan

1. **Build Verification**:
   - Execute `tools\win\build.bat Release` to ensure zero compilation errors or C4189/W4 warnings.
2. **CTest Verification**:
   - Execute `ctest --output-on-failure -C Release` across all test targets (including `test_samosbor`, `test_samosbor2`, and `test_samosborhud`).
3. **Source Rules Compliance**:
   - Run `cmake -DGIGA_ROOT=C:/hades/gigahrush2 -P tools/check_source_rules.cmake` to verify pass status.
4. **Visual Proof Capture**:
   - Run `build-win\Release\giga_game.exe --shot samosbor_hud_proof.png --frames 120` to render swapchain frame output and verify HUD banner rendering.
