# Optimization System

> Центральный документ оптимизации.
>
> Роль: описывает обязательные performance principles for GIGAHRUSH: universal cheap AI rules, thousands-capable NPC/monster floors, bounded procedural generation, shader/render discipline, floor-memory/save costs, browser/mobile constraints and test/runtime budget. Связан с `architecture.md`, `ai.md`, `fight.md`, `floors.md` and `tests.md`.

Date: 2026-05-27.

This file is the central optimization document and also preserves the full May 27 FPS/bottleneck review below. Do not treat a historical item as implemented until source and validation notes say so.

## Constraints

- Keep the game zero-runtime-dependency and browser-first.
- Do not remove playable systems, content density, A-Life identity, floor memory, render effects or persistent floor facts to win benchmarks.
- Prefer bounded caches, dirty versions, async storage, typed arrays, existing `EntityIndex` patterns and generation-time work.
- Keep the active floor honest: the current `World` remains a full 1024x1024 simulation surface.
- "Safe optimization" here means semantics-preserving: cache, index, defer, split dirty state or remove duplicate work. Any visible simplification must be treated as a separate design change.
- Validate performance changes with `npm run check`; use `npm run check:browser` or `npm run check:full` for render, input, UI, mobile and browser-storage changes.

## Iron Law: No Real-Time BFS

Date: 2026-06-14.

**During active gameplay everything is pre-baked. No BFS, no full-world scans, no O(W×W) recomputation.**

Baking (navigation tree, flow fields, light maps, path blockers, connectivity) happens at exactly two boundaries:

1. **Floor load** — floor switch, game start, save restore.
2. **Post-samosbor stitch** — one-time rebake after samosbor ends and geometry is finalized.

During active simulation (including active samosbor with fronts mutating cells), **all lookups are O(1) from baked data**. The navigation cache must be frozen (`freezeNavigationCacheForWorld`) for the entire duration of samosbor. No system may unfreeze it until samosbor ends.

Forbidden during active gameplay frames:

- `bakeNavigationTree` (1M-cell BFS)
- `ensureBehaviorFlowField` with cache miss (1M-cell BFS)
- `rebuildPathBlockersFromWorldObjects` without freeze protection
- `bakeLights` on the full world
- Any new O(W²) computation triggered per-frame or per-entity

If a system needs navigation during geometry mutation (e.g., monsters chasing during samosbor), it must use the frozen/cached tree from before the mutation started. Stale paths are acceptable — the world is actively collapsing.

**History**: This rule exists because `cancelSamosborWave()` internally called `unfreezeNavigationCacheForWorld()` after `freezeNavigationCacheForWorld()` at samosbor start, causing every cell mutation to trigger a full 1M-cell BFS rebuild (~5-10ms/frame), resulting in 4-5x FPS drops. The bug recurred multiple times because no explicit rule prevented it.

## Path Blocker Core Storage

Date: 2026-06-07.

`World.pathBlockers` is an active-world `Uint8Array` with eight row bytes per
1024x1024 cell, so the current blocker field costs exactly `1024 * 1024 * 8`
bytes, about 8 MiB per live `World`. This storage is core gameplay state, not a
render mesh input. Floor-memory RAM estimates include the byte length, but save
and packed floor-memory snapshots must not serialize the full array; blockers
should be rebuilt from persisted cells/features/containers unless a later
mutable blocker system adds capped sparse overrides.

Fine blockers do not create an `8192x8192` navigation graph. Coarse
pathfinding remains cell-level unless a measured later pass adds bounded local
steering.

## Numeric Storage Contract

Date: 2026-06-03.

For systems that can touch the full persistent population, small numeric facts must be columnar typed-array data first and object fields only as boundary snapshots. This matters even for "tiny" values because the fixed A-Life pool is `100_000` NPC identities before Demos/social graph growth.

The default target ranges are:

- Level and RPG attributes: `Uint8Array`. Runtime `RPG_LEVEL_CAP` is byte-safe at `255`, not `256`; unsigned byte stores `0..255`, and direct level values use `1..255` with `0` available as unset/fallback storage value.
- Social relations and karma: `Int8Array` with game range `[-127, 127]`; keep `-128` reserved as sentinel/unset/corrupt, not as an ordinary score.
- Floor route number / compact floor index: signed byte when storing route `z`-like values in `[-127, 127]`, or unsigned byte for dictionary indexes. Save/debug may keep `floorKey` strings, but hot or full-population storage must not duplicate strings per NPC.
- Normal inventory slot stack count: target one byte per physical slot, `1..255`. Quantities above `255` must split into multiple physical slots, move into a bulk/resource container, or remain a deliberate virtual resource system. Do not keep arbitrary `999` stack counts as the long-term object model for actor inventories.
- XP: do not force into byte storage under the current soft-quadratic formula. With level cap `255`, `xpForLevel(256) - 1` is about `654k`, so current per-level XP needs at least `Uint32Array` if it becomes a mass persistent column. A byte progress meter would be a separate gameplay/save-shape redesign.
- HP, PSI, needs and timers: active entities may keep JS numbers where fractional regeneration, cooldowns or interpolation are already gameplay-visible. Persistent/off-floor storage can be quantized later, but only after checking formulas and tests; do not break fractional HP behavior to save one byte.
- Money, account balances, ids, seeds and kill counters are not byte fields by default. Pick `Uint16Array`, `Uint32Array` or sparse overrides according to real caps.

Implementation rules:

- Never assign a value capped above the typed-array range into that typed array; JavaScript typed arrays wrap/truncate silently.
- Keep live current-floor `Entity` objects ergonomic when they are not the 100k storage problem; compact the cold/persistent columns and expose snapshots through helpers.
- Save payloads may remain JSON numbers/strings when that is the current shape, but load must sanitize to the same caps used by runtime columns.
- Add tests for max-value round trips whenever a field moves into a typed array.

Current A-Life implementation:

- `src/systems/alife.ts` keeps the fixed `100_000` persistent pool in a mixed columnar form. Record objects keep sparse identity/string/position facts such as `id`, `name`, reserved ids, optional coordinates and touched custom loadout.
- Full-population route/numeric facts are typed columns: `floorKeyIndex`, `floor`, `danger`, `faction`, `occupation`, flags, RPG bytes, HP/max HP, money/account rubles, family id, sprite/sprite seed, kill counters, `playerRelation` and `karma`. Route strings are interned once in an A-Life floor-key dictionary.
- Ordinary generated loadout is deterministic and lazy. Untouched records do not carry a `weapon` string or `inventory` array; materialization reconstructs loadout from seed, faction, occupation, danger and level. Captured or save-overridden loadout is sparse and flagged as custom.
- Actor inventory stack counts are byte-capped at `255`; oversized save/runtime stacks split into physical slots where the actor inventory model is used.

## Review Pass

The initial requested six-agent review was run as read-only analysis. No subagent edited code during that review. Two broad data/registry attempts failed on remote compact service errors, then a narrow replacement lane completed.

| Lane | Result | Main finding class |
| --- | --- | --- |
| Render / WebGL / sprites / surface marks | completed by subagent | Surface mark uploads, sprite sorting/culling, static object scans. |
| Runtime systems / AI / entity updates | completed by subagent | Per-frame entity index rebuild, AI classification cadence, nested scans. |
| Browser UI / input / mobile / frame loop | completed by subagent | Full map redraw, overlay snapshots, Net Sphere/audio allocations. |
| Floor memory / save / storage | completed by subagent | Synchronous save/load hitches, duplicate packing/validation, RAM cold tier. |
| Generation / world construction | completed by subagent | Repeated BFS/light/connectivity passes, dense placement fields, rejection sampling. |
| Data / registries / content audit | completed by narrow replacement subagent | Contract lookups, NPC menu allocation/sort, leaderboard/cache miss allocation, audit memoization. |

Validation observed during review:

- `npm run test:generation` passed `1329/1329` in the generation lane.
- Generation timing baseline from that run: 93 floor generator calls, total `69892.1ms`; slowest examples were `design darkness` about `3.1s`, `design chthonic_attic` about `3.05s`, `design podad` about `1.9s`, and a procedural smog floor about `1.58s`.
- Other lanes were read-only source review and did not run checks.

## Implemented Safe Pass

Date: 2026-05-27.

Only semantics-preserving optimizations from this plan were implemented. This pass intentionally did not change active-floor simulation scope, samosbor geometry mutation, A-Life population rules, AI decision rules, save shape, trace persistence, combat residue, generation density or render content.

| Plan item | Status | Source |
| --- | --- | --- |
| P0 Full Map And HUD Frame Work / gate closed overlay snapshots | implemented | `src/render/hud.ts` now checks `isGamblingOverlayOpen()`, `isComputerOverlayOpen()` and `isNetHackOverlayOpen()` before building overlay snapshots. |
| P1 Browser UI, Mobile, Audio And Net Sphere / remove audio listener closure churn | implemented | `src/systems/audio.ts` accepts a world-like distance context and `src/main.ts` passes `world` directly in both loop branches. |
| P1 Browser UI, Mobile, Audio And Net Sphere / reduce A-Life leaderboard cache-miss allocation | implemented | `src/systems/alife.ts` allocates leaderboard entries only after a score can enter the bounded top list, while keeping player rank and tie behavior unchanged. |
| P2 Data, Registries And Tooling / contract lookup maps | implemented | `src/systems/contracts.ts` uses a module-local `CONTRACT_BY_ID` and cached Govnyak courier defs. |
| P2 Data, Registries And Tooling / avoid full sort for available contracts | implemented | `src/systems/contracts.ts` builds assigned contract ids once and preserves stable current-floor-first order with bounded buckets. |
| P2 Data, Registries And Tooling / NPC menu options without final sort | implemented | `src/systems/npc_interaction_options.ts` merges sorted built-ins/custom options without a final per-call sort. |
| P2 Data, Registries And Tooling / content audit memoization | implemented | `scripts/content-audit.mjs` memoizes repeated per-file AST scans used by the offline audit. |
| P0 AI And Pathfinding / optimize BFS passability checks and remove closure allocation | implemented (2026-06-29) | `src/systems/ai/pathfinding.ts` pre-caches BFS passability checks in `_navParent`/`next`, hoists macro cell / clearance blocker functions to module level to avoid millions of closure allocations, and directly checks `pathBlockers` with bitwise arithmetic. Reduced unit test suite duration from >20 minutes to ~65 seconds. |

Validation for this implementation pass:

- `npm run check` passed: typecheck, `1327` unit tests passed / `2` skipped, content audit reported `Errors: none`, production build completed.
- `npm run check:browser` passed: production build completed and smoke playability reported non-empty HUD/scene pixels.
- The checks regenerated `dist/index.html`.

## P0: Surface Mark Uploads

Why this is likely FPS-visible:

- `render/marks.ts:479` bumps `world.surfaceVersion` for a single mark.
- `render/webgl.ts:1670` reacts by rebuilding surface data through `buildSurfaceData()`.
- `render/webgl.ts:1311` clears/rebuilds a 512x512 RGBA atlas and a full 1024x1024 R16 index.
- `render/webgl.ts:1675` and `render/webgl.ts:1677` upload both textures after every surface version change.
- Flame, blood, chalk, UV reveal/erase and samosbor residue all use this surface path.

Safe optimizations:

1. Track dirty marked cells.
   - Add a dirty cell set or bounded dirty ring when `stampMark`, erasers, UV reveal or samosbor wave mutate `surfaceMap`.
   - Upload changed 16x16 atlas tiles with `texSubImage2D`.
   - Update the index texture only when a cell gains, loses or changes atlas slot.
   - Keep the full rebuild path for world replacement, atlas overflow, deletes and corruption recovery.
2. Replace overflow full sort.
   - `render/webgl.ts:1318` allocates `Array.from(world.surfaceMap.entries())`.
   - `render/webgl.ts:1321` sorts all marked cells when `surfaceMap.size > 1024`.
   - Use fixed-size nearest-1024 selection, stable tile buckets or a bounded heap with toroidal distance.
3. Reduce per-pixel stamp address work.
   - `render/marks.ts:431` to `render/marks.ts:463` repeatedly wraps local pixels and looks up target cells.
   - Group writes by target cell/local pixel span or precompute scanline cell deltas while preserving the same shader output.

Validation:

- Synthetic 5k-10k marked-cell floor.
- Heavy firefight, flame, chalk, UV reveal/erase and samosbor residue scenes.
- Screenshot comparison while crossing torus edges and walking near the atlas cutoff.
- `npm run check:browser` or `npm run check:full`.

## P0: Entity Index Rebuild And Dense Runtime

Why this is likely FPS-visible:

- `main.ts:6065` rebuilds the simulation `EntityIndex` every active frame.
- `systems/entity_index.ts:153` clears all 4096 buckets.
- `systems/entity_index.ts:168` rebuckets every live entity, including mostly static item drops.
- This scales with total live entity count, not only moving actors.

Safe optimizations:

1. Split static and dynamic buckets.
   - Keep actors/projectiles in the per-frame dynamic buckets.
   - Keep item drops and other static visible/queryable entities in a static bucket layer invalidated only on spawn, pickup, drop, cleanup, floor load or map-editor mutation.
   - Preserve existing `queryRadius` semantics by merging dynamic/static query results in stable entity order.
2. Add query equivalence tests.
   - Compare old/new query results for actor-only, item-only, mixed masks, torus wrap and capped queries.
3. Keep existing debug stats useful.
   - Extend `EntityIndex` stats so dense-floor smoke can show static/dynamic counts separately.

Validation:

- Unit tests for `EntityIndex` query equivalence.
- Dense smoke with many item drops plus NPC/monster fights.
- Watch `EntityIndex.getDebugStats()` before/after.

## P0: Full Map And HUD Frame Work

Why this is likely FPS-visible:

- `main.ts:6354` renders the WebGL scene every frame even when the full map covers the screen.
- `render/map_ui.ts:397` rebuilds the full map base raster for the current radius each draw.
- `render/hud.ts:1149` to `render/hud.ts:1151` builds gambling/computer/hack snapshots every HUD frame even when closed.
- `render/hud.ts:1340` calls `findInteractionTarget()` for the prompt, while mobile probes also call through `main.ts:4527`.

Safe optimizations:

1. Cache minimap/full-map base raster.
   - Key by player tile, map radius/size, exploration/fog/faction/surface/world versions, map mode and relevant UI scale.
   - Draw entities, player, events, route cues and transient warnings as a dynamic overlay.
2. Throttle or freeze WebGL behind full map where visual intent allows.
   - Keep input and map overlay responsive.
   - Use last-frame background or a low-cadence GL update while the opaque/near-opaque full map is open.
3. Gate closed overlay snapshots.
   - Build gambling/computer/hack snapshots only when the overlay is open, or return static closed singletons.
4. Share one frame-local interaction target.
   - Cache display-only target by frame/tick, player pose and world interaction versions.
   - Recompute fresh on actual `E` / ACT press so interactions remain authoritative.

Validation:

- Full map/minimap after movement, fog reveal, samosbor, faction changes and surface marks.
- Doors, NPCs, containers, rail trains and terminals through HUD prompt, desktop `E` and mobile ACT.
- Browser smoke plus manual map toggle check.

## P0: Floor Memory, Save And Storage Hitches

Why this is hitch-visible:

- `main.ts:3803` captures A-Life/floor memory and then writes a full JSON save through synchronous `localStorage.setItem`.
- `systems/floor_memory.ts:1374` builds candidates by packing live worlds and cloning entities.
- `systems/floor_memory.ts:1409` repeatedly creates `[...entries, candidate.save]`.
- `systems/floor_memory.ts:1366` and `systems/floor_memory.ts:1413` repeatedly `JSON.stringify` candidate save states.
- `main.ts:3821` and `main.ts:3871` parse and restore floor memory before the scheduled loading gate can paint feedback.

Safe optimizations inside the current format:

1. Make floor-memory save selection single-pass.
   - Cache candidate byte estimates once.
   - Avoid repeated array spread and repeated full `JSON.stringify`.
   - Do one final exact size check before commit.
2. Replace RLE `number[]` writer.
   - `systems/floor_memory.ts:333` builds a JS `number[]`, then copies to `Uint8Array` and base64.
   - Use a growing byte writer or chunked `Uint8Array` writer that emits the same varint/RLE format.
3. Avoid double restore work.
   - Packed restore currently validates/decodes RLE, then later decodes/scans/fills again in `worldFromSave()`.
   - Validate while applying, or keep sanitized bytes instead of re-base64ing surfaces.
4. Move heavy load parse/restore under the loading screen.
   - Schedule load first, draw `ЗАГРУЗКА...`, then parse and restore inside the existing pending-load gate.
   - Preserve current old/new/corrupt save messages.
5. Make design-floor generation extras lazy.
   - Saved floor-memory restore can regenerate design floors only to recover extras.
   - Store lightweight metadata or resolve extras only when that floor is taken active.

Longer-term safe direction:

- Keep active floor live.
- Keep a small hot inactive LRU of live `World` objects in RAM.
- Move cold packed snapshots to IndexedDB as binary `Uint8Array` / `ArrayBuffer` blocks.
- Keep `localStorage` as a small manifest plus critical player/run state.
- Because this changes save shape, bump `SAVE_SHAPE_VERSION` and reject stale saves explicitly.

Validation:

- Fake-storage unit tests for put/get/delete/list/prune, quota failure, corrupt snapshot and missing cold ref.
- Floor round-trip test: mutate doors, containers, `surfaceMap`, entities and fog; evict cold; restore; verify state.
- Browser test: visit many floors, force cold tier, reload, return to old floors.
- Measure heap after N visited floors, save JSON size, IndexedDB usage, cold restore time and floor transition latency.

## P1: Render And Sprite Hot Paths

Candidates:

1. Cull sprites before sorting.
   - `render/webgl.ts:2003` collects radius-visible entities.
   - `render/webgl.ts:2053` adds static objects.
   - `render/webgl.ts:2066` sorts before `render/webgl.ts:2088` rejects sprites behind the camera.
   - Add generous view-space/screen-bound rejection before `pushVisibleSprite()`.
2. Reduce static object scans.
   - `render/webgl.ts:1911` scans all containers every frame.
   - `render/webgl.ts:1937` scans an 81x81 feature square.
   - Query nearby containers through existing `containerMap` over nearby cells and make `featureOffset()` allocation-free.
3. Split feature and light dirty versions.
   - `core/world.ts:206` has feature dirtying and optional light rebake.
   - `render/webgl.ts:1633` uploads the full feature texture and full 1024x1024 float light texture on any feature version change.
   - Add `lightVersion` and upload light only after actual light mutation/rebake.
4. Pass tool-beam direction as uniforms.
   - Small GPU win; lower priority than surface marks/sprite culling.

Validation:

- Dense rooms with storage containers, feature-heavy rooms and wide sprites.
- Rotate in place to check edge popping.
- Lamps/candles, emergency panels, map editor, samosbor, production shelf creation.
- `npm run check:browser`.

## P1: AI And Combat Scheduling

Candidates:

1. Cache cold routine AI classification.
   - `systems/ai/index.ts:288` loops every AI actor every frame.
   - `systems/ai/index.ts:297` classifies before warm/cold cadence can skip.
   - Keep immediate per-frame promotion for player targeting, damage, projectile ownership, locks and hot noise.
   - Cache only cold routine classification for delayed recheck.
2. Make active noise checks cheaper.
   - Prune noise records once per AI frame.
   - Keep O(1) or bounded active-noise memory for classification.
3. Remove hot-path closure allocation.
   - `systems/ai/index.ts:307` creates a message-location provider closure per updated actor.
   - Replace with a reusable mutable provider/context.
   - Hoist NPC combat target filters where current code creates per-call closures.
4. Fuse non-flame projectile hit passes.
   - `main.ts:2611` queries path candidates.
   - `main.ts:2614` to `main.ts:2623` finds nearest non-flame hit.
   - `main.ts:2625` loops again to apply it.
   - Keep flame piercing as a separate path; apply nearest non-flame hit directly.

Validation:

- `getAiSchedulerStats()` before/after on dense floors.
- NPC barks/log location, faction combat, monster aggression, recent damage promotion and projectile-owner promotion.
- Bullets, shotgun pellets, web, grenade/BFG, flame and PSI AoE.

Note:

- A previous optimization note about monster target search falling back to a full entity scan is obsolete. Current `systems/ai/monster.ts:2571` already uses `EntityIndex.queryRadius()`.

## P1: Faction, Quest And Event Scans

Candidates:

1. Use indexed NPC candidates for faction capture.
   - `systems/factions.ts:343` scans the whole entity array every 2 seconds.
   - Only live NPC traveler/hunter capturers matter.
   - Iterate an `EntityIndex` NPC/actor slice in entity order and keep current filters.
2. Replace noise patrol flat scan with spatial query.
   - `systems/factions.ts:424` scans up to `NOISE_PATROL_ENTITY_SCAN_CAP` entities in array order.
   - Query responders near the noise source through `EntityIndex`.
3. Use `EntityIndex.byId` for faction event id counts.
   - `systems/faction_events.ts:1554` does `ids x entities` scans for procession alive counts.
   - Similar clash/procession id checks can use `getEntityIndex().byId`.
4. Bound quest monster counting with the entity index.
   - Holdout and defense caps scan entities and sometimes call `world.dist`.
   - Use `queryRadiusCapped(..., ENTITY_MASK_MONSTER, cap)` and squared distances.

Validation:

- Faction capture and faction UI snapshots.
- Cult procession disruption, active clash finish and debug summaries.
- Grom defense spawn cap and holdout quest monster cap.

## P1: Browser UI, Mobile, Audio And Net Sphere

Candidates:

1. Coalesce resize/mobile refresh.
   - `main.ts:633` schedules immediate, RAF and timer resize work.
   - `visualViewport`, `ResizeObserver`, fullscreen and mobile controls can compound refreshes.
   - Centralize into one debounced scheduler with dimension/orientation/fullscreen diffing.
2. Rate-limit Net Sphere progress snapshots.
   - `main.ts:6007` calls `tickNetSphere()` every frame.
   - `systems/net_sphere.ts:731` rebuilds `runtime.lastProgress` every frame through `progressFromState()`.
   - Refresh normal progress at 1 Hz or on dirty fields; force fresh data for heartbeat, chat, death, samosbor and event sends.
3. Remove audio listener closure churn.
   - `main.ts:6106` and `main.ts:6267` pass a new distance closure every simulation frame.
   - Store current `World`/distance provider on floor load; update listener `x/y` per frame.
4. Cache Net Sphere wrapped chat rows.
   - `render/net_sphere_ui.ts` wraps and measures visible chat/errors/events every draw while open.
   - Cache by chat ids/error/event ids, width, font and language.
5. Rebuild A-Life leaderboard outside draw.
   - `render/factions_ui.ts:287` asks for top 100.
   - `systems/alife.ts:1239` scans all A-Life records on cache miss.
   - Keep exact results, but compute outside draw when version/player rank signature changes; allocate entries only if they can enter top `limit`.

Validation:

- Chrome mobile emulation and real device when available.
- Pointer lock, ACT, rotation, fullscreen, embedded itch viewport, safe HUD insets and menu navigation.
- Net Sphere heartbeat/chat/death/samosbor reports.
- Positional audio falloff and toroidal wrap after floor transitions.
- A-Life top-100/player rank equality.

## P1: Generation And Transition Hitches

Candidates:

1. Cache route-lift reachability inside one normalization call.
   - `main.ts:1427` calls route lift normalization during floor preparation.
   - `systems/floor_memory.ts:1201`, `1214`, `1236`, `1241` and `1245` repeatedly rebuild reachability.
   - Cache reachable cells and collected anchors inside one `ensureFloorRouteLiftLayout()` call; refresh only after geometry mutation.
2. Avoid double light baking in expanded design floors.
   - `gen/design_floors/manifest.ts:58` runs a base generator.
   - Many base design floors call `world.bakeLights()`.
   - `gen/design_floors/full_floor.ts:168` bakes again after expansion.
   - Let expanded route generation skip the base final bake while direct/debug generator calls keep current behavior.
3. Reduce redundant procedural connectivity passes.
   - `gen/procedural_floor.ts:2686`, `2688` and `2690` call connectivity after final repairs.
   - Return dirty flags from door/anchor/lift repair helpers and run connectivity only after actual topology changes, with one final audit.
4. Reuse placement fields and scratch buffers.
   - `gen/population_placement.ts:89` builds a full `Float32Array(W*W)` per sample.
   - `gen/population_placement.ts:291` smooths the whole grid per pass.
   - Design floors sample NPC and monster fields separately at `gen/design_floors/population.ts:131` and `150`.
   - Cache by world identity, `cellVersion`, profile id/hash and seed, and reuse scratch arrays.
5. Replace large rejection sampling batches.
   - `gen/procedural_floor.ts:810` tries up to 5000 random cells per monster.
   - `gen/procedural_floor.ts:987` repeats this for large spawn batches.
   - Build a valid candidate array once after topology finalization and sample from it with the same predicates.

Validation:

- `npm run test:generation`.
- Compare generation timing report before/after.
- Spot-check Living, Kvartiry, Maintenance, Darkness, Roof, Chthonic Attic, Podad, Void and smog procedural floors.
- Browser lighting smoke after bake changes.

## P2: Data, Registries And Tooling

Candidates:

1. Contract lookup maps.
   - `systems/contracts.ts:704`, `994`, `1017` and `1170` repeatedly use `CONTRACTS.find(...)`.
   - Add module-local `CONTRACT_BY_ID` and cached Govnyak courier defs.
2. Avoid full sort for available contracts.
   - `systems/contracts.ts:1139` scans contracts, does `state.quests.some` per contract, sorts all remaining contracts, then slices.
   - Build an active contract id set once and scan assignable contracts into current-floor/other buckets up to `limit`.
3. NPC menu options without final sort.
   - `systems/npc_interaction_options.ts:116` already keeps custom options sorted.
   - `systems/npc_interaction_options.ts:119` allocates and sorts every call.
   - Merge built-ins/custom options in order or use a tiny ordered append without final sort.
4. Side quest snapshot cache.
   - `data/plot.ts:785` maps every side quest into new objects.
   - Keep as debug/test API or cache by registry version where repeated.
5. Content audit memoization.
   - `scripts/content-audit.mjs` is offline and safe as-is for runtime.
   - If audit time grows, memoize `stringConstants`, `stringArrayConstants` and exported function entry scans by file.

Validation:

- `npm run test:unit`.
- `npm run content:audit`.
- Specific tests: `tests/npc-interaction-options.test.ts`, `tests/alife.test.ts`, registry/content tests.

## Measurement Checklist

Before and after any optimization patch, record:

- browser, device class, OS and whether mobile/touch mode is active;
- active floor key, route `z`, density/profile and current samosbor state;
- entity counts by type and `EntityIndex` stats;
- `world.surfaceMap.size`;
- full map/minimap open state and active HUD preset;
- frame time or Chrome Performance trace around the changed path;
- heap after visiting multiple floors;
- save JSON size and, if implemented, IndexedDB usage;
- generation timing for affected floors;
- validation commands run.

Minimum checks by change type:

- Docs-only: `git diff --check`.
- Data/registry only: `npm run typecheck`; prefer `npm run check:readonly`.
- Runtime/generation/save/render/UI/browser: `npm run check`.
- Render/UI/mobile/storage: also `npm run check:browser` when Chrome is available, plus manual visual/browser validation.
