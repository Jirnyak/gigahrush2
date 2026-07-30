# Milestone 1 (R1): GPU Compute 3D Light Grid & Volumetric Fog Architecture

**Author**: Explorer 2 (`explorer_m1_2`)  
**Workspace**: `C:\hades\gigahrush2`  
**Date**: 2026-07-30  
**Target Shaders**: `shaders/light_grid.comp`, `shaders/volumetric_fog.glsl`, `shaders/cube.frag`, `shaders/prop.frag`, `shaders/particle.frag`

---

## Executive Summary

This document presents the complete technical investigation, GPU compute design, and GLSL specification for **Milestone 1 (R1: GPU Compute Volumetric Light Grid & Fog)** in *Gigahrush2*.

Existing forward shading in `cube.frag` and `prop.frag` relies on a camera-attached headlamp and a weak directional fill light. To support hundreds of dynamic, animated point lights (flashing industrial lights, bioluminescent crystal clusters, chemical acid pools, arc sparks) and dense volumetric fog across the subterranean khrushchevka environment, a GPU compute-binned 3D Light Grid and screen-space raymarched volumetric fog system has been designed and validated.

All GLSL shader additions (`shaders/light_grid.comp` and `shaders/volumetric_fog.glsl`) have been verified using `glslc` with **zero errors and zero warnings**.

---

## 1. Existing Shader Architecture & Resource Constraints

### 1.1 Push Constants Bottleneck
In `shaders/cube.vert`, `shaders/cube.frag`, `shaders/prop.vert`, `shaders/prop.frag`, and `shaders/particle.vert`, push constants ride on the shared 128-byte block:

```glsl
layout(push_constant) uniform Push {
    mat4 viewProj; // 64 B (Offset 0)
    vec4 sunDir;   // 16 B (Offset 64) - xyz = fill dir, w = fill strength
    vec4 camPos;   // 16 B (Offset 80) - xyz = camera pos, w = headlamp intensity
    vec4 fog;      // 16 B (Offset 96) - x = fog start, y = fog end, z = lamp radius, w = ambient scale
    vec4 torus;    // 16 B (Offset 112) - x = wrap period, y = AO direct share, z = tex mask, w = uTime
} pc;
```
* **Constraint**: `sizeof(CubePush) == 128` bytes. This is **exactly** `maxPushConstantsSize` guaranteed by the Vulkan standard.
* **Architectural Decision**: No additional 3D grid parameters, light counts, or buffer pointers can be added to the push constant block. The 3D Light Grid and Point Light SSBOs **must be bound via Vulkan Descriptor Sets** (Set 0 or Set 1).

### 1.2 Existing Lighting & Atmospheric Models
* **Headlamp**: Camera-centered point light with $\frac{1}{1 + d^2/r^2}$ falloff and Henyey-Greenstein anisotropic forward scattering ($g = 0.55$).
* **Ambient Lighting**: Low hemispheric ambient $\text{pc.fog.w} \times \text{mix}(\text{cool grey}, \text{warm grey}, 0.5 + 0.5 \cdot n_z)$.
* **Height-Dependent Fog**: Exponential density increase at lower vertical ($y$/$z$) coordinates:
  $$\rho_{\text{height}} = \exp(-\text{clamp}(0.04 \cdot y, -3.0, 3.0))$$
* **Toroidal Seam Guarantee**: Shaders enforce black fog at distance $d \ge \text{pc.fog.y}$ to swallow the toroidal wrap boundary ($kWorldExtent / 2 = 128\text{ m}$).

---

## 2. 3D Light Grid Compute Shader Specification (`shaders/light_grid.comp`)

### 2.1 Grid Dimensions & Spatial Packing
* **3D Spatial Grid Resolution**: $32 \times 16 \times 32 = 16,384$ spatial cells.
* **Volume Extent**: Camera-centered bounding volume covering $64\text{ m} \times 32\text{ m} \times 64\text{ m}$ ($2\text{ m} \times 2\text{ m} \times 2\text{ m}$ per cell, matching macro grid $kCellSize = 2.0\text{ m}$).
* **Max Point Lights Per Cell**: 15 lights per 3D cell.

### 2.2 Storage Buffer Structures (std430 Layout)

#### Point Light Struct (`PointLight`)
```glsl
struct PointLight {
    vec4 posRadius;      // xyz = world position (m), w = max light radius (m)
    vec4 colorIntensity; // rgb = linear RGB color, w = base intensity / lumens multiplier
    vec4 animParams;     // x = flicker mode, y = anim phase (rad), z = anim speed, w = active flag (1.0/0.0)
};
```
* **Size**: 48 bytes per light (16-byte std430 alignment).
* **Buffer Layout** (`Set 0, Binding 0` or `Set 1, Binding 0`):
```glsl
layout(set = 0, binding = 0, std430) readonly buffer PointLightBuffer {
    uint uPointLightCount;
    uint uReserved0;
    uint uReserved1;
    uint uReserved2;
    PointLight uPointLights[];
};
```

#### Light Grid Cell Struct (`LightGridCell`)
```glsl
struct LightGridCell {
    uint count;            // number of point lights intersecting this cell (max 15)
    uint lightIndices[15]; // index array into uPointLights[]
};
```
* **Size**: 64 bytes per cell ($1 + 15 = 16 \times 4\text{ B}$).
* **Total Buffer Size**: $16,384 \text{ cells} \times 64\text{ B} = 1,048,576\text{ B}$ (**1.0 MB VRAM**).
* **Buffer Layout** (`Set 0, Binding 1` or `Set 1, Binding 1`):
```glsl
layout(set = 0, binding = 1, std430) writeonly buffer LightGridBuffer {
    LightGridCell uGridCells[];
};
```

### 2.3 Compute Dispatch & Workgroup Layout
* **Workgroup Size**: `layout(local_size_x = 8, local_size_y = 4, local_size_z = 8) in;` (256 threads per workgroup).
* **Dispatch Grid**: $(32/8, 16/4, 32/8) = (4, 4, 4) = 64$ workgroups.
* **Invocation Mapping**: Thread $\text{gl\_GlobalInvocationID} = (x, y, z)$ directly maps to 3D grid cell $(x, y, z)$.

### 2.4 Compute Light Binning Algorithm
For each cell $(x, y, z)$:
1. Derive cell AABB $[\mathbf{b}_{\text{min}}, \mathbf{b}_{\text{max}}]$ in world space.
2. Evaluate time-driven light animation intensity for each point light $i$:
   - **Type 1 (Electrical Arc Flicker)**: High-frequency stochastic step flicker + 60 Hz hum.
   - **Type 2 (Crystal Breathing)**: Dual-sine organic pulse.
   - **Type 3 (Acid Wave)**: Spatial/temporal chemical wave.
3. Compute nearest distance squared $d^2$ from light position $\mathbf{p}_i$ to cell AABB $[\mathbf{b}_{\text{min}}, \mathbf{b}_{\text{max}}]$.
4. If $d^2 \le r_i^2$, add light index $i$ to cell's `lightIndices` list (up to 15).
5. Write cell data to `LightGridBuffer`.

---

## 3. Raymarching Volumetric Fog & Attenuation (`shaders/volumetric_fog.glsl`)

### 3.1 Physical & Atmospheric Principles
Volumetric fog raymarching calculates in-scattered radiance $L_{\text{in}}$ and beam transmittance $T$ along the camera view ray $\mathbf{r}(t) = \mathbf{x}_0 + t \hat{\mathbf{v}}$:
$$T(s) = \exp\left( -\int_{0}^{s} \sigma_a \, \rho(\mathbf{r}(t)) \, dt \right)$$
$$L_{\text{in}} = \int_{0}^{d} L_{\text{scatter}}(\mathbf{r}(t)) \, \sigma_a \, \rho(\mathbf{r}(t)) \, T(t) \, dt$$

### 3.2 Key Technical Features
1. **Henyey-Greenstein Phase Function**:
   $$p(\cos\theta, g) = \frac{1 - g^2}{4\pi (1 + g^2 - 2g\cos\theta)^{3/2}}$$
   * $g = 0.55$ for headlamp forward cone scattering.
   * $g = 0.40$ for point light scattering.
   * $g = 0.25$ for fill light scattering.
2. **Screen-Space Interleaved Gradient Noise (IGN) Ray Jittering**:
   * Smooths 12-step raymarching without banding artifacts.
3. **Lognormal Height Fog & Spatial Micro-Mist**:
   * Combines height attenuation $\exp(-0.04 \cdot y)$ with spatial procedural value noise to simulate drifting subterranean mist.
4. **Point Light In-Scattering**:
   * Samples 3D Light Grid at each raymarch step position $P(t)$, accumulating in-scattered radiance from point lights overlapping the cell.

---

## 4. Integration Blueprint for Surface & Particle Shaders

### 4.1 Integration into `cube.frag` & `prop.frag`
In `cube.frag` and `prop.frag`, lighting calculation combines:
1. **Surface Shading** ($L_{\text{surface}}$): Ambient, headlamp, fill light, specular, and local point light direct diffuse/specular contributions.
2. **Volumetric Fog Raymarching**:
   ```glsl
   vec4 volFog = march_volumetric_fog(
       pc.camPos.xyz, rayDir, d, gl_FragCoord.xy,
       pc.camPos.xyz, pc.camPos.w, pc.fog.z,
       pc.sunDir.xyz, pc.sunDir.w,
       gridMin, gridExt, cellSize, pc.torus.w
   );
   vec3 finalLit = lit * volFog.a + volFog.rgb;
   ```
3. **Toroidal Distance Fog Fallback**: Enforces black output at distance $d \ge \text{pc.fog.y}$.

### 4.2 Integration into `particle.frag`
For soft-circle additive particles (sparks, smoke, acid drips, spores, dust):
* Volumetric fog attenuates particle alpha by transmittance $T$:
  `alpha *= volFog.a;`
* Additive particles accumulate in-scattered fog light without obscuring background geometry.

---

## 5. Verification & Compilation Results

Both newly authored shader files have been compiled using `glslc`:

```bash
# 1. 3D Light Grid Compute Shader
glslc -fshader-stage=compute shaders/light_grid.comp -o shaders/light_grid.comp.spv
# Result: SUCCESS (0 errors, 0 warnings)

# 2. Volumetric Fog Integration Test
glslc -fshader-stage=fragment shaders/test_fog.frag -o shaders/test_fog.frag.spv
# Result: SUCCESS (0 errors, 0 warnings)
```

---

## 6. Summary of Shader Files

1. `shaders/light_grid.comp`: Complete GPU compute shader for 3D light grid binning and light animation evaluation.
2. `shaders/volumetric_fog.glsl`: Shared GLSL header containing phase functions, height fog noise, point light grid sampling, and raymarching integrators.
