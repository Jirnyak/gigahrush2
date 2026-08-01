# Rendering — Vulkan backend & raymarched world

A minimal-but-real **Vulkan** backend (MoltenVK on macOS, LunarG on Windows) that
opens an SDL3 window and **raymarches the voxel world per pixel** — a two-level
DDA over the GPU **voxel mirror** of the same sub-voxel masks physics collides
against — under a camera-carried headlamp, with raster passes (bodies, props,
particles) over the honest depth it writes, and a Dear ImGui HUD. This is L3 —
platform side, outside `giga_core`. The instanced-cube mesher this file used to
describe was deleted 2026-08-01: there is no instance list, no remesh, and a
carve costs the renderer 64 B per dirty cell.

## Render is a pure shell — the load-bearing principle

Rendering is a **read-only graphical skin over the sim**, nothing more. It owns
no game state, mutates nothing, and makes no decision the simulation depends on.
The world, physics ([physics.md](physics.md)), macro-sim
([macrosim.md](macrosim.md)) and every gameplay rule run to completion **whether
or not anything is drawn** — the game is fully "playable" headless; render is
just the window we happen to look through. Consequences to preserve:

- Data flows **sim → render only**. The cube pass *reads* the grid, fields, and
  camera; it never writes back. Fog, culling, toroidal placement, and colours
  are all render-local — deleting them changes pixels, never outcomes.
- The camera is derived from an ordinary ECS entity ([ecs.md](ecs.md)), not a
  render object; the renderer just consumes its matrices.
- Anything gameplay must agree on (line-of-fire, reachability, what an NPC can
  "see") lives in the sim, not in what the GPU happened to rasterize. Never read
  the framebuffer or depth buffer back to answer a gameplay question.

This is why we can lean hard on procedural/shader generation for *look* without
risk: the shader is downstream of truth, never the source of it.

- **Code:** [src/render/](src/render) — `vk_device`, `vk_swapchain`,
  `vk_renderer`, `vk_buffer`, `vk_common`, `voxel_mirror`, `raymarch_pass`,
  `cube_pass` (material textures + shared layout), `imgui_layer`, `gpu_timer`
- **Shaders:** [shaders/raymarch.vert](shaders/raymarch.vert),
  [shaders/raymarch.frag](shaders/raymarch.frag) (world),
  [shaders/cube.frag](shaders/cube.frag) (bodies — same shading source the
  marcher ports) → SPIR-V via `glslc` at build time
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L3

## Modules

| Module | Responsibility |
|--------|----------------|
| `vk_device` | Instance, physical/logical device, queues, allocation helpers |
| `vk_swapchain` | Swapchain + image views, recreatable on resize, FIFO vsync |
| `vk_renderer` | Depth buffer, render pass, framebuffers, per-frame sync, acquire/submit/present. **Draw-agnostic**: `begin_frame` opens the pass, callers record, `end_frame` presents |
| `vk_buffer` | Device-local buffers (staged or empty-for-mirrors); persistently-mapped host-visible buffers |
| `voxel_mirror` | One-way sim→GPU copy of masks/types/sub-materials/class/fluid, kept fresh by the carve/door dirty seams + arrival re-uploads; `--mirror-verify` readback harness |
| `raymarch_pass` | The fullscreen two-level DDA that draws the world and writes honest `gl_FragDepth` |
| `cube_pass` | What survives of the mesher: the photographic material arrays + the shared `CubePush` pipeline layout the prop pass borrows |
| `imgui_layer` | Dear ImGui SDL3 + Vulkan overlay, own descriptor pool |
| `gpu_timer` | `VK_QUERY_TYPE_TIMESTAMP` brackets around each pass; the only honest cost number in the renderer |

Frame lifecycle is double-buffered (`kMaxFramesInFlight = 2`) with
out-of-date/resize handling driving swapchain recreation.

## The raymarched world

Each frame the mirror flushes this frame's dirty cells (64 B masks + type +
class + page bytes per cell, run-merged copies through a 12 MiB staging window),
then one fullscreen triangle DDA-marches the grid per pixel: macro steps skip
empty cells by a 1-byte class fetch, fully-solid cells hit at the entry face
with no mask read, and only boundary cells walk their 8³ bits. The hit's
material is the per-sub-voxel `sub_material` page when the cell is mixed, else
its `CellType` — the same `sub_material_at` contract the sim uses. Fog caps the
ray at `kWorldExtent/2` (64 cells), which bounds the worst case. **There is no
per-frame relationship between world mutation and render cost**: the old
invalidate()-and-rescan cycle (28–205 ms per geometry change) is gone.

## Toroidal (minimal-image) placement

The world wraps ([physics.md](physics.md) wraps entity positions), so rendering
must wrap too or the far side of the torus shows through as background
clear-colour right where the player is about to walk. The **marcher gets this by
construction**: rays walk camera-relative distance and wrap only the cell INDEX
(power-of-two AND), so every hit is automatically the nearest toroidal image.
The raster passes (bodies, props) keep the explicit `nearest_image` shift in
their vertex shaders (period `kWorldExtent`): snap the camera to its tile, then
shift each instance by whole periods into the `[-half, +half)` window around it.
The player always sees a full shell of world around them and the seam is
invisible — an endless lattice, the way a corridor that loops on itself reads
as infinite.

**Golden rule: always draw the world *around the camera*.** Never draw it at
fixed absolute coordinates. Every present/future pass must place geometry via
the same minimal-image rule so the camera sits at the centre of a full,
seamless shell.

## Surfaces are generated, not sampled

There is no texture in this engine and no image decoder to load one — the
dependency set is EnTT, Dear ImGui, SDL3 and Vulkan, nothing else. Surface detail
in [cube.frag](shaders/cube.frag) is **procedural**, and that is a design choice
rather than a workaround:

- A khrushchevka is up to **255 floors** deep. A fixed atlas gives every floor the
  same six surfaces; a position-hashed generator gives every *apartment* its own.
  That is the difference between a stack of floors and one floor copy-pasted.
- Wallpaper, parquet, tile and linoleum are parametric surfaces — grids plus noise
  — which is exactly what procedural generation is good at.
- It costs only ALU, on a GPU [performance.md](performance.md) declares unlimited,
  and touches no buffer, no descriptor and no CPU work. **Measured on the GPU
  clock: below the noise floor.** Deleting `grain` + `seam` moved the world pass
  from 6.71 ms to 6.76 ms at 717,638 instances — i.e. *up* by 0.05 ms, which is
  the run-to-run spread, so the true cost is under 0.05 ms. The ALU slope
  measured with a calibrated probe (18 µs per extra `vnoise` per frame at this
  camera) predicts ~0.04 ms for the two octaves plus the seam, which agrees.
  This pass is geometry-bound — 717,638 × 36 = **25.8 M vertices** a frame — so
  fragment ALU is not where its time goes.
  > The number this bullet used to carry was **16.6 ms before and after**, which
  > is the vsync period: FIFO present pins the frame time at the cap, so both
  > figures were the cap and the comparison could not have detected a *doubling*
  > of fragment cost. The conclusion happened to survive re-measurement; the
  > evidence never existed. Never cost a shader change with the frame-time
  > counter — use the per-pass GPU numbers below.
- Zero licensing surface. Harvesting from another project on the same machine was
  evaluated and rejected: an inventory of 1,784 images found **zero** wallpaper,
  parquet, linoleum, tile, plaster, brick or panel-seam concrete — it was a
  deep-sea game. Only its CC0 corroded-metal set is worth taking later, because
  real rust has long-range spatial correlation that FBM reproduces badly.

**UVs come from the dominant face axis, with no UV attribute.** Cube faces are
axis-aligned, so the two world coordinates that are *not* the face normal are
already a correct, non-stretching parameterisation — and because it is world-space
it stays continuous across neighbouring cells instead of restarting per cube.
Normalised so one unit is one cell, which is what lets the seam pattern land
exactly on cell boundaries.

Everything is brightness-only so a surface keeps its cell-type hue and the
faction/tier palette contract (see [monsters.md](monsters.md)) is untouched, and
multiplicative and strictly positive so nothing can lift a fogged pixel off black:

| Layer | What it does | Frequency |
|---|---|---|
| **grain** | two octaves of value noise — plaster, grit, wear | ~7 cm and ~2 cm |
| **seam** | darkened recess at cell boundaries — precast panel joins | every 2 m |
| **family** | per-material structure: ribs, planks, tiles, studs, patches | per material |

The seams are the load-bearing half of the base layer: they make the 2 m grid, and
therefore the *scale of the building*, legible. Without them a corridor is an
untextured tube.

Frequency is not cosmetic here. The first version used one cycle per 25 cm and
read as soft blotches rather than a material at the range the headlamp lights.
Hashing is integer-lattice, deliberately **not** the `sin`-based hash, which has
precision artefacts on some drivers that show up as a diagonal moiré.

## Per-material surfaces — the amount is measured, the structure is authored

For a while the grain+seam pair was **all** there was, identically for all 16
materials, so a rusted plate, dirty plaster and varnished parquet differed only in
average colour and the world read as a mosaic of tinted boxes. Meanwhile
`data/materials.csv` had carried a measured `lum_std` per material since the harvest
and nothing in the renderer read it. Two things are now per-material, and the split
between them is the point:

- **Amount is measured.** `lum_std / mean luminance` (both linear) is each
  material's luminance **coefficient of variation**, and albedo is modulated by
  `exp(sigma·n − sigma²/2)` for a zero-mean, unit-variance procedural `n`. That form
  is lognormal with mean exactly **1** — so the measured mean albedo in `kMaterial`
  survives untouched — and CV `sqrt(exp(sigma²) − 1)`, which the generator inverts to
  get sigma. Rusty corrugated iron gets 0.42 and rubber tiles 0.07 because the
  photographs say so. Note the raw `lum_std` is **absolute** and cannot be an
  amplitude directly: rubber tiles read 0.0011 and corrugated iron 0.0287, and the
  26×-larger number describes the *flatter* surface.
- **Structure is authored,** because it has to be: the CSV measured the colour
  statistics of a flat-lit photograph and holds nothing about whether a surface is
  ribbed, planked or tiled, nor how deep a groove is. Nine families — generic,
  plaster, plank, tile, ribbed, tread, rust, rubble, smooth — are declared in
  [tools/gen_material_surface.py](tools/gen_material_surface.py) and implemented in
  [cube.frag](shaders/cube.frag). Periodic families fade themselves out via
  `fwidth`, because regular structure aliases where noise merely goes grey.

Two consequences worth keeping:

- Rust's patches come from **thresholding** a low-frequency field, not from another
  FBM octave. That answers the objection recorded above — real corrosion has
  long-range spatial correlation FBM reproduces badly — and it is why no harvest is
  needed for it: an FBM sum has no edges, and edges are what make a patch a patch.
- Rust and rubble have all but identical measured amplitude (CV 0.4437 vs 0.4411), so
  amplitude alone cannot separate the two Derelict surfaces. The **family** does.
  That is the argument for structure over a single roughness dial.

The table is **generated**: `tools/gen_material_surface.py` reads
`data/materials.csv` and emits `shaders/material_surface.glsl`, which `cube.frag`
`#include`s. It is the fourth generated table in the tree and it joined the
`source_rules` CSV-drift gate in the same change as the generator. Two traps:

- the declared count is `kMaterialCsvRows` — **photographs read**, not the material
  count. Unrelated numbers that both happen to be 16 today, with only 6 of the 16
  rows consumed; comparing against the array length would make the gate blind.
- `material_surface.glsl` is listed in the glslc `DEPENDS` in `CMakeLists.txt`.
  CMake cannot see through a `#include`, so without that entry a change to the table
  leaves a stale `.spv` and looks like a no-op.

**The material id reaches the shader per sub-voxel.** The marcher reads it
straight from the mirror — `sub_material` page when the cell is mixed, else the
cell's `CellType` — and looks the albedo up in its material UBO
(`material_albedo_table`). `body.vert` writes material id `0` (the air id,
which the world never draws), whose family is `generic`, so the crowd renders
exactly as it always did.

## Shading model — the light is the one you carry

The floors are **windowless interiors**. There is no sun down here, so the model
in [cube.frag](shaders/cube.frag) — shared by the world pass and the population
pass — is built around the light the player brings:

| Term | What it is | Knob |
|------|------------|------|
| **headlamp** | camera-attached point light, `1/(1 + d²/r²)` falloff | `camPos.w` intensity, `fog.z` radius (m) |
| **fill** | weak directional backstop so geometry outside the lamp is a dim shape, not a black silhouette | `sunDir.w` strength |
| **ambient** | low hemispheric term; up-facing faces slightly brighter and cooler | `fog.w` scale |

The knobs ride in the otherwise-dead `w` lanes of `CubePush`, keeping the block at
**112 bytes** — under the 128-byte push-constant floor the Vulkan spec guarantees
and real Windows drivers report exactly. Values live as `constexpr` in
[main.cpp](src/app/main.cpp).

Why a headlamp and not a directional sun: with one directional light there are
only **six** possible `N·L` values in the entire world (six cube-face normals), so
every +Z face everywhere renders the *identical* colour. That is the literal cause
of a flat-mosaic image, and no amount of colour authoring fixes it. A point light
at the camera makes brightness vary continuously across every face and between
every cell, which also gives the frame a depth cue at every distance rather than
only where the fog starts.

Lighting is computed in **linear** space and encoded to sRGB at the end of the
fragment shader. That is not optional here: the swapchain is deliberately
`VK_FORMAT_B8G8R8A8_UNORM` in `VK_COLOR_SPACE_SRGB_NONLINEAR_KHR`
([vk_swapchain.cpp](src/render/vk_swapchain.cpp) `choose_format`), and a UNORM
format performs **no hardware encode** — the presentation engine displays exactly
what we write, as if it were already sRGB. Encoding in the shader is therefore
correct, and it leaves the ImGui pass (whose vertex colours are authored in sRGB)
untouched. Do not "fix" this by switching the swapchain to `_SRGB` without also
linearising the ImGui style, or the HUD washes out.

One LSB of interleaved-gradient-noise dither is added before output, scaled by
`(1 - fog)`. A long mid-grey-to-black ramp into an 8-bit target bands visibly, and
here the fade to black *is* the aesthetic; the `(1 - fog)` factor keeps a
fully-fogged pixel bit-exact `0` so it matches the cleared background precisely.

## Distance fog — fades to black

Depth fog is a **render-only** effect (no sim state). Fragment colour is
`mix(lit, black, fog)` where `fog` ramps `0→1` between `fog.x` and `fog.y`
(world-space distance from the camera). Distance is derived **per-fragment** from
the interpolated `vWorldPos`, not interpolated from a per-vertex distance:
interpolating a nonlinear function across a 2 m face that fills the screen up
close visibly skews the gradient, and [cube.frag](shaders/cube.frag) needs the
vector to the camera for the headlamp regardless. Current tuning (in
[main.cpp](src/app/main.cpp)):

| Knob | Value | Why |
|------|-------|-----|
| fog start | `0.30 · kWorldExtent` (~76.8 m ≈ 38 cells) | detail stays crisp up close |
| fog end / render radius | `0.50 · kWorldExtent` (128 m = **64 cells**) | full black exactly at the minimal-image radius |
| clear colour | black `(0,0,0)` | fogged geometry blends into the void with no visible horizon |
| far plane | `kWorldExtent` ([camera.cpp](src/sim/camera.cpp)) | just covers the ±half window diagonal; tighter = better depth precision |

The fog **end equals the toroidal minimal-image radius** (`kWorldExtent/2`) on
purpose: past that distance a cell would start drawing its *next* wrapped copy,
so we bury that transition inside full-black fog. The seam is unobservable and
the world reads as an endless fog-bounded volume. Fog to **black**, never blue —
a coloured horizon would betray a fixed skybox and break the "infinite interior"
feel. Tune the two `fog` distances (and matching clear colour) together; keep
`fog end ≤ kWorldExtent/2`.

## Depth clip range — resolved

`mat4_perspective` ([core/math.h](src/core/math.h)) emits Vulkan-style `[0, 1]`
depth (`m[10] = zf/(zn-zf)`, `m[14] = zn·zf/(zn-zf)`), matching a depth buffer
cleared to `1.0` and compared `LESS`. The camera flips Y for Vulkan's +Y-down
clip space ([camera.md](camera.md)). Nothing to do here; this section exists so
nobody "fixes" it twice.

## Measuring the renderer — per-pass GPU time

**The frame-time counter cannot cost a render change, and must never be used to
try.** The swapchain presents FIFO ([vk_swapchain.cpp](src/render/vk_swapchain.cpp)),
so `x.x FPS (16.6 ms)` is the vsync period whenever the machine keeps up: it is a
*cap*, blind to everything happening below it. It is also wall-clock around the
whole application — sim tick, 400–1100-body crowd, nav bake, ImGui, present wait
— so even uncapped it cannot attribute a cost to a pass.

[gpu_timer.h](src/render/gpu_timer.h) brackets each pass with
`VK_QUERY_TYPE_TIMESTAMP` queries and the HUD reports the result:

```
59.6 FPS (16.78 ms)                                        <- vsync cap, uninformative
gpu: world 6.796 | bodies 0.001 | hud 0.006 | frame 6.821 ms   <- the real cost
```

Ten milliseconds of GPU headroom that the top line could not see. Measured on an
RTX 3060 Laptop at 1280×720, floor 0, 717,638 instances, 428 bodies.

| Decision | What it is | Why |
|---|---|---|
| readback latency | `kMaxFramesInFlight` frames (2) | `acquire_frame` already waits on this slot's fence to recycle its command buffer, and that fence belongs to the submission from 2 frames ago — so the results are complete *and* the read is free. Reading sooner blocks on in-flight work and inflates the number being measured. |
| stage | `BOTTOM_OF_PIPE` on both marks | each mark is stamped when all preceding work has completed, so the interval is a real completion-to-completion span rather than a command-fetch time. |
| tick → ms | `limits.timestampPeriod` | ns per tick. Measured 1.000 here; commonly ~40 on AMD and ~52 on Intel (reported, not measured on this machine). Assuming 1 silently scales every number on most of the market. |
| counter width | queue family `timestampValidBits`, masked | fewer than 64 bits is normal; the high bits are undefined and a long session wraps. Differences are taken modulo 2^bits. |
| unsupported | `validBits == 0` → `supported() == false`, HUD reads `n/a` | verified by forcing the path: the game boots and renders normally. Instrumentation never fails a boot. |
| smoothing | **median of 31 frames** (~0.5 s) | GPU noise is one-sided — preemption only ever makes a frame slower. A mean or EMA folds one 40 ms hitch into the figure and sheds it over tens of frames; a median needs 16 of 31 frames to move, so a spike cannot lie and a real regression still lands immediately. |

`vkCmdResetQueryPool` is illegal inside a render pass, and the readback has to sit
exactly on the fence wait, so `VulkanRenderer` owns the timer and does both;
callers only wrap their own draws in `timer.pass_begin/pass_end`. Verified under
`VK_LAYER_KHRONOS_validation` with zero query-related messages.

**What the split does not mean.** A timestamp is not a barrier — it does not stop
the driver overlapping two draws, so when passes overlap the earlier one's figure
absorbs a little of the later one's. The frame total is exact regardless, and a
change in one pass's cost lands in that pass's number. Do not read the per-pass
figures as a hard partition of the frame.

### The acceptance test — it can see a 1 ms change

A timing system that reports plausible numbers but cannot detect a real change is
worse than none, because it manufactures confidence. So the readout was calibrated
against a deliberate, known fragment cost (a temporary loop of `vnoise` calls in
[cube.frag](shaders/cube.frag), mixed into the output at 0.001 so the image and
therefore the overdraw stay identical), three Release runs each:

| `cube.frag` | world pass | frame time |
|---|---|---|
| baseline | 6.77 / 6.83 / 6.93 ms | 16.78 ms |
| +55 noise iterations | 7.76 / 7.78 / 7.76 ms | 16.79 ms |
| +200 noise iterations | 10.40 / 10.52 ms | 16.80 ms |
| probe reverted | 6.73 / 6.73 / 6.68 ms | 16.78 ms |

A **+0.93 ms** change reads as a clean 0.83 ms gap between the slowest baseline run
and the fastest loaded one — no overlap, ~5× the worst run-to-run spread. So yes:
this resolves a 1 ms change at 717,638 instances, which is the size of change the
frame-time counter could not see at all. The frame-time column is the control: it
never moved, across a 55% increase in GPU frame cost.

Two cross-checks that the numbers are real and not decorative: the `bodies`
channel rose 0.001 → 0.10 → 0.24 ms across the same three builds, because
`body_pass` shares `cube.frag` and covers far fewer pixels — the cost landed in
both passes in proportion to their coverage; and `frame` tracked
`world + bodies + hud` to within 0.03 ms throughout.

Practical limits, measured: ~0.05 ms spread within a session, ~0.13 ms drift
between sessions on byte-identical shaders (GPU clock state). Compare
Release-to-Release, and treat anything under ~0.2 ms as unproven. Debug builds
read ~3× higher because the app runs slow enough for the GPU to downclock — that
is a clock artefact, not a cost.

## Security / platform note

The window/renderer is local only; there is no network surface. SDL3 is
window + input + timing only — **never** the graphics API.

## Connections

Consumes `CameraMatrices` from [camera.md](camera.md) and reads the grid
([voxels.md](voxels.md)) + `fluid` field ([fields.md](fields.md)). Driven by the
app loop ([ARCHITECTURE.md](ARCHITECTURE.md) §Simulation loop).
