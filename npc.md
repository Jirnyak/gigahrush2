# NPC анкеты и переход на пакетную систему

> Роль: активный документ NPC questionnaire/package system. Описывает, как пользовательская анкета превращается в `NpcPackageDef`, какие авторские категории допустимы, как это связано с A-Life, plot NPC, design floors и процедурным населением, и какие старые пути кода еще нужно перевести.

## Главная модель

NPC анкета описывает человека как пакет данных, а не live entity. Пакет должен отвечать на вопросы:

- кто этот человек;
- какое у него игровое имя;
- где его домашний route key;
- какая у него фракция, occupation, демография, деньги, речь, связи, визуальный seed;
- является ли он сюжетным контрактом, ручным персонажем этажа или обычным процедурным жителем;
- как его можно безопасно зарезервировать в A-Life или оставить event-only.

Runtime `Entity.id`, pathfinding, cooldowns, текущие координаты, combat target, needs timers and other live state в анкету не входят. Они появляются только после материализации на активном этаже.

## Имя без ФИО

Анкета хранит минимальное игровое имя как `identity.displayName`. Если в игре персонаж называется `Ира Сцена`, `Доктор Сима`, `Ольга Дмитриевна`, `Ванька Банчиный` или просто одним именем, форма должна показывать и экспортировать ровно это имя. Фамилия и отчество не являются обязательными авторскими полями и не должны появляться в UI как отдельная структура.

Старые поля `firstName`, `lastName` and `patronymic` остаются только compatibility input для существующих пакетов и старых черновиков. Новый intake export пишет `displayName`; game-side normalizer может заполнить старое `firstName` internally, если конкретному коду ещё нужен этот fallback.

## Три author-facing kind

Форма и schema оставляют только три значения `kind`: `plot`, `design`, `procedural`.

`plot` стоит оставить отдельно. Это не просто "ручной NPC", а контракт с сюжетом: stable `plotNpcId`, locked dialogue/quest text, plot death, plot gates, exact rewards or consequences. Если такой NPC умрет или пропадет, это должно стать сюжетным фактом, а не обычной заменой жителя.

`design` нужен для ручного персонажа этажа или сцены без обязательного main plot контракта. Это работник конкретного authored route floor, торговец, свидетель, очередь, охрана, side-content NPC, room anchor. Он может жить на story или design route key, иметь точную сцену, комнату, фразы, trade/content hooks, но не обязан быть главным plot step.

`procedural` нужен для именованного обычного человека внутри A-Life. У него есть occupation, faction, homeFloorKey, tags, speech and visual identity, но он должен материализоваться через обычные population slots или cold migration rules. Пример: работница этажа 69 с собственной occupation/role tags по смыслу является procedural, если она не держит ручную сцену или locked plot gate.

`authored`, `ordinary_named`, `event_reserved` не должны быть пунктами формы. `authored` - слишком общий внутренний источник, `ordinary_named` дублирует `procedural`, а `event_reserved` отвечает не на вопрос "кто это", а на вопрос "можно ли этому человеку занимать ordinary population slot".

## Placement не равен kind

`placement.presence` и `placement.mobility` остаются техническими полями:

- `population`: может занять ordinary A-Life slot;
- `anchor`: ручной якорь или заметный персонаж;
- `room_content`: часть POI/room content;
- `event_only`: не занимает обычную популяцию, появляется только через событие;
- `fixed_home`, `cold_movable`, `caravan_allowed`, `event_locked`: как запись двигается между route keys.

Эти поля нельзя смешивать с `kind`. `plot/design/procedural` описывают авторский смысл анкеты; `presence/mobility` описывают способ подключения к A-Life/runtime.

## Этажи в анкете

`homeFloorKey` должен показываться как route stop, а не как отдельная "story feature". UI обязан сначала показывать фиксированные story/design route stops в z-порядке сверху вниз, затем procedural fallback stops в z-порядке. Внутренний ключ сохраняется точным (`story:living`, `design:floor_69`, `procedural:z17`), потому что save, A-Life, floor memory and debug paths общаются через route keys.

Story floors остаются шестью `FloorLevel` base/story anchors в коде, но пользователь формы выбирает не enum-тип этажа, а место маршрута.

## Текущий intake подпроект

`gigahrush-npc-intake/` - самостоятельный dependency-free сайт формы. Он:

- берет lookup hints из текущего game source через `scripts/sync-lookups.mjs`;
- строит готовые игровые шаблоны из реального `allNpcPackages()` после импорта design/story content modules, а не только из main plot packages;
- валидирует пользовательскую анкету в браузере;
- нормализует sprite в `gigahrush_sprite_rle_v1`;
- показывает Demos preview;
- экспортирует ZIP для ручного review;
- показывает готовые игровые анкеты и по клику заполняет форму как шаблон с `sourceFile:line` из игрового кода.

Готовые шаблоны покрывают package-backed NPC: main plot, story side content, authored design-floor side NPC and registered authored NPC. Перед экспортом пользователь должен менять `id` и факты, чтобы не предложить конфликтующий дубль существующего NPC.

## Occupation, роль и routine

`Occupation` - главный кодовый слой A-Life/economy/AI routine для обычного NPC. Это профессия в системном смысле: она задает базовую рабочую комнату, полезные room affordances, routine weights, trade/economy hooks, Demos profile, speech/barks, factory eligibility, loadout flavor and default visual family. Если у NPC occupation `DOCTOR`, он должен естественно тянуться к медпункту и медконтексту; `COOK` - к кухне и еде; `MECHANIC`/`ELECTRICIAN`/`LOCKSMITH` - к производственным/ремонтным комнатам; `SECRETARY`/`DIRECTOR` - к офису/журналам; `STOREKEEPER` - к складу и торговле.

Анкета выбирает только существующий occupation. Пользовательская анкета не добавляет новый occupation, потому что новая профессия требует кода и профиля во всех системах, где occupation влияет на мир: A-Life generation, active-floor AI, needs, economy, Demos, dialogue, factories, crafting lessons, save/schema and debug. Если новая профессия нужна не одному персонажу, а всему миру, ее добавляет разработчик как systems-level change.

Floor-specific роль должна жить ниже occupation:

- `affiliation.roleId`;
- `roleTags`, `bio.work`, speech tags;
- `visual.npcVisualId`;
- placement/floor context.

Роль уточняет сцену, но не заменяет профессию. Работница конкретного этажа может быть `SECRETARY`, `TRAVELER` or `STOREKEEPER` по occupation, а `floor_69_worker` по role/profile. Охранник может быть `HUNTER` по occupation и `f69_queue_guard` по role. Так A-Life остается универсальной: профессия управляет базовой рутиной, а локальный floor package добавляет контекст.

Special A-Life допустим для plot/design NPC, но только как явный override поверх occupation. Пример: Ольга может иметь tutorial lock или scripted routine, майор Громный - scripted arrival and command state, охрана - duty state. При этом у каждого из них все равно есть occupation как fallback: если special rule не активен или закончился, NPC возвращается к обычной occupation-driven жизни. Анкета должна хранить такой режим как package/content rule (`roleAiId`, quest state, lock/expiry, escort/duty profile), а не как новый occupation и не как hardcoded check по имени в generic AI.

Работницы этажа 69 сейчас устроены именно так. Генератор `src/gen/design_floors/floor_69.ts` сначала создает ordinary ambient visitors через population profile. Затем `applyFloor69AmbientSpriteTemplates()` выбирает часть взрослых посетительниц с occupations `TRAVELER`, `HOUSEWIFE`, `SECRETARY`, `STOREKEEPER`, `DIRECTOR`, переименовывает `Этаж 69: посетитель ...` в `Этаж 69: работница ...`, ставит `npcVisualId: floor_69_female` and special sprite slot. Это procedural ambient роль этажа, а не отдельный package-backed design NPC и не пользовательский occupation.

## Переходный план

Текущая цель - чтобы все именованные NPC шли через пакетный слой, а старые live-spawn пути оставались только совместимостью до перевода конкретного content module.

1. Перевести оставшиеся ручные plot/side/design NPC из локальных `PlotNpcDef` + ручной spawn в `NpcPackageDef` или в package projection helper.
2. Для каждого package-backed NPC резервировать A-Life identity через `npc:<packageId>` и сохранять `plotNpcId` только как сюжетный compatibility key.
3. Расширять готовые шаблоны intake только через реальные package/registry источники. Не добавлять мертвые UI-only анкеты без игрового source path.
4. Уточнить occupation/role model. Новый occupation нельзя добавлять ради одной анкеты, но текущий закрытый enum слишком узок для некоторых floor-specific roles. До расширения использовать `roleId`, role tags, work text and `npcVisualId`.
5. Не допускать live entity ids, coordinates, per-frame AI state or renderer-only data в анкету.
6. Accepted community packages должны проходить game-side schema validation before commit/import, даже если hosted intake уже принял ZIP.

## Известные разрывы

- Внутренний A-Life reserved kind все еще использует `plot | authored | event_reserved`. Это не author-facing `NpcPackageKind`; позднее стоит переименовать или изолировать тип, чтобы `authored` не возвращался в форму.
- Некоторые authored plot NPC generators still spawn live `plotNpcId` actors directly instead of materializing from reserved package-backed A-Life records.
- `npcPackageLookupHints()` в game-side schema пока возвращает только `floorKeys`, без label/group metadata для формы. Intake держит расширенный `floorOptions` в своем generated lookup.
- Готовые анкеты intake покрывают package-backed NPC из registry, но не покрывают ambient generator-only procedural archetypes вроде безымянных посетителей/работниц этажа 69. Для таких ролей нужен отдельный code-level role/profile layer, а не фиктивная анкета.
- `Occupation` остается закрытым enum. Floor-specific jobs вроде "работница этажа 69" приходится выражать через existing occupation + role tags, пока не появится data-driven role layer.
