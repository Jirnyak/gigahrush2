# Macrosim — Macro population simulation

> **Status: NPC pool built ([npcs.md](npcs.md)); macro tick built — demographic
> core (aging + old-age mortality + reserve-drawn births).** Migration, social,
> faction, and economy passes still pending. Game layer, its own module in
> `src/game/` (the `giga_game` library): `src/game/macro_sim.{h,cpp}`.

The background simulation that advances the **global** NPC population, factions,
and economy across the whole floor stack — the layer that decides what the world
is doing when the player isn't looking.

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## A standalone module — "a game within the game"

Macrosim is designed as a **self-contained module that runs as its own process**
alongside normal play — a separate coarse-clock simulation that can be
**developed, run, and tested entirely on its own**, with no window, no renderer,
no player. Its focus is **social and economic**: the whole **2²⁰** population
migrates between floors, relationships shift, factions and trade evolve — a living
society sim that happens to share a world with the action game in front of it. The
action game **materializes ~16k of those records** on the active floor as embodied
agents ([npcs.md](npcs.md)); the macro process never touches the 8.33 ms frame.

Because it links only `giga_game` → `giga_core` (no SDL/Vulkan/ImGui), the whole
macro simulation is **headless-testable and headless-runnable**: you can spin up
the 1 M-NPC population, tick it for simulated months, and inspect the emergent
society without ever opening the 3D game. Treat it like a separate product that
plugs in:

- **Own tick, own clock.** The macro tick runs at its own coarse cadence,
  decoupled from the 120 Hz sim tick and the render loop — it keeps advancing
  whether or not anything is embodied or drawn (same sim→render one-way stance as
  [render.md](render.md): the society is real, the 3D view is just a window).
- **Own data.** It owns the NPC pool, relationships, faction/economy state — all
  flat SoA it can serialize and replay independently.
- **Own dev loop.** A headless harness (a future `macrosim` test/bench target)
  can drive it in isolation, so the social/economic design is tuned separately
  from the action game and simply switched on underneath it.

The action game reads from this module (embodiment, [npcs.md](npcs.md)) but the
module never depends on the action game — exactly like the core never depends on
render. Removing the front-end leaves a complete, running society simulation.

## Model (planned)

- **Global scope.** One macro model spans all floors. Floors contribute
  **weight/multiplier** modifiers via their rule-set ([floors.md](floors.md));
  they do not run independent simulations that fork the global state.
- **Macro tick.** A coarse, periodic step advances aggregate population, spawns,
  migrations, and (later) economy/faction dynamics — cheaper than simulating
  every NPC as an entity.
- **Embodiment boundary.** Only the NPCs near the player are promoted to ECS
  entities ([npcs.md](npcs.md)); the rest live as flat rows in the macro model.
  This is the scaling strategy that lets a **~1 M** NPC population
  ([npcs.md](npcs.md)) coexist with detailed local play.

## Cost model — O(n) tick over dense tables

The macro model lives in **flat, dense SoA tables** ([npcs.md](npcs.md)); the
macro tick is a single **O(n)** sweep over them — migration, trade, spawns as
linear passes, never per-NPC search. Expensive structure (nav/flow fields,
distance fields, faction reachability) is **baked once at load** and read O(1)
during the tick. Load time is unbounded; tick time is not
([performance.md](performance.md)). Geometry mutation has **two regimes**: the
full freeze → re-bake → resume only at special moments (load, post-samosbor), and
a cheap approximate **dirty local re-bake** for in-play destruction — never a full
incremental recompute in the hot path ([performance.md](performance.md) §Two
regimes).

## Built — the columnar demographic tick (`MacroSim`)

`MacroSim::step(NpcPool&, const MacroParams&)` is one **O(n) columnar full-sweep**
over the pool's SoA rows — the whole society advances in a single linear pass, no
per-NPC search. Measured on the full **1,048,576-record** pool: **~2.8 ms/tick,
~373 M records/sec** (`macro_bench`, Release -O3), so the background society can
advance often and still never touch the 8.33 ms frame.

One sweep, three data-driven demographic events (all knobs live in `MacroParams`,
never in code branches):

- **Aging.** A fractional-year accumulator (`ageDays_`, macro-owned so the pool
  schema stays clean) advances every living record by `daysPerTick`; whole years
  roll the `age` column and saturate at `maxAge`.
- **Old-age mortality.** Certain death at `maxAge`; below it, a data-driven annual
  curve — zero before `mortalityOnset`, rising quadratically to `mortalityPeak` —
  scaled to the tick. `kill()` clears the alive bit but keeps the slot (the pool
  never reclaims, [npcs.md](npcs.md)).
- **Births.** Fertile adults (`fertileLo..fertileHi`) are **reservoir-sampled
  during the same sweep** (Algorithm R, 64 slots) — parent selection costs no
  extra scan. A per-capita `birthRate` plus a gentle catch-up toward
  `targetPopulation` sets the expected count; deterministic rounding (floor + a
  probabilistic carry) turns it into whole newborns, capped by `reserve_remaining`.
  Newborns bump-allocate from the reserve and inherit a living parent's
  floor/cell/faction so they appear where people actually live.

**The macro tick owns COLD records only.** Embodied records — the player included,
since the player is just a record with the `NpcPlayer` bit ([npcs.md](npcs.md)) —
are skipped entirely: counted among the living but never aged, killed, or drafted
as parents. Those belong to the live micro/ECS sim on the fine clock; the macro
sweep touching them would quietly age the on-screen player to death. This is the
standard detailed-near / coarse-far split.

Divergence from the reference (noted by the porting survey): the TS reference's
society is **monotonic-decreasing** — death is its only demographic event, and it
never does a full-pool scan (every off-floor pass is a bounded cursor + budget).
gigahrush2's aging + births pass is a deliberate **new capability**, affordable
only because it runs headless on a decoupled coarse clock over flat SoA. The
reference's bounded-cursor primitive (`RECORDS_PER_TICK ≈ 64`) is the model for
the *next* passes (migration/social), not this demographic full-sweep.

### Built — the per-floor bucket index (#10b, 2026-07-28)

An inverted index over the `floor` column, living **inside `NpcPool`** (universal,
minimum-systems): `floorBuckets_[label]` is the live roster of ids currently on
that floor, and `slotInBucket_[id]` records each id's position so `set_floor()` and
`kill()` splice a record between buckets in **O(1)** via swap-remove — never the
reference's linear-bucket-scan on a cold move. Membership is the label itself:
`floor_[id] == label ⇔ id ∈ floorBuckets_[label]` (with `kNoFloorLabel = 0xFFFF`
meaning "in no bucket" for a just-spawned or dead record). The index is **derived**
state — `init()` rebuilds it empty, so it is not part of the serialized rectangle.

This replaced `FloorStreamer`'s fixed `[firstId, count)` roster: `embody_crowd` now
re-materializes `pool.floor_bucket(number)` — **whoever is currently labelled with
the floor** — so a macro migration that relabels a record onto (or off) a floor is
reflected the next time that floor loads. Population still never grows per visit
because *seeding* is once-only (guarded by `seeded`); only the *membership* is now
live. Direct `floor()=` assignment was removed pool-wide (it would desync the
index); every write goes through `set_floor()`. Cost: nil on the demographic sweep
(3.0 ms/tick unchanged — the sweep touches no buckets; only births' `set_floor`
does, and that is O(1)).

### Still pending (master_prompt §7 #10c and beyond)

- **Budgeted-cursor migration/social pass (#10c).** A bounded ring-scan (~64
  records/tick) for off-floor migration and relationship drift, on the same tables;
  migration is now just a `set_floor()` call that the bucket index absorbs in O(1).
- Faction/economy dynamics (6×6 Int8 relation matrix; per-floor commodity stock).

## Determinism

Same seed → same macro evolution within a build (matches the engine's
determinism stance, [ARCHITECTURE.md](ARCHITECTURE.md) §Determinism). Concretely:
every per-record decision in the tick — mortality roll, parent reservoir, newborn
attributes — is a **stateless hash of `(id, tick, salt)`** (`core/rng.h`), so the
sweep carries no per-NPC RNG state, is independent of iteration order, and
reproduces exactly for a given `(seed, tick)`. Verified by `test_macro_determinism`
(two independently seeded pools evolve bit-identically over 24 monthly ticks).

## Connections

Drives [npcs.md](npcs.md) embodiment; draws monster/loot kinds from
[monsters.md](monsters.md) / [items.md](items.md); modulated per floor by
[floors.md](floors.md).
