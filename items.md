# Items & Loot — Global item catalog & loot tables

> **Status: item catalog BUILT and generated from data; monster death-drop loot tables
> BUILT; value-gated procedural pool pending.** Game layer (`src/game/`, the
> `giga_game` library), on top of the inventory
> ([inventory.h](src/game/inventory.h)) and the embodied needs
> ([needs.h](src/game/needs.h)).
>
> - **Source of truth is [data/items.csv](data/items.csv)** - 446 rows. Adding an item
>   is one row plus `python tools/gen_item_table.py`, which regenerates
>   [src/game/item_table.cpp](src/game/item_table.cpp). The `source_rules` ctest
>   compares the csv row count against `kItemCount`, so a regenerated table and an
>   edited csv cannot drift apart silently. Item ids are **1-based**: table row N is
>   item id N+1.
> - **Loot:** [src/game/loot_table.h](src/game/loot_table.h) /
>   [.cpp](src/game/loot_table.cpp)
> - **Tests:** [tests/game_test.cpp](tests/game_test.cpp) `test_item_table`, plus the
>   `suite_*.inl` gameplay suites (headless, link `giga_game` only)
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
(every `ItemCategory`, every use-effect archetype), grown toward the full set by
pure data edits.

Each `ItemDef` row carries:

- **`category`** (`ItemCategory`, [item_table.h](src/game/item_table.h)):
  Misc/Weapon/Food/Medicine/Ammo/Tool/Drink/Key/Note. The ordinals are OUR
  frequency order (Misc = 0, the 268-row bulk), not the reference's — the CSV
  authors the name, the generator assigns the number, so nothing may key on it.
- **`name`** — the reference string key (`"bread"`, `"ak47"`) for HUD/debug and
  loot resolution; `item_id("bread")` resolves it back to the id (cold path).
- **`value`** (rubles — the economy axis and loot value-gate), **`spawnW`** (base
  spawn weight), **`stack`**, **`durability`**.
- **`resist[5]`** — armor mitigation percent per `DamageChannel`
  ([combat.h](src/game/combat.h): Kinetic/Buckshot/Energy/Fire/Psi), pinned equal
  to `DamageChannel::Count`; 0 on non-armor.
- **`tags_hot` / `tags_all`** — authored as STRINGS in the CSV (465 distinct
  ones). Honest status: **no consumer reads them yet** — the two-tier flattening
  into a bitmask is a planned pass, and until it lands loot placement, the economy
  and the AI branch on `category`, `spawn_rooms` and the numeric scores instead.
- **`science` / `contraband` / `deceptive`** — quest/economy scores.
- **`use`** — a `UseEffect` (see below).

Weapon **combat** stats (damage, range, magazine, ammo type) are deliberately a
**separate registry** keyed by the same id — they land with combat, exactly as
the reference splits `ItemDef` from weapon stats. The catalog only marks weapons
by `category` and their `value` for now.

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

## Monster death-drop loot tables (built)

Ported from the reference (`monster_ecology.ts` + `procedural_loot.ts`), keyed by
`MobKind` ([monsters.md](monsters.md)) into flat POD rows exactly as the mob
catalog keys stats — loot is **data, never a code branch**. Two independent
mechanisms:

- **`rareDrops`** — a short list on ~every mob kind, rolled **first-hit-single**:
  walk the list in order, the first entry whose `chance` passes drops one item,
  then stop (so earlier entries are favoured and **at most one** rare ever drops).
  The caller gates this to **player kills** (the reference `killerIsPlayer` rule).
- **`lootTable`** — a richer list on **only three** kinds (`gnome`, `zombie`, and
  `betonnik`, the last inheriting the reference `betonoed` table). Rolled
  **independently** per entry, each dropping a uniform `[minCount,maxCount]`; the
  surviving hits are shuffled and **capped at 3 stacks**. Fires on **any** death.

`roll_mob_loot_slots(mobKind, mobTier, floorNumber, seed, outSlots, outCap)`
([loot.h](src/game/loot.h)) fills a fixed POD slot buffer — no entities — and is
**deterministic from `seed`** (mixed from sim-time + entity
id at the kill site) with **no stored RNG state** — a local draw counter over
giga's native splitmix mixer ([core/rng.h](src/core/rng.h)) substitutes the
reference's stateful xorshift32 while porting every loot semantic verbatim (draw
order, first-hit rare, independent loot rolls, count ranges, shuffle + cap).

Reference item keys outside this engine's representative item catalog are mapped
to the **nearest existing id by role** (documented per row in
[loot_table.cpp](src/game/loot_table.cpp)) rather than dropped, so loot
*presence* and *rate* stay faithful while the exact SKU sharpens as the catalog
grows toward the reference's ~444 items.

## Model — value-gated procedural pool (planned)

- **Value-gated procedural pool** for NPC/container/merchant loot — a soft
  exponential gate on `value` over the whole catalog (`weight *= exp(-(value/cap −
  1)·3)` above the cap), weighted by `spawnW`, item-type multipliers and `tags`.
  Lands with NPC/container spawning (it is a separate reference system from the
  monster death drops above).
- **Per-floor drop weights** — a floor rule-set supplies **multipliers** over
  global loot weights, never new item definitions.
- **Loot on the ground** is an ordinary entity with a `Transform` + inventory
  ([ecs.md](ecs.md)) — spawned by #13d from a `LootResult`.

## Global vs. local

| Global | Per-floor (rule-set) |
|--------|----------------------|
| Item definitions (built) | Loot-weight multipliers |
| Death-drop tables (built) | Floor-specific rare-drop nudges |

## Connections

Consumed by the embodied [ai.md](ai.md) (eat/drink/heal intents); dropped by
[monsters.md](monsters.md); weighted by [floors.md](floors.md); carried via
[inventory.h](src/game/inventory.h) on [ecs.md](ecs.md) entities.
