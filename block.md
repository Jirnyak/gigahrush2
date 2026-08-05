# Path Blockers System

> Центральный документ текущей 2D-системы подсеточных блокираторов пути.
>
> Роль: описывает shipped first-pass gameplay layer, который не дает игроку и
> обычным акторам проходить сквозь крупные passable-cell objects вроде столов,
> кроватей, шкафов, станков, аппаратов, раковин, туалетов и объемных
> контейнеров. Это не 3D-физика и не mesh collision. Архитектурная граница с
> render-only mesh pass закреплена в [architecture.md](architecture.md) и
> [mesh.md](mesh.md).

## Status

Path blockers реализованы как дешевый активный слой в текущем `World`.

Текущий shipped контракт:

- `World.pathBlockers` хранит 8 row bytes на каждую 1024x1024 клетку;
- `src/core/path_blockers.ts` владеет только primitive storage helpers,
  torus-aware sampling and dirty version bumps;
- `src/data/path_blockers.ts` владеет explicit blocker definitions and
  feature/container mappings;
- `src/gen/path_blockers.ts` rebuilds blocker masks from generated `Feature`
  and `WorldContainer` facts after story, design and procedural floor
  construction;
- player movement and ordinary AI local movement use the shared
  `src/systems/movement_collision.ts` coarse+fine occupancy helper;
- actors that are restored, spawned or caught inside a current blocker mask are
  relocated to the nearest valid coarse+fine occupancy point through the same
  movement helper;
- coarse route/pathfinding remains cell-level and does not become an
  `8192x8192` graph;
- packed floor memory and save payloads do not serialize the full 8 MiB blocker
  field;
- `World.visualSlots`, visual model bounds and mesh scene collection are not
  collision sources.

Not shipped:

- projectile blocking by furniture;
- movable/pushable furniture;
- sparse persistent blocker overrides;
- debug overlay for blocker masks;
- full-cell gate/shutter semantics;
- subcell navigation graph or subcell BFS.

## Problem

Base world solidity is coarse:

- `World.cells` stores floor/wall/door/water/lift/abyss;
- `World.solid(x, y)` answers at integer cell resolution;
- walls, doors, hermetic barriers and lifts are real topology;
- large props in passable cells are ordinary features or containers.

Without a fine layer, a passable floor cell containing `Feature.TABLE`,
`Feature.BED`, `Feature.SHELF`, `Feature.MACHINE`, `Feature.APPARATUS`,
sanitary fixtures or a large container stays fully walkable. The player and
ordinary actors can clip through the object unless the generator turns the
whole cell into wall, which is too coarse and harms reachability.

Path blockers solve only this 2D gameplay problem. They do not replace cells,
rooms, doors, path fields, interactions or render geometry.

## Architecture Fit

This system follows the five-layer contract from [architecture.md](architecture.md):

```txt
core/    primitive blocker storage and row helpers
data/    explicit blocker definitions and feature/container mappings
gen/     stamping and rebuild from generated world facts
systems/ movement occupancy, path-follow checks and runtime rebuild hooks
render/  no ownership
```

Rules:

- `core/` stores bytes and versions only. It does not know that a table exists.
- `data/` declares which feature/container kinds are bulky enough to block
  movement.
- `gen/` stamps blocker masks from current generated features/containers.
- `systems/` asks whether an actor body can occupy a position.
- `render/` reads nothing from blockers and writes nothing to blockers.

The blocker field is derived active-world state. The source of truth remains
cells, features, containers and explicit data mappings.

## Storage

Active storage lives on `World`:

```ts
pathBlockers: Uint8Array;      // W * W * PATH_BLOCKER_ROWS_PER_CELL
pathBlockerVersion: number;    // bumped when row masks change
pathBlockerDirtyVersion: number;
```

Constants:

```ts
PATH_BLOCKER_SUBDIV = 8;
PATH_BLOCKER_ROWS_PER_CELL = 8;
PATH_BLOCKER_BYTES_PER_CELL = 8;
```

Each cell owns eight bytes. Each byte is one 8-subcell row. Bit `0..7` marks a
forbidden actor-center position inside that row.

The array size is:

```txt
1024 * 1024 * 8 bytes = 8 MiB
```

This is acceptable for the active world. It is not acceptable as a full copy in
every visited-floor snapshot.

`src/core/path_blockers.ts` exposes:

- `pathBlockerRowOffset(cellIdx, row)`;
- `pathBlockerSubcell(v)`;
- `getPathBlockerRow(world, cellIdx, row)`;
- `setPathBlockerRow(world, cellIdx, row, mask)`;
- `clearPathBlockersAtCell(world, cellIdx)`;
- `clearAllPathBlockers(world)`;
- `pathBlockedAt(world, x, y)`;
- `markPathBlockersDirty(world)`.

All coordinate reads use `world.wrap()` / `world.idx()` and preserve the
1024x1024 torus.

## Mask Semantics

Blocker masks store forbidden actor-center positions, not raw object pixels.

Generation inflates object shapes by the standard human movement radius:

```ts
HUMAN_BLOCKER_INFLATE = 0.18;
```

That matches the current player/human body scale. Because the stamp is already
inflated, `canActorOccupyFine()` can sample the actor center cheaply:

```ts
canActorOccupyFine(world, x, y, radius) => !pathBlockedAt(world, x, y)
```

The `radius` parameter remains in the API so future larger-body or multi-sample
queries can extend the same helper without replacing callers.

## Data Definitions

Definitions live in `src/data/path_blockers.ts`.

Current shape types:

```ts
type PathBlockerShape =
  | { kind: 'rect'; cx: number; cy: number; w: number; h: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number; width: number };
```

Current definition fields:

```ts
interface PathBlockerDef {
  id: string;
  tags: readonly string[];
  shapes: readonly PathBlockerShape[];
  inflateForHuman?: boolean;
  blocksProjectiles?: boolean;
  fullCellWhenClosed?: boolean;
}
```

Current shipped blocker ids:

- `table_slab_blocker`;
- `desk_blocker`;
- `bed_blocker`;
- `shelf_blocker`;
- `machine_blocker`;
- `apparatus_blocker`;
- `sink_blocker`;
- `toilet_blocker`;
- `crate_blocker`;
- `cabinet_blocker`.

Current feature mappings:

- `Feature.TABLE` -> `table_slab_blocker`;
- `Feature.DESK` -> `desk_blocker`;
- `Feature.BED` -> `bed_blocker`;
- `Feature.SHELF` -> `shelf_blocker`;
- `Feature.MACHINE` -> `machine_blocker`;
- `Feature.APPARATUS` -> `apparatus_blocker`;
- `Feature.SINK` -> `sink_blocker`;
- `Feature.TOILET` -> `toilet_blocker`;
- `Feature.STOVE` -> `machine_blocker`.

Current container mappings:

- wooden chest and weapon crate -> `crate_blocker`;
- metal/medical/filing cabinets, tool lockers, fridge and safe ->
  `cabinet_blocker`.

Tiny or intentionally hidden containers such as cashboxes, secret stashes and
emergency boxes do not block movement in the first pass.

Do not infer definitions from sprite size, visual model bounds or display names.
If an object should block movement, add an explicit data mapping.

## Generation And Rebuild

`src/gen/path_blockers.ts` owns stamping:

- `stampPathBlocker(world, cellIdx, defId, seed?)`;
- `stampPathBlockerDef(world, cellIdx, def)`;
- `stampFeaturePathBlocker(world, cellIdx, feature)`;
- `stampContainerPathBlocker(world, container)`;
- `clearPathBlockerRegion(world, x, y, w, h)`;
- `rebuildPathBlockersFromWorldObjects(world, seed?, cells?)`;
- `rebuildGeneratedFloorPathBlockers(world, seed, spawnX, spawnY)`.

Full rebuild flow:

1. Clear the active blocker array.
2. Scan `world.features` once.
3. Stamp mapped bulky features.
4. Rebuild the container map.
5. Stamp mapped bulky containers.
6. Clear a small spawn-safe region around the player start.

Cell-list rebuild flow:

1. Normalize and dedupe the changed cell list.
2. Clear blocker rows only for those cells.
3. Restamp mapped features on those cells.
4. Restamp mapped containers whose cell is in the changed set.

Stamping skips cells that should not become fine blockers:

- non-floor cells;
- hermetic walls;
- door cells and cells near door thresholds;
- lift cells and cells near lift thresholds;
- lift buttons.

Generators must still preserve ordinary reachability. Fine blockers are local
obstacles, not permission to seal route anchors or shelter exits.

## Runtime Movement

`src/systems/movement_collision.ts` is the shared runtime API:

```ts
canActorOccupyCoarse(world, x, y, radius)
canActorOccupyFine(world, x, y, radius)
canActorOccupy(world, x, y, radius, options?)
findNearestActorOccupyPosition(world, x, y, radius, maxCellRadius?)
unstuckActorFromBlockers(world, entity, options?)
```

`canActorOccupy()` combines:

- existing four-corner coarse `world.solid()` checks;
- fine `pathBlockedAt()` center sampling.

Options:

- `ignoreCoarseSolids`;
- `ignoreFineBlockers`.

Use those options only for explicit phasing/noclip behavior that already has a
gameplay reason. Do not bypass fine blockers just because a caller is
inconvenient.

Movement should keep X/Y separation where possible so actors slide along
furniture instead of sticking on the first failed diagonal.

Actor depenetration is a generic safety net, not furniture-specific content
logic. It is used when the actor's current center is invalid under
`canActorOccupy()`, for example after floor memory restore, late blocker
rebuild, samosbor geometry replacement, a monster-specific move hook or an
authored spawn lands inside a table/decor mask. The search first tries clear
subcell positions in the current cell, then expands in a bounded toroidal ring
and chooses the nearest valid coarse+fine occupancy point. A successful move
clears stale AI path progress so the actor does not keep walking toward a path
that began inside the obstacle.

## AI And Pathfinding

Fine blockers are not a second navigation world.

Current rule:

- route/path fields remain coarse cell-level;
- local path following and final movement checks use `canActorOccupy()`;
- ordinary flee/knockback/local motion goes through the same helper;
- navigation cache invalidation may observe blocker dirty versions, but it must
  not allocate a full subcell graph.

This keeps the active floor honest without multiplying pathfinding memory by 64.

Allowed future extension:

- a cheap `cellHasUsableFinePassage(world, cellIdx)` helper for local costs;
- actor-local steering around a nearby blocker;
- explicit full-cell coarse topology only for objects that truly behave like
  gates/walls.

Forbidden:

- `8192x8192` BFS;
- per-actor subcell path jobs;
- renderer-driven movement avoidance;
- treating visual mesh density as navigation cost.

## Save And Floor Memory

Path blockers are deterministic from current persisted facts:

- cells;
- features;
- containers;
- route/floor generation seed and object profiles.

Therefore the full `pathBlockers` array is not serialized in:

- top-level browser save payload;
- packed floor-memory snapshots.

When a live `World` is kept hot in memory, it naturally keeps its active blocker
array. When a world is restored or regenerated from persisted facts, blockers
are rebuilt from those facts.

If future gameplay creates independently mutable blockers that cannot be
derived from features/containers, add capped sparse overrides such as:

```ts
{ cellIdx: number; rows: readonly number[] }
```

Only then update save payload/floor memory and bump `SAVE_SHAPE_VERSION`.
Do not add legacy migration scaffolding by default.

## Samosbor And Runtime Geometry

Samosbor, breach charges, beam cutting, container changes and anomaly runtime
mutations can change geometry, features, containers or route-critical space.
Blockers must follow the same dirty discipline as cells/surfaces:

- clear blockers in bulldozed or opened regions;
- restamp blockers after regenerated features/containers appear;
- bump `pathBlockerVersion` only when masks actually change;
- do not leave stale blockers inside newly opened corridors, door paths, lift
  buffers, spawn-safe cells or shelter exits;
- do not mutate `aptMask`/protected apartments just to satisfy blocker cleanup.

Samosbor is not exempt. The active post-samosbor world must have blocker masks
that match its current features and containers.

## Mesh Boundary

`mesh.md` owns the decorative WebGL mesh pass. `block.md` owns gameplay
movement blockers.

Allowed cooperation:

- one generator may place a visual slot and a blocker for the same table;
- one data domain may map an object to both a visual model and a blocker def;
- tests or future debug overlays may compare visual positions and blocker rows.

Forbidden:

- deriving blockers from `World.visualSlots`;
- deriving blockers from `VisualModelDef.bounds`;
- making mesh collection stamp, clear or mutate blockers;
- making render own collision/pathfinding/movement decisions;
- serializing visual slots or blocker arrays as gameplay truth.

If a mesh object should become physical, add or reuse an explicit blocker
definition and stamp it from generation/system facts. Do not reuse render bounds
as physics.

## Interactions

The shared `E` layer remains feature-first:

- features and containers are generated as world facts;
- interactives attach behavior to those facts;
- blockers can separately make bulky facts impassable.

An object can be visible, interactable and blocking at the same time, but those
are three contracts:

- render/sprite/mesh decides how it looks;
- `systems/interactions.ts` decides what `E` does;
- path blockers decide whether an actor center can stand there.

Do not couple interaction count or behavior to blocker mask shape.

## Tests

Current focused tests:

- `tests/path-blockers-core.test.ts`;
- `tests/path-blockers-data.test.ts`;
- `tests/path-blockers-stamping.test.ts`;
- `tests/path-blockers-generation.test.ts`;
- `tests/path-blockers-movement.test.ts`;
- `tests/path-blockers-storage-policy.test.ts`.

Important related coverage:

- `tests/mesh-scene-collect.test.ts`;
- `tests/visual-cell-slots.test.ts`;
- `tests/floor-object-placement.test.ts`;
- `tests/samosbor-shelter.test.ts`;
- `tests/samosbor-wave.test.ts`;
- `tests/procedural-anomaly-counterplay.test.ts`;
- `tests/procedural-floors.test.ts`;
- `tests/sprites-floors.test.ts`.

Minimum validation after blocker movement/generation changes:

```bash
npm run typecheck
npm run test:unit
npm run test:generation
npm run content:audit
npm run check
npm run check:browser
```

Docs-only edits can use `git diff --check` when practical.

## Extension Rules

When adding a new bulky object:

1. Add or reuse a `PathBlockerDef` in `src/data/path_blockers.ts`.
2. Add a feature/container mapping only if the object is meant to block
   movement in gameplay.
3. Ensure generation places the object as a real feature/container first.
4. Rebuild blockers through `src/gen/path_blockers.ts`, not through render.
5. Add a focused test for the mapping or stamping rule.
6. Run the validation gate appropriate to generation/runtime risk.

When adding runtime geometry mutation:

1. Identify the changed cells.
2. Clear or rebuild blocker rows for that bounded cell list/region.
3. Preserve route anchors, door thresholds, lift buffers and protected rooms.
4. Bump dirty versions through existing helpers.
5. Add a test that stale blockers are removed or restamped.

When adding a future mutable blocker state:

1. Define why it cannot be derived from cells/features/containers.
2. Store sparse row overrides, not a full array.
3. Cap the override list.
4. Update save/floor-memory sanitizer and shape version.
5. Add malformed-current-shape tests.

## Archived Batch

The old parallel implementation prompts `block_0.md` through `block_6.md` are
not active source of truth after the orchestrated implementation. They belong in
the external archive:

```txt
../gatbage/history/batches/block/
```

Use this `block.md`, [architecture.md](architecture.md), [mesh.md](mesh.md),
[README.md](README.md), current `src/` and focused tests for shipped facts.
