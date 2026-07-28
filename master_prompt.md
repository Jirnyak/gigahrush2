# gigahrush2 — Master Prompt & Handoff Context

> **Read this first if you are a new agent picking up gigahrush2.** It is the
> single entry point: the project vision, the load-bearing rules, what is already
> built, what runs today, and the ordered plan for what's left. It does **not**
> duplicate the per-system docs — it points at them and fills the gaps they don't
> cover (current state + roadmap + decisions).
>
> Authoritative sources, in order: **[AGENTS.md](AGENTS.md)** (hard rules + working
> method), **[ARCHITECTURE.md](ARCHITECTURE.md)** (layered design), then the
> per-system `*.md` files orchestrated by **[README.md](README.md)**. When this
> file disagrees with those, those win for engine contracts; this file wins for
> "what state is the game layer in and what's next."

Last updated: **2026-07-28**. Status confirmed by the project owner in-game this
day: **the game builds, runs, and holds > 60 FPS** on Apple M2 Pro (MoltenVK);
floors render as visually distinct modules and the faction-tinted crowd is
visible; **one-live-floor streaming** works (elevator `[` / `]` loads the
destination on demand and folds the floor left behind — the owner saw distinct
floors swap in with their crowds, no duplicate player); `Esc` opens the pause
menu.

**Since then (headless, `ctest`-green):** the whole **navigation + flee stack**
landed. **PR #1** merged the bake foundation to `main` — the fixed 4×4×4 lattice,
the L1 coarse graph, and the L2 flow fields (§7 #11, increments **A/B/C**). On top
of that, three more increments shipped **directly on `main`** (2026-07-28):
**C.2** — the nearest-node field + the O(1) `route_step(coarse, fine, from, to)`
routing API; **C.2b** — the bake wired into `FloorStreamer::ensure_loaded` (every
live floor now bakes its `FloorNav` on load) + an opt-in disk cache; and
**increment D** — `src/sim/diffusion` (the diffusion danger/scent field +
`diffusion_gradient` flee vector). All built and tested. There is still **no
runtime consumer** — the movement AI that calls `route_step` / `diffusion_gradient`
is **#12** — so the running game looks unchanged and NPCs still stand still: the
nav + flee fields are *ready*, not *visible*. New system docs: **[nav.md](nav.md)**,
**[diffusion.md](diffusion.md)**.

---

## 1. The vision (from the owner)

gigahrush2 is a **native C++23 / Vulkan (MoltenVK) / SDL3 / Dear ImGui** rewrite
of the browser game at `/Users/jirnyak/Mirror/gigahrush` — a Russian social /
A-Life horror-sim about descending through the themed floors of a giant
khrushchevka apartment building ("Спуск и Экстракция" — *Descent & Extraction*, a
greed loop). Take the **best of the reference**, but native and honest-3D.

Three owner directives shape everything:

1. **Full honest 3D, 128×128×128 voxel world, target population 2²⁰ = 1,048,576.**
   Native desktop, 16+ GB RAM, GPU ample — **the CPU tick is the only bottleneck.**
2. **Each floor is a separate, self-contained module — a sub-game.** Its own
   geometry, NPCs, points of interest, and rule-set. Some floors dangerous, some
   safe/residential/populated. Monster density varies per floor.
3. **Maximal development, best traditions of the reference.** Autonomy granted;
   work in verified increments (see §9 working method).
4. **Tokens are unlimited — do NOT economize; use every resource to the maximum.**
   The owner's standing mandate: pour everything into the result. Explore deeply,
   read widely, fan out **many subagents** for research and parallel isolated
   work, verify thoroughly, and aim for the best possible outcome — never cut a
   corner or skip a check to save tokens.

**The committed runtime shape (owner concept, 2026-07-28).** Two budgets, two
processes:

- **Macro-population (2²⁰) = a separate process** — the social/economic society
  sim ([macrosim.md](macrosim.md)) on its own coarse clock; it never touches the
  8.33 ms frame.
- **The active floor = the real-time process** — it materializes ~16k of those
  records (residents + mobs) as embodied agents and simulates them live, with
  real-time geometry rebuilds, full destructibility, fluids, heat, and gases —
  **all of it through cells.** The split that makes this hold 120 Hz: **CPU runs
  the agents, the GPU runs every cellular field** (fluid/gas/heat/pressure/light/
  destruction as async-compute stencils), and heavy bakes happen **only at special
  moments** (loads, post-samosbor) — with a cheap approximate **dirty local
  re-bake** covering in-play destruction without a freeze. Full rationale, measured
  numbers, and the N = 128 sizing are in [performance.md](performance.md).

The engine itself is deliberately **game-agnostic** — a universal voxel core. The
game (floors, NPCs, elevators, combat) is a layer on top (`src/game` + `src/app`).

---

## 2. Build, run, controls

```sh
# deps (macOS / Homebrew)
brew install sdl3 vulkan-headers vulkan-loader molten-vk shaderc
# build (EnTT + Dear ImGui are fetched & pinned by CMake)
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
# headless tests (link core/game only — no SDL/Vulkan)
ctest --test-dir build --output-on-failure
# run
./build/gigahrush2 floors   # DEFAULT: the floor-module stack (5 distinct floors)
./build/gigahrush2 maze      # the 3D labyrinth isotropy test bed (single world)
```

**Controls:** `WASD` move · mouse look (`Tab` toggles, or hold **RMB**) · `Space`
jump · **`F`** toggle fly/walk (starts in fly) · **`[` / `]`** ride elevator
down / up a floor (loads the destination on demand, unloads the one left) · `Esc`
opens the **pause menu** (Resume / Quit; frees the cursor so the window can be
moved/minimized). HUD (top-left) shows FPS, pos + layer id, mode, instance/body
draw counts, and the active floor number + kind + target pop.

**GLOB is on** (`CONFIGURE_DEPENDS`): new `.cpp` under `src/{world,sim,ecs,app,
input,render,game}` is auto-picked-up — **do not** edit `CMakeLists.txt` for
individual sources. Shaders (`shaders/*.vert|frag`) are an explicit `foreach` —
add new shaders there. Build must be **zero-warnings** (`-Wall -Wextra`).

---

## 3. Hard rules (condensed — full text in [AGENTS.md](AGENTS.md))

A future agent will trip on these; obey them:

- **No exceptions, no RTTI.** Built `-fno-exceptions -fno-rtti`, EnTT with
  `ENTT_NOEXCEPTION`. No `try/catch/throw/dynamic_cast/typeid`. For type identity
  use the `type_tag<T>()` pattern in `src/world/field.h`.
- **`giga_core` stays dependency-free** (`src/world`, `src/sim`, `src/ecs`): no
  SDL / Vulkan / ImGui, ships its own math (`src/core/math.h`), links only EnTT.
  Keeps the sim headless-testable and embeddable.
- **Render is a pure shell; data flows sim → render only.** The renderer mutates
  no game state. Never answer a gameplay question (line-of-fire, reachability)
  from the framebuffer/depth — that lives in the sim. The game must stay playable
  headless with the render layer removed.
- **Always render around the camera.** World wraps (torus); every pass draws each
  cell at its **nearest toroidal image** relative to the camera. Distance fog
  fades to **black** at `kWorldExtent/2` (the minimal-image radius) so the wrap
  seam is always hidden. Keep `fog end ≤ kWorldExtent/2`, clear colour black.
- **CPU is the only scarce resource — and it runs the _agents_.** Disk/GPU
  unlimited, RAM ~8 GB, load time unbounded, **agent tick sacred: O(n) in live
  agents.** The **compute split**: CPU runs the player + ~16k embodied NPCs/mobs
  (movement, collision, AI); the **GPU runs every cellular field** (fluid, gas,
  heat, pressure, light, destruction) as async compute — *everything is cells*.
  Three consequences: **(1) dense over sparse _at macro res_** (a 128³ field is
  2–8 MB — store it flat; a dense *sub-voxel* field is 1024³ ≈ 1 GB, the wall, so
  sub-voxels stay a sparse mask); **(2) bake at load, tick O(1)** (precompute
  BFS/nav/flow/light into flat memory once; never run BFS/A* in the hot path);
  **(3) two regimes of re-bake** — the full freeze → re-bake → resume runs **only
  at special moments** (floor load, post-samosbor), while **in-play destruction
  gets a cheap, approximate _dirty local re-bake_** patching only the affected
  region with no freeze and no frame hitch (eventually-consistent; the next full
  bake makes it exact). Details in [performance.md](performance.md).
- **Data-driven.** A new cell type / field / monster / loot / floor module is one
  table row or one registered field — never an `if`-chain in the engine.
- **The player is not special.** It is whatever entity currently holds a
  `CameraTag` + `Controller`. No player singleton.
- **`LayerId` (storage slot) ≠ floor number (logical label).** See §4.
- **Backend = Vulkan; SDL3 is platform-only** (window + input + timing). New GPU
  code lives in `src/render/`.
- **Gameplay macro-systems live in `giga_game` (`src/game`)** — links `giga_core`
  but **not** SDL/Vulkan/ImGui, headless-testable via `game_test`. No platform
  includes there.
- **Macrosim is a background module** with its own coarse clock — never wired to
  the 120 Hz tick or the present path. It reads *up* into the action game
  (embodiment) but never depends on render/input/app.
- **Toroidal invariants:** x/y/z **wrap** (`wrap_macro`/`wrapi`/`wrap_delta`);
  positions wrap into `[0, kWorldExtent)` each physics step. **W (the level stack)
  does not wrap** — `above`/`below` return `kInvalidLayer` at the ends. One macro
  cell = **2 m** (`kCellSize`), one cell = **8³ sub-voxels** (bit-masked collision).
  **Gravity is a vector** — read `world.gravity().at(pos)`, never assume −Z.

---

## 4. The floor-module model (heart of the current work)

Three **deliberately decoupled** identifiers (see [floors.md](floors.md)):

| Identifier | Meaning | Mutability |
|---|---|---|
| **floor number** (`int`, signed, −127..127) | in-game label the macro-system assigns | mutable / reshufflable at runtime |
| **`ModuleId`** (`uint16_t`) | stable identity of a loaded module (its generator, rule-set, content) | fixed for the module's life |
| **`LayerId`** (`uint32_t`) | the raw `LevelStack` storage slot a module's `World` currently sits in | changes as modules stream in/out |

An elevator targets a **number**; travel resolves `number → ModuleId → LayerId`
through **`FloorRegistry`**. Never design against a raw `LayerId`. Game starts at
floor 0; ±1 moves between adjacent floors; a planned **4×4×4 = 64-node fast-travel
lattice** (which doubles as the nav coarse-graph, §7 #11) comes later
([elevators.md](elevators.md)).

**Each 128³ `World` = one floor module.** Global tables (monsters, loot, macro
population) are engine-wide singletons; a floor's rule-set only layers
**multipliers / weight tweaks** on top — it never redefines the globals. A floor
may also override gravity region / seed fluid / add fields.

**Embodiment seam** ([npcs.md](npcs.md)): the cold A-Life pool (`NpcPool`) exists
first; entering a floor **materializes** that floor's records into live ECS
entities (`embody`). The **player is just an embodied record** that additionally
holds `CameraTag` + `Controller` (`embody_as_player` flips the `NpcPlayer` bit).
Leaving folds live deltas back into the cold record (`fold_back`). A record's
`height_mm` (from age) drives both the embodied AABB half-height and, for the
player, the camera eye height.

**Danger is V-shaped about the hub, NOT monotonic with depth** (folded in for the
later mob increment; not yet wired to geometry). Floor 0 is the safe "living" hub;
hostility rises in **both** directions — roof (+) is crowded-but-weak, hell/void
(−) is crowded-AND-elite. Three knobs: **danger 1–5** (authored per floor =
`FloorSpec.hostility`), **COUNT** (dominated by `|floor#|`), **LEVEL 1–12**
(`|floor#|` + danger). Formulas live in agent memory (see §10) and
[monsters.md](monsters.md).

---

## 5. Architecture layers & key files

```
src/core     dependency-free math (math.h) + toroidal wrap (wrap.h) +
             bake-time job system (jobs.h: parallel_for)              [giga_core]
src/world    macro grid + 8³ sub-voxel masks, typed fields, vector gravity,
             LevelStack (W), world types/constants (types.h), the 4×4×4
             nav lattice (lattice.h) + baked nav (nav.{h,cpp})        [giga_core]
src/ecs      universal POD components (components.h) + EnTT alias      [giga_core]
src/sim      physics, controller, camera, fluid, diffusion (*_step fns) [giga_core]
src/game     GAME LAYER — NpcPool, inventory, event_bus, embody,
             floor_spec, floor_registry, floor_gen, floor_stream, nav_cache,
             population, elevator                                      [giga_game]
src/render   Vulkan device/swapchain/renderer, cube_pass (world),
             body_pass (NPCs), imgui_layer                             [render]
src/input    SDL3 → ECS input bridge
src/app      window + main loop + worldgen (main.cpp, worldgen.*)
shaders      cube.vert/frag (world), body.vert (NPCs) → SPIR-V at build
tests        world_test (core), game_test (game layer) — both headless;
             sim_bench (16k-agent crowd benchmark; an executable, not a ctest)
```

**Game-layer files you will touch most:**

- `game/npc_pool.{h,cpp}` — 2²⁰-slot SoA population. id == slot, bump-allocated,
  dead never reclaimed. Inline `char[24]` name + inline 8×8 `Inventory`. Flags:
  `NpcAlive / NpcEmbodied / NpcDesign / NpcPlayer`. Fields: faction, hp/max_hp,
  floor (label), cx/cy/cz (macro cell), age/sex/height_mm, level, 8-slot generic
  `attrs`, relations[16].
- `game/embody.{h,cpp}` — the seam. `embody` / `embody_as_player` / `fold_back`.
  Faction colour palette lives here (§8). `embody_as_player` builds a **fresh**
  `CameraTag`+`Controller`, so callers preserving view/mode must re-apply them.
- `game/floor_spec.{h,cpp}` — `FloorSpec` data catalog per `FloorKind`
  (Residential/Commercial/Industrial/Derelict): population, `factionMix[4]`,
  hostility, age window. `floor_spec(kind)` and `floor_spec_for(number)`.
- `game/floor_registry.{h,cpp}` — the number↔module↔layer indirection (§4).
- `game/floor_gen.{h,cpp}` — `generate_floor(World&, number, spec, seed)`: a
  floor's whole 128³ interior as a **pure fn of (seed, number)**, themed by kind.
- `game/population.{h,cpp}` — `seed_floor_from_spec` (dense, wall-safe placement)
  and the `seed_floor_population` uniform wrapper; `height_for_age`.
- `game/elevator.{h,cpp}` — `ride_elevator`: the real inter-floor travel (§6, #8).
- `game/floor_stream.{h,cpp}` — `FloorStreamer`: one-live-floor streaming (§6,
  #9). `add_module` / `ensure_loaded` / `unload` / `keep_only` / `travel`. Owns
  each module's build recipe; its cold crowd is whoever is currently labelled with
  the floor's number (`pool.floor_bucket`, #10b — seeded once, membership live),
  not a fixed id range. Holds a free-list of recyclable `LevelStack` slots
  (`init(stack, keepRadius=0)`).
- `app/main.cpp` — window/Vulkan bring-up, the floor stack setup, the fixed-step
  sim loop (1/120 s, frozen while paused), the render loop, HUD, the **pause
  menu** overlay, and event handling incl. `[` / `]` (via `streamer.travel`) and
  `Esc` (toggles pause + frees the cursor).

**Core nav / bake + field files (§7 #11 bake + increment D; `giga_core` except
`nav_cache`; baked into streaming, but the runtime consumer is #12 — see
[nav.md](nav.md) / [diffusion.md](diffusion.md)):**

- `core/jobs.h` — header-only `parallel_for(n, body, threads=0)`, the bake-time
  job system. Parallelize **across** independent units (never inside one BFS);
  deterministic when `body(i)` writes only slot `i`. Bake-time only, never on the
  tick.
- `world/lattice.h` — the fixed 4×4×4 = 64-node cyclic `(Z/4)³` torus lattice
  (pure `constexpr`, dependency-free): `lattice_coord / _id / _unpack / _neighbor`,
  axis centres {16,48,80,112}, spacing 32. Both the elevator-hub set and the nav
  coarse-graph node set.
- `world/nav.{h,cpp}` — the baked navigation. `bake_coarse(grid, CoarseGraph&)` =
  64 parallel wrapped BFS → Floyd-Warshall all-pairs `dist` + `next` (O(1) query
  `coarse_next(g, from, to)`). `bake_fine(grid, FineNav&)` = 64 flow fields
  (128 MiB; `FineNav::at(node,x,y,z)` → a step direction `0..5` into `kNavDir`, or
  `kFlowArrived` / `kFlowNone`) **plus a 2 MiB nearest-node field** (`nearest_node`,
  one multi-source BFS = geodesic Voronoi anchor per cell). `route_step(coarse,
  fine, from, to)` is the O(1)/tick entry from ANY cell: target's nearest anchor →
  coarse reachability guard → descend that anchor's flow field. **Wired into
  `FloorStreamer::ensure_loaded`** (C.2b): each live floor holds a `FloorNav`
  (`nav_at(number)`), baked on load and freed on unload, with an opt-in disk cache
  (`set_nav_cache_dir`, `game/nav_cache.{h,cpp}`, keyed on `(number,kind,seed)`).
- `sim/diffusion.{h,cpp}` — the diffusion danger/scent field (increment D).
  `diffusion_step(world, params)` = double-buffered toroidal heat-equation relax +
  evaporate over a named `float` field (default `"danger"`), no-flux at walls;
  stable at `rate·6 ≤ 1` (default 0.15). `diffusion_gradient(f, grid, x,y,z)` =
  the flee vector (agents flee along −gradient). Runs on the macro tick, not the
  120 Hz tick. The flee/scent input to #12, distinct from nav and from
  `FloorSpec.hostility`. See [diffusion.md](diffusion.md).

**Key components** (`ecs/components.h`, all POD): `Transform{vec3 pos; LayerId
layer}`, `Velocity`, `AABB{half}`, `GravityAffected{scale,grounded}`,
`Jump{impulse,wants_jump}`, `CameraTag{yaw,pitch,fovY=1.2,eyeOffset}`,
`Controller{moveSpeed,wishDir,fly}`, `Renderable{color}`. Game-layer `NpcRef{id}`
lives in `embody.h`.

---

## 6. What is BUILT (increment history)

**Engine core — all built** (see README status table): 128³ macro grid + 8³
sub-voxel masks, runtime typed fields, vector gravity, `World`/`LevelStack`,
swept-AABB physics, walk/fly controller, camera-from-`CameraTag`, deterministic
cellular fluid, Vulkan renderer (instanced cube pass + ImGui), demo worldgen
(3D maze + toroidal floor stack), decoupled event bus.

**Game layer — built this project:**

- **NpcPool + inventory + embodiment seam.** 2²⁰ SoA pool; `embody` /
  `embody_as_player` / `fold_back`; player is an embodied record (no singleton).
- **NPCs render (`body_pass`).** Instanced lit boxes over
  `view<Transform,AABB,Renderable>`, toroidal nearest-image + fog cull, skips the
  camera holder. `shaders/body.vert` (reuses `cube.frag`). Faction-tinted colour
  set at embody time. Body **shape encodes age** (fixed ~0.8 m footprint, height
  from `height_mm`): children ≈ cubes, adults ≈ tall boxes.
- **`FloorSpec` per-floor rule-set** — data catalog; `hostility` is data-only
  until mobs land. Tested.
- **`FloorRegistry`** — number↔module↔layer indirection; label/residency
  orthogonal; renumber-without-reload; eviction; range guards. Tested.
- **#6 — `generate_floor` (per-floor generator).** Pure fn of (seed, number),
  themed by `FloorKind` via a `FloorGeom` table (storey height / room stride /
  doorway / pillars-vs-walls / decay gap%/hole%/rubble% / stairwell shafts).
  Density ordering: Residential warren > Commercial halls > Industrial pillar
  plate; Derelict = residential lattice half-collapsed. **Clears to air first →
  a recycled `World` regenerates bit-for-bit** (this is what gates #9 streaming).
  Tested (determinism over a recycled slot, number-varies-layout, per-kind
  solid-cell ordering).
- **#7 — multi-layer bring-up.** `main.cpp` (default `floors` mode) builds a
  `LevelStack` of **5 distinct floor modules** (numbers 0..4: Residential hub,
  Commercial, Industrial, Derelict, Residential), each `generate_floor`'d + seeded
  from its `FloorSpec`, wired through `FloorRegistry`. Player embodied on floor 0.
  `body_pass` draws the active layer's crowd. **Owner-confirmed in-game.** The
  seeder places records on each module's internal ground storey (`kGroundZ=1`) —
  floor number is a **label**, not a Z-band.
- **#8 — the real elevator.** `ride_elevator(reg, pool, registry, player,
  fromFloor, dir, arrivalZ)`: resolves `fromFloor+dir → module → resident layer`
  via the registry (by **number**, never raw layer), `fold_back`s the player's
  record on the departed layer, re-embodies it as player on the destination, and
  **carries camera yaw/pitch/fov + fly mode across the fresh body**. Keeps x/y,
  drops to arrival storey (cell z=2 = air on every kind). **No-op if the
  destination floor isn't loaded** — this is exactly the hook #9 turns into
  load-on-demand. Wired to `[` / `]`. Tested (`test_elevator`: same-record
  round-trip up/down, x/y kept + arrival storey, view+fly preserved, unloaded
  no-op).

- **#9 — one-live-floor streaming (the floor-module epic capstone).**
  `FloorStreamer` (`src/game/floor_stream.{h,cpp}`) keeps **exactly one floor
  live** by default (`init(stack, keepRadius=0)` reserves `2*keepRadius+2`
  recyclable slots). `add_module(reg, number, kind, seed)` registers a module's
  identity + build recipe without loading; `ensure_loaded` seeds the crowd
  **once** (labelling each seeded record with the floor number), allocates a slot,
  `generate_floor`s the geometry, and embodies the crowd — **whoever is currently
  in `pool.floor_bucket(number)`** (#10b) — skipping records already embodied
  elsewhere (so the player is never duplicated; the first ever load designates the
  player). `unload` / `keep_only` `fold_back` the whole crowd and free the slot.
  `travel` loads the destination on demand → `ride_elevator` → adopts the fresh
  player body → prunes to the kept window. **Invariant:** re-entry re-embodies the
  floor's *current roster* and geometry regenerates bit-for-bit, and since seeding
  is once-only, `pool.count()` never grows per visit. `main.cpp` (default `floors`
  mode) now registers the 5 modules and `ensure_loaded`s **only floor 0** at
  startup; `[` / `]` = `streamer.travel`. **Owner-confirmed in-game** (distinct
  floors swap in with their crowds; no duplicate player). *Migration-ready (#10b,
  done):* the roster is a maintained per-floor bucket index over `pool.floor(id)`,
  so a macro relabel migrates residents between floors and the destination
  re-embodies them.
- **Pause menu (owner-requested UX).** `Esc` no longer quits — it toggles a
  centered ImGui **"Menu"** overlay (Resume / Quit) and **frees the cursor**
  (relative mouse mode off) so the OS window can be moved/minimized; the sim
  freezes while paused (accumulator reset; input / travel / look gated). Quit goes
  through the menu. The single-button layout is deliberately extensible for future
  items (settings, save/load, character sheet).

**Navigation + flee stack — built (headless, `ctest`-green; §7 #11 increments
A/B/C/C.2/C.2b + increment D; full docs [nav.md](nav.md) / [diffusion.md](diffusion.md)).
The nav is now baked into floor streaming, but no runtime consumer steers by it
yet (movement AI is #12), so nothing visible changed — the fields are *ready*, not
*visible*:**

- **A — L0 carve.** `src/world/lattice.h` (the fixed 4×4×4 lattice) + `floor_gen`
  now carves the 64 nodes (shaft through the full height — Z wraps, so top links
  back to storey 0 — plus a lobby opening and coloured hub pads at the 4 lattice
  z-levels) **deterministically and seed-independently** on every floor kind,
  replacing the old `rng.below(...)` random shafts.
- **B — L1 coarse graph + job system.** `src/core/jobs.h` (`parallel_for`) +
  `src/world/nav.{h,cpp}`: `bake_coarse` runs 64 wrapped BFS through the *real*
  geometry (parallel across nodes) → edge weights → Floyd-Warshall all-pairs
  `dist` + `next`-hop. Cyclic graph ⇒ **no torus seam** (node 0 → antipode is
  exactly 192 cells / 6 hops on open air; a spanning tree would blow both up).
  `Threads::Threads` is now a `giga_core` dependency.
- **C — L2 flow fields.** `bake_fine` / `FineNav`: 64 dense flow fields, 1 B/cell
  = the step direction toward each node (**128 MiB/floor**). The field is a BFS
  parent chain, so descent strictly shortens and always arrives.
- **C.2 — routing glue.** `bake_fine` also paints a **nearest-node field**
  (`uint16 nearest[128³]`, +2 MiB — a geodesic Voronoi anchor per open cell,
  `FineNav::nearest_node`), and **`route_step(coarse, fine, from, to)`** composes
  the two layers into the O(1)/tick entry from ANY cell (target's nearest anchor →
  coarse reachability guard → follow `next`-hop / descend that anchor's flow
  field; returns a `kNavDir` byte, `kFlowArrived`, or `kFlowNone`). L2 is now
  ≈ **130 MiB/floor**. Details: [nav.md](nav.md).
- **C.2b — wired into streaming + disk cache.** `FloorStreamer::ensure_loaded`
  now bakes a per-module `FloorNav{CoarseGraph, FineNav}` right after
  `generate_floor` (heap-held `unique_ptr`, freed on `unload`, retrieved via
  `nav_at(reg, number)`). **Opt-in** disk memoization — `set_nav_cache_dir(dir)`
  (empty = off, the default) + `game/nav_cache.{h,cpp}` (versioned blob keyed on
  `(number, kind, seed)`, `-fno-exceptions`-clean) — skips the re-bake on
  re-entry. This is the reference's impossible-in-a-browser optimization.
- **D — diffusion danger/scent field.** `src/sim/diffusion.{h,cpp}`:
  `diffusion_step` (double-buffered, toroidal, **no-flux walls**, evaporating;
  explicit-stable at `rate·6 ≤ 1`, default 0.15) + `diffusion_gradient` (the
  per-cell flee vector — agents flee along −gradient). The flee/scent field #12
  steers by; deliberately **not** pathfinding and distinct from the authored
  `FloorSpec.hostility` rating. Details: [diffusion.md](diffusion.md).
- **Honest crowd bench** (`tests/sim_bench.cpp`) — see §8; it's what motivated the
  job system (the agent tick must be threaded to fit 16k/floor in budget).
- **Connectivity caveat (honest, documented).** The carve guarantees **vertical**
  node links (shafts, intact even on decayed Derelict); full **horizontal**
  64-node connectivity relies on a floor's rooms/lobbies — proven fully connected
  on dense Residential, **not** structurally guaranteed on sparse/Derelict (the
  graph then correctly reports `kUnreachable`, which is sound for nav). Optional
  fix deferred: carve thin corridors along lattice edges (geometry change, owner's
  call).

**Tests (`game_test`, headless):** inventory, pool basics + death-keeps-slot,
relationships, design flag, event bus (transient/overflow/log), attribute block,
height→body, embody/foldback, player-is-a-record, population seed, floor_spec,
seed_from_spec, floor_registry, floor_gen, elevator, floor_stream, floor_travel,
**nav coarse + fine on a real floor** (`test_nav_realfloor` / `test_nav_fine_realfloor`
— full connectivity; every node routes home without crossing solid; determinism),
**routing** (`test_route_realfloor` — `route_step` reaches iff coarse-reachable),
and **streaming + disk cache** (`test_streamed_nav`, `test_nav_cache_roundtrip`,
`test_streamed_nav_cache` — bake-on-load is bit-identical to standalone, freed on
unload, cache round-trips + rejects wrong seed/kind, read path proven by a
sentinel). `world_test` covers the core, **plus `test_parallel_for`, the all-air
coarse no-seam bake (`test_nav_coarse`), the all-air fine flow-field bake
(`test_nav_fine`)** (follow == exact wrapped-Manhattan; bit-identical re-bake =
determinism), **and the diffusion field (`test_diffusion`** — symmetric spread,
torus periodicity, wall block, flee-gradient sign, determinism, monotone decay).

---

## 7. Remaining roadmap (tracked as tasks #10–#13)

Work **one verified increment per turn, build green, stop green with a plan**
(§9). Order below is the intended sequence, but note the owner pulled the **nav
bake (#11 A/B/C) forward** ahead of #10 — that core is now built (§6). So the
open work is: **#10c** macro migration/social pass (the demographic core #10a and
per-floor bucket index #10b are **done**), **#12** movement AI (now unblocked — the
flow fields, `route_step`, and the diffusion flee field are all built), then content
**#13**. The floor-module epic (#6–#9) is **done**.

### #10 — Macro tick (demographic core + bucket index BUILT 2026-07-28; #10c pending)
Coarse clock (own rate, **never** the 120 Hz tick — [macrosim.md](macrosim.md)).
This is where the **off-screen population comes alive**; the ref proved 2²⁰ is
viable *only if the macro tick stays columnar* (its own 1M target was retired
because per-record object graphs — not typed columns — dominated cost; gigahrush2
avoids that with inline names + inline inventory in SoA).

- **#10a — columnar demographic full-sweep (DONE 2026-07-28).** ✔
  `src/game/macro_sim.{h,cpp}`: one O(n) sweep = aging (fractional-year
  accumulator, macro-owned) + old-age mortality (data-driven quadratic curve) +
  reserve-drawn births (fertile adults reservoir-sampled in the same pass,
  catch-up toward `targetPopulation`, newborns inherit a parent's floor/cell/
  faction). Skips embodied/player records (micro sim owns them). Fully
  deterministic via stateless `(id,tick,salt)` hashing (`src/core/rng.h`, new
  shared primitive). **Bench: ~2.8 ms / 1,048,576 records, ~373 M rec/s**
  (`macro_bench`). 5 tests in `game_test` (aging, mortality, births, determinism,
  embodied-skip). Divergence from ref: aging+births is a **new capability** — the
  TS society only decays; affordable here because it's headless on a coarse clock.
- **#10b — per-floor bucket index (DONE 2026-07-28).** ✔ A maintained **inverted
  index** over `pool.floor(id)`, living inside `NpcPool` (`floorBuckets_[label]` +
  `slotInBucket_[id]`): `set_floor`/`kill` splice a record between rosters in O(1)
  via swap-remove (no linear bucket scan, unlike the ref's `floorIndex`).
  `FloorStreamer` now embodies `pool.floor_bucket(number)` — whoever is *currently*
  labelled with the floor — instead of a fixed `[firstId, count)` range, so a macro
  relabel migrates residents and the destination re-embodies them; seeding stays
  once-only so the head-count is still steady. Direct `floor()=` removed pool-wide
  (would desync the index). Index is derived state (rebuilt empty in `init`, not
  serialized). Sweep cost unchanged (3.0 ms/1M — the sweep touches no buckets). 2
  new tests (`test_floor_bucket_index`, `test_stream_migration_reembodies`) +
  `test_macro_skips_embodied` now registered.
- **#10c — budgeted-cursor passes.** Bounded ring-scan (~64 records/tick, the
  ref's `RECORDS_PER_TICK` primitive) for off-floor migration + relationship drift,
  on the same tables. Then faction/economy dynamics (6×6 Int8 relation matrix).

### #11 — Baked nav / flow / distance fields (`src/world/nav`) — A→D BUILT 2026-07-28 (headless green)
The stack is **done**: L0 carve (A), L1 coarse graph + core job system (B), L2
flow fields (C), the nearest-node field + `route_step` (C.2), the wiring into
streaming + disk cache (C.2b), and the diffusion flee/scent field (D) — all built
and `ctest`-green (§6; docs [nav.md](nav.md) / [diffusion.md](diffusion.md)). The
nav is now **fully consumable**: a live floor bakes its `FloorNav` on load and #12
can call `route_step` from any cell + read `diffusion_gradient`. **What remains:**
- **C.2 / C.2b (DONE 2026-07-28):** ✔ nearest-node field (geodesic Voronoi anchor
  per cell) + `route_step(coarse, fine, from, to)`; ✔ bake wired into
  `FloorStreamer::ensure_loaded` (freeze → bake → resume), per-floor `FloorNav`
  freed on unload, opt-in disk memoization keyed on `(number,kind,seed)`.
- **Dirty local re-bake:** the cheap in-play patch for destructibility (below) —
  still the one unbuilt piece of the bake story.

Design rules below stay authoritative; the full built API is captured in agent
memory `torus-nav-baking`. **Original design (owner + reference-audit):**
- **The 4×4×4 = 64-node elevator lattice IS the HPA\* coarse graph** — a cyclic
  `(Z/4)³` torus graph, so it structurally cannot hit the reference's
  spanning-tree "seam" bug (a tree/forest over a 3-torus cuts cycles → 240-step
  antipode loops + path-flapping between roots). **Three hard rules:** never bake
  a tree/forest over the torus (only the cyclic graph + per-source BFS fields);
  never re-bake structure per tick (bake at boundaries, hysteresis at the
  consumer); the toroidal `wrap_delta` heuristic is for A\* ordering **only**,
  never as a path metric (it lies at the antipode).
- **Layers (L0/L1/L2 + the nearest-node field all BUILT — §6; C.2/C.2b done).**
  L0 geometry = carve the 64 nodes + their real connectivity. L1 coarse = 64-node
  all-pairs next-hop, edge weights from real wrapped BFS through geometry. L2 fine
  = **64 flow fields** (one per node, 1 B/cell, dist fits `uint8` since max 6-conn
  geodesic 3·64=192<255) + a nearest-node field; a route is coarse next-hop →
  descend that node's flow field. This is the reference's
  wished-for "64-anchor flow field" it couldn't afford in a 536 MB browser — we
  can (infinite RAM). Flee/scent = a **diffusion field** on the macro tick (like
  `src/sim/fluid`, periodic on the torus), not pathfinding — **BUILT 2026-07-28**
  as `src/sim/diffusion.{h,cpp}` (increment D): `diffusion_step` (double-buffered,
  toroidal, no-flux walls, evaporating) + `diffusion_gradient` (the flee vector).
- **Multithreaded bake** (owner's golden rule, sharpened 2026-07-28 — **two
  regimes, don't conflate**): baking happens **only at loads** (every floor
  transition/elevator is a load-on-demand; the post-`samosbor` stitch; initial
  entry). Load is off the hot path and load time is unbounded, so at bake there is
  **no CPU limit — peg all cores, spare nothing.** The CPU budget is scarce
  **only during the live sim tick**, and the two windows are temporally disjoint
  by construction (mutation → freeze → bake all-cores → resume) — the bake never
  runs on the tick. A small core job-system runs the 64 BFS in parallel **across**
  fields, never inside one BFS → race-free + deterministic (each field written by
  exactly one thread). Geometry is a pure `fn(seed, number)`, so the whole bake is
  **memoizable to disk** (unlimited) and skipped on re-entry — something the
  browser reference could never do.
- **Bake boundaries (two regimes)** *(the full bake is now wired into
  `ensure_loaded` — C.2b):* the **full** bake runs only at floor load
  (`FloorStreamer::ensure_loaded`) and the post-`samosbor` stitch. Between them,
  in-play destructibility gets a **dirty local re-bake** — patch only the mutated
  region, cheap and approximate, no freeze; accept-stale at the edges until the
  next full bake makes it exact ([performance.md](performance.md) §Two regimes).
- **Increment A (DONE):** the fixed lattice is carved — a guaranteed shaft + lobby
  + hub pads at all 64 nodes, seed-independent — in `floor_gen`, replacing the old
  *random* shafts (`rx=rng.below(...)`); `src/world/lattice.h` added (core, pure
  `constexpr`, dependency-free). *(Fast-travel **elevator** hookup to the lattice
  — teleport between unlocked nodes — is still a standing follow-up, unbuilt.)*

### #12 — Utility-AI for embodied NPCs
13 intents scored 0–100, argmax + hysteresis, **identity-hash stagger** (zero
per-NPC scheduling RAM). This is what finally makes the **visible crowd move**
(wander, flee, seek). Needs #11.

### #13 — Content tables (`item_table` + `mob_table`)
POD, data-driven ([items.md](items.md), [monsters.md](monsters.md)). Ref scale:
~434 items (POD + tag bitmask + use-effect enum), ~90 monster kinds (aiFlags
union), loot (spawnW + value-gate + depth caps), economy bands E0–E4. Mobs are
**not** in `NpcPool` — they spawn per-floor from the mob table and vanish.

### Standing follow-ups (fold in when the relevant increment lands)
- **`floor_spec_for()` is currently monotonic (`floor % 7/5/3` pattern) and takes
  `uint16_t`.** Retune to **signed int + V-shape** danger (§4) when the mob/danger
  increment lands. `NpcPool::floor` is also `uint16_t` — revisit for signed labels.
- **Danger / mobs / samosbor** — mob spawning by V-shape count+tier; `dangerField`
  (blood/scent fluid) is a *separate* runtime thing from the danger rating;
  **samosbor** = timed floor-wide maze-restructure event (7 theme variants, cooldown
  ~inverse to depth) + an L4D-style director with an anti-swamp valve.
- **NPCs currently stand still** — this is expected: no AI/macro-tick yet. Life
  arrives with #10 (cold pop) + #11→#12 (embodied movement). If the owner wants
  motion sooner, a minimal real `wander` locomotion slice (identity-hash stagger +
  physics collision) can jump the queue as the foundation #12 later drives.

---

## 8. Numbers & tables a future agent will need

- **World:** `kMacroDim=128`, `kCellSize=2.0 m`, `kWorldExtent=256 m`,
  `kMacroCells=128³`. `LayerId=uint32_t`, `kInvalidLayer=0xFFFFFFFF`;
  `above(w)=w+1`, `below(w)=w-1`, W does not wrap.
- **Active-floor sizing:** **N = 128** is the chosen size (only one floor live at
  a time; depth is the W-stack, not a bigger floor). 66 B/cell (2 B `CellType` +
  64 B sub-voxel mask) → 138 MB/floor; one float field 8.4 MB. 256³ would be
  1.11 GB + a 16.8 M-cell/frame render scan → gated behind a chunked mesher, and
  buys *size*, not more simulation. As N grows, what breaks first: the renderer's
  O(N³) surface scan, then sub-voxel RAM — **not** GPU fields, **not** agents. See
  [performance.md](performance.md) §Active-floor sizing.
- **Honest crowd bench** (`tests/sim_bench.cpp`, M2 Pro): 16k agents on a real
  Residential floor wandering with the *real* `physics_step` = **10.5 ms/tick
  single-thread (126 % of the 8.33 ms budget)** but **~1.5 ms across 8–12 threads**
  (6.5×, knee at 8 = 6 perf cores) → ~19 % of budget, ~86k-agent headroom.
  Collision-vs-world only (no entity-entity, AI, or fields yet). Conclusion: the
  agent tick MUST be threaded (motivates the #11 job-system); 16k/floor then fits.
- **Pool:** `kNpcPoolBits=20`, `kNpcPoolSize=1,048,576`, `kNpcActiveTarget≈950k`,
  `kAttrSlots=8`, `kNameLen=24`, `kRelSlots=16`, `kInvalidNpc=0xFFFFFFFF`.
- **Registry:** floors `−127..127` (`kFloorSlots=255`), `kMaxModules=256`,
  `ModuleId=uint16_t`, `kInvalidModule=0xFFFF`.
- **Nav lattice & bake** (`world/lattice.h`, `world/nav.h`): `kLatticeDim=4`,
  `kLatticeCount=64`, `kLatticeSpacing=32`, axis centres {16,48,80,112};
  `lattice_neighbor(id, dir)` dirs `0..5 = −x,+x,−y,+y,−z,+z` (cyclic). Coarse:
  `nav::kNodes=64`, `Dist=uint16`, `kUnreachable=0xFFFF`; `CoarseGraph` =
  `edge[64][6]` + `dist[64][64]` + `next[64][64]` (a few KB). Fine: `FineNav.flow`
  = node-major `uint8[64·128³]` = **128 MiB/floor**; byte `0..5` = step dir into
  `kNavDir` (same `−x,+x,−y,+y,−z,+z` order; `reverse(d)==d^1`), `kFlowArrived=6`,
  `kFlowNone=0xFF` (wall/unreachable). Bake pegs all cores; deterministic
  (bit-identical re-bake) because each of the 64 BFS writes a disjoint slice.
- **Sim loop:** fixed `kSimDt = 1/120 s`; fluid steps every 4 sim steps (maze mode
  only); fog `kWorldExtent*0.30 .. 0.50`.
- **Demo floors** (`main.cpp`): `{0 Residential(hub), 1 Commercial, 2 Industrial,
  3 Derelict, 4 Residential}`, registered as modules; only floor 0 is embodied at
  startup (streaming). `FloorStreamer.init(stack, keepRadius=0)` reserves
  `2*keepRadius+2 = 2` recyclable `LevelStack` slots (the ride-overlap peak).
- **Faction palette** (`embody.cpp`, +per-record jitter): 0 = **red**
  (0.90,0.28,0.26), 1 = **blue** (0.28,0.55,0.95), 2 = **amber** (0.95,0.80,0.22),
  3 = **violet** (0.66,0.34,0.86).
- **`FloorSpec` table** (`floor_spec.cpp`) — `kind: pop, factionMix{r,b,amber,violet},
  hostility, ageLo–ageHi`:
  - Residential: 420, {6,1,1,0}, 0.05, 1–90  *(red-dominant, no violet by design)*
  - Commercial:  260, {3,3,2,1}, 0.20, 14–80 *(all four factions)*
  - Industrial:  150, {2,4,1,0}, 0.35, 18–65 *(blue-dominant, no violet)*
  - Derelict:     40, {1,0,0,3}, 0.90, 16–70 *(mostly violet + a little red; sparse, ominous)*
- **`FloorGeom` table** (`floor_gen.cpp`) — `storey, stride, doorH, pillars, gap%,
  hole%, rubble%, shafts` (storey & stride must divide 128):
  - Residential: 4, 8, 2, false, 0, 0, 0, 6
  - Commercial:  8, 16, 3, false, 0, 0, 0, 8
  - Industrial:  16, 32, 5, true, 0, 0, 2, 10
  - Derelict:    4, 8, 2, false, 38, 12, 9, 4

---

## 9. Working method (from [AGENTS.md](AGENTS.md) — obey)

- **Slow is fast.** Migrations/refactors inline, in small steps, **building green
  after each.** Correctness first.
- **One verified increment per turn.** Land it, build clean (**zero warnings**),
  run `ctest`, hand the visual/runtime check to the human, then continue.
- **When you stop, stop GREEN** with a precise written plan so the next agent —
  even a cheaper one — can continue mechanically.
- **Never hand a large, interconnected task to an autonomous coding subagent.**
  Subagents are for read-only research or one clearly-scoped isolated file only.
- **Tokens are unlimited — maximize.** Never economize on research depth, reading,
  subagent fan-out, or verification (§1.4). Hand builds/launches/visual glances to
  the human — they own the runtime verification loop.
- **Docs discipline.** Update a system `.md` only when you add a real subsystem or
  change a documented contract. This `master_prompt.md` is the owner-requested
  handoff/onboarding doc — keep §6 (built) and §7 (roadmap) current as increments
  land; do not spawn other stand-alone changelog files.

---

## 10. Agent memory (out-of-repo, agent-private)

A separate persistent memory tracks the same project state for the assistant, at
`/Users/jirnyak/.claude/projects/-Users-jirnyak-Mirror-gigahrush2/memory/`
(NOT in the repo). Relevant files: `gigahrush2-architecture.md`,
`floor-module-architecture.md` (incl. the V-shape danger formulas + elevator note),
`population-roadmap.md` (the #6–#13 ledger), `player-is-alife-record.md`,
`build-constraints.md`, `torus-nav-baking.md` (the full nav-bake design + the
built L0/L1/L2 + C.2/C.2b API, the diffusion field, and the connectivity caveat).
If you are a fresh agent without that memory, **this file plus AGENTS.md +
ARCHITECTURE.md are sufficient** to continue — and for the two newest subsystems,
their own docs [nav.md](nav.md) and [diffusion.md](diffusion.md).
