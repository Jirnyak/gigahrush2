# Monsters — Global monster catalog

> **Сверка 2026-08-23:** «needs тикает только носителя камеры» — ЛОЖЬ:
> `needs.h:271` двигает часы КАЖДОГО воплощённого тела (`NeedsTick.bodies/
> recovering/crowdKilled`), room-recovery через `kRoomRecovery`. Видов 68
> (`data/mobs.csv`), не 69. Труп любого — RagdollRoll-проп с контейнером
> (S3/S14, v17). `RoomBit`-фильтры (`MobDef::roomMask`) приговорены S12.2
> (вида комнаты не существует) — уйдут с rooms-object.

> **Status: catalog BUILT and generated from data; per-floor budgets BUILT; spawning
> BUILT and room-aware.** It lives in `giga_game` (`src/game/`), never `src/app/` -
> [AGENTS.md](AGENTS.md) requires gameplay macro-systems to link `giga_core` without
> SDL/Vulkan/ImGui so they stay headless-testable via `game_test`. Built on the ECS
> ([ecs.md](ecs.md)) and fields ([fields.md](fields.md)), on top of the item catalog
> ([items.md](items.md)).
>
> - **Code:** [src/game/mob_table.h](src/game/mob_table.h) /
>   [.cpp](src/game/mob_table.cpp) (generated) - spawning:
>   [src/game/mob_spawn.h](src/game/mob_spawn.h)
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp) `test_mob_table`,
>   `test_mob_spawn`, `test_mob_budget_v_shape` (headless, link `giga_game` only)
Monster definitions are a **single global table** shared by every floor. A floor
never redefines a monster — it only adjusts *how likely* each one is to appear
via its rule-set ([floors.md](floors.md)).

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## The table (built)

**68 monster kinds**, ported from the TypeScript reference. Note that number: this
doc, and the reference's own `balance.md` and `ecology.md`, previously claimed
"~90" and "67". 69 is what the reference's `enum MonsterKind`, `MONSTERS`,
`MONSTER_SPRITES` and `MONSTER_ECOLOGY` all agree on, gaplessly, with zero orphans
either way. Two kinds its designer table omits (`SCULPTURE`, `GNOME`) exist in code
and are included.

- **Source of truth is [data/mobs.csv](data/mobs.csv).** Adding a monster is one
  row plus `python tools/gen_mob_table.py`, which regenerates
  `src/game/mob_table.cpp`. The generator is deliberately *not* wired into CMake —
  the generated file is committed, so the build needs no Python — and it hard-fails
  on an unknown token rather than silently mapping it to a default.
- **`MobDef` is a 44-byte POD row**, widest-first so there is no interior padding,
  with the six fields the tick reads in the first 14 bytes. The whole table is
  2,208 B and permanently cache-resident. Fractional reference values (speed 3.15,
  attackRate 0.24) are fixed-point, so the table is bit-identical across builds.
- **AI flags are split, not faithfully copied.** The reference declares 52 distinct
  `aiFlags` strings but only **four** are carried by more than one monster; the
  other 47 are per-kind bespoke scripts wearing a bitmask costume, and 14 of them
  have no flag reader at all (dispatched by `monsterKind ===` instead). A 51-bit
  mask would not fit `uint32_t`, would put 47 permanently-dead bits in every row,
  and would make AI dispatch 51 branch tests per tick. So `AiFlag` carries the four
  shared bits plus four structural ones (Ranged/Boss/Rare/Immobile), and the
  singletons become one `MobBehaviour` id — a jump table. 23 of 69 kinds are
  `Plain`.

## Per-floor budgets — the V-shape (built)

**Danger is V-shaped about the hub, not monotonic with depth.** Floor 0 is the safe
living hub; hostility rises in *both* directions — the roof (+) is
crowded-but-weak, the hell/void (−) crowded *and* elite. Three knobs:

| Knob | Driven by | Where |
|---|---|---|
| **COUNT** | `\|floor\|` alone, trimmed by theme and danger | `mob_count_for_floor` |
| **LEVEL** | `f(\|floor\|) + danger`, clamped | `mob_level_for_floor` |
| **danger 1–5** | authored per floor | `FloorSpec::hostility` |

These are the reference's own shipped formulas, not a reinvention — it already
implements the V-shape on a signed axis of ±50. Two honest caveats:

- **LEVEL currently tops out at 11, not 12.** The floor curve maxes at
  `1 + 8 + (5-1)·0.55 = 11.2`. The reference reaches 12 only via a per-zone bonus,
  and gigahrush2 has no zones yet.
- **HP scaling uses `base · (1 + 0.12·(L−1))`.** The reference has two disagreeing
  curves; this is the one its `balance.md` documents, and it keeps a level-1
  monster at exactly its authored base HP.

## Spawning and melee (built)

- **`spawn_floor_mobs`** ([src/game/mob_spawn.h](src/game/mob_spawn.h)) builds a
  floor's roster from every row whose `floorMask` includes this floor's nearest
  signed anchor and whose spawn weight is nonzero — which correctly excludes the
  hand-placed kinds (`CREATOR` and `PSEUDOLIFT` carry weight 0). Placement is
  rejection sampling for air on the internal ground storey. Deterministic per
  (floor, seed), so a floor looks the same every visit.
- **Aggro and pursuit** ([src/game/wander.h](src/game/wander.h)): inside 20 m a mob
  abandons the baked flow field and closes on the camera holder directly. Outside
  it, mobs wander the nav lattice like anyone else.
- **Predation on the crowd** ([src/game/hunt.h](src/game/hunt.h)) — monsters hunt
  residents, and the design is the **rate**, not the targeting. Scarcity of hunters is
  the whole restraint: the camera holder outranks the crowd inside 6 m, the hunting
  radius is 6 m against the 20 m player aggro, and only **1 monster in 32** holds a
  hunting licence at any moment — a pure hash of (entity id, 20 s epoch), so there is
  no hunt state anywhere and the steering and attack passes cannot disagree about the
  target. `test_hunt_all` measures the outcome instead of asserting it: on floor 15
  (420 residents, 593 monsters at level 3) ten simulated minutes leave **361
  survivors, 59 dead, 14%**. The steady-state toll is 1-3 a minute at *any* licence
  density, because once the initially co-located bodies are eaten predation is limited
  by how often a monster and a resident meet — so the licence density mostly sets how
  hard the first minute after a floor loads bites. A monster's projectile can hit a
  resident too (`Projectile::team == 0`); without that a ranged hunter telegraphs and
  fires forever with nothing to show, because every ranged kind's minimum shot range
  starts inside the 6 m hunting radius while its 2.4 m melee reach does not cover it.
- **Melee** ([src/game/combat.h](src/game/combat.h)) is shaped around three defects
  found in the reference, each now impossible rather than merely absent: **one**
  damage function that reports what it *applied* (the reference leaked pre-armour
  damage into the kill feed while HP took the mitigated value), **one** death
  finalizer that publishes before destroying (the reference could cull an entity
  before its loot/quest hooks ran — a P0 its own `balance.md` documented), and
  **one** cooldown decrement (the reference had ~60, several as `max()` floors, so
  some monsters out-attacked their own authored rate).
- **Death is not a special case.** The player is whatever entity holds a
  `CameraTag` ([npcs.md](npcs.md)), so dying means losing it and gaining it
  elsewhere — you wake up as another resident of the same floor. The building
  carries on.

Immobile kinds (the four with speed 0 — `IDOL`, `BORSHCHEVIK`,
`KANTSELYARSKIY_IDOL`, `BLOOD_PLANT`) get no gravity and no wander target: they are
architecture, not bodies in it.

## Not yet built

- **The crowd fighting back.** Predation is one-directional: monsters hunt residents
  ([hunt.h](src/game/hunt.h), above), and residents walk past the carnage without
  fleeing, defending each other, or attacking monsters. NPC-on-monster and NPC-on-NPC
  combat needs a threat model per body, which is the next increment, not this one.
  Nothing heals a crowd body either — [needs.h](src/game/needs.h) ticks the camera
  holder's row alone — so a resident that survives a hunt stays wounded forever.
- **Loot.** 65 of the 68 kinds have *no* loot table in the reference — they drop at
  most one rare item. That is a real content hole inherited from the reference, not
  a porting gap.

**BUILT since this list was written** (do not re-implement — verified 2026-08-06):

- **Ranged attacks.** The 13 `Ranged` kinds honour `shotRangeMm` / `minRangeMm` /
  `windupMs`: outside the dead zone a mob telegraphs, then `spawn_projectile`
  (`combat.cpp`) puts a real projectile in flight.
- **`MobBehaviour` dispatch — the stateless half.** `frozen_by_gaze` really does
  freeze a `WeepingAngel` under your gaze (`mob_behaviour.cpp`, called from
  `wander_step`), and the aggro-radius / pursuit-offset / move-mult / burst-phase
  hooks are live. **27 of the 47 enumerators still read as `Plain`**, each blocked
  on one named missing piece.
- **Armour.** Two populators — `sync_monster_armour` (from `monster_traits.csv`,
  called by `main.cpp`) and the equip path in `combat.cpp` — feed one mitigation
  point in `apply_damage`.
- **Pack resolution.** `mob_spawn.cpp` branches on `MobPackMode`; only the
  samosbor fog spawner deliberately ignores it.
- **Instantiation.** `mob_spawn.cpp` creates the entity with `MobRef`/`MobCombat`
  plus the universal components ([ecs.md](ecs.md)); movement goes through the same
  [physics.md](physics.md) systems as any other entity — no special-case mover.
- **Respawn** does not exist in the reference and is forbidden by its
  `ecology.md`; a killed monster is gone for the visit.
## Global vs. local (the boundary)

| Global | Per-floor (rule-set) |
|--------|----------------------|
| Monster stat/behaviour definitions (built) | Spawn-weight multipliers |
| Base spawn weights + rarity gate | Count / tier (depth + danger) |
| aiFlags behaviour families | Optional floor-only nudges |

## Loot on death (built, #13c)

Each kind's death drops are **data**, in a parallel `MobLoot` table keyed by the
same `MobKind` ([loot_table.h](src/game/loot_table.h), [items.md](items.md)):
`rareDrops` (first-hit-single, player-kill-gated) + `lootTable` (independent
rolls, cap 3, on three kinds). `roll_mob_loot(kind, seed, killerIsPlayer)` decides
the drops deterministically; #13d spawns them as ground entities.

## Connections

Drops loot from [items.md](items.md) via [loot_table.h](src/game/loot_table.h).
Population governed by [macrosim.md](macrosim.md) / [npcs.md](npcs.md). Weight
modifiers come from [floors.md](floors.md). Runs on [ecs.md](ecs.md) systems.
