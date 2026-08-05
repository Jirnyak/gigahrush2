# animation.md - текущая render-only система анимаций

> Роль: активный системный документ по render-only анимациям сущностей.
> Этот файл фиксирует shipped-факты реализации, контракты расширения, границы
> ownership и проверки. Он дружит с `README.md`, `architecture.md` и
> `graphics.md`: `README.md` остается общей факт-картой проекта,
> `architecture.md` - слоем ownership, `graphics.md` - обзором графики, а этот
> документ - подробным контрактом именно анимационного слоя.

Статус: current implementation document. Это не orchestration plan.
Старые параллельные задания `animation_0.md`..`animation_7.md` являются
архивными batch-промптами и лежат в
`../gatbage/history/batches/animation/`.

## Коротко

Система анимаций ГИГАХРУЩА - render-only слой для подмены WebGL sprite texture
у видимых entities. Она не меняет `Entity`, `World`, save shape, AI, combat,
quests, factions или A-Life. Gameplay systems остаются владельцами фактов:
движение, HP, смерть, AI state, statuses и события. Renderer только читает уже
существующее состояние и выбирает визуальный кадр.

Текущая shipped-поверхность:

- PNG-кадры лежат в ASCII `anims/`.
- `scripts/generate-animation-sprites.mjs` пакует source PNG в
  `src/render/animations/generated_frames.ts`.
- `src/render/animations/` содержит registry, resolver, transient runtime,
  WebGL texture cache and procedural source helpers.
- `src/render/webgl.ts` вызывает один generic animated texture override в
  sprite path после item-drop override и перед procedural/static fallback.
- Первые production clips:
  - `olga_dmitrievna_walk` - looping walk clip for Olga Dmitrievna.
  - `olga_dmitrievna_harm` - one-shot HP-drop clip, higher priority than walk.

Если entity не матчится ни на один animation clip, sprite rendering остается
прежним: item drop texture, procedural entity texture or static atlas.

## Ownership

Animation system belongs to `render/`.

Allowed:

- читать `Entity` fields such as `id`, `type`, `x`, `y`, `alive`, `hp`,
  `npcVisualId`, `plotNpcId`, `sprite`, `occupation`, `monsterKind`, `ai`,
  `statuses`, `attackCd`;
- читать `World` only for toroidal movement delta through `world.delta()`;
- хранить transient render memory and WebGL texture cache;
- expose cheap render debug stats;
- reset render runtime on floor visual rebuild, cache rebuild or WebGL dispose.

Forbidden:

- mutating gameplay state from animation code;
- adding animation fields to save payloads;
- changing `SAVE_SHAPE_VERSION` for render animation state;
- adding content-specific branches in `main.ts`, `core/world.ts`,
  `systems/ai/*`, combat, quests or `render/webgl.ts`;
- loading PNG files in browser runtime;
- replacing `systems/entity_index.ts` visible entity collection with a full
  entity scan.

## Implementation Map

```txt
anims/
  olga_dmitrievna_walk/0.png..5.png
  olga_dmitrievna_harm/0.png..2.png

scripts/
  generate-animation-sprites.mjs

src/render/animations/
  types.ts
  registry.ts
  runtime.ts
  resolver.ts
  textures.ts
  procedural.ts
  generated_frames.ts
  index.ts
  defs/
    olga.ts
```

Module roles:

- `types.ts`: public clip, selector, trigger, playback, source, frame and
  procedural-source types.
- `registry.ts`: clip registration, id validation, selector matching and
  priority helpers.
- `runtime.ts`: logical per-entity clip runtime, capped and resettable.
- `resolver.ts`: chooses the active logical frame from registered clips.
- `textures.ts`: WebGL integration, movement/hp render snapshot, texture cache,
  custom resolver registry and debug stats.
- `procedural.ts`: generic procedural animation source adapter and CPU frame
  cache.
- `generated_frames.ts`: generated RLE frame packs from `anims/`.
- `defs/olga.ts`: first production clip definitions for Olga Dmitrievna.
- `index.ts`: production clip registration side effect.

## Data Flow

Build-time source flow:

1. Source PNG frames live under `anims/<clip_id>/<frame>.png`.
2. `scripts/generate-animation-sprites.mjs` validates source folders and PNGs.
3. The script emits `src/render/animations/generated_frames.ts`.
4. Clip definitions refer to generated frame pack ids.

Runtime render flow:

1. `renderSpritesGL()` collects visible dynamic actors through
   `getEntityIndex().queryRadiusCapped(...)`.
2. Static features and containers are collected through existing bounded sprite
   collectors.
3. Sprites are sorted far-to-near as before.
4. Texture selection order is:
   - item drop texture;
   - animated entity texture override;
   - procedural entity texture;
   - static sprite atlas.
5. The animated override returns `WebGLTexture | null`.
6. If it returns `null`, the old sprite path continues unchanged.

The WebGL hook is generic. It receives entity, world, render time, sprite index,
sprite source, scale and z. It does not know about Olga by name; Olga binding
lives in `src/render/animations/defs/olga.ts`.

## Clip Definitions

`RenderAnimationClipDef` is a plain object:

```ts
{
  id: string;
  channel: 'entity_sprite' | 'surface_material' | 'screen_fx';
  selector: RenderAnimationSelector;
  trigger: RenderAnimationTrigger;
  playback: RenderAnimationPlayback;
  priority: number;
  source: RenderAnimationSource;
  anchor?: RenderAnimationAnchor;
}
```

Current WebGL integration renders `entity_sprite` frame-pack textures. The type
system already names `surface_material` and `screen_fx`, but those channels are
not yet wired to a production material/screen animation pass.

Selector fields:

- `plotNpcId`
- `npcVisualId`
- `fallbackPlotNpcId`
- `entityType`
- `monsterKind`
- `sprite`
- `occupation`

Visual matching rule:

- If `npcVisualId` matches, the clip matches.
- If the clip has `npcVisualId` but the entity has no `npcVisualId`, the clip
  may fall back to `fallbackPlotNpcId`.
- If the entity has a different explicit `npcVisualId`, fallback plot id does
  not override that visual identity.

This keeps authored visual ids stronger than broad plot ids.

## Triggers

Supported trigger kinds:

- `moving`: actor moved farther than the small render epsilon since the previous
  render snapshot. Movement uses toroidal deltas supplied by `world.delta()`.
- `damaged`: actor HP decreased compared with the previous render snapshot.
- `state`: matches `ai.goal`, `ai.npcState`, `monsterStage`, statuses,
  attack cooldown, windup or a supplied predicate.
- `always`: always eligible while selector matches.
- `manual_event`: future-compatible manual visual event trigger.

Damage trigger boundary:

- The current damage detector is render-local and only sees HP deltas for
  actors observed by the renderer.
- It does not replay old offscreen damage when an actor becomes visible later.
- Exact offscreen-to-onscreen one-shot replay would require a future bounded
  damage/event fact from gameplay systems.

Death boundary:

- Ordinary walk/harm clips do not play for dead entities.
- Death visuals currently belong to existing blood, surface marks, particles and
  corpse/death systems.
- A future death animation should be an explicit clip family, not an accidental
  extension of harm.

## Playback And Priority

Supported playback fields:

- `mode` / `loop`
- `once`
- `holdLast`
- `fps`
- `durationSec`
- `retriggerCooldownSec`
- `phaseByDistance`

Priority constants:

```txt
harm / damage one-shot      100
action / attack / use        80
special state                60
locomotion                   30
idle                         10
fallback                      0
```

Resolver rule:

- One-shot active clips block lower/equal priority clips until they finish.
- A higher priority candidate can replace the active clip.
- Loop clips are selected while their trigger remains true.
- `phaseByDistance` advances frame phase from movement distance instead of only
  wall-clock time.

## Current Olga Clips

Olga Dmitrievna is selected through:

```txt
entityType = NPC
npcVisualId = olga_dmitrievna
fallbackPlotNpcId = olga
```

`olga_dmitrievna_walk`:

- source: `framePack` `olga_dmitrievna_walk`;
- frames: 6;
- runtime frame size: `64x64` after transparent top/bottom trim and square normalization;
- trigger: `moving`;
- playback: loop, `fps = 9`, `phaseByDistance = true`;
- priority: `30`.

`olga_dmitrievna_harm`:

- source: `framePack` `olga_dmitrievna_harm`;
- frames: 3;
- runtime frame size: `64x64` after transparent top/bottom trim and square normalization;
- trigger: `damaged`;
- playback: once, `fps = 12`, `retriggerCooldownSec = 0.25`;
- priority: `100`.

Behavior:

- Walk loops while Olga is visibly moving.
- Harm plays once when Olga's visible HP drops.
- Harm overrides walk.
- After harm ends, walk or static fallback resumes naturally.
- Static Olga art remains fallback when no animated frame is selected.

Anchor metadata:

- Olga clips preserve the static art `anchorFeet` metadata.
- The current WebGL sprite path still uses existing billboard sizing; anchor
  metadata is available to future tuning but does not change gameplay.

## Asset Intake

Source convention:

```txt
anims/
  <clip_id>/
    0.png
    1.png
    2.png
```

Rules:

- The directory must be ASCII `anims/`.
- The Cyrillic-lookalike `./аnims/` path is invalid.
- `.DS_Store` is invalid under source media.
- Clip ids use lowercase snake_case.
- Frame filenames must be contiguous numeric PNG names: `0.png..N.png`.
- PNGs must be 8-bit RGBA and non-interlaced.
- Every frame in one clip must share width and height.
- Generated frame packs trim transparent top/bottom and normalize every frame
  into the same `64x64` square runtime format as static art sprites.
- Browser runtime does not read these PNGs.

Generation command:

```bash
node scripts/generate-animation-sprites.mjs
```

Generated output:

- `GENERATED_ANIMATION_CLIP_IDS`
- `GENERATED_ANIMATION_FRAME_PACKS`
- `getGeneratedAnimationFramePack(id)`
- `decodeGeneratedAnimationFrame(clipId, frameIndex)`

Frame packs store RLE `Uint32` pixels and source hashes. `textures.ts` decodes a
frame only on WebGL texture cache miss; cached animated textures are reused by
cache key.

## Runtime And Caches

Logical animation runtime:

- file: `src/render/animations/runtime.ts`;
- key: entity id;
- stores previous x/y, previous HP, active clip id, start/end time,
  last damage time and walk distance phase;
- cap: `2048` entries;
- trim: oldest `lastSeenAt`, protected current entity where applicable;
- reset: `resetRenderAnimationRuntime()`.

WebGL animation runtime/cache:

- file: `src/render/animations/textures.ts`;
- render snapshot tracks previous x/y/hp for visible texture resolution;
- runtime cap: `2048` entity entries;
- animated texture cache cap: `512`;
- animated texture cache trims to `448`;
- cache key includes clip/frame/source hash and dimensions;
- RLE frame decode and GPU upload happen only on cache miss;
- cache reset deletes WebGL textures when a GL context is supplied.

Reset paths:

- `rebuildProceduralSpriteCache()` clears procedural, item and animation texture
  caches. `main.ts` calls it after loaded-floor visuals are finalized.
- `disposeWebGL()` deletes animation textures through
  `resetAnimatedEntityTextureOverride(gl)`.
- Floor switches, samosbor rebuilds and world replacement paths that run the
  loaded-floor visual finalizer therefore clear transient animation state.

Hot-path guard:

- Built-in registered clips are checked by selector before render runtime is
  allocated for an entity.
- If no built-in clip matches and no custom resolver is registered, the animated
  override exits immediately.
- Custom resolvers are global by design. If one is registered, it may be asked
  about each visible non-item entity, so custom resolver predicates must stay
  cheap.

## Procedural Sources

`src/render/animations/procedural.ts` supports future procedural clip sources
without forcing existing material effects to migrate.

Implemented source kinds:

- `procedural_cpu_frame`: creates or copies a base `Uint32Array`, mutates it by
  clip id, visual key, frame index, phase bucket and seed, then caches the
  result.
- `procedural_phase`: returns phase parameters for future shader/material/screen
  uses without producing a texture frame.

Procedural frame cache:

- cap: `512`;
- target after trim: `384`;
- key: clip id + visual key + frame index + phase bucket.

Current production Olga clips use generated frame packs, not procedural frames.
The procedural path is covered by tests and is ready for future idle, blink,
material or screen-effect adapters.

## Debug And Stats

`getRenderSceneDebugStats()` includes:

- visible sprite count;
- drawn sprite count;
- visible entity query result count;
- sprite cap;
- mesh stats;
- active animated sprite count;
- drawn animated sprite count;
- animated sprite texture cache size.

`getAnimatedEntityTextureDebugStats()` also exposes internal animation cache and
runtime sizes, resolver count and last clip/stat ids for debug surfaces that
need deeper render inspection.

Stats are cheap counters and cache sizes. The render path does not allocate
large debug strings per sprite.

## Extension Contract

To add a new manual entity animation:

1. Put source frames under `anims/<clip_id>/`.
2. Run `node scripts/generate-animation-sprites.mjs`.
3. Add a focused clip definition under `src/render/animations/defs/`.
4. Register that definition from `src/render/animations/index.ts`.
5. Add tests for selector matching, trigger priority and frame pack facts.
6. Run at least `npm run typecheck` and `npm run test:unit`.
7. For WebGL-visible/render-risk changes, run `npm run check` and
   `npm run check:browser`.

To add a procedural clip source:

1. Define a procedural source shape through `RenderAnimationProceduralSource`.
2. Keep the key bounded by clip id, visual key and phase/frame bucket.
3. Cache generated CPU frames through `RenderAnimationProceduralFrameCache`.
4. Avoid per-draw uncached CPU generation.
5. Do not migrate existing material/samosbor/flame effects unless that migration
   has its own measured task.

Do not:

- add clip-specific branches to `render/webgl.ts`;
- use Russian display names as selectors;
- mutate entity state from animation code;
- add animation state to save/load;
- make renderer decide gameplay facts such as damage ownership, death, faction
  hostility, quest state or AI intent.

## Validation Coverage

Focused tests:

- `tests/animation-frame-pack.test.ts`: source path, no `.DS_Store`, generated
  Olga frame packs, dimensions, frame counts, hashes and decode.
- `tests/render-animations.test.ts`: resolver priority, walk start/stop,
  one-shot completion, cooldown and runtime trim.
- `tests/animation-textures.test.ts`: texture cache keys, LRU eviction and
  resolver registry behavior.
- `tests/olga-animation.test.ts`: Olga selector matching, plot fallback,
  priority and frame facts.
- `tests/render-animation-procedural.test.ts`: procedural CPU frame cache,
  phase buckets, trim and failure fallback.

Broad checks for render/system work:

```bash
npm run typecheck
npm run test:unit
npm run check
npm run check:browser
```

`npm run check:browser` is required for future animation changes that touch
WebGL rendering, sprite sizing, texture upload, source generation or browser
smoke behavior when Chrome is available.

## Known Boundaries

- Current production hook is entity sprite texture override only.
- Material and screen animation channels are typed but not wired as shipped
  production channels.
- Damage one-shots are render-local HP delta observations, not authoritative
  gameplay events.
- Offscreen damage is not replayed when the actor becomes visible.
- Animated frame anchor metadata exists, but current billboard sizing still
  follows the established sprite path.
- Source PNGs are source media only; single-file browser builds consume the
  generated TypeScript frame pack.
