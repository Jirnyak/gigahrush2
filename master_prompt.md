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
visible; elevator (`[` / `]`) travel works.

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
down / up a floor · `Esc` quit. HUD (top-left) shows FPS, pos + layer id, mode,
instance/body draw counts, and the active floor number + kind + target pop.

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
- **CPU is the only scarce resource.** Disk/GPU unlimited, RAM ~8 GB, load time
  unbounded, **sim tick sacred: O(n) in live entities/cells.** Two consequences:
  **(1) dense over sparse** (a 128³ field is 2–8 MB — store it flat, fully
  populated); **(2) bake at load, tick O(1)** (precompute BFS/nav/flow/light into
  flat memory once; never run BFS/A* in the hot path — when geometry mutates,
  freeze → re-bake → resume).
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
floor 0; ±1 moves between adjacent floors; a planned 8×8 fast-travel grid comes
later ([elevators.md](elevators.md)).

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
src/core     dependency-free math (math.h) + toroidal wrap (wrap.h)
src/world    macro grid + 8³ sub-voxel masks, typed fields, vector gravity,
             LevelStack (W), world types/constants (types.h)          [giga_core]
src/ecs      universal POD components (components.h) + EnTT alias      [giga_core]
src/sim      physics, controller, camera, fluid  (*_step free fns)    [giga_core]
src/game     GAME LAYER — NpcPool, inventory, event_bus, embody,
             floor_spec, floor_registry, floor_gen, population,
             elevator                                                  [giga_game]
src/render   Vulkan device/swapchain/renderer, cube_pass (world),
             body_pass (NPCs), imgui_layer                             [render]
src/input    SDL3 → ECS input bridge
src/app      window + main loop + worldgen (main.cpp, worldgen.*)
shaders      cube.vert/frag (world), body.vert (NPCs) → SPIR-V at build
tests        world_test (core), game_test (game layer, headless)
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
- `app/main.cpp` — window/Vulkan bring-up, the floor stack setup, the fixed-step
  sim loop (1/120 s), the render loop, HUD, and event handling incl. `[` / `]`.

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

**Tests (`game_test`, headless):** inventory, pool basics + death-keeps-slot,
relationships, design flag, event bus (transient/overflow/log), attribute block,
height→body, embody/foldback, player-is-a-record, population seed, floor_spec,
seed_from_spec, floor_registry, floor_gen, elevator. `world_test` covers the core.

---

## 7. Remaining roadmap (tracked as tasks #9–#13)

Work **one verified increment per turn, build green, stop green with a plan**
(§9). Order below is the intended sequence; the floor-module epic is #9, then the
"life" layer (#10–#12), then content (#13).

### #9 — Streaming (NEXT, floor-module epic)
Today all 5 demo floors are embodied at startup. The reference keeps **one floor
live at a time.** Build that seam:
- Embody only the **active floor** (± a neighbour); keep the rest cold in the pool.
- **Enter** a floor = `generate_floor` (deterministic, bit-for-bit — guaranteed by
  #6) + embody its crowd; **leave** = `fold_back` the whole crowd into the cold
  pool (position/state deltas persist), free/clear the layer.
- Elevator **loads on demand**: `ride_elevator` currently no-ops on an unloaded
  destination — make it load first, then ride.
- **Key subtlety:** on re-entry, re-embody the **same** records, not fresh ones
  (else population grows per visit). Seeding is a contiguous id range per module —
  store `[firstId, count)` per module and re-embody that range.
- **Headless test:** load → N embodied on the layer; unload → those same ids
  folded (`embodied=false`), `pool.count()` unchanged; reload → same ids embodied
  again, no growth; entering an unloaded floor loads it.

### #10 — Macro tick skeleton
Coarse clock (own rate, **never** the 120 Hz tick — [macrosim.md](macrosim.md)) +
a **columnar full-sweep** aging pass over the pool arrays; bench at 1M. Later:
budgeted-cursor passes (migration/social, ~64 records/tick). This is where the
**off-screen population comes alive**; the ref proved 2²⁰ is viable *only if the
macro tick stays columnar* (its own 1M target was retired because per-record
object graphs — not typed columns — dominated cost; gigahrush2 avoids that with
inline names + inline inventory in SoA).

### #11 — Baked nav / flow / distance fields (`src/world/nav`)
Bake BFS/flow/distance into flat 128³ fields at load; O(1) lookups at tick. This
**gates movement AI** (#12). Re-bake on geometry mutation (freeze → re-bake →
resume). Dense over sparse.

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
- **Pool:** `kNpcPoolBits=20`, `kNpcPoolSize=1,048,576`, `kNpcActiveTarget≈950k`,
  `kAttrSlots=8`, `kNameLen=24`, `kRelSlots=16`, `kInvalidNpc=0xFFFFFFFF`.
- **Registry:** floors `−127..127` (`kFloorSlots=255`), `kMaxModules=256`,
  `ModuleId=uint16_t`, `kInvalidModule=0xFFFF`.
- **Sim loop:** fixed `kSimDt = 1/120 s`; fluid steps every 4 sim steps (maze mode
  only); fog `kWorldExtent*0.30 .. 0.50`.
- **Demo floors** (`main.cpp`): `{0 Residential(hub), 1 Commercial, 2 Industrial,
  3 Derelict, 4 Residential}`, `kMaxLayers=16`.
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
`build-constraints.md`. If you are a fresh agent without that memory, **this file
plus AGENTS.md + ARCHITECTURE.md are sufficient** to continue.
