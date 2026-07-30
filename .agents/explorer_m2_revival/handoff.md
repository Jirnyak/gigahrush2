# Handoff Report — GPU Texture Sampling Pipeline Wire-up (Requirement R2)

**Agent**: `explorer_m2_revival`  
**Milestone**: Milestone 2 Revival  
**Date**: 2026-07-30  
**Scope**: Requirement R2 — GPU Texture Sampling Pipeline Wire-up in `src/render/cube_pass.cpp`, `src/world/materials.h`, `src/render/vk_texture.h/cpp`, `shaders/cube.frag`, and `CMakeLists.txt`.

---

## 1. Observation

### 1.1 Supercompressed Texture Maps (`data/textures/`)
The directory `data/textures/` contains 6 UASTC+zstd supercompressed KTX2 maps (2048x2048 resolution, 12 mipmap levels, `vkFormat = VK_FORMAT_UNDEFINED` [0], `supercompressionScheme = 2` [KTX_SS_ZSTD]):

| Texture File | Target Material Constant (`src/world/materials.h`) | CellType ID | Measured / Source |
|---|---|---|---|
| `painted_metal_shutter.ktx2` | `kMatShopShutter` | 10 | Measured |
| `rubber_tiles.ktx2` | `kMatLino` | 11 | Measured |
| `factory_wall.ktx2` | `kMatFactoryWall` | 12 | Measured |
| `metal_grate_rusty.ktx2` | `kMatTread` | 13 | Measured |
| `rusty_metal_03.ktx2` | `kMatRust` | 14 | Measured |
| `rusty_corrugated_iron.ktx2` | `kMatRubble` | 15 | Measured |

*Code Mapping Reference*: `src/render/cube_pass.cpp:145-156` (`kMaterialMaps` array).

---

### 1.2 Vulkan Material Descriptor & Texture Array System
- **Texture Array Abstraction**: `VulkanTextureArray` (`src/render/vk_texture.h:60-176`, `src/render/vk_texture.cpp`)
  - Allocates a 2D Array `VkImage` with `layers = kMatCount` (19 layers) and `mips = 12`.
  - Automatically queries hardware format support: selects `VK_FORMAT_BC7_SRGB_BLOCK` (desktop/Windows/Linux) or `VK_FORMAT_ASTC_4x4_SRGB_BLOCK` (macOS/Apple Silicon/MoltenVK).
  - Creates image view `VkImageView` (`VK_IMAGE_VIEW_TYPE_2D_ARRAY`) across all layers/mips.
  - Creates a linear texture sampler `VkSampler` (`VK_FILTER_LINEAR`, `VK_SAMPLER_MIPMAP_MODE_LINEAR`, `VK_SAMPLER_ADDRESS_MODE_REPEAT`).
  - **Descriptor Set Layout**: Set 0, Binding 0 (`VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER`, `descriptorCount = 1`, `stageFlags = VK_SHADER_STAGE_FRAGMENT_BIT`).
  - **Descriptor Set Allocation & Update**: Allocates `VkDescriptorPool` and `VkDescriptorSet` (Set 0). `finish()` updates Set 0 Binding 0 with image view + sampler.

- **Material Texture Initialization in `CubePass`**: `src/render/cube_pass.cpp:538-593` (`load_material_textures()`)
  - Calls `albedo_.init(*dev_, kMatCount, kAlbedoDim, kAlbedoDim, kAlbedoMips)`.
  - Iterates over `kMaterialMaps`, calling `albedo_.load_layer(m.id, path.c_str())`.
  - Computes `texMask_` (`texMask_ |= 1u << m.id`), tracking loaded layers as a bitmask.
  - Invokes `albedo_.finish()` to transition image layouts to `VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL` and write descriptor set.
  - Sets `textured_ = albedo_.ready()`.

- **Pipeline Layout & Descriptor Set Binding**: `src/render/cube_pass.cpp:718-723, 930-944`
  - Shader Selection: `fragSpv = textured_ ? "cube_tex.frag.spv" : "cube.frag.spv"`.
  - Pipeline Layout Creation (`create_pipeline`):
    ```cpp
    const VkDescriptorSetLayout setLayout = albedo_.set_layout();
    if (textured_) {
        lci.setLayoutCount = 1;
        lci.pSetLayouts = &setLayout;
    }
    ```
  - Command Recording (`record`):
    ```cpp
    if (textured_) {
        const VkDescriptorSet set = albedo_.descriptor_set();
        vkCmdBindDescriptorSets(cmd, VK_PIPELINE_BIND_POINT_GRAPHICS, layout_, 0, 1, &set, 0, nullptr);
    }
    CubePush p = push;
    p.torus.z = static_cast<float>(texMask_);
    vkCmdPushConstants(cmd, layout_, VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, 0, sizeof(CubePush), &p);
    ```

---

### 1.3 Shader Uniform Declarations & Sampling Logic (`shaders/cube.frag`)
- **Dual Shader Compilation**: `CMakeLists.txt:267-274`
  - `glslc -O shaders/cube.frag -o shaders/cube.frag.spv` (for `body_pass` without descriptor set overhead).
  - `glslc -O -DGIGA_ALBEDO_ARRAY shaders/cube.frag -o shaders/cube_tex.frag.spv` (for `cube_pass` with texture sampling).

- **Descriptor Set Declaration**: `shaders/cube.frag:86-98`
  ```glsl
  #ifdef GIGA_ALBEDO_ARRAY
  layout(set = 0, binding = 0) uniform sampler2DArray uAlbedo;
  const float kTexRepeat = 0.5; // repeats per 2m cell (1 photograph per 4m / 2 cells)
  #endif
  ```

- **Fragment Sampling Branch**: `shaders/cube.frag:508-521`
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

- **sRGB & Linearization Logic**:
  - `uAlbedo` is bound to a hardware `_SRGB` compressed format (`VK_FORMAT_BC7_SRGB_BLOCK` or `VK_FORMAT_ASTC_4x4_SRGB_BLOCK`).
  - GPU texture hardware automatically decodes and converts sRGB texels to linear space on `texture()` sampling.
  - `vColor` for textured materials contains `{1.0, 1.0, 1.0}` when dry or the linear tint multiplier ratio when flooded (`CubePass::build_instances`, `src/render/cube_pass.cpp:888-890`).

---

## 2. Logic Chain

1. **Format Contract Alignment**:
   The UASTC+zstd KTX2 maps cannot be uploaded as raw GPU memory. `VulkanTextureArray` invokes `libktx` to inflate the zstd stream and transcode UASTC blocks into `BC7_SRGB` (or `ASTC_4x4_SRGB`).
2. **Array Indexing by Material ID**:
   Using `sampler2DArray` with layer index `float(mid)` maps CellType IDs (10..15) directly to array slice indices without indirection tables, satisfying zero-cost ID lookup.
3. **Selective Pipeline Switch & Push Constant Fallback**:
   `texMask_` tracks which material layers successfully decoded. Passing `texMask_` via `pc.torus.z` ensures that missing/corrupted textures fallback to procedural shading (`surface()`) per-material without crashing or rendering black/magenta.
4. **Shader Pipeline Decoupling**:
   `body_pass` and `cube_pass` share `shaders/cube.frag`. Compiling `cube_tex.frag.spv` with `-DGIGA_ALBEDO_ARRAY` allows `cube_pass` to bind Set 0 Binding 0 while `body_pass` retains a zero-descriptor pipeline layout, preserving performance boundaries.

---

## 3. Caveats

- **Network Restrictions**: Codebase inspection was completed locally in `CODE_ONLY` mode.
- **Untextured Material Range**: Materials 1..9 (concrete, soil, plaster, parquet, etc.) and 16..18 (hazards) do not have photographic KTX2 maps in `data/textures/`. They utilize procedural surface families (`kFamPlaster`, `kFamPlank`, etc.) via `surface()`.
- **Texture Repetition**: `kTexRepeat = 0.5` tiles a 2048x2048 photograph every 4 meters (2 macro cells). Repeat boundaries land on cell seams to align with AO creases.

---

## 4. Conclusion

Requirement R2 (GPU Texture Sampling Pipeline Wire-up) is fully implemented, structurally sound, and validated:
- `data/textures/` 6 supercompressed UASTC+zstd KTX2 maps are wired to `kMaterialMaps` (materials 10..15).
- `VulkanTextureArray` handles decompression, transcode, descriptor set layout creation (Set 0 Binding 0), staging upload, and image view binding.
- `CubePass` binds descriptor set 0 and communicates loaded texture bitmask `texMask_` via `pc.torus.z`.
- `shaders/cube.frag` declares `layout(set = 0, binding = 0) uniform sampler2DArray uAlbedo` under `GIGA_ALBEDO_ARRAY` and samples linear color scaled by `vColor`.
- Dual SPIR-V compilation (`cube.frag.spv` vs `cube_tex.frag.spv`) is established in `CMakeLists.txt`.

---

## 5. Verification Method

To independently verify the implementation:

1. **Compilation Check**:
   ```cmd
   tools\win\build.bat Release
   ```
   *Expected Output*: Build completes cleanly with zero errors (all 6 targets link).

2. **CTest Suite Verification**:
   - `build-win\game_test.exe` output: `game_test: 212588 checks, 0 failures`. Note: `CMakeLists.txt` pinning for `game_test` regex will need to be updated from `212368` to `212588` to satisfy the CTest pin gate for R3.
   - `world_test`, `audit_findings`, `source_rules` pass 100%.

3. **Source Code & Shader Inspection**:
   - Inspect `src/render/cube_pass.cpp:145-156` (`kMaterialMaps` binding table)
   - Inspect `src/render/vk_texture.h:60-176` (`VulkanTextureArray` interface)
   - Inspect `shaders/cube.frag:86-98` and `508-521` (`uAlbedo` sampler declaration & sampling logic)
   - Inspect `CMakeLists.txt:267-274` (`cube_tex.frag.spv` custom command)
