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
- Game starts at floor **0**. Adjacent travel (`±1`) via elevators reaches −1 /
  +1. See [elevators.md](elevators.md) for the `8×8` fast-travel grid.
- W does not wrap ([world.md](world.md)); floors have a genuine top and bottom.

## Global vs. local — the rule-set boundary

**Global (engine-wide singletons), shared by all floors:**

- Monster tables ([monsters.md](monsters.md))
- Loot tables ([items.md](items.md))
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
  the module's whole 128³ interior as a **pure function**, so a recycled `World`
  regenerates bit-for-bit and nothing has to be persisted floor-to-floor.

The `World` itself stays a plain engine substrate in a `LevelStack` slot; the
module system above never subclasses or wraps it.

## Streaming — one live floor at a time

The stack can name floors from −127 to 127, but only a tiny window is ever
**embodied** — by default **exactly one floor**. `FloorStreamer.init(stack,
keepRadius = 0)` reserves `2*keepRadius + 2` recyclable `LevelStack` slots (enough
for the momentary overlap during a ride) and keeps the rest of the population cold
in the `NpcPool` ([npcs.md](npcs.md)).

- **Enter** (`ensure_loaded(number)`): the first time a module is entered its
  crowd is seeded **once** into a contiguous `[firstId, firstId+count)` range of
  the cold pool; a free slot is allocated; `generate_floor` rebuilds the geometry
  into it; and the crowd is embodied. Records already embodied elsewhere (e.g. the
  player standing on another floor) are **skipped**, so nobody is duplicated. The
  first ever load — before any player exists — designates the module's candidate
  as the player.
- **Leave** (`unload` / `keep_only`): every embodied body on the floor is
  `fold_back`'d into its cold record (position/state deltas persist), the layer is
  freed, and the slot returns to the free-list. An invalid handle (a body the
  elevator already destroyed) folds back as a clean no-op.
- **Travel** (`travel(...)`): load the destination on demand → `ride_elevator`
  ([elevators.md](elevators.md)) → adopt the fresh player body into the
  destination module → `keep_only` prunes back to the kept window.

**The population never grows per visit.** Re-entering a floor re-embodies the
**same** id range (seeding is once-only, guarded by a `seeded` flag) and the
geometry regenerates **bit-for-bit** from `(seed, number)` — nothing is persisted
floor-to-floor except the folded-back records themselves. This is what makes the
2²⁰ target affordable: the sim tick is O(live entities), and only ~one floor is
ever live.

Because exactly one floor is live, its size is fixed at **N = 128** — depth comes
from the many-floor W-stack, not a bigger floor — and *that* one floor is where
the real-time engine runs: ~16k embodied **agents on the CPU**, every cellular
**field on the GPU** ([performance.md](performance.md) §The compute split,
§Active-floor sizing).

> **Roster caveat.** The fixed `[firstId, count)` roster is a pre-migration
> simplification: it assumes a module's residents never leave its id range. Once
> the macro tick ([macrosim.md](macrosim.md)) migrates NPCs between floors, the
> streamer must re-embody by a maintained **per-floor bucket index** over the
> pool's floor label instead of a fixed range.

## Open questions (resolve when implementing)

- Serialization of the number→module mapping (and the cold pool) across saves.
- Larger `keepRadius` and the 8×8 fast-travel grid ([elevators.md](elevators.md)):
  multiple live floors at once, and pre-warming likely destinations.
- Migrating the fixed-range roster to a per-floor bucket index (see the caveat
  above) so mid-transition / migrated entities are captured.

## Connections

Built on [world.md](world.md); consumes global [monsters.md](monsters.md) /
[items.md](items.md) / [macrosim.md](macrosim.md); reached via
[elevators.md](elevators.md); may install [gravity.md](gravity.md) /
[fields.md](fields.md) overrides.
