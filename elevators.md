# Elevators — Floor traversal & fast travel

> **Status: design, not yet built.** Game layer (`src/app/`), on top of
> [floors.md](floors.md) / [world.md](world.md).

Elevators are how entities move along **W** — between floors. Because W does not
wrap ([world.md](world.md)), travel is bounded by the top and bottom of the
stack.

- **Substrate:** [world.md](world.md) (`above`/`below`), [floors.md](floors.md)
  (number indirection)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## Two travel modes

- **Adjacent (`±1`).** Ordinary elevators/lifts move one floor at a time. From
  floor 0 you reach −1 or +1. Maps to `LevelStack::above` / `below` after
  resolving the target floor **number** to its module.
- **Fast travel — `8×8` grid.** A grid of fast-travel destinations lets an
  entity jump directly to a chosen floor number, skipping intermediate floors.

## Elevators target *numbers*, not slots

An elevator stores a destination **floor number**. At use time the game resolves
`number → ModuleId → resident LayerId` through the `FloorRegistry`
([floors.md](floors.md)). If floors have been renumbered/reshuffled, the same
elevator naturally leads to whatever module now holds that number — the elevator
definition never changes.

## Transition mechanics (to design)

- Where the entity lands on the destination floor (fixed spawn, mirrored x/y,
  nearest walkable).
- Handling a target number that currently maps to no loaded module (trigger
  streaming/load, or block travel).
- Gravity/rule changes on arrival ([gravity.md](gravity.md),
  [floors.md](floors.md) rule-set).

## Connections

Drives navigation over [world.md](world.md); resolves through the
[floors.md](floors.md) registry. Moves entities' `Transform::layer`
([ecs.md](ecs.md)).
