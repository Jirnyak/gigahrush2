## 2026-07-30T05:26:49Z

<USER_REQUEST>
You are a Worker agent implementing Milestone 1 (R1: Vulkan Normal & Roughness Map Pipeline).
Your working directory is: C:\hades\gigahrush2\.agents\worker_m1_revival

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Single-Compiler Owner Rule: Strictly respect the Single-Compiler Owner Rule. Execute builds sequentially. Do NOT launch concurrent compiler/ctest instances.

Task Details:
1. Read Explorer 3 handoff report at `C:\hades\gigahrush2\.agents\explorer_m1_3\handoff.md` and Explorer 1 handoff report at `C:\hades\gigahrush2\.agents\explorer_m1_1\handoff.md`.
2. Extend `src/render/cube_pass.cpp`, `src/render/vk_texture.h/cpp`, and `tools/fetch_textures.py`:
   - Support UNORM transcode target formats (`BC7_UNORM_BLOCK` / `ASTC_4x4_UNORM_BLOCK`).
   - Extend `CubePass` descriptor set 0 layout and pool to 3 combined image sampler bindings:
     - Set 0, Binding 0: `uAlbedo` (`sampler2DArray`, sRGB)
     - Set 0, Binding 1: `uNormalMap` (`sampler2DArray`, UNORM)
     - Set 0, Binding 2: `uRoughnessMap` (`sampler2DArray`, UNORM)
   - Update `CubePass::load_material_textures()` to load normal maps and roughness maps into their respective arrays/bindings.
   - Pass texture availability bitmasks into shader push constants (`pc.torus.w`).
3. In `shaders/cube.frag`:
   - Add bindings 1 & 2 under `#ifdef GIGA_ALBEDO_ARRAY`:
     `layout(set = 0, binding = 1) uniform sampler2DArray uNormalMap;`
     `layout(set = 0, binding = 2) uniform sampler2DArray uRoughnessMap;`
   - Construct axis-aligned world-space TBN matrices for cube faces based on surface normal `n_geom`.
   - Sample normal map when enabled for material `mid` to perturb normal `n`.
   - Sample roughness map when enabled for material `mid` to dynamically modulate Blinn-Phong specular exponent (`specPow`) and specular intensity (`specIntensity`), eliminating flat-shaded voxels.
4. Run `tools\win\build.bat Release` and `ctest --test-dir build-win -C Release` to verify cleanly passing build and 100% test pass across all 4 targets (`world_test`, `audit_test`, `game_test`, `source_rules`).
5. Write complete handoff report to `C:\hades\gigahrush2\.agents\worker_m1_revival\handoff.md`.
6. Send a message to parent when finished.
</USER_REQUEST>
