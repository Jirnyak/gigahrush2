# Handoff Report — Milestone 2 (GPU Texture Sampling Pipeline Wire-up)

**Working Directory**: `C:\hades\gigahrush2\.agents\explorer_m2_next\`  
**Project Root**: `C:\hades\gigahrush2`  
**Target Requirement**: Requirement R2 — Integrate the 6 supercompressed UASTC+zstd KTX2 maps from `data/textures/` into Vulkan material descriptors in `src/render/cube_pass.cpp` and `shaders/cube.frag`.

---

## 1. Observation

### 1.1 Uncommitted Vulkan Rendering / Material Changes
In `src/world/materials.h` (lines 77–84):
```cpp
// --- Environmental hazards --------------------------------------------------
inline constexpr CellType kMatElectricGrate = 16; // Electrical floor grate
inline constexpr CellType kMatAcidPool     = 17; // Acid pool
inline constexpr CellType kMatFireCell     = 18; // Fire cell / burning floor

// One past the last id in use. The colour table is sized from this, so adding a
// material without extending the table fails the build rather than rendering as
// an unremarkable default.
inline constexpr CellType kMatCount = 19;
```
In `src/render/cube_pass.cpp` (lines 110–115):
```cpp
    /* 16 electric grate        */ {0.85f, 0.80f, 0.20f}, // yellow-sparking electrical grate
    /* 17 acid pool             */ {0.20f, 0.85f, 0.15f}, // glowing acid green
    /* 18 fire cell             */ {0.90f, 0.30f, 0.05f}, // fiery orange-red
};
static_assert(sizeof(kMaterial) / sizeof(kMaterial[0]) == kMatCount,
              "one albedo row per material id in world/materials.h");
```
- `kMatCount` has expanded from `16` to `19`.
- `CubePass::load_material_textures()` initializes `albedo_` with `kMatCount = 19` layers.
- The high-bit alignment check `static_assert(kMatCount <= (1u << (32 - kMatIdShift)), ...)` in `cube_pass.cpp` passes because `kMatIdShift = 27`, reserving 5 bits for material IDs (holding up to 32 material IDs).

### 1.2 Texture File Details (`data/textures/`)
The `data/textures/` directory contains exactly 6 `.ktx2` texture maps corresponding to 6 cell material IDs:
1. `painted_metal_shutter.ktx2` (4,175,988 B) -> Material 10 (`kMatShopShutter`)
2. `rubber_tiles.ktx2` (3,093,493 B) -> Material 11 (`kMatLino`)
3. `factory_wall.ktx2` (4,559,562 B) -> Material 12 (`kMatFactoryWall`)
4. `metal_grate_rusty.ktx2` (4,986,272 B) -> Material 13 (`kMatTread`)
5. `rusty_metal_03.ktx2` (4,866,747 B) -> Material 14 (`kMatRust`)
6. `rusty_corrugated_iron.ktx2` (4,595,391 B) -> Material 15 (`kMatRubble`)

Total payload size in repository: 26,277,453 bytes (~25.06 MiB).  
All 6 files share 1 byte-identical header signature (`\xABKTX 20\xBB\r\n\x1A\n`):
- `vkFormat`: `VK_FORMAT_UNDEFINED` (0)
- `supercompressionScheme`: 2 (`KTX_SS_ZSTD` — Zstandard stream)
- DFD Model: 166 (`KHR_DF_MODEL_UASTC`), `transferFunction`: 2 (`sRGB`), 128-bit UASTC LDR 4x4 texels (no alpha).
- Dimensions: 2048 x 2048 x 1, 12 mip levels (2048 down to 1x1).

*Note regarding Requirement 3 prompt wording ("albedo, normal, roughness, metallic, AO, emissive")*:
As documented in `data/textures/README.md` (lines 346–349): "Albedo only... Poly Haven also publishes Rough, AO, Displacement, nor_gl and nor_dx for every one of these assets... but there is no PBR pass to consume them yet". The 6 `.ktx2` files are 6 photographic albedo maps for the 6 material IDs (10..15), not 6 separate channel maps for a single material.

### 1.3 Vulkan Texture Descriptor & Loader Architecture (`src/render/vk_texture.*`)
- **Class**: `giga::gpu::VulkanTextureArray` (`src/render/vk_texture.h`)
- **Format selection**: Transcodes UASTC to `VK_FORMAT_BC7_SRGB_BLOCK` (desktop primary) or `VK_FORMAT_ASTC_4x4_SRGB_BLOCK` (macOS/Apple silicon).
- **Image Creation**: `VkImageCreateInfo` allocated with `imageType = VK_IMAGE_TYPE_2D`, `extent = {2048, 2048, 1}`, `mipLevels = 12`, `arrayLayers = 19` (derived from `kMatCount`).
- **Image View**: `VK_IMAGE_VIEW_TYPE_2D_ARRAY`, `subresourceRange.layerCount = 19`.
- **Sampler**: `VkSamplerCreateInfo` created with `magFilter = VK_FILTER_LINEAR`, `minFilter = VK_FILTER_LINEAR`, `mipmapMode = VK_SAMPLER_MIPMAP_MODE_LINEAR`, `addressModeU/V/W = VK_SAMPLER_ADDRESS_MODE_REPEAT`.
- **Descriptor Set Specifications**:
  - Set Layout: `set = 0`, `binding = 0`.
  - Descriptor Type: `VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER`.
  - Stage Flags: `VK_SHADER_STAGE_FRAGMENT_BIT`.
  - Written in `VulkanTextureArray::finish()` with `vkUpdateDescriptorSets`.
- **Transcode & Staging**: `load_layer()` inflates zstd + transcodes UASTC via `libktx`, re-packs levels into host-visible staging buffer, and copies to GPU image layer using `vkCmdCopyBufferToImage`.

### 1.4 Shader Uniform Definitions (`shaders/cube.frag` & `CMakeLists.txt`)
- **Dual Shader Compilation**:
  - `cube.frag.spv` compiled for `body_pass` (no descriptor sets).
  - `cube_tex.frag.spv` compiled with `-DGIGA_ALBEDO_ARRAY` for `cube_pass`.
- **Shader Sampler Uniform**:
  ```glsl
  #ifdef GIGA_ALBEDO_ARRAY
  layout(set = 0, binding = 0) uniform sampler2DArray uAlbedo;
  const float kTexRepeat = 0.5; // 2048 texels over 4 m
  #endif
  ```
- **Shader Sampling Logic**:
  ```glsl
  #ifdef GIGA_ALBEDO_ARRAY
      vec3 albedo;
      if ((uint(pc.torus.z) & (1u << mid)) != 0u) {
          albedo = texture(uAlbedo, vec3(uv * kTexRepeat, float(mid))).rgb * vColor;
      } else {
          albedo = pow(vColor, vec3(kGamma));
          albedo *= surface(vMat, uv, aw, px, g);
          albedo = apply_chroma(albedo, mid, uv, kMatSurface[mid].y);
      }
  #else
      vec3 albedo = pow(vColor, vec3(kGamma));
      albedo *= surface(vMat, uv, aw, px, g);
      albedo = apply_chroma(albedo, mid, uv, kMatSurface[mid].y);
  #endif
  ```
- **Colour-Space Integrity**:
  Hardware automatically linearizes sampled texels because the texture format is `_SRGB`. Sampled values in `uAlbedo` do NOT undergo `pow(..., vec3(kGamma))` in `cube.frag` to prevent double-gamma darkening (~2x). Procedural/untextured fallback materials retain `pow(vColor, vec3(kGamma))`.

---

## 2. Logic Chain

1. **Expansion of Material Table**:
   - Observation: `materials.h` adds materials 16, 17, 18, raising `kMatCount` to 19.
   - Deduction: `VulkanTextureArray::init` will create a `VK_IMAGE_VIEW_TYPE_2D_ARRAY` with `arrayLayers = 19`. The 6 mapped files will load into layers 10..15 (`kMatShopShutter`..`kMatRubble`), leaving layers 0..9 and 16..18 as unpopulated layers.
   - Resulting Mask: `texMask_` bitmask will be `0xFC00` (bits 10..15 set).
   - Compatibility: In `cube_pass.cpp`, `kMatIdShift = 27` provides 5 bits for material IDs (up to 32). `19 <= 32` holds, so `CubeInstance::occ` and `cellClass_` correctly encode the material ID.

2. **Pipeline Layout & Descriptor Binding**:
   - Observation: `CubePass::create_pipeline()` sets `lci.setLayoutCount = 1` and `lci.pSetLayouts = &setLayout` when `textured_` is true. `CubePass::record()` calls `vkCmdBindDescriptorSets` with set 0 when `textured_` is true.
   - Deduction: Set 0 binding 0 (`uAlbedo`) is bound for fragment shader execution during `CubePass::record()`.
   - Communication to Shader: `CubePass::record()` passes `p.torus.z = static_cast<float>(texMask_)` in the push constant block (`CubePush`). `cube_tex.frag` checks `(uint(pc.torus.z) & (1u << mid)) != 0u` to conditionally sample `uAlbedo` for materials 10..15 while maintaining the procedural fallback for all other materials.

3. **Format & Quality Guarantee**:
   - Observation: `libktx` inflates zstd payload and transcodes UASTC LDR 4x4 to `VK_FORMAT_BC7_SRGB_BLOCK` on desktop or `VK_FORMAT_ASTC_4x4_SRGB_BLOCK` on Apple silicon.
   - Deduction: The sampling hardware performs sRGB-to-linear conversion before filtering. `cube.frag` correctly bypasses the manual `pow(kGamma)` on sampled texture values.

---

## 3. Caveats

- **No PBR Channel Maps**: As documented in `data/textures/README.md`, `data/textures/` contains 6 photographic albedo maps for materials 10..15. It does not contain separate normal, roughness, metallic, AO, or emissive texture maps.
- **Anisotropy Disabled**: `VkSamplerCreateInfo::anisotropyEnable` is currently `VK_FALSE` in `vk_texture.cpp` (line 359) because `vk_device.cpp` initializes logical device features without `samplerAnisotropy = VK_TRUE`. Grazing angle textures may appear slightly blurred until enabled in `vk_device.cpp`.
- **Texture Array Layer Padding**: Layers 0..9 and 16..18 in the 19-layer 2D array are allocated in VRAM (~85.33 MiB total device memory) but contain undefined data. They are never sampled because `texMask_` (`0xFC00`) guards shader texture fetches.

---

## 4. Conclusion

The GPU Texture Sampling Pipeline (Requirement R2) is fully specified, architected, and wired across `src/render/vk_texture.*`, `src/render/cube_pass.*`, `shaders/cube.frag`, and `CMakeLists.txt`.

- **Descriptor Set Layout**: Single binding at Set 0, Binding 0 (`VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER`, `VK_SHADER_STAGE_FRAGMENT_BIT`).
- **Texture Array & Loaders**: `VulkanTextureArray` handles `kMatCount = 19` layers, loading the 6 UASTC+zstd KTX2 maps from `data/textures/` via `libktx` into array layers 10..15 with `VK_FORMAT_BC7_SRGB_BLOCK`.
- **Shader Integration**: `shaders/cube.frag` compiled with `-DGIGA_ALBEDO_ARRAY` into `cube_tex.frag.spv`. Bitmask `torus.z = 0xFC00` passed via push constants directs texture sampling for materials 10..15 and procedural detail for materials 0..9 and 16..18.
- **Uncommitted Material Changes**: Adding materials 16, 17, 18 (`kMatElectricGrate`, `kMatAcidPool`, `kMatFireCell`) and updating `kMatCount = 19` in `materials.h` and `cube_pass.cpp` is completely safe and passes all static assertions.

---

## 5. Verification Method

### 1. Build Verification
Execute the project build script or CMake/ninja:
```sh
tools\win\build.bat
```
Or manually:
```sh
cmake -S . -B build-win
cmake --build build-win --config Release
```

### 2. Automated Test Suite Verification
Run ctest to verify all unit, game, and audit tests pass:
```sh
ctest --test-dir build-win --output-on-failure
```

### 3. Texture Loading Log Audit
Launch the executable or inspect stderr logs to verify successful loading of the 6 texture maps:
```text
[cube] albedo: 6/6 materials from photographs (BC7_SRGB_BLOCK, 85.33 MiB device memory, mask 0xfc00) in X ms decode + Y ms upload
```
Confirm that no warnings or load errors are printed for `painted_metal_shutter.ktx2`, `rubber_tiles.ktx2`, `factory_wall.ktx2`, `metal_grate_rusty.ktx2`, `rusty_metal_03.ktx2`, and `rusty_corrugated_iron.ktx2`.
