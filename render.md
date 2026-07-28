# Rendering — Vulkan backend & cube pass

A minimal-but-real **Vulkan** backend (MoltenVK on macOS) that opens an SDL3
window and draws the visible world as **instanced cubes** with a directional sun
and a Dear ImGui HUD. This is L3 — platform side, outside `giga_core`.

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
  `vk_renderer`, `vk_buffer`, `vk_common`, `cube_pass`, `imgui_layer`
- **Shaders:** [shaders/cube.vert](shaders/cube.vert),
  [shaders/cube.frag](shaders/cube.frag) → SPIR-V via `glslc` at build time
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L3

## Modules

| Module | Responsibility |
|--------|----------------|
| `vk_device` | Instance, physical/logical device, queues, allocation helpers |
| `vk_swapchain` | Swapchain + image views, recreatable on resize, FIFO vsync |
| `vk_renderer` | Depth buffer, render pass, framebuffers, per-frame sync, acquire/submit/present. **Draw-agnostic**: `begin_frame` opens the pass, callers record, `end_frame` presents |
| `vk_buffer` | Device-local (staged) buffers for static geometry; persistently-mapped host-visible buffers for per-frame instance data |
| `cube_pass` | The instanced-cube pipeline that draws the world |
| `imgui_layer` | Dear ImGui SDL3 + Vulkan overlay, own descriptor pool |

Frame lifecycle is double-buffered (`kMaxFramesInFlight = 2`) with
out-of-date/resize handling driving swapchain recreation.

## Cube pass

Each frame it walks the macro grid, **surface-culls** cells whose six neighbours
are all solid, and emits one instance per visible cell — position, colour (by
`CellType`), and a tint from the `fluid` field. A single instanced draw covers
the whole visible surface, so instance count scales with visible *area*, not
world volume. See [voxels.md](voxels.md).

## Toroidal (minimal-image) placement

The world wraps ([physics.md](physics.md) wraps entity positions), so rendering
must wrap too or the far side of the torus shows through as background
clear-colour right where the player is about to walk. `record` takes the camera
world position and places each cell not at its absolute grid origin but at the
**tile-copy nearest the camera** (period `kWorldExtent`): snap the camera to its
tile, then shift each cell by whole periods into the `[-half, +half)` window
around it. The player always sees a full shell of world around them and the seam
is invisible — an endless lattice, the way a corridor that loops on itself reads
as infinite. Cheap: it is a per-axis compare/add on the origin already being
written, no extra instances.

> This replaces the reference game's "treadmill" trick (shift the whole map back
> toward centre near an edge). With a real torus we don't move content — we just
> pick the nearest image of each cell. No teleport seam, works on all three axes.

**Golden rule of this pass: always draw the world *around the camera*.** Never
draw it at fixed absolute coordinates. Every present/future pass (transparent
props, particles, procedural detail) must place geometry via the same
minimal-image rule so the camera sits at the centre of a full, seamless shell.

## Distance fog — fades to black

Depth fog is a **render-only** effect (no sim state). Fragment colour is
`mix(lit, black, fog)` where `fog` ramps `0→1` between `fog.x` and `fog.y`
(world-space distance from the camera, computed per-vertex in
[cube.vert](shaders/cube.vert), applied in [cube.frag](shaders/cube.frag)).
Current tuning (in [main.cpp](src/app/main.cpp)):

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

## Known issue — depth clip range

`mat4_perspective` ([core/math.h](src/core/math.h)) emits GL-style `[-1, 1]`
depth, but the render pass clears depth to `1.0` and compares `LESS` (Vulkan
`[0, 1]`). If far geometry disappears or z-fights, remap projected z to `[0, 1]`
(`m[10] = zf/(zn-zf)`, `m[14] = zn*zf/(zn-zf)`). Camera already flips Y for
Vulkan's +Y-down clip space ([camera.md](camera.md)).

## Security / platform note

The window/renderer is local only; there is no network surface. SDL3 is
window + input + timing only — **never** the graphics API.

## Connections

Consumes `CameraMatrices` from [camera.md](camera.md) and reads the grid
([voxels.md](voxels.md)) + `fluid` field ([fields.md](fields.md)). Driven by the
app loop ([ARCHITECTURE.md](ARCHITECTURE.md) §Simulation loop).
