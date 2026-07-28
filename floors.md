# Floors — Modules on the level stack

> **Status: design, not yet built.** This is the planned game layer on top of
> the engine. The engine provides the substrate ([world.md](world.md)); the
> module system, floor-number indirection, elevators, and rule-sets described
> here are the next thing to implement in `src/app/` (the game layer), **not**
> in `giga_core`.

A **floor is a module**: a chartered, self-contained unit that owns one 128³
world plus everything specific to that floor — geometry, quests, NPCs, mechanics,
and its own **rule-set** (spawn-weight multipliers, population-matrix tweaks,
gravity overrides). The engine's `128³` grid is only its spatial substrate.

- **Substrate:** [world.md](world.md) (`LevelStack`, `World`)
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## Core distinction — storage slot ≠ floor number

Three separate identifiers, deliberately decoupled:

| Concept | What it is | Mutable? |
|---------|-----------|----------|
| `LayerId` | Raw storage slot in `LevelStack` | Engine-managed |
| `ModuleId` | Stable identity of a loaded module (its content) | Fixed per module |
| **Floor number** | In-game label the macro-system assigns to a module | **Yes — reassignable at runtime** |

A floor's number is **not** hardcoded in the module. The module ships with no
number; the macro-system assigns "this module is floor N". Elevators travel to a
*number*, which resolves through `floor number → ModuleId → LayerId`. Because
that mapping is data, floors can be **renumbered or reshuffled mid-game** without
touching module content. Design everything against the number-indirection, never
against `LayerId`.

```
elevator target (floor number)  ──►  FloorRegistry  ──►  ModuleId  ──►  LayerId (resident world)
                                      (remappable at runtime)
```

## Layout

- Floors occupy an array indexed roughly **−127 … 127**, **sparsely populated** —
  not every slot is filled; modules load/unload on demand.
- Game starts at floor **0**. Adjacent travel (`±1`) via elevators reaches −1 /
  +1. See [elevators.md](elevators.md) for the `8×8` fast-travel grid.
- W does not wrap ([world.md](world.md)); floors have a genuine top and bottom.

## Global vs. local — the rule-set boundary

**Global (engine-wide singletons), shared by all floors:**

- Monster tables ([monsters.md](monsters.md))
- Loot tables ([items.md](items.md))
- Macro NPC population model ([macrosim.md](macrosim.md), [npcs.md](npcs.md))

**Local (per-module rule-set), layered on top — never redefines the tables:**

- Spawn-weight **multipliers** over the global monster/loot tables
- Population-**matrix** weight tweaks
- Floor-specific geometry, quests, NPCs, mechanics
- Optional gravity `region` override ([gravity.md](gravity.md)), fluid seeding,
  custom fields ([fields.md](fields.md))

A module contributes *modifiers*; it does not fork the global data. This keeps
balance centralized while letting each floor feel distinct.

## Planned shape (illustrative, not final)

```
struct Module {
    ModuleId    id;
    World       world;          // the 128³ substrate for this floor
    RuleSet     rules;          // weight multipliers, gravity/fluid overrides
    // + content: geometry generator, quest defs, NPC/spawn tables (local refs)
};

struct FloorRegistry {
    // number → module, remappable at runtime; sparse over [-127, 127]
    // resolves an elevator's target number to a resident World/LayerId
};
```

## Open questions (resolve when implementing)

- Module load/unload lifecycle and streaming (tie into [world.md](world.md)
  planned streaming seam).
- Serialization of the number→module mapping across saves.
- How reshuffling interacts with entities mid-transition between floors.

## Connections

Built on [world.md](world.md); consumes global [monsters.md](monsters.md) /
[items.md](items.md) / [macrosim.md](macrosim.md); reached via
[elevators.md](elevators.md); may install [gravity.md](gravity.md) /
[fields.md](fields.md) overrides.
