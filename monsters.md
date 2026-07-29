# Monsters — Global monster catalog

> **Status: catalog built (#13b); per-floor spawning pending (#13d).** Game layer
> (`src/game/`, the `giga_game` library), on top of the ECS ([ecs.md](ecs.md)) and
> the item catalog ([items.md](items.md)).
>
> - **Code:** [src/game/mob_table.h](src/game/mob_table.h) /
>   [.cpp](src/game/mob_table.cpp)
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp) `test_mob_table`
>   (headless, links `giga_game` only)

Monster definitions are a **single global table** shared by every floor. A floor
never redefines a monster — it only adjusts *how likely* each one is to appear
via its rule-set ([floors.md](floors.md)).

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## Global monster catalog (built)

The catalog is one flat table of POD `MobDef` rows — the **same data-oriented
stance** as the item catalog ([item_table.h](src/game/item_table.h)) and
`FloorSpec` ([floors.md](floors.md)): a mob's stats, behaviour and spawn weight
are **data, never a code branch**. **Array index IS the kind** (the numeric
`MobKind`), exactly as an `ItemId` indexes the item table — but with **no
reserved 0 sentinel**: kind `0` is a real mob (the weakest), because a mob id,
unlike an inventory slot, never needs an "empty" value. Ported from the reference
(`../gigahrush`): stats from `src/entities/*.ts`, spawn/rarity from
`src/data/monster_ecology.ts`. A **faithful representative span** today — every
behaviour archetype — grown toward the full 69-kind set by pure data edits.

Each `MobDef` row carries:

- **`name`** — the reference kind key (`"gnome"`, `"betonnik"`) for HUD/debug and
  loot/spawn authoring; `mob_kind("gnome")` resolves it back (cold path).
- **`hp` / `dmg`** — base hit points and attack damage (level-1 values).
- **`speed`** (cells/sec; `0` = immobile turret/plant) / **`attackRate`** (seconds
  between attacks).
- **`ranged` / `projSpeed` / `projType`** — ranged kinds shoot a projectile
  (`ProjNormal/Grenade/Flame/Bfg/Beam/Web`); melee kinds set `ranged = false` and
  ignore the projectile fields (a table invariant asserts `ranged ⇔ projSpeed>0`).
- **`aiFlags`** — a `MobAiFlag` bitmask (see below), the behaviour driver.
- **`spawnW` / `minSamosbor` / `rare`** — the ecology gate: base weight in the
  weighted pool (`0` = never pool-spawned, e.g. bosses), the minimum samosbor
  (self-assembly wave) count to be eligible, and rare/elite/boss gating.

### Behaviour flags (`MobAiFlag`)

A bitmask compressing the reference's ~52-flag `aiFlags` union into the
**structural families** the mob AI branches on: `AiMelee`, `AiFlying`,
`AiPhasing`, `AiRanged`, `AiPack`, `AiSwarm`, `AiRooted`, `AiAmbush`,
`AiWallBias`, `AiFoodBait`, `AiWaterStrider`, `AiArmored`, `AiHost`, `AiSpawner`,
`AiGrowth`, `AiLightLock`, `AiWeepingAngel`, `AiBoss`. A kind ORs the tags it
carries; per-flag fidelity grows as each consuming system lands. (This is why it
is a *compression*, not the raw 52-flag set — a flag exists here once something
reads it.)

### Per-level stat scaling

Base stats are level 1. The inline helpers apply the reference `rpg.ts` curve at
spawn time — `mob_scaled_hp` (+12%/level), `mob_scaled_dmg` (+10%/level),
`mob_scaled_speed` (+2%/level), linear off the base with `Math.round` semantics
(done without `<cmath>`). #13d picks the level from floor depth + danger (the
confirmed V-shape tier formula, `master_prompt.md` §4).

Mobs are **NOT alife records** — they never live in `NpcPool` ([npcs.md](npcs.md)).
A `MobDef` is a *template*: #13d spawns per-floor ECS entities from it (scaled by
level) that vanish when the floor de-embodies.

## Model — per-floor spawning (planned, #13d)

- **Instantiation** — a mob becomes an ECS entity with the universal components
  ([ecs.md](ecs.md)) plus game components (health, faction, AI). It moves via the
  same [controller.md](controller.md) / [physics.md](physics.md) systems as any
  other entity — no special-case monster mover.
- **Per-floor spawn weights** — a floor's rule-set supplies **multipliers** over
  the global `spawnW` (and count/tier from the V-shape design-path formulas), so
  the same table yields a different mix per floor without duplicating mob data.
- **Wiring** — spawn on floor embodiment, despawn on de-embodiment, through
  `floor_stream` ([floors.md](floors.md)).

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
