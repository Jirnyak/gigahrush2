# Items & Loot — Global item catalog & loot tables

> **Status: item catalog BUILT and generated from data; monster death-drop loot tables
> BUILT; value-gated procedural pool pending.** Game layer (`src/game/`, the
> `giga_game` library), on top of the inventory
> ([inventory.h](src/game/inventory.h)) and the embodied needs
> ([needs.h](src/game/needs.h)).
>
> - **Source of truth is [data/items.csv](data/items.csv)** - **443 rows** (the port
>   landed 446; four purged, plus the **ruble** — money-as-item, value 1, stack
>   65535, the row the barter economy stands on). Adding an item
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
  frequency order (Misc = 0, the 265-row bulk), not the reference's — the CSV
  authors the name, the generator assigns the number, so nothing may key on it.
- **`name`** — the reference string key (`"bread"`, `"ak47"`) for HUD/debug and
  loot resolution; `item_id("bread")` resolves it back to the id (cold path).
- **`value`** (rubles — the economy axis and loot value-gate), **`spawnW`** (base
  spawn weight), **`stack`**, **`durability`**.
- **`resist[5]`** — armor mitigation percent per `DamageChannel`
  ([combat.h](src/game/combat.h): Kinetic/Buckshot/Energy/Fire/Psi), pinned equal
  to `DamageChannel::Count`; 0 on non-armor.
- **`massG`** — mass in **grams**, `uint32`. The SAME field, unit and width that
  `PropDef` and `MobDef` carry, so there is exactly one thing "mass" means in this
  tree: the three catalogs all feed one `ecs::Mass{float kg}` on the entity and one
  law, `E = m*v^2/2` ([impact.cpp](src/game/impact.cpp)). Readers today:
  `inventory_mass_g` (carried weight against `kCarryBaseG`, on the HUD) and the
  loot spawner, which gives a dropped stack the mass of its whole count.
  **Zero is legal here and means "not a physical object"** — the 20 `psi_*`
  techniques are knowledge, not luggage. It is legal only because no row can be
  blank: `mass_g` is authored on all 442. The prop and mob tables refuse 0 outright,
  because there a zero is indistinguishable from an unfilled column.

### How the 442 weights were authored (and why the rule table is gone)

Worth recording, because the shape of the answer is reusable and the reasoning is
no longer visible in any file. 442 numbers cannot be invented one at a time and
cannot be reviewed as a column, so they were first written as **rules** in a
temporary `data/item_mass.csv` (`id` > `tag` > `prefix` > `category`), then
migrated into the column and the rule table deleted.

The measurement that decided the rules: **265 of the 442 rows are category MISC**,
which is a junk drawer — a single "MISC = 200 g" would be a lie for all of them.
But their TAGS are not a junk drawer at all: `document` 81, `evidence` 57,
`audit` 37, `official` 32, `permit` 18. Gigahrush is a bureaucratic building and
most of its loose contents are paperwork, so one authored line — *документ = 20 г* —
gave 75 items an honest weight. Weapons, tools and ammo (121 rows) each got a named
value; nothing in those three families fell through to a category default.

The migration was proved rather than trusted: after switching the generator to read
the column, `item_table.cpp` differed from its rule-built predecessor **in comment
lines only — not one `ItemDef{...}` byte**. If these weights are ever re-authored
wholesale, do it the same way: rules first, then a proof-by-identical-output
migration.

### Carried weight and encumbrance (built)

`inventory_mass_g` sums a grid, stack COUNT included — sixty rounds weigh sixty
rounds. The budget is the CHARACTER's, in [rpg.h](src/game/rpg.h):

    carry_capacity_g = 64 kg + 4 kg per point of Strength

Both constants are powers of two in kilogrammes, so a capacity is always even.
It reads **Strength** and not Endurance because `Attr` is `{Str, Agi, Int}` and
the manifesto's eight-attribute sheet is not built; hanging it off an attribute
that exists is honest wiring, and the day Endurance lands it is one line.

What the load COSTS lives in [encumbrance.h](src/game/encumbrance.h), and half of
it is not a new rule at all — it is three laws that already existed finally seeing
the pack:

| law | before | now |
|---|---|---|
| `E = m·v²/2` — fall damage ([impact.cpp](src/game/impact.cpp)) | body only, `22·h²` | `Mass` = body + load |
| `p = m·v` — knockback ([combat.cpp](src/game/combat.cpp)) | flat 2.5 m/s for everyone | impulse ÷ mass, normalised at `kKnockbackRefMassKg` |
| the noise field — footsteps | fixed 6 m radius | × `1 + 0.6·(carried/capacity)` |

So weight matters ALWAYS and CONTINUOUSLY, with no cliff at the threshold. The two
penalties that do need a threshold take it from the same `carry_capacity_g`:
**speed** (free under capacity, then `capacity/carried`, floored at
`kEncumbranceMinScale` so an absurd load slows and never freezes) and **fatigue**
(overload burns sleep, and `sleep < 10` already halves pace on its own).

The sweep is staggered 1-in-8 by identity like `wander_step`; the camera holder is
visited every tick because its number drives the HUD and the Controller. The
consequence, stated: a crowd body's `Mass` can lag its inventory by ~64 ms.
- **`tags_hot` / `tags_all`** — authored as STRINGS in the CSV (459 distinct
  ones). Honest status: **no consumer reads them yet** — the two-tier flattening
  into a bitmask is a planned pass, and until it lands loot placement, the economy
  and the AI branch on `category`, `spawn_rooms` and the numeric scores instead.
- **`science` / `contraband` / `deceptive`** — quest/economy scores.
- **`use`** — a `UseEffect` (see below).

Weapon **combat** stats (damage, range, magazine, ammo type) are deliberately a
**separate registry** keyed by the same id — they land with combat, exactly as
the reference splits `ItemDef` from weapon stats. The catalog only marks weapons
by `category` and their `value` for now.

**`ammo_id` pointing at the row's OWN id means the weapon is THROWN**, and that
is read rather than declared. `grenade` carries `ammo_id = grenade`, because the
thing you throw IS the round — there is no pouch of grenade-ammunition, and
inventing one would have forced a phantom item into the drop tables, the vendor
stock and the craft outputs so that a category check could pass. So
`ranged_is_thrown(id)` is `def.ammo == id` ([ranged_table.h]), and it is what
keeps `equipped_ranged` (which ranks by DPS) from handing the player a grenade
every time he pulls a trigger — a grenade is 75 DPS and beats 26 of the 29
firearms. Throwables are picked by `equipped_throwable` and thrown by
`player_throw_step`, on their own key (`Z`). Five items spell themselves this
way today: the three grenades and the two demolition charges.

### Use-effects close the digestion loop

The reference stores `use` as a closure; a closure is not data and cannot sit in
a static table or serialise, so each is re-encoded as a **named `UseEffect`
archetype** — `Heal`, `HealPsi`, `Feed`, `FeedPsi`, `FeedRisky`, `Drink`,
`DrinkStim`, `Painkiller`, `Antiemetic`, `PsiSurge`, `SleepingPills`,
`TechnicalSpirit`, `Unpack`, `UnsealSample`, `RedeemCoupon` — plus ONE signed
magnitude `useA` on the row ([src/game/item_table.h](src/game/item_table.h)).

**The struct this section used to describe does not exist**, and neither does
`apply_use_effect`: there is no `UseEffect { dFood, dWater, … }` and no
`dPendingPoo`/`transformOutput` field anywhere in `src/`. Do not go looking for
them. What exists: `needs.cpp` dispatches `Feed` / `FeedPsi` / `FeedRisky` /
`Drink` / `DrinkStim` / `SleepingPills`, and `loot.cpp` dispatches `Heal`. The
other **eight archetypes have no handler at all**, so the items carrying them are
purchasable and inert ([problems.md](problems.md) §35). The second CSV column
`use_b` is likewise unread — the risky-feed HP cost is a hardcoded constant that
disagrees with the authored data on two rows.

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
