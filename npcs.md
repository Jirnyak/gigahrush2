# NPCs — Macro population & embodiment

> **Status: macro pool + embodiment + one-live-floor streaming built; macro tick
> BUILT** (migration #10c + social #10d; `macroSim.step` runs every `kSimHz*2`
> ticks — though from inside the 125 Hz loop, which [problems.md](problems.md)
> §21 files as a law violation). Aggregate trade/economy still pending. Game layer (`src/game/`, the `giga_game` library), on top of the ECS
> ([ecs.md](ecs.md)) and macro simulation ([macrosim.md](macrosim.md)).
>
> - **Code:** [src/game/npc_pool.h](src/game/npc_pool.h) /
>   [.cpp](src/game/npc_pool.cpp), [src/game/embody.h](src/game/embody.h) /
>   [.cpp](src/game/embody.cpp), [src/game/population.h](src/game/population.h) /
>   [.cpp](src/game/population.cpp), [src/game/inventory.h](src/game/inventory.h),
>   [src/game/floor_stream.h](src/game/floor_stream.h) /
>   [.cpp](src/game/floor_stream.cpp) (embody / fold-back at floor granularity —
>   [floors.md](floors.md))
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp) (headless, links
>   `giga_game` only)

The NPC population is modelled **globally** across the whole floor stack, then
individual NPCs are **embodied** into full ECS entities only where they matter
(near the player / on the active floor).

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## The world is not player-oriented

The game does **not** start with a player and decorate the world around them.
The alife population exists **first**; entering a floor **materializes** that
floor's slice of records into ECS entities; and **the player is one of those
embodied records** that additionally receives a `CameraTag` + `Controller`.
There is **no player singleton** — the "player" is just the alife record
currently wearing the camera (the `NpcPlayer` flag bit). Aging, death, relations,
faction and stature apply to it exactly like any other NPC.

This is stronger than the reference prototype (`../gigahrush`), which keeps the
player as privileged "current-floor runtime state" bolted onto the world. Here
the player has no privileged execution path: it dies, folds back and embodies
through the same functions as everyone else.

Down the line this is what lets the character-creation screen work cleanly: the
player fills in name/sex/age/height/attributes/perks, that **writes an ordinary
alife record**, and floor design then embodies it into the 128³ module like any
pre-generated NPC. Switching characters (or dying into a new body) is just: fold
the old record back, embody the new one as player — the camera immediately sits
at the new body's stature.

## Model (planned)

- **Global macro population** — an aggregate model of who exists where across
  floors, advanced by the macro tick ([macrosim.md](macrosim.md)). Shared, not
  per-floor.
- **Per-floor modifiers** — a floor's rule-set ([floors.md](floors.md)) tweaks
  population-matrix weights (which kinds concentrate on this floor) — it does not
  own its own NPC catalog.
- **Embodiment (built, floor-granular).** Entering a floor instantiates its
  crowd as ECS entities with the universal components ([ecs.md](ecs.md)), driven
  by the same [controller.md](controller.md) / [physics.md](physics.md) systems
  as the player; **leaving a floor de-embodies (`fold_back`) the whole crowd**
  back into the cold pool. This is the one-live-floor streaming seam
  ([floors.md](floors.md), `src/game/floor_stream.h`): only ~one floor is embodied
  at a time, so the sim tick stays O(live entities). NPCs are never faked or
  frozen — only their execution unit changes. (Granularity is a whole floor
  today; a near-player radius is a later refinement.)

## Scale & storage — dense flat tables, ~1 M NPCs

The population is **large — on the order of a million NPCs** — and stored the
data-oriented way: **flat, dense, parallel arrays** (SoA), one row per NPC, not
objects. This is the same dense-over-sparse stance as the rest of the engine
([performance.md](performance.md)); a million NPCs in flat arrays is a few
hundred MB, comfortably inside the RAM budget, and a macro pass over them is a
single O(n) sweep of contiguous memory.

The pool is **fixed at `2^20 = 1,048,576` slots** (`kNpcPoolSize`) — a power of
two so an id masks/indexes without a divide and the table is a fixed rectangle.
**The id *is* the slot index**, stable for the NPC's whole life, so lookup is
O(1) and the arrays stay dense. Slots are **bump-allocated** from a monotonic
high-water mark (`count()`); ~950k (`kNpcActiveTarget`) are populated at world
start and the tail is a **reserve plast** of blanks for runtime spawns.

**The dead are never reclaimed BY DEFAULT.** `kill()` clears the `NpcAlive` bit but
keeps the slot and id forever; new NPCs come from the reserve (bump the tail), not by
reusing a dead slot. Procedural and authored NPCs share this one linear store, told
apart only by the `NpcDesign` flag bit — never separate arrays.

`NpcPool` now also has an **opt-in** `set_recycling(true)`, which threads a dead slot
onto an intrusive FIFO free list so a birth stops being a one-way draw on a finite
reserve. It is ARMED in the shipping binary — `main.cpp:1714` calls `pool.set_recycling(true)`, which became safe once all six bare-`NpcId`-across-time stores were made generation-checked `NpcHandle`s —
so the paragraph above still describes what actually runs, and `macrosim.md`'s
"never reclaims" stays accurate. Two things must land before it can be armed, because
a recycled id is a REUSED id and both of these store a bare `NpcId` across time:
`MacroSim::Journey` now carries the departing generation (done), and
`Contract::giver` IS an `NpcHandle` now (`contract.h`), and `contract_step` polls `handle_valid()`. Reuse is
generation-tagged via `NpcHandle` / `handle_valid()`, which is the tool any code
holding an id across ticks should be using.

Each NPC row carries (`src/game/npc_pool.h`):

- **Identity** — `name` / `surname` as fixed-width `char[24]` arrays (inline in
  the SoA row, no heap strings); the stable id is the slot index itself.
- **Relationships** — a fixed **16-slot** inline array (`kRelSlots`) per NPC
  (target id + signed `affinity`). A hard cap keeps the row fixed-size and the
  table a flat rectangle — no per-NPC allocation, O(1) to scan an NPC's relations.
- **State** — flags, hp/max_hp, faction, floor label + macro cell (cx/cy/cz).
- **Inventory** — a full **inline 8×8 `Inventory`** ([items.md](items.md)),
  carried by *every* NPC in the macro row, not just embodied ones (256 B × 1 M ≈
  256 MB, inside budget). No macro/embodied special case: embodiment is a byte
  copy of the same rectangle. See [src/game/inventory.h](src/game/inventory.h).

Because the tables are flat and dense they **serialize verbatim** with the save
(whole-world persistence, [performance.md](performance.md)).

## Character-sheet fields (skeleton, extensible)

Every record — player and NPC alike — carries the character-sheet fields, so the
future creation screen writes into the **same struct** floor design later embodies:

- **`age`** (`u8`, 1..100) and **`sex`** (`NpcSex`: unset/male/female).
- **`height_mm`** (`u16`) — stature in millimetres, derived from age at seeding
  (children scale up, adults settle ~1.75 m with variation). Stature is not
  flavour: it **drives the embodied body** (see below).
- **`level`** (`u8`) and an **8-slot generic attribute block** (`kAttrSlots`,
  byte-valued, addressed by index).

The attribute block is deliberately a **fixed-width skeleton, not named columns**.
The game is a prototype: the count, names and meaning of attributes aren't final
(likely more than 3 — think ~8+, plus perks and traits later). Rather than
hardcode a `str/agi/int` schema we'd have to migrate, we bake a stable-width block
now and let a data table map *slot → meaning*. **Perks and traits get their own
extensible block when the character sheet is designed** — this is the crossbeam,
not the finished sheet. Adding a real attribute later stays a data change, not a
table reshape.

## Embodiment — the alife↔ECS seam ([src/game/embody.h](src/game/embody.h))

`embody(reg, pool, id, layer)` materializes one record into an ECS entity:
Transform at the record's macro cell, Velocity, an **AABB whose half-height comes
from `height_mm`**, gravity + jump, and an `NpcRef{id}` linking the entity back to
its cold row. hp/inventory stay canonical in the pool row (the entity shares
identity by id), so only transient ECS state (position) needs folding.

`embody_as_player(...)` does the above **and** attaches a `CameraTag` — whose
`eyeOffset.z` is derived from the same `height_mm` — plus a `Controller`, and sets
the `NpcPlayer` bit. This is the *only* thing that makes a record the player.
Because eye height tracks stature, embodying a shorter or taller record views the
world from that character's height, and **body-swaps / respawns pick up the new
stature automatically** — the reference-style "camera at the new character's
eyes" behaviour, for free.

`fold_back(...)` writes the live entity's cell back into the record, clears
`NpcEmbodied`/`NpcPlayer`, and destroys the entity — freezing the record where it
stood. `kill()` clears embodiment too, so a dead record is never left live.

Seeding lives in [src/game/population.h](src/game/population.h):
`seed_floor_population(pool, floor, n, seed)` bump-allocates `n` records onto a
floor's apartment lattice with deterministic demographics and **returns the record
chosen as the player candidate** — which becomes the player only once
`embody_as_player` flips its bit. The floor streamer ([floors.md](floors.md))
calls a seeder **once** per module, which labels every seeded record with the
floor's number; every later visit re-embodies whoever is **currently** in that
floor's `pool.floor_bucket(number)` (the per-floor inverted index, #10b), so the
roster is live — a macro migration onto/off the floor is honoured — while the
head-count stays steady because seeding is once-only. This is the streaming
invariant that keeps the 2²⁰ population from growing per visit.

## Behaviour — migration, trade, honest projectiles

- **Migration & trade between floors.** The macro tick moves NPCs across the floor
  stack — **built** as a budgeted-cursor journey pass (#10c): a bounded ring-scan
  starts multi-tick inter-floor journeys that relabel cold records on arrival
  (through the per-floor bucket index), so any floor's roster is live the next time
  it loads. Aggregate trade/economy is still pending ([macrosim.md](macrosim.md)).
- **Relationships grow off-screen.** A second budgeted-cursor pass (#10d-ii,
  [macrosim.md](macrosim.md)) lazily fills each NPC's 16-slot `rel_` block with
  edges to co-floor peers, seeded from the [faction matrix](macrosim.md) (#10d-i)
  so acquaintances start faction-consistent (Citizens warm, Wild cold). The graph
  is thus already populated when the crowd embodies — the #12 `social` intent
  ([ai.md](ai.md)) has real edges to act on rather than a world of strangers.
- **Embodied NPCs are ordinary entities.** An embodied NPC that shoots simply
  **spawns a projectile entity** that flies under [physics.md](physics.md) and
  can hit *anyone* — including the NPC that fired it. No attacker/victim special
  cases; combat is isotropic, exactly like the player's. The player is not
  privileged ([ecs.md](ecs.md)).
- **Embodied brain (#12 — [ai.md](ai.md); #12a/#12b/#12c BUILT — the crowd
  moves).** On the live floor each embodied NPC runs a **utility-AI**: 0..100 needs
  decay, a pure scorer ranks 13 intents (eat/drink/toilet/sleep/flee/combat/social/
  patrol/wander/…), argmax + hysteresis picks one, and a per-frame driver steers the
  body — flee heads down the flee field ([diffusion.md](diffusion.md)), every other
  intent roams a deterministic per-identity heading — by writing horizontal
  `Velocity` straight into physics, the same integrator the player reaches through
  `Controller`. Re-plan cadence is an identity-hash stagger, so the crowd spreads
  across frames with no scheduling queue. **#12a ([src/game/ai.h](src/game/ai.h)):**
  the `Needs` SoA component + its one-pass `needs_step` decay — food/water/sleep
  reserves fall (attribute-slowed by STR/AGI/INT), pee/poo pressures rise only by
  digesting a pending pool — materialised on embodiment and folded away with it,
  like every other transient. **#12b:** the pure `score_intents` ranking all 13
  intents 0..100 and the `select_intent` argmax + hysteresis, both ported verbatim.
  **#12c:** `ai_step` — the stagger + steering driver — with `Needs`/`AiBrain`
  attached on embodiment (the player carries them too; the driver just skips
  camera-holders). All exercised headless. Goal-directed `route_step` steering
  toward a specific target cell ([nav.md](nav.md)) waits on the #13 content tables
  to give intents reachable goals.

## Baked, not searched

Anything an NPC needs to path or decide is **baked at load** — nav/flow fields
over the sub-voxel space, distance fields, relationship lookups — so the macro
and embodied ticks do O(1) reads, never per-NPC BFS/A* in the hot path
([performance.md](performance.md)).

## Global vs. local

| Global | Per-floor (rule-set) |
|--------|----------------------|
| Population model & NPC kinds | Population-matrix weight tweaks |
| Macro tick behavior | Which kinds cluster on this floor |

## Connections

Advanced by [macrosim.md](macrosim.md); shares monster kinds with
[monsters.md](monsters.md); weighted by [floors.md](floors.md); embodied onto
[ecs.md](ecs.md) systems.
