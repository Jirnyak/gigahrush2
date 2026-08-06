# Floors — Modules on the level stack

> **Status: built** (game layer, `src/game` / `giga_game`). The engine provides
> the substrate ([world.md](world.md)); the module system, floor-number
> indirection, per-floor generator, rule-sets, elevator, and one-live-floor
> streaming described here are implemented on top of it — **not** in `giga_core`.
>
> - **Code:** [src/game/floor_registry.h](src/game/floor_registry.h) /
>   [.cpp](src/game/floor_registry.cpp) (number↔module↔layer indirection),
>   [src/game/floor_spec.h](src/game/floor_spec.h) /
>   [.cpp](src/game/floor_spec.cpp) (rule-set catalog),
>   [src/game/floor_gen.h](src/game/floor_gen.h) /
>   [.cpp](src/game/floor_gen.cpp) (per-floor generator),
>   [src/game/floor_stream.h](src/game/floor_stream.h) /
>   [.cpp](src/game/floor_stream.cpp) (one-live-floor streaming),
>   [src/game/elevator.h](src/game/elevator.h) /
>   [.cpp](src/game/elevator.cpp) (adjacent travel).
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp) (headless; links
>   `giga_game` only).

A **floor is a module**: a chartered, self-contained unit that owns one 128³
world plus everything specific to that floor — geometry, quests, NPCs, mechanics,
and its own **rule-set** (spawn-weight multipliers, population-matrix tweaks,
gravity overrides). The engine's `128³` grid is only its spatial substrate.

- **Substrate:** [world.md](world.md) (`LevelStack`, `World`)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## Core distinction — storage slot ≠ floor number

Three separate identifiers, deliberately decoupled:

| Concept | What it is | Mutable? |
|---------|-----------|----------|
| `LayerId` | Raw storage slot in `LevelStack` | Engine-managed |
| `ModuleId` | Stable identity of a loaded module (its content) | Fixed per module |
| **Floor number** | In-game label the macro-system assigns to a module | **Yes — reassignable at runtime** |

A floor's number is **not** hardcoded in the module. The module ships with no
number; the macro-system assigns "this module is floor N". Elevators travel to a
*number*, which resolves through `floor number → ModuleId → LayerId`. Because
that mapping is data, floors can be **renumbered or reshuffled mid-game** without
touching module content. Design everything against the number-indirection, never
against `LayerId`.

```
elevator target (floor number)  ──►  FloorRegistry  ──►  ModuleId  ──►  LayerId (resident world)
                                      (remappable at runtime)
```

## Layout

- Floors occupy an array indexed roughly **−127 … 127**, **sparsely populated** —
  not every slot is filled; modules load/unload on demand.
- Game starts at floor **0**. An elevator ride takes a DIRECTION, not an offset:
  `next_labelled_floor` reaches the **nearest labelled floor** on that side,
  because the stack is deliberately sparse — on the shipped building `[` from 0
  lands on **−8**, not on −1. (Historical wording said it reaches −1 /
  +1. See [elevators.md](elevators.md) for the `4×4×4` = 64-node fast-travel
  lattice (which doubles as the [nav.md](nav.md) coarse graph).
- W does not wrap ([world.md](world.md)); floors have a genuine top and bottom.

## Global vs. local — the rule-set boundary

**Global (engine-wide singletons), shared by all floors:**

- Monster tables ([monsters.md](monsters.md))
- Loot tables ([items.md](items.md))
- Prop tables ([props.md](props.md))
- Macro NPC population model ([macrosim.md](macrosim.md), [npcs.md](npcs.md))

**Local (per-module rule-set), layered on top — never redefines the tables:**

- Spawn-weight **multipliers** over the global monster/loot tables
- Population-**matrix** weight tweaks
- Floor-specific geometry, quests, NPCs, mechanics
- Optional gravity `region` override ([gravity.md](gravity.md)), fluid seeding,
  custom fields ([fields.md](fields.md))

A module contributes *modifiers*; it does not fork the global data. This keeps
balance centralized while letting each floor feel distinct.

## As built

A floor module is **not** one fat struct — it is the intersection of small,
orthogonal pieces, so identity, content, and residency stay decoupled:

- **`FloorCatalog`** ([src/game/floor_catalog.h](src/game/floor_catalog.h)) is
  the index ABOVE the registry: "any number → a floor definition", total over
  `[-127, 127]`. Two row kinds with fixed precedence: **explicit claims**
  ("number 4 is padic") and **patterns** ("every `|n| % 5 == 4` is industrial" —
  the defaults, first-registered-match wins). An explicit claim always beats
  every pattern, and a SECOND claim on one number is **refused at registration
  and recorded** — `tests/suite_floorcatalog.inl` pins the default catalog
  collision-free, so two modules can never silently share a number. The padic
  module's claim on **4** (where the pattern chain says Industrial) is the
  standing proof of the precedence rule. `build_default_floor_catalog` =
  `floor_spec_for`'s V-shape chain as pattern rows + every module folder's
  claims; the app registers a `FloorStreamer` module for each claim.
- **`FloorRegistry`** ([src/game/floor_registry.h](src/game/floor_registry.h))
  owns only the mapping. `assign(number, module)` / `clear_number(number)` move
  the mutable label; `set_resident(module, layer)` / `evict(module)` track where
  a module currently lives; `layer_at(number)` resolves the whole
  `number → ModuleId → LayerId` chain for an elevator (`kInvalidLayer` when the
  target isn't resident). `module_at(number)` / `number_of(module)` /
  `layer_of(module)` expose the individual hops. Sparse over `[-127, 127]`
  (`kFloorSlots = 255`, `kMaxModules = 256`), dense fixed arrays, no divide.
- **`FloorStreamer`** ([src/game/floor_stream.h](src/game/floor_stream.h)) owns
  the load/unload lifecycle and each module's build recipe. `add_module(reg,
  number, kind, seed)` registers a module's identity + how to (re)build it,
  without loading it; `ensure_loaded(number)` materializes it on demand;
  `travel(...)` rides the elevator load-first. See **Streaming** below.
- **`FloorSpec`** ([src/game/floor_spec.h](src/game/floor_spec.h)) is the per-kind
  rule-set catalog (population, faction mix, hostility, age window) — the "local
  modifiers" of the boundary above. `generate_floor`
  ([src/game/floor_gen.h](src/game/floor_gen.h)) turns `(seed, number, spec)` into
  the module's whole 128³ interior. 
  
  > **Load-time Generation Freedom:** `generate_floor` is a **pure function**, so a 
  > recycled `World` regenerates bit-for-bit and nothing has to be persisted. 
  > However, because it runs **only at load time** (which is unbounded), you are 
  > completely free to use **arbitrarily complex, branching, O(N³) algorithms** here 
  > (fractals, cellular automata, standalone Python-like generators). As long as it 
  > outputs a dense 128³ 3D geometry array at the end, it strictly obeys the engine's 
  > rule of "bake at load, tick in O(N)".

The `World` itself stays a plain engine substrate in a `LevelStack` slot; the
module system above never subclasses or wraps it.

## Module folders — one directory per floor

**The folder is the module.** Everything specific to a floor lives under
`src/game/floors/<name>/` and nowhere else — its geometry generator, special
loot, carvers, story NPCs, quests, events, interactive objects — plus a
`<name>.h` manifest that states the module's kind and its explicit floor-number
claim. First resident: [src/game/floors/padic/](src/game/floors/padic/)
(`padic.h` manifest, `padic_gen.cpp` geometry, `padic_module.cpp` registration —
claims number **4**).

The padic geometry (rebuilt 2026-07-31 to the owner's sketch) is the dormitory
tower: 3-cell (6 m) storeys whose top cell carries a **two-slab sandwich** —
sub-layer 6 is the storey's plaster ceiling, sub-layer 7 the next storey's
lino/parquet floor, one `sub_material` page per sandwich cell (~700 MB RAM and
a correspondingly large floor save per resident padic floor — an accepted
cost); 2-cell corridors along the elevator lattice lines so every lobby is a
crossing; BSP apartment blocks (solid apartment walls, doored rooms, the two
smallest rooms lino); two-flight stair shafts (11 steps + landing = 12 risers a
flight, 24 per storey, 2/8-thick sloped slabs, vertically continuous, some
flights buried in rubble); bar grates over corridor voids; ragged per-storey
floor holes. **One floor, one seed:** door_build derives its doorway list from
`streamer.floor_seed_of()` — the exact seed the geometry was generated from —
never from a parallel constant (the deleted `kDoorSeed` kept ~5% of padic's
doors, the ones that matched by coincidence). A `--shot x.png --floor 4` run is
the standing proof (--floor rides the console-teleport seam, so it reaches
floors --ride's descent-only hops cannot).

**Modularity beats DRY here, deliberately.** A floor folder spells its content
out in full even where it repeats another folder's pattern, so modules stay
independently editable, deletable, and copy-pasteable as templates — no shared
"floor utils" layer to tangle them. A module touches exactly two things outside
its folder, both data rows: one registration call in
`build_default_floor_catalog` ([floor_catalog.cpp](src/game/floor_catalog.cpp))
and one generator row in `floor_gen.cpp`'s per-kind dispatch table. Delete the
folder + those two rows and the floor is gone cleanly. CMake globs
`src/game/*.cpp` recursively, so a new folder needs no build edit.

## Streaming — one live floor at a time

The stack can name floors from −127 to 127, but only a tiny window is ever
**embodied** — by default **exactly one floor**. `FloorStreamer.init(stack,
keepRadius = 0)` reserves `2*keepRadius + 2` recyclable `LevelStack` slots (enough
for the momentary overlap during a ride) and keeps the rest of the population cold
in the `NpcPool` ([npcs.md](npcs.md)).

- **Enter** (`ensure_loaded(number)`): the first time a module is entered its
  crowd is seeded **once** into the cold pool, which labels every seeded record
  with the floor's number (so they land in `pool.floor_bucket(number)`); a free
  slot is allocated; the floor is brought up in **three steps** (below); and the crowd
  — **whoever is currently in that floor's bucket** — is embodied. Records already
  embodied elsewhere (e.g. the player standing on another floor) are **skipped**,
  so nobody is duplicated. The
  first ever load — before any player exists — designates the module's candidate
  as the player. Right after the geometry is built, the floor's **dressing is
  baked** into a per-module `AntourageBake` (pipes, wires, curtains — mesh on
  voxel anchors, the grid is never written, see [antourage.md](antourage.md)),
  and then its **navigation** into a per-module `FloorNav` (coarse graph + flow
  fields, freed on unload, retrieved via `nav_at`), with an opt-in disk cache —
  see [nav.md](nav.md). **Today only the tests read that one:** the app runs its
  own async bake (`begin_floor_nav` / `nav::AsyncBake` in `main.cpp`) after doors
  are stamped, so the full bake currently runs TWICE per load and the cache dir
  is never set ([problems.md](problems.md) §26). Both bakes
  are pure functions of `(grid, number, seed)`, so both are freed on eviction and
  neither is ever persisted.
- **Leave** (`unload` / `keep_only`): every embodied body on the floor is
  `fold_back`'d into its cold record (position/state deltas persist), the layer is
  freed, and the slot returns to the free-list. An invalid handle (a body the
  elevator already destroyed) folds back as a clean no-op.
- **Travel** (`travel(...)`): load the destination on demand → `ride_elevator`
  ([elevators.md](elevators.md)) → adopt the fresh player body into the
  destination module → `keep_only` prunes back to the kept window.

**The population never grows per visit.** Re-entering a floor re-embodies its
**current roster** — the live `floor_bucket` — not a fresh crowd: seeding is
once-only (guarded by a `seeded` flag), so only *membership* is live, never the
head-count. The geometry regenerates **bit-for-bit** from `(seed, number)` —
nothing is persisted floor-to-floor except the folded-back records themselves.
This is what makes the 2²⁰ target affordable: the sim tick is O(live entities),
and only ~one floor is ever live.

Because exactly one floor is live, its size is fixed at **N = 128** — depth comes
from the many-floor W-stack, not a bigger floor — and *that* one floor is where
the real-time engine runs: ~16k embodied **agents on the CPU**, every cellular
**field on the GPU** ([performance.md](performance.md) §The compute split,
§Active-floor sizing).

> **Migration-ready roster (built 2026-07-28, #10b).** The streamer re-embodies by
> a maintained **per-floor bucket index** over the pool's floor label
> (`pool.floor_bucket`, [npcs.md](npcs.md) / [macrosim.md](macrosim.md)), not a
> fixed id range. So when the macro tick relabels an NPC onto (or off) a floor, the
> destination materializes them on next load and the origin no longer does — the
> membership is live, `set_floor`/`kill` keep it in O(1). Seeding stays once-only,
> so the population is still steady per visit.


### A floor entry is three steps, and the middle one is a fork

Generation and rules used to be fused inside the module's generator. Splitting
them is what makes a floor an honest **sub-game with its own laws**, and what lets
a **visited floor be its snapshot** instead of being rebuilt
([floor_gen.h](src/game/floor_gen.h)):

| Step | What | When |
|---|---|---|
| 1. `floor_declare_rules` | the module's **LAWS** — gravity frame, registries | **always**, before any geometry exists |
| 2. `generate_floor` **or** a snapshot restore | the **GEOMETRY** | one or the other, never both |
| 3. `floor_apply_rules` | the module's rules laid **on top** — fluids, seeded content | **always**, after geometry is final |

The frame is a property of the **module**, not of the saved bytes, which is
exactly why the snapshot does not carry it and why a restored floor still needs
step 1. Steps 1 and 3 are idempotent and deterministic in `(seed, number)`, like
the geometry. A module supplies all three as data rows in `floor_gen.cpp`'s
dispatch tables — never a branch.

**Why the fork exists at all.** Attaching anything to geometry that is about to
change under it is the bug class this closes: pipes were routed and lamps hung
against pristine geometry, and only then did the snapshot turn their anchors back
into the holes the player had blown ([problems.md](problems.md) §42).

**Measured** (floor 0, Release, printed by every run as `[floor] N: laws … | … | rules …`):

```
laws 0.7 ms | generated  164.4 ms | rules 1.5 ms    first visit
laws 0.6 ms | RESTORED  6595.5 ms | rules 1.4 ms    revisit — no generation at all
```

**The snapshot is deliberately WHOLE, and cheap because of its ENCODING.** Pages
are run-length encoded (`kFloorFileVersion` 2): measured **736.2 → 125.5 MB** and
**6595 → 1329 ms**, with the material model untouched — a page may still hold any
mix of atoms, flaked plaster and blast craters included, it just costs more runs.

Two alternatives were rejected on purpose and are recorded so they are not
revived:

- **Promoting common sub-voxel mixes to their own `CellType`.** Cell types are a
  finite vocabulary and atom combinations are not, so this hardcodes an arbitrary
  subset of mixes and breaks the first time a surface chips. It also destroys the
  premise that a floor is LEGO built from destructible atoms with the geometry
  rules doing the composing.
- **Storing only the DELTA from a deterministic regeneration.** It collapses
  properly (change something back and it cancels) and is bounded by the whole
  snapshot, so it is not the spaghetti-of-edits it first looks like — but it makes
  the generator a permanent part of the save format. Touch the generator, even to
  fix a bug, and every existing save silently decodes into a subtly different
  floor. A whole snapshot does not care what the generator becomes tomorrow.

## Open questions (resolve when implementing)

- Serialization of the number→module mapping (and the cold pool) across saves.
- Larger `keepRadius` and the 4×4×4 fast-travel lattice
  ([elevators.md](elevators.md)): multiple live floors at once, and pre-warming
  likely destinations.

## Connections

Built on [world.md](world.md); consumes global [monsters.md](monsters.md) /
[items.md](items.md) / [macrosim.md](macrosim.md); reached via
[elevators.md](elevators.md); bakes [antourage.md](antourage.md) and
[nav.md](nav.md) on load; places [props.md](props.md); may install
[gravity.md](gravity.md) / [fields.md](fields.md) overrides.
