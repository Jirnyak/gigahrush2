# Items & Loot — Global item catalog & loot tables

> **Status: item catalog built (#13a); loot tables pending (#13c).** Game layer
> (`src/game/`, the `giga_game` library), on top of the inventory
> ([inventory.h](src/game/inventory.h)) and the embodied needs ([ai.md](ai.md)).
>
> - **Code:** [src/game/item_table.h](src/game/item_table.h) /
>   [.cpp](src/game/item_table.cpp)
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp) `test_item_table`
>   (headless, links `giga_game` only)

Item definitions and loot tables are **global**, shared by every floor. Floors
adjust drop likelihood through their rule-set ([floors.md](floors.md)); they do
not fork the item catalog.

- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4

## Global item catalog (built)

The catalog is one flat table of POD `ItemDef` rows — the same data-oriented
stance as `FloorSpec` ([floors.md](floors.md)) and the faction matrix
([macrosim.md](macrosim.md)): an item's identity, worth and effect are **data,
never a code branch**. **Array index IS the id**, exactly as an `NpcId` is its
pool slot; an inventory slot ([inventory.h](src/game/inventory.h)) stores that
`uint16` id and id `0` is the empty/none sentinel. Ported from the reference
(`../gigahrush`, `src/data/items.ts`): a faithful representative span today
(every `ItemType`, every use-effect archetype), grown toward the full set by
pure data edits.

Each `ItemDef` row carries:

- **`type`** (`ItemType`: Food/Drink/Medicine/Weapon/Tool/Key/Note/Misc/Ammo —
  numeric values are load-bearing, matching the reference ordinal).
- **`name`** — the reference string key (`"bread"`, `"ak47"`) for HUD/debug and
  loot resolution; `item_id("bread")` resolves it back to the id (cold path).
- **`value`** (rubles — the economy axis and loot value-gate), **`spawnW`** (base
  spawn weight), **`stack`**, **`durability`**.
- **`resist[5]`** — armor mitigation percent per `DamageType`
  (Kinetic/Buckshot/Energy/Fire/Psi); 0 on non-armor.
- **`tags`** — an `ItemTag` bitmask (Weapon/Ranged/Melee/Ammo/Armor/Consumable/
  Food/Drink/Medicine/Tool/Key/Contraband/Valuable/Craft/Science/Quest), the set
  loot placement, the economy and the AI branch on.
- **`science` / `contraband` / `deceptive`** — quest/economy scores.
- **`use`** — a `UseEffect` (see below).

Weapon **combat** stats (damage, range, magazine, ammo type) are deliberately a
**separate registry** keyed by the same id — they land with combat, exactly as
the reference splits `ItemDef` from weapon stats. The catalog only marks weapons
by `type` + `TagWeapon`/`TagRanged`/`TagMelee` and their `value` for now.

### Use-effects close the digestion loop

The reference stores `use` as a closure; a closure is not data and cannot sit in
a static table or serialise, so each is re-encoded as the **deltas it applied** —
a flat `UseEffect { dFood, dWater, dSleep, dHp, dPsi, dPendingPoo, dPendingPee,
transformOutput, transformCount }`, with products **baked at authoring time**
(reference `feed(15)` → `dFood 15`, `dPendingPoo 10.5`, `dPendingPee 4.5`).

`apply_use_effect(needs, hp, maxHp, def)` applies one row in place: reserves
clamp to `[0,100]`, hp clamps to `[0,maxHp]`, and the **pending pools are exactly
the ones `needs_step` ([ai.md](ai.md) #12a) digests into pee/poo pressure** — so
eating here *closes the digestion loop the needs system already models*. `dPsi`
is stored but not applied (no psi stat yet — the same stubbed-input stance as the
scorer). It returns the id the item transforms into (`0` = fully consumed).

## Model — loot (planned, #13c)

- **Two death-drop mechanisms** (reference-confirmed): a `rareDrops` list present
  on ~every monster kind (first-hit single roll), and a richer `lootTable`
  (independent per-entry rolls, capped at 3 stacks) on only a few kinds. Both key
  drops by item id into this catalog.
- **Value-gated procedural pool** for NPC/container/merchant loot — a soft
  exponential gate on `value` over the whole catalog, weighted by `spawnW`, item
  type multipliers and `tags`.
- **Per-floor drop weights** — a floor rule-set supplies **multipliers** over
  global loot weights, never new item definitions.
- **Loot on the ground** is an ordinary entity with a `Transform` + inventory
  ([ecs.md](ecs.md)).

## Global vs. local

| Global | Per-floor (rule-set) |
|--------|----------------------|
| Item definitions (built) | Loot-weight multipliers |
| Loot table contents | Floor-specific rare-drop nudges |

## Connections

Consumed by the embodied [ai.md](ai.md) (eat/drink/heal intents); dropped by
[monsters.md](monsters.md); weighted by [floors.md](floors.md); carried via
[inventory.h](src/game/inventory.h) on [ecs.md](ecs.md) entities.
