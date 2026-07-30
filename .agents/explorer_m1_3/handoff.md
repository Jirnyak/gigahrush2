# Milestone 1 (R1: Volumetric Light Grid Light Source Extraction & GPU Upload) — Handoff Report

**Agent ID:** `explorer_m1_3`  
**Working Directory:** `C:\hades\gigahrush2\.agents\explorer_m1_3`  
**Date:** 2026-07-30  
**Handoff Type:** Hard  

---

## 1. Observation

### Codebase Inspection & Light Data Sources Examined
1. **Procedural Prop Light Emitters (`src/render/prop_placer.cpp`, `src/render/env_detail.cpp`, `src/render/prop_pass.h`)**:
   - `PropInstance` (32 B struct in `src/render/prop_mesh.h:32-41`) contains `vec3 origin`, `float yaw`, `vec3 color`, `uint8_t matId`, `uint8_t emissive` (0..255 intensity scale), `uint8_t flags` (bit 2 `0x04` = glow pulse bit), and `uint8_t animPhase` (flicker phase seed).
   - `PropPlacer::populate()` and `EnvDetail::populate()` generate light-emitting prop shapes:
     - `PropShape::FloodLamp`: Emissive 180..240, Warm Lamp (`{1.00f, 0.90f, 0.72f}`) or Cool Lamp (`{0.75f, 0.88f, 1.00f}`), height $y = 1.70\text{ m}$ above floor. Electrical arc flicker.
     - `PropShape::CrystalCluster`: Emissive 200..220, Violet (`{0.70f, 0.15f, 0.95f}`), Green (`{0.25f, 0.95f, 0.45f}`), Magenta (`{0.90f, 0.10f, 1.00f}`). Glow pulse bit `0x04` enabled.
     - `PropShape::AcidPool`: Emissive 140..180, Acid Green (`{0.15f, 0.85f, 0.25f}`).
     - `PropShape::FungalColumn`: Emissive 60..160, Bio-green (`{0.40f, 0.75f, 0.30f}`).
     - `PropShape::SecurityCamera`: Emissive 18..120 lens indicator LED.
     - `PropShape::Grate` (on `kMatElectricGrate`): Emissive 140, Cyan (`{0.30f, 0.65f, 0.95f}`).
2. **Player Flashlight / Headlamp (`src/app/main.cpp:106-107`, `src/app/main.cpp:2179-2187`)**:
   - Constants defined in `main.cpp`: `kLampIntensity = 2.2f` (passed in `push.camPos.w`) and `kLampRadius = 14.0f` meters (passed in `push.fog.z`).
   - Attached to camera eye position `camMat.eye` (entity with `CameraTag` & `Transform`).
3. **Samosbor Hazard Alarm Lights (`src/game/samosbor.h`, `src/game/samosbor.cpp`)**:
   - `game::SamosborState` (`phase`, `variant`, `phaseMs`, `sealed`) drives level-wide hazard weather.
   - `samosbor_alarm(st)` outputs `SamosborAlarm` with pulse $P \in [0, 1]$ (1 Hz pulse, 4 Hz fast warning pulse).
   - 7 Samosbor Variants emit distinct color signatures: Classic (Purple), Wet (Deep Cyan), Electric (Magenta/Cyan), Meat (Crimson Red), Maronary (Amber Orange), Istotit (Golden White), Veretar (Pale White).
4. **Mob Emitters (`src/game/mob_table.h`, `src/game/mob_behaviour.h`)**:
   - `MobKind::Lampovy` (`MobBehaviour::LampPowered`): Monster carrying a power lamp emitting warm yellow light.
   - `MobKind::Lampoglaz` (`MobBehaviour::LightLock`): Monster holding a lit searchlight beam.

---

## 2. Logic Chain

1. **Memory Allocation & 0B GC Requirement**:
   - Premise: Per-frame light extraction must strictly enforce zero heap allocations, zero RTTI, and zero exceptions on frame tick.
   - Deduction: Dynamic collections (`std::vector::push_back` beyond capacity, `std::make_shared`, `new`) are forbidden.
   - Design: Pre-allocate persistent Vulkan host-visible buffers (`instBufs_[frameIndex]`) for $256$ lights ($256 \times 32\text{ B} = 8192\text{ B}$ per frame). Extract light data directly into mapped CPU memory `buf.mapped` or fixed static arrays.

2. **Toroidal Distance Culling**:
   - Premise: *Gigahrush2* uses a $64\text{ m}$ toroidal world period (`push.torus.x`).
   - Deduction: Light extraction must calculate minimum toroidal distance $d_{\text{torus}} = \text{wrap}(p_{\text{light}} - p_{\text{cam}}, 64)$ to cull lights beyond fog/light influence range ($48\text{ m}$) prior to uploading to GPU.

3. **Data Format Alignment**:
   - Premise: Vulkan std430 SSBO buffers require 16-byte alignment for `vec4` structures.
   - Deduction: Struct `GpuPointLight` is defined as:
     ```cpp
     struct GpuPointLight {
         vec4 posRadius; // xyz = world pos (m), w = radius (m)
         vec4 colorEm;   // rgb = color (0..1), w = effective intensity scale
     };
     ```
     `sizeof(GpuPointLight) == 32` bytes, aligned to 16 bytes.

4. **Integration Point in Render Loop**:
   - Premise: Compute shader `shaders/light_grid.comp` builds a 3D light grid SSBO that must be read by fragment shaders during `cubePass`, `bodyPass`, and `propPass`.
   - Deduction: `GpuLightGrid::update_and_dispatch()` must be called in `main.cpp` **BEFORE** `cubePass.record()`, `bodyPass.record()`, and `propPass.record()`, with a compute-to-fragment memory barrier (`VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT` $\to$ `VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT`).

---

## 3. Caveats

- **Read-Only Scope**: This report presents an architectural investigation and blueprint. No changes were committed to `src/` source files.
- **Max Light Cap**: Hard cap of $256$ local light sources per frame is sufficient for dense levels. If prop count exceeds 256 within the 48 m toroidal radius, lights are prioritized by proximity to the player.
- **Mob Emitters**: Mob positions require querying `giga::Registry` for `Transform` components of active `Lampovy` and `Lampoglaz` entities each tick.

---

## 4. Conclusion

1. **Light Sources Identified**: All light sources across simulation, world, props, player, and Samosbor hazard systems have been cataloged with exact struct layouts, file paths, line numbers, and animation parameters.
2. **0B GC Extraction Path**: A zero-allocation extraction pipeline using persistent mapped Vulkan buffers (`VulkanBuffer::create_host_visible`) and toroidal distance culling is fully specified.
3. **Render Loop Integration**: The call sequence for `GpuLightGrid::update_and_dispatch()` in `src/app/main.cpp` prior to geometry rendering passes is established.

Full technical details and C++ extraction code blueprints are documented in `analysis.md`.

---

## 5. Verification Method

To independently verify these findings and execute implementation:
1. **Inspect Detailed Analysis**: Read `C:\hades\gigahrush2\.agents\explorer_m1_3\analysis.md`.
2. **Check Prop Light Emitters**:
   - Inspect `src/render/prop_placer.cpp:190-241` for lamp, crystal, acid, fungal prop instantiation.
   - Inspect `src/render/env_detail.cpp:282-351` for biome emissive prop parameters.
3. **Check Flashlight & Samosbor Hazard Clock**:
   - Inspect `src/app/main.cpp:106-107, 2179-2187` for player headlamp push constant packaging.
   - Inspect `src/game/samosbor.h:424-434, 708-720` for Samosbor alarm pulse and variant definitions.
