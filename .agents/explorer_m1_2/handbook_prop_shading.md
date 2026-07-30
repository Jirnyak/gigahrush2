# Handbook & Shader Technical Blueprint: Prop Shading & Pipeline Integration (Milestone 2 / R2)

**Author:** `explorer_m1_2`  
**Date:** 2026-07-30  
**Target Subsystem:** `Gigahrush2` Render Pipeline (`src/render/prop_pass`, `src/render/prop_mesh`, `shaders/prop.vert`, `shaders/prop.frag`)  
**Status:** Complete Read-Only Technical Blueprint & Investigation Report

---

## Executive Summary

This handbook details the GPU instancing architecture, shader pipeline, and procedural material system for props in *Gigahrush2*. It provides a complete, actionable technical blueprint for expanding prop shading in Milestone 2 (R2), including:
1. **Procedural normal perturbation & bump mapping** to give physical depth to prop surfaces without photographic texture maps.
2. **Material-driven roughness and specular response** replacing coarse static bitwise formulas with calibrated per-material parameters.
3. **Time-based animated emissive effects** (flicker, pulse, chemical ripples) for flood lights, purple crystals, and green acid pools.
4. **Zero-overhead layout extensions** leveraging unused bytes in the existing 32-byte `PropInstance` struct and dead lanes in the 128-byte `CubePush` constant block.

---

## Section 1: Analysis of Existing Vulkan GPU Instancing Architecture

### 1.1 Mesh Catalogue & Device-Local Geometry (`prop_mesh.h/.cpp`)
Prop geometry is generated procedurally on the CPU at application startup and uploaded to static, device-local GPU memory:
- **`PropVertex` Struct** (24 bytes):
  ```cpp
  struct PropVertex {
      vec3 pos;     // 12 bytes (Offset 0)
      vec3 normal;  // 12 bytes (Offset 12)
  };
  ```
- **Catalogue**: 25 distinct parametric shapes (`PropShape::Cylinder` [0] through `PropShape::AcidPool` [24], `kPropShapeCount = 25`).
- **Buffers**: Each shape owns a device-local `VkBuffer` for vertices and a device-local `VkBuffer` for 32-bit indices (`PropMesh::vertexBuffer` and `PropMesh::indexBuffer`).

### 1.2 CPU Instance Batching & Memory Layout (`prop_pass.h/.cpp`)
- **`PropInstance` Struct** (32 bytes):
  ```cpp
  struct PropInstance {
      vec3    origin;    //  12 B (Offset 0)  - World-space minimum corner / base
      float   yaw;       //   4 B (Offset 12) - Y-axis rotation in radians
      vec3    color;     //  12 B (Offset 16) - Display-referred base RGB tint
      uint8_t matId;     //   1 B (Offset 28) - Material ID (0-30)
      uint8_t emissive;  //   1 B (Offset 29) - Emissive intensity (0-255 -> 0.0-2.0x)
      uint8_t flags;     //   1 B (Offset 30) - Packed bitflags (flipX, damaged, glow)
      uint8_t animPhase; //   1 B (Offset 31) - Animation phase (0-255 -> 0..2pi)
  };
  static_assert(sizeof(PropInstance) == 32, "PropInstance size mismatch");
  ```
- **CPU Buffers**: `PropPass` maintains CPU vectors (`cpuInst_[25]`). `PropPlacer::populate()` streams prop instances into these lists per frame.
- **GPU Instance Buffers**: Host-visible, double-buffered per frame (`instBufs_[25][kMaxFramesInFlight]`), capped at `kMaxPropInstances = 4096` instances per shape per frame (128 KB allocation per shape slot).

### 1.3 Per-Frame CPU Culling & Draw Call Dispatch
During `PropPass::record()`:
1. **CPU Toroidal Culling**: For each instance in `cpuInst_[s]`, the distance to camera `pc.camPos.xyz` is calculated using toroidal minimal-image wrapping (`dx -= period * floor(dx / period + 0.5)`). If `distSq > fogEndSq`, the instance is fully fogged to black and skipped on the CPU.
2. **Buffer Upload**: Surviving instances are copied into the mapped host-visible buffer slot `instBufs_[s][frameIndex]`.
3. **Draw Call Execution**: For each active shape ($N_{instances} > 0$):
   - Bind Vertex Buffer 0: Shape VBO (`PropVertex`, stride = 24, rate = `VK_VERTEX_INPUT_RATE_VERTEX`).
   - Bind Vertex Buffer 1: Instance VBO (`PropInstance`, stride = 32, rate = `VK_VERTEX_INPUT_RATE_INSTANCE`).
   - Bind Index Buffer: Shape IBO (`VK_INDEX_TYPE_UINT32`).
   - Call `vkCmdDrawIndexed(cmd, indexCount, instanceCount, 0, 0, 0)`.
   - Max draw calls per frame = 25 (1 call per active shape).

### 1.4 Pipeline Layout & Push Constant Sharing
`PropPass` shares the exact `VkPipelineLayout` created by `CubePass`. It relies on the 128-byte `CubePush` push-constant block:
```cpp
struct CubePush {
    mat4 viewProj; // 64 B - View-projection matrix
    vec4 sunDir;   // 16 B - xyz = fill dir, w = fill strength
    vec4 camPos;   // 16 B - xyz = camera pos, w = headlamp intensity
    vec4 fog;      // 16 B - x = fog start, y = fog end, z = lamp radius, w = ambient
    vec4 torus;    // 16 B - x = wrap period, y = AO direct share, z = tex mask, w = free / uTime
}; // Total: 128 bytes (Vulkan guaranteed push constant size limit)
```

---

## Section 2: Audit of Existing Shader Code (`prop.vert` & `prop.frag`)

### 2.1 Vertex Shader Audit (`shaders/prop.vert`)
- **Inputs**:
  - `inPos` (loc 0), `inNormal` (loc 1) from VBO 0.
  - `inOrigin` (loc 2), `inYaw` (loc 3), `inColor` (loc 4), `inMat` (loc 5), `inEmissive` (loc 6) from VBO 1.
- **Operations**:
  - Applies 3x3 Y-rotation matrix derived from `inYaw`.
  - Shifts `inOrigin + localPos` to nearest toroidal image relative to `pc.camPos.xyz`.
  - Outputs varyings: `vNormal` (transformed normal), `vColor`, `vWorldPos`, `vAo` (hardcoded 1.0), `vMat` (flat uint), `vEmissive` (float mapped 0.0..2.0).
- **Gaps / Deficiencies**:
  - `inFlags` (location 7, offset 30) and `inAnimPhase` (location 8, offset 31) are **NOT** bound in `prop_pass.cpp` and **NOT** declared in `prop.vert`.
  - No global time parameter is read from `pc.torus.w`.

### 2.2 Fragment Shader Audit (`shaders/prop.frag`)
- **Procedural Surface Texturing**:
  - Uses triplanar projection on `vWorldPos` to calculate 2D `uv`.
  - Calls `surface(vMat, uv, aw, px, g)` from `material_surface.glsl` to modulate linear albedo `pow(vColor, 2.2)`.
- **Shading & Lighting**:
  - Direct headlamp light + Henyey-Greenstein forward scattering + fill light + hemisphere ambient + height/distance fog + IGN dithering.
- **Gaps / Deficiencies**:
  1. **Normal Mapping / Bump Scale Ignored**: Geometric normal `n_geom = normalize(vNormal)` is used directly for lighting. The bump scale `kMatSurface[mid].w` from `material_surface.glsl` is never evaluated! Surface textures look completely flat under direct headlamp light.
  2. **Coarse Hardcoded Roughness**: `roughness = 0.4 + 0.2 * float(vMat & 3u);`. This ignores the rich material family definitions in `material_surface.glsl` and produces identical specular highlights for wildly different materials.
  3. **Static Emissive Pulse**: Emissive term uses `pulse = 1.0 + 0.08 * sin(vWorldPos.y * 7.3 + vWorldPos.x * 3.1);`. Because no time parameter is present, lights, crystals, and acid pools are completely static across frames.

---

## Section 3: Technical Blueprint for Milestone 2 (R2) Shader Extensions

```
+-----------------------------------------------------------------------------------+
|                                 GIGAHRUSH2 R2 SHADER FLOW                         |
+-----------------------------------------------------------------------------------+
|  PropInstance (32B)       CubePush (128B)                                         |
|  - origin, yaw, color     - viewProj, sunDir, camPos, fog                         |
|  - matId, emissive        - torus (x=period, y=ao, z=texMask, w=uTime)            |
|  - flags [NEW]            --------------------------------------------            |
|  - animPhase [NEW]                             |                                  |
+-------------------                             v                                  |
         |                         +---------------------------+                    |
         v                         |        prop.vert          |                    |
+------------------+               |  - Y-Yaw Rotation         |                    |
|  VkVertexInput   | ------------> |  - Toroidal Nearest Image |                    |
|  Attrs (loc 0-8) |               |  - Forward Varyings       |                    |
+------------------+               +---------------------------+                    |
                                                 |                                  |
                                                 v                                  |
                                   +---------------------------+                    |
                                   |        prop.frag          |                    |
                                   | 1. Triplanar Procedural   |                    |
                                   |    Surface & Gradient     |                    |
                                   | 2. Perturb Normal (TBN)   |                    |
                                   | 3. Calibrated Roughness   |                    |
                                   | 4. Animated Emissive      |                    |
                                   |    (Flicker/Pulse/Ripple) |                    |
                                   +---------------------------+                    |
                                                 |                                  |
                                                 v                                  |
                                         outColor (sRGB)                            |
+-----------------------------------------------------------------------------------+
```

### 3.1 Extension 1: Procedural Normal Perturbation & Bump Mapping

#### Mathematical Model
To compute normal perturbations procedurally without texture maps, we derive the gradient of the scalar surface height field $S(u, v)$ evaluated in triplanar space.

Let $\mathbf{N}_{geom}$ be the normalized geometric surface normal. Construct an orthonormal tangent basis $(\mathbf{T}, \mathbf{B}, \mathbf{N}_{geom})$:
$$\mathbf{T} = \text{normalize}(\mathbf{N}_{geom} \times \mathbf{u}_{ref}), \quad \mathbf{B} = \mathbf{N}_{geom} \times \mathbf{T}$$
where $\mathbf{u}_{ref} = (0, 1, 0)$ if $|\mathbf{N}_{geom}.y| < 0.999$, else $(1, 0, 0)$.

Sample height $S(u, v) = \text{surface}(vMat, uv, aw, px, g)$ and evaluate central finite-difference derivatives along $u$ and $v$ with step size $\epsilon = 0.002$:
$$\frac{\partial S}{\partial u} \approx \frac{S(u + \epsilon, v) - S(u - \epsilon, v)}{2\epsilon}$$
$$\frac{\partial S}{\partial v} \approx \frac{S(u, v + \epsilon) - S(u, v - \epsilon)}{2\epsilon}$$

The perturbed world-space normal $\mathbf{N}_{shading}$ is:
$$\mathbf{N}_{raw} = \mathbf{N}_{geom} - \lambda_{bump} \cdot \left( \frac{\partial S}{\partial u} \mathbf{T} + \frac{\partial S}{\partial v} \mathbf{B} \right)$$
$$\mathbf{N}_{shading} = \text{normalize}(\mathbf{N}_{raw})$$
where $\lambda_{bump} = kMatSurface[mid].w$ (read directly from `material_surface.glsl`).

#### GLSL Implementation Code (`shaders/prop.frag`)
```glsl
// --- Triplanar Tangent Space & Procedural Normal Perturbation ---
vec3 construct_perturbed_normal(vec3 n_geom, uint mat_id, vec2 uv, vec3 aw, float px, float g_center) {
    // 1. Fetch material bump scale from material_surface.glsl table
    uint mid = min(mat_id, kMatSurfaceCount - 1u);
    float bumpScale = kMatSurface[mid].w;
    
    if (bumpScale < 0.001) {
        return n_geom; // Smooth material, bypass perturbation
    }

    // 2. Build orthonormal basis (T, B, N)
    vec3 up = abs(n_geom.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(up, n_geom));
    vec3 B = cross(n_geom, T);

    // 3. Finite-difference height gradient sampling
    const float eps = 0.002;
    float s_right = surface(mat_id, uv + vec2(eps, 0.0), aw, px, grain(uv + vec2(eps, 0.0)));
    float s_left  = surface(mat_id, uv - vec2(eps, 0.0), aw, px, grain(uv - vec2(eps, 0.0)));
    float s_top   = surface(mat_id, uv + vec2(0.0, eps), aw, px, grain(uv + vec2(0.0, eps)));
    float s_bot   = surface(mat_id, uv - vec2(0.0, eps), aw, px, grain(uv - vec2(0.0, eps)));

    float dSdu = (s_right - s_left) / (2.0 * eps);
    float dSdv = (s_top - s_bot)   / (2.0 * eps);

    // 4. Combine into perturbed normal
    vec3 n_perturbed = n_geom - bumpScale * (dSdu * T + dSdv * B);
    return normalize(n_perturbed);
}
```

---

### 3.2 Extension 2: Material-Driven Roughness & Specular Variation

#### Calibrated Material Roughness Mapping
Replace the coarse `vMat & 3u` bitwise formula with a physical roughness model derived from material properties in `material_surface.glsl`:
- Base roughness $R_0$ is retrieved from material lognormal variance $kMatSurface[mid].x$ combined with family defaults:
  - **Smooth / Metal** (Family 8 / `matId >= 3`): $R_0 = 0.20 + 2.0 \cdot \sigma$ (Sleek, reflective: cabinets, rails, valve wheels).
  - **Ribbed Metal** (Family 4): $R_0 = 0.45 + \sigma$ (Industrial corrugated metal).
  - **Plaster / Wood** (Family 1, 2): $R_0 = 0.65$ (Diffuse, semi-rough).
  - **Rust / Rubble** (Family 6, 7): $R_0 = 0.85$ (Rough, micro-pitted).
- **Micro-Roughness Noise Modulation**:
  $$\text{roughness} = \text{clamp}\left( R_0 + 0.15 \cdot (g(uv) - 0.5), \, 0.08, \, 0.98 \right)$$

#### GLSL Implementation Code (`shaders/prop.frag`)
```glsl
float compute_prop_roughness(uint mat_id, float g_noise) {
    uint mid = min(mat_id, kMatSurfaceCount - 1u);
    uint fam = kMatFamily[mid];
    float sigma = kMatSurface[mid].x;

    float baseRoughness = 0.50;
    if (fam == kFamSmooth || mat_id >= 3u) {
        baseRoughness = 0.22 + sigma * 1.5; // Metallic / painted smooth surfaces
    } else if (fam == kFamRibbed) {
        baseRoughness = 0.42 + sigma;       // Corrugated paneling
    } else if (fam == kFamRust || fam == kFamRubble) {
        baseRoughness = 0.82 + sigma * 0.3; // High roughness oxidized surfaces
    } else if (fam == kFamPlaster || fam == kFamPlank) {
        baseRoughness = 0.65;               // Matte architectural elements
    }

    // Add procedural grain variation so specular highlights break up realistically across surfaces
    float microVariation = (g_noise - 0.5) * 0.18;
    return clamp(baseRoughness + microVariation, 0.05, 0.98);
}
```

---

### 3.3 Extension 3: Animated Emissive Pulse, Flicker & Ripple Effects

#### Effect Classification by Prop Category
Props use `inFlags` (bitfield) and shape types to execute distinct animation profiles driven by global time $t = pc.torus.w$ and per-instance phase $\phi = vAnimPhase \cdot 2\pi$:

1. **Flood Lamps & Electrical Cabinets (Stochastic Arc-Flicker / Faulty Power)**:
   - Simulates loose wiring or dying tungsten filaments.
   - Combines a base sine pulse with high-frequency pseudo-random step noise:
     $$\text{flicker} = \text{mix}(1.0, \text{step}(0.25, \text{hash11}(\lfloor 24.0 \cdot t + \phi \rfloor)), 0.35) \cdot (1.0 + 0.05 \cdot \sin(12.0 \cdot t + \phi))$$
2. **Crystal Clusters & Fungal Columns (Bioluminescent Harmonic Breathing)**:
   - Smooth, ethereal dual-sine wave breathing:
     $$\text{pulse} = 1.0 + 0.25 \cdot \sin(2.5 \cdot t + \phi) + 0.12 \cdot \cos(4.7 \cdot t + \phi \cdot 1.3)$$
3. **Acid Pools (Chemical Wave Undulation & Bubble Eruption)**:
   - Spatial-temporal wave superposition combined with sudden bright bubble pop spikes:
     $$\text{wave} = \sin(3.5 \cdot t + vWorldPos.x \cdot 4.0 + vWorldPos.z \cdot 4.0 + \phi)$$
     $$\text{pop} = \text{pow}(\max(\sin(8.0 \cdot t + \phi), 0.0), 12.0) \cdot 1.8$$
     $$\text{emissiveMult} = vEmissive \cdot (0.85 + 0.25 \cdot \text{wave} + \text{pop})$$

#### GLSL Implementation Code (`shaders/prop.frag`)
```glsl
// Pseudo-random hash for step flicker
float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

float compute_animated_emissive(float baseEmissive, uint mat_id, vec3 worldPos, float phaseRad, float timeSec) {
    if (baseEmissive < 0.001) return 0.0;

    // Determine animation style from material / phase properties
    // Case A: High-frequency electrical flicker (for lamps / cabinets)
    if (baseEmissive > 1.2) {
        float stepTime = floor(timeSec * 22.0 + phaseRad * 3.0);
        float stochasticFlicker = mix(1.0, step(0.20, hash11(stepTime)), 0.30);
        float hum = 1.0 + 0.06 * sin(timeSec * 60.0 * 6.28318 + phaseRad);
        return baseEmissive * stochasticFlicker * hum;
    }

    // Case B: Bioluminescent Crystal / Organic Breathing Pulse
    if (mat_id == 0u || baseEmissive > 0.8) {
        float breathe = 1.0 + 0.28 * sin(timeSec * 2.2 + phaseRad)
                            + 0.10 * cos(timeSec * 4.3 + phaseRad * 1.7);
        return baseEmissive * max(breathe, 0.05);
    }

    // Case C: Acid Pool Chemical Undulation & Bubble Bursts
    float spatialWave = sin(timeSec * 3.2 + worldPos.x * 3.5 + worldPos.z * 3.5 + phaseRad);
    float bubblePop   = pow(max(sin(timeSec * 7.5 + phaseRad * 2.5), 0.0), 10.0) * 1.5;
    return baseEmissive * (0.80 + 0.25 * spatialWave + bubblePop);
}
```

---

## Section 4: Data Structures & Pipeline Interface Specification

### 4.1 Vertex Attribute Layout & Vulkan Binding Specification

#### Updated Attribute Table (Matching `prop.vert`)
`PropInstance` stays at **32 bytes** (no structural expansion required). Locations 7 and 8 are bound to unpack `flags` and `animPhase`:

| Location | Binding | Stride / Rate | Format | Struct Field | Byte Offset | Usage in Shader |
|---|---|---|---|---|---|---|
| `loc 0` | `0` | 24 / `VERTEX` | `R32G32B32_SFLOAT` | `PropVertex::pos` | `0` | Local position |
| `loc 1` | `0` | 24 / `VERTEX` | `R32G32B32_SFLOAT` | `PropVertex::normal` | `12` | Local normal |
| `loc 2` | `1` | 32 / `INSTANCE` | `R32G32B32_SFLOAT` | `PropInstance::origin` | `0` | World origin |
| `loc 3` | `1` | 32 / `INSTANCE` | `R32_SFLOAT` | `PropInstance::yaw` | `12` | Y-rotation (rad) |
| `loc 4` | `1` | 32 / `INSTANCE` | `R32G32B32_SFLOAT` | `PropInstance::color` | `16` | Base color RGB |
| `loc 5` | `1` | 32 / `INSTANCE` | `R8_UINT` | `PropInstance::matId` | `28` | Material ID (0-30) |
| `loc 6` | `1` | 32 / `INSTANCE` | `R8_UINT` | `PropInstance::emissive` | `29` | Emissive byte (0-255) |
| `loc 7` | `1` | 32 / `INSTANCE` | `R8_UINT` | `PropInstance::flags` | `30` | Bitflags (flip/glow) |
| `loc 8` | `1` | 32 / `INSTANCE` | `R8_UNORM` | `PropInstance::animPhase` | `31` | Phase (mapped 0..1 -> 0..2pi) |

#### Updated `prop_pass.cpp` Pipeline Initialization
```cpp
// Attribute descriptions in PropPass::create_pipeline()
VkVertexInputAttributeDescription attrs[9]{};
attrs[0] = {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(PropVertex,   pos)};
attrs[1] = {1, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(PropVertex,   normal)};
attrs[2] = {2, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(PropInstance, origin)};
attrs[3] = {3, 1, VK_FORMAT_R32_SFLOAT,        offsetof(PropInstance, yaw)};
attrs[4] = {4, 1, VK_FORMAT_R32G32B32_SFLOAT, offsetof(PropInstance, color)};
attrs[5] = {5, 1, VK_FORMAT_R8_UINT,           offsetof(PropInstance, matId)};
attrs[6] = {6, 1, VK_FORMAT_R8_UINT,           offsetof(PropInstance, emissive)};
attrs[7] = {7, 1, VK_FORMAT_R8_UINT,           offsetof(PropInstance, flags)};
attrs[8] = {8, 1, VK_FORMAT_R8_UNORM,          offsetof(PropInstance, animPhase)};

vi.vertexAttributeDescriptionCount = 9;
vi.pVertexAttributeDescriptions    = attrs;
```

---

### 4.2 Push Constant & Time Uniform Integration

#### `CubePush` Dead-Lane Allocation
`CubePush` is exactly 128 bytes (the Vulkan guaranteed push-constant limit). `pc.torus.w` is currently unused (`0.0f` written in `main.cpp`).
- **`pc.torus.w`**: Pass global accumulator time `uTime` (seconds as float32).

#### Host Code Update (`src/app/main.cpp`)
```cpp
// In main.cpp rendering loop before calling propPass.record():
float currentTimeSec = static_cast<float>(SDL_GetTicks()) / 1000.0f;
push.torus = vec4{kWorldExtent, kAoDirect, 0.0f, currentTimeSec};
```

---

### 4.3 Architecture Tradeoff Analysis: Instanced Attributes vs SSBO vs Push Constants

| Criteria | Per-Instance Vertex Attributes (Selected) | Storage Buffer (SSBO) | Push Constant Array |
|---|---|---|---|
| **Vulkan Limit Compliance** | Guaranteed on 100% Vulkan 1.0+ devices | Requires SSBO support & descriptor sets | Exceeds 128-byte spec limit ($4096 \times 32\text{B} = 128\text{KB}$) |
| **Pipeline Integration** | Zero descriptor set switching; uses existing VBO binding | Requires descriptor pool allocation & binding | Impossible for batch size $> 4$ instances |
| **Memory Bandwidth & Alignment** | 32 B/instance vector aligned; hardware vertex fetcher optimized | 32 B/instance std430 alignment; manual `gl_InstanceIndex` lookup | High push-constant update overhead |
| **Draw Call Speed** | Direct `vkCmdDrawIndexed` with instance count | Direct `vkCmdDrawIndexed` | Split into sub-batches of 4 instances |
| **Implementation Complexity** | Minimal (2 extra attribute descriptions) | Moderate (SSBO management & bindings) | High (batch fragmentation) |

**Conclusion**: The **Per-Instance Vertex Attribute approach** is strictly optimal for *Gigahrush2*. It fits within existing Vulkan state bindings, maintains zero descriptor set overhead, and preserves 32-byte cache line alignment.

---

## Section 5: Step-by-Step Implementation & Verification Roadmap

### Step 1: Push Constant & Time Plumbing
1. In `src/app/main.cpp`, populate `push.torus.w` with cumulative time `uTime` (seconds).
2. In `shaders/prop.vert`, read `pc.torus.w` as time and forward to `prop.frag` or read directly in `prop.frag`.

### Step 2: Attribute Binding Expansion
1. Update `shaders/prop.vert` to declare `layout(location = 7) in uint inFlags;` and `layout(location = 8) in float inAnimPhase;`.
2. Add varyings `vFlags` and `vAnimPhase` from `prop.vert` to `prop.frag`.
3. In `src/render/prop_pass.cpp`, expand `attrs` array to 9 elements adding locations 7 and 8.

### Step 3: Shader Implementation in `shaders/prop.frag`
1. Add `construct_perturbed_normal()` using finite difference triplanar gradients.
2. Replace hardcoded roughness with `compute_prop_roughness()`.
3. Replace static emissive pulse with `compute_animated_emissive()`.

### Step 4: Verification & Build Commands
- **Compile Shaders**: Run `glslangValidator -V shaders/prop.vert -o shaders/prop.vert.spv` and `glslangValidator -V shaders/prop.frag -o shaders/prop.frag.spv` (or CMake build target).
- **Build Project**: Run `cmake --build build-win --config Release`.
- **Run Audit Tests**: Execute `ctest --test-dir build-win --output-on-failure`.
