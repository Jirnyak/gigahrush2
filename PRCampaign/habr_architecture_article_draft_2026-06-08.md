# Habr architecture article draft - 2026-06-08

Status: local draft only. Not submitted to Habr.

Context:

- Public profile checked: https://habr.com/ru/users/TENEVIK/
- Previous live article: https://habr.com/ru/articles/1043232/
- Comments page: https://habr.com/ru/articles/1043232/comments/
- This draft responds to the main useful feedback: fewer vague architecture claims, more concrete contracts, clearer raycasting/2.5D wording, A-Life materialization/foldback, no Three.js/ECS/assets rationale, and honest UI/readability caveats.
- I cannot read the private Habr editor draft or your internal Habr comments from the public profile. Merge this with those comments manually in the Habr editor.

Public-copy guardrail:

- This is an owner-requested technical Habr exception. The article can discuss the actual `1024x1024` toroidal grid because the topic is architecture.
- Do not reuse exact topology/dimension wording in store pages, portal listings or general public pitch copy. Keep those on `безграничная бетонная структура`.

## Recommended Habr Setup

- Type: `Статья`.
- Difficulty: `Сложный` if keeping all code/architecture sections; `Средний` if you remove the save/path/cache details.
- Format: `Кейс` or `Ретроспектива`. `Кейс` is slightly better for this version.
- Hubs: `Разработка игр`, `TypeScript`, `WebGL`, `JavaScript`, `Canvas`.
- Keywords: `gamedev, webgl, typescript, raycasting, browser game, procedural generation, a-life, data-oriented, самосбор, gigahrush`.
- Feed cover: upload a `780x440` jpg/png on the second Habr editor screen. Use a readable in-game screenshot, not a logo and not a gif cover.
- Lead text for the feed: `Техническое продолжение первой статьи: как ГИГАХРУЩ устроен под капотом - клеточный тороидальный мир, typed arrays, WebGL raycasting, A-Life, самосбор как мутация мира и почему zero-runtime browser build оказался не позой, а архитектурным ограничением.`

## How To Add Images On Habr

Use Habr's WYSIWYG editor unless you deliberately switch to markdown mode before writing.

1. Cover image:
   - Click `Готово к публикации`.
   - On the second editor screen find `Отображение публикации в ленте`.
   - Upload the cover image there.
   - Recommended size from Habr docs: `780x440`.

2. In-article screenshots:
   - Put the cursor where the placeholder says `MEDIA TODO`.
   - Press `/` or click the `+` button at the left side of the editor.
   - Choose `Изображение`.
   - Upload from your device.
   - Add caption in the image settings.
   - Use `Предпросмотр` before publishing.

3. If using markdown mode:
   - Upload images through the editor or use a stable image URL.
   - Insert as `![alt](image-url "title")`.
   - For very large screenshots, add a caption with a link to the full-size version.

Official Habr references used for this checklist:

- WYSIWYG editor: https://habr.com/ru/docs/help/wysiwyg/
- Habr Flavored Markdown: https://habr.com/ru/docs/help/markdown/
- Publication design advice: https://habr.com/ru/docs/authors/design/
- Article/post setup fields: https://habr.com/ru/docs/authors/post/

## Image Plan

Do not paste these `MEDIA TODO` lines into the final public article unless you want them visible. They are placement instructions for you.

1. Feed cover:
   - What to make: high-contrast first-person corridor or samosbor aftermath screenshot, readable at small size.
   - Caption is not needed for feed cover.
   - Avoid: pure logo, unreadable dark blur, GIF cover.

2. After intro:
   - What to make: architecture diagram, simple enough for Habr preview.
   - Content: `core/data/gen/systems/render` layers over one `World`.
   - Caption: `Общий контракт: генераторы строят World, системы меняют состояние, рендер только читает.`

3. In `Мир как несколько полей над одной решеткой`:
   - What to make: visual stack diagram or contact sheet with map/minimap plus colored overlays.
   - Show: cells, rooms, doors, features, fog/territory as layers.
   - Caption: `Один индекс клетки связывает геометрию, комнаты, признаки, туман, территорию и рендер.`

4. In `Raycasting и почему это не спор о честности 3D`:
   - What to make: split image. Left: in-game corridor screenshot. Right: simple ray/DDA grid diagram.
   - Caption: `Геометрия остается клеточной, WebGL строит 2.5D-проекцию специализированным raycasting pass.`

5. In `A-Life`:
   - What to make: NPC profile / Demos / social or dialogue screenshot, preferably with readable enlarged UI.
   - Caption: `A-Life хранит identity и последствия, а не просто рендерит NPC рядом с игроком.`

6. In `САМОСБОР`:
   - What to make: before/after pair or short GIF. If GIF is heavy, use two screenshots.
   - Caption: `САМОСБОР важен не как фильтр на экране, а как изменение состояния места.`

7. Near conclusion:
   - What to make: MESH PASS screenshot/diagram with seeded radius/cell-index scheme and small Windows Pipes reference.
   - Caption: `MESH PASS добавляет объемные трубы и детали вокруг игрока, не превращая World в 3D-сцену.`

## Title Candidates

1. `Как устроен ГИГАХРУЩ: клеточный мир, WebGL-рейкастер и A-Life без движка`
2. `ГИГАХРУЩ под бетоном: World, typed arrays, raycasting, A-Life и САМОСБОР`
3. `Браузерный survival horror без движка: архитектура ГИГАХРУЩА изнутри`

Recommended:

`Как устроен ГИГАХРУЩ: клеточный мир, WebGL-рейкастер и A-Life без движка`

## Article Body

В прошлой статье про ГИГАХРУЩ мы показали игру как живой weird-проект: браузерный survival horror / ARPG без движка, ассетов и спокойной жизни.

С тех пор проект уже стал заметен в локальном инди-комьюнити: в него играют, о нем спорят, его архитектурные решения стали отдельной темой. Поэтому этот текст не питч и не просьба оценить демку. Это инженерный разбор проекта, который уже обрастает сообществом: где данные, где системы, где рендер, что хранится постоянно, что материализуется, почему мы не берем готовую mesh-сцену и как все это держится в браузере.

Разберем, как ГИГАХРУЩ устроен под бетоном: один активный клеточный этаж, typed arrays, плоские сущности, WebGL raycasting, A-Life, самосбор как мутация мира, сохранение, ограничения и MESH PASS как render-only объем поверх клеточной симуляции.

MEDIA TODO: вставить архитектурную схему слоев. Подпись: `Общий контракт: генераторы строят World, системы меняют состояние, рендер только читает.`

### Ограничение, из которого выросла архитектура

ГИГАХРУЩ - браузерная survival-horror / ARPG игра на TypeScript/Vite. Цель - один запускаемый браузерный билд без runtime-фреймворков, без импортированного ассетного пайплайна и без внешнего движка.

Это не религиозная позиция "движки плохие". Unity, Godot, Phaser, Three.js и готовые ECS решают нормальные задачи. Но в этом проекте базовая ставка другая:

- мир должен быть процедурным и перестраиваемым;
- рендер должен читать игровое состояние, а не владеть им;
- контент должен добавляться модулями, не залезая в главный цикл;
- NPC и монстры должны жить на общей поверхности, а не появляться как декорации вокруг камеры;
- локальный single-file build должен работать даже без сети и облачного контура;
- любые дорогие системы должны иметь понятный cap, cache, cadence или dirty flag.

Из этого получилось не "сделали свой Unity на коленке", а более узкая вещь: кастомная игра-движок под конкретную форму мира.

### Пять слоев вместо большой сцены

Внутри проект держится на очень скучном контракте:

```txt
core     - примитивные типы, World, константы
data     - определения предметов, оружия, фракций, квестов, монстров
gen      - генерация этажей, комнат, POI, начального размещения
systems  - AI, бой, A-Life, самосбор, экономика, сохранение, интеракции
render   - WebGL/canvas, HUD, карта, спрайты, текстуры
```

Самое важное здесь - направление зависимости. `render` не решает геймплей. `data` не мутирует мир. `gen` строит начальное состояние. `systems` меняют состояние в runtime. `main.ts` не должен знать, что появился особый монстр, особый этаж или особый терминал.

Это звучит банально, но для проекта, который постоянно просит "добавь еще один странный этаж", это вопрос выживания. Каждый новый контентный пакет хочет стать исключением. Если дать ему право на отдельный tick, отдельный input path, отдельный render branch и отдельную save shape, игра быстро превратится в свалку.

Поэтому новая странность должна отвечать на простой вопрос: "Как она ложится в существующий World, регистр, событие, интеракцию или генератор?"

### Мир как несколько полей над одной решеткой

Один активный этаж ГИГАХРУЩА - это клеточная поверхность `1024x1024`. Координаты заворачиваются по обеим осям, то есть локально это обычная grid-карта, но глобально у нее нет края. Технически это тороидальная решетка.

В коде это очень приземленная вещь:

```ts
wrap(v) = ((v % W) + W) % W
idx(x, y) = wrap(y) * W + wrap(x)
```

Одна клетка имеет один линейный индекс. Дальше над этим индексом лежат разные поля:

```ts
cells[i]          // стена, пол, дверь, вода, лифт
roomMap[i]        // id комнаты или -1
wallTex[i]        // текстура стены
floorTex[i]       // текстура пола
features[i]       // лампа, кровать, стол, экран, туалет
light[i]          // свет
fog[i]            // туман
zoneMap[i]        // макрозона
factionControl[i] // контроль фракции над клеткой
```

Плотные данные живут в typed arrays. Редкие данные живут в обычных структурах:

```ts
rooms: Room[]
doors: Map<cellIndex, Door>
containers: WorldContainer[]
surfaceMap: Map<cellIndex, Uint8Array>
entities: Entity[]
```

Это и есть ключевая разница между "уровнем как сценой" и "уровнем как состоянием". Стена - не объект с transform в сцене. Стена - значение в `cells` плюс id текстуры. Дверь - клетка и запись в `doors`. Комната - область клеток и affordance для систем. Фракционная территория - поле контроля. Туман - еще одно поле.

MEDIA TODO: вставить слойную схему world-fields или screenshot/map overlay. Подпись: `Один индекс клетки связывает геометрию, комнаты, признаки, туман, территорию и рендер.`

Такой подход дает неприятно много дисциплины, но дает и свободу. Если самосбор перестроил коридор, он меняет клетки и версии мира. Если фракция заняла участок, она меняет поле контроля. Если генератор поставил раковину, он ставит feature, а интеракционный слой уже знает, что с ней делать. Если рендеру нужно нарисовать стену, он читает те же данные, по которым AI понимает проходимость.

Одна поверхность. Несколько смысловых слоев.

### Почему тор, а не карта с краями

Тор звучит как попытка добавить умной математики, но практическая причина простая: в ГИГАХРУЩЕ не нужен край карты как игровое понятие.

У обычного прямоугольника есть периметр. Этот периметр надо закрывать стенами, объяснять лором или прятать. У тороидальной решетки край становится соседней клеткой:

```ts
west  = y * W + (x === 0 ? W - 1 : x - 1)
east  = y * W + (x === W - 1 ? 0 : x + 1)
north = (y === 0 ? W - 1 : y - 1) * W + x
south = (y === W - 1 ? 0 : y + 1) * W + x
```

Все, что ходит по соседям, автоматически ходит по тору: генерация, flood fill, reachability audit, pathfinding, spread эффектов, расстояния, локальные волны.

Это хорошо совпадает с сеттингом. ГИГАХРУЩ не обязан быть зданием, которое можно увидеть снаружи. Игрок видит комнату, дверь, коридор, соседей, лифт и последствия. Глобальная форма намеренно не помещается в голову.

Минус тоже прямой: координатная математика должна быть дисциплинированной. Обычный `x + dx` там, где нужен `world.wrap`, превращается в ошибку на дальнем краю мира. Поэтому базовые операции вынесены в методы вроде `idx`, `wrap`, `delta`, `dist`, `dist2`.

### Raycasting и почему это не спор о честности 3D

В прошлой статье была неудачная формулировка про "честное 3D". В комментариях правильно заметили: raycasting сам по себе не является "нечестным". Это нормальный способ получить изображение из данных.

Более точная формулировка такая: ГИГАХРУЩ не хранит мир как обычную mesh-сцену с объектами, материалами, трансформами, камерой и импортированными моделями. Симуляция остается двумерной клеточной поверхностью, а WebGL-рендер строит 2.5D-проекцию из этой поверхности.

Условно:

```glsl
for each screen column:
  build ray from camera
  step through grid cells with DDA
  if wall or closed door:
    sample wall texture
    draw column

for floor rows:
  project screen row back onto grid
  sample floor texture / fog / lighting
```

NPC, монстры, предметы и часть декора рисуются как спрайты в той же системе координат. Да, это билборды. Но важная граница не в термине. Важная граница в том, что рендер не владеет геймплеем. Он читает `World` и `entities`.

MEDIA TODO: вставить split-image с коридором и DDA/ray diagram. Подпись: `Геометрия остается клеточной, WebGL строит 2.5D-проекцию специализированным raycasting pass.`

Почему не Three.js? Потому что Three.js был бы удобен для другой центральной модели: сцены из мешей, материалов, камер и ассетов. В ГИГАХРУЩЕ центральная модель - клеточная поверхность с полями. Универсальный 3D-слой пришлось бы постоянно подстраивать под data textures, procedural surfaces, sprites, canvas HUD и runtime-перестройку клеток.

Голый WebGL здесь не потому, что "так хардкорнее". Он дает короткий путь от игровых данных до пикселя. Это узкий специализированный renderer, а не универсальный renderer для всего.

### Почему не готовая ECS

Сущности в игре тоже устроены без классовой иерархии:

```ts
Entity[] entities
```

Entity - обычный объект с типом и опциональными полями. NPC имеет faction, needs, inventory, AI, relation, persistent id. Монстр имеет kind, tactic, hp, target memory. Предмет имеет item payload. Projectile имеет owner, velocity, damage.

Это не академическая ECS. Скорее минимальный слой, достаточный для конкретной игры. Плотные мировые данные уже лежат в typed arrays. Актеры и редкие объекты остаются плоскими объектами, потому что для них важнее читаемая интеграция, чем универсальная компонентная инфраструктура.

Чтобы локальные запросы не превращались в полный проход по `entities`, есть spatial index с bucket-запросами:

```ts
queryRadiusCapped(x, y, radius, out, mask, cap)
```

AI, бой, интеракции и монстры могут спрашивать "кто рядом" через bounded radius query, а не каждый раз перебирать весь массив. Здесь снова видно главное правило: рост должен быть ограничен cap, radius, cache или cadence.

Готовая ECS, возможно, помогла бы с дисциплиной. Но она не решила бы главную проблему проекта: как связать тороидальную grid-поверхность, генерацию, A-Life, самосбор, save/floor memory и WebGL raycasting в один контракт. В этом месте простые структуры оказались важнее универсальной архитектурной красоты.

### Активный этаж и изотропия AI

В ГИГАХРУЩЕ игрок не является центром симуляционной правды. На активном этаже нет spawn bubble, где NPC существуют только рядом с камерой. Live AI actors проходят общий update pass независимо от того, видит их игрок или нет.

Это не значит, что каждый актер каждый кадр делает дорогую работу. Дорогие решения ограничиваются:

- spatial index запросами;
- cached path fields;
- actor-local cooldowns;
- bounded scans;
- dirty versions мира;
- soft caps активного floor-object/actor слоя.

Псевдологика выглядит примерно так:

```ts
rebuildEntityIndexForFrame()

for actor in entityIndex.ai:
  if actor is current player body:
    continue
  if actor is NPC:
    updateNpcTactic()
    updateFactionCombat()
    updateRoutineOrFlee()
  if actor is monster:
    updateMonsterTactic()
```

Важное слово здесь - изотропия. Текущий этаж должен быть одинаково настоящим во всех направлениях. Игрок может не видеть драку в другом коридоре, но если акторы материализованы на активном этаже, их состояние не должно зависеть от того, близко ли камера.

Это дорогая идея, поэтому она держится только на ограничениях. Если очередная система начинает каждый кадр сканировать весь мир, она ломает архитектуру. Если система берет "первые 96 комнат" просто потому, что они первые в массиве, она превращает порядок хранения в физику мира. Такие вещи в проекте считаются ошибкой, а не оптимизацией.

### Pathfinding как поле, а не личный BFS каждого жильца

Клеточный мир легко убить pathfinding-ом. Если каждый NPC под каждое желание строит свой BFS, браузер не простит.

Поэтому путь строится через общий навигационный слой. Геометрия активного мира получает version. Если `cellVersion` изменился, path caches больше не авторитетны. Для типовых желаний можно строить flow fields: "к кухне", "к туалету", "к убежищу", "к рабочей комнате".

Условно:

```ts
if world.cellVersion changed:
  rebuildNavigationTree()

field = getOrBuildFlowField("shelter", sourceProvider)
actorNextCell = field.next[currentCell]
```

Это не делает AI умным само по себе. Это делает его дешевым и совместимым с миром, который может меняться. Самосбор зашил проход - версия выросла - старый путь инвалидирован - следующий path layer строится уже по новой геометрии.

### A-Life: не "NPC просто не рендерятся"

Самая важная вещь, которую стоило лучше объяснить в первой статье: A-Life не означает "все NPC существуют только когда рендерятся" и не означает "сто тысяч жителей честно симулируются каждый кадр".

Между этими крайностями есть слой persistent identity.

На старте run создается компактный пул процедурных жителей. Техническая емкость сейчас привязана к typed-array storage, а целевая population baseline - порядка сотни тысяч identity-записей. Каждая запись хранит не "полный объект NPC со всеми runtime-полями", а компактные факты: floor key, фракция, occupation, возраст, пол, уровень, HP, деньги, relation to player, karma, reserved identity, смерть и sparse overrides для важных изменений.

Когда этаж становится активным, генератор сначала создает геометрию и placement slots. Затем A-Life материализует часть записей этого floor key в live entities.

```ts
templates = extractAmbientNpcTemplates(entities)
records = alifeRecordsForCurrentFloor()

for template in templates:
  record = nextAliveRecord(records)
  entity = materialize(record, template)
  entities.push(entity)
```

Когда игрок уходит с этажа, когда этаж пересобирается или когда сохраняется игра, live state складывается обратно: смерть, HP, позиция, отношение, деньги, часть инвентаря, важные последствия.

```ts
for entity in materializedNpcEntities:
  foldBack(entity.alifeId, entity)
```

Главное правило: обычный NPC не восполняется бесконечным refill-spawner-ом. Умерший человек не заменяется "таким же новым". Plot/authored/event actors имеют свои причины появления. Караван, самосбор, фракционное событие или quest могут привести новых людей, но это должно быть событием, а не стиранием последствий.

MEDIA TODO: вставить NPC/Demos/social screenshot. Подпись: `A-Life хранит identity и последствия, а не просто рендерит NPC рядом с игроком.`

Это компромисс. Мы не симулируем все этажи покадрово. Off-floor NPC заморожены, кроме bounded aggregate events, migrations, caravans, faction/economy/quest facts. Но мы и не делаем театр одного игрока, где все вокруг появляется только для камеры.

### Вертикаль: маршрут поверх отдельных поверхностей

ГИГАХРУЩ не является полноценной 3D-симуляцией здания. Активен один этаж. Но run имеет вертикальный маршрут: base floors, authored design floors, procedural stops, numbered lift anomalies и keyed floor identities.

Каждый route stop - маленький мир со своим generator/package, population field, danger, monster pressure, POI и памятью посещения. Лифт переводит игрока между keyed identities, а floor memory сохраняет состояние уже посещенных мест в пределах бюджета.

Концептуально это можно представить как стопку связанных тороидальных поверхностей. Но технически важнее другое: вертикаль не превращает проект в mesh-небоскреб. Это route graph поверх отдельных world snapshots.

Так проще сохранять, пересобирать, мутировать и тестировать этажи. У каждого этажа есть локальная геометрия и локальная правда. Off-floor слой не обязан pathfind-ить, воевать и считать нужды каждую секунду.

### САМОСБОР как runtime-переписывание мира

Самосбор можно было бы сделать экранным эффектом: сирена, красный фильтр, урон, пара монстров. Но тогда это был бы погодный event.

В текущей архитектуре самосбор - локальная мутация состояния мира. Он предупреждает, включает pressure, проверяет укрытия, может герметизировать, ломать, перестраивать, заражать, менять fog/features/textures/cells, публиковать события и оставлять aftermath.

Условный runtime-проход:

```ts
choose local mutable area
run bounded wave
for affected cell:
  rewrite cell / texture / feature / fog
  collect dirty rect
mark versions dirty
invalidate path/render caches by version
publish aftermath events
fold floor state into memory/save
```

MEDIA TODO: вставить before/after или GIF самосбора. Подпись: `САМОСБОР важен не как фильтр на экране, а как изменение состояния места.`

Клеточная модель здесь помогает. Полигональную сцену тоже можно перестраивать, но там цена другая: меши, navmesh, коллизии, материалы, object graph. Здесь локальная мутация часто сводится к изменению массивов и последующему честному invalidation кэшей.

Для игрока это должно ощущаться не как "на меня наложили эффект", а как "место изменилось". Был проход - стала проблема. Была дверь - стала граница. Была безопасная комната - стала спорная. Был NPC - теперь его смерть или исчезновение остались фактом.

### Save/load: текущая форма, без культа legacy

Сохранение живет в `localStorage`. Это браузерная игра, поэтому save payload должен быть компактным и устойчивым к поврежденным данным.

Проект в активной разработке, поэтому старые shape-версии не являются продуктовым контрактом. Если save shape меняется несовместимо, версия формы повышается, старые сохранения отклоняются явно. Это неприятно, но честнее, чем тянуть миграционный слой для каждого экспериментального месяца разработки.

Что сохраняется:

- seed/run/floor route facts;
- player state;
- inventory/needs/progression;
- floor memory snapshots в пределах бюджета;
- A-Life deaths/overrides;
- quest/economy/faction/event facts;
- sparse изменения, а не полный объектный граф мира.

Здесь тоже работает общий принцип: сохранять ids, seeds, compact facts и sparse overrides, а не огромную сцену с объектами.

### Procedural content как расширение контракта

Процедурный этаж в ГИГАХРУЩЕ не должен быть отдельной мини-игрой. Он должен построить общий `World`.

Базовый контракт генератора:

- построить cells;
- назначить roomMap;
- создать Rooms;
- поставить doors;
- защитить нужные области;
- проверить reachability;
- расставить features, containers, loot, NPC templates, monsters;
- зарегистрировать enough metadata для quests/debug/map/events;
- не залезть в main loop ради своего особого случая.

Это позволяет делать очень разные поверхности через один контракт: бытовые этажи, технические коллекторы, мясные нижние области, authored design floors, процедурные аномалии, клеточные автоматы, экранные/медийные структуры, лабиринты, зараженные зоны.

Все, что можно выразить как изменение клеток, признаков, текстур, событий и entity placement, может стать этажом без отдельного движка.

### MESH PASS: объемный водопровод поверх клеточного мира

Отдельная красивая часть архитектуры - render-only MESH PASS.

Мы хотели сохранить главное свойство проекта: симуляция остается клеточной, а рендер только читает состояние. Но прямоугольные 2D-коридоры не обязаны выглядеть плоскими. Поверх raycasting-картинки можно добавить локальный объем: трубы, панели, потолочные связки, пороги, технические короба, коллекторные желоба, мясные складки или пещерные выступы.

Визуально идея частично вдохновлена старым Windows Pipes / "водопроводным" screensaver-ом: сеть труб появляется процедурно, кажется бесконечной и не требует ручной сцены. Мы взяли оттуда не ассеты и не алгоритм один-в-один, а ощущение процедурной инженерной обвязки. Дальше это легло в нашу модель мира.

MESH PASS вставлен в render pipeline после raycaster/depth pass и перед billboard sprites:

```text
raycaster -> mesh pass -> sprites -> particles -> HUD
```

Он получает read-only контекст:

```text
World + camera + floorKey + seed + visual profile
```

Дальше все строится локально вокруг камеры. В зависимости от настройки `3D детализация` профиль задает радиус и cap:

```text
low    radius 4 cells   cap 128
medium radius 8 cells   cap 256
high   radius 16 cells  cap 512
```

Для каждой подходящей клетки рядом с игроком pass берет `seed`, номер клетки, room id, covering profile и несколько hash-gates. Поэтому одна и та же клетка при том же seed дает тот же набор деталей. Камера сдвинулась - локальное окно пересобралось, но мир не "перетасовывается" случайно.

MEDIA TODO: вставить `PRCampaign/habr_mesh_pass_seeded_radius_2026-06-08.png`. Подпись: `MESH PASS добавляет объемные трубы и детали вокруг игрока, не превращая World в 3D-сцену.`

Это важная граница: mesh pass не является 3D-симуляцией. Труба может выглядеть объемной, но она не становится collision. Она не меняет `World.cells`, не попадает в save, не влияет на pathfinding, не создает quest state и не ломает floor memory. Если нужен физический объект, он должен появиться в gameplay-слое отдельно. MESH PASS отвечает за картинку.

Мне нравится эта система именно потому, что она не спорит с основой проекта. Она не тащит мир в mesh-сцену, а аккуратно надевает на клеточный World процедурную инженерную оболочку.

### Что получилось в итоге

Если коротко, ГИГАХРУЩ держится на нескольких решениях:

- один активный toroidal `World` как плотная клеточная поверхность;
- typed arrays для плотных полей и sparse maps для редких фактов;
- генераторы строят состояние, systems его меняют, render его читает;
- WebGL raycasting строит специализированную 2.5D-картинку из grid-данных;
- entities остаются плоскими объектами, а не классами сцены;
- active-floor AI старается быть изотропным, без spawn bubble вокруг игрока;
- A-Life хранит persistent identities и folding consequences, а не full realtime hidden simulation;
- самосбор мутирует мир, а не только экран;
- MESH PASS добавляет процедурный объем вокруг камеры без изменения gameplay truth;
- save хранит compact facts, а не объектную сцену;
- storage order не должен становиться физикой мира.

Это не универсальный движок. И это нормально. Универсальный движок обязан быть удобным для разных игр. ГИГАХРУЩ обязан быть удобным для ГИГАХРУЩА: безграничной бетонной структуры, где локально все бытовое, а глобально форма не помещается в голову.

### Где проект сейчас

ГИГАХРУЩ уже вышел из состояния "маленькая странная демка в стол". Он живет как локально известный инди-проект: с playable browser build, публичными обсуждениями, обновлениями, самосбором, A-Life, демосоциальным слоем, WebGL-рендером и растущим набором архитектурных решений.

Эта статья фиксирует не обещание, а текущую инженерную форму проекта. Мы не пытаемся универсализировать ее до "правильного движка для всех". Наоборот: ценность именно в том, что архитектура заточена под конкретную игру и конкретную фантазию - безграничную бетонную структуру, где мир остается клеточным, но ведет себя как место с памятью, последствиями и локальной жизнью.

Игра запускается в браузере:

https://myindie.ru/games/game/gigahrush

Direct build:

https://gigahrush.bileter.workers.dev

Telegram для обновлений:

https://t.me/gigah_rush

ГИГАХРУЩ строится как цельная машина: клеточная поверхность, поля, raycasting, A-Life, самосбор, MESH PASS и мир, который не становится реальнее только потому, что игрок на него смотрит.
