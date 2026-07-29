# AI — utility brain for embodied NPCs

> **Status: needs layer (#12a), the pure scorer + selection FSM (#12b), and the
> stagger + steering + embody/loop driver (#12c) all BUILT — the visible crowd
> now moves.** This is the
> porting-target spec for the embodied NPC brain, captured from the reference
> (`../gigahrush`: `needs.ts`, `npc_utility.ts`, `npc_fsm.ts`, and the pathfinding
> steering). Exact per-intent scorer constants were **re-extracted verbatim** (the
> same design-doc → exact-extraction → code flow used for the
> [faction matrix](macrosim.md)) and are now the frozen table in
> [src/game/ai.cpp](src/game/ai.cpp); the per-intent formulas quoted below are the
> shape. It lives in the game layer (`src/game/`, `giga_game`) over the ECS
> ([ecs.md](ecs.md)) and consumes the baked nav ([nav.md](nav.md)) and flee field
> ([diffusion.md](diffusion.md)) — pure game-layer over EnTT + NpcPool, so the
> whole brain is exercised **headless** by `game_test`, exactly like the macro tick.
>
> - **Code:** [src/game/ai.h](src/game/ai.h) / [.cpp](src/game/ai.cpp)
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp) `test_needs_decay`,
>   `test_scorer`, `test_selection`, `test_ai_step`
> - **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4
> - Upstream of [physics.md](physics.md): a plain NPC has **no `Controller`/`CameraTag`**
>   (those are the *player's* input seam), so the brain writes its horizontal
>   `Velocity` directly and [physics.md](physics.md) integrates it — gravity still
>   owns `v.z`. The player body carries the same `Needs`/`AiBrain` but `ai_step`
>   **skips any camera-holder**, so player input drives the identical locomotion
>   path with no privileged branch ([npcs.md](npcs.md): the player is not special).

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

**Built (#12b — [src/game/ai.cpp](src/game/ai.cpp) `score_intents`).** A pure
`score_intents(perception, needs, out[13])` fills the 13 utilities, each an
additive body clamped to 0..100, then nudged by a per-agent **identity jitter**
(§Scheduling) so a uniform crowd does not tie in lockstep. Every coefficient,
pressure curve (`lowNeedPressure` / `highNeedPressure` / `healthPressure` /
`computeThreatPressure`) and the `clampScore`/`unitish` band logic is **ported
verbatim** from `npc_utility.ts`. The scorer never touches the pool or world: it
reads a **`Perception`** snapshot the driver (#12c) fills from whatever the engine
currently exposes. Signals the target does not yet produce — mobs/combat (#13), a
room-affordance model, a minute-of-day clock, the samosbor event — sit at
zero/`none`/−1 in `Perception`, so **every additive term with a missing input
contributes 0 and the ranking among the live intents (needs-driven + diffusion
threat) is exactly the reference's**; a later system fills the field and its term
switches on with *no scorer edit*. Verified headless by `test_scorer` (need- and
threat-driven argmax, the 0..100 range, per-identity spread).

### 3. Selection — argmax with hysteresis (anti-flapping)

Raw argmax over 13 scores flaps every frame at a tie; the reference guards it with
a small state machine (kept as a minimal per-entity FSM record — the current
intent, its start time, its committed path):

- **Switch margin 7** — a new intent must beat the current by this margin to win,
  so near-ties stick. (The FSM override 7, *not* the `npc_utility` default 8 —
  using 8 diverges at the hysteresis boundary.)
- **Emergency override 58** — `safety / flee / combat / heal` at or above this
  score preempt immediately, bypassing the margin (survival never waits).
- **Stickiness +5 → +12** — the current intent gets a bonus `5 + min(7, t·0.18)`
  that grows the longer it's held, so a chosen task runs to a sensible end instead
  of churning. Applied *inside* the scorer (via `Perception.stickinessAmount`), so
  selection only needs the raw scores.
- **Re-plan every 1.5–4.0 s**, the interval **hash-seeded per agent** so the crowd
  doesn't re-plan in lockstep. Between re-plans the committed path is followed.
- **Path-commitment guard** — don't abandon an in-progress route for a marginally
  better intent; finishing beats thrashing.

**Built (#12b — [src/game/ai.cpp](src/game/ai.cpp) `select_intent`).** The
argmax + hysteresis itself: `select_intent(scores[13], current)` takes the raw
argmax (ties → lower index), keeps `current` unless a challenger clears the switch
margin, and lets an emergency intent ≥ 58 preempt regardless. The frozen
thresholds live as named constants in [ai.h](src/game/ai.h) (`kSwitchMargin`,
`kEmergencyScore`, and the `stickiness_amount` curve / re-plan bounds the #12c
driver consumes). The **AiBrain** component (current intent + `stateTimer` +
`nextDecisionAt` + a `decisions` re-plan counter) is defined here and folds with
embodiment like `Needs`. Verified headless by `test_selection` (margin
stick/switch, emergency preempt, emergency-below-score fallback, tie-break); the
re-plan **cadence** and the identity **stagger** are the driver's job — see §5.

### 4. Steering — read baked fields, don't search

Once an intent picks a target, movement is a **read of baked data**, never a
per-agent A\* in the hot path ([performance.md](performance.md): baked, not
searched). The reference used an HPA\* region graph + subcell BFS + `followPath`
lookahead string-pulling + a flow-field `next[]` gradient. gigahrush2 already has
the better-afforded version baked ([nav.md](nav.md)): **`route_step(coarse, fine,
from, to)`** = coarse next-hop → descend that node's flow field, an O(1) read per
step. Flee steering reads **`diffusion_gradient`** ([diffusion.md](diffusion.md),
the flee intent's input, distinct from nav).

**Built (#12c — [src/game/ai.cpp](src/game/ai.cpp) `ai_step`).** The driver
resolves each agent's macro cell from its `Transform`, and steers by writing the
horizontal `Velocity` at `kNpcWalkSpeed` (2 m/s — the reference
`HUMANOID_BASE_MOVE_SPEED`; the player's `Controller` runs 7):

- **Flee** reads `−diffusion_gradient(danger)` and heads down-field toward safety —
  the baked flee field driving locomotion end-to-end. If the field is flat (or
  absent) the agent falls through to roam.
- **Every other intent roams** a deterministic per-identity `wander_heading`
  (`rand01(hash2(id, decisions))·2π`), so the crowd disperses and each re-plan
  turns onto a fresh leg — visible motion for every intent, no idle clumping.
- `v.z` is **never touched** — gravity ([gravity.md](gravity.md)) owns the vertical
  axis, so walkers stay grounded.

**Deferred (needs #13):** full `route_step` path-following toward an intent's
*target cell*. The baked fine flow fields aim at the elevated lattice nodes
(`z ∈ {16,48,80,112}`, [nav.md](nav.md)), but a gravity-bound walker at the ground
storey can't climb a shaft to reach one, so following them now would steer bodies
into walls. Real targets — a food item, a toilet cell, a monster — arrive with the
#13 content tables ([items.md](items.md) / [monsters.md](monsters.md)); once an
intent has a reachable goal cell, `route_step` becomes its steering with **no
change to the scorer or the FSM** (the same stubbed-input seam as §2). Until then
flee-gradient + wander give the whole crowd honest, deterministic motion.

### 5. Driver + scheduling — identity-hash stagger, no queue

`ai_step(reg, pool, danger, grid, now, dt)` is the per-frame driver: it iterates
**all** live AI entities every frame (no persistent stripe buffers, no scheduling
wheel or queue), skips camera-holders, decays nothing (that's `needs_step`), and
for each agent either **re-plans or coasts**, then applies §4 steering. Whether an
agent re-plans *this* frame is a compare against its own `AiBrain.nextDecisionAt`
deadline; when it fires, the driver re-scores, re-selects, bumps the `decisions`
counter, and sets the next deadline to
`now + 1.5 + rand01(channel_seed(id,"utility_rethink"))·2.5` — a **per-identity
period** (1.5–4.0 s) drawn from a **stateless hash** (the FNV-1a `channel_seed`
fold, the same stateless-hash trick as the macro tick
[macrosim.md](macrosim.md) and worldgen [core/rng.h](src/core/rng.h)). So two
agents spawned the same frame drift apart permanently and the crowd's cadence
spreads smoothly across frames. The only scheduling state is that one `float`
deadline riding in the FSM record that already folds with embodiment — no wheel,
no queue, no side table. Verified headless by `test_ai_step` (embodiment attaches
`Needs`/`AiBrain`; one step commits an intent, staggers into [1.5, 4.0] s, and
steers at walk speed with `v.z` untouched; the player is skipped; same id →
identical steer, different id → different heading; a saturating danger ramp
selects flee and drives `−x`; the deadline gates re-planning).

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
- **Steering = baked reads** — `diffusion_gradient` now, `route_step` once #13
  gives reachable goals, O(1), no search on the tick.
- **Universal** — the player is just an embodied record too; it carries the same
  `Needs`/`AiBrain`, and the driver simply **skips camera-holders** so player input
  drives the identical `Velocity`→physics path an NPC brain writes to
  ([npcs.md](npcs.md)). Combat is isotropic: an NPC that shoots spawns an honest
  projectile that can hit anyone, the firer included.

## Connections

Consumes needs (this doc), the baked nav ([nav.md](nav.md)) and flee field
([diffusion.md](diffusion.md)), and the [faction matrix](macrosim.md) (#10d).
Produces horizontal `Velocity` straight into [physics.md](physics.md) — the same
integrator the player reaches through [controller.md](controller.md). Runs on the embodied slice the
[macrosim.md](macrosim.md) macro tick hands to [floors.md](floors.md) streaming.
Content it acts on (food/drink items, weapons, monster targets) comes from the
#13 tables ([items.md](items.md) / [monsters.md](monsters.md)).
