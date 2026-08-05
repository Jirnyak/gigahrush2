# graphics.md - текущая графика и рендер ГИГАХРУЩА

> Роль: факт-карта текущей графической реализации: WebGL raycaster, canvas HUD,
> procedural textures, procedural sprites, surface marks, particles, filters,
> FOV/settings and render-side performance caps.
>
> Связь с `taste.md`: `taste.md` задает визуальный вкус и запреты. Этот документ
> фиксирует, как этот вкус сейчас реализован в коде. Если есть расхождение,
> факты проверяются по `README.md`, `architecture.md` and current `src/`.

Статус: current implementation document. Это не backlog и не план улучшений.
Архивные orchestration batches `graphics_N.md` и `fixes_N.md` вынесены в
`../gatbage/history/batches/graphics_2026-06-06/` и
`../gatbage/history/batches/fixes_2026-06-06_current/`.

## Коротко

Графика ГИГАХРУЩА сейчас держится на одном low-res WebGL2 raycaster pass,
процедурных 64x64 текстурах, billboard-спрайтах, sparse surface marks,
transient particles and canvas HUD overlays.

- Мир остается `1024x1024` toroidal `World`.
- Renderer читает typed arrays and flat `entities`; gameplay decisions остаются
  в `systems/` and `gen/`.
- Основной 3D кадр рендерится в `320x200` FBO (`SCR_W`, `SCR_H`) and blits to
  browser canvas.
- Runtime dependencies, asset pipeline, imported texture packs, DOM UI kits and
  external render engines отсутствуют.
- Базовая картинка чистая при `screenInterference=0`: chromatic/scanline/grain
  включаются только через graphics setting, active samosbor, game-over/glitch or
  weak neuro-interface interference.
- Persistent visual history живет в `World.surfaceMap` and floor memory/save:
  кровь, пули, scorch, burns, webs, PSI, Maronary, Seroburmaline, chalk and
  related residue.

## Taste Contract

Графика дружит с `taste.md` через простое правило: не прятать слабый визуал под
always-on грязью, а делать стены, пол, свет, силуэты, следы и эффекты
материальнее.

Разрешенное ядро:

- WebGL raycaster as Doom/Wolf-like technical base.
- Pixel-minimalist horror, hard silhouettes, readable projectiles.
- Concrete, lino, pipe, water, meat, void, paper, rust, screen and lamp
  materials.
- Persistent event traces instead of decorative gore wallpaper.
- Stateful filters: samosbor, smog, PSI, death, neuro-interface, optional user
  setting.

Запреты из вкуса, которые уже отражены в реализации:

- No frontend framework or DOM-heavy gameplay UI.
- No imported art packs.
- No always-on full-screen grain/scanline/chromatic/dither as baseline.
- No renderer-owned gameplay state.
- No sprite-only monster language without ecology/cue/counterplay data.

## Runtime Pipeline

Startup:

- `src/render/textures.ts` builds all `Tex` entries into procedural `64x64`
  `Uint32Array` textures.
- `src/render/sprites.ts` builds static sprite sheets for NPC occupations,
  authored NPCs, monsters, feature props, containers and projectiles.
- `src/render/sprite_index.ts` computes sprite indices from registries instead
  of magic numeric slots.
- `src/render/webgl.ts:initWebGL()` creates WebGL2 programs, FBO, data
  textures, sprite textures, particle buffers and surface atlas textures.

Per frame:

1. `updateGeneratedDynamicSky(dt)` may update a dynamic sky texture.
2. `updateDynamicData(world, camX, camY)` uploads changed world arrays and
   surface marks.
3. `renderSceneGL()` draws the 3D scene into a low-res FBO.
4. Depth-tested sprites and instanced transient particles are drawn into that
   same FBO.
5. A final blit shader copies the low-res image to the visible canvas and applies
   only active state/user filters.
6. HUD, maps, menus and text panels render separately through 2D canvas modules.

## WebGL Raycaster

`src/render/webgl.ts` owns the raycaster implementation.

Current facts:

- WebGL2 fragment shader performs DDA over toroidal world coordinates.
- World data is uploaded as data textures:
  `cells`, `wallTex`, `floorTex`, `features`, `light`, `fog`, `doorStates`.
- `uAtlas` stores procedural 64x64 wall/floor/ceiling texture tiles.
- DDA treats closed/locked/hermetic doors as blockers and open/hermetic-open
  doors as passable.
- Walls, floors, ceilings, water, abyss and dynamic sky are shaded in the same
  pass.
- `gl_FragDepth` writes depth, so sprites and particles clip against raycast
  geometry through WebGL depth testing.
- Camera data comes from `systems/camera.ts` as `CameraView`; renderer consumes
  position, angle, pitch, height and FOV, and does not decide camera mode.

FOV:

- `src/systems/ui_orchestrator.ts` stores graphics settings in browser local UI
  settings, outside save payload.
- FOV range is `60..110` degrees in 5-degree steps.
- Default FOV is `90` degrees.
- `cameraFovRadians()` is passed into `runtimeCameraView()` and then into
  `renderSceneGL()`.

## Materials, Fog And Light

Material response is shader-side and data-indexed by texture id.

Implemented material behavior:

- Concrete, panel, brick, hermetic wall, lino and concrete floor get dusty
  seam/flatness response.
- Tile, metal, pipe, marble and marble floor get colder highlights and seam
  response.
- Water floor gets darker wet tint and edge response.
- Meat, gut and larva materials get wet red response and organic light pulse.
- Void/dark materials get sparse green proof-like highlights.
- Floor and wall contact AO darkens near walls, wall bottoms, side-facing walls
  and door/solid boundaries.
- Distance fog is nonlinear: near space stays clearer, far space thickens with
  `1 - exp(-x*x*1.35)`.
- Local fog samples `world.fog` and pulses toward the active samosbor fog color.
- Tool beams and flashlight add local light/tint without becoming gameplay
  logic.

Lighting:

- `World.bakeLights()` is a bounded flood from light features, not a full-frame
  lighting solve.
- `Feature.LAMP` has radius 8 and intensity 1.0.
- `Feature.CANDLE` has radius 5 and intensity 0.62.
- Walls, abyss, lifts, hermetic walls and closed doors block or strongly
  attenuate propagation.
- Light is stored in `world.light`, uploaded through `lightVersion`, and sampled
  by the ray shader.
- Organic cells pulse light through `organicLightPulse()`.
- **ACES Filmic Tonemapping**: The raycaster applies an ACES curve at the end of the pipeline. This replaces hard clamping and allows high-intensity HDR light sources (`uLightQuality >= 3`) to create bright, natural roll-offs without color blowout, enhancing contrast in dark areas. A slight base gamma boost (`pow(x, 1.1)`) precedes the ACES curve to preserve shadow visibility.
- **Normal Mapping & Relief**: The shader calculates perturbed normal vectors dynamically based on the texture's luma (brightness) using hardware derivatives when `uLightQuality >= 3`. This derivative normal mapping creates micro-relief that responds to directional light, making surfaces like concrete, rust, and brick visually tactile without requiring separate normal maps.

Dynamic entity drop shadows and reflections:

- NPC and monster entities cast true 3D-projected dynamic drop shadows from nearby light sources (flashlight, lamps, candles) and full silhouette reflections on glossy floors (water, tile, marble).
- The reflection uses the sprite texture rendered at the entity's foot position as a dark semi-transparent overlay, colored with a dark blueish tint and fading out toward the top. It uses the exact same `raycasterRow` floor-depth projection as the raycaster, creating a perfect perspective-correct reflection that clips correctly against walls.
- The dynamic drop shadow is rendered via `uIsShadow == 3`, projecting the sprite's inverted silhouette onto the floor grid, syncing perfectly with the raycaster's Z-buffer to lay flat on the floor and occlude behind walls. Legacy procedural blob shadows have been completely removed.
- **Raytraced Floor Reflections**: For water floors (`Tex.F_WATER`), raytraced wall reflections are computed natively in the DDA floor pass when graphics quality is high (`uLightQuality >= 3`). The shader projects the wall's texture by vertically mirroring its Y coordinate downwards based on distance and seamlessly blends it with the floor color, capturing the wall's local lighting and applying a distance-based fade.
- Shadows are cast away from the closest unoccluded dynamic light source. `webgl.ts` collects up to 8 nearby stationary lights per frame and uploads them to the GPU.
- Both shadows and reflections use `depthMask(false)` — they darken the floor but don't write depth, so the entity sprite drawn afterward still passes depth test normally.
- Shadow fog fadeout: `alpha * (1 - fogFactor * 0.85)`.
- This is render-only; shadows and reflections do not affect gameplay, AI or save data.

Dynamic sky:

- `DynamicSkyTexture` can override ceiling sampling with a procedural sky image,
  ambient tint and fog tint.
- `setDynamicSkyTexture()` updates or clears the GPU texture.
- Sky is still sampled inside the existing raycaster pass, not a separate world.

## Filters And Screen Effects

The blit shader is state-driven.

Baseline:

- If `postStrength <= 0.001`, it returns `texture(uTex, vUV)` directly.
- This means no baseline chromatic offset, grain, scanline or vignette when
  interference/glitch/samosbor are inactive.

Active effects:

- `uScreenInterference` enables weak neuro-interface drift and mild filter
  grading when the user setting and HUD element allow it.
- `uGlitch` enables stronger band drift, chromatic offset, scanline darkening and
  grain.
- Active samosbor uses `uSamosborActive`, `uSamosborStyle`, `uSamosborPost` and
  variant tint from `src/data/samosbor_*`/runtime state.
- Samosbor screen styles are coded as wet noise, electric static, meat pulse,
  green signal, gold bell, white exposure or violet fallback.

User-facing controls:

- Graphics settings live in the `U` UI settings screen, graphics tab.
- Rows include screen interference, HUD motion, render-only 3D detailing, FOV
  and map contrast.
- Screen interference modes are normalized in `ui_orchestrator`; if the
  `screen_fx` HUD element is disabled, the menu reports interference as off.
- 3D detailing is stored as browser-local graphics state, resolves through
  data-only visual geometry profiles and defaults to low. The detailed pass
  contract, profile caps and validation commands live in [mesh.md](mesh.md).

## Surface Marks

`src/systems/surface_marks.ts` owns persistent surface residue.

World shape:

- `World.surfaceMap` is a sparse `Map<number, Uint8Array>`.
- Each entry is one `16x16 RGBA` overlay tile for a world cell.
- The same tile can be sampled by floor and wall shading for that cell.
- `World.surfaceFlags` stores per-cell bit flags such as chalk-map markers and
  interactive-surface identity.
- `surfaceVersion` and `markSurfaceCellDirty()`/`markSurfaceCellsDirty()` drive
  renderer uploads.

Current mark families:

- `SPLAT`
- `BULLET`
- `SCORCH`
- `DRIP`
- `POOL`
- `PSI`
- `MARONARY`
- `BLACK_HAND`
- `SEROBURMALINE`
- `BURN`
- `WEB`
- `BULLET_WALL`

Stamping:

- `stampMark()` procedurally stamps a shader-like shape and can spill across
  neighboring cells.
- `stampLocalMark()` clips to one target cell; wall bullet chips use this path.
- `paintSurfacePixel()` handles single-pixel surface writes.
- Black-hand marks have a small per-world trail registry and cap.

Persistence:

- `src/systems/floor_memory.ts` serializes `surfaceMap` as base64 cell entries
  and restores it with `restoreSurfaceMap()`.
- `surfaceFlags` are packed with floor memory as a `u8` field.
- Samosbor and breach/local geometry cleanup paths explicitly delete or restore
  surface entries when cells are rebuilt.

Renderer upload path:

- GPU surface atlas is `512x512`: 32 by 32 slots, each slot one `16x16` cell
  overlay.
- Maximum visible/uploaded surface slots at once: 1024.
- `surfaceIdxTex` maps world cell to atlas slot.
- Dirty cells can upload one tile and one index texel through `texSubImage2D`.
- Full rebuild is used for world replacement, camera-priority recut, overflow,
  missing slot, deleted cell or recovery paths.
- Surface uploads are throttled by `SURF_UPLOAD_MIN_INTERVAL_MS = 100`.
- If there are more than 1024 marked cells, atlas slots are sorted by toroidal
  distance to the camera.

Known current boundary:

- There is no separate side-aware wall-face decal map. Wall and floor overlays
  still share the per-cell `surfaceMap` tile. `BULLET_WALL` fixes common wall
  bullet readability by using local clipped stamps, but it is not a true
  `cell * 4 + face` wall-decal system.

## Particles And Impact FX

`src/systems/blood_fx.ts` owns transient particles and impact residue.

Particle kinds:

- `blood`
- `gore`
- `dust`
- `smoke`
- `spark`
- `debris`
- `light_mote`

Runtime facts:

- `particles` is a bounded global transient array.
- Maximum particles: 256.
- Particles are bound to one current `World`; switching worlds clears old
  transient particles.
- Particle physics uses world-space x/y, z/vz, gravity, drag, life and toroidal
  wrapping.
- Only particles with explicit `landMark` can leave persistent marks on landing.
- Blood/gore can land as `SPLAT`; sparks can land as tiny `BURN`; debris can
  land as tiny `SCORCH`; dust/smoke normally leave no persistent mark.

Rendered facts:

- Particles render as instanced screen-space quads after sprites and inside the
  raycaster FBO.
- Particle render cap matches `PARTICLE_INSTANCE_CAP = 256`.
- Particle cull distance is 16 cells.
- Particle size is clamped between `0.55` and `4.0` screen pixels.
- Fog fades particle color and alpha.

Impact effects:

- Projectile body/floor/wall impacts emit sparks, dust, smoke or web/flame/PSI
  residue depending on projectile type and sprite family.
- Ordinary wall bullets stamp two local `BULLET_WALL` chips: a dark core and a
  lighter chipped edge.
- Blood hits stamp floor splat, optional adjacent wall splatter and transient
  droplets.
- Death pools stamp larger persistent pools and optional gore spray.
- Wounded actors leave bounded drip trails through a rotating actor cursor.
- Explosions emit dust, smoke, sparks and debris with persistent landing marks
  only on a capped subset.
- Breach charges emit concrete or biomass dust based on changed geometry.

## Sprites

Sprites are billboard quads with alpha test, depth test and fog blending.

## Render-Only Mesh Pass

`src/render/mesh/` adds a bounded decorative WebGL mesh pass after the
raycaster depth pass and before sprites. It reads `CameraView`, `World`,
`visualSlots`, features, containers and data-only visual geometry profiles, then
draws depth-tested procedural low-poly geometry. It does not mutate gameplay
cells, entities, AI, collision, save data or floor memory.

[mesh.md](mesh.md) is the authoritative system document for this pass. This
section is only the graphics overview.

`World.visualSlots` stores 16 render-only byte codes per cell for local
micro-decoration intent. Scene collection resolves those bytes through
`src/data/visual_cell_slots.ts` into model instances with radius, scan,
instance, merge and triangle caps. The browser-local `3D детализация` setting
uses `src/data/visual_geometry_profiles.ts`; the default `low` mode keeps voxel
chunks off.

The same pass includes corridor-volume dressing. It reads rectangular 2D
corridor/tunnel topology from `World.cells`, `roomMap`, `RoomType` and the
resolved floor profile, then applies the generator-selected covering module:
concrete relief, technical pipes/cables, collector gutters, cave protrusions or
smooth meat folds. Placement uses seed/cell hash gates instead of regular
stride patterns. This is still render-only: corridor roughness does not alter
pathfinding, collision, save shape or floor memory.

The high profile enables an optional local voxel/chunk layer in
`src/render/mesh/voxel/`. It samples only camera-near chunks, builds a tiny
deterministic exposed-wall detail field, extracts greedy cuboid faces under
solid/triangle/chunk caps, and submits that mesh through the same depth-tested
mesh batch. Passable cells do not create voxel solids, including ceiling
slabs over lamps, screens or ceiling visual slots. Marching cubes is currently
a planned disabled API, not the stable path.

Bulky visual models are not gameplay collision. Future "do not walk through the
table" behavior belongs to the explicit 2D blocker plan in [block.md](block.md),
not to `visualSlots` or model bounds.

Static sprite registry:

- `src/render/sprite_index.ts` computes indices from NPC, monster, feature and
  container registries.
- `Spr.TOTAL` is derived, not hand-maintained.
- `monsterSpr()`, `featureSpr()` and `containerSpr()` are the public mapping
  helpers.
- Hostile projectile sprites are resolved through `hostileProjectileSprite()`.

Static sprite generation:

- `src/render/sprites.ts` generates occupation NPCs, travelers, priest,
  performer, authored NPC sprites, one fallback item-drop sprite, all monster
  sprites, feature object sprites, container sprites, projectiles, train car,
  art-study variants and floor-69 female variants.
- Ranged monster projectile sprite families are assigned from
  `src/data/monster_visuals.ts`.
- `tests/graphics-readability.test.ts` guards monster visual coverage,
  projectile family silhouettes and NPC readability visual ids.

Runtime sprite overrides:

- Procedural entity visuals are generated through
  `entities/procedural_visuals.ts`.
- Item drops use generated item sprites from `src/render/item_sprites.ts`.
- Entity sprite animations use the render-only
  `src/render/animations/` registry/runtime. The WebGL sprite path asks for a
  generic animated texture override after item drops and before procedural/static
  sprite fallback, so entities without a matching clip render unchanged.
- Animation PNG sources live under ASCII `anims/` and are packed by
  `scripts/generate-animation-sprites.mjs` into
  `src/render/animations/generated_frames.ts`; the browser runtime does not load
  source PNG files.
- `animation.md` owns the detailed render animation contract, extension rules
  and validation coverage.
- The first shipped entity clips are `olga_dmitrievna_walk`, a looping movement
  clip for Olga Dmitrievna, and `olga_dmitrievna_harm`, a one-shot HP-drop clip
  that has higher resolver priority than walk. Static Olga art remains the
  fallback whenever no animated frame is selected.
- Procedural entity texture cache cap: 8192.
- Item sprite texture cache cap: 8192.
- Animated entity texture cache cap: 512 entries, trimmed to 448 by LRU.
- Animated entity runtime memory cap: 2048 render-only entity entries.
- Cache entries are LRU-trimmed by use tick.
- Save payloads do not store static item sprite ids; item visuals derive from
  item definition ids.

Visible sprite collection:

- Dynamic actors are queried through `systems/entity_index.ts`, not by rendering
  the whole `entities` array.
- Visible sprite cap is 512.
- Visible entity query cap is 1024.
- Static object sprites include visible containers and `Feature` props in a
  bounded square around the camera with `MAX_DRAW` radius.
- Sprites sort far-to-near and then render with WebGL depth testing.
- Projectiles use additive blending; flame projectiles use a procedural animated
  flame shader and do not write depth.

## Procedural Textures

`src/render/textures.ts` generates the texture atlas at startup.

Current material set includes:

- concrete, brick, panel, tile, metal, rotten, curtain, dark;
- concrete/lino/tile/wood/carpet floor variants;
- ceiling;
- wood and metal doors;
- abyss and lift door;
- pipes and water;
- meat, meat floor, gut wall, gut floor, larva body;
- desk, target, hermetic wall;
- void wall/floor, portal, cross, icon;
- marble, red/green carpets, marble tile, parquet, carpet edges;
- generated slides, hint textures, posters, portraits and procedural screens.

Textures are code-native and deterministic. There is no asset pipeline or
external image dependency.

## Visual Micro-Detail

`src/data/visual_detail_profiles.ts` and `src/render/webgl.ts` implement
render-only deterministic micro-detail.

Purpose:

- Fill the gap between large `Feature`/billboard props and base 64x64 texture
  pixels.
- Make corridors, offices, kitchens, maintenance rooms, hell floors and void
  spaces less empty without creating gameplay entities or save data.

Profile resolution:

- `currentVisualDetailProfile()` in `main.ts` resolves a profile from the
  current `FloorRunEntry`.
- Story/design/procedural theme comes from `floor_theme_profiles`.
- Rows match by floor kind, base floor, route id, tags, danger and route depth.
- Active families are sorted by density and capped.

Caps:

- Maximum active detail families: 8.
- Maximum floor families sent to shader: 2.
- Maximum wall/ceiling families sent to shader: 2.
- Light dust density cap: 24.

Families:

- `paper_scraps`
- `newspaper_bits`
- `crumbs`
- `floor_dust`
- `wall_cracks`
- `chipped_concrete`
- `cobweb_corner`
- `rust_grit`
- `wet_dirt`
- `bone_crumbs`
- `gut_threads`
- `proof_specks`
- `light_dust`

Shader behavior:

- Detail is deterministic from cell coordinates, texture id, local texture UV,
  family id and seed.
- Material filters prevent paper on meat/void and keep rust/wet/proof details on
  appropriate surfaces.
- Detail does not mutate `World`, does not change save shape and does not create
  runtime entities.
- Light dust appears only when flashlight/tool beam provides enough light and
  fades with fog and distance.

## HUD, Map And Canvas UI

The 3D canvas is not a DOM app. Canvas overlays draw HUD, menus, map and UI.

Important renderer/UI facts:

- `src/render/hud.ts` draws live HUD, bars, weapon/tool state, prompts, log
  summary, minimap support and debug timing readouts.
- `src/render/map_ui.ts` draws the full map and uses layer settings from
  `ui_orchestrator`.
- `src/render/ui_settings_ui.ts` draws interface/graphics settings.
- `src/render/title_ui.ts` draws title/setup flows.
- Canvas UI uses local helper modules such as `ui_layout`, `ui_text` and
  `hud_fx`.
- Graphics settings are browser-local UI settings and are separate from game
  save data.
- Text and HUD should remain readable and clipped by canvas helpers, not by DOM.

Map and marks:

- Surface-map markers can be inspected by map UI for chalk and visual marks.
- Map contrast is a graphics setting and mirrors the map legend setting.
- Full map/minimap display is still renderer/UI only; gameplay truth remains in
  systems/world state.

## Performance Budgets

Graphics-side caps currently visible in code:

- Raycaster base resolution: `320x200`.
- Sprite cap: 512 visible sprites.
- Visible entity query cap: 1024.
- Particle cap: 256.
- Particle cull radius: 16 cells.
- Procedural entity sprite cache: 8192 textures.
- Item sprite cache: 8192 textures.
- Surface atlas slots: 1024 marked cells visible/uploaded at once.
- Surface dirty cells before full upload fallback: 512.
- Grid dirty rects per typed-array channel before full upload fallback: 32.
- Surface upload throttle: 100 ms.
- Visual detail shader upload: at most 2 floor families, 2 wall families and one
  light-dust family.

These caps are renderer budgets, not gameplay rules.

## File Map

- `src/render/webgl.ts`: WebGL2 raycaster, material shader, fog, detail shader,
  sprite pass, particle pass, blit filters, GPU uploads and render stats.
- `src/render/textures.ts`: procedural texture atlas source.
- `src/render/sprites.ts`: static procedural sprite sheet generation.
- `src/render/sprite_index.ts`: computed sprite registry.
- `src/render/item_sprites.ts`: generated item drop and inventory icon sprites.
- `src/render/generated_art_sprites.ts` and `src/render/art_sprites.ts`:
  optional/generated art-study sprite surfaces used by existing content.
- `src/systems/surface_marks.ts`: persistent surface mark stamping.
- `src/systems/blood_fx.ts`: transient particles, blood/gore/impact/explosion
  effects and landing marks.
- `src/data/visual_detail_profiles.ts`: micro-detail families and profile
  resolver.
- `src/systems/ui_orchestrator.ts`: browser-local UI/graphics settings.
- `src/render/ui_settings_ui.ts`: graphics settings canvas screen.
- `src/core/world.ts`: render-facing typed arrays, light baking, dirty versions,
  `surfaceMap` and `surfaceFlags`.
- `src/systems/floor_memory.ts`: surface mark persistence for parked/saved
  floor memory.
- `tests/graphics-readability.test.ts`: sprite/readability guardrail tests.

## Current Boundaries

These are current facts, not queued promises:

- There is no per-wall-face decal storage. `surfaceMap` is per cell.
- Light is baked from feature sources only; there is no dynamic shadow map.
  Entity sprite shadows are a render-only silhouette projection pass, not a true
  shadow-casting system.
- Micro-detail is shader-side deterministic and cannot represent player-made
  persistent small clutter.
- Static feature sprites are collected in a bounded camera-near square; this is
  a render cost boundary, not a placement system.
- Blit filters are not the baseline look. They depend on state/settings.
- Particles are transient. Only explicit landing marks persist.
- HUD and map are canvas overlays; renderer does not own gameplay decisions.

## Validation

For pure documentation edits, no runtime validation is required. For actual
graphics/render/source changes, use the project gates from `AGENTS.md`:

- renderer/UI/mobile/source changes: `npm run check`;
- browser-visible render changes: `npm run check:browser` or
  `npm run check:full` when Chrome is available;
- visual-risk changes should also be inspected in a browser screenshot/dev run
  for blank canvas, unreadable text, clipping, bad scaling and broken focus.
