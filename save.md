# Save And Persistence Contract

> Центральный документ сохранений.
>
> Роль: фиксирует current-shape save/load policy, payload ownership, sanitization, caps and rejection rules. Для реализации проверяй `src/systems/save_runtime.ts`, `src/systems/save_payload.ts` and the domain serializers they call.

## Policy

The browser save lives in `localStorage` under `gigahrush_save`.

Current authoritative shape:

- `SAVE_SHAPE_VERSION = 21`;
- old or unversioned saves are rejected;
- newer saves are rejected;
- cross-version migration code is not required by default.

ГИГАХРУЩ is in active development. Breaking persistence changes should bump `SAVE_SHAPE_VERSION`, reject stale data explicitly and keep the current shape sanitized.

## Runtime Entry Points

- `src/systems/save_runtime.ts`: shape version, version status, top-level payload creation and runtime section gathering.
- `src/systems/save_payload.ts`: compact payload construction, payload size accounting, portal compaction and section normalization.
- Domain systems own their own compact serializers/sanitizers where possible.

The save is not a full object graph. Save ids, seeds, compact facts and sparse overrides.

## Current Payload Sections

Current runtime save sections include:

- player state, age, sex, inventory, equipment, money, RPG and needs;
- current floor id/key, position and route context;
- `floorRun`;
- `floorInstances`;
- optional `voidReturnPortal`;
- `alife`;
- `alifeMobility`;
- `computers`;
- `netHack`;
- `liftArachna`;
- `pseudolift`;
- `floorMemory`;
- `netTerminalGen`;
- `mapEditorPatches`;
- `worldEvents`;
- `crafting`;
- `demosSocial`;
- `economy`;
- `banking`;
- `stockMarket`;
- `production`.

If a system stores persistent state, it needs a current-shape serializer/sanitizer, a cap or compact representation, and a rejection/test path when shape compatibility changes.

The crafting section stores only the player material bank and known recipe ids: 9 numeric material counts and deduplicated current recipe ids. Item composition and recipe definitions remain data registries, not item-instance save data.

## Sanitization Rules

Current-shape input can be corrupt. Sanitizers should:

- clamp numbers into valid ranges;
- cap arrays and maps;
- reject invalid ids or replace them with safe current defaults;
- preserve only known section fields;
- avoid loading full live entity arrays;
- avoid trusting Russian display names as identity keys;
- avoid JSON parse/stringify in hot runtime paths.

Sanitization is not legacy migration. It keeps the accepted current shape from crashing runtime.

## Floor Memory

Visited route stops are keyed by stable floor identity. Hot entries can keep live `World` objects and parked non-player/non-projectile entities; older entries are packed into byte-aware snapshots.

Browser saves persist the packed floor-memory section when it fits the budget. Restored floor memory is loaded before selecting the active floor.

Samosbor updates the active floor key, not a separate alternate floor:

- active local rebuild mutates/stitches the current world;
- stale parked copy for the same key is dropped;
- the rebuilt active world is captured when the player leaves.

If floor snapshot format or required route identity changes incompatibly, bump `SAVE_SHAPE_VERSION`.

## A-Life

A-Life saves compact identity state, not live NPC arrays:

- seed/count basis for reconstruction;
- up to `65_536` dead procedural A-Life ids;
- dead plot ids;
- sparse changed-record overrides;
- capped mobility state for cold journeys, pending active-floor arrivals and migration cursor/cadence;
- player social/rank inputs through the current player entity state.

Live materialized NPCs fold back before transitions, samosbor rebuilds and save. Ordinary killed people are not silently replaced by background refill.

## Events, Economy And Production

Events use bounded ring buffers and save only compact public/private facts. Economy, banking, stock market and production save sparse runtime state rather than regenerating every consequence from current frame objects.

Production save state is capped by the production system. Economy rows and resource values must sanitize missing or malformed current-version data.

## Portal Boundary

Portal compaction is an external packaging/runtime concern documented in `PRCampaign/portal.md`. The local `gigahrush_save` payload remains authoritative for the normal browser build.

Portal bridges may upload wrapped current-shape data or compact current-shape profiles, but they must not introduce a second gameplay save format inside core game docs.

## Adding Persistent State

Before adding a persistent field:

1. Decide the owning system.
2. Store ids/seeds/facts, not objects.
3. Add serializer and sanitizer in the existing section pattern.
4. Cap arrays and sparse maps.
5. Define behavior for missing malformed current-shape data.
6. Bump `SAVE_SHAPE_VERSION` when old current saves can no longer be read honestly.
7. Add or update tests for save creation, rejection, cap and sanitize behavior.

Do not add migration scaffolding, legacy aliases or compatibility branches unless the task explicitly asks for them.
