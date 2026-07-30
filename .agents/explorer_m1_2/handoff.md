# Handoff Report: Prop Shading & Pipeline Integration (Milestone 2 / R2)

**Agent ID:** `explorer_m1_2`  
**Working Directory:** `C:\hades\gigahrush2\.agents\explorer_m1_2`  
**Date:** 2026-07-30  
**Handoff Type:** Hard  

---

## 1. Observation

### 1.1 Existing Instancing Setup (`src/render/prop_pass.h/.cpp`, `src/render/prop_mesh.h/.cpp`)
- **Mesh catalogue**: `PropMesh` procedurally generates 25 shapes (`PropShape::Cylinder` to `PropShape::AcidPool`) uploaded to static device-local vertex (`PropVertex`, 24 bytes) and index buffers.
- **Instance Layout**: `PropInstance` (`src/render/prop_mesh.h:32-41`) is 32 bytes:
  ```cpp
  struct PropInstance {
      vec3    origin;    // 12 B
      float   yaw;       //  4 B
      vec3    color;     // 12 B
      uint8_t matId;     //  1 B
      uint8_t emissive;  //  1 B
      uint8_t flags;     //  1 B (bit0=flipX, bit1=damaged, bit2=glow pulse)
      uint8_t animPhase; //  1 B (0-255 mapped 0-2pi)
  };
  ```
- **Pipeline Setup**: `PropPass::create_pipeline()` (`src/render/prop_pass.cpp:138-146`) currently binds only **7 attributes** (locations 0 to 6):
  ```cpp
  attrs[5] = {5, 1, VK_FORMAT_R8_UINT, offsetof(PropInstance, matId)};
  attrs[6] = {6, 1, VK_FORMAT_R8_UINT, offsetof(PropInstance, emissive)};
  ```
  `inFlags` (location 7, offset 30) and `inAnimPhase` (location 8, offset 31) are **NOT** bound in `prop_pass.cpp` and **NOT** declared in `prop.vert`.
- **CPU Culling & Draw Calls**: `PropPass::record()` (`src/render/prop_pass.cpp:270-295`) performs toroidal distance culling (`distSq > fogEndSq`) against `pc.camPos.xyz`, uploading surviving instances to host-visible instance buffers (`instBufs_[s][frameIndex]`) and issuing one `vkCmdDrawIndexed` per active shape.

### 1.2 Existing Shader Code (`shaders/prop.vert`, `shaders/prop.frag`)
- **`shaders/prop.vert:12-18`**: Declares inputs `inPos`, `inNormal`, `inOrigin`, `inYaw`, `inColor`, `inMat`, `inEmissive`. Applies Y-rotation and toroidal `nearest_image()` placement relative to `pc.camPos.xyz`.
- **`shaders/prop.frag:113`**: Geometric normal `n_geom = normalize(vNormal)` is used directly for lighting without any procedural normal perturbation.
- **`shaders/prop.frag:144`**: Roughness is computed using a coarse static bitwise formula:
  ```glsl
  float roughness = 0.4 + 0.2 * float(vMat & 3u);
  ```
- **`shaders/prop.frag:171-177`**: Emissive pulse uses a static spatial sine wave without any time input:
  ```glsl
  float pulse = 1.0 + 0.08 * sin(vWorldPos.y * 7.3 + vWorldPos.x * 3.1);
  ```
- **Push Constant Allocation (`src/render/cube_pass.h:145-165`)**: `CubePush` is exactly 128 bytes. `pc.torus.w` is unallocated (`0.0f` in `main.cpp:2412`).

---

## 2. Logic Chain

1. **Observation**: `PropInstance` has unused trailing bytes `flags` (offset 30) and `animPhase` (offset 31). `CubePush` has dead lane `push.torus.w`.
2. **Inference**: We can pass per-instance animation phase, effect flags, and global accumulator time $t$ to shaders with **zero byte expansion** in data structures and **zero memory bandwidth penalty**.
3. **Observation**: `shaders/prop.frag` ignores `kMatSurface[mid].w` (bump scale) and uses `vMat & 3u` for roughness.
4. **Inference**: We can incorporate triplanar finite-difference procedural normal perturbation and calibrated per-material roughness mapping directly into `prop.frag` using existing functions from `material_surface.glsl`.
5. **Observation**: Emissive props (lamps, crystals, acid pools) have `vEmissive` passed from CPU, but lack time-based animation.
6. **Inference**: Feeding `uTime` from `pc.torus.w` enables high-frequency stochastic arc flickering (lamps), harmonic breathing (crystals), and chemical wave undulation + bubble bursts (acid pools).

---

## 3. Caveats

- **Read-Only Scope**: This report and its companion handbook (`handbook_prop_shading.md`) present a complete technical blueprint. Code changes to `shaders/prop.frag`, `shaders/prop.vert`, and `src/render/prop_pass.cpp` were not applied to project source files during this investigation.
- **Driver / Compiler Validation**: GLSL shader changes should be compiled using `glslangValidator` during implementation to confirm zero compilation warnings or SPIR-V alignment issues.

---

## 4. Conclusion

The Vulkan prop instancing pipeline in *Gigahrush2* is robust and highly efficient, using static device-local mesh buffers and host-visible per-frame instance buffers. Expanding prop shading for Milestone 2 (R2) requires:
1. Binding vertex attributes 7 (`inFlags`) and 8 (`inAnimPhase`) in `prop_pass.cpp`.
2. Populating `push.torus.w` with global time `uTime` in `main.cpp`.
3. Adding procedural normal perturbation (triplanar tangent-space finite-differencing), calibrated roughness mapping, and time-driven emissive animation curves to `shaders/prop.frag`.

All technical details, GLSL shader code snippets, struct alignments, and trade-off comparisons are documented in `handbook_prop_shading.md`.

---

## 5. Verification Method

To verify these findings and execute the blueprint:
1. **Inspect Technical Blueprint**: View `C:\hades\gigahrush2\.agents\explorer_m1_2\handbook_prop_shading.md`.
2. **Shader Compilation**:
   ```powershell
   glslangValidator -V C:\hades\gigahrush2\shaders\prop.vert -o C:\hades\gigahrush2\shaders\prop.vert.spv
   glslangValidator -V C:\hades\gigahrush2\shaders\prop.frag -o C:\hades\gigahrush2\shaders\prop.frag.spv
   ```
3. **Build & Test Execution**:
   ```powershell
   cmake --build C:\hades\gigahrush2\build-win --config Release
   ctest --test-dir C:\hades\gigahrush2\build-win --output-on-failure
   ```
