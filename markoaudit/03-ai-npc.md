# AI / NPC / Crowd — Legacy & Dead Code Audit

Repo: `/Users/jirnyak/Mirror/gigahrush2`, branch `torus`, HEAD `97bdf13e`.
All claims below were re-verified by `grep` on **2026-08-17**. Where a source comment
disagrees with grep, the comment is listed as a **LEGACY** finding in its own right.

Scope: 32 files (`src/game/{ai,npc_pool,wander,mob_behaviour,mob_spawn,mob_table,monster_traits,needs,macro_sim,population,hunt,faction_relations,rpg,embody,speech,rumour}.{cpp,h}`)
plus `monster_traits_table.cpp`, `speech_table.cpp`, and the call sites in `src/app/main.cpp`.
**13,915 lines, of which 6,077 (43%) are comment lines.**

---

## 0. Executive map — who decides "what does an agent do next"

There is no single sim tick file; the tick is inline in `src/app/main.cpp` inside the
fixed-step `while (simAcc >= kSimStepMs)` loop. Verified order of every steering /
decision pass, with the line number of the actual call:

| # | Pass | File | Line in main.cpp | Scope (ECS view) | Writes Velocity? |
|---|------|------|------------------|------------------|------------------|
| 1 | `ai_panic_publish_step` | ai.cpp:1228 | 3174 | `AiBrain, NpcRef, Transform` | no (writes danger field) |
| 2 | `diffusion_tick` | sim/diffusion | 3175 | — | no |
| 3 | `ai_step` | ai.cpp:587 | 3177 | `AiBrain, NpcRef, Transform, Velocity` | **YES** |
| 4 | `ai_equip_step` | ai.cpp:1256 | 3183 | `AiBrain, NpcRef, Transform` | no |
| 5 | `ai_patrol_step` | ai.cpp:1103 | 3794 | `AiBrain, NpcRef, Transform, Velocity` | **YES** |
| 6 | `wander_step` | wander.cpp:119 | 3796 | `Transform, Velocity, WanderTarget` | **YES** |
| 7 | `investigate_step` | investigate.cpp | 3814 | `const MobRef, const Transform, Velocity` | **YES** |
| 8 | `faction_feud_step` | faction_relations.cpp:~225 | 3931 | `Transform, Velocity, const NpcRef` | **YES** |
| 9 | `slow_step` | combat.cpp | 3937 | `Slowed, Transform, Velocity` | clamp only |
| 10 | `physics_step` | sim/physics.cpp | 3938 | `Transform, Velocity` | integrator |
| — | `needs_step` | needs.cpp:250 | 4550 | `const NpcRef, const Transform` | no |
| — | `macroSim.step` | macro_sim.cpp | 5031 (every 250 ticks) | NpcPool SoA | no |
| — | `speech_say` / `rumour_for` | speech/rumour | 4492 / 4511 | proximity sweeps | no |

**Five systems pick a movement goal for an agent every tick.** They are kept apart by
three *different* mechanisms layered on each other, which is the core structural finding:

1. a **token** (`AiBrain::motion`, `ai_owns_motion`) — read by `wander_step` (wander.cpp:209)
   and `faction_feud_step` (faction_relations.cpp:247);
2. **type exclusion** — `investigate_step` views `const MobRef` so it can never hit an
   `NpcRef` body; `ai_step` `continue`s on `MobRef`/`CameraTag` (ai.cpp:664);
3. **call order** — `investigate_step` runs after `wander_step` deliberately to override it
   (investigate.h:105); `faction_feud_step` runs after both (main.cpp:3919 comment) and its
   write silently discards an AI flee.

`ai.h:53` states "call order is not a contract", then `investigate_step` and
`faction_feud_step` both depend on it. That is the merge target.

**Ownership of the agent record is clean and NOT duplicated**, contrary to the brief's
hypothesis:
- `NpcPool` (npc_pool.h) is the one store for **people**. `population.cpp` only *seeds* it
  (2 functions, 1 of them dead). `macro_sim.cpp` only *evolves* it. `embody.cpp` only turns a
  record into an `Entity` (`NpcRef`).
- `mob_table` + `mob_spawn` are **monsters** and have **no pool record at all** — `MobRef` is
  entity-only. Confirmed: hunt.cpp:39 comment + no `NpcRef` on any spawned mob.
- **The real defect is the asymmetry**: monsters have no needs, no memory, no faction row, no
  macro existence, no role, no death bookkeeping in the pool. Two entirely separate agent
  representations, with `wander_step` forced to branch on `try_get<MobRef>` five times
  (wander.cpp:181, 249, 448) to serve both.

---

## 1. WIRED / UNWIRED

Everything in scope is reachable from the tick. **No whole module is unwired.** But
individual entry points are:

| Symbol | File:line | src callers outside own module | Verdict |
|---|---|---|---|
| `seed_floor_population` | population.cpp:233 | **0** (tests only, 18 refs) | **DEAD** — 15 LOC wrapper around `seed_floor_from_spec` |
| `behaviour_is_dead` | mob_behaviour.cpp:268 | **0** (tests only, 14) | **DEAD** — pure test oracle |
| `behaviour_is_dispatched` | mob_behaviour.cpp:291 | **0** (tests only, 2) | **DEAD** — pure test oracle |
| `trait_move_mult` | monster_traits.cpp:86 | **0** | **DEAD** |
| `trait_damage_mult` | monster_traits.cpp:91 | **0** | **DEAD** |
| `trait_incoming_mult` | monster_traits.cpp:96 | **0** | **DEAD** |
| `trait_has_vulnerability` | monster_traits.cpp:109 | **0** | **DEAD** |
| `trait_takes_bait` | monster_traits.cpp:139 | **0** | **DEAD** |
| `trait_takes_bait_any` | monster_traits.cpp:143 | **0** | **DEAD** |
| `trait_allows_wet_spawn` | monster_traits.cpp:151 | **0** | **DEAD** |
| `monster_trait_authored_count` | monster_traits.cpp:54 | **0** | **DEAD** |
| `monster_traits_rows_indexed` | monster_traits_table.cpp:326 | **0** | **DEAD** |
| `monster_traits_unauthored_reason` | monster_traits.cpp:188 | **0** | **DEAD** (33 lines of prose switch) |
| `ai_remember_actor` | ai.cpp:420 | **0** | **DEAD** — the whole ACTOR memory family |
| `AiMemory::live_traces` | ai.cpp:390 | **0** | **DEAD** (telemetry) |
| `AiMemory::forget` | ai.cpp:403 | **0** | **DEAD — and it is a BUG**, see §4.1 |
| `needs_survival_minutes` | needs.h:130 | **0** anywhere in src | **DEAD** |
| `NpcPool::set_name` | npc_pool.cpp:374 | **0** | **DEAD** → `name_`/`surname_` columns unreadable |
| `NpcPool::name` / `surname` | npc_pool.h:548-556 | **0** | **DEAD** |
| `NpcPool::set_design` / `is_design` | npc_pool.h:392 | **0** | **DEAD** → `NpcDesign` flag bit never set |
| `NpcPool::rebuild_free_list` | npc_pool.cpp | **0** external | internal only |
| `samosbor_fog_tick_at` | mob_spawn.cpp | **0** (12 test refs) | **DEAD** |
| `despawn_layer_fog_mobs` | mob_spawn.cpp | **0**, 0 tests | **DEAD** |
| `count_layer_fog_mobs` | mob_spawn.cpp | **0** (11 test refs) | **DEAD** |
| `str_durability_wear_mult_e3` | rpg.cpp | **0** (also 0 inside rpg.cpp) | **DEAD** |
| `int_contract_reward_mult_e3` | rpg.cpp | **0** | **DEAD** |
| `int_document_reward_mult_e3` | rpg.cpp | **0** | **DEAD** |
| `int_psi_duration_bonus_sec` | rpg.cpp | **0** | **DEAD** |
| `adjusted_psi_cost` | rpg.cpp | **0** | **DEAD** (and it is the only caller of `int_psi_cost_mult_e3`) |
| `total_xp_for_level` | rpg.cpp | **0** | **DEAD** |
| `bodies_hostile` / `npc_seeks_fight` / `nearest_faction_foe` | faction_relations.cpp | internal only (feud step) | keep, but not public API |

Verification command shape used throughout:
`grep -rn "\bSYMBOL\s*(" src/ | grep -v <own module>` and the same over `tests/`.

---

## 2. DUPLICATION — the key question

### 2.1 Five brains, one `Velocity` — **DUPLICATE**

| System | Picks a target by | Steers by | Guarded from the others by |
|---|---|---|---|
| `ai_step` flee (ai.cpp:836-886) | `door_nearest_shelter` → `-∇danger` → memory centroid | `kFleeSpeed` | writes token |
| `ai_step` errand (ai.cpp:887-1065) | `intent_room_mask` + `role_traits.homeRooms/workRooms` → baked room field → hashed seat | `kErrandSpeed` | writes token |
| `ai_patrol_step` (ai.cpp:1103) | hashed lattice node + `coarse.dist` reachability scan | `kErrandSpeed` | writes token |
| `wander_step` mob aggro (wander.cpp:249-366) | camera holder in `behaviour_aggro_radius`, else `nearest_prey` under `mob_hunts_npcs` licence | `md.speedMmps` × 4 stacked behaviour multipliers | reads token |
| `wander_step` roam (wander.cpp:369-457) | hashed lattice node + `coarse_next` + `fine.at` | `kNpcWalkSpeed` | reads token |
| `investigate_step` | loudest recent noise | own | **type only** (`const MobRef`) |
| `faction_feud_step` (faction_relations.cpp:225+) | `nearest_faction_foe` under `npc_seeks_fight` licence | `kFeudWalkSpeed` | reads token |

Three of these — `ai_patrol_step`, `wander_step` roam, `faction_feud_step` — do
*structurally the same thing*: identity-hash stagger → licence predicate → pick a
destination → normalise a tangent-plane vector → write `vel.v.{x,y,z}` per gravity axis.
The tangent-plane lambda is **copy-pasted verbatim four times**: ai.cpp:626-631,
ai.cpp:1122-1127, wander.cpp:132-137, and faction_relations.cpp (same shape). The
gravity-regime resolve block (`Custom → regime_from_vector`) is copy-pasted three times:
ai.cpp:614-620, ai.cpp:1115-1121, wander.cpp:125-131.

**Merge proposal M1.** Collapse to ONE `locomotion_step` with a *goal provider* seam:
each brain becomes a pure function `(entity, world) -> optional<Goal{dir, speed, priority}>`,
the driver runs them in priority order, takes the first non-empty, and performs the single
write. That deletes the token, the four tangent lambdas, the three regime blocks, and the
order-dependency between `wander_step`/`investigate_step`/`faction_feud_step`. Nothing about
the *decisions* changes — only the plumbing.

**Merge proposal M2 (smaller, do first).** Extract `struct SteerFrame { GravityFrame gf; vec3 tangent(...) }`
built once per tick and passed to all four passes. ~60 lines of copy-paste gone, zero
behaviour change.

### 2.2 `ai_patrol_step` is `wander_step` with a different hash — **DUPLICATE**

ai.cpp:1152-1224 vs wander.cpp:369-457. Both: get `fine.nearest_node`, hash a target node
from identity, scan for reachability, read `fine.at(node, cx,cy,cz)`, and on `d < 6` aim at
the next cell's **centre**, else fall back to the target node's **column**. The comments even
say so (ai.cpp:1189 "the same self-correcting rule … as the errand route step above";
ai.cpp:1200 "the same fallback the errand's vertical step takes").
**Three copies of the "aim at next cell centre / fall back to column" logic exist:**
ai.cpp:1013-1037, ai.cpp:1039-1058, ai.cpp:1187-1208, plus wander.cpp:411-445.

**Merge proposal M3.** One `flow_step_to_dir(fine, node, cell, pos, gf) -> vec3`. ~120 LOC
collapses to ~35. `ai_patrol_step` (124 LOC) then becomes a ~25-line goal provider.

### 2.3 `monster_traits` vs `mob_behaviour` — **DUPLICATE, and the source admits it**

`monster_traits.cpp:191-199` literally says: *"Answered in mob_behaviour.h instead — a
radius, a pace, a reach or an incoming multiplier. A trait row for one of these would
DOUBLE the mechanic."* Both tables key on `MobKind` and both emit per-kind movement and
damage multipliers:

| Mechanic | mob_behaviour | monster_traits |
|---|---|---|
| pace multiplier | `behaviour_move_mult`, `wall_bias_speed`, `burst_speed_mult`, `behaviour_hurt_move_mult` | `trait_move_mult` (**dead**) |
| outgoing damage mult | `behaviour_damage_mult`, `facing_damage_mult`, `burst_damage_mult`, `wall_bias_damage` | `trait_damage_mult` (**dead**) |
| incoming damage mult | `behaviour_incoming_mult` | `trait_incoming_mult` (**dead**) |
| sight radius | `behaviour_aggro_radius` | — |

`monster_traits`' entire multiplier half is the dead copy. **Merge proposal M4:** delete
`trait_move_mult` / `trait_damage_mult` / `trait_incoming_mult` / `trait_takes_bait*` /
`trait_allows_wet_spawn` and the 6 CSV columns behind them; keep only `resist[]`
(→ `sync_monster_armour`), `vulnChannel`/`vulnFloorPct` (→ `trait_counterplay_damage`,
combat.cpp:274) and `wetRegenMilliHps` (→ main.cpp:3824). `monster_traits` then shrinks to
an armour + one-regen table, and the *behaviour* answer has exactly one owner.

### 2.4 `speech` vs `rumour` vs `conversation` — **DUPLICATE proximity sweep**

`main.cpp:4484` and `main.cpp:4500` **each call `game::nearest_speaker(reg, activeLayer)`
independently**, on two different cooldowns (`kSpeechCooldownTicks` vs
`kOverhearCooldownTicks` = 250), each an O(bodies-on-layer) scan. The comment at
main.cpp:4479 defends this ("far cheaper than entangling two channels") but the result is
two sweeps per tick region for the same answer, and they can name **different** speakers,
so the HUD shows a bark from body A and a rumour from body B.

Social state is otherwise cleanly split: `faction_relations` owns the 6×6 matrix + the
per-body `rel_row`; `speech` owns a 512-byte anti-repeat cache; `rumour` owns nothing
(pure function of world state). No duplication of *state*. **Merge proposal M5:** one
`nearest_speaker` result per tick, fanned out to speech / rumour / contract / quest
(contract and quest already piggyback on the rumour sweep, main.cpp:4521/4534 — so three of
four already share one; only speech is separate).

### 2.5 `needs_for` in ai.cpp duplicates `needs_step`'s seeding — **LEGACY**

`ai.cpp:120-124` substitutes a local `needs_roll` for any row with `seeded == 0`, and
`ai.cpp:99-117` justifies it with *"[needs.h] deliberately refuses to advance the crowd's
survival clock … needs_step seeds only the camera holder"*. **Both statements are false
today**: `needs_step` (needs.cpp:267-286) sweeps every embodied body on the layer and seeds
each one via `needs_roll_resident`. Since `ai_step` runs at main.cpp:3177 and `needs_step`
at main.cpp:4550, the substitute branch is live for **exactly one tick** per body and dead
thereafter. 25 lines of comment + 5 lines of code for a one-tick path.

---

## 3. DEAD DATA

### 3.1 `Perception` — 17 of 30 fields have ZERO writers anywhere in `src/`

`Perception` is constructed in exactly one place (`ai.cpp:763`). Verified writer counts:

| Field | writers in src | scorer terms it zeroes |
|---|---|---|
| `visibleHostiles` | 0 | Combat `+34`, Flee `+24`, threat channel `×0.85` |
| `threatDistance` | 0 | Combat `+12`, threat channel |
| `hostilePower` / `allyPower` / `strongerHostile` | 0 | Combat `−14`, Flee `+18` |
| `cornered` | 0 | Combat `+18`, threat `+0.15` |
| `armed` | 0 | Combat `+18/−16` (always **−16**), Flee `−5` |
| `orderedCombat` | 0 | Combat `+28` |
| `inShelter` | 0 | threat `−0.18` |
| `isTraveler` | 0 | Wander `+19` |
| `factionAssaultTarget` | 0 | **the entire `IntentFactionAssault` score** |
| `monster` | 0 | Flee `+24`, threat channel |
| `gunfire` | 0 | threat channel `×0.75` |
| `fire` | 0 | Safety `+26`, Flee `+25`, threat channel |
| `fog` | 0 | Safety `+16`, threat channel `×0.6` |
| `samosborActive` | 0 | Safety `+72`, Flee `+8`, Sleep `−18`, Work `−45`, Social `−25`, Patrol `−24` |
| `samosborWarning` | 0 | Safety `+34` |
| `minuteOfDay` | 0 | (never even read — see 3.2) |

**Consequences that are findings in their own right:**

- **`IntentFactionAssault` can never be selected.** `ai.cpp:253`:
  `out[IntentFactionAssault] = clamp_score(p.factionAssaultTarget ? 50.0f : 0.0f)` — the flag
  is never set, so the score is 0 + identity jitter (amp 2.5). `IntentWander` alone has a
  base of 9.0 (ai.cpp:260). **DEAD enum value in a live enum.** — DEAD-DATA
- **`IntentSafety` is `threat × 44` and nothing else** — all three other terms are stubs.
  It is therefore a strictly weaker duplicate of `IntentFlee` (`threat × 42` plus six live
  terms), and the two share the same steering branch (ai.cpp:1088). **`IntentSafety` is a
  redundant intent.** — BLOAT
- **`IntentCombat` is `risk×22 + duty×10 − hpP×30 − panic×12 − 16`** — a per-faction
  constant plus health. It cannot respond to an actual enemy. And when it wins, `ai_step`
  gives it no steering branch, so the body is handed straight back to `wander_step`
  (ai.cpp:1072). — FAKE-GATE
- **The samosbor block is the largest dead term set** — `samosborActive` appears in six
  intent formulas and is never set, even though `main.cpp` has a live `samosbor` object it
  passes to `speech_context` (main.cpp:4487) and `rumour_for` (main.cpp:4512). One
  assignment would light up all six. — DISABLED

### 3.2 `const float rhythm = 0.0f;` — **FAKE-GATE**

`ai.cpp:185`. Added to **seven** intent formulas (Toilet, Drink, Eat, Sleep, Work, Social,
Patrol, Wander). A hardcoded zero multiplier that kills the entire daily-routine layer.
`Perception::minuteOfDay` (the input it would need) has 0 writers *and* 0 readers.

### 3.3 `AiMemory` actor family — write-side never exists

- `ai_remember_actor` (ai.cpp:420): **0 callers**.
- `MemFoe`, `MemAlly`: never constructed. (`MemFood`/`MemWater`/`MemRest`/`MemToilet`
  *do* have a producer — `room_zone.cpp:140-146` — which contradicts `ai.h:214` and
  `ai.h:1062`, both of which still say all six have "NO producer". **LEGACY comment.**)
- `MemoryRecall::foe` (ai.h:667): written at ai.cpp:462, **read nowhere**. — DEAD-DATA
- `MemoryRecall::grudge`: only reachable via `MemFoe`, which no producer creates.
- `Perception::grudge` (ai.h:741): written at ai.cpp:514, **never read by `score_intents`**.
  The grudge is actually spent through `localScore[]` at ai.cpp:526-527. Pure write-only
  field. — DEAD-DATA
- `apply_recall`'s grudge split (ai.cpp:523-528) is therefore an unreachable branch. — DEAD

### 3.4 `MobDef` — 4 columns with **zero references in the entire tree**, and all 68 rows are identical

`navStepSub` (mob_table.h:194), `navClimbSub` (:195), `navDropSub` (:196), `navFly` (:197).
Verified: `grep -rn "navStepSub\|navClimbSub\|navDropSub\|navFly" src/ tests/ tools/ data/`
returns **only the four declarations** — not even the generated `mob_table.cpp` names them
(positional aggregate init).

Worse than unread: **every one of the 68 CSV rows carries the identical quadruple
`(1, 8, 16, 0)`** (verified by `Counter` over `data/mobs.csv`; `grep -c "1, 8, 16, 0," src/game/mob_table.cpp` = 68).
So there is no per-kind traversal profile even in the *data* — including the two
`AiFlag::Flying` kinds, which ship `navFly = 0` against mob_table.h:191's claim that
"navFly != 0 ignores gravity entirely". 272 authored numbers, one distinct value, no reader.

### 3.4b Two of 68 monsters can never spawn — DEAD content

`CREATOR` (`spawn_weight 0`, `min_samosbor 99`) and `PSEUDOLIFT` (`spawn_weight 0`).
`spawnWeightX10 == 0` is a hard `continue` in **both** spawn paths:
`mob_spawn.cpp:268` (floor spawner) and `mob_spawn.cpp:501,524` (fog roster, both passes).
`CREATOR` is doubly excluded — `minSamosbor = 99` is the "never" sentinel (mob_table.h:181).

### 3.4c Monster armour exists for exactly one kind

`grep -c "MonsterTraits{ {0, 0, 0, 0, 0}" src/game/monster_traits_table.cpp` = **67 of 68**.
The only non-zero row is `monster_traits_table.cpp:259` `{72, 32, 32, 32, 0}`, and
`sync_monster_armour` (monster_traits.cpp:168-175) *removes* the `Armour` component when the
row is all-zero. So the whole armour path — the one part of `monster_traits` that is
genuinely wired — affects a single monster.

### 3.5 `AiFlag` — 4 of 8 bits have zero consumers

Excluding the generated `mob_table.cpp` rows:

| Bit | consumers in src | note |
|---|---|---|
| `Immobile` | 4 | live |
| `Flying` | 2 | live |
| `WallBias` | 10 | live |
| `Ranged` | **0** | combat gates on `def.shotRangeMm != 0` instead (combat.cpp:798) |
| `Boss` | **0** | 
| `Rare` | **0** | 33 CSV rows carry it; no spawn gate reads it |
| `FoodBait` | **0** | 10 rows |
| `WaterStrider` | **0** (1 comment ref) | 2 rows |

### 3.6 `MobBehaviour` — 22 of 47 enumerators are indistinguishable from `Plain`

`behaviour_is_dispatched` (mob_behaviour.cpp:291) names 20; `behaviour_is_dead` names 4
(`Melee`, `WeakWallBreach`, `RangedClause`, `SourceSwarm`). The remaining **22** —
`LampPowered, LightLock, DrainArmor, WaterPressureLine, FogOffset, ScentOvercommit,
SlimeScavenger, SlimeStrider, MeatGrowth, BlackWaterWake, RoomBoundAberration,
LastSoundBeam, ScrapWake, BaitLine, SecondBeat, HostParasite, NetPossessor, FalsePatrol,
DefensiveNeutral, WetLineShot, FogSwimmer, ParasiteLeader` — fall through every `switch`'s
`default:` and behave exactly as `Plain`.

Each is carried by **exactly one** `data/mobs.csv` row. So of 68 monsters: 22 are authored
`Plain`, 26 carry a behaviour that does nothing, 20 have a real behaviour.
**71% of the bestiary is mechanically identical.** — DEAD-DATA

### 3.7 `MonsterTraits` — 8 of 12 columns dead

Live: `resist[]` → `sync_monster_armour` (main.cpp:1059); `vulnChannel`/`vulnFloorPct` →
`trait_counterplay_damage` (combat.cpp:274); `wetRegenMilliHps` → `trait_wet_regen_hps`
(main.cpp:3824).
Dead (their only reader is a `trait_*` function with no caller): `terrain`, `wetMoveX100`,
`dryMoveX100`, `wetDmgX100`, `dryDmgX100`, `wetIncomingX100`, `baitMask`, `authored`.

**Additionally, 3 of the 5 `resist` channels are unreachable**, verified by enumerating
every `apply_damage` channel argument in `src/`:
- `Kinetic` — reachable (everywhere).
- `Energy` — **reachable**: `kMatElectricGrate` is placed by `padic_gen.cpp:329`, and
  `wander.cpp:189-192,460` applies `get_cell_hazard`'s `DamageChannel::Energy` to mobs.
- `Fire` — the only producer is `main.cpp:3861`, which targets **the player**. `kMatFireCell`
  is declared (materials.h:37) and **placed by no generator**. Unreachable for mobs.
- `Buckshot` — no producer anywhere.
- `Psi` — no producer, and the column is 0 in all 21 CSV rows.

### 3.8 `RpgStats` — `Agi` and `Int` reach the sheet but not the game

`Attr` is `{Str, Agi, Int}` (rpg.h:63). Every use of `attr[1]` / `attr[2]` outside `rpg.cpp`
is a **print or a serialize**: main.cpp:2995, :3407-3431, :5261; combat.cpp:2259-2260;
save.cpp:298-300. Inside `rpg.cpp` they feed `agi_*` / `int_*` helpers, of which:
- live: `agi_move_speed_mult_e3`, `agi_attack_speed_mult_e3`, `agi_ranged_spread_mult_e3`,
  `int_xp_mult_e3` (via `award_xp`), `str_melee_dmg_mult_e3`, `level_hp`, `level_psi`.
- **dead**: `str_durability_wear_mult_e3`, `int_contract_reward_mult_e3`,
  `int_document_reward_mult_e3`, `int_psi_duration_bonus_sec`, `adjusted_psi_cost`
  (and therefore `int_psi_cost_mult_e3`), `total_xp_for_level`.

### 3.9 `NpcPool` dead columns

`npc_pool.h:225-227` admits it: *"belonged to columns with NO reader anywhere in src/:
rel_ 128 (no reader at all), name_ + surname_ 48 (set_name has no caller in src/)"*.
Re-verified today:
- `set_name` — 0 callers. `name()` / `surname()` — 0 readers. **DEAD** (48 B/row demand column)
- `relations()` — 1 caller: `macro_sim.cpp:124`, inside the social pass, **which is off**
  (§4.2). So the 128 B/row `rel_` column is allocated by nothing and read by nothing. **DEAD**
- `NpcDesign` flag bit — `set_design`/`is_design` have 0 callers. **DEAD**
- `attrs()` (8 B/row) — written at population.cpp:207-210, **read nowhere in src/**. **DEAD**
  (rpg.h:56-62 says the sheet "leaves slots 3..7 free"; slots 0..7 are all unread.)

### 3.10 `MacroStats` / `MacroParams` dead fields

`socialEdges`, `socialStaleDropped` — computed but always 0 (§4.2). `growthRatePerYear`
defaults 0 and `main.cpp:1841` uses a default-constructed `MacroParams`, so the open-loop
growth term (macro_sim.cpp:356) always contributes 0.

---

## 4. ONE-LINE-DISABLED / FAKE GATES

I grepped the 32 in-scope files for `if (false)`, `if (0)`, `#if 0`, `TODO`, `FIXME`, `XXX`,
`HACK`: **zero hits.** The disabled features in this subsystem are all disabled by *data*,
not by a commented branch. That is worse, because nothing greps for them.

### 4.1 `AiMemory::forget` is never called, and recycling IS on — **BUG**

`main.cpp:1826` calls `pool.set_recycling(true)`. `AiMemory` is keyed by `NpcId`
(= slot number). `AiMemory::forget(NpcId)` (ai.cpp:403) has **0 callers in src/**.
`NpcPool::kill` (npc_pool.cpp) does not touch it. Therefore **a recycled slot inherits the
dead person's danger memories, hurt cells and grudges** — a newborn spawns already afraid of
a corridor it has never seen. `ai.h:603` documents `forget` as being for "death, or an
explicit forget"; nothing performs either.

### 4.2 The whole macro social graph is off by a default value — **DISABLED**

`MacroParams::socialFormRatePerYear = 0.0f` (macro_sim.h:228). `main.cpp:1841` constructs
`game::MacroParams macroParams;` and never assigns it. The gate at macro_sim.cpp:563 is
`if (factions != nullptr && params.socialFormRatePerYear > 0.0f && params.socialRecordsPerTick > 0u)`.
Dead behind it: the entire social ring-scan (~55 LOC, macro_sim.cpp:556-616), the 5
`social_edge_*` accessors (macro_sim.h:132-160), `Relationship::pad` generation stamping,
`MacroStats::socialEdges` / `socialStaleDropped`, `socCursor_`, and `NpcPool::rel_`
(128 B/row — *the widest column in the pool*).

### 4.3 `const float rhythm = 0.0f;` — see §3.2. Kills 8 scorer terms.

### 4.4 `Perception` stubs — see §3.1. Kills ~20 scorer terms and 1 whole intent.

### 4.5 `hunt.h:103` — `kHuntEpochTicks = 2400` is a known-wrong constant, deliberately not fixed

hunt.h:82-102 documents it: 2400 was 20 s at 120 Hz, the sim runs at 125 Hz, so the hunting
window is 19.2 s against a measured 13.8 s time-to-kill. The fix was **tried and reverted**
because it phase-shifts `tests/suite_noise.inl`'s gunshot demo. 21 lines of comment
explaining why a one-character constant is wrong. — LEGACY

### 4.6 `main.cpp:3140` — `// PARKED: game::needs_step(reg, pool, kSimDt);`

A commented-out call to a signature that no longer exists, plus 8 lines explaining why,
sitting 1400 lines above the live 7-argument call at main.cpp:4550. — LEGACY

### 4.7 Vertical navigation is disabled for the entire crowd by one boolean — **DISABLED**

`wander.cpp:411-412`:
```cpp
const bool inWalkingPlane = (flow < 6) && ((flow >> 1) != gf.axis);
```
Any baked flow byte pointing **along the gravity axis** falls into the `else` branch, which
substitutes a tangent-plane bearing toward the hop node's column and, if that is under one
cell away, re-rolls the destination and **zeroes the velocity** (wander.cpp:432-442).
`wander.h:109-112` states the consequence in the file's own words: a walking body cannot
step up a storey, stairwell/elevator traversal "is not wired yet", and the crowd explores
only its own storey. `ai_step`'s errand (ai.cpp:1038-1058) and `ai_patrol_step`
(ai.cpp:1198-1208) reimplement the same fallback, so **all three steerers are floor-locked
by the same missing feature, three times over.** This is the single largest behavioural gap
in the subsystem and it is not a comment — it is a `&&`.

### 4.8 Wet spawning is refused for every kind at one call site — **FAKE-GATE**

`mob_spawn.cpp:48-51`:
```cpp
bool placeable(const float* wet, const World& w, int x, int y, int z) {
    if (!floor_standable(w, x, y, z)) return false;
    return fluid_at(wet, x, y, z) < kFluidMinFlow;
}
```
No kind is exempt. `trait_allows_wet_spawn` (monster_traits.cpp:151) and the 5 authored
`TerrainPref::Wet` rows therefore cannot influence placement — which is *why* the function
has no caller. Deleting the trait (A4) and deleting this branch's `wet` parameter are the
same decision.

### 4.9 11 of 13 intents never own motion

Only `IntentFlee` (ai.cpp:836) and the room-errand intents behind `useRooms` (ai.cpp:887 —
today `eat`/`drink`/`toilet`/`sleep`, plus `work`/`sleep` redirected by `RoleTraits`)
ever set `owned = true`. `IntentCombat`, `IntentSocial`, `IntentPatrol` (except through the
separate `ai_patrol_step` pass), `IntentHeal`, `IntentSafety` and `IntentFactionAssault` win
the scorer and then hand the body straight back to `wander_step` at ai.cpp:1072-1077.
The scorer ranks 13 things; the steerer can act on 5.

### 4.10 `hunt.cpp:13-16` — empty anonymous namespace left behind

```cpp
namespace {


} // namespace
```
Residue of removed code in a 67-line file. Trivial, but it is the marker for M6.

---

## 5. PLAYER-ONLY PATHS

**Good news: the documented `needs`-is-player-only defect is FIXED.** `needs_step`
(needs.cpp:267-353) sweeps `view<const NpcRef, const Transform>` on the layer with no player
branch; `camera` is only used to choose the seed roll (`needs_roll` vs `needs_roll_resident`,
needs.cpp:283) and to decide whose numbers land in the HUD report (needs.cpp:321-327).

Remaining player-only paths, all real:

| System | Player-only gate | Evidence |
|---|---|---|
| `RpgStats` | Only the camera holder ever has one | `emplace_or_replace<RpgStats>` only at main.cpp:5011, and `embody_as_player` |
| `PlayerStatus` / `status_step` | main.cpp:3340, explicitly `playerStatus` | one status machine for one body |
| `wander_step` mob aggro | `haveVictim` = camera holder, at full 20 m; crowd only via `hunt` at ≤6 m and 1-in-32 licence | wander.cpp:151-167, 277-296 |
| `faction_feud_step` damage | crowd damage floored at `hp-1`; **only the camera holder is killable** | faction_relations.cpp:~365, main.cpp:3925 comment |
| `speech` / `rumour` / `contract` / `quest` | all keyed on `nearest_speaker` **relative to the camera holder** | rumour.cpp `nearest_speaker` |
| `sync_armour` for NPCs | `ai_equip_step` writes `Equipped` for `AiBrain` bodies; the player's is written only by console `equip` | ai.cpp:1046-1048 comment, verified |

The asymmetry that matters for the "few general systems" goal: **monsters are excluded from
every people-system by type** (`ai_init` skips `MobRef`, ai.cpp:562; `ai_step` skips it,
ai.cpp:664; `needs_step` views `NpcRef` so mobs are invisible; `nearest_prey` notes
"Monsters carry no NpcRef", hunt.cpp:39). A monster is not an alife record. That is the
single largest structural special case in the subsystem.

---

## 6. AUTHORSHIP

Commits touching the 32 in-scope files (+ the two generated tables): **46 `marko1olo` / 46
`Jirnyak` / 0 `Петушков А.`** (Петушков has 55 commits repo-wide, none in this subsystem).

**Modules whose ADDING commit was marko's — 13 of 19 files:**

| File | Added by | Commit |
|---|---|---|
| `wander.cpp` | **marko1olo** | cccb57ad |
| `mob_behaviour.cpp` | **marko1olo** | 5badfb16 |
| `mob_spawn.cpp` | **marko1olo** | 3803aacb |
| `mob_table.cpp` | **marko1olo** | 1be3339e |
| `monster_traits.cpp` | **marko1olo** | 6b75c984 |
| `monster_traits_table.cpp` | **marko1olo** | 6b75c984 |
| `needs.cpp` | **marko1olo** | e6ef0311 |
| `hunt.cpp` | **marko1olo** | 6a0c61ce |
| `faction_relations.cpp` | **marko1olo** | 229b85f5 |
| `rpg.cpp` | **marko1olo** | e22f8a41 |
| `speech.cpp` | **marko1olo** | a7f1e217 |
| `speech_table.cpp` | **marko1olo** | a7f1e217 |
| `rumour.cpp` | **marko1olo** | dbae4d29 |
| `ai.cpp` / `ai.h` | Jirnyak | 6a075223 |
| `npc_pool.*`, `population.cpp`, `embody.cpp` | Jirnyak | 387212eb (initial import) |
| `macro_sim.*` | Jirnyak | 73624958 |

**Per-file marko dominance** (commits by author):
`wander` 15 marko / 2 Jirnyak · `macro_sim` 7/7 · `faction_relations` 6/7 ·
`mob_behaviour` 4 marko / 1 Jirnyak · `rumour` 4/3 · `npc_pool` 7 marko / 10 Jirnyak ·
`mob_spawn` 6/6 · `ai` 4 marko / 15 Jirnyak.

**Correlation worth stating plainly:** every one of the four worst dead-data clusters —
`monster_traits` (8/12 columns dead), `mob_behaviour`'s 22 inert enumerators, `mob_table`'s
4 zero-reference nav columns, and `rpg`'s 6 dead helpers — sits in a file marko introduced.
`ai.cpp`/`ai.h` and `macro_sim` (Jirnyak-added) have dead data too, but of the "stubbed input
awaiting a producer" kind rather than the "authored table nobody wired" kind.

---

## 7. BLOAT — the comment problem is a maintenance finding

| File | lines | comment lines | code lines | comment % |
|---|---|---|---|---|
| `mob_behaviour.h` | 866 | **761** | **71** | **87%** |
| `hunt.h` | 164 | 135 | 19 | 82% |
| `monster_traits.h` | 484 | 381 | 72 | 78% |
| `rumour.h` | 258 | 200 | 42 | 77% |
| `faction_relations.h` | 341 | 237 | 73 | 69% |
| `wander.h` | 135 | 94 | 29 | 69% |
| `speech.h` | 302 | 200 | 76 | 66% |
| `needs.h` | 408 | 260 | 113 | 63% |
| `macro_sim.h` | 367 | 228 | 104 | 62% |
| `npc_pool.h` | 650 | 404 | 187 | 62% |
| `ai.h` | 1070 | 647 | 343 | 60% |
| **all 32 files** | **13,915** | **6,077** | — | **43%** |

`mob_behaviour.h` is 866 lines of header for 347 lines of implementation containing 15
one-line `switch`es. This would not matter except that **the prose is measurably stale**:

- `mob_behaviour.h:625-637, 831-837` claims **"SEVEN dispatchers here have no caller in
  src/"** and names `behaviour_damage_mult`, `facing_damage_mult`, `burst_damage_mult`,
  `burst_speed_mult`. Verified today: **all four have live callers** — combat.cpp:864, :873,
  :880 and wander.cpp:355. The header is wrong in the *safe* direction, but a reader
  deleting on its word would break the build.
- `ai.h:72, 88, 330` and `wander.cpp:205` and `faction_relations.cpp:245` all say
  **"`ai_init` has no caller yet"**. It has three: main.cpp:1420, main.cpp:1980, and
  `ai_release` at floor_stream.cpp:391.
- `ai.h:214, 1062` say `MemFood/MemWater/MemRest/MemToilet` have **no producer**.
  `room_zone.cpp:140-146` is a producer.
- `ai.cpp:99-117` says `needs_step` **"seeds only the camera holder"**. needs.cpp:281-284
  seeds every body.
- `ai.h:33` says `slow_step` is **"NOT wired in main.cpp today"**. main.cpp:3937.
- `ai.h:838` says `AiConfig::enabled` **"DEFAULTS TO FALSE … the system is wired, tested and
  dormant"**, and main.cpp:2185-2190 repeats it in a comment immediately above
  `aiCfg.enabled = true;`. The AI has been live since that line landed.
- `npc_pool.h:227` says `attr_/age_/sex_/level_` are "written by seed_floor_from_spec, read by
  nothing". `level_` **is** read — `embody.cpp:113` `random_rpg(pool.level(id), id)`. The other
  three are indeed write-only.

That is eight load-bearing claims, all false, all in the files whose comment ratio is highest.
Every one of them describes a system as *less* wired than it is, which is the dangerous
direction: a cleanup pass that trusted the prose would delete live code.

---

## 8. DELETION PROPOSAL — ranked

### Tier A — DELETE OUTRIGHT, zero behaviour change

| # | What | Where | LOC (code) | LOC (+prose) |
|---|---|---|---|---|
| A1 | `MobDef::navStepSub/navClimbSub/navDropSub/navFly` + 4 CSV columns + generator lines | mob_table.h:187-197, mobs.csv, gen_mob_table.py:222-225 | 4 | ~15 |
| A2 | `AiFlag::Ranged/Boss/Rare/FoodBait/WaterStrider` + 3 CSV columns (`is_ranged`, `is_boss`, `rare`) | mob_table.h:68-76, gen_mob_table.py:161-166 | 5 | ~15 |
| A3 | 6 dead `mobs.csv` documentation columns (`ai_flags`, `n_ai_flags`, `n_rare_drops`, `has_loot_table`, `role`, `def_src`, `eco_src`) — never read by the generator | data/mobs.csv | 0 | 7 columns × 68 rows |
| A4 | `trait_move_mult`, `trait_damage_mult`, `trait_incoming_mult`, `trait_has_vulnerability`, `trait_takes_bait`, `trait_takes_bait_any`, `trait_allows_wet_spawn`, `monster_trait_authored_count`, `monster_traits_rows_indexed`, `monster_traits_unauthored_reason` + the 8 dead `MonsterTraits` columns + 8 CSV columns | monster_traits.{h,cpp}, monster_traits_table.cpp, monster_traits.csv | ~120 | **~700** |
| A5 | `behaviour_is_dead`, `behaviour_is_dispatched` (test oracles only) + their 60 lines of header essay | mob_behaviour.cpp:268-338, .h:600-660 | 70 | ~140 |
| A6 | `seed_floor_population` | population.cpp:233-246 | 15 | 18 |
| A7 | `ai_remember_actor`, `MemFoe`, `MemAlly`, `MemoryRecall::foe`, `MemoryRecall::grudge`, `Perception::grudge`, `apply_recall` grudge split, `mem_kind_is_actor` | ai.cpp:410-425, 457-468, 512-528; ai.h:419-432, 667, 741 | ~50 | ~90 |
| A8 | `AiMemory::live_traces` | ai.cpp:390-401 | 12 | 14 |
| A9 | `NpcPool::set_name`, `name()`, `surname()`, `name_`, `surname_` columns; `set_design`, `is_design`, `NpcDesign` | npc_pool.{h,cpp} | ~50 | ~70 |
| A10 | `NpcPool::attrs()` + `attr_` column + `kAttrSlots` + its seeding loop | npc_pool.h:534-535,597; population.cpp:206-210 | ~15 | ~25 |
| A11 | 6 dead rpg helpers (`str_durability_wear_mult_e3`, `int_contract_reward_mult_e3`, `int_document_reward_mult_e3`, `int_psi_duration_bonus_sec`, `adjusted_psi_cost`, `int_psi_cost_mult_e3`, `total_xp_for_level`) | rpg.{h,cpp} | ~70 | ~90 |
| A12 | `samosbor_fog_tick_at`, `despawn_layer_fog_mobs`, `count_layer_fog_mobs` | mob_spawn.{h,cpp} | ~55 | ~80 |
| A13 | `needs_survival_minutes` | needs.h:130 | 4 | 12 |
| A14 | The `// PARKED: needs_step` block | main.cpp:3139-3147 | 0 | 9 |
| A15 | Stale comment blocks proven false in §7 (8 claims) | ai.h, mob_behaviour.h, wander.cpp, faction_relations.cpp, npc_pool.h, main.cpp | 0 | ~140 |
| A16 | Empty anonymous namespace | hunt.cpp:13-16 | 4 | 4 |
| A17 | `wet` parameter of `placeable()` + the `fluid_at` test (§4.8) once A4 lands | mob_spawn.cpp:48-51 and its 3 call sites | ~10 | ~15 |
| | **Tier A total** | | **~485 code** | **~1,640 total** |

Tier A also removes **22 CSV columns** (7 mobs.csv doc columns + 4 nav + 3 flag + 8 traits).

### Tier B — DECIDE: wire it or delete it

| # | What | LOC at stake | The one-line decision |
|---|---|---|---|
| B1 | **Macro social graph** (macro_sim.cpp:556-616, `social_edge_*`, `rel_` 128 B/row) | ~200 | set `socialFormRatePerYear > 0` in main.cpp, or delete the pass, the accessors and the `rel_` column |
| B2 | **`Perception` samosbor fields** — main.cpp already holds the live `SamosborState` and passes it to two other systems | 3 lines to wire | wire `p.samosborActive/Warning`, or delete 6 scorer terms |
| B3 | **`rhythm`** (ai.cpp:185) + `minuteOfDay` | 8 scorer terms | there is no game clock; delete both, or build one |
| B4 | **`Perception` combat fields** (`visibleHostiles`, `threatDistance`, `hostilePower`, `allyPower`, `armed`, `cornered`) — `nearest_faction_foe` and `nearest_prey` already compute exactly these | ~15 lines to wire | wire from the existing scans, or delete `IntentCombat` and `IntentFactionAssault` |
| B5 | **`IntentSafety`** — a strictly weaker `IntentFlee` with identical steering | ~10 | merge into `IntentFlee` |
| B6 | **22 inert `MobBehaviour` enumerators** + their CSV assignments | 22 enum values, 22 CSV cells | fold to `Plain` in the CSV and delete the enumerators, or dispatch them |
| B7 | **`AiMemory::forget` never called with recycling ON** | 3 lines | call it from the death path — this is a live bug, not cleanup |
| B8 | **`resist_buckshot` / `resist_fire` / `resist_psi`** — no damage source produces them | 3 CSV columns, 3 bytes/row | delete, or add producers |
| B9 | **Vertical crowd navigation** (§4.7) — one `&&` in wander.cpp:411, reimplemented twice in ai.cpp | 3 fallback branches | the biggest behavioural win available; also the prerequisite for M3 |
| B10 | **`CREATOR` / `PSEUDOLIFT`** (§3.4b) — 2 authored monsters, `spawn_weight 0` | 2 CSV rows | give them a weight, or delete the rows |
| B11 | **Monster armour** (§3.4c) — 67 of 68 rows are all-zero | 1 live row | author more rows, or delete `sync_monster_armour` + `resist[]` and let `trait_counterplay_damage` carry monster defence alone |

### Tier C — MERGE (structural, the owner's actual goal)

| # | Merge | Removes | Est. LOC |
|---|---|---|---|
| M2 | One `SteerFrame` (gravity regime + tangent) built per tick, passed to all steerers — kills 4 copies of the tangent lambda and 3 of the regime resolve | copy-paste | −60 |
| M3 | One `flow_step_to_dir(fine, node, cell, pos, frame)` — kills 4 copies of "aim at next cell centre, else fall back to the target column" | copy-paste | −120 |
| M1 | **The big one.** Collapse `ai_step` / `ai_patrol_step` / `wander_step` / `investigate_step` / `faction_feud_step` into one `locomotion_step` driven by a list of pure goal providers `(entity, ctx) -> optional<Goal{dir,speed,priority}>`. Deletes `MotionOwner`, `ai_owns_motion`, the two `continue` guards, the order dependency, and the "5 systems write Velocity" problem | the whole arbitration layer | −250 code, −500 prose |
| M4 | Fold surviving `monster_traits` (armour + counterplay + wet regen) into `mob_table`/`mob_behaviour`; delete the third per-kind table | one file | −250 |
| M5 | One `nearest_speaker` per tick fanned to speech/rumour/contract/quest (3 of 4 already share one) | duplicate O(n) sweep | −15 |
| M6 | Fold `hunt.{h,cpp}` (67 + 164 lines, 62 lines of actual code) into `wander.cpp` — its only two consumers are wander.cpp:277,289 and combat.cpp:824 | one file pair | −140 prose |
| M7 | Fold `population.cpp` (1 live function) into `floor_stream.cpp`, its only caller | one file pair | −40 |

### Tier D — KEEP

`npc_pool` (the record store — correct design, just over-columned), `macro_sim`'s
demographic passes (aging/mortality/births/migration — all live and wired),
`embody` (clean seam), `needs` (fixed, crowd-wide, correct), `speech`+`speech_lines.csv`
(0 dead columns — the cleanest table in scope), `rumour` (pure function, no state),
`faction_relations` matrix (live, moved by `relations_drain_deaths`), `mob_behaviour`'s
20 dispatched behaviours, `hunt`'s rate-control design (the arithmetic in hunt.h:1-46 is
sound), `AiMemory`'s cell family (real producers, real readers).

### Total removable

- **Tier A alone: ~485 lines of executable code and ~1,640 lines total**, with zero
  behaviour change, plus **22 dead CSV columns** (7 `mobs.csv` documentation columns,
  4 nav, 3 flag, 8 `monster_traits.csv`).
- **Tier A + C merges: ~1,300 lines of executable code and ~3,000 lines total** out of
  13,915 — roughly **21%** — and it removes 3 of the 5 competing steering systems and one
  of the three per-`MobKind` tables.
- Tier B is a set of decisions, not an estimate; B1 alone is ~200 LOC and a 128 MiB column,
  and B9 (vertical navigation) is the one item on the list that would change how the game
  plays rather than how it reads.

### The three sentences worth acting on first

1. **`monster_traits` is 8/12 dead columns, 10/15 dead functions, and its own source says it
   duplicates `mob_behaviour`** (monster_traits.cpp:191-199). Delete it down to armour +
   counterplay + wet-regen, or fold those three into `mob_table`. Biggest single win.
2. **Five systems write `Velocity` and are separated by three different mechanisms.**
   M1/M2/M3 turn that into one writer and a list of pure goal providers, which is exactly the
   "few general systems that compose" shape.
3. **`AiMemory::forget` has no caller while `pool.set_recycling(true)` is on** — that is a
   live bug hiding inside a cleanup audit. Three lines.
