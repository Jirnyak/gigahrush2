# gigahrush2

A universal voxel **core engine** — the substrate you build a voxel game on,
not a game itself. It gives you a large simulated world, the physics and data
model to move through and mutate it, and a real Vulkan renderer so you can see
what you are building. Gameplay is intentionally left to a game layer on top.

It is a **native C++/Vulkan desktop game**, and the design leans hard into that:
disk and GPU are treated as effectively unlimited, RAM as a generous ~8 GB
budget, and the **CPU tick as the one scarce resource**. So the data model is
**dense, not sparse** (store whole 128³ worlds verbatim, like Dwarf Fortress /
Minecraft), all expensive precomputation (BFS/nav, lighting) is **baked at load**
(load time is unbounded), and the simulation stays **O(n)** per tick. The
processors split the work: the **CPU runs the agents** (player + embodied
NPCs/mobs), the **GPU runs every cellular field** (fluid/gas/heat/light as async
compute). See [performance.md](performance.md) — it frames every other decision
here.

## Documentation

[ARCHITECTURE.md](ARCHITECTURE.md) is the layered design source of truth;
[AGENTS.md](AGENTS.md) holds contributor / agent rules (including token
economy). Each system has a focused doc in this directory, which this README
orchestrates. Docs marked *design* describe the planned game layer, not yet
built.

| System | Doc | What it covers | Status |
|--------|-----|----------------|--------|
| Voxels | [voxels.md](voxels.md) | 128³ macro grid, 8³ sub-voxel masks, SoA storage | built |
| Fields | [fields.md](fields.md) | Runtime typed scalar fields, RTTI-free type tags | built |
| Gravity | [gravity.md](gravity.md) | Vector gravity + regional override | built |
| World / stack | [world.md](world.md) | `World` layer, `LevelStack`, the 4th coordinate W | built |
| ECS | [ecs.md](ecs.md) | EnTT alias, universal POD components, system conventions | built |
| Physics | [physics.md](physics.md) | Vector gravity, jump, swept-AABB vs. sub-voxels | built |
| Controller | [controller.md](controller.md) | Input intent → velocity, walk vs. fly | built |
| Camera | [camera.md](camera.md) | View/proj derived from the `CameraTag` entity | built |
| Fluid | [fluid.md](fluid.md) | Deterministic mass-conserving cellular liquid | built |
| Diffusion | [diffusion.md](diffusion.md) | Danger/scent field — spreads & fades, flee gradient | built |
| Navigation | [nav.md](nav.md) | Baked 4×4×4 lattice, coarse graph + 64 flow fields, `route_step`, disk cache | built (no consumer yet) |
| Rendering | [render.md](render.md) | Vulkan backend modules + instanced cube pass | built |
| Performance | [performance.md](performance.md) | Resource model, dense-over-sparse, bake-at-load, O(n) tick | principle |
| Worldgen | [worldgen.md](worldgen.md) | Demo world modules: 3D maze + toroidal floor stack | built |
| Floors | [floors.md](floors.md) | Floor **modules**, number↔slot indirection, rule-sets, one-live-floor streaming | built |
| Elevators | [elevators.md](elevators.md) | Adjacent travel (load-on-demand) + planned 4×4×4 fast-travel lattice (= nav coarse-graph) | adjacent built |
| Monsters | [monsters.md](monsters.md) | Global monster catalog (POD defs + aiFlags + tier scaling) + per-floor weights | catalog built (#13b); spawning pending |
| Items / loot | [items.md](items.md) | Global item catalog (POD defs + use-effects) + monster death-drop loot tables | catalog + loot tables built (#13a/#13c); procedural pool pending |
| NPCs | [npcs.md](npcs.md) | Macro population + local embodiment; player is an embodied record | pool + embodiment + streaming |
| NPC AI | [ai.md](ai.md) | Utility brain: needs, 13-intent scorer + hysteresis, flee-field + wander steering, identity-stagger driver | needs (#12a) + scorer/selection (#12b) + stagger/steering/loop driver (#12c) built; crowd moves. `route_step` goal-seeking waits on #13 |
| Events | [events.md](events.md) | Decoupled gameplay event bus (transient ring + optional log) | built |
| Macrosim | [macrosim.md](macrosim.md) | Background global population / faction / social simulation | core built (headless); app-loop wiring pending |

## What the core is

- **Monolithic macro world.** One flat `128³` grid of typed cells (no chunk
  seams), wrapped as a torus on all three axes so there are no edges.
- **Sub-voxel detail.** Every macro cell holds an `8³` sub-voxel blocker mask
  (512 bits packed into `uint64_t`s), so collision is fine-grained and cheap:
  a fully solid cell and a half-carved one cost the same to query.
- **Runtime typed fields.** Need temperature? `world.fields().get_or_create
  <float>("temperature")` gives you a dense `128³` field, created on demand, no
  schema or codegen. Any POD type, any name, type-checked at access.
- **Vector gravity.** Gravity is a 3D acceleration vector (optionally regional),
  not a scalar "down" — invert it, tilt it, or make it radial.
- **4D level stack.** A `W` coordinate selects *which* `128³` world; entities
  move between adjacent layers. The seam for nested worlds and dimensions.
- **Swept-AABB physics.** Axis-by-axis sweep against the sub-voxel masks with
  jump + ground detection, all driven by ECS components (no hard-coded player).
- **Cellular fluid.** Liquid stored as a runtime field, stepped with a
  deterministic mass-conserving cellular rule that pools on terrain.
- **Attachable ECS camera + controller.** The "player" is just whichever entity
  currently holds a `CameraTag` + `Controller`. Attach them to anything.

## Rendering

A minimal-but-real Vulkan backend (MoltenVK on macOS) that opens an SDL3 window
and draws the visible world as **instanced cubes** — one draw call for the whole
surface, with per-cell colours, a directional sun, and a Dear ImGui HUD. Surface
culling keeps the instance count proportional to visible area, not volume. The
embodied population is drawn by a second **instanced body pass** (one lit box per
NPC, faction-tinted, sharing the world pass's depth so bodies and voxels occlude
cleanly).

## Build

Requires CMake ≥ 3.20, a C++23 compiler, and (via Homebrew on macOS):

```sh
brew install sdl3 vulkan-headers vulkan-loader molten-vk shaderc
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
./build/gigahrush2        # run the demo
ctest --test-dir build    # run the headless core tests
```

EnTT and Dear ImGui are fetched and pinned automatically by CMake.

## Controls

`WASD` move · mouse look (`Tab` toggles, or hold **RMB**) · `Space` jump · `F`
toggle fly/walk · **`[` / `]`** ride the elevator down / up a floor · `Esc` opens
the pause menu (Resume / Quit).

## Layout

```
src/core     dependency-free math + toroidal wrap helpers + bake-time job system
src/world    macro grid, sub-voxel masks, typed fields, gravity, level stack,
             the 4×4×4 nav lattice + baked navigation (nav)
src/ecs      universal components + EnTT registry alias
src/sim      physics, controller, camera, fluid, diffusion (danger/scent) systems
src/game     game layer: NPC pool + embodiment, floor modules, streaming, elevator,
             nav disk cache, macro society tick (demographics + migration +
             faction + social), utility-AI needs + intent scorer
src/render   Vulkan device/swapchain/renderer, cube pass + NPC body pass, ImGui layer
src/input    SDL3 -> ECS input bridge
src/app      window + main loop + demo worldgen
shaders      GLSL compiled to SPIR-V at build time
tests        headless unit tests (link core only, no SDL/Vulkan)
```

The core simulation (`src/world`, `src/sim`, `src/ecs`) links as `giga_core`
with **no** SDL/Vulkan/ImGui dependency, so it is testable headless and
embeddable in a different host. The gameplay macro-systems — NPC pool +
embodiment, inventory, event bus, the floor modules (per-floor generator,
`FloorRegistry`, one-live-floor streaming, elevator), the background **macro
society tick** (columnar demographics, inter-floor migration, a faction matrix +
social graph), and the embodied **utility-AI** (needs + a pure 13-intent scorer
with argmax/hysteresis, and an identity-staggered driver that steers the crowd by
the flee field + per-agent wander; goal-directed `route_step` waits on the mob /
item tables) — live in `src/game` as
`giga_game`, which links `giga_core` and is likewise headless-testable
(`game_test`).
