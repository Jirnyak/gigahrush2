## 2026-07-30T13:00:09Z
You are Worker M1 for Milestone 1 (R1: GPU Compute Volumetric Light Grid & Fog).
Your working directory is `C:\hades\gigahrush2\.agents\worker_m1`.
The project workspace is `C:\hades\gigahrush2`.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Objective:
Implement Milestone 1: GPU Compute Volumetric Light Grid & Fog (`shaders/light_grid.comp`, `src/render/gpu_light_grid.h`, `src/render/gpu_light_grid.cpp`, and raymarching light attenuation & fog in `shaders/cube.frag`, `shaders/prop.frag`, `shaders/particle.frag`).

Read the Explorer analysis and handoff reports before implementing:
- `C:\hades\gigahrush2\.agents\explorer_m1_1\handoff.md` (Vulkan compute pipeline & host-visible SSBO streaming)
- `C:\hades\gigahrush2\.agents\explorer_m1_2\handoff.md` (GLSL compute grid packing, workgroups, and volumetric fog raymarching)
- `C:\hades\gigahrush2\.agents\explorer_m1_3\handoff.md` (World light emitters, headlamp, props, alarms, mob lights, and render loop call sequence)

Requirements:
1. `src/render/gpu_light_grid.h` and `src/render/gpu_light_grid.cpp`:
   - Define `GpuPointLight` (32 B std430 layout) and `GpuGridCell` (64 B std430 layout).
   - Manage Vulkan descriptor sets (Set 1), host-visible persistent mapped point light buffer, device-local grid SSBO ($32 \times 16 \times 32$ cells).
   - Create compute pipeline for `shaders/light_grid.comp`.
   - Provide `update_and_dispatch(VkCommandBuffer cmd, ...)` executing before render pass recording, inserting a `VkBufferMemoryBarrier` (`VK_ACCESS_SHADER_WRITE_BIT` -> `VK_ACCESS_SHADER_READ_BIT`).
   - Implement zero-allocation per-frame point light collection (player headlamp, emissive props, hazard alarms, mob lights).
2. `shaders/light_grid.comp`:
   - Compute shader with workgroup size `(8, 4, 8)`.
   - Bins up to 256 point lights into the 3D grid cells ($32 \times 16 \times 32$), applying light animation curves (flicker, crystal breathing pulse, acid waves).
3. Fragment Shaders (`shaders/cube.frag`, `shaders/prop.frag`, `shaders/particle.frag`):
   - Include/integrate volumetric fog raymarching (`shaders/volumetric_fog.glsl` or shared GLSL code).
   - Perform 12-step view-ray marching with Interleaved Gradient Noise (IGN) jittering, Henyey-Greenstein anisotropic phase scattering, height fog, and 3D light grid lookup.
4. Render Loop Integration:
   - Integrate `GpuLightGrid` in `src/app/main.cpp` or renderer initialization and render loop.
5. Quality & Build Verification:
   - Shaders must compile via `glslc` with 0 errors and 0 warnings.
   - Run `tools\win\build.bat Release` to build `gigahrush2.exe` under MSVC `-W4 /permissive-` with 0 warnings.
   - Run `ctest` in `build-win` to ensure all tests pass.
   - Verify 0B heap allocations on hot render loops (no `malloc`/`new` per frame).

Write your implementation report to `C:\hades\gigahrush2\.agents\worker_m1\handoff.md`.
Communicate your completion, build results, and test logs back to the Project Orchestrator via send_message.
