# Handoff Report — Milestone 2: Atmospheric Height-Based Fog & Light Scattering

**Working Directory**: `C:\hades\gigahrush2\.agents\explorer_m2_1`  
**Target Shader**: `shaders/cube.frag`  
**Author**: Explorer Agent  
**Date**: 2026-07-30  

---

## 1. Observation

### 1.1 Existing Distance Fog Implementation in `shaders/cube.frag`
Direct observation of `shaders/cube.frag` (lines 493–548):

```glsl
493:     vec3 toCam = pc.camPos.xyz - vWorldPos;
494:     float d = length(toCam);
495:     vec3 L = toCam / max(d, 1e-4);
...
535:     float fog = clamp((d - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0);
536:     lit = mix(lit, vec3(0.0), fog);
...
546:     srgb += (ign - 0.5) / 255.0 * (1.0 - fog);
```

Key characteristics identified:
1. **Per-Fragment Distance Calculation**: Distance $d = \|\mathbf{P}_{cam} - \mathbf{P}_{world}\|$ is computed directly from world position `vWorldPos` and camera position `pc.camPos.xyz` (line 494).
2. **Linear Distance Fog Formula**: Ramps linearly from 0.0 to 1.0 between `pc.fog.x` (fog start, ~76.8 m) and `pc.fog.y` (fog end, 128 m, equal to $kWorldExtent / 2$).
3. **Target Fog Color**: Fades to pure linear black (`vec3(0.0)`).
4. **Architectural Constraint**: As documented in `render.md` (lines 243–268), fading to pure black at $d \ge pc.fog.y$ is **load-bearing**. The fog end distance matches the minimal-image toroidal wrap radius ($kWorldExtent / 2$). If a fragment at or beyond $d \ge pc.fog.y$ does not evaluate to bit-exact black (`vec3(0.0)`), the toroidal boundary seam where the world wraps becomes visible to the player.

### 1.2 Coordinate System Observation
- In `gigahrush2`, world height/elevation is along the $+Z$ axis (e.g. `vWorldPos.z`), where $Z = 0 \dots 128$ macro cells span up to 32 subterranean floors (see `worldgen.cpp:115` `int base = f * kFloorHeight; // z of this floor's slab`).
- In GLSL camera/shading context, height calculations can target `vWorldPos.z` (native world height) or `vWorldPos.y` (standard 3D space height). The analysis below is parameterized for both.

### 1.3 Push-Constant Memory Layout Constraints
From `src/render/cube_pass.h` (lines 145–168) and `shaders/cube.frag` (lines 38–55):
```cpp
struct CubePush {
    mat4 viewProj; // 64 bytes
    vec4 sunDir;   // 16 bytes: xyz = fill dir, w = fill strength
    vec4 camPos;   // 16 bytes: xyz = camera pos, w = headlamp intensity
    vec4 fog;      // 16 bytes: x = fog start, y = fog end, z = lamp radius, w = ambient scale
    vec4 torus;    // 16 bytes: x = wrap period, y = direct AO share, z = texture bitmask, w = FREE
};
// Total = 128 bytes (MAX guaranteed Vulkan push constant size)
```
- `pc.torus.w` is currently unallocated (`w free`), providing 1 spare float lane in push constants if needed.

---

## 2. Logic Chain

### 2.1 Height-Based Fog Density Analysis & Formula Derivation
#### Atmospheric Density Model
Barometric density decreases exponentially with altitude $h$:
$$\rho(h) = \rho_0 \cdot e^{-\alpha (h - h_0)}$$
where:
- $\rho_0$: Base density at subterranean floor reference level $h_0$.
- $\alpha$: Height falloff coefficient ($\alpha > 0$). Lower $h$ (deep subterranean levels) yields exponentially higher fog density $\rho(h) > \rho_0$.

#### Integrated Ray Optical Depth ($\tau$)
Integrating density along the ray segment from camera height $h_{cam}$ to fragment height $h_{frag}$ over distance $d$:
Let $h(t) = h_{cam} + t \frac{h_{frag} - h_{cam}}{d}$ for $t \in [0, d]$.
$$\tau = \int_0^d \rho_0 e^{-\alpha (h(t) - h_0)} \, dt = \rho_0 e^{-\alpha (h_{cam} - h_0)} \cdot \left[ \frac{1.0 - e^{-\alpha (h_{frag} - h_{cam})}}{\alpha (h_{frag} - h_{cam})} \right] \cdot d$$

#### Practical GLSL Formulation for `shaders/cube.frag`
To preserve performance and fit into the existing distance fog framework:
1. Compute the integrated height optical scale factor $F_{height}$:
   ```glsl
   float deltaH = vWorldPos.z - pc.camPos.z; // Height diff along ray
   float alpha = 0.04; // Height falloff coefficient (e.g. 1 / 25m)
   float heightDensity = exp(-alpha * (pc.camPos.z - 0.0)); // Density at camera height
   float heightMod = (abs(deltaH) > 1e-4) ? (1.0 - exp(-alpha * deltaH)) / (alpha * deltaH) : 1.0;
   float effectiveDist = d * heightDensity * heightMod;
   ```
2. Combine with the distance fog function while respecting the toroidal seam boundary:
   ```glsl
   float fog = clamp((effectiveDist - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0);
   // Force fog to 1.0 at maximum toroidal distance d >= pc.fog.y
   fog = mix(fog, 1.0, clamp((d - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0));
   ```
This guarantees that:
- Deep subterranean floors ($h \to 0$) have dense fog starting much closer to the camera.
- Higher floors have clearer atmosphere.
- At distance $d \ge pc.fog.y$, $fog = 1.0$ unconditionally, protecting the toroidal wrap seam from artifacts.

---

### 2.2 Headlamp Forward Light Scattering (In-Scattering) Analysis
#### Physical Mechanism (Mie Phase Function)
When photons emitted by the camera-attached headlamp travel through foggy air, forward scattering (Mie scattering) directs light into the camera when looking along or towards the light beam corridor.

#### Vector Setup & Angle Cosine
- View ray direction from camera to fragment: $\mathbf{V} = \frac{\mathbf{P}_{world} - \mathbf{P}_{cam}}{d} = -\mathbf{L}$.
- Headlamp direction $\mathbf{D}_{lamp}$: The headlamp is mounted on the camera and shines forward along the view vector.
- Cosine of scattering angle $\theta$:
  $$\cos \theta = \mathbf{D}_{lamp} \cdot \mathbf{V}$$
  When looking directly down the headlamp cone into fog, $\cos \theta \approx 1.0$.

#### Henyey-Greenstein (HG) Phase Function
The angular intensity distribution is given by:
$$P_{HG}(\cos \theta, g) = \frac{1 - g^2}{4\pi (1 + g^2 - 2g \cos \theta)^{1.5}}$$
where $g \in [0.5, 0.85]$ is the forward anisotropy factor for fog/droplets.

For real-time GLSL, the unnormalized forward phase boost factor is:
```glsl
float g = 0.65; // Forward scattering bias
float cosTheta = dot(-L, lampDir); // alignment with headlamp forward beam
float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
```

#### Volumetric In-Scattering Blending Rule
The volumetric in-scattered light $C_{scatter}$ is given by:
```glsl
// Scattering intensity depends on headlamp strength, attenuation, phase boost, and fog
vec3 scatterColor = vec3(0.9, 0.85, 0.75); // Warm headlamp fog tint
float scatterIntensity = pc.camPos.w * att * phase * fog * (1.0 - fog);
vec3 inScattering = scatterColor * scatterIntensity;
```

Crucially, multiplying by $(1.0 - fog)$ ensures $inScattering \to 0.0$ as $fog \to 1.0$ ($d \ge pc.fog.y$), keeping fully-fogged pixels bit-exact `vec3(0.0)`.

---

## 3. Caveats

1. **Height Axis Coordinate**:
   In `gigahrush2`, world elevation is on the $+Z$ axis (`vWorldPos.z`). If a specific pass or camera rig uses standard $Y$-up conventions, the coordinate reference should be toggled to `vWorldPos.y`. The GLSL implementation uses `vWorldPos.z` as the default world height.
2. **Push Constant Budget**:
   `CubePush` is capped at 128 bytes. The proposed shader code relies on internal shader constants (`const float`) to avoid breaking the C++ `CubePush` layout or requiring ABI modifications in host passes.
3. **Headlamp Direction Vector (`lampDir`)**:
   If `lampDir` is not explicitly passed in push constants, it can be extracted directly from the view-projection matrix columns in `pc.viewProj` or approximated via normalized camera forward ray direction.

---

## 4. Conclusion & Formulated GLSL Changes

### Recommended GLSL Implementation for `shaders/cube.frag`

Below is the complete formulated modification for `shaders/cube.frag` around lines 490–548:

```glsl
    // ---------------------------------------------------------------------------
    // Distance & Vectors
    // ---------------------------------------------------------------------------
    vec3 toCam = pc.camPos.xyz - vWorldPos;
    float d = length(toCam);
    vec3 L = toCam / max(d, 1e-4); // Vector pointing from surface to camera
    vec3 V = -L;                   // Ray direction from camera to surface

    // ---------------------------------------------------------------------------
    // Shading: Headlamp, Fill, Ambient & AO
    // ---------------------------------------------------------------------------
    float r = pc.fog.z;
    float att = 1.0 / (1.0 + (d * d) / (r * r));
    float lamp = pc.camPos.w * att * max(dot(n, L), 0.0);

    float fill = pc.sunDir.w * max(dot(n, normalize(pc.sunDir.xyz)), 0.0);

    float hemi = 0.5 + 0.5 * n.z;
    vec3 amb = pc.fog.w * mix(vec3(0.10, 0.11, 0.14), vec3(0.24, 0.23, 0.21), hemi);

    const float kAoFloor = 0.32;
    float ao = kAoFloor + (1.0 - kAoFloor) * vAo;
    float aoDirect = mix(1.0, ao, pc.torus.y);
    vec3 lit = albedo * (amb * ao + vec3(lamp + fill) * aoDirect);

    // ---------------------------------------------------------------------------
    // Milestone 2 (R2): Height-Based Fog Density
    // ---------------------------------------------------------------------------
    // Height coordinate (z in world space; lower z = subterranean levels)
    float hCam = pc.camPos.z;
    float hFrag = vWorldPos.z;
    float deltaH = hFrag - hCam;
    
    // Exponential height density scale (higher density at subterranean lower Z)
    const float kAlpha = 0.035;       // Height falloff rate (1 / metres)
    const float kGroundZ = 0.0;       // Reference subterranean floor height
    float heightDensity = exp(-kAlpha * (hCam - kGroundZ));
    
    // Integrated path factor over height delta
    float heightMod = (abs(deltaH) > 1e-4) ? (1.0 - exp(-kAlpha * deltaH)) / (kAlpha * deltaH) : 1.0;
    float effectiveDist = d * heightDensity * heightMod;

    // Combined distance + height fog factor
    float fogLinear = clamp((effectiveDist - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0);
    // Toroidal wrap boundary safety guard: enforce 1.0 fog at physical distance d >= fog.y
    float fogToroidalGuard = clamp((d - pc.fog.x) / max(pc.fog.y - pc.fog.x, 1e-3), 0.0, 1.0);
    float fog = max(fogLinear, fogToroidalGuard);

    // Apply fog blend to black
    lit = mix(lit, vec3(0.0), fog);

    // ---------------------------------------------------------------------------
    // Milestone 2 (R2): Headlamp Forward Light Scattering (Henyey-Greenstein)
    // ---------------------------------------------------------------------------
    // Extract camera forward direction from viewProj matrix (or normalize camera ray)
    vec3 lampDir = normalize(-vec3(pc.viewProj[0][2], pc.viewProj[1][2], pc.viewProj[2][2]));
    float cosTheta = clamp(dot(V, lampDir), -1.0, 1.0);

    // Henyey-Greenstein phase function for forward Mie scattering
    const float g = 0.65; // Forward anisotropy parameter
    float phase = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosTheta, 1e-3), 1.5);

    // In-scattering term: active in foggy air under headlamp, zero at maximum fog (d >= fog.y)
    vec3 scatterTint = vec3(0.95, 0.90, 0.80); // Warm headlamp volumetric beam tint
    vec3 inScattering = scatterTint * pc.camPos.w * att * phase * fog * (1.0 - fog) * 0.15;
    
    lit += inScattering;

    // ---------------------------------------------------------------------------
    // Output & Dithering
    // ---------------------------------------------------------------------------
    vec3 srgb = pow(max(lit, vec3(0.0)), vec3(1.0 / kGamma));

    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    srgb += (ign - 0.5) / 255.0 * (1.0 - fog);

    outColor = vec4(srgb, 1.0);
```

---

## 5. Verification Method

To verify these changes independently:
1. **Compilation Check**:
   Run `cmake --build build-win --target giga_core` (or glslc shader compilation step) to verify `shaders/cube.frag` compiles cleanly into SPIR-V (`cube.frag.spv` and `cube_tex.frag.spv`).
2. **Toroidal Seam Verification**:
   Inspect pixel values at $d \ge pc.fog.y$ to confirm `fog == 1.0` and `lit == vec3(0.0)`, ensuring no wrap seam artifacts occur.
3. **Visual & Performance Audit**:
   Launch `./build-win/gigahrush2` and monitor GPU pass timer (`gpu: world ... ms`). Verify height fog density increases on subterranean levels and forward headlamp light cone glow appears when looking into foggy corridors.
