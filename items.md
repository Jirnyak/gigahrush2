# Items & Loot — Global loot tables

> **Status: design, not yet built.** Game layer (`src/app/`).

Item definitions and loot tables are **global**, shared by every floor. Floors
adjust drop likelihood through their rule-set ([floors.md](floors.md)); they do
not fork the item catalog.

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## Model (planned)

- **Global item catalog** — data-driven rows: item type, stats, stack rules,
  value. One row per item, no engine branch.
- **Global loot tables** — weighted drop sets referenced by monsters
  ([monsters.md](monsters.md)) and containers. Shared across floors.
- **Per-floor drop weights** — a floor rule-set supplies **multipliers** over
  global loot weights (e.g. a floor biased toward a material), never new item
  definitions.
- **Inventory** — item ownership is ECS component data on entities
  ([ecs.md](ecs.md)); loot on the ground is an entity with a `Transform`.

## Global vs. local

| Global | Per-floor (rule-set) |
|--------|----------------------|
| Item definitions | Loot-weight multipliers |
| Loot table contents | Floor-specific rare-drop nudges |

## Connections

Dropped by [monsters.md](monsters.md); weighted by [floors.md](floors.md);
carried via [ecs.md](ecs.md) components.
