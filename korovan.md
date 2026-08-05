# Korovan: cold A-Life, caravans and Demos

> Официальный дизайн-документ макро A-Life и караванной логистики.
>
> Роль: описывает, как в текущем коде холодный A-Life, миграции, scripted arrivals and caravans соединяют фиксированную популяцию `100_000`, route floors, экономику и player-facing следы. Этот документ дополняет `README.md`, `alife.md` и `economics.md`: `README.md` фиксирует shipped facts, `alife.md` владеет persistent identity, `economics.md` владеет ресурсами/ценами/караванами, а `korovan.md` описывает их общую макро-идею и системный мост.

Archived implementation batch prompts `korovan_0.md`..`korovan_6.md` moved to `../gatbage/history/batches/korovan/`. They are historical orchestration notes, not source of truth.

## Design Promise

ГИГАХРУЩ is not a level that refills actors around the player. The building is already inhabited.

The macro layer should make NPCs feel like people with a place in the structure:

- every ordinary person belongs to the fixed A-Life population;
- age and sex are part of that identity, not renderer-only labels;
- movement between floors changes that person's real `floorKey`;
- caravans carry resources and, when they carry people, persistent identities;
- scripted arrivals should be named/reserved identities or migrated ordinary records;
- deaths remain real and are not hidden by refill;
- player-facing traces come from events, rumors, logs, quests, trade, caravans and future info surfaces.

The cold layer is intentionally cinematic. It does not simulate every off-floor room, path or conversation. It changes compact persistent facts that later become visible when the player meets those people, reads events, follows a caravan, opens a profile page, or returns to a changed floor.

## Current Shipped Shape

### Population

`src/systems/alife.ts` owns the fixed `100_000` population.

Current facts:

- `src/data/alife_population_plan.ts` builds a run-start population plan.
- The plan covers story floors, routed design floors and the per-run procedural route deck.
- Plot/authored/event reserved identities occupy slots inside the same fixed budget.
- `npc:*` package reservations marked `presence: 'population'` can materialize as named inhabitants through ordinary floor population slots.
- NPC-forbidden route stops receive no ordinary ambient population.
- `createAlifeState()` and `setAlifeState()` prefill all records before active-floor materialization.
- Floor generators may still create ambient NPC entities, but those are placement templates.
- `materializeAlifeFloorPopulation()` removes ambient templates and materializes A-Life records from `floorIndex[floorKey]`.
- `event_only` and legacy plot reserved records are skipped as ordinary ambient slots, so an event or plot identity does not steal a generic crowd body.
- Dead records are not replaced; their materialization slot stays empty.
- Age is byte-sized and sex is a byte code in A-Life cold storage; snapshots expose them for Demos, quests, AI context and UI.

The important invariant:

```txt
run seed + route deck
  -> population plan
  -> 100000 A-Life records
  -> floorIndex by story/design/procedural floorKey
  -> active floor uses records, not new ordinary identities
```

### Identity API

The public identity helpers are the integration surface:

- `moveAlifeNpcRecord(state, alifeId, toFloorKey, opts)`
- `getAlifeNpcRecordSnapshot(state, alifeId)`
- `sampleAlifeFloorRecordIds(state, floorKey, cursor, limit)`
- `currentAlifeFloorRecordIds(state, floorKey)`
- `materializeAlifeArrival(state, world, entities, nextId, alifeId, opts, floorKey)`
- `assignPersistentAlifeNpcFromEntity(state, entity, entities, floorKey)`
- `bindReservedPlotNpcAlifeRecord(state, entity, plotNpcId, floorKey)`

Rules:

- Generic systems must use helpers instead of mutating A-Life arrays directly.
- Dead records cannot move or materialize.
- Movement updates `floorIndex` and `record.floorKey`.
- Event-created ordinary NPCs receive or reuse persistent records instead of growing the pool.
- Converted plot arrivals can bind to reserved A-Life records while keeping `plotNpcId` for authored quest logic.

### Cold Mobility

`src/data/alife_migration.ts` owns migration reasons and intent profiles. `src/systems/alife_migration.ts` owns runtime mobility.

Current runtime:

- `ALIFE_MIGRATION_TICK_SECONDS = 30`;
- `ALIFE_MIGRATION_RECORDS_PER_TICK = 64`;
- forced/debug cap is `256`;
- in-flight journeys cap at `512`;
- pending arrivals cap at `256`;
- active departures cap at `32`;
- active departure updates are bounded to `8` per tick.

The cold tick:

1. Accumulates cadence.
2. Processes due journeys first.
3. Moves inactive arrivals directly through `moveAlifeNpcRecord()`.
4. Queues active-floor arrivals instead of spawning them in the cold pass.
5. Scans only a bounded slice of A-Life records by cursor.
6. Skips dead records, reserved records, active-floor records and records already in a journey.
7. Chooses an intent from data profiles.
8. Resolves a destination from route context and tags.
9. Starts a journey with compact event data.

It does not scan inactive worlds, rooms, floor memory snapshots or inactive entity arrays.

### Active Arrivals

`processAlifePendingArrivals()` materializes pending arrivals only when the destination is the active `floorKey`.

Arrival rules:

- delayed during active samosbor unless reason is `samosbor` or `refugee`;
- blocked if the active route disallows NPCs;
- blocked by actor soft limits;
- prefers passable cells around lifts and lift buttons;
- falls back to nearby passable anchor only when needed;
- materializes the same `alifeId`;
- publishes a compact `alife_migration` event;
- retries are capped, then an `arrival_failed` event is published.

Arrivals should read as people coming through route infrastructure, not appearing in the middle of a room.

### Active Departures

`startActiveAlifeDeparture()` and `updateActiveAlifeDepartures()` keep visible people honest.

A live NPC can depart only if it is:

- alive;
- an ordinary NPC with `alifeId`;
- not the player or native player body;
- not a `plotNpcId` actor;
- not a quest/menu target;
- not in ordinary combat unless the future reason explicitly allows panic/refugee behavior.

The departure assigns `GOTO` to a lift anchor. Only after the live entity reaches that anchor does the system fold state into the record, move the record to the destination key and remove the live entity.

### Save Shape

Current save shape is `SAVE_SHAPE_VERSION = 21`.

Save sections relevant to Korovan:

- `alife`: seed, dead ids cap, dead plot ids, changed-record overrides including age/sex when touched;
- `alifeMobility`: tick cursor, journey queue and pending arrivals;
- `caravans`: active run state and lane/resource state through the existing caravan save path;
- floor memory: visited floor geometry snapshots, separate from A-Life identity.

`alifeMobility` is capped and sanitized. Old save versions are rejected explicitly; there is no migration scaffold.

### Events And Debug

Migration uses existing `publishEvent()`.

Typical tags:

- `alife_migration`;
- `migration`;
- `arrival`;
- `departure`;
- `arrival_failed`;
- `caravan`;
- `samosbor`;
- `scripted_arrival`;
- intent id;
- source/destination route tags.

`summarizeAlifeMigration(state, 8)` is the cheap inspection path: cursor, active journey count, pending arrivals and a bounded list of journeys.

## Caravans

Caravans are the economy-facing consumer of macro movement.

`src/data/caravans.ts` owns lane and small caravan definitions. `src/systems/caravans.ts` owns runtime lane ticks, resource movement, tariffs, active runs and member identity integration.

Current shipped behavior:

- resource lanes move bounded stock and publish events;
- tariffs and lane stability influence economic pressure;
- small caravan runs can recruit eligible live ordinary NPCs;
- recruited members store `memberAlifeIds`, not only live `entity.id`;
- on arrival, surviving members move through `moveAlifeNpcRecord()` to the destination route key;
- player, plot NPCs, quest NPCs and menu targets are rejected as caravan members;
- raids do not automatically kill every member by default;
- off-floor caravan lane migration can move bounded prefilled A-Life records;
- no new caravan people are created as ordinary refill.

Caravans still need deeper economy contracts later:

- ownership;
- debt;
- escorts;
- cargo insurance;
- asset risk;
- faction permits;
- route-specific black market/bank/lab consequences.

Those belong to `economics.md` and should mutate resources, tariffs, banking, contracts or events. They must not bypass A-Life identity when people are involved.

## Scripted And Samosbor Arrivals

Scripted human arrivals are not a license to refill population.

Current normalized paths:

- Hell holdout Major Grom binds to his reserved A-Life record through `bindReservedPlotNpcAlifeRecord()`.
- Hell holdout liquidator guards receive persistent A-Life ids inside the fixed pool.
- `samosbor_director` `extra_patrol` assigns persistent A-Life ids and fails instead of spawning when no reusable identities are available.
- Faction events normally claim existing NPCs; forced creation remains debug/manual.
- Истотит remains the explicit weird exception and must stay visibly named, capped and event-backed.

Future authored arrivals should follow the same rule:

```txt
stable plot identity
  or reserved A-Life identity
  or existing persistent A-Life record
  or explicit temporary event actor
```

No unnamed ordinary person should appear just because a local cap has room.

## Relationship To A-Life

`alife.md` owns the persistent population contract:

- fixed `100_000`;
- floor assignment;
- materialization and foldback;
- death permanence;
- personal relation and karma;
- save projection.

`korovan.md` does not replace that contract. It explains how macro travel uses it:

- cold movement changes `floorKey`;
- active arrival/departure turns record movement into visible live behavior;
- caravan members are A-Life records;
- scripted arrivals become reserved/migrated people;
- future player-facing people pages should read from A-Life snapshots.

If a future feature needs "someone", it should first ask A-Life for a person. If it cannot, it should declare a bounded temporary actor or fail gracefully.

## Relationship To Economics

`economics.md` owns money, resources, prices, production, scarcity, banking, market and caravan resource pressure.

Korovan connects people to those flows:

- market travel can explain stock changes and rumors;
- repair shifts can justify production/resource events;
- bank trips can expose wealth, debt and account behavior;
- black market trips can alter tariffs and contraband pressure;
- caravan members can survive, die, desert or arrive as persistent people.

Economic systems should not create population to explain logistics. They should publish compact facts and move existing identities only when people are part of the event.

## Current Boundaries

Do not add:

- full hidden simulation of every floor;
- off-floor pathfinding;
- off-floor combat;
- off-floor needs ticking;
- per-frame scans of `100_000` records;
- per-floor world/entity scans for cold decisions;
- renderer-owned gameplay state;
- content-specific branches in `main.ts`;
- map overlays as the primary explanation of migration.

Allowed cheap macro facts:

- bounded cursor slices over A-Life records;
- journey queues;
- pending arrival queues;
- compact events;
- resource deltas;
- relation/rumor/contract hooks;
- lazy profile pages.

## Инфосеть Демос

`Инфосеть Демос` is a planned in-game social information surface: "Facebook for NPCs" inside the concrete structure.

It should make NPCs feel human without adding new simulation. First implementation is read-only and lazy: open a page, collect existing facts from current game state, render them for the player.

### Product Shape

Each NPC can have a Demos page.

Minimum visible fields:

- name and surname from the NPC/A-Life display name;
- relation to the player as colored number;
- relation label;
- faction;
- level;
- current location;
- portrait.

Relation labels use the A-Life personal `playerRelation` scale:

| Relation score | Label |
| ---: | --- |
| `< -75` | ненавидит |
| `< -50` | враг |
| `< -25` | недруг |
| `< 0` | холодное |
| `< 25` | нейтрально |
| `< 50` | приятель |
| `< 75` | друг |
| `>= 75` | любовь |

Color should follow the same emotional direction:

- deep red for hatred/enemy;
- orange for bad/strained;
- gray for cold/neutral;
- soft green for friendly;
- bright green or warm highlight for love.

The page should not pre-generate portraits for all NPCs. When a page opens, it renders the upper part of the NPC sprite as a portrait on the left. For materialized NPCs this can use current entity sprite/sprite seed. For off-floor A-Life records it can use folded `sprite`/`spriteSeed` or the occupation sprite fallback.

### Location

Location should be honest but compact:

- live active-floor NPC: current floor label, optionally room/zone if cheaply known;
- off-floor record: `floorKey` resolved to story/design/procedural route label;
- in journey: "в пути" plus destination label if visible through `alifeMobility`;
- pending active arrival: "ждет лифта" or equivalent;
- dead record: dead/missing state, not a normal current location.

No inactive world should be loaded to calculate a room name.

### Data Sources

First pass reads only existing state:

- `getAlifeNpcRecordSnapshot()` for persistent records;
- live `entities` for currently materialized NPCs;
- `alifeMobility` summary for journey/pending status;
- faction definitions and labels;
- RPG level from record/live entity;
- current quest/plot data only when a quest already references this identity.

Do not create a separate Demos identity database. Demos ids should be stable references:

- `alife:<id>` for A-Life records;
- `plot:<plotNpcId>` only where the plot actor has not yet been converted;
- future quest ids should prefer `persistentNpcId`/reserved A-Life ids over transient `entity.id`.

### UI Contract

This remains a canvas/HUD game, not a DOM app.

First pass can be:

- a terminal/page opened from a Net/Demos surface;
- a searchable/capped list of known NPCs;
- a direct profile from an aimed NPC or quest entry.

Performance rules:

- no 100k DOM/page objects;
- no full profile pre-render;
- list views must be capped, paged or filtered;
- page opening may resolve one record by id;
- broad search can scan bounded slices or cached lightweight indexes, not every frame;
- no save shape change for read-only Demos.

### Quest Integration Direction

Demos should push quests toward A-Life identity:

- quest giver should store or resolve `persistentNpcId` where possible;
- generated quest candidates should come from A-Life records, not synthetic giver ids;
- profile page can show "can talk", "has job", "active quest target" only from existing quest state;
- taking quests from Demos is future work and must still call normal quest systems.

This is the social layer that makes `canGiveQuest` and personal relation visible.

### Future Extensions

Future Demos may connect to Net Sphere, but local single-player stays authoritative.

Possible later actions:

- message NPC;
- request meeting;
- call an NPC to the current floor if relation is high and route rules allow;
- take a quest;
- pay debt;
- trade by appointment;
- mark a person for escort/caravan;
- view rumors, mutual friends, faction trust or public deeds.

These are future interactions, not first-pass requirements.

Every future action must use existing systems:

- movement through cold A-Life migration or active arrival;
- relation through A-Life/NPC relation systems;
- quests through quest registries;
- trade through economy/trade systems;
- online mirroring through optional Net Sphere APIs;
- no direct teleport/refill unless a debug path says so.

### First Implementation Plan

1. Add a data/view helper that resolves a Demos profile by `persistentNpcId`, `alifeId` or `plotNpcId`.
2. Return a compact view model: display name, relation score/label/color, faction, level, location, sprite portrait fields and quest affordance flags.
3. Add tests for relation thresholds and location resolution without loading inactive worlds.
4. Add a canvas page/list entry point through an existing terminal/menu surface.
5. Render portrait lazily from sprite data when the page opens.
6. Keep the page read-only in the first slice.
7. Add quest linking only after generated quest givers consistently store stable A-Life identity.

Acceptance for first slice:

- opening a known NPC page shows real current game data;
- off-floor NPC pages resolve from the `100_000` A-Life pool;
- relation label/color matches thresholds;
- location does not require inactive floor loading;
- no new save shape;
- no new NPC creation;
- no Net Sphere dependency.
