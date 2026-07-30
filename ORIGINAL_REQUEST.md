# Original User Request

## Initial Request — 2026-07-30T08:57:41Z

# Teamwork Project Prompt — GigaHrush2 Engine & Content Expansion

GigaHrush2: High-performance Vulkan / C++23 engine expansion featuring GPU Compute volumetric light grid, GPU voxel destruction & particle debris cascade, procedural wire clutter & interactive props, and GPU Multi-Draw Indirect (MDI) frustum & occlusion culling.

Working directory: `C:\hades\gigahrush2`
Integrity mode: development

## Requirements

### R1. GPU Compute Volumetric Light Grid & Fog
Implement a GPU compute pass (`shaders/light_grid.comp` / `src/render/gpu_light_grid.h/.cpp`) that updates a 3D light grid SSBO for local point/emissive lights (flickering lamps, emissive crystals, alarms). Raymarch light attenuation & fog density in `cube.frag`, `prop.frag`, and `particle.frag`.

### R2. GPU Voxel Destruction & Debris Particle Cascade
When a voxel cell/submask is destroyed or carved, trigger a GPU compute event that pushes debris particles directly into the `GpuParticlePass` ring buffer with realistic physical velocities and material-derived albedos (concrete dust, rust flakes, glass shards).

### R3. Procedural Wire Clutter & Soviet Cyberpunk Interactive Props
Expand `PropShape` and `EnvDetail` with procedural wire catenary curves (GPU ribbon meshes between walls), CRT monitors with animated noise shaders, working elevator switches, and illuminated warning signs.

### R4. GPU Multi-Draw Indirect (MDI) & Frustum Culling
Implement a compute culling pass (`shaders/cull.comp` / `src/render/gpu_cull_pass.h/.cpp`) that tests prop bounds against the view frustum and Hi-Z depth buffer, populating indirect draw command buffers for 0-CPU-overhead rendering.

## Acceptance Criteria

### Verification & Quality Bar
- [ ] Shader compilation succeeds with `glslc` without errors or warnings.
- [ ] C++23 codebase compiles cleanly under MSVC without warnings (`-W4 /permissive-`).
- [ ] Executable `gigahrush2.exe` builds and links successfully.
- [ ] No heap allocations or RTTI/exceptions on hot frame render loops (0B GC mandate).
- [ ] Particle and prop passes seamlessly integrate with the existing Vulkan device management (`VulkanDevice`).
