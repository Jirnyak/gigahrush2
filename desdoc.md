# GIGAHRUSH Design Doc: Current Planning Snapshot

> Центральный документ дизайна.
>
> Роль: описывает жанровую цель, атмосферу, survival loop, самосбор, ГИГАХРУЩ как процедурный roguelike ARPG survival-horror shooter with world simulation, and next design priorities. Shipped facts live in `README.md`; этот документ отвечает за направление и вкус итераций.

Версия: 4.9
Дата: 2026-05-24
Статус: planning/design snapshot after route persistence pass and first public UX feedback pass; не authoritative факт-карта билда
Жанровая цель: **S.T.A.L.K.E.R.-like survival ARPG sim shooter в самосборной мегаструктуре**

`README.md` фиксирует факт текущего билда. Старый root `plans.md` архивирован в `../gatbage/`; активные системные контракты вынесены в `ai.md`, `alife.md`, `floors.md`, `anomalies.md`, `fight.md`, `economics.md`, `balance.md`, `items.md`, `monsters.md`, `quests.md`, `architecture.md`, `optimization.md`, `tests.md` и `problems.md`. Этот документ отвечает на другой вопрос: **что делать дальше в первую очередь, чтобы игра стала сильнее именно как survival ARPG sim shooter, а не просто больше по объему**. Фактические счетчики в секции 1 сверены через `scripts/content-audit.mjs`, runtime import-счеты production manifests и текущую структуру `src/`; остальные секции остаются planning/backlog, а не описанием гарантированно shipped behavior. В версии 4.6 `npm run content:audit` проходит без Errors и без unimported modules.

Исторические агентские prompts/status/logs и batch-файлы остаются во внешнем appendix `../gatbage/history/root_notes/appendix.md`; исходники, старые root-планы и reference-пакеты сохранены в `../gatbage/` вне репозитория. `../gatbage/reference/scenario_writers/` открывается только для конкретных text-pass задач: это пакет тона, NPC voices, barks, rumors, notes и quest copy, а не default intake. Этот документ и `README.md` должны получать только сжатые важные выводы, а не новые папки логов.

`../gatbage/reference/ux_rework/` - внешний reference-пакет осторожных rework-брифов по первому публичному фидбеку. Его открывают только для UX rework задач; задача пакета не "упростить игру" и не вырезать системы, а снизить первое отторжение от громоздкости: сделать первый экран, первую цель, первый NPC, бой, сообщения и опасности читаемыми без поломки уже работающего функционала.

## 0. Проектная Библия

Это не новая фича и не маркетинговый лозунг, а основной контракт проекта:

- **Текущий этаж - честная симуляционная поверхность.** Загруженный 1024x1024 тороидальный `World` живет как единое поле: материализованные NPC, монстры, projectiles, комнаты, контейнеры, фракции, события, route cues и самосбор работают в одном `entities`/`World`, а не появляются вокруг игрока. Дальние актеры могут тикать по deterministic cadence, но не выключаются из симуляции текущего этажа.
- **Игрок - управляемая entity.** `EntityType.PLAYER` находится в той же плоской entity-модели. Input, camera, HUD и save ownership неизбежно player-specific, но бой, урон, нужды, фракционная враждебность, A-Life karma/rank, события, тороидальная геометрия и самосбор должны оставаться entity-oriented. Если механика может работать для любого актера, она не должна становиться player-only.
- **Вертикаль - персистентный маршрут.** Run начинается на `LIVING`/`z=0`; обычные лифты ведут по `z=-50..+50`; story anchors, design floors, procedural stops и numbered lift instances имеют stable floor keys. Каждый stop должен ощущаться маленьким миром со своим generator/package, population field, NPC/faction mix, monster pressure, POI, локальными правилами и причиной туда ехать.
- **Макро-жизнь не равна полной realtime-симуляции невидимых этажей.** A-Life держит фиксированные `100_000` procedural NPC identities на каждом поддерживаемом runtime; off-floor NPC сохраняют identity, floor assignment, death/override facts и должны меняться только через bounded events, explicit migration, caravans, quests, resettlement или economy/faction consequences. Они не pathfind, не дерутся и не тикают needs вне активного этажа.
- **Давление растет от центра как системный bias, не как один hardcoded график.** `abs(z)` прямо влияет на samosbor duration/cooldown и route pressure; procedural danger также учитывает direction/profile, geometry, anomaly и seed; authored design floors могут вручную нарушать монотонность ради роли этажа. Поэтому `roof z=+50` может быть менее боевым, чем более близкий `registry_morgue`, если его роль - воздух/антенны/видимость.
- **Самосбор меняет мир локально и персистентно.** Это не reset и не player-centered fog patch: случайная mutable точка на текущей карте запускает warning/active/shelter/variant effects/local rebuild/aftermath, а stitched result становится новым состоянием этого floor key.

Текущие расхождения с полной версией этой Библии нужно держать видимыми: save/load сохраняет максимум `65_536` dead A-Life ids; caravan/economy macro уже двигает ресурсы и события между этажами, но пока не мигрирует persistent NPC records между `floorKey`; generated contracts еще могут привязываться к live/synthetic giver ids вместо stable `persistentNpcId`; отдельного slow off-floor A-Life batch для family/friend/rank/migration consequences еще нет.

## 0.1 UX-фидбек 2026-05-24: Осторожный Rework

Свежий фидбек с публичного треда указывает не на нехватку систем, а на входной перегруз:

- игроки не сразу понимают цель;
- интерфейс может восприниматься как громоздкий или конфликтующий сам с собой;
- поток сообщений и NPC-реплик легко превращается в шум;
- первый диалог и первый бой должны яснее объяснять действие;
- атмосферу ломает не отсутствие контента, а неудачная подача важного среди второстепенного.

Дизайн-вывод: следующая UX-итерация должна быть **консервативной**. Разрешены только правки, которые с высокой уверенностью улучшают первый опыт и не ломают существующую игру.

Приоритетные безопасные направления:

1. **Показывать одну текущую цель.** Первый экран должен вести к Ольге, затем к сержанту Баринову, обратно к Ольге и к Якову. Это уже существующая сюжетная дорожка; нужно сделать ее видимой, а не писать новый туториал.
2. **Дать новичковый HUD-пресет.** Не пустой экран и не весь cockpit сразу: витальные бары, взаимодействие, текущая цель, критические сообщения, базовый прицел/оружейный feedback и опасности.
3. **Не прятать критическое.** Урон, смерть, активный самосбор, опасные предупреждения и первый `E`-prompt не должны исчезать из-за косметического минимализма.
4. **Сделать модальные окна тихими.** Инвентарь, лог, настройки и диалоги должны гасить обычный HUD; поверх остаются только реально критические предупреждения.
5. **Уменьшить шум сообщений.** HUD получает survival/action/consequence, журнал получает локально услышанные реплики с дистанцией, разговоры и слухи держат атмосферу.
6. **Сохранить карту.** Карта/миникарта в целом считаются рабочими. Не делать крупный rework карты, не плодить режимы карты, не менять цвета/слои/философию маркеров без доказанного маленького бага. Первую цель лучше объяснять отдельным objective/route/lift языком.
7. **Объяснить браузерный бой.** Title/первый prompt должны прямо сказать про click-to-capture мыши, ЛКМ/Space, fullscreen и экран клавиш. FOV не дергать первым: ощущение может идти от canvas/stretch, а не от игровой камеры.

Запрещено в этой волне:

- удалять существующие системы ради "простоты";
- ломать advanced UI/карту/логи/фракции/экономику для новичкового экрана;
- делать большие renderer/map/input rewrites без измеримого дефекта;
- переносить gameplay decisions в render;
- добавлять еще текстового шума вместо маршрута и приоритизации;
- коммитить `dist/`/`itch/` как часть UX-правок.

Definition of Done для UX-волны:

- свежий игрок видит, что делать сейчас;
- первый NPC не выглядит как неработающий диалог;
- экран не перегружен, но критические сигналы не скрыты;
- существующая карта и продвинутые меню доступны как раньше;
- `npm run check:readonly` проходит, а для HUD/input/mobile/render правок проходит browser gate или явно записан блокер.

## 1. Текущая Точка Опоры

Код уже не прототип:

- 6 `FloorLevel`: `MINISTRY`, `KVARTIRY`, `LIVING`, `MAINTENANCE`, `HELL`, `VOID`.
- Старт на `LIVING`/`z=0`; обычный лифтовой маршрут идет по `z=-50..+50`, где `VOID` - нижний story anchor на `z=-50`, `darkness` - отдельный route stop на `z=-48`, а `roof` - верхний stop на `z=+50`.
- Масштаб `src/` и `tests/` проверяется из текущего дерева перед релизными или аудитными выводами; volatile счетчики не считаются shipped-фактом.
- `node:test` покрывает optional Cloudflare Net Sphere config/schema/API path, procedural anomaly/rail train/zombie paths получили focused tests.
- Optional Cloudflare Net Sphere уже в текущем билде: клиент `src/systems/net_sphere.ts`, canvas overlay `src/render/net_sphere_ui.ts`, Pages Functions `functions/api/net/`, D1 schema `cloudflare/d1/net_sphere.sql`, guarded setup/schema scripts `cf:setup` и `cf:schema`.
- Миникарта и `M`-карта больше не являются полной схемой этажа: `src/systems/map_exploration.ts` хранит UI-only fog-of-war по текущему `World`, старт раскрывает проходимую геометрию стартовой макро-зоны вместе с комнатами и коридорами, движение раскрывает локальную тропу, а route-cue/картографические знания могут раскрывать цели, зоны и участки. Вход в комнату сам по себе больше не раскрывает всю комнату; не-стены на границе открытого участка визуально затухают в неизвестность, а локальная самосборная волна снова закрывает перестроенный участок.
- 434 item ids.
- `PHYS_WEAPON_STATS`: 70 записей, включая пустой unarmed fallback и deletion-beam tier.
- `PSI_WEAPON_STATS`: 18 ПСИ-оружий.
- 67 standalone monster kinds, with ecology entries for each.
- 18 шагов основного сюжета.
- 336 runtime plot/side NPC ids после production manifests.
- 399 runtime side quest steps.
- 205 системных assignment templates.
- 17 ресурсов экономики, 12 описаний производств, 42 production recipes, контейнеры и production ticks.
- 577 статических слухов плюс слухи из событий.
- 7 вариантов самосбора, 19 модификаторов, 44 aftermath-последствия и 33 registered director beats.
- 8 номерных лифтовых инстансов.
- Вертикальный `FloorRun`: нормальный лифтовой span `z=-50..+50`, 47 authored/story stops, из них 6 story `FloorLevel` anchors и 41 design floor routes/generators, плюс 54 процедурных/fallback сидовых этажей без добавления новых `FloorLevel`.
- Посещенные route stops больше не пересоздаются обычным лифтом: `systems/floor_memory.ts` держит отдельный живой `World` и неплеерские сущности по каждому stable floor key, а packed floor-memory entries входят в save payload в пределах byte budget. Кровь, пули, двери, контейнеры, монстры и текущая локальная перестройка принадлежат конкретному этажу. Если snapshot вытеснен из memory/save budget, fallback остается генерацией из route seed/data.
- Manifest-imported content modules по аудиту: `living` 35, `ministry` 18, `kvartiry` 21, `maintenance` 54, `hell` 7, `void` 9.
- `npm run content:audit` проходит без Errors, не видит unimported content modules и подтверждает, что `samosbornyy_ostov` имеет player-facing zone title. Его статические счетчики: 336 plot NPC ids, 399 side quest steps и 135 literal contract entries. Это не заменяет playtest: аудит доказывает связность registry/data, но не доказывает читаемость маршрута игроком.

Значит, следующая итерация не должна начинаться с "добавим еще 20 этажей". Нужен проход, который превращает существующий объем в плотный stalker-like игровой цикл.

## 2. Игровое Обещание

Игрок - не избранный герой и не турист. Он вооруженный жилец-сталкер, который ходит в вылазки по живому дому:

- берет заказ или слух;
- готовит оружие, патроны, воду, бинты, документы;
- идет через фракционные зоны и опасные комнаты;
- стреляет, прячется, торгуется, ворует, ремонтирует, договаривается;
- переживает самосбор как локальный выброс;
- возвращается с лутом, долгом, ранением, новым врагом или новой репутацией.

Главное чувство: **каждая вылазка должна иметь цель, риск, цену, возвращение и след в симуляции**.

Чтобы игра стала культовой и народной (как *Dwarf Fortress* или *Space Station 13* в своих нишах), наша главная геймдизайн-цель — довести игру до состояния **"генератора историй"**. Культовыми становятся игры, о которых игроки рассказывают байки:
> *"Я спускался на 14-й этаж, началась сирена Самосбора, я заперся в пустой квартире, а там оказался сбрендивший ликвидтор без патронов, и мы вместе отбивались от слизи арматурами..."*

Как только A-Life, процедурные этажи и система событий (Samosbor hooks) начнут регулярно генерировать вот такие непредсказуемые ситуации, игроки сами начнут писать об этом посты на Reddit, снимать видео на YouTube и делать мемы. Именно это закрепляет проект в массовой культуре.

## 3. Приоритеты Жанра

Порядок важен.

1. **Первый экран важнее объема.** Существующая глубина должна открываться через ясную первую цель и читаемый HUD, а не обрушиваться на игрока сразу.
2. **Вылазка важнее энциклопедии.** Любой новый модуль должен создавать маршрут, риск и награду.
3. **Стрельба должна читаться.** Оружие, враги, попадания, нехватка патронов, звук и HUD должны давать ясное решение в бою.
4. **Самосбор - местный выброс.** Не фон и не таймер смерти, а событие с предупреждением, укрытием, последствиями, лутом и слухами.
5. **A-Life должен производить ситуации.** NPC не просто ходят: они видят кражи, разносят слухи, прячутся, дерутся, несут вещи, создают контракты.
6. **Экономика должна давить на решения.** Дефицит воды, патронов, медицины и документов должен менять цены, награды и маршруты.
7. **ARPG-прогрессия должна открывать риск, а не отменять страх.** Уровни, статы и редкое оружие дают новые способы захода, но сирена и закрытая дверь остаются опасными.

## 4. Не Делать В Следующей Итерации

- Не добавлять новый `FloorLevel`, пока существующие 6 этажей не получат плотные роли в вылазках.
- Не писать общие лор-разделы без задачи, файла и проверки в игре.
- Не добавлять еще сотни предметов без loot table, цены, дефицита, квестового применения или production recipe.
- Не расширять enum ради одного модуля; сначала string ids, tags, registries.
- Не делать новые UI-экраны в DOM. Это canvas/WebGL HUD.
- Не перепиливать карту/миникарту в этой UX-волне: сохранять текущую карту, чинить только доказанные маленькие дефекты.
- Не превращать минимализм интерфейса в пустой экран: первая цель, взаимодействие, бой и опасность должны оставаться видимыми.
- Не вырезать advanced-функционал, чтобы спрятать громоздкость; убирать перегруз нужно пресетами, иерархией и приоритизацией.
- Не превращать мем-NPC в центр игры. Мемы допустимы как городские легенды, слухи, побочные POI.
- Не делать игрока героем, который "решает" самосбор. Победы локальны.

## 5. P0: Что Делать Первым

### P0.UX Cautious First-Session Rework

Цель: убрать первое отторжение от громоздкости без поломки функционала.

Источник:

- публичный фидбек 2026-05-24;
- `../gatbage/reference/ux_rework/rework_01_first_playable_path.md`;
- `../gatbage/reference/ux_rework/rework_02_ui_orchestrator_presets.md`;
- `../gatbage/reference/ux_rework/rework_03_hud_layout_slots.md`;
- `../gatbage/reference/ux_rework/rework_04_message_log_and_bark_triage.md`;
- `../gatbage/reference/ux_rework/rework_05_route_map_clarity.md`;
- `../gatbage/reference/ux_rework/rework_orchestrator.md`.

Сделать только low-risk улучшения:

- current objective: первая цель "поговорить с Ольгой" видна сразу;
- стартовая цепочка: Ольга -> Сержант Баринов -> Ольга -> Яков читается без знания исходников;
- UI presets: новичковый пресет по умолчанию, минимальный пресет как выбор игрока, критические предупреждения locked/default-on;
- modal quiet: меню не тонут под обычным HUD;
- message triage: HUD для действия/опасности/последствий, локальные NPC-реплики с дистанцией в журнал;
- pointer-lock/title hint: первый клик и ЛКМ/Space объяснены явно;
- карта: не трогать крупно, не дробить на режимы, не менять философию; route/lift/objective подсказки делать вне карты или точечно вокруг существующих lift/quest hooks.

Definition of Done:

- новый игрок понимает первый шаг за несколько секунд;
- экран стал спокойнее, но игра не потеряла функции;
- карта работает как раньше;
- advanced UI остается доступным через настройки/меню;
- `npm run check:readonly` проходит; для HUD/input/mobile/render также browser gate.

### P0.0 QA Gate Preservation

Цель: текущий landed-объем уже проходит базовый content-аудит; новая волна не должна снова превращать его в набор непроверенных файлов.

Файлы:

- `scripts/content-audit.mjs`
- `src/gen/*/content_manifest.ts`
- `tests/*.test.ts`
- `README.md`

Текущий baseline:

- `npm run content:audit` -> `Errors: none`.
- Unimported content modules: none detected.
- LIVING zone audit includes `Самосборный Остов`.
- 2026-05-19 audit found a unit blocker in `tests/faction-events.test.ts`: `cult_procession` could spawn 2 pilgrims while the readable encounter contract expects at least 3. The data fix keeps `maxGroup: 3`, makes `minGroup: 3`, and passes focused plus full unit gates.

Дальше делать:

- Для каждой новой content/data/system правки прогнать минимум тот gate, который соответствует риску: data-only `npm run typecheck`, generation/systems/render/save `npm run check`.
- Если `dist/index.html` уже dirty или не должен обновляться, production build gate можно прогонять во временный `--outDir`, а не plain `npm run check`.
- Сверить, что все manifest modules действительно reachable: debug teleport, route floor, zone spawn, contract, rumor или quest lead.
- Обновлять `README.md` только после того, как поведение реально собрано и проверено; `desdoc.md` может фиксировать план и зазоры раньше.

Definition of Done:

- `content-audit` остается без Errors.
- Нет unimported modules, missing item refs и undefined zone title.
- В финальном отчете следующего агента есть один конкретный маршрут проверки, а не только "типизация прошла".

### P0.1 Shooter Readability Pass

Цель: бой должен быть понятен за 3 секунды без чтения таблиц.

Файлы:

- `src/data/weapons.ts`
- `src/data/items.ts`
- `src/systems/inventory.ts`
- `src/systems/ai/combat.ts`
- `src/render/hud.ts`
- `src/render/hud_fx.ts`
- `src/render/sprites.ts`
- `src/systems/audio.ts`

Сделать:

- Развести роли оружия: нож/труба как аварийный ближний бой; пистолет как дешевый точный; дробовик как коридорный стоппер; ППШ/АК как расход патронов; гвоздомет/гарпун как industrial tier; энергооружие как редкий поздний tier.
- В HUD явно показывать выбранное оружие, тип боеприпаса, остаток ammo и reload/attack cooldown, если уже есть данные.
- Для ranged-врагов и ПСИ дать более читаемые projectile sprites/impact feedback.
- Сбалансировать стартовую оружейную так, чтобы Макаров полезен, но патроны не снимают survival pressure.
- Smoke/debug path: через debug-оружие и стартовое стрельбище можно проверить каждую роль оружия.

Definition of Done:

- У каждого оружия есть понятная причина существовать.
- Урон/скорострельность/боеприпас не дублируют соседнее оружие без причины.
- Игрок понимает, почему умер или почему промахнулся.
- `npm run check` проходит или блокер явно описан.

### P0.2 Monster Counterplay Pass

Цель: монстр - не просто HP/speed, а поведение, которое меняет тактику.

Файлы:

- `src/entities/*.ts`
- `src/entities/monster.ts`
- `src/data/monster_ecology.ts`
- `src/data/monster_variants.ts`
- `src/systems/ai/monster.ts`
- `src/systems/ai/combat.ts`
- `src/data/rumors.ts`

Сделать:

- Для каждого часто встречающегося монстра задать одно боевое правило:
  - `SBORKA`: быстрый расход патронов, слабый по HP.
  - `TVAR`: средняя угроза, вынуждает держать дистанцию.
  - `POLZUN`: медленный танк, опасен в тесных проходах.
  - `EYE`: ranged enemy, ломает открытую линию коридора.
  - `SHADOW`: ambush/темнота, требует движения и света/дистанции.
  - `REBAR`: притворяется мусором/опасен рядом со стенами и складами.
  - `PECHATEED`/`PARAGRAPH`: бюрократические угрозы Министерства, наказывают документы/дистанцию.
  - `TUBE_EEL`: вода и трубы.
  - `NELYUD`: ложный человек, опасен на близкой дистанции.
- Экологию монстров связать с этажами, комнатами, слухами и loot hints.
- Новые варианты добавлять только если они меняют тактику: armored, ambush, ranged, water, document, lamp, wall.
- Старый root monster-design bible сохранен в `../gatbage/history/root_notes/appendix.md` / `../gatbage/history/root_notes/monsters.md`; prompt/audit-файлы `Monster_N.md` архивированы как `../gatbage/history/batches/monsters/Monster_N.md`, и новые root `Monster_N.md` без кода больше не нужны. Новый монстр начинается с readable counterplay, reachable encounter и записи в существующих `entities`/`data`/`systems` rails.

Definition of Done:

- У каждого нового/измененного монстра есть counterplay text в data.
- Есть способ встретить его на подходящем этаже.
- Слух или экран может намекнуть на опасность.

### P0.3 Expedition Contracts

Цель: контракт должен быть настоящей вылазкой, а не абстрактным fetch.

Файлы:

- `src/data/contracts.ts`
- `src/systems/contracts.ts`
- `src/systems/quests.ts`
- `src/render/quest_ui.ts`
- `src/render/map_ui.ts`
- `src/systems/events.ts`
- `src/systems/rumor.ts`

Сделать:

- Каждый новый контракт должен указывать floor/zone/room bias через tags или existing context.
- Добавить больше контрактов типов kill, retrieve from container, deliver, repair, escort-like TALK, inspect VISIT.
- Награды привязать к дефициту ресурсов: вода, медицина, ammo, документы.
- Контракты должны публиковать `contract_created/completed/failed` и рождать слухи.
- На карте и миникарте цель контракта должна быть читаемой не хуже сюжетной цели.

Definition of Done:

- Контракт можно взять debug-командой и пройти без знания исходников.
- Он ведет игрока в конкретный рискованный участок.
- Он меняет деньги, отношения, событие или дефицит.

### P0.4 Samosbor As Blowout

Цель: самосбор должен быть главным драматическим циклом вылазки.

Файлы:

- `src/systems/samosbor.ts`
- `src/data/samosbor_variants.ts`
- `src/data/samosbor_director.ts`
- `src/systems/samosbor_director.ts`
- `src/systems/events.ts`
- `src/render/hud_fx.ts`
- `src/render/map_ui.ts`
- `src/systems/world_log.ts`

Сделать:

- Предупреждение: сирена, экраны, NPC bark, зона риска на карте.
- Укрытие: гермодвери, комнаты, риск сломанной двери, выбор "бежать дальше или закрыться".
- Активная фаза: поле тумана/света распространяется по доступному объёму, монстры идут отдельной самосборной волной, local beat держит опасные коридоры. Носитель один - поле тумана; эффект задаёт текущий вариант самосбора и он активен только во время самосбора.
- Редкая философия должна быть игровой, а не только текстовой: классический самосбор порождает фиолетовый туман и монстров; Маронарий меняет анкеты NPC/игрока, предметы и детали клетки; Веретар удаляет живое, вещи и куски карты в белый остаток; Истотит лечит и создаёт, включая опасное.
- Контрмера: пылесос должен вытягивать туман/свет из соседних клеток, чтобы игрок мог чистить край поля, не входя в него.
- Aftermath: ресурсы сдвинулись, контейнер вскрыт, поздний монстр остался, слух родился, маршрут перестроился.
- На `MINISTRY/KVARTIRY/LIVING` больше социального aftermath; на `MAINTENANCE` вода/электрика/давление; на `HELL/VOID` мясо/аномалия/ПСИ.

Definition of Done:

- Один самосбор создает минимум один структурированный `WorldEvent`, один HUD/log сигнал и одну игровую проблему после отбоя.
- Игрок может пережить событие умным укрытием, а не только DPS.

### P0.5 Loot, Containers, Scarcity

Цель: лут должен быть причиной маршрута и конфликта.

Файлы:

- `src/data/container_defs.ts`
- `src/systems/containers.ts`
- `src/data/resources.ts`
- `src/data/factories.ts`
- `src/systems/economy.ts`
- `src/systems/production.ts`
- `src/render/container_ui.ts`

Сделать:

- У каждого важного POI должны быть 1-3 контейнера с владельцем, доступом и риском.
- Кража из фракционного/owner контейнера должна быть заметна, если рядом NPC или позже audit.
- Production output должен попадать в контейнер, который игрок может легально получить, купить, украсть или открыть ключом.
- Дефицит должен менять цену и награды, но не делать предмет бесконечно дорогим.
- Контейнеры должны поддерживать квестовые цели без новых специальных систем.

Definition of Done:

- В новом POI игрок выбирает: купить, украсть, взломать, выполнить услугу или уйти.
- События контейнеров попадают в лог/слух/отношения.

### P0.6 Interactive Objects Backbone

Цель: обычные предметы комнаты должны стать дешевыми gameplay-точками без новых веток в `main.ts`, `render/webgl.ts` и broad AI.

Файлы:

- `src/data/interactive.ts`
- `src/systems/interactive.ts`
- `src/gen/interactive_placement.ts`
- `src/systems/interactions.ts`
- `interactive.md`

Текущий первый срез уже сделан как ephemeral registry без save-shape change: существующие раковины дают пить через lazy `Feature.SINK` adapter, туалеты закрывают часть needs через lazy `Feature.TOILET` adapter, генераторы могут ставить `workbench_basic` через helper, а видимые контейнеры идут через adapter к старому container UI. Следующий шаг - расширять это не ветками диспетчера, а новыми `InteractiveDef` и placement-вызовами.

Сделать дальше:

- добавить реальные workbench/crafting/repair actions поверх существующих items/factories, не отдельный crafting framework;
- дать authored POI явные interactive placements вместо ad hoc screen/machine branches;
- решить, какие terminal-like systems можно обернуть adapter-ом без потери overlay state;
- persistence/floor-memory добавлять только для объектов с долговременным состоянием, с save-shape bump.

Definition of Done:

- новый объект добавляется data def + placement helper + action handler/test;
- prompt/use используют один resolver и не расходятся;
- нет per-frame full-world scans и нет новых `Feature` enum values для named-вариантов;
- `npm run check` проходит для source-среза.

## 6. P1: Роли Этажей

Этажи уже есть, а между ними появился процедурный слой. Следующая задача - сделать ручные этажи и процедурные прослойки разными типами вылазок.

| Этаж | Роль | Первичные решения игрока |
| --- | --- | --- |
| `LIVING` | hub + бытовой survival | кому помочь, где взять припасы, что украсть, куда идти по слуху |
| `MINISTRY` | документы, пропуска, бюрократический stealth/combat | легально пройти, подделать, украсть, подкупить, зачистить |
| `KVARTIRY` | плотный социальный riot-floor | вмешаться в бунт, обойти толпу, спасти, ограбить, договориться |
| `MAINTENANCE` | industrial shooter expedition | ремонт, давление, вода, форпост, редкий тех-лут, жесткий бой |
| `HELL` | high-threat combat/ПСИ floor | выжить, выбить босса, прорвать порог, не задерживаться |
| `VOID` | late-game anomaly/boss space | рискнуть правилами, закрыть последствия, завершить run |

Правило: новый контент должен усиливать роль этажа. Если модуль одинаково работает на любом этаже, он недостаточно конкретен.

### P1.1 Procedural Floor Combinatorics

Цель: каждая новая игра получает вертикальный маршрут с узнаваемыми ручными сюжетными якорями и случайными вылазочными этажами между ними.

Сейчас реализовано:

- `src/data/procedural_floors.ts` - 10 geometry-профилей, 5 majority faction-профилей, 20 anomaly-профилей, danger и seed-biased loot/monster списки.
- `src/systems/procedural_floors.ts` - run seed, текущий `z`, 54 procedural/fallback specs, save/load и лифтовой маршрут.
- `src/gen/procedural_floor.ts` - базовый универсальный генератор без сюжетных NPC.
- `world.anomalyTeleports` - редкие пары клеток для топологической аномалии.
- VISIT-квесты по этажам закрываются только на ручных story anchors, не на процедурных этажах с тем же базовым `FloorLevel`.

Следующие улучшения:

- Добавлять новые geometry-профили через `../gatbage/reference/procedural_floors/geometry.md`, не через ручные story generators.
- Добавлять новые anomaly-профили через `../gatbage/reference/procedural_floors/anomaly.md`; каждая аномалия должна менять маршрут, риск, видимость, лут, монстров или решение игрока.
- Сделать контракты aware of `FloorRun`: заказ должен уметь вести не только на `FloorLevel`, но и на procedural spec tags вроде `workshop`, `smog`, `mushroom`.
- Дать слухам и экранам текст о текущей комбинации этажа: тип, главная фракция, danger, аномалия.
- Не превращать procedural floors в копии ручных: ручные этажи держат сюжет и named content, процедурные - вылазку, вариативность, риск и добычу.

### P1.2 Вертикальная Читаемость Вылазки

Проблема: вертикальный маршрут уже большой (`z=-50..+50`), но игрок не должен воспринимать лифт как случайную телепортацию между названиями. Ему нужна карта намерений: куда он едет, зачем, какой риск берет и где может вернуться.

Уже приземлено:

- Карта стала exploration-поверхностью, а не полной схемой: неизвестная геометрия скрыта на миникарте и `M`, обычные entity dots не рисуются в закрытых клетках.
- Неизвестные не-стены на границе открытой карты имеют короткое визуальное затухание в темноту, чтобы игрок считывал продолжение комнат/коридоров/дверей без подсветки скрытой массы стен.
- Стартовый сектор раскрывается как зона проходимой геометрии, а не список комнат: комнаты, коридоры, двери, лифты, вода и пропасти стартовой макро-зоны попадают на карту сразу.
- Локальная тропа движения, route-cue/картографические reveal и предупреждения убежищ используют один UI-only слой раскрытия; вход в комнату не раскрывает ее целиком без отдельной наводки.
- Самосборная перестройка визуально отнимает знание о перестроенном месте: локальная волна на любом этаже снова закрывает поле перестройки.

Сделать:

- В лифтовом/карточном тексте различать четыре типа stop: story anchor, authored design floor, procedural expedition floor, numbered lift anomaly.
- Для каждого authored route stop дать короткую игровую роль: крыша = воздух/антенны/видимость, верхнее бюро = документы/доступ, коммунальное кольцо = социальный обход, производственный пояс = лут/ремонт, темная пересадка = опасный shortcut, тьма = late-game pressure.
- Procedural floor spec должен сообщать игроку не только base floor, а `geometry + faction + anomaly + danger`: например "мастерские, ученые, холодный карман, danger 3".
- Контракты и слухи должны уметь ссылаться на `z`/route id/procedural tags, а не только на `FloorLevel`.
- Персистентность маршрута теперь считается базовым дизайном вылазки: игрок постепенно раскрывает карту конкретных route stops, а кровь, пули, открытые контейнеры и живые угрозы должны оставаться на своем этаже. Самосбор не обнуляет весь этаж по факту тревоги: на всех этажах локальная волна из случайной точки карты вшивает измененную область в существующий этаж, и сшитый результат становится новым слепком этого floor key. Длительность растет по `abs(z)` от 30 секунд до 15 минут, а кулдаун идет обратно: случайный интервал до 30 минут у центра маршрута и минимум 1 минута у дальних `abs(z)=50` этажей.
- Дальше усиливать надо не повторную генерацию, а читаемость: лифт должен объяснять seed/route id/return direction, карта должна показывать известные stop keys, а контракты должны вести по понятным `z`/route tags.
- На карте нужен один устойчивый marker language для plot quest, system assignment, contract, anomaly warning и return route. Не добавлять новый UI-экран, если можно расширить существующий `map_ui.ts`/`quest_ui.ts`.

Definition of Done:

- Игрок перед посадкой в лифт понимает минимум: направление, ближайшую цель, danger class и причину ехать.
- После выхода из лифта игрок видит один immediate lead в пределах текущего этажа: marker, слух, экран, NPC bark или опасный след.
- Numbered lift anomaly выглядит как interruption обычного маршрута, а не как потерянный save/floor state.

## 7. P1: ARPG Progression

Цель: прогрессия дает стиль игры, а не только числа.

Файлы:

- `src/systems/rpg.ts`
- `src/core/types.ts`
- `src/render/stats_ui.ts`
- `src/systems/inventory.ts`
- `src/data/weapons.ts`
- `src/data/psi.ts`

Сделать:

- STR: ближний бой, carry/устойчивость, тяжелое оружие.
- AGI: движение, скорострельность, уклонение/перезарядка, stealth-like кража.
- INT: ПСИ, контракты/документы, экономика/цены, редкие dialogue outcomes.
- Добавлять perks только после того, как STR/AGI/INT реально меняют решения.
- Scaling монстров держать в рамках: высокий уровень открывает опасные зоны, но не превращает коридор в тир.

Definition of Done:

- При получении уровня игрок выбирает стиль следующей вылазки.
- В HUD/инвентаре понятно, что изменилось.

## 8. P1: A-Life Situations

Цель: симуляция должна сама создавать stalker-like истории.

Файлы:

- `src/systems/ai/*`
- `src/systems/npc_memory.ts`
- `src/systems/context.ts`
- `src/systems/rumor.ts`
- `src/systems/faction_events.ts`
- `src/data/faction_events.ts`
- `src/systems/events.ts`

Сделать:

- NPC видит важное: кража, убийство, самосбор, фракционный бой, rare monster, production shortage.
- NPC запоминает кратко: fear/trust/knownRumorIds/recent facts, без больших object graphs.
- Слух должен быть полезной подсказкой: floor, room type, monster, resource, contract, danger.
- Фракционные события должны оставлять физический след: NPC, дроп, контейнер, смена зоны, лог.
- Патрули и гражданские должны не только спавниться, но создавать наблюдаемые столкновения.

Definition of Done:

- Игрок слышит о событии, может найти место события и увидеть последствия.
- Нет per-frame full-world scans.

## 9. P2: Контент-Модули Следующего Прохода

Добавлять не "просто комнаты", а POI с gameplay contract.

Каждый новый POI обязан иметь:

- floor role;
- входной риск;
- 1 NPC или 1 контейнер или 1 monster setup;
- 1 решение игрока: trade, steal, repair, escort, kill, hide, forge, expose, reroute, flee;
- 1 событие или слух;
- debug/reachable path;
- `aptMask` и проверенную связность, если это постоянный POI на `LIVING`.

Предыдущие примеры уже в основном приземлены в manifest-backed modules: `LIVING` получил склад патронов, медпост, картографа, подготовку вылазки и несколько cellar/medical/social POI; `MINISTRY` получил document/permit/archive/audit rooms; `KVARTIRY` получил water riot, barricade, ration queue, print room, ammo smelter and cult/social rooms; `MAINTENANCE` получил pressure/water/steam/lift/slime/production POI; `HELL` и `VOID` получили свои plot/protocol/combat anchors.

Новая landed-волна расширила не только "что есть", но и поверхность проверки:

- `LIVING`: появились/усилились маршруты знакомого голоса, пломбировщика, белой прислушки, самосборного остова, научного escort sample, белого окна, дымной комнаты, fake medpost и комнаты белого остатка. Следующий проход должен доказать, что эти зоны дают разные решения, а не просто соседние страшные комнаты.
- `MINISTRY`: к permit/document/archive слою добавлены картотечник и матка документов. Их смысл - давить на документы, очереди и дистанцию, а не превращать Министерство в еще один generic combat floor.
- `KVARTIRY`: очередь, пустой сосед, чернобожий свод и social-pressure rooms должны читаться как гражданский кризис: толпа, долг, соседство, слух, кража, донос.
- `MAINTENANCE`: новая плотность самая высокая: pressovik, nasosnaya matka, remontnik bez smeny, hladonets, kabelnik, ventshun, black slime eyes, chernaya lichinka, betonoed shortcut, kostorez locker, filtronos and other industrial/slime rooms. Следующий шаг - route grouping: игрок должен понимать, что это не 45 отдельных дверей, а несколько промышленных маршрутов.
- `HELL`/`VOID`: myasomer, trace seal, maronary signalshchik, pristav pustoty, perestanovshchik, seryy smotritel and ekranник должны быть late-game rule threats. Их нельзя балансить только HP/уроном; каждый обязан иметь ясное нарушение правила и counterplay.

Для этой волны приоритет не "еще 20 модулей", а audit routes: пройти 10-15 существующих POI, записать где игрок получает lead, где принимает решение, где получает награду/последствие, где теряется из-за UI или одинаковых комнат.

Следующие POI выбирать по реальным пробелам после playtest: где нет маршрута, читаемой награды, риска, события или последствий. Не повторять уже существующие room concepts только ради еще одного файла.

## 10. Баланс-Ориентиры

Эти числа не закон, а начальная линейка для проверки.

| Контур | Цель |
| --- | --- |
| Стартовая вылазка | 5-10 минут до первого значимого выбора и риска |
| Патроны | достаточно для защиты, недостаточно для зачистки всего |
| Еда/вода | давление каждые 10-20 минут, не постоянный UI tax |
| Самосбор | игрок должен успеть среагировать, если не игнорирует предупреждения |
| Бой | обычный монстр опасен пачкой; особый монстр опасен правилом |
| Контракт | цель, риск и награда видны до принятия или из слуха |
| Экономика | дефицит меняет маршрут, но не ломает прохождение |

## 11. Бэклог Для Следующих Агентов

1. **Combat HUD pass**: ammo/cooldown/weapon role feedback.
2. **Weapon balance audit**: стартовое, mid-tier, late-tier оружие без дублей; учесть 70 physical weapon stat entries including unarmed fallback and deletion-beam tier.
3. **Monster counterplay audit**: проверить ecology/rumors/encounter readability для 67 standalone monster kinds.
4. **Ranged readability**: projectile sprite, impact, sound, HUD damage cue.
5. **Samosbor UX pass**: warning, shelter, aftermath and log/map clarity across 7 variants.
6. **Contract target markers**: системные контракты должны быть читаемыми как plot quests, включая procedural `FloorRun` targets; карта должна раскрывать только известный игроку участок или явную полученную наводку.
7. **Container ownership consequences**: witness/audit для owner/faction контейнеров.
8. **Production/container audit**: 12 factories and 42 recipes should create reachable trade/steal/reward decisions.
9. **Rumor-to-place pass**: слух у NPC ведет в конкретный POI/контейнер/монстра или опасный floor spec.
10. **Faction event residue**: после столкновения остаются дроп, marks, слух, NPC behavior or zone-control change.
11. **ARPG stat effects audit**: STR/AGI/INT visibly affect combat/survival/dialogue.
12. **Smoke scenario update**: smoke должен проверять старт, бой, лифт, контракт/квест, самосбор and at least one current domain loop.
13. **README fact update after code**: обновлять только shipped behavior после проверки.
14. **QA gate preservation**: keep `content-audit` green after every content wave; add targeted tests for regressions.
15. **Vertical route UX**: lift/map/quest language for `z`, route id, procedural tags, danger and return path.
16. **Monster-wave route audit**: verify the new named monster POI are reachable, readable and not duplicate HP/speed encounters.
17. **Maintenance grouping pass**: turn 54 maintenance manifest entries into several legible industrial routes with leads and rewards.
18. **Net Sphere design guardrail**: keep optional cloud presence as ambient terminal/memory, never required progression.

## 12. Definition Of Done Для Любой Фичи

Фича считается готовой, если:

- ее можно встретить в игре или вызвать через debug;
- она дает игроку решение, а не только текст;
- она публикует существующее событие, если меняет мир;
- она не сканирует весь мир каждый кадр;
- она учитывает toroidal math;
- она не ломает слой `core/data/gen/systems/render`;
- она имеет краткую фактическую запись в README только после реализации;
- для systems/render/save/load/generation изменений пройден `npm run check` или указан реальный блокер.

## 13. Короткая Формула Для Агентов

Не "добавь контент".
Делай **вылазку**:

**слух -> подготовка -> маршрут -> риск -> бой/сделка/кража/ремонт -> самосборный сбой -> лут -> событие -> последствия в NPC/экономике/зоне.**

Если модуль не вставляется в эту цепочку, он второстепенный для следующей итерации.

## 14. Лорная Волна: Источники И Отбор

Эта секция добавлена после внешнего ресерча по самосборной вики, тредовым следам, НИИ Слизи, культу Чернобога, Желемышу, говняку, Истотиту, Веретару и Маронарию. Источники противоречат друг другу, потому что самосборная вселенная коллективная и тредовая. Для игры это плюс: канон ГИГАХРУЩА должен брать устойчивые мотивы и превращать их в игровые системы, а не копировать пасты.

Правило отбора:

- устойчивый мотив из вики или нескольких тредовых следов можно брать как базу;
- одиночную шутку можно брать только как слух, граффити, предмет, сон, экран или побочный POI;
- прямой матерный/эротический/форсный тредовый текст не переносить в player-facing контент;
- мем не должен ломать survival horror: Желемыш, говняк, Маронарий и Веретар работают только если дают риск, маршрут и последствия.

Рабочая карта источников:

| Источник | Что брать | Как использовать |
| --- | --- | --- |
| [САМОСБОР вики: Самосбор](https://samosbor.fandom.com/ru/wiki/%D0%A1%D0%B0%D0%BC%D0%BE%D1%81%D0%B1%D0%BE%D1%80) | самосбор не объяснен, предупреждается сиреной, переживается за гермодверью, после него приходят ликвидаторы | усилить warning/shelter/aftermath loop, не давать игроку "решить" самосбор |
| [САМОСБОР вики: Гигахрущёвка](https://samosbor.fandom.com/ru/wiki/%D0%93%D0%B8%D0%B3%D0%B0%D1%85%D1%80%D1%83%D1%89%D1%91%D0%B2%D0%BA%D0%B0) | кубические строения, коридоры вместо улиц, заводы/НИИ/больницы/школы, автономная экономика, талоны, вторсырье | строить новые POI как части хозяйства, а не как isolated rooms |
| [САМОСБОР вики: Последствия самосбора](https://samosbor.fandom.com/ru/wiki/%D0%9F%D0%BE%D1%81%D0%BB%D0%B5%D0%B4%D1%81%D1%82%D0%B2%D0%B8%D1%8F_%D1%81%D0%B0%D0%BC%D0%BE%D1%81%D0%B1%D0%BE%D1%80%D0%B0) | монстры почти не классифицируются; слизь токсична и бывает разных типов; люди могут мутировать | добавить slime ecology, residue cleanup, monster counterplay and sample contracts |
| [САМОСБОР вики: Ликвидаторы](https://samosbor.fandom.com/ru/wiki/%D0%9B%D0%B8%D0%BA%D0%B2%D0%B8%D0%B4%D0%B0%D1%82%D0%BE%D1%80%D1%8B) | зачистка, РБХОПЗ, дробовики, топор, огнеметы, жернов, ПТРС, УФ-прожектор | сделать ликвидаторские инструменты источником новых боевых ролей и cleanup-контрактов |
| [Хрущепедия / ShoutWiki index](https://samosbor.shoutwiki.com/) | широкий список флоры/фауны, ресурсов, НИИ, коммуникаций, религии, технологий | использовать как каталог будущих доменов: бетоноеды, гермоточильщики, лифтовая арахна, пневмопочта, Бионет |
| [Author.Today: НИИ "Слизи"](https://author.today/post/531103) | НИИ как сеть филиалов; ученые проектируют гермодвери, оружие и бытовые устройства; собирают образцы с ликвидаторами | создать научно-полевую ветку с образцами, допусками, экспериментальными инструментами и морально грязной экономикой |
| [Самосбор Вики: Слизь](https://samosbors8878.fandom.com/ru/wiki/%D0%A1%D0%BB%D0%B8%D0%B7%D1%8C) | слизь как распространенное остаточное последствие; черная/прозрачная базовые; редкие цвета опаснее | сделать slime residue не просто декором, а ресурсом/опасностью/уликой |
| [Самосбор вики: Культ Чернобога](https://samosb0r.fandom.com/ru/wiki/%D0%9A%D1%83%D0%BB%D1%8C%D1%82_%D0%A7%D0%B5%D1%80%D0%BD%D0%BE%D0%B1%D0%BE%D0%B3%D0%B0) | крупнейшая религиозная угроза, центральная и внешняя ячейки, конфликт с ликвидаторами | развить культистов как человеческую A-Life фракцию с вербовкой, саботажем и block takeover |
| [Самосбор вики: Чернобожники](https://samosb0r.fandom.com/ru/wiki/%D0%A7%D0%B5%D1%80%D0%BD%D0%BE%D0%B1%D0%BE%D0%B6%D0%BD%D0%B8%D0%BA%D0%B8) | Чернобог как психо-религиозный паттерн, знаки, черные ладони, блоки с общими биологическими/поведенческими признаками | делать культ не "магами", а заражающей социальной практикой, которую игрок распознает по следам |
| [Мракопедия: Маронарий](https://mrakopedia.net/wiki/%D0%9C%D0%B0%D1%80%D0%BE%D0%BD%D0%B0%D1%80%D0%B8%D0%B9) и archived `maronary.md` in `../gatbage/history/root_notes/appendix.md` / `../gatbage/` | зеленый свет, писк, пение, потеря телесности, золотая стружка | редкий `SamosborVariantDef`, bounded marks, не отдельная система |
| archived `istotit.md` in `../gatbage/history/root_notes/appendix.md` / `../gatbage/` | золотой церковный самосбор, укрытые комнаты, социальный долг | редкий вариант самосбора с shelter choice и aftermath-долгом |
| archived `veretar.md` in `../gatbage/history/root_notes/appendix.md` / `../gatbage/` | белая внешняя область, песок, отсутствие солнца, зараженное наблюдение | редкий вариант самосбора с area leak, shortcut и опасными уликами |
| [2ch.life archive 229287446](https://2ch.life/b/arch/res/229287446.html) | Веретар, Желемыш, говняк, Маронарий и Истотит встречаются рядом как шумный тредовый фольклор | брать только мотивы: область, зеленый источник, дым/забытье, дубленая кожа, слово-зараза |
| [2ch archive 618654](https://2ch.hk/sn/arch/2020-08-10/res/618654.html) | Маронарий привязан к хрущевке, экранам, писку и исчезающей телесности | уже учтено в archived `maronary.md` и текущих `SAMOSBOR_VARIANTS`, не дублировать прямые пасты |
| [Самосбор Minecraft: Грибоводство](https://samosborminecraft.fandom.com/ru/wiki/%D0%93%D1%80%D0%B8%D0%B1%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE) | Желемыш существует как грибной ресурс среди других грибов/плесени | адаптировать как опасную food/medicine/faction economy, не как Minecraft-механику |
| Тредовые следы Желемыша | гриб/желе/телесная дубленость, навязчивое слово, сельско-кладбищенский и бытовой тон | грибной/телесный ресурс с плохой ценой, не веселый бафф |
| Тредовые и игровые следы говняка | дешевый наркотический продукт, дым, забытье, черный рынок | survival pressure valve: краткая выгода против зависимости, долгов, слухов и галлюцинаций |

## 15. Масштаб: После Рубежа 100k

Проект уже прошел рубеж 100k, поэтому 100k+ больше не цель сама по себе. Для ГИГАХРУЩА масштаб считается не строками, а количеством playable contracts, проверенных маршрутов и последствий в симуляции.

Хороший рост кода:

- новый POI с генерацией, NPC/контейнером/монстром, слухом, событием и проверяемым маршрутом;
- новый самосборный вариант через существующие variant/aftermath/event hooks;
- новый monster kind или variant с counterplay;
- новый контракт, который ведет на floor/run spec и оставляет событие;
- новый ресурс/предмет только если есть trade/use/quest/production/steal decision.

Плохой рост кода:

- 200 предметов без контейнеров, цен, рецептов и квестов;
- новый `FloorLevel` ради одной комнаты;
- новый event bus, новый UI framework или отдельная "система лора";
- enum для каждого мема;
- длинные тексты без маршрута, риска и награды.

Ориентир для следующей большой волны:

| Масштаб | Что реально нужно | Ориентир |
| --- | --- | --- |
| 100k строк | текущий диапазон; нужен cleanup, playtest и smoke-покрытие текущей плотности | не выдавать как отдельную цель |
| 150k строк | новые packages только после проверки уже landed slime/cult/zhelemish/govnyak/variant loops | примерно +50k TS |
| 200k строк | системные passes, новая экология и процедурные варианты только с playable contracts | примерно +100k TS |

Каждый package должен быть маленьким и закончить свою цепочку: data -> gen -> systems/event -> render/HUD/log -> smoke/debug. Если package не имеет DoD, его не брать в работу.

## 16. Домены Контента: Статус И Следующий Шаг

Часть "новой волны" уже в коде. Эти anchors нельзя выдавать как unstarted work; новый агент должен читать текущие файлы и формулировать только недостающий шаг.

| Домен | Что уже есть в коде | Следующий полезный зазор |
| --- | --- | --- |
| НИИ Слизи | `src/data/slime_defs.ts`, ресурс `slime_samples`, maintenance/living slime POI, deactivation furnace, sample/cleanup rooms | проверка readability: как игрок находит site, чем рискует, кому сдает образец |
| Чернобог/культ | `chernobog_docket`, external neighbor, cult kitchen/workshop, false-safe procedural anomaly, cult rumors/events | больше наблюдаемых социальных последствий, меньше новых алтарей |
| Редкие самосборы | `maronary`, `istotit`, `veretar` уже в `SAMOSBOR_VARIANTS`; есть modifiers, aftermath и director beats | debug/smoke coverage, HUD/map/log clarity, no new variant before these are readable |
| Говняк | item/status/system hooks, contraband resource, smoke den, smog/procedural hooks | bounded debt/addiction clarity; не glamorized buff |
| Желемыш | defs/resource/items, living cellar, fake medpost, sample/contract hooks | понятная цена raw/use/sell choices и реакция NPC |
| Биота/монстры | часть кандидатов уже имеет entities/systems/POI: lift arachna, Hladon, paritel, krysnozhka, kostorez, carnivorous fungus, betonoed shortcut | counterplay and encounter readability pass before adding more species |

Общее правило осталось прежним: новый module должен давать route -> risk -> decision -> event/consequence. Если он только добавляет noun или lore text, его не брать.

## 17. Backlog Hygiene

Старые AG61-AG120 prompts больше не являются чистым backlog: многие соответствующие файлы уже существуют, а сами агентские следы сведены в `../gatbage/history/root_notes/appendix.md` и убраны из активного дерева. Для новой задачи писать не "сделай AGXX", а:

1. какие current files уже покрывают домен;
2. какой конкретный behavior still missing;
3. какой debug/reachable path проверит результат;
4. какие counters или README facts изменятся только после shipped behavior.

Высокий приоритет для следующего прохода:

- Combat HUD/weapon-role pass.
- Contract target readability, включая procedural `FloorRun` specs.
- A-Life residue: witness, rumor, loot/drop/zone trace after events.
- Smoke scenario over current domains: slime sample, cult conflict, rare samosbor, return.
- README fact pass only after behavior is verified in game.

Не заводить новые `../gatbage/history/agent_tasks`, `../gatbage/history/agent_logs`, `../gatbage/history/agent_prompts` или design-floor prompt folders без явного нового orchestration pass. Обычный результат работы должен жить в коде, README/desdoc/architecture или одном компактном appendix note.

`scenarist.md` и `../gatbage/reference/scenario_writers/` активны только как text-pass references. Они помогают чинить голос персонажей, barks, слухи, записки, квестовые строки, контракты, самосборные сообщения, монстр-подсказки и terminal text. Они не являются shipped-behavior source of truth и не создают backlog сами по себе: сначала проверять README, architecture, текущий `src/` и конкретную задачу.

Правила для сценарных документов:

1. Читать `../gatbage/reference/scenario_writers/README.md`, потом только нужный packet.
2. Использовать `Целевые файлы` как routing hints, а не ownership lock.
3. Если packet просит текст для behavior, которого нет в коде, не писать его как факт. Сначала нужен playable route или явный task scope.
4. Исторические `../gatbage/history/root_notes/istotit.md`, `../gatbage/history/root_notes/maronary.md`, `../gatbage/history/root_notes/veretar.md` и agent prompts дают мотивы, но не заменяют текущие `src/data/samosbor_variants.ts` и `src/data/samosbor_director.ts`.

## 18. Integration Hooks

Сначала использовать существующие rails:

- `systems/events.ts` для фактов мира;
- `contracts`, `containers`, `economy`, `production` для награды, дефицита и кражи;
- floor `content_manifest.ts` files для additive modules;
- `procedural_floors` defs для geometry/faction/anomaly, без нового `FloorLevel`;
- existing status/domain systems such as `govnyak`, `hladon`, `carnivorous_fungus`, `floor_instances` when they already match the behavior.

Новые narrow APIs допустимы только под конкретный blocked module: small condition ids, item-id variants for samples, event tags, or debug force hooks. Не начинать с universal disease/drug/mutation framework, new event bus, ECS rewrite, or DOM document UI.

## 19. Шаблон Промпта Для Следующего Агента

Использовать как основу для выдачи задач:

```txt
Ты работаешь в /Users/jirnyak/Mirror/gigahrush.
Прочитай README.md, architecture.md, desdoc.md и relevant source files.
Для исторического контекста смотри ../gatbage/history/root_notes/appendix.md, но не превращай старые AGXX файлы в backlog без сверки с текущим кодом.
Твоя задача: AGXX <название>.
Ownership: <files/modules>.
Не трогай main.ts/core/world.ts/render/webgl.ts без крайней необходимости.
Сделай playable slice: rumor/lead -> route -> risk -> decision -> reward/consequence.
Добавь debug или reachable path.
Публикуй важный факт через systems/events.ts, если меняется мир.
Для generation/systems/render/save changes запусти npm run check; для data-only минимум npm run typecheck.
README обновлять только если поведение реально shipped.
```

## 20. Новый Критерий "Много Контента"

Много контента в ГИГАХРУЩЕ - это не количество nouns. Это количество ситуаций, где игрок меняет план.

Хорошая метрика следующего прохода:

- 10+ audited routes through existing POI/contracts/samosbor consequences;
- 10+ rumor-to-place chains that point to concrete risk and reward;
- 6+ event residues that leave visible loot, marks, NPC behavior, economy or zone change;
- 1 smoke/debug path that covers slime sample, cult conflict, rare samosbor and return;
- 0 new nouns without use, route, price, theft, contract or consequence.

Если после волны игрок чаще думает "куда идти, чем рисковать, кому верить, что сдать, что скрыть", цель достигнута. Если он просто видит больше названий в инвентаре, цель провалена.

## 21. Что Уже Есть И Что Теперь Развивать

Эта секция нужна, чтобы не начинать новый проход с нуля. Проект уже имеет много landed-систем; следующая работа должна развивать их до читаемых игровых цепочек.

| Домен | Уже есть | Развивать дальше | Первый проверочный вопрос |
| --- | --- | --- | --- |
| Базовая вылазка | стартовый hub, оружейная, сюжетная цепь, побочные NPC, лифты, 6 base floors | связать подготовку, маршрут, риск и возвращение в один debug/smoke сценарий | может ли новый игрок за 10 минут получить цель, подготовиться, рискнуть и вернуться? |
| Вертикальный маршрут | `FloorRun` `z=-50..+50`, 41 design floors, 54 procedural/fallback floors, numbered lift anomalies, runtime floor memory | понятная навигация: seed, route id, danger, anomaly, return path, contract target | понимает ли игрок, куда его везет лифт и почему это не просто случайность? |
| Бой | 70 physical weapon stats including unarmed fallback, 18 PSI weapons, projectiles, sounds, durability/ammo | weapon-role readability, HUD ammo/cooldown, impact feedback, ranged monster cues | может ли игрок понять за 3 секунды, чем стрелять и почему промах/смерть случились? |
| Монстры | 67 standalone monster kinds, ecology/counterplay data, named encounters | audit каждого монстра на rule/counterplay/rumor/room fit | меняет ли монстр тактику или это просто другое HP/speed? |
| Самосбор | 7 variants, 19 modifiers, 44 aftermath beats, 33 director beats, shelter/fog/seal loop | сделать warning/shelter/aftermath главной драмой каждой вылазки | переживает ли игрок самосбор решением, а не только бегом/DPS? |
| A-Life | AI states, factions, events, NPC memory, rumors, faction events | witnesses, residue, rumor-to-place, post-event visible trace | слышит ли игрок о событии и может ли найти его след? |
| Экономика | 17 resources, 12 factories, 42 recipes, scarcity prices, containers, production ticks | owner/theft/audit, reward pressure, production outputs as route goals | создает ли дефицит маршрут, конфликт или сделку? |
| Procedural anomalies | 20 anomaly profiles: teleport, smog, samosbor seed, mycelium, false safe block, Hladon cold, topology/media/crowd anomalies and normal floors | contract-aware tags, screen/rumor copy, per-anomaly counterplay | на procedural floor есть решение, отличное от "пройти коридор"? |
| Net Sphere | optional terminal, name/netgen, heartbeat, deaths, samosbor events, compact progress, chat | ambient shared memory and distant warnings, not required progression | добавляет ли сеть атмосферу и следы других игроков без ломки single-player? |
| QA/docs | README fact map, architecture contract, content audit, `node:test` suite, smoke script, `../gatbage/` cleanup | close audit blockers, sync counters from source only when explicitly needed, route audit notes | можно ли доказать shipped behavior командой и маршрутом? |

Главный вывод: сейчас больше всего не хватает не новых nouns, а **переходов между системами**. Контракт должен вести в комнату, комната должна иметь контейнер/монстра/NPC, действие должно публиковать event, event должен стать слухом/логом/последствием, а самосбор должен вмешиваться в этот маршрут.

## 22. Новая Волна Как Игровые Нити

Новые и старые домены нужно развивать не отдельными файлами, а нитями, которые игрок может пройти.

### 22.1 Нить "Подготовка Вылазки"

Минимальная цепочка:

**rumor/contract -> expedition prep room -> buy/steal ammo/medicine/water -> choose weapon -> elevator target -> return check.**

Что уже есть:

- `living/expedition_prep.ts`;
- Sergeant Barinov armory and starter Makarov/ammo;
- economy scarcity and container ownership;
- system assignments and debug creation;
- map/quest markers.

Что доработать:

- Один явный prep-board через существующий HUD/quest/map path, без DOM-экрана.
- Цена подготовки должна быть заметной: взять воду или оставить деньги на патроны, купить бинт или украсть из медпоста.
- После возвращения игрок должен видеть, что принес: XP, деньги, предмет, долг, слух, репутацию или новый риск.

### 22.2 Нить "НИИ Слизи И Образцы"

Минимальная цепочка:

**scientist lead -> sample site -> protective choice/tool -> collect sample -> decide sell/report/deactivate -> event/rumor/economy shift.**

Что уже есть:

- `slime_defs`, `slime_samples`, sample post, cleanup rooms, green acid, blue glow, black eyes, deactivation furnace, slime singing vents;
- NII contraband audit and scientist escort sample;
- slime resource and production recipe hooks.

Что доработать:

- У каждого цвета слизи должен быть один visible risk и один reason to collect.
- Deactivation furnace должен быть не просто production object, а моральный выбор: сдать ученым, ликвидаторам, продать, скрыть, сжечь.
- Слухи должны подсказывать не "есть слизь", а где, какого цвета, чем опасна и кому нужна.

### 22.3 Нить "Культ Чернобога"

Минимальная цепочка:

**black-hand trace -> suspicious social room -> choose report/follow/loot/disrupt -> faction event -> residue.**

Что уже есть:

- cult kitchen/workshop, external cell neighbor, Chernobog docket, cult processions, black-hand marks, false safe block procedural anomaly;
- conflict hooks with liquidators and faction events;
- meat rune and cult-adjacent samosbor consequences.

Что доработать:

- Культ должен ощущаться человеческой практикой: вербовка, снабжение, страх соседей, саботаж, долг.
- Не добавлять "магическую систему культа"; использовать faction events, rooms, marks, rumor, containers and NPC behavior.
- Игрок должен иметь минимум четыре ответа: сообщить, использовать как cover, украсть supply, сорвать насилием/шантажом.

### 22.4 Нить "Документы И Министерство"

Минимальная цепочка:

**need permit/form -> queue/document room -> bribe/forge/steal/fight -> access or audit consequence.**

Что уже есть:

- permit office, weapon permit bureau, stamp room, document gate, inspection/liquidator/raionsovet archives, refusal clause, kartotechnik, matka dokumentov;
- document items/resources and Ministry rumors;
- bureaucratic monsters `PECHATEED`, `PARAGRAPH`, plus new document threats.

Что доработать:

- Документ должен открывать route или снижать риск, а не быть flavor item.
- Подделка/кража документов должна иметь witness/audit path.
- Ministry combat должен отличаться от Maintenance: меньше "туннельный тир", больше дистанция, очередь, пропуск, проверка, закрывающаяся дверь.

### 22.5 Нить "Коллекторная Промышленная Экспедиция"

Минимальная цепочка:

**maintenance lead -> pressure/water/steam route -> repair or reroute -> industrial monster -> container output/reward.**

Что уже есть:

- pressure station, steam valves, overflow, water bridge, heatline zero, metro error line, lift repair, charge/automation cage, pneumomail;
- many industrial monsters and slime rooms;
- factories/resources/containers.

Что доработать:

- Сгруппировать 54 maintenance manifest entries в 4-6 узнаваемых маршрутов: pressure, water, lift, slime, production, mail.
- Каждый маршрут должен иметь one-sentence player goal, one route hazard, one reward type.
- Pneumomail должен чаще создавать actionable leads, not just ambient messages.

### 22.6 Нить "Квартирный Социальный Кризис"

Минимальная цепочка:

**shortage/riot rumor -> crowded social room -> help/steal/forge/expose/flee -> local uprising/relationship result.**

Что уже есть:

- ration queue, water riot, ammo smelter, illegal print room, barricade, communal kitchen feud, medicine swap, lost child, false/pustoy neighbor, Chernobozhiy svod;
- social pressure cadence and named NPC pack;
- documents, coupons and scarcity resources.

Что доработать:

- Квартиры должны давить количеством свидетелей и моральной неоднозначностью, а не только врагами.
- Кража/насилие в толпе должны давать rumor/relation consequences.
- Очередь, вода, медицина и печать должны конкурировать за время до самосбора.

### 22.7 Нить "Редкий Самосбор"

Минимальная цепочка:

**warning anomaly -> shelter choice -> variant-specific pressure -> aftermath item/mark/debt -> rumor/contract.**

Что уже есть:

- Maronary, Istotit, Veretar variants;
- modifiers, aftermath, director beats;
- variant items such as shaving/sand/photo and related rooms.

Что доработать:

- Rare variant должен быть узнаваем до активной фазы: звук, цвет, экран, NPC bark, map tint.
- Игрок должен иметь limited counterplay: другой shelter, закрыть дверь, бросить item, уйти через shortcut, не смотреть, не слушать.
- Aftermath должен создавать playable residue: контракт зачистки, редкий sample, долг, закрытый проход, слух о wrong door.

### 22.8 Нить "Пустотное Правило"

Минимальная цепочка:

**late-game rule warning -> impossible room/boss -> learn restriction -> exploit or obey -> final consequence.**

Что уже есть:

- Void plot chain, protocol chamber, borrowed light rule, trace seal protocol;
- Jean, Creator, spirits and new Void rule threats;
- portal/victory transition.

Что доработать:

- Каждый Void encounter должен иметь краткое правило: нельзя смотреть, нельзя повторять шаг, нельзя оставлять след, нельзя верить экрану, нельзя платить пустыми деньгами.
- Void QA gate сейчас зеленый; любой новый Void threat должен сохранять valid item refs, reachable route и readable death/rule reason.
- Late-game не должен быть просто сложнее; он должен требовать читать правила и нарушать их осознанно.

## 23. Route Audit Pack

Перед добавлением новой большой пачки контента нужен audit pack: не тест всех строк, а 10-15 ручных маршрутов, которые проверяют, что игра стала плотнее.

Минимальный набор маршрутов:

1. **Стартовая вылазка**: Act hall -> Sergeant Barinov -> Olga -> Yakov lead -> first weapon use -> return.
2. **Подготовка**: expedition prep -> купить/украсть воду/бинты/ammo -> взять system assignment.
3. **Living social POI**: один cellar/medical/social module -> контейнер или NPC decision -> слух/event.
4. **Желемыш**: zhelemish cellar/fake medpost -> raw/use/sell decision -> NPC reaction.
5. **НИИ sample**: scientist escort/sample site -> collect/deactivate/report -> reward/consequence.
6. **Ministry document route**: получить/подделать/украсть пропуск -> document gate -> audit risk.
7. **Kvartiry shortage route**: ration/water/medicine crisis -> crowd decision -> social pressure result.
8. **Maintenance pressure route**: pressure/steam/water route -> repair/reroute/fail -> industrial reward.
9. **Maintenance monster route**: one named industrial monster -> readable warning -> counterplay -> loot/hint.
10. **Procedural anomaly route**: one false safe/cold/mycelium/teleport floor -> anomaly counterplay -> exit.
11. **Numbered lift route**: normal target interrupted -> anomaly label -> return to intended target.
12. **Samosbor route**: warning -> shelter -> active phase -> aftermath visible on map/log/room.
13. **Rare samosbor route**: force Maronary/Istotit/Veretar -> variant-specific residue.
14. **Hell threshold**: high-threat combat room -> boss/cult rule -> reward or retreat.
15. **Void rule route**: protocol chamber/rule threat -> learn rule -> complete or die with readable reason.

Audit output should be compact:

- route id;
- command/debug setup if used;
- lead source;
- player decision;
- risk;
- reward/consequence;
- event ids observed;
- unreadable UI/text/combat issue;
- whether README facts need update.

Do not create a new `../gatbage/history/agent_logs` folder for this. Put durable route-audit conclusions into `desdoc.md` or a single compact appendix note after the pass.

## 24. Дизайн-Аудит 2026-05-18

Вердикт: игра уже имеет сильную системную идентичность и редкую для браузерного проекта плотность мира, но главный дизайн-риск теперь не в нехватке контента. Риск в том, что игрок видит много названий, комнат, терминалов, фракций и эффектов, но не всегда понимает следующий маршрут, цену решения и последствия возвращения.

Что работает:

- **Форма проекта цельная.** Single-file browser build, процедурные текстуры/спрайты/звук, WebGL raycasting и canvas HUD поддерживают ощущение самосборной машины без внешнего asset-pipeline.
- **Системы уже дают материал для survival ARPG.** Есть оружие, PSI, нужды, контейнеры, экономика, production, слухи, события, контракты, A-Life, самосбор, процедурные этажи и route floors.
- **HUD уже начал показывать роль оружия.** `hud.ts` и `stats_ui.ts` используют weapon readiness: роль, ресурс, cooldown, warning state. Дальше нужно не новое окно, а яснее связать это с ударом, промахом, звуком и death reason.
- **Карта не пустая.** `map_ui.ts` уже показывает NPC/quest/kill markers, лифты, самосборные warning/shelter overlays, wrong-door/cult cues. Следующий шаг - единый visual language для route intent, а не еще один слой иконок.
- **Контейнеры и производство стали player-facing.** `container_ui.ts` показывает доступ, theft risk и production output state; это правильная точка для экономики как выбора "купить, украсть, открыть, чинить, уйти".

Что мешает:

- **Первый час игры может распадаться на витрину.** Игроку нужен один жесткий start-to-return сценарий: цель, подготовка, лифт/маршрут, бой или сделка, самосборный сбой, возврат, итог.
- **Вертикаль масштабна, но не всегда намеренна.** `z=-50..+50`, 41 design floors и 54 procedural/fallback floors должны читаться как план вылазки: куда, почему, опасность, как вернуться.
- **Плотность `MAINTENANCE` выше читаемости.** 54 manifest entries нужно группировать в 4-6 промышленных маршрутов, иначе игрок запоминает отдельные страшные названия, а не планирует экспедицию.
- **Монстры и варианты рискуют стать "другой HP/speed".** Каждый часто встречающийся monster kind должен иметь cue -> rule -> counterplay -> rumor/death log.
- **Самосбор еще должен стать драмой маршрута.** Warning/shelter/active/aftermath уже есть как rails; дизайн-победа будет тогда, когда игрок меняет план из-за самосбора и видит последствия после отбоя.
- **События должны оставлять след.** `systems/events.ts` важен, но игроку нужны marks, moved loot, scared NPC, changed price, blocked route, rumor or faction reaction.

Design principles for the next pass:

1. One screen of information beats three overlapping panels.
2. Every route needs a before/after: lead before departure, consequence after return.
3. Every new noun needs at least one use, price, risk, theft path, contract target or rumor.
4. Visual language is scarce: reuse map/HUD/log channels before inventing another overlay.
5. Horror comes from pressure collision: shortage during siren, audit during return, cult mark near shelter, wrong door after theft.

## 25. Текущий Design Debt

Design debt here means: the code can contain the feature, but the player cannot yet read its value.

### 25.1 QA Debt

- `content-audit` is currently green; keep it green after every content wave.
- Unit gate must stay green too: the 2026-05-19 cult-procession blocker was a useful reminder that green registry data is not the same as playable encounter semantics.
- Zone metadata now matters as a design surface, not only a QA field: maps, logs and route audit depend on names.
- README counters align with the latest release-gate audit; keep updating README only after the code behavior is verified, not just because counters changed.

### 25.2 Readability Debt

- Many POI names are strong, but the player still needs leads that point to them.
- Monster variants can be numerous, but each must expose a behavior cue: sound, sprite, projectile, room mark, rumor or death log.
- Weapon stats exist, but roles must be visible through HUD/ammo/cooldown and enemy reaction.

### 25.3 Route Debt

- `FloorRun` has scale, but route intent must be visible before and after lift travel.
- Procedural floors need stronger tags in contracts and rumors.
- Maintenance has high module density; it needs route grouping so the player can plan an industrial expedition.

### 25.4 Consequence Debt

- Events exist, but many actions still need visible residue: loot moved, door marked, NPC afraid, faction angry, price changed, rumor spawned.
- Container theft should connect to witness/audit/reputation more often.
- Production outputs should become reasons to visit, guard, steal or repair rooms.

### 25.5 Tone Debt

- Самосборная folklore works only when converted into survival decisions.
- Meme-derived content must stay bounded: rumor, item, side POI, rare variant, or ugly economy pressure.
- Horror tone should come from systems colliding: shortage during siren, wrong door after theft, cult mark near a shelter, document audit during a return trip.

## 26. Milestones После 4.4

### M0: Route Audit Baseline

Scope:

- keep `content-audit` green;
- run typecheck and targeted tests for any touched code;
- document one route audit result for each base floor;
- record where the player receives lead, makes a decision and sees consequence.

Exit:

- no audit Errors;
- no unimported modules;
- six base-floor route notes exist;
- no new design promise without reachable path.

### M1: One Complete Expedition Slice

Scope:

- pick one start-to-return slice that touches Living prep, one contract, one procedural/design floor, one fight, one container, one samosbor warning and one return reward;
- improve only the missing links for that slice.

Exit:

- player can run the slice without knowing source code;
- map/quest/log/HUD explain enough;
- one smoke/debug path can force it.

### M2: Combat And Monster Readability

Scope:

- weapon roles;
- ammo/cooldown HUD;
- projectile/impact feedback;
- 10 most common monster counterplay cues;
- one pass over new named monster POI.

Exit:

- death/combat mistakes are understandable;
- starter weapons remain useful but scarce;
- monster ecology rumors point to real behavior.

### M3: Samosbor As Expedition Drama

Scope:

- warning/shelter/active/aftermath clarity;
- one rare variant smoke/debug path;
- aftermath residue tied to events, rumors, containers or contracts.

Exit:

- samosbor changes the route after it ends;
- smart sheltering matters;
- rare variants are recognizable and bounded.

### M4: Economy And A-Life Consequences

Scope:

- container ownership witness/audit;
- production output routes;
- faction event residue;
- rumor-to-place chains;
- scarcity reward tuning.

Exit:

- stealing, repairing, trading and reporting produce different aftereffects;
- NPCs and rumors carry useful facts;
- economy pressure changes route choice without softlocking the player.

### M5: Documentation Sync

Scope:

- update README factual counters and shipped behavior;
- keep `architecture.md` only for changed engineering contracts;
- keep `desdoc.md` as planning/design snapshot, not as changelog dump.

Exit:

- README, architecture and desdoc disagree only where they intentionally have different roles.
- New agents can start from `README.md`, `desdoc.md`, `architecture.md`, root system docs and current `src/`. Open `../gatbage/` only for task-specific appendix references, without reopening archived AGXX logs by default.

## 27. План Развития 4.4 -> 4.5

Это порядок работы, а не отдельный список желаний. Каждый шаг должен давать playable proof через маршрут, debug path или smoke/test.

### Wave A: Prove One Expedition

Build one complete route from start to return:

**Living prep -> assignment/rumor -> lift target -> fight/steal/repair choice -> container/reward -> samosbor warning -> return consequence.**

Работать только с missing links этой цепочки. Не расширять весь проект, пока один такой сценарий не проходит без знания исходников.

### Wave B: Make Combat Readable

- Уточнить HUD ammo/cooldown/weapon role where needed, using existing `hud.ts`/`stats_ui.ts`.
- Добавить projectile/impact/sound cues only where death or miss reason is currently unclear.
- Проверить 10 common monster encounters against rule/counterplay/rumor/death-log.

### Wave C: Make Routes Legible

- Lift/map/quest language must show `z`, route id, danger and return path for design/procedural floors.
- Contracts should target procedural tags where useful: workshop, smog, mycelium, cold, cult, production.
- Maintenance content should be grouped into pressure, water, lift, slime, production and mail routes.

### Wave D: Make Consequences Stick

- Container theft needs witness/audit/reputation consequences in more POI.
- Production outputs should create visit/guard/steal/repair reasons.
- Faction and samosbor events should leave visible residue: marks, loot, blocked door, moved NPC, changed price or rumor.

### Wave E: Sync Docs After Proof

- Update README only for behavior that exists and was checked.
- Keep `architecture.md` for layer/integration rules, not feature planning.
- Keep this `desdoc.md` short enough to steer work; move only durable historical notes to `../gatbage/history/root_notes/appendix.md`.
