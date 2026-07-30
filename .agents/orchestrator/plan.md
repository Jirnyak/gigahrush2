# Master Project Plan: GigaHrush2 Engine & Content Expansion

## Architecture Overview
GigaHrush2: High-performance Vulkan / C++23 engine expansion featuring GPU Compute volumetric light grid, GPU voxel destruction & particle debris cascade, procedural wire clutter & interactive props, and GPU Multi-Draw Indirect (MDI) frustum & occlusion culling.

## Milestones

| # | Milestone Name | Scope | Dependencies | Status |
|---|----------------|-------|--------------|--------|
| 1 | R1: GPU Compute Volumetric Light Grid & Fog | `shaders/light_grid.comp`, `src/render/gpu_light_grid.h/.cpp`, raymarching light attenuation & fog in `cube.frag`, `prop.frag`, `particle.frag` | None | PLANNED |
| 2 | R2: GPU Voxel Destruction & Debris Particle Cascade | Trigger GPU compute event on voxel destruction/carving, pushing debris into `GpuParticlePass` ring buffer with physics & albedos | M1 | PLANNED |
| 3 | R3: Procedural Wire Clutter & Soviet Cyberpunk Props | `PropShape` / `EnvDetail` expanded with wire catenary curves (GPU ribbon meshes), CRT monitors with animated noise shaders, elevator switches, warning signs | M1 | PLANNED |
| 4 | R4: GPU Multi-Draw Indirect (MDI) & Frustum Culling | `shaders/cull.comp`, `src/render/gpu_cull_pass.h/.cpp` for frustum & Hi-Z depth buffer occlusion culling, 0-CPU-overhead indirect draw buffers | M1, M3 | PLANNED |
| 5 | R5: Final Verification, Build Clean, 0B GC & Forensic Audit | Full clean MSVC C++23 `-W4 /permissive-` build, glslc shader compilation zero errors/warnings, CTest pass, 0B GC verification, VulkanDevice integration check, and Forensic Audit CLEAN verdict | M1, M2, M3, M4 | PLANNED |

## Detailed Milestone Descriptions

### Milestone 1: GPU Compute Volumetric Light Grid & Fog (R1)
- Implement `shaders/light_grid.comp` to compute/update 3D light grid SSBO for local point/emissive lights.
- Create `src/render/gpu_light_grid.h` and `src/render/gpu_light_grid.cpp` to manage Vulkan resources, buffers, and compute dispatches.
- Implement raymarching light attenuation & volumetric fog density in `cube.frag`, `prop.frag`, and `particle.frag`.

### Milestone 2: GPU Voxel Destruction & Debris Particle Cascade (R2)
- Integrate voxel destruction events with GPU compute dispatch.
- Push debris particles directly into `GpuParticlePass` ring buffer.
- Include realistic physical velocities and material-derived albedos (concrete dust, rust flakes, glass shards).

### Milestone 3: Procedural Wire Clutter & Soviet Cyberpunk Interactive Props (R3)
- Expand `PropShape` and `EnvDetail` with procedural catenary wire curve generators (GPU ribbon meshes).
- Implement CRT monitor props with animated GLSL noise shaders.
- Implement working elevator switches and illuminated warning signs.

### Milestone 4: GPU Multi-Draw Indirect (MDI) & Frustum Culling (R4)
- Implement `shaders/cull.comp` for prop bounds testing against view frustum and Hi-Z depth buffer.
- Create `src/render/gpu_cull_pass.h` and `src/render/gpu_cull_pass.cpp`.
- Populate indirect draw command buffers for 0-CPU-overhead rendering.

### Milestone 5: Verification & Forensic Audit (R5)
- Verify `glslc` shader compilation with 0 errors / 0 warnings.
- Verify MSVC C++23 build under `-W4 /permissive-` with 0 warnings.
- Verify `gigahrush2.exe` builds and links cleanly.
- Verify 0B heap allocations on hot render loops.
- Pass Forensic Auditor integrity checks with `VERDICT: CLEAN`.

## Acceptance Criteria
1. R1: Volumetric light grid SSBO compute pass and fragment shader raymarching implemented and verified.
2. R2: Voxel destruction debris cascade feeding `GpuParticlePass` ring buffer with material albedos and physics.
3. R3: Wire catenaries, CRT noise shaders, elevator switches, and warning signs fully functional.
4. R4: MDI frustum and Hi-Z culling compute pass delivering indirect draw commands with 0 CPU overhead.
5. All shadaers compile via `glslc` with 0 errors/warnings.
6. MSVC build clean (0 warnings), `gigahrush2.exe` executable generated.
7. Forensic Auditor returns CLEAN verdict with zero integrity violations.
