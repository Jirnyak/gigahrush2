# AI — utility brain for embodied NPCs

> **Status: needs layer (#12a) BUILT; scorer + selection (#12b) and stagger +
> steering + embody/loop wiring (#12c) pending.** This is the porting-target spec
> for the embodied NPC brain, captured from the reference (`../gigahrush`:
> `needs.ts`, `npc_utility.ts`, `npc_fsm.ts`, and the pathfinding steering). Exact
> per-intent scorer constants are **re-extracted verbatim at build time** (the
> same design-doc → exact-extraction → code flow used for the
> [faction matrix](macrosim.md)); the numbers below are the shape, not the frozen
> table. It lives in the game layer (`src/game/`, `giga_game`) over the ECS
> ([ecs.md](ecs.md)) and consumes the baked nav ([nav.md](nav.md)) and flee field
> ([diffusion.md](diffusion.md)) — pure game-layer over EnTT + NpcPool, so the
> whole brain is exercised **headless** by `game_test`, exactly like the macro tick.
>
> - **Code:** [src/game/ai.h](src/game/ai.h) / [.cpp](src/game/ai.cpp)
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp) `test_needs_decay`
> - **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4
> - Upstream of [controller.md](controller.md): the brain writes
>   `Controller::wishDir`; `controller_step` turns it into velocity, then
>   [physics.md](physics.md) integrates it. The brain is the *only* new seam — the
>   locomotion path is unchanged, so an embodied NPC steers through exactly the
>   same systems as the player ([npcs.md](npcs.md): the player is not privileged).

This is the system that finally makes the **visible crowd move** — wander, queue
for a toilet, flee a threat, seek food, patrol, fight. It runs only on the
**embodied** entities of the live floor (~16k, [floors.md](floors.md)), never on
the cold pool: off-screen life is the macro tick's abstract job
([macrosim.md](macrosim.md)), on-screen life is this brain's. The two never
overlap — the same detailed-near / coarse-far split as everything else.

## Shape — score, pick, commit, steer

Each embodied agent, each frame it is *scheduled* (see stagger), runs a four-stage
pipeline. Only the score stage is pure; the rest is a tiny per-entity FSM state.

### 1. Needs — the drives (data, decaying columns)

A fixed block of **0..100 needs** per embodied agent, stored SoA (an ECS
component, not a per-entity object). They **decay/rise every sim tick** at
data-driven rates, scaled by the character-sheet attribute block
([npcs.md](npcs.md): generic 8-slot attributes, slot→meaning is a table):

| Need | Direction | Ref rate (per sec) | Attribute scale (`rate /= 1 + 0.1·stat`) |
|------|-----------|--------------------|-----------------|
| food | reserve, **falls** | 0.08 | STR (attr slot 0) |
| water | reserve, **falls** | 0.12 | AGI (attr slot 1) |
| sleep | reserve, **falls** | 0.05 | INT (attr slot 2) |
| pee | pressure, **rises only via digestion** | 0.10 (digest) | — |
| poo | pressure, **rises only via digestion** | 0.06 (digest) | — |

Rates are a **table**, not code; attribute scaling means a hardier NPC hungers
slower. Restoring a need (eating, drinking, using a toilet, sleeping) is an
intent's *effect*, applied when the FSM reaches the target. Cold NPCs carry no
fine needs — the macro tick models their lives abstractly; needs materialise only
on embodiment and fold away on de-embodiment, like every other transient
([npcs.md](npcs.md): hp/inventory stay canonical, only transient state folds).

**Built (#12a — [src/game/ai.h](src/game/ai.h) / [.cpp](src/game/ai.cpp)).** The
`Needs` component is a flat `float[kNeedCount]` block **plus two `pending`
digestion pools** (`pendingPee` / `pendingPoo`). One block holds both flavours,
split only by **index** (`kFirstPressure`), never a type tag: `[0, kFirstPressure)`
are the **reserves** (food/water/sleep), the rest the **pressures** (pee/poo).
`needs_step(reg, pool, dt)` is one linear sweep over the packed EnTT column — O(n)
over the live set, no per-object dispatch:

- **reserves decay** every tick by `rate·dt`, each **attribute-slowed** by
  `rate /= (1 + 0.1·stat)` — STR (attr slot 0) slows food, AGI (slot 1) water, INT
  (slot 2) sleep, read from the record's generic 8-slot block (`pool.attrs(id)`);
  clamped at 0. (Fixing slots 0/1/2 = STR/AGI/INT is the `slot→meaning` data
  decision [npcs.md](npcs.md) defers, taken here to match the reference RPGStats.)
- **pressures rise only by digesting** their pool: `dp = min(pending, rate·dt);
  v += dp; pending -= dp`, clamped at 100. A **fresh gut (empty pool) holds pee/poo
  flat** — they do not climb on their own; the eat intent (#12b) fills the pool.

`seed_needs(needs, id)` seeds a fresh body deterministically from its stable id (a
stateless `hash3` per need over an independent salt; per-need bands food/water
70–100, sleep 60–100, pee 0–30, poo 0–20; pending pools empty), so embodiment is
reproducible with **zero stored RNG state**. Every rate, range, the digestion
model, and the `0.1`-per-point attribute coefficient are **ported verbatim from
the reference `needs.ts`** (same design-doc → exact-extraction → code flow as the
[faction matrix](macrosim.md)). Restore-on-use — eating / drinking / toilet /
sleep filling or draining a need — is an intent *effect*, so it lands with the
scorer (#12b). Verified headless by `test_needs_decay`.

### 2. Utility scorer — 13 intents, pure and stateless

`score(agent, world) -> float[13]`, each clamped **0..100**, one **additive
scorer per intent** (no cross-talk, no shared mutable state — a pure function of
the agent's needs, threat, role, floor rhythm and faction standing). The 13
intents:

`safety · combat · flee · toilet · drink · eat · sleep · work · heal · social ·
patrol · faction_assault · wander`

Purity is load-bearing: it makes the scorer trivially testable in isolation
(headless, like the macro tick) and order-independent, and it keeps **zero
scheduling RAM** — see stagger. `faction_assault` reads the
[faction matrix](macrosim.md) (#10d): an agent scores assaulting a nearby member
of a faction its own faction is `hostile()` toward. `social` biases toward
faction-`friendly()` neighbours and the agent's own high-affinity relationship
edges (the per-NPC `rel_` block, [npcs.md](npcs.md)).

### 3. Selection — argmax with hysteresis (anti-flapping)

Raw argmax over 13 scores flaps every frame at a tie; the reference guards it with
a small state machine (kept as a minimal per-entity FSM record — the current
intent, its start time, its committed path):

- **Switch margin ~7** — a new intent must beat the current by a margin to win, so
  near-ties stick.
- **Emergency override ~58** — `safety / flee / combat / heal` above an emergency
  score preempt immediately, bypassing the margin (survival never waits).
- **Stickiness ~+5 → +12** — the current intent gets a bonus that grows the longer
  it's held, so a chosen task runs to a sensible end instead of churning.
- **Re-plan every ~1.5–4.0 s**, the interval **hash-seeded per agent** so the crowd
  doesn't re-plan in lockstep. Between re-plans the committed path is followed.
- **Path-commitment guard** — don't abandon an in-progress route for a marginally
  better intent; finishing beats thrashing.

### 4. Steering — follow the baked nav, don't search

Once an intent picks a target cell, movement is a **read of baked data**, never a
per-agent A\* in the hot path ([performance.md](performance.md): baked, not
searched). The reference used an HPA\* region graph + subcell BFS + `followPath`
lookahead string-pulling + a flow-field `next[]` gradient. gigahrush2 already has
the better-afforded version baked ([nav.md](nav.md)): **`route_step(coarse, fine,
from, to)`** = coarse next-hop → descend that node's flow field, an O(1) read per
step. Flee/scent steering reads **`diffusion_gradient`** ([diffusion.md](diffusion.md),
the flee intent's input, distinct from nav). The brain's output is just
`Controller::wishDir` toward the next step — then [controller.md](controller.md) +
[physics.md](physics.md) do the rest.

## Scheduling — identity-hash stagger, zero per-NPC RAM

The driver iterates **all** live AI entities every frame (no persistent stripe
buffers). Whether an agent re-scores *this* frame is a **stateless hash of its
identity and the clock** (the reference's FNV-1a mix, `HASH_OFFSET 2166136261 /
HASH_PRIME 16777619`, finalised with a `mix32`) — the same stateless-hash trick as
the macro tick ([macrosim.md](macrosim.md)) and worldgen ([core/rng.h](src/core/rng.h)).
So the re-plan schedule costs **no scheduling memory at all**: no per-entity
next-tick timestamp, no wheel, no queue — the phase falls out of the id. This is
what lets the whole crowd's cadence spread smoothly across frames for free.

## Data-oriented stance (how it ports, not just what it is)

- **Needs = SoA columns** on the embodied set, decayed in one linear pass — never
  a per-object update method.
- **Scorer = one pure `float[13]` function** — the 13 intents are *rows of a
  scorer table*, added not branched; a new intent is a new row, not a new code
  path. (The reference keeps them as separate additive functions; the port folds
  them into a data-indexed dispatch where clean.)
- **FSM state = the minimum** — current intent + commit time + path handle, a tiny
  per-entity record, not a class hierarchy. The reference parks it in module
  WeakMaps; the port puts it in an ECS component so it folds with embodiment.
- **Steering = baked reads** — `route_step` / `diffusion_gradient`, O(1), no search
  on the tick.
- **Universal** — the player is just an embodied record too; giving an NPC a
  `Controller` and this brain, or handing the camera to the player, are the same
  seam ([npcs.md](npcs.md)). Combat is isotropic: an NPC that shoots spawns an
  honest projectile that can hit anyone, the firer included.

## Connections

Consumes needs (this doc), the baked nav ([nav.md](nav.md)) and flee field
([diffusion.md](diffusion.md)), and the [faction matrix](macrosim.md) (#10d).
Produces `Controller::wishDir` for [controller.md](controller.md) → drives the
same [physics.md](physics.md) as the player. Runs on the embodied slice the
[macrosim.md](macrosim.md) macro tick hands to [floors.md](floors.md) streaming.
Content it acts on (food/drink items, weapons, monster targets) comes from the
#13 tables ([items.md](items.md) / [monsters.md](monsters.md)).
