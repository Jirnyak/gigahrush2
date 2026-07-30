# Volumetric Light Grid Light Source Analysis & GPU Extraction Architecture Report

## 1. Executive Summary & Objective
This report details the investigation of light source data across the simulation, world, ECS, game, and rendering layers of *Gigahrush2* (`C:\hades\gigahrush2\src\`). The goal is to define the light data sources (point lights, flickering lamps, emissive crystals, acid pools, security cameras, mob light emitters, and Samosbor hazard alarms), design a 0B GC frame-tick extraction and packing pipeline, and detail the API & main render loop call sequence for the upcoming `GpuLightGrid` system (`src/render/gpu_light_grid.h/.cpp`).

---

## 2. Inventory of Light Sources in Codebase

### A. Procedural & Static Prop Emitters (`src/render/prop_placer.cpp`, `src/render/env_detail.cpp`, `src/render/prop_pass.h`)
Props placed by `PropPlacer::populate()` and `EnvDetail::populate()` carry `PropInstance` structs (32 B) passed into `PropPass::add_instance()`.
Struct layout (`src/render/prop_mesh.h`):
- `origin`: `vec3` (12 B)
- `yaw`: `float` (4 B)
- `color`: `vec3` (12 B)
- `matId`: `uint8_t` (1 B)
- `emissive`: `uint8_t` (1 B) — 0..255 intensity scale
- `flags`: `uint8_t` (1 B) — bit 2 (`0x04`) indicates glow pulse / animation
- `animPhase`: `uint8_t` (1 B) — per-instance animation phase / flicker seed

Light-Emitting Prop Types:
1. **Flood Lamp (`PropShape::FloodLamp`)**:
   - Location: `src/render/prop_placer.cpp:190-197`, `src/render/env_detail.cpp:282-293`
   - Position: Ceiling mounted (`wy + 1.70m` / `wy + 0.88 * kCellSize`)
   - Emissive: `180` to `240` (high intensity point light)
   - Color: Warm Lamp (`{1.00f, 0.90f, 0.72f}`) or Cool Lamp (`{0.75f, 0.88f, 1.00f}`)
   - Animation: High-frequency stochastic electrical flickering driven by `animPhase` and global time `uTime`.
2. **Crystal Cluster (`PropShape::CrystalCluster`)**:
   - Location: `src/render/prop_placer.cpp:223-231`, `src/render/env_detail.cpp:339-345`
   - Position: Floor level (`wy + 0.01m`)
   - Emissive: `200` to `220` (vibrant bioluminescent crystal light)
   - Color: Purple (`{0.70f, 0.15f, 0.95f}`), Green (`{0.25f, 0.95f, 0.45f}`), Magenta (`{0.90f, 0.10f, 1.00f}`)
   - Flags: `0x04` (Glow pulse bit). Harmonic breathing animation.
3. **Acid Pool (`PropShape::AcidPool`)**:
   - Location: `src/render/prop_placer.cpp:235-237`, `src/render/env_detail.cpp:347-351`
   - Position: Floor disk (`wy + 0.01m`)
   - Emissive: `140` to `180`
   - Color: Acid Green (`{0.15f, 0.85f, 0.25f}`)
   - Animation: Undulating chemical surface glow.
4. **Fungal Column (`PropShape::FungalColumn`)**:
   - Location: `src/render/prop_placer.cpp:238-241`, `src/render/env_detail.cpp:422-427`
   - Position: Wall/ceiling organic cluster
   - Emissive: `60` to `160`
   - Color: Bio-green (`{0.40f, 0.75f, 0.30f}`)
5. **Security Camera LED (`PropShape::SecurityCamera`)**:
   - Location: `src/render/prop_placer.cpp:203-219`, `src/render/env_detail.cpp:403-411`
   - Emissive: `18` to `120` (red/blue lens indicator light)
6. **Terminal & Control Panel (`PropShape::Terminal`, `PropShape::ControlPanel`)**:
   - Location: `src/render/env_detail.cpp:413-420, 431-437`
   - Emissive: `20` to `35` (phosphor screen glow)
7. **Electric Grate (`PropShape::Grate` on `kMatElectricGrate`)**:
   - Location: `src/render/prop_placer.cpp:147-152`
   - Emissive: `140`, Color: Cyan (`{0.30f, 0.65f, 0.95f}`), Flags: `0x04`

### B. Player Headlamp & Flashlight (`src/app/main.cpp`, `src/ecs/components.h`)
- Location: `src/app/main.cpp:106-107`, `src/app/main.cpp:2179-2187`
- Attached to entity carrying `CameraTag` / `Transform` / `Controller`.
- Intensity: `kLampIntensity = 2.2f` (passed in `push.camPos.w`)
- Radius: `kLampRadius = 14.0f` meters (passed in `push.fog.z`)
- Position: Camera eye position `camMat.eye`
- Direction: Forward look vector derived from `CameraTag::yaw` and `CameraTag::pitch`

### C. Samosbor Alarm & Level Hazard Light Emitters (`src/game/samosbor.h`, `src/game/samosbor.cpp`)
- State: `game::SamosborState` (`phase`, `variant`, `phaseMs`, `sealed`)
- Pulsing Alarm: `game::SamosborAlarm` (`samosbor_alarm(st)`) outputs `pulse` in [0, 1] (1 Hz standard pulse, 4 Hz fast pulse in warning tail)
- Variant Light Colors:
  - Classic (0): Purple (`{0.70f, 0.20f, 0.90f}`)
  - Wet (1): Deep Cyan (`{0.10f, 0.60f, 0.90f}`)
  - Electric (2): Flashing Ozone Magenta/Cyan (`{1.00f, 0.10f, 0.80f}`)
  - Meat (3): Crimson Red (`{0.90f, 0.10f, 0.10f}`)
  - Maronary (4): Amber Orange (`{0.95f, 0.50f, 0.10f}`)
  - Istotit (5): Bright Gold/White (`{1.00f, 0.90f, 0.60f}`)
  - Veretar (6): Pale White (`{0.90f, 0.95f, 1.00f}`)
- Dynamic Effect: During `Warning` and `Active` phases, global ambient tint and volumetric fog squeeze down (`samosbor_fog_scale()`), while pulsing siren lights flash overhead.

### D. Mob & Combat Light Emitters (`src/game/mob_table.h`, `src/game/mob_behaviour.h`, `src/game/combat.h`)
- Mobs:
  - `MobKind::Lampovy` (`MobBehaviour::LampPowered`): Monsters carrying power lamps that emit warm yellow light (radius ~6 m).
  - `MobKind::Lampoglaz` (`MobBehaviour::LightLock`): Stationary searchlight shooters emitting directional beam light (radius ~10 m).
  - `MobKind::Lishennyy` (`MobBehaviour::LightFollower`): Attracted to active light sources.
- Muzzle Flashes & Projectiles: Transient point lights spawned during combat ticks.

---

## 3. Light Extraction & Packing Strategy (0B GC Guarantee)

### A. GPU Light Data Structure (`GpuPointLight`)
To ensure optimal alignment for Vulkan std430 SSBO buffers, each light is 32 bytes:
```cpp
struct GpuPointLight {
    vec4 posRadius;  // xyz = world pos (m), w = light radius (m)
    vec4 colorEm;    // rgb = color (0..1 float), w = effective intensity / emissive scale
};
static_assert(sizeof(GpuPointLight) == 32);
static_assert(alignof(GpuPointLight) == 16);
```

### B. Fixed-Capacity Ring/Frame Buffers (Zero Allocation)
- Hard Cap: `constexpr uint32_t kMaxGpuPointLights = 256;`
- Allocation: `GpuLightGrid` owns host-visible persistently mapped buffers:
  `std::array<VulkanBuffer, kMaxFramesInFlight> lightSSBOs_;`
  Memory size per frame: 256 * 32 = 8192 bytes (8 KiB).
- Data extraction uses a static CPU scratch buffer or writes directly to `lightSSBOs_[frameIndex].mapped`.
- **Zero heap allocations** (`malloc`/`new`/`std::vector::resize`), **zero RTTI**, **zero exceptions** on frame tick.

### C. Toroidal Culling & Extraction Algorithm
Because *Gigahrush2* uses a 64 m toroidal world repeat (`push.torus.x`), light extraction culls against the camera position `camPos` using nearest toroidal distance:
```cpp
void GpuLightGrid::extract_lights(
    const vec3& camPos,
    float period,
    const PropPass& propPass,
    const entt::registry& reg,
    const game::SamosborState& samosbor,
    float currentTimeSec,
    GpuPointLight* dstLights,
    uint32_t& outCount)
{
    outCount = 0;
    const float cullRadiusSq = 48.0f * 48.0f; // 48 m max light influence radius

    // 1. Player Headlamp
    dstLights[outCount++] = GpuPointLight{
        vec4{camPos.x, camPos.y, camPos.z, kLampRadius},
        vec4{1.00f, 0.95f, 0.85f, kLampIntensity}
    };

    // 2. Prop Light Emitters (Lamps, Crystals, Pools, Fungi)
    for (int s = 0; s < kPropShapeCount; ++s) {
        PropShape shape = static_cast<PropShape>(s);
        if (shape != PropShape::FloodLamp && shape != PropShape::CrystalCluster &&
            shape != PropShape::AcidPool  && shape != PropShape::FungalColumn &&
            shape != PropShape::SecurityCamera && shape != PropShape::Grate)
            continue;

        const auto& instances = propPass.get_instances(shape);
        for (const auto& inst : instances) {
            if (inst.emissive == 0) continue;

            float dx = inst.origin.x - camPos.x;
            float dy = inst.origin.y - camPos.y;
            float dz = inst.origin.z - camPos.z;
            dx -= period * std::floor(dx / period + 0.5f);
            dy -= period * std::floor(dy / period + 0.5f);
            dz -= period * std::floor(dz / period + 0.5f);
            if (dx*dx + dy*dy + dz*dz > cullRadiusSq) continue;

            // Evaluate animation/flicker
            float intensity = static_cast<float>(inst.emissive) / 255.0f * 4.0f;
            if (shape == PropShape::FloodLamp) {
                float flicker = 1.0f - 0.15f * std::sin(currentTimeSec * 25.0f + inst.animPhase);
                intensity *= flicker;
            } else if (inst.flags & 0x04) { // Glow pulse
                float pulse = 0.85f + 0.30f * std::sin(currentTimeSec * 3.0f + inst.animPhase);
                intensity *= pulse;
            }

            float radius = (shape == PropShape::FloodLamp) ? 8.0f :
                           (shape == PropShape::CrystalCluster) ? 6.0f : 4.0f;

            dstLights[outCount++] = GpuPointLight{
                vec4{inst.origin.x, inst.origin.y, inst.origin.z, radius},
                vec4{inst.color.x, inst.color.y, inst.color.z, intensity}
            };
            if (outCount >= kMaxGpuPointLights - 8) break;
        }
    }

    // 3. Samosbor Alarm Siren Light
    if (samosbor.phase == static_cast<uint8_t>(game::SamosborPhase::Warning) ||
        samosbor.phase == static_cast<uint8_t>(game::SamosborPhase::Active)) {
        game::SamosborAlarm alarm = game::samosbor_alarm(samosbor);
        if (alarm.on) {
            vec3 col = get_samosbor_color(static_cast<game::SamosborVariant>(samosbor.variant));
            dstLights[outCount++] = GpuPointLight{
                vec4{camPos.x, camPos.y + 3.0f, camPos.z, 24.0f}, // Overhead alarm sphere
                vec4{col.x, col.y, col.z, alarm.pulse * 6.0f}
            };
        }
    }
}
```

---

## 4. Main Render Loop Call Sequence (`src/app/main.cpp`)

To integrate `GpuLightGrid` into the main frame loop:
1. **Initialization (`main.cpp:startup`)**:
   ```cpp
   gpu::GpuLightGrid lightGrid{};
   lightGrid.init(&device, &renderer, "shaders/");
   ```
2. **Per-Frame Record (`main.cpp:render_loop`)**:
   ```cpp
   if (renderer.begin_frame(window, 0.0f, 0.0f, 0.0f)) {
       VkCommandBuffer cmd = renderer.current_cmd();
       gpu::CubePush push{};
       // ... populate push constants ...

       // Step A: Extract lights & Dispatch GPU Light Grid Compute Shader
       renderer.timer.pass_begin(cmd, gpu::GpuPass::LightGrid); // New timer pass
       lightGrid.update_and_dispatch(cmd, renderer.currentFrame, push.camPos.xyz(),
                                     propPass, reg, samosbor, currentTimeSec);
       renderer.timer.pass_end(cmd, gpu::GpuPass::LightGrid);

       // Step B: Render Geometry & Raymarch Volumetric Light/Fog
       renderer.timer.pass_begin(cmd, gpu::GpuPass::World);
       cubePass.record(cmd, renderer.currentFrame, stack.layer(activeLayer), push);
       renderer.timer.pass_end(cmd, gpu::GpuPass::World);

       renderer.timer.pass_begin(cmd, gpu::GpuPass::Bodies);
       bodyPass.record(cmd, renderer.currentFrame, reg, activeLayer, push);
       renderer.timer.pass_end(cmd, gpu::GpuPass::Bodies);

       if (propPass.ready())
           propPass.record(cmd, renderer.currentFrame, push);

       renderer.timer.pass_begin(cmd, gpu::GpuPass::Hud);
       hud.render(cmd);
       renderer.timer.pass_end(cmd, gpu::GpuPass::Hud);

       renderer.end_frame(window);
   }
   ```

3. **Teardown (`main.cpp:cleanup`)**:
   ```cpp
   lightGrid.destroy();
   ```
