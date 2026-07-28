# Monsters — Global monster tables

> **Status: the table and the per-floor budgets are BUILT
> ([src/game/mob_table.h](src/game/mob_table.h)); spawning is not.** It lives in
> `giga_game` (`src/game/`), never `src/app/` — [AGENTS.md](AGENTS.md) requires
> gameplay macro-systems to link `giga_core` without SDL/Vulkan/ImGui so they stay
> headless-testable via `game_test`. Built on the ECS ([ecs.md](ecs.md)) and fields
> ([fields.md](fields.md)).

Monster definitions are a **single global table** shared by every floor. A floor
never redefines a monster — it only adjusts *how likely* each one is to appear
via its rule-set ([floors.md](floors.md)).

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## The table (built)

**69 monster kinds**, ported from the TypeScript reference. Note that number: this
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
- **`MobDef` is a 32-byte POD row**, widest-first so there is no interior padding,
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

## Not yet built

- **Spawning.** Placement, pack resolution, and the room/floor mask pick.
- **Loot.** 66 of the 69 kinds have *no* loot table in the reference — they drop at
  most one rare item. That is a real content hole inherited from the reference, not
  a porting gap.
- **Instantiation** — monsters become ECS entities with the universal components
  ([ecs.md](ecs.md)) plus game components (health, faction, AI). They must move via
  the same [controller.md](controller.md) / [physics.md](physics.md) systems as any
  other entity — no special-case monster mover.
- **Respawn** does not exist in the reference and is forbidden by its
  `ecology.md`; a killed monster is gone for the visit.

## Global vs. local (the boundary)

| Global | Per-floor (rule-set) |
|--------|----------------------|
| Monster stat/behavior definitions | Spawn-weight multipliers |
| Base spawn weights | Population-matrix tweaks |
| Loot-table associations | Optional floor-only additions |

## Connections

Drops loot from [items.md](items.md). Population governed by
[macrosim.md](macrosim.md) / [npcs.md](npcs.md). Weight modifiers come from
[floors.md](floors.md). Runs on [ecs.md](ecs.md) systems.
