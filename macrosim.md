# Macrosim — Macro population simulation

> **Status: NPC pool built ([npcs.md](npcs.md)); macro tick built — demographic
> core (aging + old-age mortality + reserve-drawn births), the budgeted-cursor
> migration pass (#10c), the faction relation matrix (#10d-i) and the budgeted
> social pass that grows the relationship graph (#10d-ii).** Event-driven drift and
> economy passes still pending. Game layer, its own module in `src/game/` (the
> `giga_game` library): `src/game/macro_sim.{h,cpp}`, `src/game/faction.{h,cpp}`.

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
the migration/social passes — now realized for migration in #10c below — not this
demographic full-sweep.

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

### Built — the budgeted-cursor migration pass (#10c, 2026-07-28)

On top of the O(n) demographic sweep, `step()` now runs a **bounded** migration
pass — O(budget), not O(n) — porting the reference's off-screen movement model
(`alife_migration.ts`) to the floor-number world. A **persistent ring cursor**
(`migCursor_`) walks the pool `migrateRecordsPerTick` records per tick (default
**64** — the reference's `RECORDS_PER_TICK`), wrapping over the live count so a
growing population is covered evenly. For each visited **cold** record (alive,
**not embodied**, not already travelling) it rolls a deterministic departure
(`hash3(id, tick, kSaltMigrate)` against the per-tick probability
`migrateRatePerYear × daysPerTick/365`) and, on success, **starts a journey**:
picks a destination floor uniformly in the configured band `[floorLo, floorHi]`
(excluding the current one, `pick_dest_floor`) with an ETA
`(travelBaseDays + travelPerFloorDays·|Δfloor|) × jitter(0.8‥1.35)` — the
reference's ETA shape.

Journeys are **multi-tick and macro-owned** — a `std::vector<Journey>` in
`MacroSim`, external to the pool like `ageDays_`, so the pool stays a clean
demographic table. Each tick, before starting new journeys, `step()` **lands**
every journey whose ETA the world clock has passed: an off-screen arrival is a
**pure `set_floor` relabel**, which the #10b bucket index absorbs in **O(1)** —
migration is that index's first real client. A record that **died or was embodied**
mid-transit (pulled onto the live floor by the player) forfeits its journey: the
micro sim owns embodied floors, and the dead are off the map. A `traveling_[id]`
byte gives O(1) "already travelling" skips; `maxJourneys` caps concurrent transit.

The whole pass is **off unless a real floor band is configured** (`floorHi >
floorLo`), so the demographic-only bench and tests are byte-for-byte unaffected.
Cost at the full 2²⁰: **+0.05 ms/tick** even with a deliberately heavy
65536-record budget over the full 0‥63 band (3.17 → 3.22 ms — `macro_bench`, two
phases), i.e. the bounded pass adds **no O(n) term**. Verified by
`test_macro_migration` (population conserved, every record stays in-band, embodied
records never move, journeys conserve Σdepartures − Σarrivals == in-transit) and
`test_macro_migration_determinism` (two pools evolve bit-identically over 30
ticks).

**Not yet ported** (deferred, noted for follow-ups): the reference's route/danger
**gating** on destinations (no baked route metadata exists on this side yet — every
in-band floor is currently an equal candidate) and the immediate
**materialization of an arrival onto the *live* floor** (an arrival re-buckets the
cold record; it embodies on that floor's next load, not the instant it lands — a
streaming-layer concern, not a pool one).

### Built — the faction relation matrix (#10d-i, 2026-07-28)

The society's **baseline attitude table**: a `kFactionCount × kFactionCount = 6×6`
row-major matrix of signed-byte attitudes, one directed cell per ordered faction
pair (`src/game/faction.{h,cpp}`). The six factions (`FactionId`: Citizen,
Liquidator, Cultist, Scientist, Wild, Player) and the base values are **ported
verbatim from the reference** (`../gigahrush`, `src/data/relations.ts` base seed) —
symmetric, diagonal 100 (own faction), span -50..100. This formalises what the
seeder already assigns (`FloorSpec::factionMix` samples factions 0..3, the four
civilian-ish kinds, [npcs.md](npcs.md)) and rounds it out with Wild (hostile
fauna/raiders) and Player, so **combat targeting and the player's own standing
resolve through the one table** — never a code branch.

A tiny data primitive, the same stance as `FloorSpec` / `MacroParams`:
`attitude(a,b)` reads a directed cell (out-of-range faction → neutral `0`, so a
stray pool value never indexes past the table); `set` / `nudge` / `nudge_mutual`
mutate with integer-math clamping to `[-127,127]` (the reference clamps to
`[-128,127]` — an immaterial one-unit-lower floor; we avoid -128 so negation stays
well-defined); and two **data-driven thresholds** classify a cell branch-free —
`hostile()` at or below **-50**, `friendly()` at or above **50** (ported from the
reference's `areFactionsHostile` / `FRIENDLY_RELATION_THRESHOLD`). `reset_to_base()`
restores the seed (a future respawn hook will reset just the Player row/column).

Standalone and headless-verified by `test_faction_matrix` (base values, full
symmetry + diagonal, threshold edges, out-of-range tolerance, clamp, mutual
nudge, reset). It carries **no per-tick cost** yet — it is the state the two
consumers below read: the **#10d-ii social pass** (which seeds per-NPC edges from
`factionAffinity`, the symmetric quarter-scaled cell average) and the **#12
utility-AI** (`faction_assault` / `social` intents, [ai.md](ai.md)).

> **NOTE — three distinct relationship stores, do not conflate.** (A) this
> faction↔faction matrix (thresholds ±50, span ±100); (B) a per-record
> player-standing column (planned, range ±100, sentinel -128); (C) the per-NPC
> social graph (the pool's 16-slot `rel_` block, wider ±64 thresholds) that
> #10d-ii drifts. Different ranges and thresholds — the reference keeps them
> separate and so do we.

### Built — the budgeted-cursor social pass (#10d-ii, 2026-07-28)

On top of migration, `step()` now runs a **second bounded ring-scan** — again
O(budget), not O(n) — that grows the society's **relationship graph** (the pool's
16-slot `rel_` block, [npcs.md](npcs.md)). A **persistent cursor** (`socCursor_`,
independent of the migration cursor) walks `socialRecordsPerTick` records per tick
(default **64** — the reference's `RECORDS_PER_TICK`). For each visited **cold**
record it rolls a deterministic formation chance (`hash3(id, tick, kSaltSocial)`
against `socialFormRatePerYear × daysPerTick/365`) and, on success, draws a
**co-floor peer** from the #10b bucket index (up to `kSocialCandidateTries = 8`
deterministic tries, skipping self and the dead) and **forms one edge** toward it.

The edge is seeded exactly as the reference's `describeCandidateEdge` acquaintance
path: initial affinity = **`factionAffinity(a,b)`** — the symmetric quarter-scaled
average of the two faction-matrix cells, `(attitude(a,b)+attitude(b,a)+2) >> 2`,
the #10d-i table's **first real consumer** — plus deterministic jitter in `±40`,
clamped to the social range `[-127,127]` ([npcs.md](npcs.md) `kRelAffinity*`). Slot
policy is the reference's **existing → first-empty → evict-weakest** (min
`|affinity|`), so an NPC's 16 edges churn toward the peers it keeps meeting. So two
Citizens meet warm (base +50) and a Citizen and a Wild meet cold (base −25) — the
graph is faction-consistent from birth, with no per-edge authoring.

`MacroSim` now **owns the `FactionMatrix`** (society state, reset to base in
`init()`, mutable via `factions()`), and the social pass reads it. The pass is a
**faithful subset**: it only **grows** the graph. The reference's ongoing
relationship *drift* is entirely event-driven (combat, posts, quests, director
reactions) with **no baseline pull-back**; off-screen cold records raise none of
those events, so a macro drift pass would have nothing to drive it — drift lands
with the systems that raise the events (combat → #13, quests → content). We also
**drop the reference's reserved player slot** (slot 0): the player is just a record
([npcs.md](npcs.md)), so its edges use the same slots as anyone's.

**Off unless `socialFormRatePerYear > 0`**, so the demographic/migration bench and
tests are byte-for-byte unaffected. Cost at the full 2²⁰ with a deliberately heavy
65536-record budget over 64 floors: **+0.11 ms/tick** (3.16 → 3.27 ms —
`macro_bench`, Release -O3, three phases), i.e. **no O(n) term**; the realistic
64/tick budget is free. Verified by `test_macro_social` (edges form; every edge is
in-range, co-floor, self-free and duplicate-free; the all-Citizen floor yields only
warm edges while the Citizen+Wild floor yields hostile ones — faction standing
drives the sign; off by default) and `test_macro_social_determinism` (two pools
grow bit-identical graphs over 30 ticks).

**Not yet ported** (deferred, noted for follow-ups): event-driven edge **drift**
(needs combat/quest events), the reference's one-hop **social-circle propagation**
of a delta to a friend's friends (a drift concern, same gate), and its
post/reaction **director** content.

### Still pending (master_prompt §7 #10d and beyond)

- **Event-driven relationship drift** — combat/quest events nudging `rel_` edges
  (and faction standing via `nudge_mutual`), with one-hop social-circle
  propagation. Lands with combat (#13) / quests.
- **Faction-vs-monster** row + player-standing column — deferred until their
  consumers (mob combat, respawn) exist.
- Economy dynamics (per-floor commodity stock, trade).

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
