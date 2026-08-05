# GIGAHRUSH Modular Architecture

> Центральный документ архитектуры.
>
> Роль: описывает крупные системы игры и то, как они стыкуются: 1024x1024 toroidal `World`, typed arrays, flat entities, rooms, items, monsters, NPC, projectiles, traces, samosbor, path fields, save/runtime state, generation, systems and render. Главные принципы: универсальность, минимализм, модульность, процедурность, комбинаторность, оптимизация, отсутствие hardcoded content paths and honest emergence.

Purpose: turn the current TypeScript/Vite raycaster game into a content factory where many agents can add rooms, NPCs, quests, events, monsters, documents, economy hooks, and floor variants without fighting over the same files.

This document is based on the current code, `README.md`, and `desdoc.md` as of 2026-05-24, with later active system contracts split into root domain docs. It is not a rewrite plan. The project is already playable; architecture work must protect that.

## 1. Current Fact Map

The real project shape is:

```txt
src/
  core/       low-level constants, enums, World, shared state shapes
  data/       definition registries: items, weapons, plot, economy, permits, terminals, variants
  entities/   monster definitions and procedural sprite generators
  gen/        floor generators and hand-made content modules
  systems/    runtime logic: AI, quests, samosbor, factions, events, inventory, save/runtime state
  render/     raycaster/WebGL/HUD/map/log/canvas overlay rendering
  input.ts    input state
  main.ts     browser entry point, game loop, floor switching
```

Critical runtime facts:

- `World` is data-oriented: packed `Uint8Array`, `Int16Array`, `Float32Array`, sparse maps only where needed.
- `entities` is a flat array of plain objects with optional component fields. There are no entity subclasses.
- The world is a 1024x1024 torus. All coordinate work must use `world.idx`, `world.wrap`, `world.delta`, or `world.dist`.
- Floor generators return `{ world, entities, spawnX, spawnY }`.
- Normal lift travel uses `systems/procedural_floors.ts` as a per-run vertical route across `z=-50..+50`. Existing `FloorLevel` values remain 6 story/base floors; authored design floors are 41 string-id route stops from `src/data/design_floors.ts`; unoccupied route positions are 54 seeded procedural/fallback specs with `z`, seed, geometry, main faction, anomaly and danger. Down decreases `z`; `VOID` is the final lowest stop at `z=-50`, `darkness` is the dark endgame route floor at `z=-48`, `podad` is the Herald-gated Hell route floor at `z=-40`, `underhell` is at `z=-38`, and `roof` is the highest stop at `z=+50`.
- `systems/floor_memory.ts` keeps visited route stops alive by stable floor key. Hot entries keep their own live `World` object plus non-player/non-projectile entities; older entries are packed into RLE snapshots instead of being lost, so decals, bullet/blood marks, containers, opened doors and monsters survive ordinary floor travel for that exact floor. UI-only map exploration survives while its live `World` object survives, but packed/save restoration can restart exploration for the restored world. Browser saves include the packed floor-memory section and restore it before selecting the active floor; samosbor/rebuild paths update the active `World` and drop only stale parked memory for that same key.
- Desktop input treats `Esc` as browser/pointer-lock territory by default, not as a gameplay/window key, though the hotkey table can still store `Escape` like any other captured code. `Enter` opens the game menu from normal gameplay and is the keyboard accept/confirm key inside canvas menus, while LMB accepts the selected row only when a canvas menu is open. RMB closes or steps back from open canvas menus including Net Sphere, and mouse wheel is menu up/down navigation except where a focused terminal uses it for history scroll. In Net Sphere, `Enter` selects the chat line when inactive and submits the current line when active, `Space` stays chat text input only while the chat line is active, `Backspace` erases chat only while chat input is active, `N` closes only when chat input is inactive, `Delete` closes the terminal, and mouse wheel / `PageUp` / `PageDown` / arrow keys scroll the loaded chat history. Top-level shortcut menus, including the `F1` HELP poster, open only from normal gameplay; the same shortcut closes its own panel when no text input or key-capture field is active. Handled window keys are consumed so they do not fall through to the game menu. `E` is the default in-world interaction binding for pickups, doors, NPCs, containers and aimed interactables. Keyboard and mouse-button capture is universal: ordinary keys, `Space`, `Backspace`, `Esc`, LMB/RMB/MMB and extra mouse buttons are represented as control codes and can be assigned to any action.
- `main.ts` owns the game loop and calls systems in fixed order.
- `systems/camera.ts` owns transient runtime camera modes and resolves them to `CameraView` for render. The death camera is one mode of this system; future free-camera and cinematic modes should plug into the same API.
- `systems/events.ts` is the current EventBus analogue: fixed-size ring buffers, public event publication, and query filters.
- Shared `E` interaction goes through `systems/interactions.ts`; generated gambling machines, local computers, NPC table-game interfaces, NET-hack terminals, emergency panels, Net Terminal Gen and special floor interactions plug into that dispatcher.
- `systems/interactive.ts` is the generic sparse cell-bound interactive layer. Definitions live in `src/data/interactive.ts`, explicit generation helpers live in `src/gen/interactive_placement.ts`, broken fixture placement lives in `src/gen/interactive_fixtures.ts`, and one `ContentInteractionHook` exposes feature-like objects and container adapters to the shared dispatcher. Current shipped adapters are transient: lazy `Feature.SINK` drinking, lazy `Feature.TOILET` needs relief, repair-pending broken sink/toilet fixtures, explicit `workbench_basic` placement and visible `WorldContainer` delegation. `src/data/floor_object_placement.ts` defines story-floor, design-route and procedural-geometry profiles for static decor features, explicit interactives, broken fixture overlays and craft-station subprofiles; `src/gen/floor_object_placement.ts` applies them once during generation through reachable bounded placement. Complex runtime-owned objects such as moving trains stay in their authored/anomaly systems. The contract is feature-first: floor generators own how many visual primitives exist and where they are, while `InteractiveDef` ids own what `E` does when a matching primitive is targeted. They do not change save shape.
- `systems/alife.ts` owns persistent procedural NPC identity. A run creates a compact NPC pool around `100_000` procedural identities within a `131_072` technical capacity, materializes only the active floor into live `entities`, folds live state back on transitions/rebuilds/saves, and records permanent deaths. Browser saves keep dead procedural A-Life ids with a current cap of `65_536`. Age is stored as a byte column and sex as a byte code column in the cold pool; snapshots expose ordinary `number`/`CharacterSex` values for Demos, quests, AI and UI. `systems/npc_relations.ts` owns compact personal relation-to-player math shared by A-Life, quests and hostility. `alife.md` is the detailed design contract for this feature.
- Save/load uses `systems/save_runtime.ts` and `systems/save_payload.ts`. Current save shape version is `21`; old or unversioned saves are rejected rather than migrated. `save.md` is the detailed persistence contract.
- Existing content extensibility already exists in `registerSideQuest`, `registerZoneContent`, floor content manifests, `SAMOSBOR_VARIANTS`, `getSamosborBeatDefs()`, contract/economy registries, route/design-floor ids and `publishEvent`. `samosbor.md` is the detailed samosbor contract.

## 1.1 Project Bible And Honest Scope

The core premise is one honest current-floor simulation. The loaded 1024x1024 toroidal `World` is the real surface where materialized NPCs, monsters, projectiles, rooms, factions, containers, route cues and samosbor effects coexist. The current AI foundation is the full-pass model: `updateAI()` runs one pass over the indexed live-AI list every simulation frame. Systems may use broadphase indexes, whole-floor navigation fields, dirty versions, cached target scans and actor-local cooldowns for expensive choices, but active-floor simulation must not depend on player proximity tiers, hot/cold actor classes or a player-centered spawn bubble.

Storage order is not simulation truth. `world.rooms`, `entities`, `world.zones`, lift anchors, factories, resources, route arrays and registry definitions are storage surfaces; their current order is not physical law, social priority, route pressure, economic priority or AI preference unless a data contract explicitly says the order is authored priority. "First N" over a live/runtime collection is not an optimization by itself; it is a hidden hardcode unless it is rotated, spatially local, actor-keyed, cursor-based, scored before truncation or explicitly ordered by authored data.

The player is an entity reference, not an `EntityType` and not an entity-side control flag. Runtime `player` points at the live actor currently being played; the native player body is an NPC-shaped entity with `persistentNpcId: 'player'` for save/floor-boundary reconstruction, and PSI possession can temporarily swap `player` to another actor. Input, camera, HUD, inventory, needs and save payload creation read that current player entity, while combat, faction hostility, damage, events, A-Life rank/karma and toroidal spatial math stay entity-oriented whenever possible. Possession is not a hidden player-attribution layer: unless a future PSI effect explicitly adds a psychic signature, consequences remain attached to the acting entity because the world is isotropic. Runtime camera state is a transient systems layer over the current player entity: player-follow, death camera, free camera and cinematic camera resolve to the same view shape without changing the entity model. Isotropy means shared mechanics and world math across the whole active floor: player proximity affects rendering/camera/HUD only, not whether an actor receives AI. New mechanics should treat player-only branches as integration exceptions, not as the default design shape.

High-density floors should treat actors as dynamic particles over a small faction field. Ordinary NPCs and monsters use the same short actor step across the map: keep current intent/target, choose or retain a hostile faction target through cached local scans, move, hit or fire a physical projectile, and write consequences. This is not a synchronized crowd shortcut: materialized NPCs keep their own A-Life identity, faction, relation to the player, role, current intent, loadout, target memory and foldback consequences. The consequence data must be real even when rendering is coarse. The current active-floor soft cap is one shared 4096 NPC+monster actor pool; item drops, billboards and projectiles use one shared 65536 floor-object pool.

The macro building is persistent route identity, not full hidden realtime simulation. `FloorRun` spans `z=-50..+50`, starts at `LIVING`/`z=0`, and keys every story, design, procedural and numbered-lift floor. Visited floor state survives through floor memory and bounded packed save snapshots when it fits the save budget. Off-floor NPCs do not pathfind, fight, tick needs or scan rooms; only explicit bounded migration, caravan, quest, faction, economy or event passes may change them. Current shipped macro comes from folded live state, deaths, saved overrides, bounded cold A-Life migration, caravan/economy/faction events and contract targets.

Each route stop should behave like a small world package: own generator, route role, population field, NPC/faction mix, monster pressure, POIs, local rules and reachable player decisions. Route depth and `abs(z)` increase pressure through samosbor timing, population profiles, procedural danger, anomaly pressure and design overrides, not through a single monotonic hardcoded danger formula.

## 1.2 Room, Territory And Floor Theme Hierarchy

The living simulation uses three nested spatial systems. They are not alternatives and should not duplicate each other's authority.

1. Micro room function.

   The smallest meaningful social/gameplay unit is `Room`: `roomMap`, `RoomType`, doors, fixtures, containers and feature/interactable overlays. Room type answers "what can happen here": living rooms support sleep, hiding and household life; kitchens support food/water; bathrooms support toilet/water relief; production rooms and offices support work; medical rooms support healing; storage rooms support loot and supplies; common/smoking/HQ rooms support social, patrol, faction and shelter behavior. The data-only `src/data/room_affordances.ts` registry is the shared API for this micro-room meaning. NPC utility may score these rooms by need, occupation, intent, family room, assigned work room and samosbor emergency state. Player-facing interactables attach to room features through the generic `E` dispatcher. A room does not own political truth by itself: it is an affordance surface, not a faction system.

2. Cell territory and faction zones.

   The authoritative ownership field is `world.factionControl` per cell. `Zone` metadata is a coarser aggregate for UI, danger, event context, HQ anchors and floor-scale summaries, and must be synchronized from the cell field when ownership changes. `territoryRoomOwner()` derives room ownership from the dominant owner of its mapped cells, so room access and NPC routine targeting depend on territory, not on the room name or floor label. Ordinary NPC routine life should prefer or require friendly territory for work, social, patrol and owned-room targets; exceptions must be explicit gameplay states such as travel, raid/capture pressure, quest, caravan, samosbor emergency, monster pressure, hack backlash or authored scene. Faction spread is bounded local pressure over cells through `systems/territory.ts`/`systems/factions.ts`, not a per-frame whole-map ownership rewrite.

3. Floor theme and route package.

   The broadest level is the story/design/procedural floor identity: `FloorLevel`, `DesignFloorId`, `ProceduralFloorSpec`, route `z`, `baseFloor`, `majorityId`, danger, anomaly and local generator package. This level answers "what kind of floor is this": Ministry can start with liquidator/administrative control, Kvartiry and Living with citizen habitation, wild/88 floors with wild control, meat lower floors with monsters/cult/samosbor pressure, NII floors with scientists, and so on. The floor theme owns initial geometry, population profile, target territory shares, monster pressure, object profiles, special NPCs, leaders, quest content and authored rules. It must not hardcode every room decision in AI. Once the floor exists, current per-cell territory and rooms are the live truth; samosbor, capture events, quests and floor memory may change them.

   `src/data/floor_theme_profiles.ts` is the read-only composition layer for these broad facts: it assembles route key, base floor, danger, NPC allowance, territory shares, population profile id, object tags, monster pressure tags and special-content tags from existing registries without owning generation or runtime decisions.

Generation and runtime order follows that hierarchy:

- Generate route-floor geometry, rooms, doors, fixtures, POIs and authored anchors first.
- Apply floor theme data: population profile, target territory shares, majority/anomaly pressure and authored special content.
- Initialize/synchronize `world.factionControl` and `world.zones`; room ownership is derived from cells.
- Materialize A-Life/NPC templates into the active floor using room affordances plus territory preference.
- Runtime AI reads room function and territory each decision cycle; faction capture mutates cells on a bounded cadence; render and HUD only display the result.

Do not collapse the hierarchy:

- Do not treat `RoomType` as ownership.
- Do not let floor theme bypass live territory for ordinary NPC routine behavior.
- Do not put floor-specific faction or leader logic in generic AI, `main.ts`, `core/world.ts` or render.
- Do not create off-floor room/need simulation; off-floor changes are compact A-Life/faction/event facts.
- Do not make rooms usable by unrelated factions as routine life space unless the mechanic explicitly describes trespass, occupation, trade, invasion, shelter panic or another visible exception.

## 2. Non-Negotiable Invariants

These are the rules every new module must preserve.

- No new runtime dependency unless there is a measurable reason and an owner for integration.
- No large refactor before content delivery.
- No content-specific logic in `main.ts`, `core/world.ts`, `render/webgl.ts`, or `systems/ai/index.ts`.
- No direct dependency on another agent's unmerged module. Communicate through ids, registries, or `publishEvent`.
- No per-frame content scanning unless bounded by cooldown, radius, cap, or ring buffer.
- No gameplay-visible fixed-prefix scan over runtime collections. A bounded scan over rooms, entities, zones, anchors, resources, factories, quests, candidates or registries must use a fair window/cursor/spatial query or score candidates before truncation. Порядок хранения не должен становиться физикой мира.
- No coordinate math that ignores toroidal wrap.
- No generator that seals a room without proving it is reachable.
- No permanent POI on LIVING without `aptMask` protection and a corridor/door connection.
- Feature-like gameplay must use the feature-first overlay contract: generate/map `Feature`, `Cell`, container or billboard primitives first, then attach or lazily resolve `InteractiveDef` behavior. Do not couple the number or placement of decor fixtures to interaction action code.
- README is implementation fact. `desdoc.md` is roadmap and tone. Root domain docs such as `samosbor.md` and `save.md` describe active systems, and `problems.md` tracks problematic non-system mechanics. This file is the engineering contract.
- Save compatibility is not sacred. Breaking save shape changes should bump the save shape version and reject stale saves explicitly instead of carrying legacy migrations.

### Storage-Order Bias Is Forbidden

The project uses flat arrays and typed arrays because they are fast and simple, not because their insertion order should drive emergence. Any system that uses a cap must preserve the same simulation promise as an uncapped version would have at a larger budget.

Forbidden examples:

- routine AI checks only `world.rooms[0..95]`;
- arrivals, shelters or route systems use `anchors[0]` when no preference exists;
- economy, faction or quest code treats the first matching factory, zone, resource or NPC as the natural winner when the order is just registry/storage order;
- monster or NPC scans check the first N `entities` without an actor-local cursor, spatial index or deterministic offset;
- generation creates reachable gameplay only because a later full-map pass accidentally touches the early rooms first.

Allowed bounded patterns:

- actor-local rotating cursor or cached scan offset;
- deterministic start offset keyed by actor id, intent, floor key, seed or route id;
- spatial index/radius query with a cap, then score inside the result;
- reservoir or weighted sample before final scoring;
- full or broad candidate scoring followed by a top-N slice;
- explicit authored priority documented in data, such as plot step order.

Review requirement: when touching AI, A-Life, economy, factions, quests, migrations, shelters, route anchors, generation connectivity or broad runtime scans, search for `.slice(0`, `candidates[0]`, `.find(...)`, `SCAN_CAP`, `ROOM_CAP`, `ANCHOR_CAP`, `for (const room of world.rooms)` and `for (let i = 0; i < entities.length`. If the collection is not fully scanned or fully scored, the code must show why storage order cannot become gameplay behavior.

## 3. Layer Contract

The project should stay in five layers.

```txt
Definitions  ->  Generation  ->  Runtime Systems  ->  Render/UI
       \              \              /
        \              Event Store  /
         Core Types + World Arrays
```

`core/`

- Owns primitive shape only: enums, interfaces, `World`, constants.
- Changes here are cross-project changes. They require an integration task.
- Prefer string ids in new definitions before adding enums.
- Render-only typed arrays such as `World.visualSlots` may live here only as primitive storage and dirty versions. They must not own render policy or gameplay semantics.

`data/`

- Owns declarative content: ids, weights, rewards, text, spawn rules, prices, recipes, variants.
- No world mutation here.
- No frame logic here.
- Definitions should be plain objects or readonly arrays.
- Visual mesh definitions live here as data-only registries: visual cell codes, model definitions, geometry profiles and surface profiles.

`gen/`

- Owns construction: rooms, corridors, POIs, initial NPC/item placement, floor-specific content.
- Content modules mutate `World` once during generation or samosbor rebuild.
- Agents should mostly add new files here.
- Floor-wide placement should use the shared placement field in `src/gen/population_placement.ts` instead of choosing ad hoc clusters.
- Routed design floors use `src/data/design_floor_population.ts` and `src/gen/design_floors/population.ts` for their broad NPC/monster fields after route-scale geometry is finalized; local generators still own named NPCs, authored encounters and floor-specific rooms.

`systems/`

- Owns generic runtime behavior.
- Systems must consume definitions, not hardcode one module.
- Systems must publish important state changes through `publishEvent`.
- Camera modes belong in systems and resolve to small view data: position, yaw, pitch shear, height and FOV. They are transient unless a future feature explicitly defines persistent camera data and save caps.
- Runtime floor memory is a systems concern. Route stop identity, visited keys and lift anchors are generic route facts; generators provide initial worlds, and route lift normalization may carve a bounded access connector when that is needed to preserve same-coordinate lift continuity between adjacent floors.
- A-Life population is a system concern, not generator state: generators may create ambient NPC templates, but `systems/alife.ts` assigns persistent procedural NPC identity and decides which live NPCs exist on the active floor.
- Cell territory ownership is a systems API: runtime owner reads use `territoryOwnerAtIndex()`, `territoryOwnerAt()`, `territoryFactionAt()` or `territoryRoomOwner()`, while runtime writes use `setTerritoryOwnerAtIndex()`, `setTerritoryOwnerAt()`, `paintRoomTerritory()` or bounded `paintTerritoryDisc()` and then sync affected zone metadata.
- Shared AI navigation should stay field-based at runtime: `systems/ai/pathfinding.ts` bakes the current 1024x1024 world geometry into a reusable BFS navigation tree, then layers cached behavior flow fields over target source sets such as kitchens, toilets, workplaces or shelters. New generic AI behaviors should provide a source set and reuse that field layer instead of queuing per-actor BFS jobs.

`render/`

- Reads state and draws.
- Consumes `CameraView` from systems; it must not decide which camera mode is active.
- Visual feature additions should be data-indexed: texture id, sprite id, mark type, HUD flag.
- Item visuals derive from `defId` through the procedural item sprite renderer; do not store static item sprite ids in save payloads.
- The render-only mesh pass is documented in `mesh.md`. It reads `World`, `CameraView`, `visualSlots`, features, containers, corridor topology and resolved floor/generator profiles, then draws bounded low-poly corridor-covering/voxel detail after the raycaster and before sprites. It must not mutate gameplay, collision, save or floor memory truth.
- Do not put gameplay decisions here.

### Mesh And Fine Blocker Boundary

`mesh.md` is the active contract for the shipped decorative mesh pass.
`block.md` tracks 8x8 subcell gameplay blockers. The shipped first pass uses
core `World.pathBlockers` storage, explicit data definitions, generation-time
feature/container stamping and shared coarse+fine movement occupancy. Projectile
blocking, movable furniture, debug overlays and subcell pathfinding are still
future work.

These systems must stay separate:

- `World.visualSlots` and visual model bounds are render inputs, not physical blockers.
- Path blockers use an explicit gameplay field and must use explicit blocker definitions when object stamping is added.
- A generator may stamp both a visual slot and a blocker for the same table only through explicit mappings.
- Renderer code must never own collision, pathfinding or movement decisions.
- Fine blockers must not turn active-floor pathfinding into a full subcell graph; coarse route/path fields remain cell-level unless a later measured task proves a need for local steering.

### Field Generation Contract

The 1024x1024 floor is a toroidal field. Floor generation should first build the designed structure, rooms, zones, lifts, POIs and authored anchors, then derive one or more smooth placement fields from that completed world state.

Use `src/gen/population_placement.ts` for floor-wide scattering:

- A `PlacementFieldProfile` combines room weights, zone weights, optional anchors and procedural value noise.
- The field is a dense 1024x1024 `Float32Array` over floor cells and is smoothed locally through neighboring floor cells.
- Sampling uses coverage strata over the whole floor so high weights create broad density gradients instead of hard piles.
- This is generation-time field sampling, not runtime buckets, not per-cell spawn caps, and not a content-specific exception.

Special rooms and authored POIs should influence the field with weights or anchors. They should not own broad population placement by directly pushing hundreds of entities into a small room or arena. Local scripted encounters can still spawn bounded local groups when that group is the gameplay object.

### A-Life Integration Contract

Persistent A-Life is a pillar system, not another spawn table. The shipped target is a seed-sized population around `100_000` procedural NPC identities on every supported runtime, with `131_072` as technical capacity. Future work must preserve that as a compact persistent identity pool instead of promising a million fully simulated live actors.

The identity boundary is:

- `systems/alife.ts` owns ordinary human NPC identity, death, changed-record overrides, floor assignment and materialization.
- `systems/npc_relations.ts` owns personal NPC relation constants and helpers; faction systems consume it for hostility and penalties instead of duplicating thresholds.
- `gen/` owns geometry, rooms, POIs, monsters, loot and placement templates.
- `systems/ai/` owns behavior for live actors only.
- `systems/events.ts` owns public facts that other systems can react to: deaths, rank changes, migration, family consequences, missing quest givers and population events.
- `render/` reads A-Life facts for display and must not decide who exists.

Activation lifecycle:

1. Run start builds the route-aware population plan, then creates or restores the deterministic A-Life pool.
2. Floor generation may create ambient ordinary NPC templates.
3. Floor activation removes those templates and materializes existing A-Life records into their slots.
4. Active-floor AI, combat, trade and quests run on the materialized entities.
5. Floor transition, samosbor rebuild and save fold touched live state back into the pool.
6. Death marks the persistent identity dead. The missing person is not replaced by refill logic.

Materialization is slot-based. If a floor has thousands of assigned A-Life records, that does not mean thousands of live `entities` must be pushed into the runtime array. The active floor is bounded by generation templates, placement fields, authored anchors and explicit events. Dead slots stay empty unless a named event migrates or introduces a specific person.

Ordinary background refill is forbidden:

- No timed refill-to-cap for human NPCs.
- No generator-side identity creation after A-Life materialization.
- No silent replacement of a killed persistent person.
- No monster refill just because a count dropped.

Allowed new actors must declare their reason:

- Samosbor, lift, quest, faction, caravan, hack backlash or authored event actors may spawn as bounded encounters.
- If such an actor is an ordinary person who can persist after the event, they should be assigned or reserve a persistent identity.
- If the actor is temporary pressure, the event system owns its lifetime and it must not masquerade as population refill.

Quest and authored NPCs should migrate toward the same identity model. Current `plotNpcId` keys are stable authored identity; future quest logic should prefer `persistentNpcId`/reserved A-Life ids over transient live entity ids. Any suitable persistent NPC can be a quest source; "quest giver" is a current role/affordance, not a separate NPC caste. Killing a quest giver is a world fact and should be resolved through data-defined fallback content, not by respawning the same giver.

Personal relation is separate from faction relation but uses the same hostile threshold. A materialized NPC initializes `playerRelation` from its faction attitude plus deterministic fluctuation; player damage lowers the individual relation, and quest completion raises the giver's personal relation more than the faction's small normal gain. The field must fold back through A-Life overrides so grudges and gratitude survive floor travel.

The player is also an A-Life actor for shared social math: `karma`, kill counters and rank score live on the current player entity, with `playerRelation = 100` for self-relation. The native player body is not counted as an ordinary NPC pool slot, but the top-100 A-Life rating includes the player with a real rank among alive persistent NPCs. Systems that need "the player right now" should use the runtime `player` entity or `isPlayerEntity()` identity check; systems that need the native body/save identity should resolve `persistentNpcId: 'player'`.

Off-floor NPCs are frozen by default. They do not pathfind, fight, tick needs, scan rooms or update per frame. Only bounded aggregate events, migrations or slow batch passes may change off-floor state, and those changes must be recorded as compact facts or overrides.

Cleared floors remain meaningfully changed, but they are not sealed forever. They can receive explicit migrants, overflow residents, caravans, refugees or faction arrivals. If such migration reaches the active floor, new arrivals should enter through believable anchors such as lifts or route entrances.

Current implementation gaps are explicit: generated contract givers can still be transient or synthetic ids instead of stable `persistentNpcId`; some authored plot NPC generators still use `plotNpcId` live actors instead of fully materializing from reserved A-Life records, though the Hell holdout Major Grom arrival now binds to its reserved A-Life record; there is no separate slow off-floor A-Life batch for family/friend/rank consequences yet.

The save model is deterministic pool reconstruction plus sparse state:

- Save seed, population version/count, up to `65_536` dead procedural ids, dead plot ids and bounded changed-record overrides.
- Do not serialize the full live `entities` array.
- Do not serialize every full NPC record when seed reconstruction is enough.
- Any change to population allocation, route floor keys, required identity fields or plot/reserved id mapping must bump save shape or explicitly reject stale saves.

### Floor Memory Contract

Route stop identity is string-keyed and shared by floor memory, A-Life, map-editor patches, route cues, events and debug:

- Story anchors use `story:<id>`.
- Authored design route floors use their `DesignFloorId`.
- Procedural route stops use their `ProceduralFloorSpec.key`.
- Numbered lift anomalies use `floor_instance:<id>`.

Ordinary lift travel must not regenerate an already visited route stop during the same runtime session. On departure, `main.ts` captures the current floor after departure-side effects and before replacing the active world. On arrival, `main.ts` first asks `systems/floor_memory.ts` for that route key; if present, the stored world/entity array for that exact key becomes active again, otherwise the normal generator runs from the route seed. Story and design floor manifests seed-scope their generator calls from the same run seed; new generation code should prefer explicit `RandomSource` inputs or stay inside that manifest seed scope. Memory is not a global decal/entity layer: a mark, opened door or monster on `story:living` cannot appear on a design or procedural route stop unless that stop separately produced it.

Samosbor semantics are update-in-place from the memory system's point of view on every floor. The normal path starts from a random mutable source point on the current map, runs a bounded local wave, keeps the active `World`, and splices/regrows only the affected generated area from the current story/design/procedural/floor-instance generator through the same two-phase loading gate used by heavy transitions. If a local wave cannot start, the runtime still has a heavier rebuild fallback, so docs and tests should treat local splice as the intended path rather than the only possible path. Floor memory only removes a stale parked copy for the active key if one exists; the post-samosbor active world is the new floor state that will be captured when the player leaves. Timing is route-depth based: active duration is a random 30 seconds to a depth-scaled cap up to 15 minutes at `abs(z)=50`, while cooldown is the inverse random interval from up to 30 minutes near `z=0` down to 1 minute at `abs(z)=50`.

The memory store is byte-aware. The active floor is always a full live `World`; hot inactive floors stay as live `World` objects while the memory budget allows it, and older visited floors are converted to packed RLE snapshots. Browser saves persist that packed floor-memory section with the rest of the current save shape, so save/load restores visited floors before choosing the active target floor. If the floor snapshot format changes, bump `SAVE_SHAPE_VERSION` and reject stale saves explicitly.

Normal route transitions also maintain lift topology after generation or memory restoration. Most route floors are normalized to 16 down and 16 up lifts; `roof` has only 16 down, `VOID` has only 16 up, and `podad` lower down lifts are withheld until the Herald gate opens. When a normal lift creates or restores the adjacent floor, the arrival floor mirrors the departure lift group as the opposite return direction at the same coordinates, then fills any other expected direction to sixteen reachable lifts. Content modules must not depend on a specific hardcoded lift coordinate; they should publish route facts through ids and generated marks.

Future fields such as family edges, friends, rank, kills, quest seed, home/work anchors and exact inventory are allowed only with a measured storage plan. Prefer ids, small numeric fields, typed arrays and sparse overrides over large object graphs.

## 4. Parallel Agent Ownership

Use this to avoid file conflicts.

Green files, safe for one agent:

- New `src/gen/<floor>/<module>.ts`
- New `src/data/<domain>_<module>.ts` or a new small domain file
- New `src/entities/<monster>.ts`
- New focused reference docs under external `../gatbage/reference/` only when the task explicitly asks for appendix/reference work

Yellow files, edit only with a narrow reason:

- `src/gen/<floor>/index.ts` for one import/call
- `src/gen/<floor>/side_quests.ts` or equivalent local registry
- `src/data/items.ts`, `src/data/weapons.ts`, `src/data/plot.ts`
- `src/entities/monster.ts`
- `src/systems/debug.ts`

Red files, integrator-owned:

- `src/core/types.ts`
- `src/core/world.ts`
- `src/main.ts`
- `src/gen/shared.ts`
- `src/render/webgl.ts`
- `src/render/sprites.ts`
- `src/render/textures.ts`
- Broad AI, quest, inventory, or samosbor rewrites

If a task needs a red file, split it into:

1. Small API/hook change by one owner.
2. Additive content modules by everyone else.

## 5. Registry Pattern

Every expandable domain should follow one of these patterns.

Current examples:

- Side quests: module calls `registerSideQuest()` in `src/data/plot.ts`.
- LIVING zone POIs: module calls `registerZoneContent()` in `src/gen/living/zone_content.ts`.
- Samosbor variants/director: definitions live in `src/data/samosbor_variants.ts` and `src/data/samosbor_director.ts`; `systems/samosbor.ts` consumes active variants and bounded beats.
- Events: systems call `publishEvent()`, consumers query ring buffers.
- Interactive surfaces: definitions live in `src/data/interactive.ts`; broad static floor objects use `src/data/floor_object_placement.ts` plus `src/gen/floor_object_placement.ts`; local authored modules can still call `placeInteractive()` / `placeInteractiveAt()` or fixture helpers such as `maybePlaceBrokenFixture()`; `systems/interactive.ts` owns sparse per-`World` instances and action handlers.

Standard shape for new registries:

```ts
export interface SomeDef {
  id: string;
  weight: number;
  tags: string[];
}

const registry: SomeDef[] = [];

export function registerSome(def: SomeDef): void {
  registry.push(def);
}

export function getSomeDefs(): readonly SomeDef[] {
  return registry;
}
```

Rules:

- Registry ids are lowercase snake case and globally meaningful: `living_radio_eye`, `maint_pressure_station`, `ministry_stamp_debt`.
- Module files own their local definitions and call register at top level.
- Runtime systems read registries once per tick window or generation phase, not every pixel/ray.
- If duplicate ids matter, the registry rejects them in development with `console.warn` or throws during generation.

## 6. Import Contention Fix

Current content often requires one side-effect import in a floor `index.ts`. That is acceptable for small batches, but it becomes a merge conflict with 20+ agents.

Short-term rule:

- One agent may add one import/call to an existing floor orchestrator.
- If more than three agents touch the same floor in one batch, create a local manifest.

Implemented manifests:

```txt
src/gen/floor_manifest.ts
src/gen/living/content_manifest.ts
src/gen/maintenance/content_manifest.ts
src/gen/ministry/content_manifest.ts
src/gen/kvartiry/content_manifest.ts
src/gen/hell/content_manifest.ts
src/gen/void/content_manifest.ts
```

The floor `index.ts` imports only its manifest or a small runner from it. Agents then append module imports or ordered runner entries to the manifest, not the orchestrator. The manifest remains the single conflict surface.

Current floor matrix:

| Floor | Generator | Additive Hook | Manifest Status | Shared-File Risk |
| --- | --- | --- | --- | --- |
| `MINISTRY` | `src/gen/ministry/index.ts` | `runMinistryContent()` | implemented | low; agents edit `content_manifest.ts` |
| `KVARTIRY` | `src/gen/kvartiry/index.ts` | named NPC and permanent content runners | implemented | medium; uprising pressure update still lives in `index.ts` |
| `LIVING` | `src/gen/living/index.ts` | side-effect zone content + side quest spawners | implemented | medium; `side_quests.ts` remains ordered spawn registry |
| `MAINTENANCE` | `src/gen/maintenance/index.ts` | `runMaintenanceContent()` | implemented | low; mixed generator signatures hidden behind adapters |
| `HELL` | `src/gen/hell/index.ts` | `runHellContent()` | implemented | low; initial population generation remains in `index.ts` |
| `VOID` | `src/gen/void/index.ts` | `runVoidContent()` | implemented | low; agents edit `content_manifest.ts` |

`src/gen/floor_manifest.ts` owns floor names, floor message colors, `FloorLevel -> generator`, and save/load generation. Adding a new story floor now starts there instead of duplicating switch logic in `main.ts` and `systems/samosbor.ts`.

`src/data/design_floors.ts` and `src/gen/design_floors/manifest.ts` own routed authored design floors without adding new `FloorLevel` enum values. `src/gen/design_floors/full_floor.ts` is the integration layer that expands small authored POI modules into full 1024x1024 route floors while keeping route-specific content out of `main.ts`. `src/data/procedural_floors.ts`, `src/systems/procedural_floors.ts`, and `src/gen/procedural_floor.ts` own interstitial procedural floors. Add new procedural geometry/anomaly profiles there or through their docs contracts; do not clone named story content into procedural floors.

Generic render hooks are allowed when a floor or item family needs a reusable presentation channel. The roof uses this pattern: `src/gen/design_floors/roof.ts` exposes a 1024x1024 dynamic sky texture provider, and `src/render/webgl.ts` only owns the generic dynamic ceiling texture slot, not roof gameplay. Item drops use the same rule: `render/webgl.ts` only asks for a generic procedural texture by item id, while item-specific visual language lives in `src/render/item_sprites.ts`. Procedural actor/item visuals are allowed, but they must be generated at game/floor load boundaries into the shared renderer cache, not lazily in the hot render path.

The mesh pass follows the same rule at a larger scale: `src/render/webgl.ts` owns only the generic pass seam, `src/render/mesh/` owns collection/buffers/shaders, and content-specific visual language lives in data/profile/generation modules. Physical path blockers for bulky objects are not part of mesh; use the explicit `block.md` field/data/generation contract when implementing collision.

Corridor-volume dressing is part of this render contract. It may derive wall
relief, ledges, thresholds or organic tunnel silhouettes from local
`World.cells`/`roomMap` topology and floor profile tags, but it remains
camera-bounded triangle geometry only. It must not rewrite rooms, carve cells,
own reachability or become a source for path blockers.

Later, if edit contention is still high, use Vite eager globs:

```ts
import.meta.glob('./content/**/*.ts', { eager: true });
```

That requires adding Vite import-meta types first. Do not introduce it casually; it is a build-contract change.

## 7. Data-Oriented Runtime Rules

The engine is already data-oriented. Keep it that way.

Use:

- Plain object definitions.
- Typed arrays on `World` for dense per-cell state.
- Flat entity arrays for NPCs, monsters, items, projectiles.
- Small sparse `Map`s only for rare per-cell data, such as doors or surface marks.
- Fixed-size ring buffers for history.
- Numeric ids and string ids, not object graphs.
- Slow accumulators for simulation: 0.5s, 1s, 5s, 30s depending on gameplay need.

Avoid:

- Per-module `setInterval`.
- Per-frame full-world scans.
- Periodic refill-to-cap population spawners for ordinary NPCs or monsters.
- Per-entity closures allocated during updates.
- Deep class inheritance.
- JSON parse/stringify in the game loop.
- DOM work in systems.
- Renderer-side gameplay state, including camera mode ownership.
- Raw `Math.random()` in generation or runtime. It breaks deterministic simulation and unit tests. Always use `src/core/rand.ts` (`SeedRng`, `xorshift32`, `seededRandom`).
- **Real-time BFS or O(W²) recomputation during active gameplay.** Navigation tree, flow fields, light maps, path blockers and connectivity are baked at floor load and after samosbor stitch — never during active simulation. During samosbor the navigation cache must be frozen; no system may unfreeze or invalidate it until samosbor ends. See `optimization.md` Iron Law section.

Default budgets:

```txt
Content generation: can be expensive, but bounded and done on loading/rebuild.
Per-frame system: suspicious above 0.1 ms.
Slow system tick: target below 0.2 ms per second on i3/MX350.
HUD/render additions: draw from cached state, no world scans in draw calls.
Real-time pathfinding: O(1) lookup only. All BFS is baked at boundaries.
```

## 8. Content Module Contract

Most content should be a self-contained file with four parts:

1. Local constants and ids.
2. Optional data registration: quest, NPC, event, room, document, economy def.
3. One generator/spawn function.
4. Optional debug/test hook.

For a generated POI:

- Pick a stable id.
- Choose a floor and zone.
- Bulldoze only non-protected cells.
- Set `cells`, `roomMap`, `wallTex`, `floorTex`, and `features`.
- Create `Room` records with real `RoomType`.
- Add doors to `world.doors` and `room.doors`.
- Protect permanent content with `aptMask` where required.
- Connect to an existing floor cell.
- Spawn authored/event NPCs and items with `nextId.v++`. Ordinary ambient NPCs should be placement templates that A-Life can replace with persistent identities during floor activation.
- Publish or register enough data for quests/map/debug to find it.

For a data-only module:

- Use a registry.
- Provide at least one path to visibility: loot spawn, trader, guaranteed room, debug command, quest, event, or document pool.
- Do not add dead data.

## 9. System Module Contract

New systems must be generic.

Good:

```txt
data/economy.ts       definitions: resources, recipes, price rules
data/economics.ts     shared long-progression caps, price floors and reward bands
systems/economy.ts    slow tick: production, shortage events, debug stats
systems/quest_rewards.ts runtime reward math from objective, route, danger and giver context
gen/industry/*.ts     rooms that carry factory ids and spawn workers
```

Bad:

```txt
systems/economy.ts hardcodes one named room from one agent.
main.ts calls updateOneSpecificQuestRoom().
render/hud.ts scans every room to discover prices every frame.
```

Every new runtime system needs:

- A data file or registry.
- A bounded update cadence.
- A debug way to inspect it.
- Event publication for important changes.
- A current-shape serializer/sanitizer if it stores persistent state. Cross-version save migration is not required by default; shape breaks should include a stale-version rejection test.
- A low-tier behavior that is cheap and a high-tier path that buys visuals/content, not raw simulation complexity.

## 10. Cross-System Communication

Use ids and events.

Preferred:

- `publishEvent(state, draft)` for things NPCs, rumors, quests, or UI may observe.
- Definition ids such as `factoryId`, `documentId`, `contractId`, `poiId`.
- Room tags or room names only as secondary display text.
- A local registry per domain.

Avoid:

- Importing another agent's module just to check whether it exists.
- Calling a content module from a generic system.
- Looking up content by Russian display name in hot logic.
- Mutating another module's private arrays.

The current `systems/events.ts` is the browser version of an EventBus. It already uses fixed-size buffers and avoids unbounded logs. Use it before inventing another bus.

## 11. Floor Architecture

**Floor Generation System:**
- **Even-numbered floors** (`Z % 2 === 0`) are separate, independent design modules. Each is authored as a standalone package without inheriting biomes.
- **Odd-numbered floors** (`Z % 2 !== 0`) are procedurally assembled by randomly mixing pieces of other floors and introducing procedural anomalies.

Each floor should have the same outer structure:

```txt
src/gen/<floor>/
  index.ts              floor orchestrator
  content_manifest.ts   optional imports/registration only
  content_helpers.ts    local stamping helpers if repetition appears
  <module>.ts           one POI, NPC group, encounter, or room family
```

Floor orchestrator responsibilities:

- Create `World`.
- Generate base topology.
- Generate zones and levels.
- Place lifts.
- Run registered content modules.
- Spawn baseline population and loot.
- Bake lights.
- Return `{ world, entities, spawnX, spawnY }`.

Content module responsibilities:

- Never decide global floor topology.
- Never reset `entities`.
- Never change population caps outside its floor owner task.
- Never assume another module ran first unless the manifest explicitly orders them.

## 12. Definition Domains

The project now has several data-first domains that should be extended in place instead of reimplemented locally:

```txt
src/data/contracts.ts          ContractDef[]
src/data/resources.ts          ResourceDef[]
src/data/factories.ts          FactoryDef[] with recipes
src/data/economy_rules.ts      price/scarcity rules
src/data/rumors.ts             RumorDef[]
src/data/alife_generation.ts   persistent NPC faction, level, account wealth and pocket profiles
src/data/floor_catalog.ts      data-only future floor catalog
src/data/permits.ts            access papers and spoilage defs
src/data/computers.ts          generated computer defs
src/data/gambling.ts           generated gambling machine defs
src/data/net_hack.ts           local NET-hack terminal defs
src/data/emergency_panels.ts   panel defs
src/data/samosbor_variants.ts  variants, modifiers and aftermath beats
src/data/samosbor_director.ts  warning/active/aftermath director beats
```

Remaining candidates for future standardization are document pools by faction/theme, a data-only event-type catalog if `systems/events.ts` needs more static validation, and richer cross-expansion director hook definitions. Do not implement all of this in one pass. Each domain gets:

1. Definition file.
2. Minimal generic system.
3. Five to twenty defs.
4. Debug/check path.
5. README update only after it works.

## 13. Scalability Pillar

Every module must scale across four tiers.

Low:

- Static room geometry.
- Existing textures and sprites.
- Small spawn counts.
- Slow ticks.
- Text/audio/HUD feedback instead of simulation.

Middle:

- More variants and denser loot/NPC placement.
- Extra events and rumors.
- More procedural marks and lights during generation.

High:

- Extra visual marks, richer HUD hints, more simultaneous encounters.
- More detailed A-Life facts and economy state.

Ultra:

- Visual overkill through procedural texture variants, dense decals, rare set pieces, and bigger event pools.
- Still no unbounded per-frame world scans.

Rule: saved CPU buys atmosphere. It does not buy a physics toy.

## 14. Cinematic Cheat Policy

Prefer controlled fakes:

- Fog color, density, HUD warnings, and spawn weights instead of volumetric fog simulation.
- Static water/steam/pressure room states instead of fluid simulation.
- Room names, notes, event logs, and NPC barks instead of huge bespoke cutscenes.
- Procedural texture variants instead of imported assets.
- Spawn tables and behavior flags instead of one-off AI branches.
- Slow economy ticks instead of live market micro-simulation.

If a fake creates the same player decision, use the fake.

## 15. Black Box And Telemetry

Critical systems should expose recent state through bounded buffers.

Current precedent:

- `systems/events.ts` uses fixed-size recent, important, and per-zone event buffers.
- `msgLog` is capped.

For future critical systems:

```txt
System telemetry entry:
  tick
  floor
  zoneId
  hash or state id
  counts
  last action flags
```

Store the last 300 relevant samples, not infinite history. In browser runtime, dumps should go to debug UI, console, downloadable blob, or save data. In Node-side tooling, durable dumps should stay outside active docs unless an explicit orchestration/debug task asks for an external appendix record under `../gatbage/history/agent_logs/`.

Historical `../gatbage/history/agent_logs`, task statuses and prompts were consolidated into `../gatbage/history/root_notes/appendix.md` in the external appendix. Recreate those directories only for an explicit orchestration/debug-dump task; routine patches should keep their durable notes compact and update appendix notes only when the context will be useful later.

## 16. Verification Checklist

Every agent patch must answer:

- What files changed?
- What new gameplay is visible?
- Which floor/zone/room can verify it?
- How does it react to samosbor or why is it exempt?
- How does it touch A-Life, factions, economy, quests, or events?
- What caps prevent frame-time growth?
- Which check passed?
- Was README updated only if implementation facts changed?

Minimum local verification:

```txt
npm run typecheck
```

Use `npm run check:readonly` for most data/content changes. Use `npm run check` for systems, generation, save/load, AI, economy, quests or rendering changes. Use `npm run check:browser` or `npm run check:full` when browser/render/mobile behavior needs smoke coverage and Chrome is available.

For mesh pass changes, also run explicit smoke modes when practical:

```txt
SMOKE_VISUAL_GEOMETRY_MODE=off npm run smoke
SMOKE_VISUAL_GEOMETRY_MODE=high npm run smoke
SMOKE_MOBILE=1 SMOKE_VISUAL_GEOMETRY_MODE=low npm run smoke
```

For content:

- Confirm module is imported/registered.
- Confirm NPC or room can spawn.
- Confirm quest/data id is reachable.
- Confirm no use of nonexistent enum values.
- Confirm no full-world hot scan in render or per-frame update.

## 17. Anti-Patterns

Reject these on sight:

- `src/content.ts` with everything in one file.
- A floor module that edits `main.ts` for one NPC.
- A quest that requires changing AI internals.
- A renderer feature that owns gameplay state.
- A generator that overwrites `aptMask`.
- A module that assumes non-toroidal coordinates.
- A new enum for every tiny content variant.
- A system that scans all 1,048,576 cells every frame.
- A module that only adds text nobody can ever encounter.
- A rewrite of working systems to make a small feature feel "clean".

## 18. Recommended Growth Phases

Phase 0: Documentation and boundaries.

- Keep this file current.
- Add per-floor manifests only when conflicts appear.
- Keep README factual.

Phase 1: Registry hardening.

- Standardize registries for events, contracts, documents, standalone monster packages, economy.
- Add duplicate-id checks.
- Add debug inspection for each registry.

Phase 2: Content lanes.

- Agents add one POI, one NPC/quest, one event pack, one standalone monster package, or one document pack per task.
- Integrator owns central enum/sprite/texture expansion.

Phase 3: Runtime systems.

- Add only generic slow-tick systems.
- Publish events for every important consequence.
- Bump save shape and invalidate stale data when persistent state changes incompatibly.

Phase 4: Visual overkill.

- Spend saved cycles on procedural texture variants, marks, HUD feedback, room identity, and high-tier density.
- Do not add new simulation complexity unless it changes player decisions.

## 19. One-Agent Task Size

Acceptable task sizes:

- One content zone.
- One NPC with quest and room.
- One data file plus one generic system plus 5-20 defs.
- One monster with behavior and sprite registration.
- One small floor prototype.
- One debug screen.

Too large for one pass:

- "Implement whole economy."
- "Rewrite AI."
- "Add all future floors."
- "Make every NPC remember everything."
- "Move project to a new architecture."

## 20. Final Rule

The architecture is successful when adding content means creating a small file, registering a definition, running build, and seeing it in game. If a feature requires touching five shared systems, it is probably the wrong shape or it needs an integrator-owned API first.
