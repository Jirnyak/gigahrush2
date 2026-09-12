# 06 — RENDER LAYER: LEGACY & DEAD CODE AUDIT

Repo: `/Users/jirnyak/Mirror/gigahrush2` @ `97bdf13e` (branch `torus`), verified **2026-08-17**.
Scope: `src/render/` (10 625 LOC incl. headers), `shaders/` (3 707 LOC), `render.md`, `ddalight.md`.
All file:line references were re-verified against the working tree today. Nothing below is taken from a doc.

---

## 0. Executive summary of the biggest finds

| # | Finding | Class | Evidence |
|---|---|---|---|
| A | **`cube_tex.frag.spv` is compiled every build and loaded by NOBODY** | DEAD | `CMakeLists.txt:358-365` builds it; `grep '\.spv' src/` (see §2) shows no loader |
| B | **The "deleted" analytic headlamp is alive in 3 shaders** — and the owner banned camera light | LEGACY/DUPLICATE | `shaders/wire.frag:21`, `cloth.frag:23`, `particle.frag:27-28` vs `src/app/main.cpp:209-211` |
| C | **Two independent CRT systems run simultaneously**, with two independent toggles | DUPLICATE | `shaders/post_pass.frag:83-102` + `src/render/imgui_layer.cpp:199-258` |
| D | **Three divergent copies of the procedural-surface shading core** (~700 lines) | DUPLICATE | `cube.frag:132-509`, `raymarch.frag:288-559`, `prop.frag:37-106` |
| E | **`VoxelMirror::mark_fluid_dirty()` has zero callers** → fluid tint frozen at floor-load | UNWIRED | `src/render/voxel_mirror.h:144`; consumer `shaders/raymarch.frag:586` |
| F | **`GpuGasPass::current_gas_buffer()` has zero callers** — a 2 M-cell dispatch/frame for one probed scalar | UNWIRED | `src/render/gpu_gas_pass.h:42`; only consumer `sample_cell` (2 call sites) |
| G | **`GpuCullPass::get_shape_aabb()` is a no-op**, and the AABB it pushes is never read by `cull.comp` | DEAD-UNIFORM | `gpu_cull_pass.cpp:240-247`, `cull.comp` never reads `boxMinExt.xyz`/`boxMaxParams.xyz` |
| H | **`GridPush.camPos` (16 B) + `params.x` + `params.y` pushed every frame, never read in GLSL** | DEAD-UNIFORM | `gpu_light_grid.cpp:275,288` vs `shaders/light_grid.comp` |
| I | **`prop.frag` computes a permanent samosbor pulse of ≈0.25 from a hardcoded `128.0`** | LEGACY BUG | `shaders/prop.frag:254` |
| J | **`#pragma warning(push)` twice, `pop` once** in a public header — MSVC warning-state leak | LEGACY | `src/render/gpu_light_grid.h:12,70,134` |

---

## 1. Pass inventory

Frame recording is `src/app/main.cpp:6718-7036`. `VulkanRenderer` itself records only the post-pass triangle (`vk_renderer.cpp:636-655`).

### 1.1 Actual recorded order at HEAD

```
begin_frame_cmd          main.cpp:6718
  LightGrid  dispatch    main.cpp:6731
  Cull       dispatch    main.cpp:6804   (per shape, ≤4)
  Gas        dispatch    main.cpp:6837
  Wire  sim  dispatch    main.cpp:6902
  Cloth sim  dispatch    main.cpp:6933
  VoxelFlush copies      main.cpp:6943
  Particle sim dispatch  main.cpp:6953
begin_pass (scene, HDR)  main.cpp:6958
  Raymarch  draw         main.cpp:6980
  Body      draw         main.cpp:6986
  Prop      draw         main.cpp:6991
  Wire/Cloth/Particle    main.cpp:6996-7000
begin_post_pass          main.cpp:7019   (ends scene pass, opens swapchain pass, draws CRT tri)
  ImGui                  main.cpp:7021
end_frame                main.cpp:7036
```

### 1.2 Table

| Pass | File | LOC (.cpp) | Recorded at HEAD? | Fed by | Output consumed by | VERDICT |
|---|---|---|---|---|---|---|
| **CubePass** | `cube_pass.cpp` | 287 | **NO — has no `record()` at all** | KTX2 texture pack, `data/materials.csv` | Lends `texture_set_layout`/`pipeline_layout` to RaymarchPass + PropPass | **NOT A PASS** — misnamed material/layout holder. Header even says so (`cube_pass.h:1-15`). Rename to `MaterialSet`. |
| **RaymarchPass** (world) | `raymarch_pass.cpp` | 412 | YES `main.cpp:6980` | VoxelMirror 8 SSBOs + MarchUbo + light grid set 1 + tex set 2 | HDR colour + `gl_FragDepth` (raster passes depth-test against it) | **LIVE** |
| **BodyPass** | `body_pass.cpp` | 326 | YES `main.cpp:6986` | ECS `Transform/AABB/Renderable` | HDR colour | **LIVE** |
| **PropPass** | `prop_pass.cpp` | 368 | YES `main.cpp:6991` | `merge_ecs_prop_meshes` | HDR colour | **LIVE** (dual path: MDI + CPU fallback) |
| **GpuCullPass** | `gpu_cull_pass.cpp` | 249 | YES `main.cpp:6804` | PropPass instance buffers | `culledInstBufs_` + indirect cmd → `vkCmdDrawIndexedIndirect` (`prop_pass.cpp:322`) | **LIVE** |
| **GpuLightGrid** | `gpu_light_grid.cpp` | 335 | YES `main.cpp:6731` | `collect_scene_lights` (main.cpp:198+) | set 1 of raymarch/cube/prop; `surface_light`, `march_volumetric_fog` | **LIVE** |
| **GpuGasPass** | `gpu_gas_pass.cpp` | 308 | YES `main.cpp:6837` | `kGasField` seed on floor entry | **Only** `probeBuffer_` → `sample_cell` (main.cpp:5090, 5550). `current_gas_buffer()` **never called**, no shader binds the gas SSBO | **OUTPUT UNWIRED** — 2 097 152-cell dispatch + 24 MiB of buffers per frame to produce **one u32**. |
| **WirePass** | `wire_pass.cpp` | 361 | YES sim 6902 / draw 6996 | antourage bake, VoxelMirror masks | HDR colour | **LIVE** |
| **ClothPass** | `cloth_pass.cpp` | 360 | YES sim 6933 / draw 6997 | antourage bake, VoxelMirror masks | HDR colour | **LIVE** |
| **ParticlePass** | `particle_pass.cpp` | 334 | YES sim 6953 / draw 7000 | `spawn()` from carve/damage/impact | HDR colour | **LIVE** |
| **VoxelMirror** (flush) | `voxel_mirror.cpp` | 657 | YES `main.cpp:6943` | CPU grid dirty queues | 8 SSBOs → raymarch set 0, shadow set 2, sim comps | **LIVE**, but its **fluid** sub-path is dead (§5.4) |
| **Post pass** | `vk_renderer.cpp:611-657` | — | YES `main.cpp:7019` | HDR target | swapchain | **LIVE** |
| **ImGuiLayer** | `imgui_layer.cpp` | 281 | YES `main.cpp:7021` | ImGui draw data | swapchain | **LIVE**; `draw_crt_overlay` is a **DUPLICATE** (§3.2) |
| **GpuTimer** | `gpu_timer.cpp` | 237 | YES (brackets) | timestamps | HUD `main.cpp:5136` | **LIVE** |
| **Screenshot** | `screenshot.cpp` | 211 | On `--shot` only | swapchain image | PNG on disk | **LIVE (tool)** |
| intro/inventory/conversation UI | 503/438/189 | — | YES (`main.cpp:6552`, `5859`, `6323`) | — | ImGui | **LIVE** (but misfiled: pure ImGui gameplay UI living in `src/render/`) |

**Top finding of §1:** `CubePass` is constructed (`main.cpp:1651`), destroyed 4× on error paths, but has **no record method whatsoever** — `grep -n "record" src/render/cube_pass.{h,cpp}` returns one hit and it is a comment (`cube_pass.h:47`). Meanwhile three headers still instruct callers to "call `record()` … after `CubePass::record()`" (`prop_pass.h:11-12`, `:48-50`, `raymarch_pass.h:3`).

---

## 2. Shader liveness

CMake block: `CMakeLists.txt:251-378`.

| Shader | Compiled | SPIR-V loaded at | VERDICT |
|---|---|---|---|
| `cube.frag` | yes (`CMakeLists.txt:256`) | `body_pass.cpp:114`; fallback `prop_pass.cpp:113` | LIVE (body pass only) |
| `cube.frag` → **`cube_tex.frag.spv`** (`-DGIGA_ALBEDO_ARRAY`) | yes `CMakeLists.txt:358-365` | **NOWHERE** | **DEAD — pure deletion** |
| `body.vert` | yes | `body_pass.cpp:113` | LIVE |
| `prop.vert` / `prop.frag` | yes | `prop_pass.cpp:106,109` | LIVE |
| `raymarch.vert` | yes | `raymarch_pass.cpp:252` | LIVE |
| `raymarch.frag` | yes | `raymarch_pass.cpp:256` (procedural branch) | LIVE |
| `raymarch.frag` → `raymarch_tex.frag.spv` | yes `CMakeLists.txt:370-377` | `raymarch_pass.cpp:256` when `textured_` | LIVE (6 KTX2 packs present in `data/textures/`) |
| `wire.vert` / `wire.frag` | yes | `wire_pass.cpp:168-169` | LIVE |
| `cloth.vert` / `cloth.frag` | yes | `cloth_pass.cpp:169-170` | LIVE |
| `particle.vert` / `particle.frag` | yes | `particle_pass.cpp:163-164` | LIVE |
| `post_pass.vert` / `post_pass.frag` | yes | `vk_renderer.cpp:391-392` | LIVE |
| `light_grid.comp` | yes `CMakeLists.txt:280` | `gpu_light_grid.cpp:162` | LIVE |
| `gas_sim.comp` | yes | `gpu_gas_pass.cpp:168` | LIVE (output unwired, §1) |
| `wire_sim.comp` | yes | `wire_pass.cpp:133` | LIVE |
| `cloth_sim.comp` | yes | `cloth_pass.cpp:134` | LIVE |
| `particle_sim.comp` | yes | `particle_pass.cpp:128` | LIVE |
| `cull.comp` | yes | `gpu_cull_pass.cpp:118` | LIVE |
| `material_surface.glsl` (include) | dep only | included by `cube.frag:36`, `raymarch.frag:36`, `prop.frag:14` | LIVE (generated) |
| `volumetric_fog.glsl` (include) | dep only | 8 shaders (`cube/prop/raymarch .frag`, `wire/cloth/particle .vert`) | LIVE |
| `shadow_march.glsl` (include) | dep only | `cube.frag:45`, `prop.frag:23` | LIVE |
| `flicker.glsl` (include) | dep only | **`prop.frag:18` only** | LIVE but single-consumer (see §3.4) |

**Stale build artefacts in `build/shaders/`** for shaders that no longer exist in the tree: `cube.vert.spv`, `particles.comp.spv`, `prop_tex.frag.spv`. Harmless (build dir), but they prove the compile list has been edited without cleaning.

**SPEC-LIE in CMakeLists.txt:355-356:** *"`cube_pass.cpp` fails LOUDLY at init if this .spv is missing and names this block in the error"*. `CubePass::init` (`cube_pass.cpp:91-98`) reads **no SPIR-V at all** — it calls `load_material_textures()` and `create_layout()`. The stated safety net does not exist; the file is silently dead.

**SPEC-LIE in `shaders/cube.frag:86-87`:** *"If it is missing there is no cube_tex.frag.spv, and CubePass::init refuses to start"* — same false claim, second location.

---

## 3. Duplicated concepts (the key question)

### 3.1 The headlamp survived the purge — in three shaders — against an explicit owner ban

`src/app/main.cpp:209-211`:
> «Свет от камеры **ЗАПРЕЩЁН** (решение владельца 2026-08-17): НПЦ = игрок, бесплатного налобника не существует.»

And `cube.frag:608-610` / `raymarch.frag:699-701` say the analytic twin *"удалён, он учитывался дважды"*.

But it is still there, unchanged, in the three antourage/particle shaders:

| Shader | Line | Code |
|---|---|---|
| `shaders/wire.frag` | 21 | `float lamp = pc.camPos.w / (1.0 + dist*dist / max(pc.fog.z*pc.fog.z, 1e-3));` |
| `shaders/cloth.frag` | 23 | identical |
| `shaders/particle.frag` | 27-28 | identical |

And the CPU keeps feeding it every frame: `main.cpp:6962-6969` pushes `camPos.w = kLampIntensity = 2.2f` (`main.cpp:154`) and `fog.z = kLampRadius = 14.0f` (`main.cpp:155`).

**Grep proof that these are the ONLY readers:**
`grep -rn "camPos.w" shaders/` → `wire.frag:21`, `cloth.frag:23`, `particle.frag:27`, `prop.frag:232` (a comment), `cull.comp:85` (a *different* push struct, means `fogEnd`).
`grep -rn "fog\.z" shaders/` → exactly those three lines.

**Consequences, visible on screen:** cables, tarps and every particle sprite are lit by a phantom 2.2-intensity lamp at the camera that no wall, body or prop has. They read as brighter than the world and they brighten as you approach — the exact artefact class the DDA epic was written to kill.

`main.cpp:150-153` still describes this as the design ("the headlamp the player carries is the primary light"), directly contradicting line 209 in the same file, 56 lines later.

**Second, subtler camera light:** `main.cpp:242` — `grid.add_light(camPos + vec3{0,0,3}, 48.0f, alarmColor, ...)` for the samosbor alarm. A 48 m light rigidly attached to the camera, inside the collector that declares camera light banned.

### 3.2 Two CRT systems, both live, two independent kill switches

| System | Where | Effects | Toggle |
|---|---|---|---|
| **Post-pass CRT** | `shaders/post_pass.frag:19-104`, driven `vk_renderer.cpp:636-655` | barrel curvature, chromatic aberration, 8-tap bloom, scanlines (`sin(gl_FragCoord.y*π)`), RGB triad mask, vignette, phosphor wash | `renderer.crtEnabled` — `--no-crt` (`main.cpp:1571`), settings checkbox (`settings_ui.cpp:83`), save file (`main.cpp:2320`) |
| **ImGui CRT overlay** | `src/render/imgui_layer.cpp:199-258`, called `main.cpp:6715` | phosphor wash rect, scanlines (3 px `AddLine` pairs), 4-quad vignette | `GIGA_NO_CRT` env var only (`imgui_layer.cpp:201`) |

Scanlines, vignette and phosphor wash are applied **twice**, from two code paths, with two different periods (1 px vs 3 px). `imgui_layer.cpp:239` even excuses itself — *"screen curvature is too expensive a shader to fake here"* — while `post_pass.frag:27` does exactly that curvature.

**SPEC-LIE, `src/render/vk_renderer.h:14-18`:** *"Правка 1 — UI вне трубки… весь ImGui ложится в свопчейн **нетронутым**"*. False: the ImGui CRT overlay window is submitted with the rest of ImGui (`main.cpp:6715` then `7021`) and lays scanlines + vignette + green wash over the entire HUD, inventory grid and menus. The stated invariant is violated by a function in the very layer that claims it.

Authorship: the ImGui overlay's env toggle is `95f72487 marko1olo 2026-08-13 "add cached GIGA_NO_CRT toggle to ImGui CRT overlay (Spec 04 §3.2)"`, plus `e7dccb51`/`39c10f40` marko1olo CRT-glitch commits.

### 3.3 THREE divergent copies of the procedural surface core

| Primitive | `cube.frag` | `raymarch.frag` | `prop.frag` |
|---|---|---|---|
| `hash21` | 132-138 | 288-292 | 37-41 |
| `vnoise` | 141-150 | 294-303 | 43-52 |
| `grain` | 160-162 | 305-307 | 54-56 |
| `seam` | 167-172 | 309-313 | — |
| `kFam*` ×9 | 206-214 | 315-323 | 66-74 |
| `kNorm*`/`kMean*` | 222-230 | 325-333 | 76-79 (subset) |
| `mottle` | 258-260 | 335-337 | 58-60 |
| `resolved` | 266-268 | 339-341 | 62-64 |
| `surface()` | 272-435 | 345-460 | **81-106 — a completely different, simplified implementation** |
| `surface_height()` | 438-489 | 462-539 | — (has `construct_perturbed_normal` 109-143 instead) |
| `compute_grad_uv` | 491-497 | 541-547 | — |
| `apply_chroma` | 499-509 | 549-559 | **absent** |
| ACES tonemap | 666-669 | 751-753 | **absent** (`prop.frag:281` writes raw `pow(lit, 1/2.2)`) |

**They have already drifted.** `raymarch.frag`'s `surface_height` for `kFamPlaster` (lines 489-519) is a rich three-band Soviet wall with peeling enamel, trim ridge and hairline cracks; `cube.frag`'s (465-469) is a four-line stub. The file header at `raymarch.frag:9-10` claims *"SHADING PARITY IS THE CONTRACT … verbatim port of shaders/cube.frag"* — **false today**, and the drift is exactly the kind that produces "props/bodies look different from the world".

**Dead code inside the duplication** (identical in both copies — copy-pasted, then both left dead):
- `cube.frag:289-299` computes `wallColorMult` (3 branches, 3 vec3 literals) and **never uses it** — line 303 returns only `wallGloss`. Same at `raymarch.frag:358-369`.
- `cube.frag:301` computes `float stain = vnoise(uv*3.5)*0.25 + vnoise(uv*12.0)*0.15;` — **never used**. Same at `raymarch.frag:370`.
- `prop.frag:199` `uint mid = min(vMat, kMatSurfaceCount - 1u);` — **never used** in `main()`.

### 3.4 How many places define the voxel DDA / torus wrap / material lookup

**Voxel DDA loop — 2 full implementations + 3 point-samplers:**

| # | Location | What |
|---|---|---|
| 1 | `shaders/raymarch.frag:154-242` (`march_cell` + `march`) | full two-level DDA with materials/stains |
| 2 | `shaders/shadow_march.glsl:42-97` (`sm_cell_blocked` + `giga_shadow`) | same two-level DDA, occupancy only |
| 3 | `shaders/particle_sim.comp:36-40` | point solidity test |
| 4 | `shaders/wire_sim.comp:38-42` | point solidity test (identical body) |
| 5 | `shaders/cloth_sim.comp:35-39` | point solidity test (identical body) |

#1 and #2 are structurally the same algorithm with renamed symbols (`cell_index`↔`sm_cell_index`, `cell_class`↔`sm_class`, `sub_solid`↔`sm_solid`, constants `kMacroDim/kCell/kVoxel` ↔ `kSmMacroDim/kSmCell/kSmVoxel`). #3/#4/#5 are three byte-identical copies of the sub-voxel bit test.
**Unification:** move the mask/class/index accessors and the DDA skeleton into one `voxel_dda.glsl`, parameterised by descriptor set number (the trick `shadow_march.glsl:14` already uses via `GIGA_SHADOW_SET`). Saves ~120 shader LOC and, more importantly, makes it impossible for shadows and the world to disagree about geometry.

**Torus wrap — 9 definitions:**

| # | Location | Form |
|---|---|---|
| 1 | `shaders/raymarch.frag:90-93` `cell_index` | `c &= (kMacroDim-1)` |
| 2 | `shaders/shadow_march.glsl:27-30` `sm_cell_index` | identical |
| 3 | `shaders/volumetric_fog.glsl:104-107` `light_cell_index` | `& (kLightGridDim-1)` |
| 4 | `shaders/volumetric_fog.glsl:82-84` `wrap_nearest` | `d - period*floor((d+0.5p)/p)` |
| 5 | `shaders/light_grid.comp:42-45` `wrap_delta` | same maths, different name |
| 6 | `shaders/cull.comp:76-78` | inlined, three copies of the same line |
| 7 | `shaders/prop.vert:38-41` `nearest_image` | `cam + d - p*floor(d/p + 0.5)` |
| 8 | `shaders/wire.vert:31-34`, `cloth.vert:32-35`, `particle.vert:33-36` | **three byte-identical copies of #7** |
| 9 | `src/render/prop_pass.cpp:338-340` | CPU inline, hand-rolled (while `body_pass.cpp:288` correctly uses `core/wrap.h`) |
| 10 | `shaders/gas_sim.comp:124-133`, `particle_sim.comp:36`, `wire_sim.comp:38`, `cloth_sim.comp:35` | `& 127` literals |

`volumetric_fog.glsl` is already `#include`d by `wire.vert`, `cloth.vert` and `particle.vert` (for `distance_fog` only) — so `nearest_image` could be deleted from all four vertex shaders at zero cost by promoting it into that header. `prop_pass.cpp:338-340` should call `core/wrap.h` like `body_pass.cpp:288` does.

**Material lookup — 1 generated source (good) + 3 divergent consumers:**
`shaders/material_surface.glsl` (generated by `tools/gen_material_table.py`, 21 rows) is a genuine single source for `kMatFamily`/`kMatSurface`/`kMatChromaAxis`/`kMatEmissive`. Its *consumers* diverge (§3.3). Per-sub-voxel material fetch exists once (`raymarch.frag:111-117 sub_mat`). CPU albedo table once (`cube_pass.cpp:52`). **This one is fine — do not touch it.**

**Ambient terms — 2 different constants for the same hemispheric model:**
- `cube.frag:621` / `raymarch.frag:709`: `mix(vec3(0.025,0.022,0.018), vec3(0.055,0.048,0.040), hemi)`
- `prop.frag:245`: `mix(vec3(0.10,0.11,0.14), vec3(0.24,0.23,0.21), hemi)` — **4–5× brighter**, no comment, no derivation.

**Per-pass ad-hoc fog:** `distance_fog()` is genuinely unified (`volumetric_fog.glsl:75`, 6 call sites). But `cube.frag:661` and `raymarch.frag:746` add a `fogFlicker` term that `prop.frag` does **not**, and `prop.frag:283-284` adds an IGN dither that the other two do **not**. Three different final-composite tails for one fog.

**Flicker:** `flicker.glsl` is included by `prop.frag` only. `light_bake`/`collect_scene_lights` applies the CPU twin (`src/game/flicker.h`). Correct by construction — **keep**.

---

## 4. Uniform / push-constant rot

### 4.1 `CubePush` (128 B, `src/render/cube_pass.h:37-51`) — field by field

| Field | Set on CPU | Read in GLSL | Verdict |
|---|---|---|---|
| `viewProj` | `main.cpp:6961` | all vert stages + `raymarch.frag:600` | LIVE |
| `sunDir.xyz` | `main.cpp:6962` (`{0.4,0.3,0.85}`) | `cube.frag:615`, `raymarch.frag:706`, `prop.frag:225`, `cloth.frag:21` | LIVE |
| `sunDir.w` (`kFillStrength=0.02`) | `main.cpp:6962` | same + fog march fill | LIVE |
| `camPos.xyz` | `main.cpp:6963` | everywhere | LIVE |
| **`camPos.w` (`kLampIntensity=2.2`)** | `main.cpp:6964` | **only** `wire.frag:21`, `cloth.frag:23`, `particle.frag:27` | **LEGACY — the banned headlamp (§3.1)** |
| `fog.x` (start) | `main.cpp:6967` | `distance_fog`, `surface_light` budget | LIVE |
| `fog.y` (end) | `main.cpp:6968` | `march()` cap, fog, culls | LIVE |
| **`fog.z` (`kLampRadius=14`)** | `main.cpp:6969` | **only** the same three legacy frags | **LEGACY — delete with `camPos.w`** |
| `fog.w` (`kAmbient=0.06`) | `main.cpp:6969` | `cube.frag:621`, `raymarch.frag:709`, `prop.frag:245`, and as a *flat additive* in `wire/cloth/particle.frag` | LIVE (but the sprite shaders misuse it as "ambient light level") |
| `torus.x` (wrap period) | `main.cpp:6973` | 7 shaders | LIVE |
| `torus.y` (`kAoDirect=0.65`) | `main.cpp:6973` | `cube.frag:625`, `raymarch.frag:713`, `prop.frag:249` | LIVE |
| `torus.z` (samosborPulse) | `main.cpp:6973` | **body pass: never read.** raymarch: consumed via UBO then **overwritten** with `texMask_` (`raymarch_pass.cpp:387`). prop: read at `prop.frag:254`. | **PARTIAL / aliased 3 ways** |
| `torus.w` (`currentTimeSec`) | `main.cpp:6973` | body pass: `cube.frag:661` reads it as time (OK). raymarch: **overwritten** with packed masks (`raymarch_pass.cpp:392`). prop: `prop.frag:253` reads as time. | **PARTIAL / aliased 3 ways** |

**`torus.z`/`torus.w` are triple-aliased lanes** (samosborPulse | texMask | time | packedMasks) whose meaning depends on which pass is recording. `cube.frag:52-63` documents one meaning, `raymarch.frag:70-71` a second, `prop.vert:25` a third, `body.vert:21-22` says "unused here". This is a class of bug waiting to happen the next time someone reuses `cube.frag` for anything but bodies.

### 4.2 `GridPush` (`src/render/gpu_light_grid.h:57-62`) vs `shaders/light_grid.comp:31-37`

| Field | CPU value | Read in `light_grid.comp`? | Verdict |
|---|---|---|---|
| `camPos.xyz` | `gpu_light_grid.cpp:275` (real camera pos) | **NO** — `grep 'pc.camPos' shaders/light_grid.comp` → 0 hits in `main()` | **DEAD-UNIFORM (12 B)** |
| `camPos.w` | `0.0f` (`:275`) | NO | **DEAD-UNIFORM**; header comment says "max range (48.0m)" — **stale** |
| `gridMin.xyz` | `{0,0,0}` | `:82` | LIVE (but always zero — could be a constant) |
| `gridMin.w` | `4.0f` | `:81` | LIVE; header says "cell size x/z (2.0m)" — **stale** |
| `gridExt.xyz` | `{64,64,64}` | `:75` | LIVE; header says "(32), (16), (32)" — **stale** |
| `gridExt.w` | `4.0f` | `:81` | LIVE; header says "cell size y (2.0m)" — **stale** |
| `params.x` (timeSec) | `:288` | **NO** | **DEAD-UNIFORM** |
| `params.y` (31.0f) | `:288` | **NO** — shader hardcodes `31u` (`:118`, `:130`, `:155`) | **DEAD-UNIFORM**; header says "maxLightsPerCell (15)" — **stale** |
| `params.z` (uploadCount) | `:288` | `:85` | LIVE |
| `params.w` (kWorldExtent) | `:289` | `:113` | LIVE; header says "w = reserved" — **stale** |

**Every single comment in that 6-line header struct is wrong.** And `gpu_light_grid.cpp:68` prints at boot: `"[light-grid] initialized successfully (32x16x32 grid, max 256 lights)"` — the grid is 64³ and the cap is 512 (`gpu_light_grid.h:22-24,35`). A lying boot log is worse than none.

### 4.3 `CullPush` (`src/render/gpu_cull_pass.h:30`) vs `shaders/cull.comp:33-42`

| Field | CPU | Read in `cull.comp`? | Verdict |
|---|---|---|---|
| `viewProj` | `gpu_cull_pass.cpp:214` | `:94-97` | LIVE |
| `camPos.xyz` | `:215` | `:72` | LIVE |
| `camPos.w` (fogEnd) | `:215` | `:85` | LIVE |
| **`boxMinExt.xyz`** (AABB min) | `:216` from `get_shape_aabb` | **NO** — shader uses `inst.scaleAndPad.xyz` (`:113`) | **DEAD-UNIFORM (12 B)** |
| `boxMinExt.w` (torusPeriod) | `:216` | `:74` | LIVE |
| **`boxMaxParams.xyz`** (AABB max) | `:217` | **NO** | **DEAD-UNIFORM (12 B)** |
| `boxMaxParams.w` (vertexOffset) | `:217` | `:63` | LIVE |
| `objectCount` | `:218` | `:67` | LIVE |
| `indexCount` | `:218` | `:61` | LIVE |
| `firstIndex` | `:220` (always `0`) | `:62` | LIVE but constant-0 |
| `firstInstance` | `:221` (always `0`) | `:64` | LIVE but constant-0 |

**And therefore `GpuCullPass::get_shape_aabb()` (`gpu_cull_pass.cpp:240-247`) is entirely dead work**: it is a `switch` with only a `default:` arm that writes `{-1,-1,-1}`/`{1,2,1}` — the *same values* `main.cpp:6802` already assigned one line earlier — into a push lane the shader never reads. Delete the function, the call at `main.cpp:6803`, and the two push lanes.

### 4.4 `PostPush` (`vk_renderer.cpp:18-22`) vs `shaders/post_pass.frag:10-17`

| Field | CPU | GLSL | Verdict |
|---|---|---|---|
| `params0.x` (timeSec) | `vk_renderer.cpp:641` | **never read** | **DEAD-UNIFORM** |
| `params0.y` | `:642` explicitly `0.0f`, "свободный слот" | not read | dead by design (OK) — but the GLSL comment at `post_pass.frag:11` still calls it *"darkAdaptation (exposure factor)"*, contradicting `:75-77` in the same file |
| `params0.z/.w`, `params1.*` | `:643-648` | `:21,27,39,85,96,101` | LIVE |
| `resolution.xy` | `:649-650` | **never read** (only `.zw` at `:55`) | **DEAD-UNIFORM (8 B)** |
| `resolution.zw` | `:651-652` | `:55` | LIVE |
| `post_pass.vert` output `vNdc` (loc 0) | `post_pass.vert:12` | declared `post_pass.frag:3`, **never used** (`main()` uses `vUv`) | **DEAD varying** |

### 4.5 Sim push blocks

`wire_pass.cpp:40-44`, `cloth_pass.cpp:40-44`, `particle_pass.cpp:40-44` — `sim.y` and `grav.w` are documented-unused and written `0.0f`; `wire/cloth aux.z/.w` likewise. Honest and harmless, but three identical `SimPush` structs in three files is a fourth copy-paste cluster.

`GasPush.params.z` and `downStep.w` unused (`gpu_gas_pass.h:21-22`) — documented, fine.

`MarchUbo.timeParams.z/.w` reserved (`raymarch_pass.cpp:21`, `raymarch.frag:51`) — fine.

---

## 5. Dead / disabled / neutered

### 5.1 `prop.frag:254` — a hardcoded `128.0` that pins every prop at 25% samosbor forever

```glsl
float samosborPulse = pc.torus.z > 0.0 ? pc.torus.z
                    : clamp((1.0 - pc.fog.x / (128.0 * 0.30 * 2.0)) / 0.66, 0.0, 1.0);
```
With no samosbor active, `torus.z == 0` (`main.cpp:6966,6973`) so the fallback runs. `fog.x = kWorldExtent*0.25 = 64.0` (`main.cpp:6967`, `kWorldExtent = 256` from `src/world/types.h:39`). Result: `(1 - 64/76.8)/0.66 = 0.2525` — **props run at a permanent 25% samosbor pulse**: extra fog extinction, CRT props flickering as if the hazard were live. `128.0` is the pre-torus half-period literal that `problems.md §7` and `light_grid.comp:39-41` were both written to eradicate; it survived here. Also note the ternary can never select `torus.z` when the pulse is genuinely 0.

### 5.2 `#if 0` / `if (false)` — none

`grep -rn "#if 0\|if (false)\|if(false)"` over `src/render/` and `shaders/` returns **zero** hits. Good hygiene on that axis.

### 5.3 Env toggles (all real, all reachable)

| Var | Site | Effect |
|---|---|---|
| `GIGA_NO_GPU_CULL` | `main.cpp:6789` | CPU cull fallback |
| `GIGA_WIRE_NOSIM` | `main.cpp:6790` | skips wire **and cloth** sim (`:6901`, `:6932`) — name lies about scope |
| `GIGA_PARTICLE_NOSIM` | `main.cpp:6791` | skips particle sim |
| `GIGA_NO_CRT` | `imgui_layer.cpp:201` | disables ImGui overlay only, **not** the post-pass CRT |
| `GIGA_GPU_TIMER` | `gpu_timer.cpp:42` | disables timestamps |
| `GIGA_LIGHT_DBG` | `main.cpp:403` | light census |
| `GIGA_TEXTURE_DIR` | `cube_pass.cpp:33` | texture path |
| `GIGA_CUBE_MAXRUN` | **referenced by `gpu_timer.h:55` and `tools/perf_notes.md:342` — does not exist anywhere in the tree** | **SPEC-LIE** |

### 5.4 `VoxelMirror` fluid path is unwired

`mark_fluid_dirty()` (`voxel_mirror.h:144`) has **zero callers** — `grep -rn "mark_fluid_dirty" src/` returns only the declaration. `fluidDirty_` is therefore only ever *cleared* (`voxel_mirror.cpp:276`, `:500`). Consequences:
- `voxel_mirror.cpp:491-501` (the per-frame fluid re-upload) is **unreachable code**.
- The 8 MiB `fluid_` buffer is written exactly once, in `upload_all` (`voxel_mirror.cpp:268-275`).
- `raymarch.frag:586-589` tints hit cells from `uFluid[h.ci]` — so **water/puddle tint is frozen at floor-build state and can never change at runtime**, no matter what the fluid sim does.

The header comment at `voxel_mirror.h:111-113` claims this path *"retired the last regular invalidate() storm (31/s in maze mode)"* — it retired it by never running.

### 5.5 Dead public API in `src/render/`

| Symbol | File:line | External callers |
|---|---|---|
| `PropPass::use_gpu_culling()` | `prop_pass.h:66` | 0 |
| `PropPass::get_prop_positions()` | `prop_pass.h:68-75` | 0 (only tombstone comments in `prop_system.h:155,160` telling you not to use it) |
| `GpuGasPass::current_gas_buffer()` | `gpu_gas_pass.h:42-44` | 0 |
| `VoxelMirror::mark_fluid_dirty()` | `voxel_mirror.h:144` | 0 |
| `VulkanRenderer::begin_frame()` | `vk_renderer.h:105` | 0 — app uses `begin_frame_cmd`+`begin_pass` (`main.cpp:6718,6958`) |
| `GpuCullPass::get_shape_aabb()` | `gpu_cull_pass.h:73` | 1, and it is a no-op (§4.3) |

### 5.6 Dead locals in shaders

`cube.frag:289-299` (`wallColorMult`), `cube.frag:301` (`stain`), `raymarch.frag:358-369`, `raymarch.frag:370`, `prop.frag:199` (`mid`), `post_pass.frag:3` (`vNdc`). See §3.3.

---

## 6. Resources / stubs / leaks

| Item | Where | Note |
|---|---|---|
| **`fluid_` 8 MiB SSBO** | `voxel_mirror.h:114` | allocated, uploaded once, never refreshed (§5.4) |
| **`gasSSBO_[2]` 8 MiB each + `stagingBuf_` 8 MiB** | `gpu_gas_pass.cpp:44-61` | 24 MiB + a 2 097 152-cell dispatch every frame; the only consumer is a **64-byte probe buffer** reading one cell (`gpu_gas_pass.h:64-67`) |
| **`pagePool_` = 4 GiB resident** | `voxel_mirror.h:99,106` (`kPageCap = 4194304` × 1 KiB) | owner-sanctioned (`:94-98`), but the comment at `:61` still says **"768 MiB at 1 KiB per page"** — stale by 5.3× |
| **Empty dummy set-0 layouts** | `cube_pass.cpp:235-240`, `body_pass.cpp:209-214` | created solely to pad the set index so set 1 = light grid; created and destroyed immediately. Works, but it is a placeholder that has outlived its reason (set 0 is only real for the textured raymarch module) |
| **64 pre-allocated cull descriptor sets, cycled by `setHead_`** | `gpu_cull_pass.cpp:104-111`, `:190-191` | `vkUpdateDescriptorSets` on a ring with no fence tracking; 4 shapes × 2 frames = 8 in flight max, so 64 is safe *by accident*, not by contract |
| `MSVC #pragma warning imbalance` | `gpu_light_grid.h:12`, `:70` push — `:134` single pop | **warning 4324 stays disabled for every TU that includes this header** and everything after it in the same TU. Windows/Петушков seam. |
| No leaks found | `destroy()` audited in all 12 pass classes | `raymarch_pass.cpp:398-410`, `cube_pass.cpp:273-285`, `prop_pass.cpp:238-254`, `body_pass.cpp:318-324`, `gpu_light_grid.cpp:320-333`, `gpu_gas_pass.cpp:295-306`, `gpu_cull_pass.cpp:61-69`, `vk_renderer.cpp:762-789` — all balanced |

---

## 7. Authorship

`git log --format='%h %an %ad %s' --date=short -- <file>` per file, run today.

**Files CREATED by `marko1olo`** (owner considers suspect):

| File | commits | marko/Петушков | Notes |
|---|---|---|---|
| `gpu_cull_pass.{cpp,h}` | 5 / 2 | 2 / 2 | contains the dead `get_shape_aabb` + dead AABB push lanes |
| `gpu_light_grid.{cpp,h}` | 5 / 4 | 2 / 3 | contains the 3 dead push fields, the lying boot log, the pragma imbalance |
| `gpu_timer.{cpp,h}` | 2 / 3 | 2 / 2 | cites the nonexistent `GIGA_CUBE_MAXRUN` |
| `prop_mesh.{cpp,h}` | 7 / 7 | 4 / 3 | header claims 6 shapes; there are 4 (`prop_mesh.h:70-76`); `flags` bit doc wrong (`:38` says flipX/damaged/glow; `prop_system.cpp:316-319` writes a flicker profile there) |
| `prop_pass.{cpp,h}` | 11 / 11 | 7 / 8 | header claims 6 shapes and `cube.frag`; both false |
| `screenshot.{cpp,h}` | 2 / 2 | 2 / 2 | clean, and the spec-violation post-mortem in the header checks out |
| `vk_texture.{cpp,h}` | 2 / 3 | 2 / 3 | live, KTX2 decode |
| `shaders/cull.comp` | 4 | 2 | ignores the pushed AABB |
| `shaders/light_grid.comp` | 4 | 2 | (rewritten by Jirnyak in `97bdf13e`) |
| `shaders/material_surface.glsl` | 6 | 3 | GENERATED — authorship irrelevant |
| `shaders/particle.frag`, `particle.vert` | 5 / 5 | 3 / 2 | `particle.frag:27` is a surviving headlamp |
| `shaders/prop.frag`, `prop.vert` | 9 / 5 | 6 / 4 | `prop.frag:254` hardcoded `128.0` |
| `shaders/volumetric_fog.glsl` | 6 | 3 | heavily rewritten by Jirnyak in `97bdf13e` |

**Marko commits specifically touching `cull.comp` / camera / render perf:**

| Hash | Date | Subject |
|---|---|---|
| `6cc43e14` | 2026-07-30 | feat(render): implement GPU Frustum Culling Compute Shader cull.comp for Vulkan MDI |
| `b8988878` | 2026-07-30 | feat(render): integrate GpuCullPass SSBO culling, catenary wires and GPU particles |
| `2d7d9c47` | **2026-08-15** | fix(render): use X/Y extent swap for Z-axis yaw in cull.comp — this is `cull.comp:116-118`, and it is **correct** |
| `26972e1d` | 2026-07-30 | feat: implement 3D Volumetric Light Grid, Raymarched Fog & GPU Compute Particle System |
| `85ca0a90` | 2026-07-30 | fix(render): toroidal minimum-image wrap for 3D light grid |
| `ee857d22` | 2026-07-30 | feat(render): distance-based point light priority sorting in GpuLightGrid |
| `03f1ce57` | 2026-08-15 | feat(camera): allow arbitrary up vector in compute_camera for isotropic viewframes |
| `9453c2d7` | 2026-08-15 | feat(render): pass active layer gravity up_vector to compute_camera in main.cpp |
| `d1d8b9f6` | 2026-08-14 | perf(render): static scratch buffer in merge_ecs_prop_meshes |
| `d7bef71e` | 2026-08-14 | perf(sim,gpu): accelerate voxel collision with bitmasks and fix ray direction clamp |
| `4ee37928` | 2026-08-14 | fix(render): propagate swapchain creation failure during renderer recreation |
| `5a857549` | 2026-08-04 | build(render): suppress MSVC C4324 for GpuLightGrid — **this is the commit that introduced the unbalanced second `#pragma warning(push)`** (`gpu_light_grid.h:70`) |
| `95f72487` | 2026-08-13 | feat(render): add cached GIGA_NO_CRT toggle to ImGui CRT overlay — kept the duplicate CRT alive |
| `8c5343c9` | 2026-08-13 | feat(render): disambiguate samosborPulse and timeSec in RaymarchPass MarchUbo — **correct fix**, but it was only applied to `raymarch.frag`, leaving `prop.frag:254` broken |
| `0867c4fc`, `e6ab2bb7` | 2026-07-28/29 | real GPU timing / peak frames |

`Петушков А.` has **zero** commits in `src/render/` or `shaders/`; all 20 of his commits are CI/SEO/docs/concept-art on 2026-07-30.

---

## 8. Doc-vs-code

### 8.1 `render.md` (23 KB) — FALSE claims (verified today)

| render.md | Claim | Reality |
|---|---|---|
| L222-223 | `CubePush` is **112 bytes** | `src/render/cube_pass.h:52` — `static_assert(sizeof(CubePush) == 128)`. Zero headroom, not "room to spare" |
| L98-99 | "There is **no texture** in this engine and **no image decoder** — deps are EnTT/ImGui/SDL3/Vulkan, nothing else" | KTX-Software 4.4.0 is dep #5 (`CMakeLists.txt:174-177`); `src/render/vk_texture.cpp` decodes; `shaders/raymarch.frag:59-61` binds three `sampler2DArray`; six `.ktx2` packs in `data/textures/` |
| L212-218 | `cube.frag` is the **world pass** shader, with a **headlamp** on `camPos.w`/`fog.z` | World is `raymarch.frag` (`raymarch_pass.cpp:256`); props are `prop.frag` (`prop_pass.cpp:109`); headlamp deleted from all three and **banned** (`main.cpp:209-211`) |
| L263 | fog start `0.30 · kWorldExtent` (~76.8 m) | `main.cpp:6967` — `0.25f`, i.e. 64 m |
| L196-198 | `kMaterialCsvRows` is **16**, "6 of the 16 rows consumed" | `shaders/material_surface.glsl:16` — **21**; arrays are `[21]` |
| L245-248 | one LSB of IGN dither before output in `cube.frag` | `cube.frag:671` writes `outColor` raw. IGN survives only as a fog-march jitter (`volumetric_fog.glsl:216`) — and as a dither in `prop.frag:283-284` only |
| L235-243 | fragment shader writes sRGB straight into the UNORM swapchain | Two passes now: R16G16B16A16F offscreen + CRT post (`vk_renderer.h:6-13`, `vk_renderer.cpp:200-233,611-613`). Plus an undocumented ACES tonemap (`cube.frag:666-669`) |
| L49 | `begin_frame` opens the pass | `begin_frame` (`vk_renderer.h:105`) is **never called** |
| L54 | prop pass = "one `vkCmdDrawIndexed` per shape" | Primary path is `vkCmdDrawIndexedIndirect` (`prop_pass.cpp:322`); the direct draw is the fallback |
| L297-298 | HUD line is `gpu: world \| bodies \| hud \| frame` | `main.cpp:5136` also prints `props`, plus a `gpu peak:` line at `:5150` |
| L67-72, L49 | implied pass order mirror-flush → world → … → ImGui in the scene pass | Real order §1.1; ImGui is in a **separate render pass** |
| L34-59 | module list | Omits `body_pass`, `gpu_light_grid`, `gpu_cull_pass`, `gpu_gas_pass`, `vk_texture`, `prop_mesh`, `screenshot`, `material_table`, the post pass and shadow marching. `gpu_timer.h:72-83` enumerates **9** timed passes; render.md describes 3 |
| L222 | the lighting knobs ride in "otherwise-dead `w` lanes" | They are no longer dead: `torus.y/.z/.w` all carry live data (`main.cpp:6973`) and `camPos.w` is reinterpreted as `fogEnd` by `cull.comp:85` |
| L110-116, L330-343 | measured perf table ("717 638 instances", "6.71 → 6.76 ms") | UNVERIFIABLE — measured against the deleted instanced-cube mesher; there are no instances in the world pass anymore |
| L103 | "a khrushchevka is up to **255 floors** deep" | No such constant anywhere in `src/world/` |

**TRUE and worth keeping** (spot-checked): `kMaxFramesInFlight = 2` (`vk_common.h:18`); 12 MiB staging window (`voxel_mirror.h:126`); fog end `0.50·kWorldExtent` (`main.cpp:6968`); honest `gl_FragDepth` (`raymarch.frag:601`); FIFO present (`vk_swapchain.cpp:78`); median-of-31 GPU timing (`gpu_timer.h:94`); BOTTOM_OF_PIPE marks (`gpu_timer.cpp:137-157`); nine families in `gen_material_table.py:49-50`; `material_surface.glsl` in the glslc DEPENDS (`CMakeLists.txt:261`); swapchain format choice (`vk_swapchain.cpp:13-24`); far plane `kWorldExtent` (`src/sim/camera.cpp:32`); `kMaxPropInstances = 4096` (`prop_pass.h:28`); `--mirror-verify` (`main.cpp:1572`).

### 8.2 `ddalight.md` (19 KB) — FALSE claims (verified today)

| ddalight.md | Claim | Reality |
|---|---|---|
| **L38-39 (law №5)** | "растровые пассы без зеркала (cube/prop) — пока **стаб 1.0**. Это ЧЕСТНЫЙ ШОВ" | Both already march a real DDA: `cube.frag:44-45` and `prop.frag:22-23` do `#define GIGA_SHADOW_SET 2` + `#include "shadow_march.glsl"`; implementation `shadow_march.glsl:64-97`. The doc contradicts itself 115 lines later (L151-157). **The same dead text is also in the code**: `volumetric_fog.glsl:10` and `:112-113` still assert the stub, right above the `giga_shadow` prototype |
| **L15 (law №1)** | "Света от камеры **не существует**" | `wire.frag:21`, `cloth.frag:23`, `particle.frag:27` compute a camera headlamp from `pc.camPos.w`, fed every frame (`main.cpp:154`, `:6963-6964`). Plus `main.cpp:242` attaches a 48 m alarm light to `camPos` |
| L199 | "Перелив клетки (**>23**) молчит" | Cap is **31**: `gpu_light_grid.h:52`, `light_grid.comp:118`, `volumetric_fog.glsl:138`. The doc itself says 31 at L79 |
| L160 vs L173 | L160: "prop_tex (фото-пропсы) — ещё стаб"; L173: "prop_tex.frag **УДАЛЁН**" | The file does not exist; `git show --stat 97bdf13e` shows `-431` lines. One of the two lines must die |
| L135 | "[equip.h] слот Tool" | `EquipSlot::Tool` is declared in `src/game/item_table.h:77`, not `equip.h` |
| L82 | "31 DDA-луч на пиксель — **26 мс** кадра" | The shader that records the measurement says **20 ms** (`volumetric_fog.glsl:123`); 26 ms is the *binning* figure from `light_grid.comp:69`. Two measurements merged into one |

**TRUE** (spot-checked, 30+ claims): 48 B `PointLight` (`gpu_light_grid.h:45`); `-2.0` omni sentinel written / `<= -1.5` tested (`gpu_light_grid.cpp:220` vs `volumetric_fog.glsl:96`); 64³ × 4 m = 256 m = `kWorldExtent`; index `floor(p/4) & 63` (`volumetric_fog.glsl:105`); world-aligned grid, `gridMin = 0` (`gpu_light_grid.cpp:276`); 32 MiB grid SSBO; 128 B cell; `kStagingLights = 16384`, `kMaxPointLights = 512`; shadow budget 8/4/2 (`volumetric_fog.glsl:133`); contribution threshold 0.004 (`:156`); top-K by `d²/r²` (`light_grid.comp:112-133`); sorted output (`:141-151`); `giga_shadow` via `march()` (`raymarch.frag:277-281`); shadow set 2 in cube/body/prop layouts (`cube_pass.cpp:255-261`, `body_pass.cpp:223`, `prop_pass.cpp:293`); dark-adaptation removed (`main.cpp:7008-7016`, `post_pass.frag:75-77`); flicker CPU/GPU twins identical (`src/game/flicker.h:34-62` vs `flicker.glsl:29-46`); profile in `vFlags & 7u` (`prop.frag:270`); god rays gate (`volumetric_fog.glsl:273-276`); carve pre-scan rebake (`main.cpp:184-196, 4022, 4383`); `neon_tube` id 20 emissive 1.6 (`material_surface.glsl:171`); flashlight row in `data/items.csv:143`; light bake in `src/game/light_bake.cpp:42-98`.

### 8.3 Additional doc-lies found **inside the code**

| Location | Claim | Reality |
|---|---|---|
| `CMakeLists.txt:355-356` | "cube_pass.cpp fails LOUDLY at init if this .spv is missing" | `CubePass::init` reads no SPIR-V (`cube_pass.cpp:91-98`) |
| `shaders/cube.frag:86-87` | same claim | same |
| `shaders/cube.frag:6-16` | "headlamp — a camera-attached point light … This is what makes depth readable" | Deleted from this shader (`:608-610`) and banned (`main.cpp:209-211`) |
| `shaders/cube.frag:89-94` | "16 layers … Six carry a real photograph; the other ten" | 21 materials (`material_surface.glsl:68`) |
| `shaders/raymarch.frag:9-11` | "SHADING PARITY IS THE CONTRACT … verbatim port of cube.frag" | Already drifted (§3.3) |
| `src/render/vk_renderer.h:14-18` | "весь ImGui ложится в свопчейн **нетронутым**" | `imgui_layer.cpp:199-258` scanlines + vignettes the whole UI |
| `src/render/vk_renderer.h:68`, `post_pass.frag:75` | cite "[ddalight.md] закон №10" for exposure | That is law **№11** in the doc; №10 is flicker |
| `src/render/gpu_light_grid.cpp:68` | boot log "32x16x32 grid, max 256 lights" | 64³, 512 |
| `src/render/gpu_light_grid.h:58-61` | every field comment | all four wrong (§4.2) |
| `src/render/gpu_timer.h:55` | "GIGA_CUBE_MAXRUN in cube_pass.cpp" | symbol does not exist anywhere |
| `src/render/prop_pass.h:3-6` | "6 distinct prop shapes … fragment shader shared with world and body passes (cube.frag)" | 4 shapes (`prop_mesh.h:70-76`); uses `prop.frag` |
| `src/render/prop_pass.h:11-12, 48-50` | "after `CubePass::record()`" | `CubePass::record` does not exist |
| `src/render/prop_mesh.h:5-6, 66-69` | "cylinder, half-cylinder, arch, barrel, stair-step, pipe" | `Box, CylinderX, CylinderY, CylinderZ` |
| `src/render/prop_mesh.h:38` | `flags` = `bit0=flipX, bit1=damaged, bit2=glow pulse` | `prop_system.cpp:316-319` writes the **flicker profile** into bits 0-2; `prop.frag:270` reads it as such. Anyone who trusts this comment and sets flipX will silently change a lamp's flicker |
| `src/render/voxel_mirror.h:61` | page pool "**768 MiB** at 1 KiB per page" | `kPageCap = 4194304` → **4 GiB** (`:99`) |
| `src/render/voxel_mirror.h:111-113` | fluid mirror "retired the last regular invalidate() storm" | the refresh path never runs (§5.4) |
| `shaders/material_surface.glsl:4-5` | "Included by shaders/cube.frag" | also `raymarch.frag:36`, `prop.frag:14` |
| `shaders/volumetric_fog.glsl:161` | "финиш — 0.2 м до источника" | line 162 uses `d - 0.26` |
| `src/app/main.cpp:150-153` | "the headlamp the player carries is the primary light" | banned 56 lines later (`:209-211`) |
| `shaders/post_pass.frag:11` | "params0.y = darkAdaptation (exposure factor)" | `:75-77` in the same file says it is free |

### 8.4 One law violated in the code the docs do not mention

`volumetric_fog.glsl:182-186` declares: *"любой будущий пространственный градиент обязан быть ПЕРИОДИЧЕСКИМ по экстенту тора"*. Five lines later, `sample_volumetric_fog_density` (`:190`) hashes **absolute** `pos.xy * 0.15` — non-periodic, therefore discontinuous across the torus seam. The law and its violation are 5 lines apart in the same file.

---

## 9. Deletion proposal — ranked

### DELETE (no behaviour worth keeping)

| # | Item | Location | LOC | Risk |
|---|---|---|---|---|
| D1 | `cube_tex.frag.spv` build rule + the whole `GIGA_ALBEDO_ARRAY` block in `cube.frag` | `CMakeLists.txt:338-365`; `cube.frag:73-110, 551-576, 578-591, 599-603` | **~28 CMake + ~65 GLSL** | **zero** — nothing loads it |
| D2 | Analytic headlamp in the three sprite shaders + the `camPos.w` / `fog.z` push lanes + `kLampIntensity` / `kLampRadius` | `wire.frag:21`, `cloth.frag:23`, `particle.frag:27-28`; `main.cpp:154-155, 6964, 6969` | **~8** | low — pixels change (that is the point: it is the banned light) |
| D3 | `ImGuiLayer::draw_crt_overlay` + its call + `GIGA_NO_CRT` | `imgui_layer.cpp:199-258`, `imgui_layer.h`, `main.cpp:6715` | **~62** | low — post-pass CRT already does all three effects, and this one is what breaks the "UI вне трубки" invariant |
| D4 | `GpuCullPass::get_shape_aabb` + the call + `boxMinExt.xyz`/`boxMaxParams.xyz` push lanes | `gpu_cull_pass.cpp:240-247`, `gpu_cull_pass.h:73`, `main.cpp:6802-6803, 6808` | **~14** | **zero** — shader never reads them |
| D5 | `GridPush.camPos` + `params.x` + `params.y` | `gpu_light_grid.h:58,61`, `gpu_light_grid.cpp:275, 288` | **~4** | **zero** |
| D6 | `PostPush.params0.x`, `resolution.xy`, `post_pass.vert`'s `vNdc` output | `vk_renderer.cpp:641, 649-650`; `post_pass.vert:3,12`; `post_pass.frag:3` | **~6** | zero |
| D7 | Dead shader locals: `wallColorMult`+`stain` (×2), `mid` | `cube.frag:289-301`, `raymarch.frag:358-370`, `prop.frag:199` | **~28** | zero |
| D8 | Dead public API: `use_gpu_culling`, `get_prop_positions`, `current_gas_buffer`, `begin_frame` | `prop_pass.h:66,68-75`; `gpu_gas_pass.h:42-44`; `vk_renderer.h:105`, `vk_renderer.cpp:605-609` | **~22** | zero |
| D9 | Fix (not delete) the pragma imbalance | `gpu_light_grid.h:70-72` (drop the second push) | 3 | zero |
| | **DELETE subtotal** | | **≈ 240 LOC** | |

### MERGE (one general system where there are three)

| # | Item | LOC saved | Proposal |
|---|---|---|---|
| M1 | **Collapse the three shading cores into one `surface.glsl`** | **≈ 420** | `raymarch.frag:288-559` is a copy of `cube.frag:132-509`, already drifted. Move `hash21`/`vnoise`/`grain`/`seam`/`kFam*`/`kNorm*`/`mottle`/`resolved`/`surface`/`surface_height`/`compute_grad_uv`/`apply_chroma` into `shaders/surface.glsl` and include it from all three. Keep `raymarch.frag`'s richer `kFamPlaster` (`:489-519`) — it is the newer one |
| M2 | **Then shrink `cube.frag` to the body shader it actually is** | **≈ 300 more** | body.vert writes `vMat = 0u`, `vAo = 1.0` (`body.vert:60-61`), so 8 of 9 families, `surface_height`, `compute_grad_uv`, `apply_chroma` and the whole texture branch are unreachable for its only consumer |
| M3 | **One `voxel_dda.glsl`** for `raymarch.frag:154-242` + `shadow_march.glsl:42-97` + the 3 identical point-solidity tests in the sim comps | **≈ 120** | parameterise by set index, as `GIGA_SHADOW_SET` already does |
| M4 | **Promote `nearest_image` into `volumetric_fog.glsl`** (already included by all four vertex shaders) and delete the 4 copies; make `prop_pass.cpp:338-340` call `core/wrap.h` like `body_pass.cpp:288` | **≈ 22** | zero risk, kills 5 of the 9 wrap definitions |
| M5 | **One `SimPush`** shared by wire/cloth/particle instead of three identical structs | **≈ 12** | `wire_pass.cpp:40-44`, `cloth_pass.cpp:40-44`, `particle_pass.cpp:40-44` |
| M6 | **Light `wire/cloth/particle.frag` through `surface_light()`** like every other surface (they already include `volumetric_fog.glsl` for `distance_fog`) | ±0 LOC | this is the *real* fix behind D2 — one lighting law for every surface |
| M7 | **Unify the fog tail**: `fogFlicker` in cube/raymarch but not prop; IGN dither in prop but not cube/raymarch; ACES in cube/raymarch but not prop | ≈ 15 | pick one composite tail |
| M8 | **Move `intro_ui` / `inventory_ui` / `conversation_ui` (1 130 LOC) out of `src/render/`** | ±0 | they contain no Vulkan; they are gameplay ImGui. `src/render/` should be the GPU layer |
| | **MERGE subtotal** | **≈ 890 LOC** | |

### DECIDE (needs an owner call, not a mechanical delete)

| # | Item | Question |
|---|---|---|
| Q1 | **`GpuGasPass`** (308 C++ + 142 GLSL + 24 MiB + a 2 M-cell dispatch/frame) | Its output is unwired: nothing renders gas, `current_gas_buffer()` has no callers. Either **wire it into the raymarcher** (smoke/toxic tint alongside `uFluid`) or **delete the SSBO path and keep a CPU field** for the breath probe. Today you pay the full price for one `u32`/frame |
| Q2 | **`VoxelMirror` fluid** | Either call `mark_fluid_dirty()` from the fluid sim (`voxel_mirror.h:144`), or delete the 8 MiB buffer, `voxel_mirror.cpp:491-501`, and the `uFluid` tint in `raymarch.frag:586-589` |
| Q3 | **`prop.frag:254`** | Not a deletion — a **bug fix**. Push `samosborPulse` unconditionally (it already is, at `main.cpp:6973`) and delete the `128.0 * 0.30 * 2.0` fallback branch |
| Q4 | **`prop.frag` ambient** (`:245`, 4–5× brighter than cube/raymarch `:621`/`:709`) | Which one is the intended value? |
| Q5 | **`CubePass` → rename to `MaterialSet`** | It has no `record()`. Three headers instruct callers to call one |
| Q6 | **`voxel_mirror.h:99` 4 GiB `kPageCap`** | Owner already signed off (`:94-98`). Only the stale "768 MiB" comment at `:61` needs deleting |

### KEEP (verified sound — do not touch)

`shaders/material_surface.glsl` + `gen_material_table.py` (real single source, CSV-gated by `check_source_rules.cmake:436`) · `flicker.glsl` ↔ `src/game/flicker.h` twins · `distance_fog()` (genuinely one formula, 6 call sites) · `light_grid.comp` top-K binning (`:112-151`) · `gpu_timer` (honest instrument, `pass_ms` + `pass_ms_max` + `dropped()`) · `screenshot.cpp` (the capture-before-present rule at `vk_renderer.cpp:666-697` is correct and MoltenVK-safe) · `vk_renderer`'s two-pass HDR + WAR dependency (`vk_renderer.cpp:128-137`) · `voxel_mirror` dirty-queue design · `shadow_march.glsl` (new, clean, correct — just deduplicate it against `raymarch.frag`).

### Totals

| Bucket | LOC |
|---|---|
| DELETE, mechanical, zero-risk | ≈ 240 |
| MERGE, one-system-instead-of-three | ≈ 890 |
| DECIDE (Q1 alone is another ≈ 450 + 24 MiB if cut) | ≈ 450 |
| **Reachable reduction** | **≈ 1 130 – 1 580 of 14 332 LOC (8–11%)** |

The LOC number understates the win. The real payoff is that after M1–M4 there is **one** shading core, **one** DDA, **one** wrap and **one** lighting law — which is what makes the next drift impossible rather than merely undone.
