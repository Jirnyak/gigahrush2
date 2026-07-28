# Monsters — Global monster tables

> **Status: design, not yet built.** Game layer (`src/app/`), on top of the ECS
> ([ecs.md](ecs.md)) and fields ([fields.md](fields.md)).

Monster definitions are a **single global table** shared by every floor. A floor
never redefines a monster — it only adjusts *how likely* each one is to appear
via its rule-set ([floors.md](floors.md)).

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## Model (planned)

- **Global monster table** — data-driven rows: stats, behavior tags, loot-table
  refs ([items.md](items.md)), base spawn weight. Adding a monster = one row,
  never an engine branch (see [AGENTS.md](AGENTS.md) data-driven rule).
- **Per-floor spawn weights** — a floor's rule-set supplies **multipliers** over
  the global weights (and population-matrix tweaks), so the same table yields a
  different mix per floor without duplicating monster data.
- **Instantiation** — monsters become ECS entities with the universal components
  ([ecs.md](ecs.md)) plus game components (health, faction, AI). They move via
  the same [controller.md](controller.md) / [physics.md](physics.md) systems as
  any other entity — no special-case monster mover.

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
