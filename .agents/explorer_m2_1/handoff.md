# Handoff Report — explorer_m2_1 (M2: Advanced Atmospheric Shader Pipeline)

## 1. Observation

### 1.1 Shader Files Inspected
- `shaders/prop.vert` (67 lines) — per-instance vertex stage for prop meshes.
- `shaders/prop.frag` (257 lines) — fragment shader for GPU-instanced prop meshes with M2 shading.
- `shaders/material_surface.glsl` (146 lines) — material surface parameter table generated from `data/materials.csv`.
- `shaders/cube.vert` (138 lines) & `shaders/cube.frag` (647 lines) — voxel world pass shaders.
- `shaders/body.vert` (63 lines) — population body box vertex shader.

### 1.2 C++ Implementation Files Inspected
- `src/render/prop_mesh.h` & `src/render/prop_pass.h` / `prop_pass.cpp` — Prop instance data structures, mesh catalog (25 prop shapes), pipeline creation, and Vulkan attribute binding descriptions.
- `src/render/cube_pass.h` & `cube_pass.cpp` — `CubePush` push constant definition, descriptor sets, and pipeline layout.
- `src/app/main.cpp` — Render loop push constant population and draw command recording.

### 1.3 Push Constant Compatibility (`Push` Block)
All 5 shaders (`cube.vert`, `cube.frag`, `body.vert`, `prop.vert`, `prop.frag`) declare an identical 128-byte `push_constant` block matching `giga::gpu::CubePush`:
```glsl
layout(push_constant) uniform Push {
    mat4 viewProj; // offset 0 (64 bytes)
    vec4 sunDir;   // offset 64 (16 bytes)
    vec4 camPos;   // offset 80 (16 bytes)
    vec4 fog;      // offset 96 (16 bytes)
    vec4 torus;    // offset 112 (16 bytes)
} pc;
```
Field mapping for `pc.torus`:
- `pc.torus.x`: World wrapping period `kWorldExtent` (used for toroidal minimal image placement).
- `pc.torus.y`: `kAoDirect` ambient occlusion direct-light share (0.0..1.0).
- `pc.torus.z`: Material photographic albedo layer bitmask (used in `cube.frag` under `#ifdef GIGA_ALBEDO_ARRAY`).
- `pc.torus.w`: Pass-dependent:
  - In `CubePass`: Bitcast uint32 packed normal & roughness masks (`packedMasks`).
  - In `PropPass`: `uTime` (seconds since start, passed via `push.torus.w = currentTimeSec` in `main.cpp`).

### 1.4 Vertex Attributes (Locations 0-8) Matching C++ Structs
`prop.vert` input declarations vs `VkVertexInputAttributeDescription` in `prop_pass.cpp` vs `PropVertex` / `PropInstance` in `prop_mesh.h`:

| Location | GLSL (`prop.vert`) | Vulkan Format (`prop_pass.cpp`) | C++ Struct Field (`prop_mesh.h`) | Binding | Input Rate | Offset |
|---|---|---|---|---|---|---|
| 0 | `in vec3 inPos` | `VK_FORMAT_R32G32B32_SFLOAT` | `PropVertex::pos` | 0 | VERTEX | 0 |
| 1 | `in vec3 inNormal` | `VK_FORMAT_R32G32B32_SFLOAT` | `PropVertex::normal` | 0 | VERTEX | 12 |
| 2 | `in vec3 inOrigin` | `VK_FORMAT_R32G32B32_SFLOAT` | `PropInstance::origin` | 1 | INSTANCE | 0 |
| 3 | `in float inYaw` | `VK_FORMAT_R32_SFLOAT` | `PropInstance::yaw` | 1 | INSTANCE | 12 |
| 4 | `in vec3 inColor` | `VK_FORMAT_R32G32B32_SFLOAT` | `PropInstance::color` | 1 | INSTANCE | 16 |
| 5 | `in uint inMat` | `VK_FORMAT_R8_UINT` | `PropInstance::matId` | 1 | INSTANCE | 28 |
| 6 | `in uint inEmissive` | `VK_FORMAT_R8_UINT` | `PropInstance::emissive` | 1 | INSTANCE | 29 |
| 7 | `in uint inFlags` | `VK_FORMAT_R8_UINT` | `PropInstance::flags` | 1 | INSTANCE | 30 |
| 8 | `in float inAnimPhase` | `VK_FORMAT_R8_UNORM` | `PropInstance::animPhase` | 1 | INSTANCE | 31 |

- Binding 0 Stride: `sizeof(PropVertex) == 24` bytes.
- Binding 1 Stride: `sizeof(PropInstance) == 32` bytes (`static_assert(sizeof(PropInstance) == 32)`).
- Location 8 (`R8_UNORM`): Hardware converts `uint8_t` (0..255) to float `0.0..1.0`. `prop.vert` scales it by `2*pi` (`vAnimPhase = inAnimPhase * 6.283185307179586`).

### 1.5 Shading Math in `prop.frag`
1. **Triplanar UVs**: Dominant normal axis selection (`aw.z > 0.5 ? xy : (aw.x > 0.5 ? yz : xz)`), normalized by `uv /= 2.0`.
2. **Derivative Normal Perturbation (`construct_perturbed_normal`)**: Local TBN frame constructed from `n_geom`. Central differences `(s_right - s_left) / (2 * eps)` and `(s_top - s_bot) / (2 * eps)` evaluated via procedural `surface()`. Returns `normalize(n_geom - bumpScale * (dSdu * T + dSdv * B))`.
3. **Roughness & Blinn-Phong Specular**: `compute_prop_roughness` yields roughness in `[0.05, 0.98]`. Specular exponent `specPow = max(2.0 / (roughness^4 + 1e-4) - 2.0, 1.0)`. Dual-light specular evaluated for headlamp (attenuated point light at camera) and sun directional fill light.
4. **Animated Emissive Effects (`compute_animated_emissive`)**:
   - `baseEmissive > 1.2`: High-frequency electrical flicker (`mix(1.0, step(0.20, hash11(stepTime)), 0.30)`) with 60Hz power hum.
   - `mat_id == 0` or `baseEmissive > 0.8`: Bioluminescent organic breathing pulse (`1.0 + 0.28 * sin(...) + 0.10 * cos(...)`).
   - Moderate emissive (acid pools/chemical containers): Spatial wave undulation + exponential bubble bursts (`pow(max(sin(...), 0.0), 10.0)`).
5. **Atmospheric Height Fog & sRGB Dithering**:
   - Exponential height density `heightDensity = exp(-clamp(0.04 * vWorldPos.y, -3.0, 3.0))`.
   - Distance fog clamped to `[0.0, 1.0]` between `pc.fog.x` and `pc.fog.y`.
   - sRGB gamma conversion `pow(lit, 1.0 / 2.2)`.
   - Interleaved Gradient Noise (IGN) screen-space dithering `(ign - 0.5) / 255.0 * (1.0 - fog)` added to suppress 8-bit banding on dark fog gradients.

---

## 2. Logic Chain

1. **Push Constant Compatibility**:
   - `PropPass::init` takes `cubePass.pipeline_layout()`.
   - `CubePush` in C++ specifies a 128-byte layout. All shaders specify identical `layout(push_constant) uniform Push` with 5 `vec4`/`mat4` members matching `CubePush`.
   - Therefore, push constant layout is binary compatible across all shaders and pipeline layouts.

2. **Vertex Layout Alignment**:
   - In `prop_mesh.h`, `PropVertex` (24 bytes) and `PropInstance` (32 bytes) specify layout and member offsets.
   - In `prop_pass.cpp`, vertex attributes 0..8 map `PropVertex` (bindings 0) and `PropInstance` (binding 1) with exact offsets.
   - In `prop.vert`, input locations 0..8 match `PropVertex` (locations 0-1) and `PropInstance` (locations 2-8).
   - Therefore, vertex input fetching in Vulkan matches shader declarations exactly.

3. **Shading Math Completeness**:
   - `prop.frag` includes `material_surface.glsl` for calibrated material properties.
   - Normal perturbation utilizes tangent/bitangent finite-difference bump mapping, allowing procedural detail on non-axis-aligned prop geometry (cylinders, arches, pipes).
   - Headlamp and fill light Blinn-Phong specular calculation matches the PBR model in `cube.frag`.
   - Time-animated emissive effects use `vAnimPhase` and `pc.torus.w` (`timeSec`) to drive electrical flicker, organic pulsing, and acid bubbles.
   - Height fog and sRGB dithering match `cube.frag` bit-for-bit, maintaining visual continuity between voxels and prop objects.

---

## 3. Caveats

1. **Unused Varying `vFlags` in `prop.frag`**:
   `vFlags` (location 6 flat uint) is passed from `prop.vert` to `prop.frag` but is not currently consumed in `prop.frag`. It is reserved for future per-instance prop flags (such as flipX, damaged tinting, or custom glow triggers). GLSL compiler handles unused varyings without error.
2. **Double Precision Literal in `prop.vert`**:
   `prop.vert` line 65 uses `6.283185307179586` without an explicit `f` suffix. While standard GLSL float promotion handles this, adding `f` (`6.2831853f`) avoids potential compiler precision warnings on strict GLSL tools.
3. **No Photographic Texture Sampling in `prop.frag`**:
   `prop.frag` uses procedural surface textures and does not include `#ifdef GIGA_ALBEDO_ARRAY` descriptor set sampling (unlike `cube_tex.frag.spv`). This is intentional: props use procedural materials, colors (`vColor`), and emissive intensity (`vEmissive`), keeping `PropPass` pipeline layout simple and descriptor-free.

---

## 4. Conclusion

`shaders/prop.vert`, `shaders/prop.frag`, `shaders/material_surface.glsl`, `shaders/cube.vert`, and `shaders/cube.frag` are fully compatible in layout, push constants (128 bytes), vertex attributes (locations 0-8 matching `PropVertex` and `PropInstance`), and shading mathematics.

The prop rendering pipeline correctly implements triplanar UV mapping, derivative normal perturbation, Blinn-Phong specular lighting, multi-category animated emissives (electrical flicker, organic breathing pulse, acid bubble pops), atmospheric height-dependent fog, and IGN dithered sRGB output.

---

## 5. Verification Method

To verify shader pipeline compatibility and layout without executing builds (obeying SINGLE-COMPILER OWNER RULE):
1. **Push Constant Layout Verification**:
   Inspect `CubePush` in `src/render/cube_pass.h` lines 145-168 and compare with `layout(push_constant) uniform Push` in `shaders/prop.vert` (lines 19-25) and `shaders/prop.frag` (lines 16-22).
2. **Vertex Attribute Layout Verification**:
   Inspect `PropInstance` in `src/render/prop_mesh.h` lines 32-41 (`static_assert(sizeof(PropInstance) == 32)`), attribute setup in `src/render/prop_pass.cpp` lines 142-159, and `layout(location = ...) in` declarations in `shaders/prop.vert` lines 8-16.
3. **Height Fog & Dithering Consistency**:
   Compare height fog math in `shaders/cube.frag` lines 620-633 with `shaders/prop.frag` lines 244-253.
