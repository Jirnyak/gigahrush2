# Macrosim — Macro population simulation

> **Status: NPC pool built ([npcs.md](npcs.md)); macro tick pending.** Game
> layer, its own module in `src/game/` (the `giga_game` library).

The background simulation that advances the **global** NPC population, factions,
and economy across the whole floor stack — the layer that decides what the world
is doing when the player isn't looking.

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## A standalone module — "a game within the game"

Macrosim is designed as a **self-contained module that runs in the background**
during normal play and can be **developed, run, and tested entirely on its own**,
with no window, no renderer, no player. Its focus is **social and economic**:
NPCs migrate between floors, their relationships shift, factions and trade
evolve — a living society sim that happens to share a world with the action game
in front of it.

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
([performance.md](performance.md)). When floor geometry mutates, freeze, re-bake,
resume — no incremental recompute in the hot path.

## Determinism

Same seed → same macro evolution within a build (matches the engine's
determinism stance, [ARCHITECTURE.md](ARCHITECTURE.md) §Determinism).

## Connections

Drives [npcs.md](npcs.md) embodiment; draws monster/loot kinds from
[monsters.md](monsters.md) / [items.md](items.md); modulated per floor by
[floors.md](floors.md).
