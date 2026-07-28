# Architecture — gigahrush2

The layered design source of truth. [AGENTS.md](AGENTS.md) holds contributor
rules; [README.md](README.md) orchestrates the per-system docs. This document
describes *how the pieces fit*, not every function.

## The one-sentence model

A **monolithic 128³ macro grid** of typed cells (each cell ~2 m), wrapped as a
**torus** on all three spatial axes; every cell subdivides into an **8³
sub-voxel** blocker mask; arbitrary **typed scalar fields** overlay the grid at
runtime; a **4th coordinate W** stacks whole worlds into a **level stack**;
entities live in a shared **EnTT** registry and are moved by **systems**
(physics, controller, camera, fluid); a minimal **Vulkan** backend draws the
visible surface as instanced cubes.

## Resource model — the frame for everything

This is a **native C++/Vulkan desktop game**. That fixes the cost model:

- **Disk unlimited** → save whole worlds verbatim (all cells + objects),
  persisted as the player explores (Dwarf Fortress / Minecraft style).
- **GPU unlimited** → full dynamic lighting/shadows, generous overdraw; the
  renderer is not the bottleneck.
- **RAM ~8 GB** → generous but finite; the one budget that bounds the dense model.
- **CPU is the bottleneck** → the sim tick must stay **O(n)** in live entities/cells.
- **Load time unbounded** → do all heavy precomputation (BFS/nav, light maps) at
  load and bake it into flat memory; the tick only does O(1) lookups.

The consequences — **dense over sparse**, **bake at load, tick in O(n)**,
data-oriented elegance/universality/minimalism — are detailed in
[performance.md](performance.md) and drive every layer below.

## Layers

Dependencies point downward only. Include hygiene enforces this — verify an
`#include` target sits in the same layer or below before adding it.

```
L4  app/      window, main loop, worldgen, module orchestration    ┐ platform
    render/   Vulkan device/swapchain/renderer, cube pass, ImGui   │ side
    input/    SDL3 → ECS bridge                                    ┘
    game/     NPC pool, inventory, event bus, mob table  ───────────► giga_game
------------------------------------------------------------------- giga_core
L2  sim/      physics, controller, camera, fluid  (systems)
L1  world/    macro grid, sub-voxel masks, fields, gravity, level stack
L0  core/     math, toroidal wrap  (pure, header-only, no deps)
    ecs/      EnTT alias + POD components
```

**`giga_core`** = L0–L2 (`src/core`, `src/world`, `src/ecs`, `src/sim`). It has
**no** SDL/Vulkan/ImGui dependency, links only EnTT, and is what the headless
tests link. **`giga_game`** (`src/game`) sits just above it — gameplay
macro-systems that link `giga_core` but still **no** SDL/Vulkan, so they too are
headless-testable (`game_test`) and the society sim ([macrosim.md](macrosim.md))
can run without a GPU. Rendering, input, and the app shell sit on top and pull in
the platform libraries. This seam is deliberate: the simulation must be testable
without a GPU and embeddable in a different host.

## L0 — Core primitives

- [core/math.h](src/core/math.h) — POD `vec2/3/4`, `mat4` (column-major),
  perspective/lookAt. Ships instead of GLM so the core has zero third-party
  includes. See [render.md](render.md) for the Vulkan clip-space caveat.
- [core/wrap.h](src/core/wrap.h) — `wrapi`, `wrapf`, `wrap_delta`. The torus
  math every spatial coordinate flows through.
- [ecs/](src/ecs) — `Registry`/`Entity` aliases over EnTT and the universal POD
  [components.h](src/ecs/components.h). See [ecs.md](ecs.md).

## L1 — World

One `World` (see [world.md](world.md)) = one layer of the stack, owning:

- **MacroGrid** ([macro_grid.h](src/world/macro_grid.h)) — SoA arrays of
  `CellType` + `SubMask`. Toroidal accessors wrap on every axis. See
  [voxels.md](voxels.md).
- **FieldRegistry** ([field.h](src/world/field.h)) — runtime-registered dense
  128³ fields of any POD type, keyed by name, type-checked via an RTTI-free
  `type_tag<T>()`. See [fields.md](fields.md).
- **GravityField** ([gravity.h](src/world/gravity.h)) — a 3D acceleration vector
  plus an optional regional override hook. See [gravity.md](gravity.md).

**LevelStack** ([level_stack.h](src/world/level_stack.h)) owns the ordered
layers indexed by W. x/y/z wrap; **W does not** — `above`/`below` return
`kInvalidLayer` at the ends. This is the storage substrate for **floor modules**
(see [floors.md](floors.md)); note the storage slot (`LayerId`) is distinct from
the mutable in-game floor number.

## L2 — Simulation systems

Free functions over EnTT views, each taking the state it needs plus `dt`:

- **physics** ([physics.md](physics.md)) — vector gravity + jump + swept-AABB
  collision, one axis at a time, against sub-voxel masks. Substeps prevent
  tunneling.
- **controller** ([controller.md](controller.md)) — turns `Controller::wishDir`
  (camera-local intent) into world velocity; walk vs. 6DoF fly.
- **camera** ([camera.md](camera.md)) — derives view/projection from whichever
  entity holds a `CameraTag`. Not a singleton.
- **fluid** ([fluid.md](fluid.md)) — deterministic, mass-conserving cellular
  liquid stored as a runtime field, pooling on sub-voxel terrain.

The **player is not special**: it is the entity that currently owns a
`CameraTag` + `Controller` + physics components. Move those components and the
view/control follow.

## L3 — Platform side

Everything here is a **read-only shell over the sim**: it consumes L0–L2 state to
draw and to feed input in, but the game runs to completion headless with L3
removed. Data flows sim → render, never back (see [render.md](render.md)).

- **render/** — [render.md](render.md): device/swapchain/renderer bring-up plus
  the instanced **cube pass** ([voxels.md](voxels.md)) that surface-culls the
  grid to one draw call, places every cell at its **nearest toroidal image**
  around the camera (seamless wrap, no edge), fogs to black at the
  `kWorldExtent/2` render radius, and the ImGui HUD layer.
- **input/** — SDL3 events → ECS components (yaw/pitch/wishDir/jump) on the
  active camera entity. Writes components, not a hardcoded player.

## L4 — App & game layer

Two pieces sit above the core: the **app shell** (`src/app`, `src/input`,
`src/render`), which only the executable links, and **`giga_game`** (`src/game`),
a static library of gameplay macro-systems that links `giga_core` but **not**
SDL/Vulkan/ImGui — so it is headless-testable (`game_test`) exactly like the
core. Data-oriented gameplay state (the NPC pool, inventory, the event bus
([events.md](events.md)), and — pending — the mob table) lives in `giga_game`,
not scattered through `src/app`.

[app/main.cpp](src/app/main.cpp) wires SDL3 + Vulkan + ECS and runs a
fixed-timestep sim (120 Hz) against an uncapped render loop with a HUD.
[worldgen.cpp](src/app/worldgen.cpp) builds demo worlds (a connected 3D maze and
a toroidal khrushchevka floor stack) to exercise the core — see
[worldgen.md](worldgen.md). Real game generators replace it.

**This is where the game lives.** The planned game layer — floor **modules**
(isolated geometry/quests/NPCs/rules per floor), elevators, fast-travel grid,
global monster/loot tables with per-floor weight multipliers, macro NPC
population — is built here on top of the engine primitives, not inside the core.
See [floors.md](floors.md), [monsters.md](monsters.md), [items.md](items.md),
[npcs.md](npcs.md), [macrosim.md](macrosim.md).

**Macrosim is its own module — a game within the game.** The macro population
simulation ([macrosim.md](macrosim.md)) is a self-contained, socially/economically
focused society sim that runs in the background of normal play and can be
developed, run, and tested **fully headless** on its own. It reads *up* into the
action game (embodiment) but never depends on it — the same one-way stance the
core has toward render. Remove the 3D front-end and a complete, running society
simulation remains.

## Simulation loop

```
poll SDL events ──► input (feed HUD, accumulate deltas)
while (accumulator ≥ dt):          # fixed 120 Hz
    input.apply       → write intent onto active camera entity
    controller_step   → intent → velocity
    physics_step      → integrate + collide vs sub-voxel masks
    fluid_step        → (throttled) cellular liquid
compute_camera        → view/proj from CameraTag entity
render                → cube pass (instanced) + ImGui HUD
```

## Data-driven extension points

| Want | Do | Not |
|------|-----|-----|
| A new cell type | Assign an id + a colour row in the cube pass | Engine `if` chains |
| A new world quantity (temperature, light) | `fields().get_or_create<T>("name")` | New struct field on the grid |
| Regional/inverted gravity | Install a `GravityField::region` fn | Branch in physics |
| A new floor | Register a module + assign a floor number | Hardcode a layer index |
| A new monster / loot | One row in the global table + per-floor weight | Per-floor spawn code |

## Determinism

Within a single build, same seed → same world (worldgen and fluid are
deterministic). Cross-build / cross-platform float identity is a non-goal.
