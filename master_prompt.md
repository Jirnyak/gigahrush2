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

Last updated: **2026-07-29**. Status confirmed by the project owner in-game on
2026-07-28: **the game builds, runs, and holds > 60 FPS** on Apple M2 Pro (MoltenVK);
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
`diffusion_gradient` flee vector). All built and tested. The movement AI **#12** is
now their runtime consumer: `ai_step` steers fleeing bodies down
`diffusion_gradient`, so the **flee field is now visible** and the crowd moves.
`route_step` still awaits a consumer — goal-directed nav needs #13's reachable
targets. New system docs: **[nav.md](nav.md)**, **[diffusion.md](diffusion.md)**.

**Also since (headless, `ctest`-green):** the **macro society** filled in and the
**embodied brain began**. **#10d** landed the social layer — a 6×6 `Int8`
**faction relation matrix** (`src/game/faction.{h,cpp}`, ported base seed,
`hostile()`/`friendly()` at ∓50 thresholds) owned by `MacroSim`, plus a second
budgeted-cursor **social pass** that lazily forms each NPC's 16-slot `rel_` edges
toward co-floor peers, faction-seeded — so an embodying crowd already has real
relationships to act on. Then **#12 began** with **increment #12a — the utility-AI
Needs layer** (`src/game/ai.{h,cpp}`, 2026-07-29): a SoA `Needs` component
(food/water/sleep *reserves* that decay, pee/poo *pressures* that rise **only** by
digesting a pending pool the eat intent will fill) advanced in one linear
`needs_step` pass, with STR/AGI/INT attribute-scaled decay and deterministic
per-id seeding — every rate/range/model **ported verbatim from the reference
`needs.ts`**. The pure scorer + selection FSM (**#12b**) and the stagger + steering
+ embody/loop driver (**#12c**) now build on this same component set: `score_intents`
ranks 13 intents, `select_intent` applies argmax + hysteresis, and `ai_step`
staggers re-plans per identity and steers each body (flee down the diffusion field,
every other intent a per-agent wander) by writing horizontal `Velocity` into
physics — **the crowd now moves**. Goal-directed `route_step` steering waits on the
#13 content tables to give intents reachable target cells. Spec + built-state doc:
**[ai.md](ai.md)**.

**Also since (headless, `ctest`-green):** the **server-authoritative netcode seam
began**. The owner's [netcode.md](netcode.md) directive (2026-07-29) lays multiplayer
in at the engine level *now* — every session is client→server, single-player is a
listen server over an in-process loopback (client proposes, server disposes).
**Increment #1** landed the first seam: `src/game/player_command.{h,cpp}` — a
versioned POD `PlayerCommand` (the client's per-tick *intent*: button bitmask +
camera-local `wishDir` + absolute `yaw`/`pitch`) and the headless, server-side
`apply_player_command`. The SDL input bridge (`src/input/input.{h,cpp}`) now
*proposes* a command and the server *disposes* by applying it — the input layer no
longer writes `CameraTag`/`Controller`/`Jump` directly (netcode.md rule #1), so
authoritative input application is provably client-free (`tests/suite_playercmd.inl`
runs the whole apply path in `game_test`, no SDL). Behaviour is byte-identical to
the old direct write. Doc + roadmap: **[netcode.md](netcode.md)** (5 additive
increments; #1 done, #2 `GameServer` next).

---

## 1. The vision (from the owner)

gigahrush2 is a **native C++23 / Vulkan (MoltenVK) / SDL3 / Dear ImGui** rewrite
of the browser game at `/Users/jirnyak/Mirror/gigahrush` on the macOS host, or
`C:\hades\gigahrush` on the Windows host — a Russian social /
A-Life horror-sim about descending through the themed floors of a giant
khrushchevka apartment building ("Спуск и Экстракция" — *Descent & Extraction*, a
greed loop). Take the **best of the reference**, but native and honest-3D.

Four owner directives shape everything:

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
   corner or skip a check to save tokens. This directive **supersedes** the older
   token-budget note; [AGENTS.md](AGENTS.md) was reconciled to it on 2026-07-28 and
   now reads as output discipline rather than a budget. The only thing still
   bounded is what a subagent may **write** (§9) — never how many you run for
   reading, research, or review.

**The committed runtime shape (owner concept, 2026-07-28).** Two budgets, two
processes:

- **Macro-population (2²⁰) = a separate process** — the social/economic society
  sim ([macrosim.md](macrosim.md)) on its own coarse clock; it never touches the
  8 ms sim step.
- **The active floor = the real-time process** — it materializes ~16k of those
  records (residents + mobs) as embodied agents and simulates them live, with
  real-time geometry rebuilds, full destructibility, fluids, heat, and gases —
  **all of it through cells.** The split that makes this hold 125 Hz: **CPU runs
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
# headless tests. game_test and audit_test link giga_game/giga_core only; world_test
# ALSO compiles four src/render TUs and links Vulkan::Vulkan (CMakeLists.txt), so it
# needs a Vulkan loader present even though it renders nothing.
ctest --test-dir build --output-on-failure
# run — FROM THE REPO ROOT (data/textures is resolved relative to the CWD; from
# anywhere else all six texture sets silently fail to load, problems.md §31).
# There are no positional world modes: `floors` and `maze` were deleted with
# src/app/worldgen.cpp (2026-08-02). Geometry comes from floor modules.
./build/gigahrush2
./build/gigahrush2 --shot shot.png --frames 60 --floor 4   # headless capture
```

Windows host (MSVC + Ninja + LunarG Vulkan SDK) — prerequisites and the full
platform-deviation list live in [tools/win/README.md](tools/win/README.md):

```bat
tools\win\build.bat                 :: configure + build + ctest, Release
tools\win\build.bat Release fresh   :: wipe build-win\ first
```

Output is `build-win\gigahrush2.exe`; run modes and controls are unchanged. SDL3,
EnTT and Dear ImGui are fetched and pinned by CMake, so they are not prerequisites.

**Controls:** `WASD` move · mouse look (`Tab` toggles, or hold **RMB**) · **LMB**
swing (unarmed, 25 dmg, 2.4 m reach, 450 ms) · `Space`
jump · **`F`** toggle fly/walk (starts in fly) · **`[` / `]`** ride elevator
down / up a floor (loads the destination on demand, unloads the one left) · `Esc`
opens the **pause menu** (Resume / Quit; frees the cursor so the window can be
moved/minimized). HUD (top-left) shows FPS, pos + layer id, mode, instance/body
draw counts, and the active floor number + kind + target pop.

**GLOB is on** (`CONFIGURE_DEPENDS`): new `.cpp` under `src/{world,sim,ecs,app,
input,render,game}` is auto-picked-up — **do not** edit `CMakeLists.txt` for
individual sources. Shaders (`shaders/*.vert|frag`) are an explicit `foreach` —
add new shaders there. Build must be **zero-warnings**: `-Wall -Wextra
-Wno-unused-parameter` on Clang/GCC, `/W4 /wd4100` on MSVC, both applied by
`giga_target_flags()` in the top-level `CMakeLists.txt`.

---

## 3. Hard rules (condensed — full text in [AGENTS.md](AGENTS.md))

A future agent will trip on these; obey them:

- **No exceptions, no RTTI.** Built `-fno-exceptions -fno-rtti`, EnTT with
  `ENTT_NOEXCEPTION`. No `try/catch/throw/dynamic_cast/typeid`. For type identity
  use the `type_tag<T>()` pattern in `src/world/field.h`.
  **On Windows this is not compiler-enforced.** MSVC's STL is unsupported under
  `_HAS_EXCEPTIONS=0`, so the Windows build uses `/EHsc`; only RTTI ports (`/GR-`).
  There the rule is code discipline: add a `throw` and the **macOS build catches it
  while Windows stays green**. A green Windows build is necessary, never sufficient.
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
  the 125 Hz sim tick or the present path. It reads *up* into the action game
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
             player_command (netcode client→server intent seam),
             population, elevator, macro_sim, faction, ai              [giga_game]
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
  (Residential/Commercial/Industrial/Derelict): population, `factionMix[5]`,
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
  sim loop (`kSimDt` = 1/125 s, frozen while paused), the render loop, HUD, the
  **pause menu** overlay, and event handling incl. `[` / `]` (via `streamer.travel`) and
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
  125 Hz sim tick. The flee/scent input to #12, distinct from nav and from
  `FloorSpec.hostility`. See [diffusion.md](diffusion.md).

**Key components** (`ecs/components.h`, all POD): `Transform{vec3 pos; LayerId
layer}`, `Velocity`, `AABB{half}`, `GravityAffected{scale,grounded}`,
`Jump{impulse,wants_jump}`, `CameraTag{yaw,pitch,fovY=1.2,eyeOffset}`,
`Controller{moveSpeed,wishDir,fly}`, `Renderable{color}`. Game-layer `NpcRef{id}`
lives in `embody.h`; the embodied-only `Needs` block (#12a) lives in `ai.h`.

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

**Macro + brain tests (`game_test`):** the demographic tick (aging / mortality /
births / determinism / embodied-skip, #10a), the per-floor bucket index +
migration (#10b/#10c), the **faction matrix** (`test_faction_matrix` — base seed,
`hostile()`/`friendly()` thresholds, `nudge` clamp) and the **budgeted social
pass** (`test_macro_social` / `…_determinism` — edges form only when enabled,
faction-consistent, deterministic), and the **utility-AI needs layer**
(`test_needs_decay`, #12a — seed determinism + per-need bands + fresh-gut pools,
reserve decay = `rate·dt`, STR/AGI/INT attribute scaling, pending-pool digestion,
clamp at 0, O(n) column sweep; 900k checks).

**Netcode seam — began (headless, `ctest`-green; [netcode.md](netcode.md)).**
Multiplayer laid in at the engine level from day one (owner directive, 2026-07-29):
client proposes, server disposes; single-player is a listen server over an
in-process loopback. Five additive increments; **#1 built:**

- **Netcode #1 — `PlayerCommand` POD + input bridge routed through it (DONE
  2026-07-29).** ✔ `src/game/player_command.{h,cpp}`: a versioned, `static_assert`ed
  trivially-copyable / standard-layout POD (rule #5) carrying one tick of client
  *intent* — a `Button` bitmask (jump / fly-toggle now; attack / use / interact /
  elevator / eat / … reserved), camera-local `wishDir`, **absolute** `yaw`/`pitch`
  (Source *usercmd* style), and `clientTick`. `apply_player_command(reg, avatar,
  cmd, dt)` is the headless server-side writer: it **clamps pitch** (~±89° — the
  client is never trusted with look range), flips fly on the toggle edge, gates jump
  on walk mode, and writes to **one explicit avatar** (rule #4 — per-connection, not
  global). The SDL bridge (`src/input/input.{h,cpp}`) now splits into
  `build_command` (client: gather device state → command) + `apply_player_command`
  (server: apply) and **no longer writes `CameraTag`/`Controller`/`Jump` directly**
  (rule #1). Same-tick apply on the loopback ⇒ byte-identical feel. Proof it runs
  client-free: `tests/suite_playercmd.inl` (7 tests: wire-safety + memcpy round-trip,
  move/look write, server pitch clamp, jump-only-walking, fly-toggle-edge,
  per-entity ownership, invalid-avatar no-op) exercises the whole apply path in
  `game_test` with **no SDL**.

**Antourage — baked floor dressing (BUILT 2026-08-02…04, [antourage.md](antourage.md)).**
The owner's "генератор проги внутри проги": after a floor module finishes its
geometry, `bake_antourage` walks the finished grid as pure CONTEXT and emits
**three universal primitives** — rigid `AntourageInstance` rows (pipes, elbows;
2975 on floor 0), `WireChain` verlet ropes (802) and `ClothSheet` 8×4 verlet
sheets (152). The law: the grid is only an **anchor** — antourage never writes
voxels, so nothing is ever invisible-but-solid, and it carries no collision.
Wires and cloth are integrated **entirely on the GPU** (`wire_sim.comp`,
`cloth_sim.comp`); every body on the layer pushes them and they push nothing
back (the player is just one body). The bake is a pure function of
`(grid, number, seed)`, lives per resident module beside `FloorNav`, and is
never persisted. **Destruction reaches it** (2026-08-04): `antourage_carve_step`
is the dressing's `anchor_validate_step` twin — a carve's `dirtyCells` name
exactly the pieces severed by that op, each sheds a material-tinted debris burst
into the unified particle pool, and the caller re-packs `PropPass`; severed pipe
stumps become drip emitters. Aliveness is always a live-grid probe, never a
cached flag. Proof: `tests/suite_antourage.inl` (determinism, anchors-are-solid,
no pipe material ever written into a cell, carve kills exactly once).

**Unified GPU particle pool (BUILT 2026-08-03).** Blood, dust, debris, sparks
and drips are rows of `data/particles.csv`; every game-side writer pushes a
BURST into one bounded POD queue (`game/particles.h`) and the app drains it into
a 32k-particle SSBO with a compute sim that collides against the voxel mirror.
One dispose path, many proposers — the same law as `CarveProposalQueue`.

---

## 7. Remaining roadmap (tracked as tasks #10–#13)

Work **one verified increment per turn, build green, stop green with a plan**
(§9). Order below is the intended sequence, but note the owner pulled the **nav
bake (#11 A/B/C) forward** ahead of #10 — that core is now built (§6). The **whole
macro tick #10 is now done** (demographic core #10a, bucket index #10b, migration
#10c, faction matrix + social pass #10d). **#12 movement AI is now built** —
needs layer #12a, pure scorer + selection FSM #12b, and the stagger + steering +
embody/loop driver #12c (2026-07-29): the visible crowd steers itself (flee field +
per-agent wander), with goal-directed `route_step` steering deferred until **#13**
content gives intents reachable targets. **The MacroSim app-loop wiring is now DONE
(2026-07-29):** `macro.step()` runs in `main.cpp`'s fixed-step loop every
`kMacroPeriodTicks` (250 ticks = 2 s), gated to floors mode, after
`set_floors_from(registry)` turns migration on; a HUD "society:" line shows it, and
The embodied-skip is proven in `tests/suite_macrosim.inl` against a real
streamer-loaded floor (the on-screen crowd never ages while the cold society churns).
*(This sentence used to name `tests/suite_macrowire.inl`, which does not exist in the
tree — the claim was true, the citation was not.)*
So the open work is **#13** content tables (then `route_step` goal-seeking lights up).
The floor-module epic (#6–#9) is **done**.

### #10 — Macro tick (demographic core + bucket index + migration + social BUILT 2026-07-28) ✔
Coarse clock (own rate, **never** the 125 Hz sim tick — [macrosim.md](macrosim.md)).
**CORRECTED 2026-08-06:** as wired, it IS driven off the sim tick —
`if (simTick % kMacroPeriodTicks == 0) macroSim.step(...)` sits inside
`while (simAccum >= kSimDt)` in `main.cpp`, and `kMacroPeriodTicks = kSimHz * 2`.
The clock is coarse but its trigger is not independent, and `MacroSim::step` opens
with an unbudgeted columnar sweep over the whole pool. Harmless at today's ~4.2k
seeded records, a designed-in wall at the 2²⁰ target. See [problems.md] §21.
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
- **#10c — budgeted-cursor migration (DONE 2026-07-28).** ✔ A persistent ring
  cursor (`migCursor_`) visits ~64 cold records/tick (the ref's `RECORDS_PER_TICK`),
  deterministically rolls a departure, and starts a **multi-tick journey** to a
  destination floor in the configured band with an ETA `(base + perFloor·|Δ|)×jitter`
  (ref shape). Journeys are macro-owned (`std::vector<Journey>`, external to the
  pool); due ones **land as an O(1) `set_floor` relabel** — the #10b bucket index's
  first client — while dead / embodied-mid-transit records forfeit theirs. Off unless
  a floor band is set (`floorHi>floorLo`), so the demographic bench/tests are
  unaffected; **+0.05 ms/tick** at 1M even under a heavy 65536-rec budget
  (`macro_bench` two-phase). 2 new tests (`test_macro_migration`, `…_determinism`).
  Deferred: route/danger destination gating (no route metadata ported yet) and
  live-floor arrival materialization (a streaming concern).
- **#10d-i — faction relation matrix (DONE 2026-07-28).** ✔ `src/game/faction.{h,cpp}`:
  a row-major **6×6 `Int8` attitude table** (`FactionId` = 6 kinds; `kFactionCount`),
  default-seeded to a **ported base matrix**, clamped to `[-127,127]` (−128 avoided).
  `hostile()` / `friendly()` classify a cell at the ∓50 thresholds; `nudge` /
  `nudge_mutual` / `set` mutate with clamping; `reset_to_base` restores the seed.
  Owned by `MacroSim` (`factions()`), so it is *society state*, read by both the
  #12 `faction_assault` intent and the social pass below. `test_faction_matrix`.
- **#10d-ii — budgeted-cursor social pass (DONE 2026-07-28).** ✔ A **second**
  persistent ring cursor (`socCursor_`, independent of migration's), visiting
  `socialRecordsPerTick≈64` cold records/tick, that lazily **forms** per-NPC
  relationship edges (the 16-slot `rel_` block, [npcs.md](npcs.md)) toward co-floor
  peers, the initial attitude **seeded from the faction matrix** so acquaintances
  start faction-consistent (Citizens warm, Wild cold). **OFF unless
  `socialFormRatePerYear > 0`**, so the demographic/migration bench + tests are
  byte-for-byte unaffected; `MacroStats.socialEdges` reports edges formed.
  Deterministic via the same stateless `(id,tick,salt)` hashing.
  `test_macro_social` / `test_macro_social_determinism`. The #12 `social` intent
  now has a populated graph to act on rather than a world of strangers. *Deferred:*
  relationship **decay/drift** of existing edges and economy dynamics (per-floor
  commodity stock) — event-driven, on the same tables, when content (#13) lands.

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

### #12 — Utility-AI for embodied NPCs (`src/game/ai.{h,cpp}`, [ai.md](ai.md))
13 intents scored 0–100, argmax + hysteresis, **identity-hash stagger** (zero
per-NPC scheduling RAM), steering the **baked** nav — this is what finally makes
the **visible crowd move** (wander, flee, seek). Runs only on the embodied slice
of the live floor; the cold pool stays the macro tick's job. Split into three
verified increments:

- **#12a — Needs layer (DONE 2026-07-29).** ✔ `src/game/ai.{h,cpp}`: a SoA `Needs`
  ECS component — `float[kNeedCount]` of 0..100 drives (food/water/sleep
  **reserves** that decay toward crisis; pee/poo **pressures** that rise toward
  failure) plus two `pending` digestion pools — advanced by one linear
  `needs_step(reg, pool, dt)` sweep over the packed column (O(n), no per-object
  dispatch). Reserves decay unconditionally, each **attribute-slowed** by the
  reference formula `rate /= (1 + 0.1·stat)` (STR→food, AGI→water, INT→sleep, read
  from the record's generic 8-slot attr block); pressures rise **only** by
  digesting their pending pool (fresh guts hold flat until the eat intent fills
  them). `seed_needs(needs, id)` deterministically seeds a fresh body from its
  stable id (stateless `hash3`, per-need bands) — reproducible embodiment, zero
  stored RNG. Every rate/range/model **ported verbatim from `needs.ts`**.
  `test_needs_decay`. Needs materialise on embodiment and fold with it (like every
  transient); restore-on-use is an intent *effect*, so it lands with #12b.
- **#12b — pure scorer + selection FSM (DONE).** ✔ `score_intents(perception, needs,
  out[13])`, one additive scorer per intent (`safety · combat · flee · toilet · drink
  · eat · sleep · work · heal · social · patrol · faction_assault · wander`), each
  clamped 0..100 — a pure, stateless function (no cross-talk) reading a `Perception`
  snapshot; every input the engine can't yet supply sits at 0/none/−1 so its term
  contributes 0 and the live ranking matches the reference exactly. Then
  `select_intent(scores, current)`: argmax with **hysteresis** — switch-margin 7,
  emergency override 58 for safety/flee/combat/heal, growing stickiness +5→+12 (fed
  via `Perception.stickinessAmount`). Reads the #10d faction matrix
  (`faction_assault`) and `rel_` edges (`social`). Frozen per-intent constants
  re-extracted verbatim. `test_scorer` + `test_selection`.
- **#12c — stagger + steering + wiring (DONE 2026-07-29).** ✔ `ai_step(reg, pool,
  danger, grid, now, dt)`: iterates the live AI set, **skips camera-holders** (the
  player), and per agent either re-plans or coasts against its `AiBrain.nextDecisionAt`
  deadline — a **per-identity period** (1.5–4.0 s) from the stateless `channel_seed`
  FNV-1a fold, so the crowd re-plans off-lockstep with only the one deadline float
  (no wheel/queue). Steering writes **horizontal `Velocity`** straight into physics
  (plain NPCs have no `Controller`/`CameraTag` — that's the player's input seam):
  **flee** heads down `−diffusion_gradient(danger)`, every other intent roams a
  deterministic per-agent `wander_heading`; `v.z` left to gravity. `embody()` attaches
  `Needs`+`AiBrain`; the fixed-step loop runs `needs_step`→`ai_step`→`controller_step`
  →`physics_step` with a monotonic `simNow`. `test_ai_step`. **Deferred:** full
  `route_step` goal-seeking (fine flow fields target elevated lattice nodes a
  gravity-bound walker can't reach) — lands with #13's reachable target cells.

### #13 — Content tables (`item_table` + `mob_table`)
POD, data-driven ([items.md](items.md), [monsters.md](monsters.md)). Ref scale:
~444 items (POD + tag bitmask + use-effect enum), **69** monster kinds (52-flag
`aiFlags` union), loot (spawnW + value-gate + depth caps), economy bands E0–E4.
Mobs are **not** in `NpcPool` — they spawn per-floor from the mob table and vanish.
Decomposed into **#13a** item_table → **#13b** mob_table → **#13c** loot tables →
**#13d** per-floor spawning → **#13e** use-effects + `route_step` goal steering.

- **#13a item_table — DONE** ([items.md](items.md), `src/game/item_table.{h,cpp}`,
  `test_item_table`). POD `ItemDef` (type/value/spawnW/stack/durability/`resist[5]`/
  `tags` bitmask/science/contraband/deceptive/`UseEffect`) + `ItemType`/`DamageType`/
  `ItemTag` enums + the **full 446-item** catalog generated from `data/items.csv`
  (`kItemCount = 446` in `item_table.h`; array-index-is-id, 0 = none) +
  `item_def(id)` / `item_id(name)` lookups + `apply_use_effect(needs, hp, maxHp,
  def)` — which **closes the #12a digestion loop** (baked pending-pool deltas feed
  `needs_step`). `use` closures re-encoded as flat baked deltas; weapon *combat*
  stats deferred to a separate id-keyed registry with combat. `dPsi` stored,
  not applied (no psi stat — stubbed-input stance). Reference schemas for #13c/
  #13d (loot mechanisms, design-vs-procedural spawn formulas — the §4 V-shape
  count/tier CONFIRMED as the *design* path) are extracted and in the session
  transcript.

- **#13b mob_table — DONE** ([monsters.md](monsters.md), `src/game/mob_table.{h,cpp}`,
  `test_mob_table`). POD `MobDef` (name/hp/dmg/speed/attackRate/ranged/projSpeed/
  `projType`/`aiFlags`/spawnW/minSamosbor/rare) + `MobAiFlag` bitmask (the ~52-flag
  reference `aiFlags` union **compressed** into 18 structural behaviour families —
  a flag exists once a consuming system reads it) + `ProjType` + the **full 69-kind**
  catalog generated from `data/mobs.csv` (`static_assert(kMobKindCount == 69)` in
  `mob_table.h`; array-index-is-kind, **no** 0
  sentinel — kind 0 is a real mob) + bounds-tolerant `mob_def(kind)` / `mob_kind
  (name)` mirroring `item_def` + inline per-level scaling (`mob_scaled_hp/dmg/speed`,
  the reference `rpg.ts` +12%/+10%/+2%-per-level curve, `Math.round`, no `<cmath>`).
  Stats ported verbatim from `../gigahrush/src/entities/*.ts`; spawnW/rarity from
  `monster_ecology.ts`. Table invariants asserted (`ranged ⇔ projSpeed>0`,
  `speed==0 ⇒ AiRooted`). Mobs remain templates — #13d spawns per-floor ECS
  entities (scaled by level) that vanish on de-embodiment.

- **#13c loot tables — DONE** ([items.md](items.md), [monsters.md](monsters.md),
  `src/game/loot_table.{h,cpp}`, `test_loot_table`). Two death-drop mechanisms
  ported from `monster_ecology.ts`+`procedural_loot.ts`, keyed by `MobKind` into
  a parallel `MobLoot` table: **`rareDrops`** (first-hit-single — walk in order,
  first passing `chance` drops one item, stop; player-kill-gated) present on every
  kind, and **`lootTable`** (independent per-entry rolls, uniform `[min,max]`
  count, shuffle + **cap 3**; any death) on the 3 reference kinds (gnome/zombie/
  `betonnik`←betonoed). `roll_mob_loot(kind, seed, killerIsPlayer)` → fixed-cap
  (`≤4`) `LootResult`, **deterministic from seed, no stored RNG state** — a local
  draw counter over giga's splitmix `hash2`/`rand01` ([core/rng.h]) SUBSTITUTES
  the reference stateful xorshift32 (different program → no shared replay; port the
  semantics, use the native mixer). Reference item keys outside this engine's item
  span mapped to nearest id by role (documented per row). Verified statistically
  (200k seeds/kind hit the reference chances; first-hit-single proven — never two
  rares). The **value-gated procedural pool** (NPC/container/merchant loadouts —
  `calculateMaxLootValue` soft-exp gate `weight*=exp(-(value/cap−1)·3)`, spawnW ×
  type-mult × tag-mult) is a SEPARATE reference system, deferred to NPC/container
  spawning (schema extracted, in transcript).

### Netcode — server-authoritative seam (owner directive, [netcode.md](netcode.md))
Laid in **additively**, each increment green; on the `LocalConnection` (loopback)
the whole game runs exactly as today until the final mode-dispatch step. **#1 done
(§6); #2–#5 open:**
- **#1 — `PlayerCommand` POD + input routed through it (DONE 2026-07-29).** ✔ §6.
- **#2 — `GameServer` (`giga_game`)** — owns the authoritative `Registry` /
  `LevelStack` / `FloorStreamer` / `MacroSim` and a `tick(dt)` running the existing
  system order, **extracted from `main.cpp`**; headless-constructible and
  unit-testable with no client (server logic gains `game_test` coverage). The
  natural next increment.
- **#3 — `Connection` interface + `LocalConnection`** (loopback, zero serialization)
  in `giga_game`: client reads the server `Registry` directly; `send(cmd)` hands the
  struct straight over.
- **#4 — `GameClient` (`src/app`)** — owns render + input, holds a `Connection`;
  per-frame gather input → `build_command` → `send`; read view → render. (The input
  bridge's `build_command` is already public for exactly this.)
- **#5 — `main.cpp` mode dispatch** (`--dedicated` / `--connect <addr>` / default
  listen) constructing server and/or client + the right `Connection`. Dedicated
  server falls out for free (server builds with no GPU).

### Standing follow-ups (fold in when the relevant increment lands)
- **`floor_spec_for()` is currently monotonic (`floor % 7/5/3` pattern) and takes
  `uint16_t`.** Retune to **signed int + V-shape** danger (§4) when the mob/danger
  increment lands. `NpcPool::floor` is also `uint16_t` — revisit for signed labels.
- **Danger / mobs / samosbor** — mob spawning by V-shape count+tier; `dangerField`
  (blood/scent fluid) is a *separate* runtime thing from the danger rating;
  **samosbor** = timed floor-wide maze-restructure event (7 theme variants, cooldown
  ~inverse to depth) + an L4D-style director with an anti-swamp valve.
- **Embodied NPCs now move** — the **macro tick (#10)**, the **nav/flee bakes
  (#11)**, and the **full brain (#12a needs + #12b scorer/FSM + #12c stagger/steering
  driver)** are built: on the live floor each body scores 13 intents, commits one
  with hysteresis, and steers by the flee field (flee) or a per-agent wander (all
  else), writing horizontal `Velocity` into physics. Off-screen life advances on the
  macro clock. **What's still flat:** intents have no *specific* destinations yet
  (eat/sleep/toilet/combat all fall through to wander) — goal-directed `route_step`
  steering lights up once **#13** content gives them reachable target cells.

---

## 7b. Prompt-plans from the 2026-08-06 audit — one brief per session

Self-contained. Each is a session's worth of work: hand one over verbatim, do
that and nothing else. Every one names its problems.md section, the files, the
acceptance test, and the trap that will bite. **Read the named problems.md entry
first** — several of them record a fix that was already tried and reverted, and
repeating it wastes the session.

Ordered by value. A–C are gameplay; D–F are structural; G is hygiene.

---

### PLAN A — Make the crowd want things (problems.md §27) — **DONE 2026-08-06**

> **DELIVERED.** All four legs landed in that order; §27 is CLOSED and carries the
> numbers. Live run: `own_ai` 0 → 21..85 of ~380, the intent histogram MOVES
> (`drink` 78 → 39 as the crowd gets watered, against a frozen `work=335
> patrol=84` before), `crowd_dead_total=0` with the clock running for every body.
> Two defects the plan below did not anticipate are what actually decided it, and
> both are written up in §27: nav's "not fully solid" walkability is a 1-in-512 bar
> that a 4x4x7-sub-voxel collider cannot clear (62 of 63 errand bodies were pinned),
> and axis-aligned steering let a body clip the jamb of the doorway its own field
> routed it through (23/64 arrivals against 64/64). Read §27 before touching this
> area; the remaining debt is listed there under «ЧТО НЕ СДЕЛАНО» —
> `IntentHeal`'s deadlock, `Perception::armed`, work/social/patrol rows, and the
> X/Y-only room taxonomy. The brief below is kept as the historical statement of
> the problem.

**Do NOT start by widening the needs tick.** That was tried on 2026-08-06,
measured, and reverted: with the clock running for all 419 bodies (`needsCrowd=419`)
`own_ai` stayed **0**, because `MotionOwner::Ai` is taken ONLY on `IntentFlee`
(`ai.cpp:770` — "IntentFlee is still the ONLY owning intent"). Every other winning
intent hands motion back to `wander_step`. Widening the tick alone changes nothing
and breaks `suite_needs.inl:865-891` (63 CHECKs that deliberately pin the narrow
scope, with a written argument in `needs.h:25-35`).

The pillar has three legs and needs all three:

1. **Let a non-Flee intent OWN motion.** `ai.cpp` around `:770-785`. Until an
   `eat` decision can actually steer a body, the scorer is decoration.
2. **Give a hungry body somewhere to GO.** Zone fields over the 128³ keyed to
   needs (kitchen / toilet / living), which ARCHITECTURE.md §Манифест п.4 calls
   for and floors.md lists as ЧАСТИЧНО. `floor_room_mask(kind, number, rx, ry)`
   already exists and already carries `RoomBit::Kitchen`/`Bathroom`/`Living`;
   what is missing is a per-cell field the AI can descend, and `nav::route_step`
   to steer by it.
3. **Give it something to RECOVER from.** Ambient recovery in the matching room,
   the way the reference does (`needs.ts:279-314`). Without it a need saturates
   and the body pins itself in an unsatisfiable emergency — the same deadlock
   `IntentHeal` already has (`hunt.h:41-42`: nothing heals a crowd body).

Only THEN widen `needs_step` past the camera holder, and re-pin `suite_needs`
with the reason in the commit message.

**Acceptance:** `[aimem] STEP … own_ai=N` with N > 0 on a live run, and a body
observed walking to a kitchen and its food bar rising. Not a green test — a
printed number and a screenshot.

---

### PLAN B — Data authored but never read (problems.md §35)

The single largest class the audit found. ~10 CSV column groups are parsed into
structs that nothing consumes, including **272 nav-traversal numbers** in
`data/mobs.csv` (`nav_step_sub`/`nav_climb_sub`/`nav_drop_sub`/`nav_fly`) that the
nav bake never opens, and an `ai_flags` column the generator silently ignores
while building `aiFlags` from *other* columns (46 of 68 rows differ).

Two directions, do both:
- **Wire or delete.** For each group in §35's table, either give it a reader or
  cut the column and say why in the commit.
- **Close the CLASS with a gate.** `source_rules` counts CSV *rows*, never
  columns. A column with no consumer is invisible to every gate in the tree. The
  cheap fix is the pattern `item_table.h:14-24` already uses: an explicit
  "deferred, and here is why" list, made mandatory — a column that is neither
  read nor listed fails the build.

**Trap:** three rows in §35's table were WRONG in the first draft (they do have
readers). Verify each with your own grep before deleting anything.

---

### PLAN C — Force written as an axis letter (problems.md §15, §34)

Isotropy was won once, for antourage (§8), and never propagated. Still in the Z
frame: **the player's own locomotion** (`controller.cpp:18-44` — basis built from
literals `right{sy,-cy,0}`, `up{0,0,1}`, and walk writes only `.x`/`.y`),
knockback that pushes along the gravity axis (`combat.cpp:150-159` — it launches
bodies upward instead of back), corpse settling written in a Y-up frame
(`combat.cpp:297-304`), four `±Z` literals in `prop_system.cpp`, hearing that
refuses to wrap z (`noise.cpp:212-217`), and the AI's memory/shelter bearings
which drop `dz` entirely (`ai.h:655-659`, `ai.cpp:419-421`).

The rule is written and the machinery exists: `GravityFrame` + `gravity_frames()`
in `world/gravity.h`. §8's lesson is the method — **generalising is DIAGNOSIS**:
running the antourage bake over all eight regimes exposed a years-old bug in the
Z frame itself.

**Acceptance:** a test that drives locomotion under a non-`NegZ` regime. Today
nothing does, which is exactly why all of this survives.

---

### PLAN D — Systems built and never connected (problems.md §13)

`src/sim/cellular.{h,cpp}` is **1,484 lines with zero callers and zero tests**,
and its header cites a `tests/suite_cellular.inl` that has never existed — so
every measured claim in it is unverified. `fluid_step` and `diffusion_step` are
called only from tests while their consumers run every tick and read zeros
(`pos_wet` always false; `danger` null, so nobody ever flees).
`VoxelMirror::mark_fluid_dirty()` has no caller, so the fluid mirror is frozen at
boot. `stain.h` promises pages that "fade back to black" and no fading function
exists.

Decide per system: wire it, or cut it and say why. Then close the class — **no
gate anywhere asks whether a system is CALLED**. A list of public `*_step` /
`*_tick` entry points required to have a caller outside `tests/`, with an
explicit exemption list, is the cheapest thing that would have caught all of it.

---

### PLAN E — main.cpp is 5,616 lines, ~1,400 of them giga_game (problems.md §29)

Measured line ranges are in §29's table. The two critical state bugs of this
audit (§24 stale `activeLayer`, §25 duplicate player body) both lived here and
both were unreachable from `game_test` — that is the argument, not tidiness.

Highest value first: per-tick monster traits as an `if`-chain on `MobKind`
(3245-3333) when `monster_traits.h` already holds the data; the F9 world restore
(3917-4107); interact resolution (3480-3600); `do_ride` (2234-2358), which is
duplicated for `--shot` at 5436-5534 and which the file itself warns about four
times.

**Trap:** move in verified increments, build green after each. Do not attempt the
whole extraction in one pass.

---

### PLAN F — Gates that one line disables (problems.md §36)

`check_source_rules.cmake` checks a suite is compiled with a raw
`string(FIND …)` over the concatenated text of every `tests/*.cpp` — so a
**commented-out** `#include` or dispatch call satisfies it. The idiom already
exists in the tree (`game_test.cpp:4262`). The `unwired-suite` exemption is
self-service and silent: the pin `files_scanned=[0-9][0-9][0-9]` still matches.
`sim_bench` prints `FAITHFUL` by comparing RUNTIMES, never a trajectory. And
`wrapf` — the float torus wrap every entity position passes through twice per
step — has **zero** assertions.

---

### PLAN G — Confirmed one-liners (problems.md §30, §19, §20)

Each is small, independently verifiable, and none needs a design decision:

- `LevelStack::above(kInvalidLayer)` returns layer **0** (unsigned wraparound), so
  `w = stack.above(w)` wraps W — the one axis that must not wrap.
- `wrapf` can return exactly `size`, outside its documented `[0, size)`.
- `FieldRegistry::get_or_create<T>` reinterprets memory on a type mismatch while
  its own comment claims a debug assert that does not exist. The tag is already
  stored; the check is one pointer compare.
- `VoxelMirror::verify()` omits `fluid_` — the exact §7 lesson ("every buffer in
  BOTH the snapshot path and verify()").
- `samosborPulse` is recomputed in `cube.frag`/`raymarch.frag` with two errors, so
  the world pass runs the effect at **0.457** where the CPU says 1.0.
- `pc.torus.w` carries a packed mask AND a seconds clock; the world pass gets a
  denormal (or a NaN) where it expects time.
- Stain pages survive floor regeneration and leak on carve — blood from floor −8
  is still resident when the slot becomes floor 3.

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
  single-thread (131 % of the 8 ms budget)** but **~1.5 ms across 8–12 threads**
  (6.5×, knee at 8 = 6 perf cores) → ~19 % of budget. The agent-count headroom
  (once quoted as ~86k) is **unstated pending a re-run**: it was projected against
  the retired 8.33 ms budget, and `sim_bench.cpp` still builds its budget from a
  hardcoded `1.0f / 120.0f`, so its own printout reads ~4 % high.
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
- **Sim loop:** fixed `kSimDt = 1/125 s` — `kSimHz = 125` and `kSimStepMs = 8`
  **exactly**, all three in [src/core/tick.h](src/core/tick.h), which is the only
  place the rate may be written. 125 rather than 120 because every timer in the game
  is integer milliseconds: at 1/120 the `dt*1000+0.5` conversion truncated 8.833 to
  **8**, so a second of sim took 125 ticks and every authored cooldown/reload/
  telegraph/samosbor phase ran **4.17 % slow**. A `static_assert` pins
  `kSimStepMs * kSimHz == 1000`. Never write a bare `1/120` or `1/125`; use the
  constants. Fluid steps every 4 sim steps (maze mode only); fog
  `kWorldExtent*0.30 .. 0.50`.
- **Demo floors** (`main.cpp`): `{0 Residential(hub), 1 Commercial, 2 Industrial,
  3 Derelict, 4 Residential}`, registered as modules; only floor 0 is embodied at
  startup (streaming). `FloorStreamer.init(stack, keepRadius=0)` reserves
  `2*keepRadius+2 = 2` recyclable `LevelStack` slots (the ride-overlap peak).
- **Factions — FIVE, not four** (`src/game/faction.h`, +per-record jitter of
  ±0.09 applied uniformly to all channels): 0 = Citizens **green-teal** `#4abe91`,
  1 = Liquidators **blue** `#5b9eee`, 2 = Cultists **violet** `#bc59ff`,
  3 = Scientists **cyan** `#67d8e8`, 4 = Wild **amber** `#e0a745`.
  **Red is reserved for danger and is never a faction** — in the reference
  `#e64e5c` belongs to *samosbor*, a territory owner with no diplomacy. Monsters
  own the red/dark axis (`mob_spawn.cpp` `tier_color`), which is what makes a
  civilian distinguishable from a threat in a dark corridor. `game_test`'s
  `test_palette_separation` pins the two palettes apart, measured under
  worst-case jitter. Anything indexing factions must be **5** wide: the earlier
  `faction & 3` mask silently folded Wild onto Citizens.
- **`FloorSpec` table** (`floor_spec.cpp`) — `kind: pop,
  factionMix{citizen,liquidator,cultist,scientist,wild}, hostility, ageLo–ageHi`:
  - Residential: 420, {7,1,1,0,1}, 0.05, 1–90  *(the citizen hub)*
  - Commercial:  260, {3,2,1,2,2}, 0.20, 14–80 *(all five mix)*
  - Industrial:  150, {2,4,0,2,1}, 0.35, 18–65 *(liquidators keep it running)*
  - Derelict:     40, {1,0,4,0,3}, 0.90, 16–70 *(cultists + wild; sparse, ominous)*
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
  This bounds what a subagent may **write**, not how many run: read-only fan-out is
  uncapped per §1.4. The lead does the interconnected edit itself. One build owner
  at a time — a single `build/` or `build-win/` tree, so concurrent builds corrupt
  each other's artifacts and `ctest` results. A subagent's "builds clean" is
  evidence to re-run, not proof.
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
(NOT in the repo). **That path is macOS-host-only and does not exist on the
Windows host** — verified absent 2026-07-28; a Windows agent has no gigahrush2
memory directory and must work from this file plus `AGENTS.md` and
`ARCHITECTURE.md`, which the closing line below confirms is sufficient. Relevant
files on the macOS host: `gigahrush2-architecture.md`,
`floor-module-architecture.md` (incl. the V-shape danger formulas + elevator note),
`population-roadmap.md` (the #6–#13 ledger), `player-is-alife-record.md`,
`build-constraints.md`, `torus-nav-baking.md` (the full nav-bake design + the
built L0/L1/L2 + C.2/C.2b API, the diffusion field, and the connectivity caveat).
If you are a fresh agent without that memory, **this file plus AGENTS.md +
ARCHITECTURE.md are sufficient** to continue — and for the two newest subsystems,
their own docs [nav.md](nav.md) and [diffusion.md](diffusion.md).
