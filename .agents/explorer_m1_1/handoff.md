# Handoff Report: GPU Compute Volumetric Light Grid & Fog (`GpuLightGrid`)

## 1. Observation
- **Vulkan Device Management (`src/render/vk_device.h/.cpp`)**:
  - `VulkanDevice` manages Vulkan physical and logical device creation, surface initialization, and queue retrieval.
  - Line 79 of `vk_device.cpp`: Combined `VK_QUEUE_GRAPHICS_BIT` family handles graphics and compute workloads.
- **Buffer Allocation Subsystem (`src/render/vk_buffer.h/.cpp`)**:
  - `VulkanBuffer::create_device_local()` (`vk_buffer.cpp:111`): Device-local memory allocation (`VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT`) with host staging buffer upload via `vkCmdCopyBuffer`.
  - `VulkanBuffer::create_host_visible()` (`vk_buffer.cpp:185`): Host-visible and coherent buffer (`VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT`) persistently mapped to `mapped`.
- **Compute Pipeline Reference (`src/render/gpu_particle_pass.h/.cpp`)**:
  - Descriptor layout: 4 storage buffer bindings created at `gpu_particle_pass.cpp:120-131`.
  - Pipeline layout: Push constants (`ParticleComputePush`, 40 bytes) bound to compute stage (`gpu_particle_pass.cpp:189-200`).
  - Pipeline creation: `vkCreateComputePipelines` compiles `particles.comp.spv` (`gpu_particle_pass.cpp:211-225`).
  - Execution & Barriers: `record_compute()` (`gpu_particle_pass.cpp:442-509`) executes outside render pass; uses `vkCmdPipelineBarrier` (`VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT` -> `VK_PIPELINE_STAGE_VERTEX_INPUT_BIT | VK_PIPELINE_STAGE_DRAW_INDIRECT_BIT`).
- **Render Pass Lifecycle (`src/render/vk_renderer.h/.cpp`, `src/app/main.cpp:2174-2216`)**:
  - `begin_frame()` begins command buffer and executes `vkCmdBeginRenderPass`. Compute dispatches MUST execute before `begin_frame()` on `renderer.current_cmd()`.

## 2. Logic Chain
1. **Compute Execution Rule**: In Vulkan 1.2, compute dispatches writing SSBOs accessed by fragment shaders must execute outside the active render pass and emit an explicit memory barrier.
2. **Buffer Strategy**:
   - `lightBuf_` (Host-Visible, 12 KiB for 256 `GpuPointLight` entries): CPU updates lights without staging buffers or dynamic allocations per frame.
   - `gridSSBO_` (Device-Local, 512 KiB for 32x32x16 cells): Compute shader writes accumulated radiance and extinction; fragment shaders read directly.
3. **Synchronization**:
   - Compute barrier transfers access from `VK_ACCESS_SHADER_WRITE_BIT` (Compute stage) to `VK_ACCESS_SHADER_READ_BIT` (Fragment stage) across `gridSSBO_`.
4. **0B Heap Allocation**:
   - All Vulkan objects and memory allocations occur in `GpuLightGrid::init()`. Hot-loop updates use fixed-capacity mapped pointers and pre-allocated command buffers.

## 3. Caveats
- **Read-Only Scope**: This report is an architectural investigation and specification. Source code implementation (`gpu_light_grid.h/.cpp` and `light_grid.comp`) will be performed by the downstream Implementer agent.
- **Shader Compilation Dependency**: Adding `light_grid.comp` requires updating build scripts (`CMakeLists.txt`) to generate `light_grid.comp.spv` via `glslangValidator` / `dxc`.
- **std430 Packing**: Memory layouts for `GpuPointLight` (48 B) and `GpuGridCell` (32 B) must match GLSL std430 packing rules exactly to prevent alignment mismatch on AMD/NVIDIA hardware.

## 4. Conclusion
The Vulkan subsystem in `src/render/` provides robust primitives (`VulkanDevice`, `VulkanBuffer`, `GpuTimer`, compute pipeline patterns) supporting high-performance GPU compute. The proposed `GpuLightGrid` architecture satisfies all requirements for 3D volumetric light injection and fog computation with 0B hot-loop dynamic heap allocations.

## 5. Verification Method
1. **Compilation Check**:
   - Run project build command: `cmake --build build-win` (or standard CMake build target).
2. **Vulkan Validation Audit**:
   - Enable Vulkan validation layers in `VulkanDevice::init(window, true)`. Verify 0 validation warnings/errors on compute dispatch and pipeline barriers.
3. **0B Allocation Verification**:
   - Benchmark hot-path `update_lights()` and `record_compute()` to verify zero calls to `malloc`/`new`/`realloc`.
4. **File Inspection**:
   - Inspect `C:\hades\gigahrush2\.agents\explorer_m1_1\analysis.md` for complete class specification and memory layout details.
