# Architectural Analysis: GPU Compute Volumetric Light Grid & Fog (`GpuLightGrid`)

## Executive Summary
This document provides a comprehensive investigation of the Vulkan rendering subsystem in `gigahrush2` (`src/render/`), detailing Vulkan device management, memory/buffer allocation, compute pipeline bring-up, descriptor set management, and render pass integration. Based on this architecture, a complete design is presented for `GpuLightGrid` (`src/render/gpu_light_grid.h/.cpp`), enabling zero-allocation 3D light grid injection and volumetric fog computation.

---

## 1. Vulkan Architecture & Subsystem Inspection

### 1.1 Device & Queue Management (`vk_device.h/.cpp`)
- **`VulkanDevice` Struct**: Wraps `VkInstance`, `VkSurfaceKHR`, `VkPhysicalDevice`, `VkDevice`, `VkQueue` (`graphicsQueue`, `presentQueue`), `QueueFamilies`, and `VkPhysicalDeviceProperties`.
- **Queue Families**:
  - `families.graphics`: Graphics + Compute queue family. In Vulkan specifications, queue families supporting `VK_QUEUE_GRAPHICS_BIT` also support `VK_QUEUE_COMPUTE_BIT`.
  - Timestamps are validated per queue family via `graphicsTimestampValidBits`.
- **Validation**: Khronos validation layer enabled automatically when requested and installed (`VK_LAYER_KHRONOS_validation`).

### 1.2 GPU Memory & Buffer Abstraction (`vk_buffer.h/.cpp`)
`VulkanBuffer` provides two primary memory allocation patterns:
1. **Device-Local (`create_device_local`)**:
   - Usage: `VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT`.
   - Used for static/GPU-only storage buffers (e.g. `particleBuf_`, `vertexBuf_`, `drawCmdBuf_`).
   - One-time host-to-device upload via transient staging buffer + `vkCmdCopyBuffer` + `vkQueueWaitIdle`.
2. **Host-Visible Dynamic (`create_host_visible`)**:
   - Usage: `VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT`.
   - Persistently mapped pointer (`void* mapped`) via `vkMapMemory`.
   - Used for streaming CPU-to-GPU data per frame (e.g. `emitBuf_` ring buffer in particle pass, instance buffers in `CubePass` and `PropPass`).
   - Direct CPU writes without calling `vkFlushMappedMemoryRanges` (due to `HOST_COHERENT`).
3. **Memory Diagnostics**:
   - Includes placement logging (`[vk-mem] <label>: X MiB -> type T heap H ...`) for tracking VRAM vs. Host RAM allocation.

### 1.3 Compute Pipeline Architecture (`gpu_particle_pass.h/.cpp` Reference)
The engine's compute pipeline architecture exhibits the following pattern:
- **Buffer Pre-Allocation**: All buffers (`VulkanBuffer`) created during pass `init()`.
- **Descriptor Set Layout**: Created with `VK_SHADER_STAGE_COMPUTE_BIT` stage flags for storage buffers (`VK_DESCRIPTOR_TYPE_STORAGE_BUFFER`) or uniform buffers.
- **Descriptor Pool & Allocation**: Dedicated pool created at `init()`, set allocated and updated via `vkUpdateDescriptorSets`.
- **Pipeline Layout**: Combines descriptor set layout(s) and push constant ranges (`VkPushConstantRange` targeting `VK_SHADER_STAGE_COMPUTE_BIT`).
- **Pipeline Creation**: SPIR-V loaded from `.spv` binary, compiled into `VkShaderModule`, and instantiated via `vkCreateComputePipelines`.
- **Execution & Synchronization**:
  - Compute recording (`record_compute`) runs **outside** the main render pass (prior to `vkCmdBeginRenderPass`).
  - Command sequence: `vkCmdFillBuffer` (if clearing required) -> `VkBufferMemoryBarrier` (TRANSFER -> COMPUTE) -> `vkCmdBindPipeline(COMPUTE)` -> `vkCmdBindDescriptorSets(COMPUTE)` -> `vkCmdPushConstants` -> `vkCmdDispatch` -> `VkBufferMemoryBarrier` (COMPUTE -> VERTEX / FRAGMENT).

### 1.4 Render Pass Lifecycle & Execution Frame (`vk_renderer.h/.cpp`, `main.cpp`)
- `begin_frame()` acquires swapchain image, resets query pool (`GpuTimer`), and opens `VkRenderPass` via `vkCmdBeginRenderPass`.
- All graphics draw calls (`CubePass::record`, `BodyPass::record`, `PropPass::record`, `Hud::render`) execute inside the active render pass subpass.
- `end_frame()` ends render pass (`vkCmdEndRenderPass`), submits command buffer `cmd[currentFrame]` to `graphicsQueue`, and presents via `presentQueue`.
- **Compute Placement**: Compute dispatches MUST execute before `begin_frame()` or before `vkCmdBeginRenderPass()` in the primary command buffer.

---

## 2. Architectural Design for `GpuLightGrid` (`gpu_light_grid.h/.cpp`)

### 2.1 Overview & System Purpose
`GpuLightGrid` manages a 3D volumetric light grid SSBO and local point/emissive light array SSBO on the GPU. A Vulkan compute shader (`light_grid.comp`) evaluates point light attenuation, radius culling, and emissive color injection into a 3D cell grid (`GRID_X x GRID_Y x GRID_Z`). Subsequent fragment shaders (`cube.frag`, `prop.frag`, `particle.frag`) sample this 3D grid to achieve local lighting and volumetric fog scattering.

### 2.2 Data Structures & Memory Layout (std430 Compliant)

#### A. Point / Emissive Light Struct (`GpuPointLight`)
```cpp
// 48 bytes per light, std430 aligned
struct alignas(16) GpuPointLight {
    vec3  pos;          // 12 B: World position
    float radius;       // 4 B:  Effective light radius (m)
    vec3  color;        // 12 B: Linear RGB intensity
    float intensity;    // 4 B:  Luminous intensity multiplier
    uint32_t flags;     // 4 B:  Bitmask (0=Point, 1=Emissive, 2=Pulsing, 3=Flicker)
    float innerRadius;  // 4 B:  Inner attenuation radius (m)
    float pad0 = 0.0f;  // 4 B:  Explicit std430 padding
    float pad1 = 0.0f;  // 4 B:  Explicit std430 padding
};
static_assert(sizeof(GpuPointLight) == 48, "GpuPointLight layout mismatch");
```

#### B. 3D Light Grid Cell Struct (`GpuGridCell`)
```cpp
// Grid Volume: 32 x 32 x 16 = 16,384 cells
// Option A: Direct Accumulated Light + Extinction (32 bytes)
struct alignas(16) GpuGridCell {
    vec4 accumulatedColor; // 16 B: RGB = accumulated radiance, A = scattering density
    vec4 ambientExtinction;// 16 B: RGB = ambient light, A = extinction coeff (sigma_t)
};
static_assert(sizeof(GpuGridCell) == 32, "GpuGridCell layout mismatch");
```

#### C. Compute Push Constants (`LightGridPush`)
```cpp
struct alignas(4) LightGridPush {
    float gridMinX, gridMinY, gridMinZ; // 12 B: 3D grid world minimum corner
    float cellSize;                     // 4 B:  Cell size in meters (e.g. 2.0m)
    uint32_t gridDimX, gridDimY, gridDimZ; // 12 B: (32, 32, 16)
    uint32_t lightCount;                // 4 B:  Active light count
    float time;                         // 4 B:  Current engine time (s)
    float fogDensity;                   // 4 B:  Global fog density
    float fogHeightFalloff;             // 4 B:  Height fog falloff
    float pad;                          // 4 B:  Padding to 48 B
};
```

---

## 3. Vulkan Resource Allocation & Descriptor Setup

### 3.1 Buffer Setup
1. **`lightBuf_` (HOST_VISIBLE | HOST_COHERENT)**:
   - Capacity: `kMaxGpuLights = 256` lights (`256 * 48 B = 12,288 B` / 12 KiB).
   - Usage: `VK_BUFFER_USAGE_STORAGE_BUFFER_BIT`.
   - Persistently mapped pointer (`mapped`). CPU appends active lights directly each frame.
2. **`gridSSBO_` (DEVICE_LOCAL)**:
   - Capacity: `32 * 32 * 16 * 32 B = 524,288 B` (512 KiB).
   - Usage: `VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT`.
   - Compute shader writes 3D cell data; fragment shaders read SSBO directly.

### 3.2 Descriptor Set Layout
- Binding 0: `lightBuf_` (`VK_DESCRIPTOR_TYPE_STORAGE_BUFFER`, `VK_SHADER_STAGE_COMPUTE_BIT`).
- Binding 1: `gridSSBO_` (`VK_DESCRIPTOR_TYPE_STORAGE_BUFFER`, `VK_SHADER_STAGE_COMPUTE_BIT | VK_SHADER_STAGE_FRAGMENT_BIT`).

### 3.3 Compute Pipeline Dispatch Configuration
- Local Workgroup Size in `light_grid.comp`: `layout(local_size_x = 8, local_size_y = 8, local_size_z = 4) in;` (256 threads/group).
- Workgroup Count for (32, 32, 16) grid:
  - `groupsX = (32 + 7) / 8 = 4`
  - `groupsY = (32 + 7) / 8 = 4`
  - `groupsZ = (16 + 3) / 4 = 4`
  - `vkCmdDispatch(cmd, 4, 4, 4);`

### 3.4 Barrier Synchronization
Before entering the render pass, a pipeline barrier synchronizes compute writes to fragment reads:
```cpp
VkBufferMemoryBarrier bar{};
bar.sType               = VK_STRUCTURE_TYPE_BUFFER_MEMORY_BARRIER;
bar.srcAccessMask       = VK_ACCESS_SHADER_WRITE_BIT;
bar.dstAccessMask       = VK_ACCESS_SHADER_READ_BIT;
bar.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
bar.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
bar.buffer              = gridSSBO_.buffer;
bar.offset              = 0;
bar.size                = VK_WHOLE_SIZE;

vkCmdPipelineBarrier(cmd,
    VK_PIPELINE_STAGE_COMPUTE_SHADER_BIT,
    VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,
    0, 0, nullptr, 1, &bar, 0, nullptr);
```

---

## 4. Verification of 0B Heap Allocation Requirement

### 4.1 Strict Allocation Policy
- **Startup (`init`)**:
  - Descriptor set layouts, descriptor pools, descriptor sets, pipeline layouts, pipelines, and `VulkanBuffer` allocations occur strictly once during initialization.
- **Frame Loop (`update` / `record_compute`)**:
  - Light submissions write into pre-allocated `lightBuf_.mapped` array via direct indexing or memcpy up to `lightCount`.
  - Zero heap allocations (`malloc`, `new`, `std::vector::resize`, `std::vector::push_back`).
  - Dynamic Vulkan commands (`vkCmdBindPipeline`, `vkCmdBindDescriptorSets`, `vkCmdPushConstants`, `vkCmdDispatch`, `vkCmdPipelineBarrier`) allocate memory only within internal driver command buffer rings.

---

## 5. Architectural Recommendations for Implementation Phase
1. **Class Specification**: Implement `GpuLightGrid` in `src/render/gpu_light_grid.h` and `src/render/gpu_light_grid.cpp`.
2. **Shader Compilation**: Create `shaders/light_grid.comp` and configure CMake (`CMakeLists.txt`) to compile `light_grid.comp` -> `light_grid.comp.spv` alongside existing shaders.
3. **Integration Point**:
   - Initialize `GpuLightGrid` in `main.cpp` alongside `CubePass`, `BodyPass`, `PropPass`, and `GpuParticlePass`.
   - Call `lightGrid.record_compute(cmd, time, dt, camPos)` prior to `renderer.begin_frame()`.
   - Bind `gridSSBO_` descriptor set or pass binding to fragment shaders (`cube.frag`, `prop.frag`).
