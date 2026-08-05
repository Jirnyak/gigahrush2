# Interactive Blocks And Objects

> Центральный документ по готовой системе интерактивных поверхностей мира.
>
> Роль: описывает уже реализованный universal interactive layer, его границы, API, правила расширения и текущие shipped definitions. Документ нужен для будущих добавлений вроде раковин, туалетов, верстаков, станков, экранов, контейнерных адаптеров и блоковых устройств без новых ad hoc веток в `main.ts`, `render/webgl.ts` или широком AI.

## Status

Система реализована как первый универсальный production-слой для cell-bound interactive objects.

Готово в коде:

- `src/data/interactive.ts` содержит registry `INTERACTIVE_DEFS`, типы `InteractiveDef`, `InteractiveActionDef`, `InteractiveVisualDef` и helpers `registerInteractiveDef()`, `getInteractiveDef()`, `allInteractiveDefs()`.
- `src/systems/interactive.ts` содержит sparse per-`World` runtime registry на `WeakMap<World, ...>`, public API для placement/query/use/debug и один `ContentInteractionHook` с id `interactive_surfaces`.
- `src/gen/interactive_placement.ts` содержит generator-facing helpers `placeInteractiveAt()` и `placeInteractiveInRoom()`.
- `src/gen/interactive_fixtures.ts` содержит generation helper `maybePlaceBrokenFixture()` для редких сломанных раковин/унитазов поверх уже расставленных `Feature.SINK` / `Feature.TOILET`.
- `src/data/floor_object_placement.ts` содержит per-floor object profiles: story-floor, design-route and procedural-geometry entries declare decor features, explicit interactives, broken fixture overlays and craft-station subprofiles.
- `src/gen/floor_object_placement.ts` applies those object profiles through one reachable generation-time hook. Static cell-bound objects such as collector pumps, lab apparatus, status screens, broken sanitary fixtures and craft stations share the same bounded path.
- Bulky feature/container primitives can also stamp first-pass 8x8 path blockers through explicit mappings in `src/data/path_blockers.ts` and `src/gen/path_blockers.ts`; this blocks movement through large tables, beds, shelves, machines, apparatus, sinks, toilets and bulky containers without deriving collision from render-only mesh data.
- `src/data/craft_station_placement.ts` and `src/gen/craft_stations.ts` remain the craft-station subprofile and placement implementation; station identity is marked in `world.surfaceFlags`, so restored floor memory can recover the same interactive definition when the feature survives. LIVING also has guaranteed authored pairs in the expedition prep point and Yakov Davidovich's lab.
- `src/systems/content_hooks.ts` расширен callback `openContainerMenu`, чтобы generic interactive layer мог делегировать открытие существующих контейнеров без переписывания container UI.
- `src/systems/interactions.ts` side-effect imports `./interactive`, поэтому hook регистрируется в общем `E` dispatcher path.
- `src/core/types.ts` содержит `interactive_used` в `WORLD_EVENT_TYPES`.
- `scripts/content-audit.mjs` знает registry `INTERACTIVE_DEFS` и проверяет static references на interactive ids.
- `tests/interactive.test.ts` покрывает lazy sink в защищенной квартире, broken fixture priority, container adapter, explicit workbench placement и отказ ставить feature-backed interactive в заблокированную клетку.

Текущие shipped definitions:

- `sink_drink`: lazy adapter для существующих `Feature.SINK`; игрок пьет из раковины, получает воду, накапливает pending pee, видит сообщение и публикуется `interactive_used`.
- `sink_broken`: explicit repair-pending adapter для существующей `Feature.SINK`; генераторы могут пометить раковину сломанной, она перекрывает lazy drinking prompt до будущего ремонта.
- `toilet_relief`: lazy adapter для существующих `Feature.TOILET`; игрок снижает needs pressure, видит сообщение и публикуется `interactive_used`.
- `toilet_broken`: explicit repair-pending adapter для существующей `Feature.TOILET`; генераторы могут пометить унитаз сломанным, он перекрывает lazy relief prompt до будущего ремонта.
- `workbench_basic`: explicit feature-backed interactive на `Feature.MACHINE`; сейчас это inspect-only верстак для обычных rooms that do not open crafting.
- `craft_lathe`: feature-backed `Feature.MACHINE` station with `open_craft_menu`, station `lathe`, and a craft station surface flag.
- `disassembly_workbench`: feature-backed `Feature.TABLE` station with `open_disassembly_menu`, station `workbench`, and a disassembly surface flag.
- `craft_lab_bench`: feature-backed `Feature.APPARATUS` station with `open_craft_menu`, station `lab`, and a lab station surface flag.
- `recipe_billboard`: feature-backed `Feature.SCREEN` source with `learn_recipe` for `floor_recipe_billboard_basics` and a recipe billboard surface flag.
- `container_adapter`: adapter для видимых `WorldContainer`; target идет через generic interactive layer, но inventory/access/theft/UI остаются в существующей container system.

Важно: это готовое универсальное ядро, но не полный перенос всех старых interaction systems. Двери, route lifts, emergency panels, generated computers, gambling machines, NET-hack terminals и специальные аномальные панели пока остаются в своих системах. Их можно адаптировать через этот слой позже, если это даст реальную пользу. Новые ordinary feature-like objects уже нужно добавлять через interactive layer.

## Purpose

Interactive layer решает повторяющуюся задачу: добавить в мир объект, который занимает клетку, имеет prompt по `E`, выполняет bounded gameplay action и не требует отдельной ветки в dispatcher для каждого частного случая.

Система нужна для объектов вроде:

- раковина, из которой можно пить;
- туалет, которым можно воспользоваться;
- верстак, на котором можно чинить или крафтить;
- станок, аппарат, печь, плита, фильтр, дробилка, насос;
- экран, радио, терминал, объявление;
- контейнер с дополнительной логикой;
- клеточный блок или устройство, которое позже может адаптировать дверь, клапан, затвор, панель или проход.

Core принцип: визуальная primitive identity остается простой (`Feature`, `Cell`, `WorldContainer`, `BILLBOARD`), а gameplay identity живет в string id `InteractiveDef.id`.

Пример: renderer видит `Feature.SINK`; gameplay layer видит `sink_drink`.

## Feature-First Overlay Contract

Это основной контракт для ordinary feature-like objects.

Порядок всегда такой:

1. Генератор этажа сначала создает мир как декорацию/топологию: ставит `Feature`, `Cell`, `WorldContainer`, billboard или иной primitive.
2. Interactive layer потом навешивает gameplay meaning на уже существующую клетку.
3. HUD/dispatcher видит не саму фичу, а resolved `InteractiveDef` с prompt, priority, range и action.

Практический смысл:

- если нужно изменить количество раковин, унитазов, плит, станков или их распределение по этажам, меняется генерация `world.features` / rooms / authored floor layout;
- если нужно изменить действие по `E`, cooldown, текст, event или эффект, меняется `InteractiveDef` и action handler;
- если нужен сломанный, сухой, зараженный, закрытый, фракционный или улучшенный вариант, добавляется overlay definition с тем же visual primitive и более высоким priority;
- repaired path должен снять или заменить overlay instance, после чего базовая фича снова резолвится через обычный lazy adapter;
- новый `Feature` enum нужен только для нового визуального primitive, а не для каждого gameplay state.

Исключение допустимо только для authored objects, у которых еще нет визуальной primitive на карте. Тогда `placeInteractiveAt()` может одновременно поставить `Feature` и создать interactive instance, как сейчас делает `workbench_basic`.

## Ownership

Система соблюдает общий five-layer contract проекта:

- `core/` owns primitive shapes and enums only.
- `data/` owns definitions and stable ids.
- `gen/` places instances into generated/authored worlds.
- `systems/` owns runtime behavior, action effects, events and dispatcher integration.
- `render/` reads existing state and draws; it does not decide interactive gameplay.

Do not put new object-specific gameplay in:

- `main.ts`;
- `core/world.ts`;
- `render/webgl.ts`;
- broad AI/pathfinding/combat modules.

## Core Terms

Interactive surface:

The generic internal term for one cell-indexed interactable instance. It may represent an object, block, container adapter or billboard-backed object.

Interactive object:

A passable-cell object whose visual is usually a `Feature` or billboard. Examples: sink, stove, toilet, bed, shelf, workbench, machine, apparatus, screen, radio.

Interactive block:

A cell-bound infrastructure or traversal device. Examples: door-like gate, shutter, valve block, breaker panel, terminal block, service panel. Existing doors and lifts are not moved into this layer yet, but future block adapters may reference `doorIdx` or `Cell` data.

Interactive container:

A `WorldContainer` exposed through interactive discovery. The container system remains authoritative for inventory, access, theft, production output, save and UI.

Feature-backed interactive:

An interactive whose visual is stored in `world.features[idx]`. `Feature.SINK` can be `sink_drink`, `Feature.MACHINE` can be `workbench_basic`, and future machines can reuse the same feature visual with different gameplay ids.

## Implemented Files

```txt
src/data/interactive.ts
src/systems/interactive.ts
src/gen/interactive_placement.ts
tests/interactive.test.ts
```

Related integration files:

```txt
src/systems/content_hooks.ts
src/systems/interactions.ts
src/core/types.ts
scripts/content-audit.mjs
README.md
architecture.md
desdoc.md
```

## Data Registry

Definitions live in `src/data/interactive.ts`.

Current type shape:

```ts
export type InteractiveSurfaceLayer = 'block' | 'feature' | 'container' | 'billboard';

export type InteractiveActionKind =
  | 'drink_water'
  | 'relieve'
  | 'repair_pending'
  | 'message'
  | 'open_container'
  | 'open_craft_menu'
  | 'open_disassembly_menu'
  | 'learn_recipe';

export type InteractiveVisualDef =
  | { kind: 'feature'; feature: Feature }
  | { kind: 'container'; containerKind?: ContainerKind }
  | { kind: 'cell'; cell: Cell; wallTex?: Tex; floorTex?: Tex }
  | { kind: 'billboard'; sprite: number; scale?: number; z?: number };

export interface InteractiveTargetDef {
  range: number;
  priority: number;
}

export interface InteractiveActionDef {
  id: string;
  label: string;
  kind: InteractiveActionKind;
  craftMode?: 'craft' | 'disassemble';
  craftStation?: 'lathe' | 'workbench' | 'lab' | 'net_terminal';
  recipeId?: string;
  recipeSourceId?: string;
  cooldownSeconds?: number;
  waterDelta?: number;
  peeDelta?: number;
  pooDelta?: number;
  message?: string;
  color?: string;
  eventType?: WorldEventType;
  eventSeverity?: WorldEventSeverity;
}

export interface InteractiveDef {
  id: string;
  layer: InteractiveSurfaceLayer;
  label: string;
  prompt: string;
  tags: readonly string[];
  visual: InteractiveVisualDef;
  surfaceFlag?: number;
  target: InteractiveTargetDef;
  actions: readonly InteractiveActionDef[];
}
```

Registry helpers:

```ts
registerInteractiveDef(def)
getInteractiveDef(defId)
allInteractiveDefs()
```

Definition rules:

- ids are stable lowercase snake_case;
- definitions are data, not world state;
- definitions do not store closures, entity references, world references or mutable runtime state;
- use tags for event/search/debug semantics;
- use existing visual primitives before adding any new enum;
- do not add a new `Feature` for every named object;
- action ids are local to the definition, action kinds are generic system handlers.

## Runtime Registry

Runtime instances live in `src/systems/interactive.ts`.

Storage is sparse and world-scoped:

```ts
const states = new WeakMap<World, InteractiveWorldState>();

interface InteractiveWorldState {
  nextId: number;
  byIdx: Map<number, InteractiveInstance[]>;
  byId: Map<number, InteractiveInstance>;
}
```

Instance shape:

```ts
export interface InteractiveInstance {
  id: number;
  defId: string;
  idx: number;
  x: number;
  y: number;
  roomId: number;
  zoneId: number;
  seed: number;
  layer: InteractiveSurfaceLayer;
  state: InteractiveInstanceState;
  ownerNpcId?: number;
  faction?: Faction;
  containerId?: number;
  doorIdx?: number;
  entityId?: number;
  tags: string[];
}

export interface InteractiveInstanceState {
  status?: string;
  charges?: number;
  cooldownUntil?: number;
  usedAt?: number;
  flags?: number;
  small?: Record<string, string | number | boolean>;
}
```

Why `WeakMap<World, ...>`:

- no dense per-cell object graph;
- no core `World` shape churn for the first layer;
- matches existing sparse runtime patterns such as emergency panels and hazards;
- state disappears with the `World`, which is correct for transient generated interactives;
- durable effects are stored in existing authoritative systems.

Current persistence status:

- interactive instance state has no dedicated save section;
- craft stations persist their identity through `world.surfaceFlags` when floor memory saves/restores the underlying cell;
- crafting player state is saved by `src/systems/crafting.ts`, not by the interactive instance registry;
- generated/lazy interactives are reconstructable from world features/containers/placement;
- durable consequences currently live in player needs, containers, events, room memory, surface flags, generated world cells/features or system-specific state.

## Public System API

Current exported system API:

```ts
placeInteractive(world, draft)
removeInteractiveAt(world, idx, filter?)
interactiveAt(world, x, y)
findInteractiveTarget(ctx)
useInteractive(ctx)
interactiveDebugSummary(world)
```

Use cases:

- generator places `workbench_basic` through `placeInteractiveAt()` or `placeInteractiveInRoom()`;
- existing `Feature.SINK` is lazily wrapped when looked at;
- existing `WorldContainer` is lazily wrapped when looked at and visible;
- tests/debug can inspect current instances with `interactiveAt()`;
- content hook uses `findInteractiveTarget()` and `useInteractive()`.

## Placement API

Generator-facing helpers live in `src/gen/interactive_placement.ts` and `src/gen/interactive_fixtures.ts`.

```ts
placeInteractiveAt(world, x, y, defId, options?)
placeInteractiveInRoom(world, room, defId, options?)
```

`placeInteractiveAt()`:

- wraps coordinates through `world.wrap()` / `world.idx()`;
- passes a deterministic seed by default;
- delegates validation and stamping to `placeInteractive()`.

`placeInteractiveInRoom()`:

- samples bounded room candidates;
- rejects protected cells;
- rejects wrong-room cells;
- rejects non-floor/non-water cells;
- rejects cells with containers;
- avoids existing features unless `forceFeature` is explicitly set.

Core `placeInteractive()`:

- resolves the `InteractiveDef`;
- prevents duplicate same-def instances on the same cell;
- for feature visuals, rejects `hermoWall`;
- for feature visuals, allows attaching to an already existing matching `Feature` in protected `aptMask` cells;
- for feature visuals, refuses to stamp a new feature into protected `aptMask` cells;
- for feature visuals, accepts only `Cell.FLOOR` and `Cell.WATER`;
- stamps `world.features[idx]` through `world.setFeatureAt()`;
- records `roomId`, `zoneId`, seed, tags and optional links.

`maybePlaceBrokenFixture()`:

- reads the already placed `world.features[idx]`;
- maps `Feature.SINK` to `sink_broken` and `Feature.TOILET` to `toilet_broken`;
- uses a deterministic hash roll from cell idx and salt;
- gives bathrooms the highest broken-fixture chance, kitchens a lower sink chance, and other rooms only a small chance;
- attaches an explicit repair-pending interactive without changing the visual feature.

This makes adding a new feature-backed object a data + generation operation, not a dispatcher rewrite.

## Dispatcher Integration

The layer registers one content hook:

```ts
registerContentInteractionHook({
  id: 'interactive_surfaces',
  target: findInteractiveTarget,
  use(ctx) {
    const result = useInteractive(ctx);
    return result.handled ? result : undefined;
  },
});
```

This hook is loaded by `import './interactive';` in `src/systems/interactions.ts`.

Interaction flow:

1. HUD/mobile prompt calls `findInteractionTarget()`.
2. The shared dispatcher reaches content hooks.
3. `interactive_surfaces.target()` resolves the looked-at cell.
4. Activation calls `activateInteraction()`.
5. `interactive_surfaces.use()` re-resolves the same looked-at cell and runs the action.

Target and activation use the same resolver, so prompt/action mismatch is minimized.

Current hook order remains the existing dispatcher order. Interactive feature objects and visible container adapters work through that order. Doors, route lifts and older special systems still use their established branches.

## Resolver Behavior

The resolver looks at the aimed cell:

- `Math.floor(ctx.lookX)`;
- `Math.floor(ctx.lookY)`;
- `world.idx(x, y)`.

Then it performs lazy adapters:

- if `world.features[idx]` is `Feature.SINK`, ensure `sink_drink`;
- if `world.features[idx]` is `Feature.TOILET`, ensure `toilet_relief`;
- if a visible `WorldContainer` exists at that cell, ensure `container_adapter`.

The resolver then:

- discards stale feature instances when the feature no longer matches;
- discards stale container adapters when the linked container moved or disappeared;
- checks range through `world.dist2()`;
- picks the highest `def.target.priority`;
- returns target prompt and activation data.

This is bounded: looked-at cell only, no full-world scan.

## Current Action Handlers

Action handlers live in `src/systems/interactive.ts`.

Implemented action kinds:

```txt
drink_water
relieve
repair_pending
message
open_container
open_craft_menu
open_disassembly_menu
learn_recipe
```

`drink_water`:

- reads `ctx.player.needs`;
- increases `needs.water` by `action.waterDelta`;
- increases `needs.pendingPee` by `action.peeDelta`;
- writes a Russian HUD/log message;
- publishes `interactive_used`;
- applies cooldown.

`relieve`:

- reads `ctx.player.needs`;
- decreases `needs.pee` and `needs.poo` through action deltas;
- writes a Russian HUD/log message;
- publishes `interactive_used`;
- applies cooldown.

`message`:

- writes `action.message` or fallback label;
- publishes `interactive_used`;
- applies cooldown.

`repair_pending`:

- currently uses the same bounded message/event path as `message`;
- marks objects that need a future durable repair path;
- does not mutate the object into a repaired state yet;
- publishes `interactive_used`;
- applies cooldown.

`open_container`:

- resolves linked `WorldContainer`;
- calls `ctx.openContainerMenu(container)`;
- publishes `interactive_used`;
- returns `openedOverlay: true`;
- falls through as unhandled if no container or no callback exists, so old container behavior can still handle contexts without the new callback.

`open_craft_menu` / `open_disassembly_menu`:

- call `ctx.openCraftMenu()` with `mode`, station kind and source interactive id;
- publish `interactive_used`;
- return `openedOverlay: true`;
- fall through as unhandled when the runtime did not provide the callback, so a missing UI callback does not corrupt world state.

`learn_recipe`:

- resolves `recipeSourceId` through crafting recipe sources;
- learns newly available recipe ids into player crafting state;
- prints a bounded already-known/newly-learned message;
- publishes `interactive_used`.

Cooldown:

- `instance.state.usedAt = state.time`;
- `cooldownUntil = state.time + cooldownSeconds`;
- repeated use during cooldown prints `Объект еще не готов.`;
- state is transient for now.

## Events

All current actions publish compact events by default:

```txt
interactive_used
```

Event payload includes:

- actor id/name/faction;
- room id and zone id when known;
- x/y event coordinate;
- target display name;
- optional `containerId`;
- tags: `interactive`, `def.id`, `action.kind`, plus definition tags;
- data: `interactiveId`, `interactiveDefId`, `actionId`, optional `containerId`.

Rules:

- use generic event types for ordinary interactives;
- do not add one event type per named sink or machine;
- keep payloads id-based and bounded;
- publish only facts that other systems can use.

## Current Definitions

### `sink_drink`

Visual:

```ts
{ kind: 'feature', feature: Feature.SINK }
```

Layer:

```txt
feature
```

Reachability:

- lazy-created on existing `Feature.SINK`;
- no generator changes required for existing sinks;
- range `2.25`;
- priority `66`.

Gameplay:

- action `drink`;
- kind `drink_water`;
- water +28;
- pending pee +8;
- cooldown 6 seconds;
- message: `Вы пьете из раковины. Вода холодная, с привкусом трубы.`;
- event `interactive_used`.

How to add variants later:

- `sink_dirty`;
- `sink_dry`;
- `sink_filtered`;
- `sink_poisoned`;
- `sink_faction_locked`.

These should be new `InteractiveDef` ids using the same `Feature.SINK` visual, not new `Feature` enum values.

### `sink_broken`

Visual:

```ts
{ kind: 'feature', feature: Feature.SINK }
```

Layer:

```txt
feature
```

Reachability:

- explicit placement through `placeInteractiveAt()` or `maybePlaceBrokenFixture()`;
- can attach to an existing sink in protected apartment cells;
- range `2.25`;
- priority `78`, so it overrides lazy `sink_drink`.

Gameplay:

- action `inspect_broken`;
- kind `repair_pending`;
- does not fill water;
- cooldown 2 seconds;
- message: `Раковина сломана. Нужен ремонт: кран держится на честном слове.`;
- event `interactive_used`.

Future repair path:

- repair should remove or transform the `sink_broken` instance;
- after removal, the existing `Feature.SINK` lazily exposes `sink_drink` again;
- do not add a new `Feature` enum for a repaired sink.

### `toilet_relief`

Visual:

```ts
{ kind: 'feature', feature: Feature.TOILET }
```

Layer:

```txt
feature
```

Reachability:

- lazy-created on existing `Feature.TOILET`;
- no generator changes required for existing toilets;
- range `2.25`;
- priority `64`.

Gameplay:

- action `relieve`;
- kind `relieve`;
- pee -70;
- poo -65;
- cooldown 10 seconds;
- message: `Вы закрываете за собой дверь на одну честную минуту.`;
- event `interactive_used`.

### `toilet_broken`

Visual:

```ts
{ kind: 'feature', feature: Feature.TOILET }
```

Layer:

```txt
feature
```

Reachability:

- explicit placement through `placeInteractiveAt()` or `maybePlaceBrokenFixture()`;
- can attach to an existing toilet in protected apartment cells;
- range `2.25`;
- priority `77`, so it overrides lazy `toilet_relief`.

Gameplay:

- action `inspect_broken`;
- kind `repair_pending`;
- does not relieve needs;
- cooldown 2 seconds;
- message: `Унитаз сломан. Нужен ремонт: бачок молчит, вода стоит.`;
- event `interactive_used`.

Future repair path:

- repair should remove or transform the `toilet_broken` instance;
- after removal, the existing `Feature.TOILET` lazily exposes `toilet_relief` again;
- do not add a new `Feature` enum for a repaired toilet.

### `workbench_basic`

Visual:

```ts
{ kind: 'feature', feature: Feature.MACHINE }
```

Layer:

```txt
feature
```

Reachability:

- explicit placement through `placeInteractiveAt()` or `placeInteractiveInRoom()`;
- range `2.25`;
- priority `63`.

Gameplay:

- action `inspect`;
- kind `message`;
- cooldown 2 seconds;
- message says the workbench accepts tools, parts and recipes, but only inspect exists now;
- event `interactive_used`.

This remains a generic inspect-only workbench. Actual crafting stations use the dedicated definitions below so ordinary room decoration does not accidentally open crafting.

### `craft_lathe`

Visual:

```ts
{ kind: 'feature', feature: Feature.MACHINE }
```

Reachability:

- placed through `src/gen/craft_stations.ts`;
- LIVING has a fixed reachable expedition-prep lathe;
- story, maintenance and procedural floors use bounded generation-time placement.

Gameplay:

- action `open_craft`;
- kind `open_craft_menu`;
- station `lathe`;
- sets `INTERACTIVE_SURFACE_FLAG_CRAFT_LATHE` in `world.surfaceFlags`;
- event `interactive_used`.

### `disassembly_workbench`

Visual:

```ts
{ kind: 'feature', feature: Feature.TABLE }
```

Gameplay:

- action `open_disassembly`;
- kind `open_disassembly_menu`;
- station `workbench`;
- sets `INTERACTIVE_SURFACE_FLAG_DISASSEMBLY_WORKBENCH`;
- event `interactive_used`.

### `craft_lab_bench`

Visual:

```ts
{ kind: 'feature', feature: Feature.APPARATUS }
```

Gameplay:

- action `open_lab_craft`;
- kind `open_craft_menu`;
- station `lab`;
- sets `INTERACTIVE_SURFACE_FLAG_CRAFT_LAB_BENCH`;
- event `interactive_used`.

### `recipe_billboard`

Visual:

```ts
{ kind: 'feature', feature: Feature.SCREEN }
```

Gameplay:

- action `read_recipe`;
- kind `learn_recipe`;
- source `floor_recipe_billboard_basics`;
- sets `INTERACTIVE_SURFACE_FLAG_RECIPE_BILLBOARD`;
- event `interactive_used`.

### `container_adapter`

Visual:

```ts
{ kind: 'container', containerKind: ContainerKind.WOODEN_CHEST }
```

Layer:

```txt
container
```

Reachability:

- lazy-created when a visible `WorldContainer` is aimed at;
- visible means `container.discovered || container.access !== 'secret'`;
- priority `62`;
- prompt uses the actual container name.

Gameplay:

- action `open`;
- kind `open_container`;
- delegates to existing `openContainerMenu`;
- does not own inventory;
- does not own access checks;
- does not own theft audit;
- does not replace container save behavior.

## Containers Remain Authoritative

The interactive layer does not rewrite containers.

`WorldContainer` still owns:

- inventory;
- capacity;
- access;
- ownership;
- theft/audit;
- production output;
- save/load sanitizer;
- UI;
- existing container events.

The interactive layer owns:

- target discovery for visible containers;
- generic prompt;
- `interactive_used` event for opening through this path;
- delegation to existing UI.

Future extension:

```ts
interactiveDefId?: string
```

could be added to `WorldContainer` only when a save-shape change is intentionally planned. Example: a fridge that is both inventory and powered cold appliance.

## Feature Objects

Feature-backed interactives are the main authoring path.

Rules:

- occupy one floor/water cell;
- use `world.features[idx]` as visual identity;
- use `InteractiveDef.id` as gameplay identity;
- reject protected apartments and hermetic walls by default;
- reject walls, abyss, doors and lifts by default;
- use `world.setFeatureAt()` so feature dirty/light behavior stays correct;
- do not add new `Feature` enum values just for variants.

Examples that should be added through this system:

- `sink_filtered`: clean water sink;
- `sink_rusty`: water plus status risk;
- `stove_cook`: food crafting;
- `stove_dead`: inspect message or repair action;
- `workbench_basic`: current shipped inspect action;
- `disassembly_workbench`: current shipped disassembly station;
- `craft_lathe`: current shipped lathe station;
- `craft_lab_bench`: current shipped lab station;
- `workbench_repair`: future gear repair station;
- `machine_press`: production/crafting machine;
- `apparatus_sample_processor`: sample processing;
- `screen_notice`: read-only screen text;
- `radio_listener`: local world-log or rumor action;
- `bed_rest`: rest/hide action;
- `shelf_search`: small loot/search action.

## Blocks

The type system already has `layer: 'block'`, `doorIdx` and cell visual support, but broad block migration is not done.

Current rule:

- ordinary doors stay in `world.doors`;
- route lifts stay `Cell.LIFT` and route systems own travel;
- `Feature.LIFT_BUTTON` is not route travel;
- emergency panels, generated computers, NET terminals and gambling machines keep their existing systems until there is a concrete reason to adapt them;
- new block-like authored devices may use interactive definitions if they do not need to replace door/lift ownership.

When adding block-like interactives:

- keep route semantics out of interactive unless explicitly designed;
- if solidity changes, use existing World dirty helpers or local precedent;
- preserve `room.doors`, `world.doors`, `doorMap`, route anchors and lift normalization;
- never overwrite protected cells casually.

## Billboards

The type system supports:

```ts
{ kind: 'billboard'; sprite: number; scale?: number; z?: number }
```

Current shipped definitions do not use billboard-backed interactives yet.

Use this only when:

- the object is visually larger than a cell feature;
- it must remain an `EntityType.BILLBOARD` or sprite-like prop;
- the interaction target still maps cleanly to one cell/index.

Do not turn every decorative billboard into an interactive. The gameplay path must be reachable and meaningful.

## Adding A New Interactive Object

Example: add a drinkable filtered sink variant.

1. Add a definition to `INTERACTIVE_DEFS` in `src/data/interactive.ts`:

```ts
{
  id: 'sink_filtered',
  layer: 'feature',
  label: 'Фильтр-раковина',
  prompt: ' пить',
  tags: ['water', 'needs', 'sink', 'filtered'],
  visual: { kind: 'feature', feature: Feature.SINK },
  target: { range: 2.25, priority: 67 },
  actions: [
    {
      id: 'drink',
      label: 'Пить',
      kind: 'drink_water',
      cooldownSeconds: 5,
      waterDelta: 36,
      peeDelta: 9,
      message: 'Вы пьете из фильтр-раковины. Вода почти не спорит с горлом.',
      color: '#8df',
      eventType: 'interactive_used',
      eventSeverity: 1,
    },
  ],
}
```

2. Place it from a generator:

```ts
placeInteractiveAt(world, x, y, 'sink_filtered');
```

or:

```ts
placeInteractiveInRoom(world, room, 'sink_filtered', { seed, tags: ['clinic'] });
```

3. Add or update a focused test:

- placement stamps `Feature.SINK`;
- target resolves by `findInteractionTarget()`;
- activation changes needs;
- event carries `interactiveDefId: 'sink_filtered'`.

4. Run validation:

```bash
npm run check
```

No edit should be needed in:

- `main.ts`;
- `render/webgl.ts`;
- broad AI;
- save/load;
- `Feature` enum.

## Adding A New Action Kind

Use a new action kind only when existing handlers cannot express the behavior.

Steps:

1. Extend `InteractiveActionKind` in `src/data/interactive.ts`.
2. Add typed fields to `InteractiveActionDef` only if generic and bounded.
3. Add a focused handler in `src/systems/interactive.ts` or a nearby small module.
4. Route it from `runAction()`.
5. Publish compact events.
6. Add tests.
7. Update this document.

Good action kinds:

- `open_craft_menu`;
- `repair`;
- `toggle_power`;
- `read_screen`;
- `harvest`;
- `deposit_service_item`;
- `purify_water`;
- `rest_short`.

Bad action kinds:

- one-off object names like `use_special_sink_17`;
- content-specific quest branches that belong in a content module;
- renderer-only effects that mutate gameplay state;
- unbounded scans or async timers.

## Adding A New Block Adapter

Use this only after proving the existing owner should remain authoritative.

Example: door adapter for debug or unified prompts.

Rules:

- `Door` remains authoritative for state and lock data;
- instance may store `doorIdx`;
- action delegates to existing door helpers;
- route/lift semantics stay outside this layer;
- no save shape change unless adapter stores durable extra state.

Do not migrate doors just to make the model look pure. The current system is intentionally adapter-friendly.

## Save And Floor Memory

Interactive instance state is transient.

This is intentional because:

- lazy sink/toilet adapters can be reconstructed from `world.features`;
- container adapters can be reconstructed from `WorldContainer`;
- workbench placement is generation-time world state plus transient instance registry;
- craft station identity is stored as `surfaceFlag` bits alongside the feature cell and can be lazily recovered after floor memory restore;
- durable crafting effects live in player crafting state, inventory and recipe sources, not in the interactive instance.

Add persistent interactive state only when an object has durable state that cannot live in an existing authoritative system.

When persistent state becomes necessary:

- add one bounded save section;
- bump `SAVE_SHAPE_VERSION`;
- reject stale saves rather than adding migration scaffolding;
- sanitize malformed current-shape payloads;
- cap instance count;
- cap tags and small state;
- save ids, def ids, cell idx, seed and compact state only;
- never save functions, definitions, world references, entity references or dense per-cell state.

Suggested first caps:

```txt
interactive instances per active floor: 256
tags per instance: 8
small state keys per instance: 8
small state string length: 64
portal compact save instances: 32 or none
```

Floor memory support is not implemented for `WeakMap` interactive state. Add explicit snapshot/restore helpers only when persistent state is introduced.

## Samosbor

Current shipped interactives are safe with the existing approach:

- lazy sinks/toilets follow regenerated `world.features`;
- broken sink/toilet markers are generation-time repair-pending overlays and rebuild with their generated floor unless a future repair system makes them durable;
- containers remain owned by container/floor-memory systems;
- explicit workbenches are generation-time features and may be rebuilt with the floor unless a future module makes them durable;
- craft stations are generation-time features plus `surfaceFlags`; samosbor geometry rebuilds may remove them with the affected area, while floor memory can preserve them when the cell survives;
- player material counts and known recipes are owned by crafting save state and are not reset by local interactive rebuild.

Future durable interactives must declare a samosbor policy:

- `volatile`: removed/rebuilt with generated area;
- `protected`: preserved only in protected authored rooms or explicit anchors;
- `damaged`: survives but changes status, charges, lock, quality or power;
- `sealed`: unavailable while samosbor is active;
- `source`: participates in samosbor behavior.

Do not silently recreate used, looted, broken or destroyed persistent interactives after samosbor unless the object is explicitly volatile generation decor.

## Runtime Ticks

Current shipped interactives do not run a background tick.

Most future interactives should remain event-driven.

Allowed ticks must be bounded:

- no per-frame full-world scan;
- no per-module `setInterval`;
- no per-entity closure allocation in hot paths;
- no JSON parse/stringify in hot paths;
- fixed cadence such as 0.25s, 1s, 5s or 30s;
- scan only registered active instances or a small local radius;
- use `systems/entity_index.ts` for nearby actor queries when needed;
- publish compact events for public facts.

Tick examples that may be acceptable:

- powered machine cools down every 1s;
- faucet leak grows a local hazard on a slow cadence;
- dangerous apparatus pulses every 0.25s with a small actor cap;
- station consumes resource every 5s while active.

## Rendering And UI

Current layer needs no new renderer channel.

It reuses:

- `world.features` for feature-backed visuals;
- `WorldContainer` sprites for containers;
- future `EntityType.BILLBOARD` for billboard-backed objects if needed.

Rendering rules:

- `render/` reads state only;
- action logic stays in `systems/interactive.ts` or focused systems;
- prompt still comes from shared `InteractionTarget`;
- overlay state, if added later, should be owned by systems and rendered as a snapshot;
- no DOM UI for these objects.

Current UI integration:

- `sink_drink`, `toilet_relief`, `sink_broken`, `toilet_broken` and `workbench_basic` are message/event actions;
- `container_adapter` opens the existing container overlay through `openContainerMenu`.
- `craft_lathe` and `craft_lab_bench` open craft mode through `openCraftMenu`.
- `disassembly_workbench` opens disassembly mode through `openCraftMenu`.
- `recipe_billboard` learns recipes through the crafting recipe-source path.

## Debug And Audit

Current debug surface:

```ts
interactiveDebugSummary(world)
```

Current audit support:

- `scripts/content-audit.mjs` counts `interactive defs`;
- it validates static references in `placeInteractive()`, `placeInteractiveAt()` and `placeInteractiveInRoom()`;
- it validates craft station interactive ids and recipe-source references;
- it keeps item `defId` validation intact while recognizing interactive ids in interactive placement contexts.

Future debug additions can include:

- inspect looked-at cell interactives;
- count by def/layer/status;
- debug place/remove by `defId`;
- map-editor interactive brush.

Any debug command ids should be stable and tested if exposed through existing debug menus.

## Tests

Current tests in `tests/interactive.test.ts` cover:

- existing `Feature.SINK` lazily becomes `sink_drink`, including protected apartment feature cells;
- using the sink updates water and pending pee;
- the event log contains `interactiveDefId: 'sink_drink'`;
- `sink_broken` overrides the lazy working sink prompt and does not fill water;
- visible containers resolve through `container_adapter`;
- `container_adapter` delegates to `openContainerMenu`;
- explicit `workbench_basic` placement stamps `Feature.MACHINE`;
- workbench activation emits the expected message;
- feature-backed placement rejects blocked cells.

Craft station and recipe-source integration is covered by focused crafting tests:

- station definitions expose `open_craft_menu`, `open_disassembly_menu` and `learn_recipe`;
- station placement writes matching `surfaceFlags`;
- LIVING has reachable fixed lathe/workbench cells;
- recipe billboard actions resolve `floor_recipe_billboard_basics`;
- crafting integration tests verify station ids, event types, default recipes and recipe sources.

General validation:

```bash
npm run check
```

Use browser validation only when render/UI/mobile/input changes are involved:

```bash
npm run check:browser
```

Future tests should cover:

- cooldown behavior;
- added action kinds;
- new content placement in authored floors;
- persistent state sanitizer if save support is added;
- samosbor transfer/clear behavior if durable state is added;
- debug/map-editor operations if exposed.

## Current Limitations

These are not bugs; they are explicit boundaries of the implemented layer:

- no persistent interactive save section yet;
- no floor-memory snapshot/restore for `WeakMap` interactive state yet;
- no durable repair handler yet; `repair_pending` is currently an inspect/message action;
- no door/lift migration yet;
- no generic terminal/screen overlay adapter yet;
- no billboard-backed shipped definition yet;
- no runtime ticking interactives yet;
- no map-editor interactive brush yet.

Add these only when a concrete playable object needs them.

## What Not To Do

Do not:

- add content-specific calls to `main.ts`;
- add object-specific gameplay to `render/webgl.ts`;
- add a new `Feature` enum for every sink/machine/screen variant;
- add a new `FloorLevel` for an interactive object;
- run per-frame full-world scans;
- create per-module intervals;
- put inventory into `InteractiveInstance` when `WorldContainer` already owns it;
- save full object graphs;
- add save migrations by default;
- silently recreate destroyed persistent objects;
- overwrite protected apartments, hermetic walls, route lifts or required anchors;
- create dead definitions with no placement, lazy adapter, test, event, debug path or visible consequence.

## When To Use This System

Use `InteractiveDef` + placement when the object is:

- cell-bound;
- activated through `E`;
- visible as feature/container/cell/billboard;
- bounded in action cost;
- generic enough to reuse an action kind;
- not an actor, projectile or free item drop.

Do not use this system when:

- the object is an NPC or monster;
- the object is ordinary inventory only;
- the behavior is already fully owned by a special system and there is no benefit in adapting it;
- the interaction needs a broad bespoke overlay and state machine before a generic action can exist.

## Extension Checklist

Before adding a new interactive object:

- choose a stable snake_case `defId`;
- pick an existing visual primitive;
- decide if it is lazy, generator-placed or adapter-backed;
- keep gameplay in action handlers, not render;
- keep durable state in the right owner;
- publish compact events if the action matters;
- add a focused test;
- run `npm run check`.

For source changes, answer:

- What changed and why?
- Where is it visible to the player?
- Which floor/room/generator places it, or what lazy adapter reaches it?
- How does it react to samosbor, or why is it transient?
- Does it touch A-Life, factions, economy, quests, events, save/load, localization or render?
- What cap/cadence/cache/placement-time rule prevents frame-time growth?
- Were docs updated only for shipped facts?
- Which checks passed?

## Design Principle

Interactive objects should make ordinary rooms matter without making the engine heavy. A sink, toilet, stove, shelf, screen or machine should be cheap to draw, cheap to query, easy to place and specific in consequences.

The right abstraction is not a large object framework. It is a sparse cell-indexed gameplay registry over existing world arrays, containers, events and the shared `E` dispatcher.
