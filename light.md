# Освещение (Lighting System)

> Роль: архитектурный документ системы освещения. Верхняя часть — это уже
> shipped-факты текущего движка (gameplay lightmap + GPU material lighting).
> Нижняя часть («План улучшений») — это roadmap, не shipped; после реализации
> факты переносятся сюда и в `graphics.md` / `README.md`.

## Текущая Система (shipped)

Гигахрущ использует гибридное освещение: дискретное gameplay-поле света на CPU
плюс попиксельную «красоту» материала на GPU поверх него.

### Gameplay Light (CPU, запекание при генерации)

- Массив `world.light` (`Float32Array`, 0..1 на клетку) — источник правды света.
- Источники: `Feature.LAMP` и `Feature.CANDLE` задают яркость своей клетки.
- Запекание: `world.bakeLights()` в `src/core/world.ts` перестраивает lightmap
  flood-fill распространением от источников по проходимым клеткам (стены, бездна
  и закрытые двери свет не пропускают) с радиусным затуханием. Вызывается при
  генерации этажа и при изменении света через `markFeaturesDirty(true)`.
- Загрузка в GPU: `world.light` грузится в текстуру `uLight` только при изменении
  `lightVersion`, не каждый кадр.
- Самосбор: волна копирует `source.light`, поэтому свет не затирается при проходе.

### GPU Render Light (WebGL material lighting)

В `src/render/webgl.ts` свет обрабатывается попиксельно поверх gameplay-поля:

- `sampleLightSmooth` — 4-тапная билинейная интерполяция `uLight` для непрерывного
  света плюс аналитический градиент (направление света без CPU-solve).
- `materialResponse(texId, ...)` — материальный отклик по типу поверхности:
  металлический/холодный specular на плитке, металле и трубах, влажный блеск на
  воде, мягкая красная пульсация на органике/мясе, матовый бетон/линолеум,
  зеленоватые контуры в пустоте/темноте, плюс псевдонормали от микродеталей
  (швы плитки, стыки панелей) и контактные тени у стен/дверей/углов.
  Для воды (`Tex.F_WATER`), плитки (`Tex.F_TILE`) и мрамора (`Tex.F_MARBLE_TILE`) 
  также включены **настоящие отражения спрайтов** (персонажей и монстров): спрайт
  рендерится "вниз" от ног с правильной floor-depth проекцией и прозрачностью.
  На высоких настройках (`uLightQuality >= 3`) для воды также включены **настоящие raytraced отражения стен**:
  текстура стены зеркально проецируется вниз и смешивается с цветом пола с учетом дистанции и освещения.
- `applyLightFX(color, texId, ndl, drive, grad, dirShape)` — поверх material lighting:
  направленный диффуз (стены, обращённые к свету, светлеют до ~1.30x, скользящие
  уходят в тень до ~0.52x), умеренный specular-блик от света игрока на блестящих
  материалах (вода, плитка, металл, трубы, мрамор, мясо; узкий блик у металла,
  широкий у матовых) и мягкий градиентный bump по `sampleLightSmooth`-производной.
  Блик специально держится умеренным (мягкий sheen, не пластиковое зеркало).
  `ndl` — насколько грань повёрнута к свету (стены: `N·L` от нормали грани против
  направления луча; пол: 0, только wet-sheen), `drive` — сила света игрока,
  `dirShape` — доля направленного диффуза (стены 1.0, пол 0.0). Включается на
  качестве `medium`+; bump только на `high`/`experimental`.
- `eyeLight(dist)` — мягкий постоянный приближённый свет у игрока (render-only,
  умеренный ~0.22, затухает к ~11 клеткам). Гарантирует, что направленный диффуз и
  блики видны даже без снаряжённого фонарика (все фонарики в `tool_lights.ts` имеют
  `passive: false`, поэтому `uFlashlight` равен нулю, пока игрок не зажал кнопку
  инструмента). Фонарик и tool-beam складываются с `eyeLight` в общий `drive`.
- `shadeCurve(lit) = pow(lit, 1.32)` — кривая углубления теней: тянет нижний и
  средний свет вниз, оставляя яркие участки, поэтому сцена читается тёмной и
  атмосферной, а не плоско-пересвеченной. Применяется к `lit` в `shadeWall` и
  `shadePlane` (включая потолок, отчего его края темнеют по перспективе). Пол
  дополнительно затемняется (`litC *= 0.78`), потому что на пол попадает меньше
  света — он читается темнее стен, как в эталонной картинке.
- Bloom (свечение): screen-space bright-pass + сепарабельный гауссов блюр между
  raycaster-FBO и финальным blit (`BLOOM_PREFILTER_FRAG_SRC` + `BLOOM_BLUR_FRAG_SRC`,
  half-res ping-pong FBO). Аддитивно подмешивается в blit по `uBloomStrength`
  (умеренная сила, только реально яркие пиксели). Активен только на
  `high`/`experimental`. Это чистый GPU-проход, нагрузки на CPU нет.
- `organicLightPulse` — лёгкая пульсация клеток из плоти от координат и `uTime`.
- `uAmbient` — базовый ambient этажа; `darkness`/void-этажи держат ambient около
  нуля, поэтому там светит только игрок/инструменты.

### Динамические тени (Dynamic Shadows)

Появились честные 3D-проецируемые динамические тени от спрайтов (NPC и монстров):
- Шейдер `SPRITE_VERT_SRC` / `SPRITE_FRAG_SRC` поддерживает режим `uIsShadow == 3`, который проецирует тень на геометрию пола.
- Z-буфер тени (`uDepth`) синхронизируется с Z-буфером Raycaster-пола, поэтому тени идеально лежат на полу, искажаются в перспективе и перекрываются стенами.
- Форма тени: инвертированный силуэт спрайта (`blend = 0.5 - aPos.y`), где макушка уходит вдаль и плавно растворяется (`fade`), а непрозрачные стопы привязаны к ногам персонажа.
- Тень отбрасывается в сторону, противоположную ближайшему неперекрытому источнику света (включая как фонарик игрока, так и стационарные `Feature.LAMP` / `Feature.CANDLE`, которые теперь динамически сортируются по дальности и передаются в uniform массив).
- Легаси-реализация blob-теней (`uIsShadow == 2`) полностью удалена. Теперь персонажи отбрасывают честные тени от любых источников света, а вне освещенных зон полностью сливаются с темнотой без градиентных пятен.

Это render-only слой: он не сериализуется и не влияет на AI, стелс, факции,
save/load или floor memory. Gameplay-правда света остаётся в `world.light`.

### Mesh-пасс в той же системе света (shipped)

3D mesh-пасс (`src/render/mesh/`) освещается тем же запечённым `world.light`, а не
отдельным фейковым «солнцем»:

- `MESH_FRAG_SRC` (`src/render/mesh/shaders.ts`) семплирует `uLight` по мировым
  координатам фрагмента (`vWorldXY`, `texelFetch` с битовым wrap по степени двойки).
  Объект в неосвещённой клетке остаётся тёмным — это «контактная» привязка к свету.
- Само-затенение от ламп: 4-тапный градиент `world.light` даёт направление на
  ближайший источник, `ndl = dot(normal.xy, normalize(grad))` подсвечивает грань
  меша, обращённую к лампе, и притемняет противоположную. Это shipped-«тень» меш-
  пасса (grounded + направленное само-затенение), не shadow-mapped cast-тени.
- `eyeLight` (~0.22) и общий `uAmbient` этажа совпадают с raycaster, и меш-пасс
  применяет ту же кривую углубления теней `pow(litBase, 1.32)`, поэтому меши сидят в
  той же яркости и контрасте, что пол и стены. Прокидка: `MeshPassContext.ambient` /
  `lightTex`, биндинг `uLight`/`uLightOn` в `pass.ts`, параметры из `webgl.ts`
  (`meshPassContext` / `updateAndRenderMeshPass`). Если lightmap не привязан
  (`uLightOn=0`), меш-пасс откатывается к старому фейковому освещению.
- Декоративные `Feature` (раковина, унитаз, полка и др.) рендерят свои напольные
  3D-модели (`sink_basin`, `toilet_bowl`, `shelf_block` в `FEATURE_MESH_DEFS`):
  они не привязаны к стене через wall-hint visual-коды, поэтому видны и в центре
  комнаты.

### Мерцание ламп и Самосбор (shipped)

Чтобы не перестраивать O(W²) lightmap каждый кадр (что запрещено правилами оптимизации), мерцание неисправных ламп и эффект тревоги при Самосборе реализованы исключительно на стороне GPU:
- На этапе генерации вызывается `world.initializeLampBlinks(seed)`, который назначает случайную частоту мерцания для некоторых ламп в массив `lampBlinks`.
- Этот массив передаётся в шейдеры (Raycaster и Mesh-pass) как текстура `uLightBlinks`.
- В шейдере функция `getBlinkPulse()` генерирует резкий, прерывистый strobe-эффект (flicker) для сломанных ламп и единую красную пульсацию при Самосборе (`uSamosborAlert`).
> **Замечание для будущей доработки:** Текущее мерцание — это чисто визуальный shader-based фейк. В будущем может понадобиться доработка: например, синхронизация визуальных вспышек со звуковыми щелчками (audio cues) или интеграция с логикой электропитания этажа.

### Качество освещения (shipped)

Браузер-локальная настройка «Качество света» (`lightingQualityMode` в
`src/systems/ui_orchestrator.ts`) с режимами `off / low / medium / high /
experimental`, по умолчанию `experimental` (максимум). Передаётся в шейдер как
`uLightQuality` (0..4) и градуирует эффекты:

- `off` (0) — старый блочный `sampleLight`, без сглаживания и без FX.
- `low` (1) — плавный свет `sampleLightSmooth`, без `applyLightFX`.
- `medium` (2) — добавляется `applyLightFX` (бампы + блики).
- `high` (3) — добавляется bloom.
- `experimental` (4) — максимум: bloom сильнее, все эффекты включены.

Настройка живёт в группе «Графика» рядом с «3D детализация»
(`visualGeometryMode`). GLSL компилируется в рантайме, поэтому любое изменение
шейдера нужно проверять реальным браузерным прогоном `npm run smoke` — сборка
`npm run build` ошибки шейдера не ловит.

---

# План улучшений (roadmap, не shipped)

> Роль: рабочий план для улучшения света в текущем WebGL raycaster без
> переписывания движка, без новых runtime-зависимостей и без переноса нагрузки
> на CPU. Это не shipped-факт; после реализации факты нужно перенести в
> `graphics.md` / `README.md`.

## Короткий Ответ

Да, сделать можно. Лучшее решение для проекта - не настоящий RTX/path tracing, а
**raycaster-native GPU lighting**:

1. ✅ **Shipped.** Улучшить material lighting прямо в текущем fragment shader
   raycaster (`sampleLightSmooth` + `applyLightFX`).
2. ✅ **Shipped.** Добавить маленький screen-space emissive/bloom pass между FBO
   и финальным blit (см. shipped-секцию выше).
3. Подсветить sprites и mesh тем же визуальным светом, чтобы NPC, монстры,
   предметы, лампы, снаряды и декоративная геометрия жили в одной картинке.
4. Оставить capped shader ray probes только как high/experimental graphics
   mode, а не baseline.

Это даст красивый "шейдерный рейтрейсинговый" эффект почти полностью на GPU,
но сохранит текущую архитектуру: `World.light` остается gameplay lightmap,
renderer добавляет render-only красоту поверх него.

## Почему Не Полный Ray Tracing

Текущая сцена - не mesh-based 3D renderer. Это WebGL2 DDA raycaster по
`1024x1024` grid:

- `src/render/webgl.ts` уже делает один DDA-луч на каждый пиксель `320x200`.
- Shader уже читает `cells`, `wallTex`, `floorTex`, `features`, `light`, `fog`
  и `doorStates`.
- `world.light` уже печется из `Feature.LAMP` / `Feature.CANDLE` в
  `src/core/world.ts` и загружается в GPU texture только при `lightVersion`.
- Некоторые systems могут считать `world.light` gameplay-фактом. GPU-only
  свет не должен заменять эту правду.

Полный path tracing, multi-bounce GI, второй полный shadow DDA на каждый пиксель
или per-frame flood lightmap по всему `1024x1024` полю дадут плохое отношение
цены к картинке. На baseline нельзя удваивать стоимость raycaster.

Правильная формула: **один gameplay lightmap + шейдерные фейки материала,
направления, свечения, тумана и редкие короткие probe-лучи**.

## Цели Вкуса

Свет должен улучшать:

- бетон, линолеум, плитку, металл, воду, мясо, пустоту и бумагу;
- читаемость силуэтов, выхода, снаряда, цели и укрытия;
- локальные события: лампа, свеча, экран, выстрел, УФ-луч, самосборный туман;
- нижние этажи через материал и форму, а не через always-on красную грязь;
- darkness/void floors без поломки намеренной темноты.

Свет не должен:

- скрывать слабую картинку зерном, scanline, dither, blur, chromatic dirt или
  постоянной vignette;
- делать геймплейные решения в renderer;
- добавлять DOM/UI-framework/render-engine;
- требовать новых asset pipelines;
- делать мир темным настолько, что игрок не видит решение.

## Архитектурное Разделение

### Gameplay Light

`world.light` остается CPU-baked gameplay field:

- источники: существующие `Feature.LAMP`, `Feature.CANDLE` и будущие
  gameplay-источники;
- обновление: только через существующие dirty/version paths;
- хранение: текущий `Float32Array`, GPU upload по `lightVersion`;
- смысл: systems могут на него опираться.

### Render Beauty Light

Новый визуальный слой:

- живет в `render/`;
- не сериализуется;
- не влияет на AI, stealth, factions, save/load или floor memory;
- получает данные из уже загруженных GPU textures и маленьких uniform/cap
  buffers;
- отключается через graphics mode.

## Предлагаемый Порядок Работ

### P0: Shader Material Lighting Pack

Самый дешевый и правильный первый шаг.

Файлы:

- `src/render/webgl.ts`
- возможно `src/systems/ui_orchestrator.ts`
- возможно `src/render/ui_settings_ui.ts`

Что сделать:

- добавить `lighting_quality = off|low|medium|high` в browser-local graphics
  settings, вне save payload;
- добавить GLSL `materialProps(texId)`:
  `roughness`, `specular`, `wetness`, `emissive`, `bump`;
- добавить аналитические pseudo-normals по `texId`, `texX/texY`, wall side,
  seam/grid/noise;
- усилить lightmap gradient:
  семплить `sampleLight(cell)`, `sampleLight(cell +/- x/y)` и получать
  направление света без нового CPU solve;
- дать материалам разные ответы:
  - бетон: пыль, слабые ребра, плоский холодный свет;
  - плитка/металл/трубы: холодный specular;
  - вода: низкий wet glint;
  - мясо/кишка: мягкий красный wet pulse;
  - void/dark: редкий зеленый proof edge;
- усилить floor/wall contact AO у стен, дверей, углов и нижней части стены;
- не увеличивать `world.light` upload cadence.

Бюджет:

- baseline `low`: только ALU + 4-6 extra light texture samples на hit;
- `medium/high`: больше material math, но без дополнительных DDA loops.

Критерий успеха:

- даже без bloom стены и пол становятся материальнее;
- darkness floors остаются темными;
- `SMOKE_LIGHTING_MODE=off` визуально возвращает старый путь.

### P1: Screen-Space Emissive / Bloom Pass

Лучший GPU-only "красивый" шаг после P0.

Файлы:

- `src/render/webgl.ts`
- опционально небольшой `src/render/lighting_pass.ts`, если `webgl.ts` станет
  слишком шумным

Что сделать:

- добавить low-res emissive extraction из текущего `rayColorTex`;
- сделать 2-pass separable blur на 160x100 или 80x50 texture;
- смешать результат в final blit;
- источники bright pixels:
  лампы, свечи, экраны, projectile glow, tool beam, UV beam, dynamic sky holes,
  mesh emissive colors;
- не делать bloom always-on кислотным фильтром: он должен быть физически
  привязан к ярким объектам.

Бюджет:

- `low`: bloom off;
- `medium`: half/quarter-res bloom, 3-5 taps;
- `high`: чуть шире blur, still fixed taps;
- никаких CPU scans для bright map.

Критерий успеха:

- лампы и свечи дают halo;
- экраны и снаряды читаются в тумане;
- картинка не становится мыльной.

### P2: Sprite Lighting

Сейчас sprites depth-tested/fogged, но им нужен общий свет сцены.

Файлы:

- `src/render/webgl.ts`
- sprite vertex/fragment shader block

Что сделать:

- передать sprite world position или уже имеющиеся world deltas в sprite shader;
- bound `uLight` / `uFog` к sprite program;
- семплить `world.light` у основания/центра sprite;
- применить ambient + lightmap + flashlight/tool beam response;
- оставить projectile/flame glow stronger-than-fog, но bounded;
- не менять gameplay entity data.

Критерий успеха:

- NPC/монстры в темном коридоре действительно темнее;
- у лампы и в луче они читаются лучше;
- projectile silhouettes не теряются.

### P3: Mesh Light Consistency

Render-only mesh pass уже имеет normals, но освещается отдельным простым
directional light.

Файлы:

- `src/render/mesh/shaders.ts`
- `src/render/mesh/pass.ts`
- возможно mesh context types

Что сделать:

- либо оставить mesh под общим screen-space bloom;
- либо привязать `lightTex` к mesh shader и семплить `world.light` по world
  position;
- добавить flashlight/tool beam response;
- использовать `MeshMaterialDef.emissive` для glow source.

Критерий успеха:

- трубы, потолочные панели, кабели и voxel detail не выглядят приклеенными к
  другой световой системе.

### P4: Capped Shader Ray Probes

Это единственный этап, который можно называть "shader raytracing", но он должен
быть ограниченным.

Файлы:

- `src/render/webgl.ts`
- `src/systems/ui_orchestrator.ts`
- возможный маленький render-only collector для nearest visual lights

Что сделать:

- только для `high` / `experimental`;
- максимум `4-8` render-only dynamic light sources near camera;
- source types сначала:
  player flashlight/tool beam, projectiles, fire/flame, active screen/portal,
  selected strong lamps;
- CPU не считает освещение, только передает маленький uniform array;
- shader делает short DDA/probe radius `6-12` cells с fixed step cap;
- если cap превышен, источники выбираются ближайшие/самые яркие через стабильный
  bounded selection, без full-world scan каждый кадр.

Жесткий запрет:

- не запускать второй полный `MAX_DRAW` DDA для каждого пикселя baseline;
- не делать loops по всем лампам;
- не добавлять GPU-generated gameplay lightmap.

Критерий успеха:

- high mode получает заметные локальные тени/occlusion у дверей и углов;
- low/medium остаются быстрыми и стабильными.

### P5: Volumetric Fakes

Уже есть distance fog, local fog, light dust и tool beam. Их можно усилить без
дорогой физики.

Что сделать:

- cone dust для flashlight/tool beam;
- самосборные fog shafts по `world.fog`;
- flicker для свечей и ламп через `uTime` + cell hash;
- wet haze у water/meat floors;
- dynamic sky tint в потолочных/открытых участках.

Бюджет:

- fixed 4-8 samples максимум и только для `medium/high`;
- для `low` оставить текущую cheap fog модель.

## Graphics Modes

Предложение:

| Mode | Поведение |
| --- | --- |
| `off` | старый путь, без новых визуальных расходов |
| `low` | P0 material lighting, без bloom/probes |
| `medium` | P0 + cheap bloom + sprite lighting |
| `high` | medium + mesh consistency + stronger volumetric fakes |
| `experimental` | high + capped shader ray probes |

Default:

- desktop: `medium`, если perf smoke и ручной браузерный осмотр нормальные;
- mobile: `low`;
- stress/smoke fallback: `off` / `low`.

Настройка должна жить в browser-local UI settings, как render-only geometry
mode. Не добавлять в game save.

## Debug And Tests

Нужны не brittle screenshots, а метрики.

Добавить:

- `SMOKE_LIGHTING_MODE=off|low|medium|high|experimental`;
- `lighting_debug_overlay` в FPS/debug HUD:
  mode, pass ms, bloom size, sample count, probe count, skipped lights;
- `lighting_lab_scene` debug hook:
  лампа, свеча, темный коридор, дверь/окклюдер, fog cell, projectile/tool beam;
- optional `lighting_heatmap` только debug mode.

Тесты:

- unit tests для profile normalization/caps;
- unit tests для falloff finite/in `[0..1]`;
- render stats tests по образцу mesh stats;
- smoke luminance metrics:
  - canvas не пустой;
  - dark corridor остается темным;
  - flashlight cone светлее side/back samples;
  - high mode не ломает p95/max frame time.

Проверки будущей реализации:

```bash
npm run check
npm run check:browser
SMOKE_LIGHTING_MODE=off npm run smoke
SMOKE_LIGHTING_MODE=high SMOKE_PERF_FRAMES=300 npm run smoke
SMOKE_MOBILE=1 SMOKE_LIGHTING_MODE=low npm run smoke
SMOKE_STRESS=1 SMOKE_LIGHTING_MODE=low SMOKE_PERF_FRAMES=300 npm run smoke
SMOKE_VISUAL_GEOMETRY_MODE=high SMOKE_LIGHTING_MODE=high SMOKE_PERF_FRAMES=300 npm run smoke
```

Важно: headless smoke может идти через browser/software GPU path. Он ловит
совместимость, пустой canvas и грубые perf-регрессии, но финальный свет нужно
смотреть вручную в Chrome/Android на настоящей GPU.

## Риски

- Слишком темная картинка сломает читаемость боя.
- Bloom может превратиться в мыло, если смешивать весь bright image без порога.
- Full secondary rays быстро съедят бюджет raycaster.
- Render-only свет нельзя использовать как gameplay stealth/light truth.
- Sprite lighting может сделать врагов невидимыми, если не оставить минимальный
  silhouette floor.
- Darkness/void route floors требуют ручной проверки: там ambient и bloom не
  должны отменять авторскую темноту.

## Итоговая Рекомендация

Идти так:

1. Сначала `P0 Shader Material Lighting Pack`.
2. Потом `P1 Screen-Space Emissive/Bloom`.
3. Потом `P2 Sprite Lighting`.
4. Потом `P3 Mesh Light Consistency`.
5. Только после этого пробовать `P4 Capped Shader Ray Probes` как high/experimental.

Это даст самый большой визуальный прирост за минимальный архитектурный риск:
почти вся новая стоимость будет на GPU, CPU останется на текущем baked
`world.light` и маленьких bounded uploads/uniforms, а gameplay truth не
переедет в renderer.


### P6: Voxel Ambient Occlusion (AO)

# Agent Task Plan: Shaders 1 - Voxel Ambient Occlusion (AO)

> **ВНИМАНИЕ АГЕНТУ (JULES / GEMINI 3.1 PRO):**
> Ты работаешь над интеграцией Voxel Ambient Occlusion (угловых теней) в DDA-рейкастер GIGAHRUSH.
> **КРИТИЧЕСКОЕ ОГРАНИЧЕНИЕ:** У нас бесконечные и бесплатные ресурсы GPU, но жесточайший bottleneck по CPU.
> ЗАПРЕЩЕНО добавлять любые новые вычисления, циклы, проходы массивов или проверки на стороне CPU (включая `src/core/world.ts`, `systems/`, `gen/`).
> ВСЯ нагрузка по вычислению Ambient Occlusion должна быть перенесена исключительно во фрагментный шейдер WebGL (`FRAG_SRC` в `src/render/webgl.ts`).
> 
> **КОНКУРЕНТНЫЙ ДОСТУП:** Параллельно с тобой еще 4 агента редактируют `src/render/webgl.ts` (Reflections, Normal Mapping, God Rays, Tonemapping).
> Твоя задача — сделать изменения максимально изолированно. Не переписывай весь шейдер. Добавляй свои функции как отдельные блоки `/* AO INJECTION */` и делай точечные вызовы.

## Цель
Добавить Screen-Space / Voxel Ambient Occlusion (угловые тени) в DDA-рейкастер для придания объема стыкам стен, дверным проемам и внутренним углам. Фича должна вычисляться **только на GPU** и только при `uLightQuality >= 3`.

## Контекст и Архитектура
`webgl.ts` — красный файл (integrator-owned). Рендер реализован через WebGL2 DDA рейкастинг в полноэкранном фрагментном шейдере (`FRAG_SRC`). 
AO в нашем воксельном/grid-based движке — это проверка соседних тайлов вокруг точки попадания луча (hit point) на наличие твердых стен.

Так как CPU трогать нельзя, GPU будет самостоятельно опрашивать текстуру карты `uCells` через `texelFetch` вокруг найденной точки попадания.

## План Реализации (Workflow)

### 1. Подготовка и Изучение
- Открой `src/render/webgl.ts` и изучи фрагментный шейдер `FRAG_SRC`. Обрати особое внимание на секции `── Wall ──` и вызовы `applyLightFX`.
- Найди, как читаются данные из карты: `texelFetch(uCells, ...)` и проверь типы клеток (0 - воздух, `Cell.WALL`, `Cell.DOOR` и т.д.).
- Убедись, что ты понимаешь, как интерполируются константы (например, `${Cell.ABYSS}u`) в строку шейдера. Никаких магических чисел.

### 2. Внедрение GLSL Функции AO (Только GPU)
Добавь функцию `computeVoxelAO` в секцию утилит фрагментного шейдера. Функция должна принимать координату клетки (`hitCell`), нормаль (`wN`) и карту (`cellMap`), а затем проверять две соседние клетки слева и справа относительно нормали, чтобы определить, есть ли там углы/затенение.

```glsl
/* --- AO INJECTION START --- */
float computeVoxelAO(ivec2 cell, vec2 normal, highp usampler2D cellMap) {
    // Вычисляем только на высоких настройках качества графики
    if (uLightQuality < 3) return 1.0;
    
    // Определяем перпендикуляр к нормали для проверки соседних блоков
    vec2 tangent = vec2(-normal.y, normal.x);
    ivec2 t1 = ivec2(tangent);
    ivec2 t2 = ivec2(-tangent);
    
    // Проверяем соседние блоки по диагонали внутрь угла
    // Смещение на -normal проверяет соседнюю клетку, а +t1/+t2 проверяет угловые
    ivec2 checkPos1 = cell - ivec2(normal) + t1;
    ivec2 checkPos2 = cell - ivec2(normal) + t2;
    
    uint c1 = texelFetch(cellMap, checkPos1, 0).r;
    uint c2 = texelFetch(cellMap, checkPos2, 0).r;
    
    float ao = 1.0;
    
    // Используем константы движка (интерполированные в строку)
    // Предположим ${Cell.WALL}u, ${Cell.DOOR}u, ${Cell.HERMETIC_DOOR}u
    bool isSolid1 = (c1 != 0u && c1 != ${Cell.ABYSS}u && c1 != ${Cell.WATER}u);
    bool isSolid2 = (c2 != 0u && c2 != ${Cell.ABYSS}u && c2 != ${Cell.WATER}u);
    
    if (isSolid1) ao -= 0.35;
    if (isSolid2) ao -= 0.35;
    
    return max(0.3, ao);
}
/* --- AO INJECTION END --- */
```
*(Обязательно проверь реальные типы клеток в `src/core/types.ts` и вставь правильные проверки)*

### 3. Применение AO к Стенам
Внутри главного цикла отрисовки стен (`if (hit) { ... }`), где вычисляется итоговый цвет и свет стены (`c = applyLightFX(...)`), добавь точечное применение AO.

```glsl
// Точечное внедрение AO для стен
float voxelAO = computeVoxelAO(hitCell, wN, uCells);
c *= voxelAO; // Применяем затенение к цвету
```

### 4. Применение AO к Полу (Опционально, Только GPU)
Для пола (`── Floor ──`) координаты клетки уже известны (`fCell`). Можно проверять соседние клетки крестом (N, S, E, W) на факт наличия стен. Если стена рядом, затемняем пиксель пола в зависимости от дистанции до края клетки.
Это тоже делается **исключительно внутри шейдера**.

```glsl
/* --- FLOOR AO INJECTION --- */
float computeFloorAO(ivec2 cell, vec2 worldPos, highp usampler2D cellMap) {
    if (uLightQuality < 3) return 1.0;
    
    vec2 localPos = fract(worldPos);
    float ao = 1.0;
    
    // Проверка 4 соседей
    uint nN = texelFetch(cellMap, cell + ivec2(0, -1), 0).r;
    uint nS = texelFetch(cellMap, cell + ivec2(0, 1), 0).r;
    uint nE = texelFetch(cellMap, cell + ivec2(1, 0), 0).r;
    uint nW = texelFetch(cellMap, cell + ivec2(-1, 0), 0).r;
    
    // Если сосед - стена, затемняем край
    if (nN != 0u && nN != ${Cell.ABYSS}u) { if (localPos.y < 0.2) ao -= (0.2 - localPos.y) * 2.0; }
    if (nS != 0u && nS != ${Cell.ABYSS}u) { if (localPos.y > 0.8) ao -= (localPos.y - 0.8) * 2.0; }
    if (nW != 0u && nW != ${Cell.ABYSS}u) { if (localPos.x < 0.2) ao -= (0.2 - localPos.x) * 2.0; }
    if (nE != 0u && nE != ${Cell.ABYSS}u) { if (localPos.x > 0.8) ao -= (localPos.x - 0.8) * 2.0; }
    
    return max(0.4, ao);
}
/* -------------------------- */
```

### 5. Архитектурные Ограничения и Валидация
- **CPU Bottleneck:** Запрещено вычислять AO-карты на CPU при загрузке или в реальном времени. Все вычисления - только через `texelFetch` в WebGL.
- **Ограничения Циклов:** Шейдер должен оставаться легким. Используй максимум 2-4 `texelFetch` на фрагмент для AO. Не используй циклы `for` для обхода 3x3 если можно обойтись хардкодом 4 выборок.
- **Сохраняй стиль кода** (отступы, именование).
- **Изолированность:** Делай патчи минимальными `String.replace` или аккуратным добавлением, чтобы не мешать другим агентам, работающим над этим же файлом.

### 6. Проверка и Билд (QA)
- Запусти `npm run check:readonly` чтобы убедиться, что типы не сломаны (хотя мы меняем только конкатенацию строк).
- Убедись, что шейдер компилируется. В WebGL опечатки в шейдерах не видны в TypeScript. Вызови `npm run smoke` и/или `npm run check:browser` (или проверь через dev-сервер визуально).
- Включи настройку графики "Экспериментальная" (или `SMOKE_LIGHTING_MODE=experimental npm run smoke`) чтобы сработал `uLightQuality >= 3`.

## Реализация Volumetric God Rays (shaders_4.md)

В фрагментный шейдер (`src/render/webgl.ts`) внедрены объемные лучи света от фонарика:
- Добавлена функция `computeVolumetricGodRays(rayDist, baseColor, rayDir)`, вычисляющая интенсивность "пыли" вдоль луча (псевдо-volumetric scattering).
- Функция опирается на вычисление скалярного произведения между текущим лучом зрения и направлением фонарика (совпадает с вектором обзора камеры).
- Эффект активен только при максимальном качестве освещения (`uLightQuality >= 3`).
- Вызов `computeVolumetricGodRays` вставлен в конце `main` перед `applyLightDust`, чтобы автоматически и бесшовно применяться к стенам, полу и потолку с использованием единого вычисленного расстояния (`pixelDepth * MAX_DIST`).
- Все вычисления перенесены на GPU, полностью избегая создания bottleneck-ов на CPU.
