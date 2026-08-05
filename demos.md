# Инфосеть Демос

> Системный дизайн-документ активной социальной A-Life системы.
>
> Роль: описывает, как фактически устроена `Инфосеть Демос` в текущем коде: A-Life профили, связи, друзья/враги, посты, реакции, квестовые заявки, холодные социальные события, social-journey requests и границы зарезервированных extension points. Это активный системный том наряду с `README.md`, `architecture.md`, `alife.md` и `korovan.md`; он фиксирует shipped behavior и проверяемые инженерные контракты, а не отдельное batch-задание.

Связанный системный документ: [markov.md](markov.md) описывает шаблонно-марковскую генерацию коротких NPC-реплик, постов и реакций из Demos/A-Life/gameplay context.

## Назначение

`Инфосеть Демос` делает фиксированную A-Life популяцию видимой как общество, а не как список записей.

Цель - эмерджентная социальная поверхность:

- у NPC есть ограниченный круг знакомств;
- у связи есть отношение, как у NPC к игроку;
- страница NPC показывает друзей, врагов, близких и следы событий;
- NPC иногда пишут посты из реального игрового контекста;
- другие NPC реагируют на эти посты через свои отношения, фракцию, работу, страх, долг, семью и текущие события;
- социальные факты могут превращаться в холодную миграцию, визит, встречу, просьбу, долг, торговлю или конфликт только через owner systems.

Главное ограничение: это не скрытый Sims на `100_000` акторов. Активный этаж остаётся честной live-симуляцией. Off-floor Демос работает как компактная A-Life социальная память и медленный директор событий.

## Текущие Shipped Facts

Текущие shipped facts, на которые опирается система:

- A-Life создаёт фиксированные `100_000` NPC records на каждый run.
- Только активный этаж материализуется в `entities`.
- Off-floor NPC не pathfind-ят, не дерутся, не тикают needs и не сканируют комнаты.
- Холодное движение уже выражено через bounded migration/caravan/scripted arrival paths.
- Существующий `Инфосеть Демос` - tabbed A-Life NPC surface: поиск/курсор, профиль, связи, лента, отдельный пост и квестовые заявки. UI state (`demosCursor`, `demosSearch`, `demosTab`, scroll/cursor) transient; социальная память хранится отдельно.
- Текущий shipped feed persistent: `systems/demos_runtime.ts` регистрирует slow `ContentRuntimeHook` с 30-секундной cadence, читает bounded recent `WorldEvent` slice и bounded текущие A-Life snapshots, создаёт compact posts/reactions через `demos_save.ts`, создаёт runtime quest notices через `demos_quest_notices.ts`, строит post view через `systems/demos_posts.ts` и Markov speech router, а `render/demos_ui.ts` только рисует готовые строки.
- Save shape bumped to `21`; `demosSocial` stores relation overrides, post ring and reaction ring, while generated computer and NET-hack terminal reward/cooldown keys persist as compact route-keyed runtime facts. Demos quest notices remain runtime state outside the save section unless they are represented by posts/relation facts; accepting a notice still happens only through face-to-face NPC talk and normal quest/contract systems.
- `systems/npc_relations.ts` задаёт gameplay-семантику отношения NPC к игроку как `[-100, 100]`, а Demos показывает и мутирует это отношение через тот же public social slot, что и остальные связи.
- `HOSTILE_RELATION_THRESHOLD = -50`, `FRIENDLY_RELATION_THRESHOLD = 50`.
- `karma` теперь использует signed-char совместимый диапазон `[-127, 127]`.
- Faction relation matrix хранится в `Int8Array` и фактически допускает `[-128, 127]`, но player relation намеренно клампится в `[-100, 100]`.
- Demos social edge хранится компактно: один signed byte на отношение, без `number[]`, объектов и JSON-графа для базового графа. Slot `0` в каждой строке зарезервирован под directed edge `NPC -> player`, slots `1..9` - под `NPC -> NPC`.
- Активный floor actor soft cap остаётся около `4096` NPC+monster actors.
- `WorldEvent` уже даёт bounded ring buffers и public/local/witnessed/private/secret privacy.

Вывод по числам: социальное отношение NPC-NPC должно быть `char`-масштабом, то есть `Int8Array` с игровым диапазоном `[-127, 127]`. Значение `-128` лучше держать зарезервированным sentinel для "нет/сломано/неинициализировано", даже если пустой slot обычно выражается `targetId = 0`. Это не даёт больше памяти, чем `[-100, 100]`, но использует весь полезный signed-byte диапазон и оставляет систему честно byte-sized.

Фактические контрактные константы:

```txt
DEMOS_RELATION_EMPTY = -128
DEMOS_RELATION_MIN = -127
DEMOS_RELATION_MAX = 127
DEMOS_RELATION_HOSTILE_THRESHOLD = -64
DEMOS_RELATION_FRIENDLY_THRESHOLD = 64
```

При сравнении с отношением к игроку можно использовать scaled view:

```txt
playerScale = round(demosRelation * 100 / 127)
```

Но хранить NPC-NPC edge надо именно как один signed byte, без пересчёта в `[-100, 100]` на storage path.

## Что Это Значит В Игре

Диапазон сам по себе не экономит память, если значение лежит как обычный JS `number` на объекте. Экономия появляется только когда runtime storage действительно typed-array:

```txt
targets: Uint32Array   // npcCount * slots
relations: Int8Array   // npcCount * slots
flags: Uint8Array      // npcCount * slots
```

То есть Demos social graph не должен быть:

- `Array<{ targetId, relation, flags }>`;
- `Map<alifeId, Edge[]>`;
- вложенным JSON-графом;
- полем `friends: [...]` внутри каждого A-Life object record.

Он должен быть отдельным compact pack, например:

```txt
edgeIndex = (alifeId - 1) * DEMOS_SOCIAL_PUBLIC_SLOTS + slot
targetId = targets[edgeIndex]
relation = relations[edgeIndex] // signed char -127..127, -128 sentinel
flags = flags[edgeIndex]
```

UI и AI могут получать обычный `number` из helper API, но источник должен оставаться `Int8Array`. Иначе `-127..127` будет только красивым диапазоном, а не оптимизацией.

Existing `playerRelation` к игроку остаётся текущим `[-100, 100]` semantic field, но в Demos graph он проецируется в signed-byte edge slot `0` через scale `round(playerRelation * 127 / 100)`. Demos deltas к player-slot записывают sparse social override и синхронизируют A-Life `playerRelation`, чтобы будущая материализация и AI hostility видели тот же факт. Для live `Entity` на активном этаже обычные JS numbers остаются нормальными: это не `100_000` cold storage problem.

Demos profile and context read age/sex only through `getAlifeNpcRecordSnapshot()`. The profile row shows age, age band and sex label; social adult buckets use `age >= 18`; Markov/social quest adapters receive `age.*` and `sex.*` context tags before ordinary trait tags.

Текущий A-Life core уже держит массовые числовые поля columnar: base floor, danger, faction, occupation, age, sex code, flags, RPG bytes, HP, money/account, family id, sprite/spriteSeed, kill counters, `playerRelation` and `karma`. Поэтому Demos social graph не должен добавлять новые number fields в A-Life record objects; он должен продолжать эту колонковую модель отдельным graph pack.

Текущая форма A-Life core и Demos social storage contract:

```txt
ids: implicit index 1..npcCount
floorKeyIndex: Uint16Array or Uint32Array
floor/danger: Uint8Array
faction: Uint8Array
occupation: Uint8Array
age: Uint8Array                    // 1..100
sex: Uint8Array                    // 0 unset, 1 male, 2 female
level: Uint8Array
str/agi/int: Uint8Array
hp/maxHp: Uint16Array
familyId: Uint32Array
sprite/spriteSeed: Uint16Array/Uint32Array
kills/npcKills/monsterKills: Uint32Array
playerRelation: Int8Array
karma: Int8Array                 // -127..127
flags: Uint16Array or Uint32Array
x/y: Uint16Array                 // 0..1023, sentinel for unknown
angle: Int16Array                // quantized
money/accountRubles: Int32Array
```

Strings, inventories, special sprites, plot ids and changed rare facts stay interned/sparse:

- names from deterministic seed plus sparse override/string table;
- default loadout generated lazily; inventories only for touched/custom records;
- plot/reserved ids in side maps;
- floor keys interned to numeric route ids;
- social graph in separate typed arrays;
- save stores seed plus sparse overrides, not raw column dumps unless that becomes smaller and sanitized.

Такой переход уже начат в A-Life core: helpers вроде `getAlifeNpcRecordSnapshot()` остаются наружной view-моделью, а внутренняя память становится columnar. Demos должен использовать этот boundary API и собственные typed graph arrays, а не зависеть от object shape полного persistent record.

## Не Цели

Не делать:

- полный граф `100_000 x 100_000`;
- массивы друзей произвольной длины на каждом record;
- hidden simulation всех floors;
- off-floor pathfinding, combat, needs ticking или room scans;
- per-frame scan всего A-Life пула;
- DOM-соцсеть;
- отдельную Demos identity database;
- телепортацию NPC "по приглашению";
- бесконечную ленту постов;
- постоянное сохранение каждого бытового сообщения;
- hardcoded имена, floor ids или сюжетные исключения в generic Demos runtime.

Демос должен читать и мутировать компактные факты A-Life, events, quests, economy, migration и faction systems. Он не должен становиться параллельной игрой.

## Базовая Модель

Система делится на четыре слоя.

1. `A-Life identity`

   Владеет тем, кто существует: `alifeId`, `floorKey`, faction, occupation, familyId, level, HP, money, quest affordance, death state, folded visuals, playerRelation, karma.

2. `Demos social graph`

   Компактный directed graph поверх A-Life ids. Он отвечает, кого NPC знает и как к нему относится.

3. `Demos event/feed layer`

   Короткая лента постов, реакций и сообщений, построенная из реальных игровых событий и bounded cold director pass.

4. `Demos UI`

   Canvas view: профиль, связи, лента, пост, квестовые заявки и reserved action surfaces. UI читает view models, не владеет решениями.

Идентификаторы остаются теми же:

- `alife:<id>` - основной id NPC;
- `plot:<plotNpcId>` - временная совместимость там, где authored actor ещё не привязан к reserved A-Life record;
- `post:<id>` - id поста внутри run/save Demos feed;
- reserved `thread:<id>` - bounded private message thread, если этот extension point будет реализован owner systems.

## Социальные Рёбра

### Сколько Связей На NPC

Текущий рабочий бюджет:

```txt
DEMOS_SOCIAL_PLAYER_SLOT = 0
DEMOS_SOCIAL_NPC_SLOT_START = 1
DEMOS_SOCIAL_NPC_SLOTS = 9
DEMOS_SOCIAL_INITIAL_NPC_SLOTS = 4
DEMOS_SOCIAL_PUBLIC_SLOTS = 10 // player slot + 9 NPC slots
```

Почему 9:

- стартовый процедурный круг обычно даёт до `5` public relations: player-slot плюс до `4` NPC slots;
- оставшиеся NPC slots свободны для событийного роста круга до `10` public relations total;
- 9 NPC slots дают место для 2-4 друга/родственника, 1-2 недруга, рабочих/долговых связей и новых weak ties без расширения storage;
- на `100_000` NPC это уже `900_000` directed edges;
- один NPC может иметь больше входящих связей, даже если его собственный список ограничен;
- этого достаточно для local propagation, постов, реакций, слухов и визитов без раздувания памяти.

Базовый storage edge:

```txt
targetId: Uint32Array  // 4 bytes, 0 means empty
relation: Int8Array    // 1 byte, clamped -127..127; -128 reserved
flags: Uint8Array      // 1 byte bitset
roles: Uint8Array      // 1 byte DemosSocialRoleId
```

Память:

| Slots per NPC | Directed edges | Base bytes | Approx |
| ---: | ---: | ---: | ---: |
| 4 | 400,000 | 2,800,000 | 2.8 MB |
| 6 | 600,000 | 4,200,000 | 4.2 MB |
| 9 | 900,000 | 6,300,000 | 6.3 MB |
| 10 public | 1,000,000 | 7,000,000 | 7.0 MB |
| 12 | 1,200,000 | 8,400,000 | 8.4 MB |

Текущий shipped path держит 9 NPC slots и 1 player slot; raw typed-array budget для `100_000` записей остаётся ниже `7 MiB` binary threshold в тесте (`7,000,000 < 7 * 1024 * 1024`). Увеличивать бюджет можно только после проверки heap/build/browser smoke.

Не хранить в базовом edge:

- строки;
- историю сообщений;
- last seen текст;
- массив общих друзей;
- ссылку на объект record;
- timestamps для каждого edge.

Если нужен touched state, хранить sparse overrides по изменённым edge, а не расширять все `1_000_000` public slots дополнительными полями.

### Направленность

Связь directed:

```txt
A -> B может быть +70
B -> A может быть +20 или -10
```

Это важно для драматургии: кто-то считает человека другом, а тот считает его должником, конкурентом или раздражающим соседом.

Для близкой семьи и сильной дружбы генератор может пытаться сделать reciprocal edge, но это не инвариант. Если у второй стороны нет свободного slot, связь остаётся односторонней.

### Flags

Первый bitset:

```txt
1 << 0 FAMILY
1 << 1 FRIEND
1 << 2 ENEMY
1 << 3 WORK
1 << 4 FACTION
1 << 5 DEBT
1 << 6 QUEST
1 << 7 HIDDEN
```

Flags не заменяют relation score. Они объясняют происхождение связи и помогают выбирать посты/реакции/визиты.

Примеры:

- `FAMILY + FRIEND`, relation `80`;
- `WORK`, relation `15`;
- `FACTION + FRIEND`, relation `55`;
- `DEBT`, relation `-35`;
- `ENEMY`, relation `-70`;
- `HIDDEN + QUEST`, relation `20`, если связь спойлерная и UI пока не должен её показывать.

### Relation Scale

NPC-NPC relation:

| Score | Meaning |
| ---: | --- |
| `<= -96` | ненависть |
| `<= -64` | враг |
| `<= -32` | недруг |
| `< 0` | холодно |
| `< 32` | нейтрально |
| `< 64` | знакомый / приятель |
| `< 96` | друг |
| `>= 96` | близкий / любовь |

Пороги масштабируют текущие Demos profile bands на signed-byte relation scale. Для gameplay hostility/friendly решений Demos-edge использует `-64` и `64`, а UI может показывать raw char score или scaled `[-100, 100]` подпись.

### Производное Изменение Отношений

Все gameplay/social изменения отношения проходят через `applyDemosRelationDelta()`. Mutator меняет directed edge `from -> target`, пишет sparse override в `demosSocial.relationOverrides`, а для `targetKind: 'player'` также синхронизирует A-Life `playerRelation`.

После прямого изменения mutator делает bounded propagation по исходящему кругу `from`:

```txt
derivedDelta = round(sourceDelta * circleRelation / 127)
```

Это одна формула для друзей и врагов:

- если `circleRelation = +127`, друг получает полный delta с тем же знаком;
- если `circleRelation = -127`, враг получает полный delta с обратным знаком;
- если `circleRelation = 0`, эффекта нет;
- слабые связи дают пропорционально слабый эффект.

Пример: игрок ударил NPC, и edge `NPC -> player` уменьшился на `N`. Каждый живой друг этого NPC получает `-N` к edge `friend -> player` при максимальной дружбе, а максимальный враг получает `+N`. Если target был NPC, создаётся или обновляется edge `friend/enemy -> targetNpcId`. Производные связи создаются только в свободные NPC slots; propagation не вытесняет существующие связи и не каскадирует дальше в том же mutator call.

## Генерация Графа

Граф создаётся при создании A-Life pool или лениво как deterministic graph pack из seed. Он не должен требовать сохранения всех базовых edges.

Входы:

- run seed;
- `alifeId`;
- `floorKey`;
- `familyId`;
- faction;
- occupation;
- level;
- wealth band;
- `canGiveQuest`;
- route z/danger/tags when cheaply available;
- reserved/plot identity marker.

Нельзя строить граф через сравнение всех пар NPC.

Допустимый алгоритм:

1. Подготовить lightweight indexes уже из существующего A-Life планирования:
   - `floorIndex[floorKey]`;
   - optional family group index;
   - optional faction bucket cursors;
   - optional occupation bucket cursors.
2. Для каждого record заполнить player slot и до `DEMOS_SOCIAL_INITIAL_NPC_SLOTS` NPC slots через deterministic candidate probes; остальные public slots остаются для событийного роста.
3. На каждый slot дать не больше `DEMOS_SOCIAL_CANDIDATE_TRIES`, например `24`.
4. Candidate source зависит от slot type:
   - family candidate from same `familyId`;
   - same-floor neighbor from `floorIndex`;
   - same occupation/faction contact;
   - cross-floor acquaintance near route z;
   - rival from hostile faction relation or conflicting occupation/economy tag;
   - quest/public figure candidate for high-rank/quest-capable NPC.
5. Skip self, dead-only reserved holes, duplicates and NPC-forbidden route identities.
6. Если подходящего target нет, оставить `targetId = 0`.

Base relation формируется без hardcoded names:

```txt
relation =
  factionPairBias
  + family/friend/work/debt/rival role bias
  + sameFloorBias
  + occupationBias
  + deterministic jitter
  + optional karma/level/wealth pressure
```

Значение клампится в `[-127, 127]`; `-128` не выдаётся обычной генерацией.

Вражда не должна быть только "фракция против фракции". Внутри одной фракции тоже нужны:

- долг;
- очередь/ресурс;
- конкуренция за работу;
- семейная ссора;
- слух;
- украденный предмет;
- старый конфликт из faction/economy event.

Но на первой генерации это только seed-driven background. Настоящие изменения должны приходить из событий.

## Sparse Overrides

Базовый graph детерминирован от seed и A-Life population version. Persistent changes хранятся отдельно.

Минимальный override:

```ts
interface DemosRelationOverride {
  fromAlifeId: number;
  targetKind: 'alife' | 'player';
  targetAlifeId?: number;  // only for targetKind: 'alife'
  value: number;           // clamped -127..127, -128 reserved
  updatedAt?: number;      // game time, optional
  reasonTag?: string;      // capped, optional
  postId?: number;
  reactionId?: number;
}
```

Cap первого persistent среза:

```txt
DEMOS_RELATION_OVERRIDE_CAP = 8192
```

8192 достаточно для заметных player/event/social consequences и не превращает save в полный граф.

Правила:

- прямой override может создать missing directed edge; производный propagation создаёт edge только в свободный NPC slot;
- player override всегда живёт в slot `0` и не вытесняет NPC slots;
- direct mutator может заменить weakest slot только для прямого изменения, если вызвавший код это не запретил;
- dead NPC связи остаются видимыми в профиле, но не выбираются для новых визитов/реакций как живые actors;
- overrides уже persistent в `demosSocial`, bounded и sanitized.

## Demos Posts

Пост - компактный публичный или полупубличный след события, а не произвольный текстовый роман.

Минимальный post record:

```ts
interface DemosPost {
  id: number;
  authorAlifeId: number;
  createdAt: number;
  floorKey?: string;
  sourceEventId?: number;
  templateId: string;
  args: readonly string[];
  privacy: 'public' | 'local' | 'friends' | 'faction' | 'private';
  tags: readonly string[];
  score: number;
}
```

`args` capped, strings short. Текст собирается через templates и Markov router adapters, а не хранится как длинный произвольный blob на каждом NPC.

Текущий feed/storage budget:

```txt
DEMOS_POST_RING_CAP = 48              // transient/view queue
DEMOS_PERSISTENT_POST_CAP = 512
DEMOS_PERSISTENT_REACTION_CAP = 2048
DEMOS_POSTS_PER_TICK_CAP = 4
DEMOS_REACTIONS_PER_POST_CAP = 4
```

512 постов - достаточно для свежей инфосети и поиска recent stories. Более старые факты остаются в A-Life, events, floor memory, quests, deaths and rank, а не в бесконечной ленте.

### Источники Постов

Посты должны рождаться из реального context:

- смерть NPC;
- ранение или спасение;
- samosbor warning/aftermath;
- migration arrival/departure;
- caravan start/arrival/loss;
- shortage или production event;
- quest issued/completed/failed;
- faction territory change;
- theft/witnessed crime;
- shelter denial/help;
- high rank change;
- active-floor need crisis, если NPC реально materialized and affected.

Нельзя:

- писать посты просто потому, что таймер сказал "NPC надо что-то написать";
- генерировать 100k бытовых постов за проход;
- использовать off-floor needs как источник, пока off-floor needs не существует;
- грузить inactive floors для контекста.

Правильная форма:

```txt
WorldEvent / AI local fact / migration summary
  -> Demos post candidate
  -> author selection
  -> privacy/tags
  -> compact template args
  -> ring push
```

Если события нет, поста нет. Исключение - редкий cold social flavor post, но даже он должен ссылаться на compact fact: работа, долг, маршрут, очередь, shortage, relation edge, quest affordance.

### Text Discipline

Посты должны звучать как внутренняя бытовая сеть дома:

- коротко;
- предметно;
- с этажом, очередью, пайкой, долгом, дверью, сменой, водой, талоном, медпунктом или маршрутом;
- без абстрактной поэзии;
- без раскрытия закрытых route/endgame facts;
- без объяснения технической геометрии мира игроку.

Пример направления:

```txt
Плохо: "Бетон помнит страх соседа."
Хорошо: "Кто видел Петра с ремонтного коридора? Не вышел после сирены, долг за чайник остался."
```

Для реализации templates должны жить в data file, например `src/data/demos_posts.ts`, а не в UI/render.

## Reactions

Reaction - короткий ответ NPC на пост.

```ts
interface DemosReaction {
  postId: number;
  reactorAlifeId: number;
  createdAt: number;
  kind: 'like' | 'dislike' | 'fear' | 'anger' | 'grief' | 'joke' | 'help' | 'threat' | 'rumor';
  relationDelta?: number;
  flags?: number;
}
```

Выбор reactors:

- first pass: social edges автора, максимум `DEMOS_REACTIONS_PER_POST_CAP`;
- if privacy `faction`: same faction candidates from bounded slice;
- if privacy `local`: active floor witnesses or records on same `floorKey`, bounded;
- if death/shelter/family event: family/friend edges first;
- if enemy/rival event: enemy edges can react with anger, joke, threat or rumor.

Relation effects:

- positive reaction can add `+1..+4` to directed relation;
- threat/mockery can add `-1..-6`;
- death of friend can worsen relation to killer if killer identity is known;
- rescue/help can improve relation to rescuer;
- relation changes use sparse overrides and caps.

Reactions must not recursively create infinite reactions. One post may get one reaction pass, then it is done unless a later real event references it.

## Messages And Threads

Private messages are a reserved extension point. They are not part of the shipped Demos runtime; posts, reactions, quest notices and social journeys are the active system.

Possible shape:

```txt
message = direct post with privacy private
thread = compact pair/group id + recent message ids
```

Use cases:

- request meeting;
- ask for help;
- warn family/friend;
- debt reminder;
- caravan appointment;
- quest lead;
- threat.

Messages must not imply instant off-floor action. If this extension point is implemented and a message causes movement, it must create or request a normal A-Life migration intent.

## Cold Social Director

The cold director is the system that slowly turns social graph and events into posts, relation changes and rare migration requests.

Shipped cadence:

```txt
DEMOS_RUNTIME_TICK_SECONDS = 30
DEMOS_RUNTIME_RECORDS_PER_TICK = 64
DEMOS_RUNTIME_EVENT_LIMIT = 64
DEMOS_RUNTIME_OUTCOMES_PER_TICK = 4
DEMOS_RUNTIME_POSTS_PER_TICK = 4
DEMOS_RUNTIME_REACTIONS_PER_TICK = 4
DEMOS_QUEST_NOTICES_PER_SOCIAL_TICK = 2
```

This mirrors the cold migration budget style. It means a full `100_000` pass is slow, which is fine: off-floor social life is cinematic and aggregate.

Per tick:

1. Consume a small number of queued event candidates first.
2. Process `64` A-Life records by cursor.
3. For each alive, non-reserved-blocked record, inspect only its `9` social edges.
4. If recent events match edge context, maybe create a post/reaction/override.
5. Maybe request a migration action for one rare social visit if route rules allow.
6. Stop at `DEMOS_SOCIAL_OUTCOMES_PER_TICK`.

The director must not:

- scan all posts for every NPC;
- scan all events for every NPC;
- load inactive floors;
- materialize NPCs;
- mutate `alife.npcs` directly;
- bypass `moveAlifeNpcRecord()` or active arrival/departure systems.

## Reserved Active-Floor AI Hooks

Active-floor AI can use social graph because every materialized actor already receives the AI pass. This is an extension point, not an authority already owned by Demos: any shipped hook must read only the actor's outgoing edges and then let the existing AI/faction/combat systems own behavior.

Cheap hooks:

- `social` utility intent gets a boost if a friend/family edge is live nearby;
- `flee` and `safety` score can account for a hated enemy nearby;
- `escort` can prefer family/friend during samosbor;
- `combat` can bias target priority against enemies or killers;
- `work/social` can choose a live acquaintance as talk target;
- `witness` events can update relation overrides through direct edges.

Implementation rule:

```txt
live entity -> alifeId
  -> read up to 9 social edge ids
  -> resolve only those ids through active alifeId -> entity index
  -> score intent
```

No actor should query "who knows me?" by scanning `100_000` records during frame update. Incoming relation views belong to UI/debug/cold batch, not per-frame AI.

## Social Visits

Shipped "friend goes to friend" behavior uses existing migration concepts through Demos social journey requests. `demos_social_runtime` may request at most one bounded journey from inspected social edges, and `demos_social_feedback.ts` queues it through A-Life migration-compatible data.

Registered migration intents:

- `social_visit`;
- `family_visit`;
- `debt_visit`;
- `work_visit`;
- `conflict_visit`;
- `quest_meeting`;
- `shelter_rejoin`;
- `caravan_social_join`.

Rules:

- only alive ordinary persistent NPCs;
- no player/native player body;
- no plot/menu/quest-critical target unless quest system explicitly allows;
- no NPC-forbidden route destination;
- no active samosbor unless reason is shelter/refugee and samosbor rules allow;
- active-floor departure must walk to a lift anchor;
- active-floor arrival must materialize near lift/route anchor;
- off-floor move uses `moveAlifeNpcRecord()` through migration, not direct Demos mutation.

Social visits are rare:

```txt
DEMOS_SOCIAL_JOURNEYS_PER_TICK_CAP = 1
DEMOS_SOCIAL_ACTIVE_DEPARTURE_CAP_SHARE = use existing migration cap
```

The point is not crowd travel. The point is that a friend/enemy relation can occasionally create a believable arrival the player may see.

## UI Shape

The current Demos profile browser is a canvas tabbed UI without DOM:

```txt
Профиль
Связи
Лента
Пост
Квесты
```

### Профиль

Existing fields stay:

- id;
- plot id if present;
- name;
- relation to player;
- faction;
- occupation;
- level;
- location;
- HP;
- money/account;
- karma;
- quest affordance;
- portrait.

Add derived social summaries:

- `друзья: 3`;
- `враги: 1`;
- `семья: 2`;
- `последний пост: post:123`;
- `упоминается в 4 свежих записях`.

### Связи

Shows only non-hidden local slots:

```txt
Друг     alife:1843  Анна ...  +76
Недруг   alife:882   Пётр ...  -42
Враг     alife:911   Слесарь... -68
Семья    alife:1901  Мария ... +88
```

No full "mutual friends" scan. Mutual count is a reserved bounded query, not a per-frame/profile full-population scan.

### Лента

Recent posts:

- global recent cap;
- filtered by current profile;
- filtered by search;
- no infinite scroll;
- no pre-render of all posts;
- no per-NPC full feed persisted.

### Пост

Shows one post, compact reaction list and involved NPC ids. Reserved action buttons may appear only if normal systems support them.

## Save Model

There are three storage levels.

### Level 0: Read-Only Profiles

No save shape change.

Current profile/search state stays transient:

- `showDemos`;
- `demosCursor`;
- `demosSearch`;
- `demosSearchActive`.
- `demosTab`;
- `demosFeedScroll`;
- `demosPostCursor`.

### Level 1: Deterministic Base Graph

No save shape change if:

- graph is regenerated from A-Life seed/population version;
- no relation changes persist;
- UI only displays generated friends/enemies.

This is the deterministic base graph layer.

### Level 2: Persistent Social Consequences

Shipped. Requires save shape bump and current-shape sanitization; current save shape is `21`.

Save section:

```ts
interface DemosSocialSaveState {
  version: 1;
  cursor: number;
  eventCursor: number;
  nextPostId: number;
  nextReactionId: number;
  relationOverrides: DemosRelationOverride[];
  posts: DemosPost[];
  reactions: DemosReaction[];
}
```

Caps:

```txt
relationOverrides <= 8192
posts <= 512
reactions <= 2048
args strings <= 48 chars each
tags <= 8
tag length <= 32
```

Sanitization:

- drop invalid ids;
- clamp relation `[-127, 127]`, reserve/drop `-128` unless it is explicitly used as sentinel;
- drop posts whose author id is dead only if privacy/action requires living author; dead authors can keep old posts;
- drop reaction without matching post id;
- truncate strings;
- reject stale save shape as normal project policy.

Do not serialize base graph.

## Event Integration

Preferred event path:

```txt
publishEvent(state, draft)
  -> existing event rings / rumors / world log
  -> optional Demos observer queues compact candidate
  -> Demos director turns candidate into post/reaction at cap
```

This keeps Demos downstream from facts. It should not require every system to know Demos details.

Candidate event data should use ids:

- `actorAlifeId`;
- `targetAlifeId`;
- `killerAlifeId`;
- `victimAlifeId`;
- `floorKey`;
- `roomId`;
- `zoneId`;
- `questId`;
- `caravanRunId`;
- `resourceId`;
- tags.

No Russian display-name lookups in hot logic. Names resolve only when building UI/post text.

## Quest And Economy Hooks

Quest direction:

- generated quest givers should resolve to persistent A-Life ids;
- Demos can show `может дать дело`, `ждёт ответа`, `цель задания`, `пропал`;
- Demos notice view does not accept quests directly; face-to-face NPC talk hands the notice to normal quest/contract systems and publishes compact handoff data;
- killing a quest giver can produce family/friend posts and fallback quest consequences.

Economy direction:

- debt edges can affect reaction and visit types;
- caravan members can post arrival/loss/delay;
- shortages can generate faction/floor posts;
- bank/market trips can become migration reasons only through economy/migration systems;
- money/account facts shown in Demos remain read-only until trade/debt systems support actions.

## Samosbor Behavior

Demos does not simulate samosbor off-floor.

Allowed:

- active-floor samosbor facts create posts/reactions;
- aftermath death/missing/shelter events update relations;
- friends/family can react to a known death;
- registered `shelter_rejoin` migration intent may move a person after samosbor only if normal migration rules allow it.

Forbidden:

- deciding shelter outcome for off-floor NPC just because they are friends;
- spawning rescue visitors during active samosbor without route/samosbor rules;
- rewriting floor geometry or floor memory from Demos.

## Debug And Telemetry

Useful debug summaries:

- social slots per NPC;
- edge count and empty slot count;
- relation override count/cap;
- post/reaction ring usage;
- social director cursor;
- events consumed this tick;
- posts created this tick;
- relation changes this tick;
- social migration requests this tick;
- profile query time for current UI;
- heap delta for graph creation.

Debug commands should inspect, not mutate, unless explicitly named:

- print profile social edges;
- print recent posts by `alifeId`;
- force one post from a recent event;
- force relation delta between two A-Life ids;
- force social visit through migration path.

## Shipped Modules And Extension Points

### Shipped: Demos Social Graph

Core files:

- `src/systems/demos_social.ts`;
- `src/data/demos_social.ts`;
- `src/systems/demos.ts`;
- `src/systems/demos_profiles.ts`;
- `src/render/demos_ui.ts`;
- focused tests under `tests/`.

Runtime contract:

1. Builds deterministic graph pack from A-Life seed and record snapshots.
2. Exposes `getDemosSocialEdges(state, alifeId)` / NPC-only edge helpers.
3. Exposes relation band helper for NPC-NPC edges.
4. Adds profile social summary and traits.
5. Draws `Связи` tab capped to local slots.
6. Tests cover determinism, no self edges, dedupe, range clamp and memory budget.

No save shape change.

Verified behavior:

- profile shows friends/enemies from A-Life ids;
- 100k graph builds within measured budget;
- UI never scans all 100k per frame;
- no code path creates NPCs.

### Shipped: Event-To-Post Feed

Core files:

- `src/data/demos_posts.ts`;
- `src/systems/demos_posts.ts`;
- `src/systems/demos_social_director.ts`;
- `src/systems/demos_runtime.ts`;
- `src/render/demos_ui.ts` feed tab;
- tests.

Runtime contract:

1. Defines post templates and compact args.
2. Consumes bounded recent `WorldEvent` slices.
3. Stores capped persistent post/reaction rings in `demosSocial`.
4. Draws `Лента` tab for recent posts.
5. Rebuilds rendered text from compact post fields; generated strings are not saved.

Verified behavior:

- death/migration/caravan/samosbor/quest facts can create posts;
- cap prevents feed growth;
- post text resolves names lazily;
- no inactive floor loading.

### Shipped: Reactions And Relation Overrides

Core files:

- `src/systems/demos_social.ts`;
- `src/systems/demos_posts.ts`;
- `src/systems/demos_social_director.ts`;
- `src/systems/demos_social_feedback.ts`;
- `src/systems/demos_save.ts`;
- `src/systems/save_payload.ts`;
- `src/systems/save_runtime.ts`;
- tests.

Runtime contract:

1. Stores relation overrides with cap.
2. Stores reaction ring.
3. Generates reactions from social edges.
4. Applies small relation deltas through Demos social API.
5. Persists compact state under current save shape.
6. Sanitizer tests cover malformed current-shape state.

Verified behavior:

- friend reacts differently from enemy;
- relation override persists after save/load;
- old save shape is rejected according to project policy;
- cap pressure drops oldest/weakest low-importance overrides deterministically.

### Reserved: Active AI Social Hooks

Likely owner files if this extension ships:

- `src/systems/ai/npc_utility.ts`;
- `src/systems/ai/npc_fsm.ts` only if needed;
- `src/systems/entity_index.ts` only if existing lookup is insufficient;
- tests.

Required contract:

1. Build cheap active `alifeId -> entity` lookup from existing entity index or AI pass context.
2. Score only outgoing edges of the actor.
3. Add social/escort/flee/combat biases.
4. Publish compact witnessed social events.

Required verification:

- live friends may talk/help/escort;
- live enemies may avoid/threaten/fight when other conditions support it;
- no incoming full graph scan in frame loop;
- active-floor AI remains full-pass and bounded.

### Shipped: Cold Social Visits

Core files:

- `src/data/demos_social_visits.ts`;
- `src/systems/demos_runtime.ts`;
- `src/systems/demos_social_feedback.ts`;
- `src/systems/demos_social.ts`;
- tests.

Runtime contract:

1. Registers migration-compatible intent defs for social visit reasons.
2. Lets Demos runtime request rare journeys at cap.
3. Reuses active departure/arrival paths through A-Life migration-compatible state.
4. Publishes Demos/social events around relation consequences and journey requests.

Verified behavior:

- off-floor friend visit changes `floorKey` only through migration;
- active-floor arrival appears at route/lift anchor;
- NPC-forbidden route floors stay blocked;
- samosbor restrictions are respected.

### Reserved: Demos Actions

Action buttons are reserved extension points. The shipped UI exposes profiles, links, feed, posts and read-only quest notices; accepting a Demos quest notice happens through face-to-face NPC talk and normal quest/contract systems.

Allowed reserved action shapes:

- message NPC;
- request meeting;
- ask for trade appointment;
- pay debt;
- ask for rumor;
- take quest if quest system exposes stable A-Life giver;
- mark caravan/escort candidate.

Every action must call the owner system. Demos UI is not an authority for quests, trade, migration, economy or combat.

## Tests And Validation

Minimum tests by slice:

- graph generation deterministic for seed/population;
- all targets are valid `alifeId`;
- no self edges;
- max slots respected;
- relation range is `[-127, 127]` in one signed byte;
- flags explain friend/enemy/family/work/debt;
- profile edge view does not allocate full population list;
- post ring cap;
- reaction ring cap;
- relation override sanitizer;
- save shape rejection when persistent state appears;
- social director processes bounded records and bounded outcomes;
- active AI hook reads only local outgoing edges.

Command expectations:

- docs-only edits: `git diff --check`;
- graph/data edits: `npm run check:readonly`;
- save/runtime/AI/UI slices: `npm run check`;
- render/UI changes: also `npm run check:browser` when Chrome is available.

## Current Decisions And Reserved Questions

1. Slot budget

   Current answer: 9 NPC slots plus the player slot. Increase only after heap/browser measurement.

2. Base graph ownership

   Current answer: separate module, but A-Life-adjacent. It reads snapshots and exposes APIs; it does not mutate raw A-Life arrays directly.

3. Post persistence

   Current answer: yes. `demosSocial` persists compact posts, reactions and relation overrides under save shape `21`.

4. Missing-edge relation overrides

   Current answer: direct changes may create a missing edge through a bounded helper; derived propagation only uses free slots and never appends beyond the fixed public slot budget.

5. Enemy representation

   Current answer: both. Use `ENEMY` flag for strong narrative/rival edges; allow negative work/debt/faction edges without the flag.

6. Reactions per post

   Current answer: max 4 in the shipped constants. It keeps the feed readable and matches runtime budget.

## Anti-Patterns

Reject:

- "NPC writes daily diary" for every off-floor NPC;
- Demos-specific actor creation;
- relation propagation by scanning all records;
- post text that invents facts not backed by event/A-Life/economy/quest state;
- UI that builds `100_000` profile cards;
- saving full graph as JSON;
- using `entity.id` instead of `alifeId` for durable social facts;
- making Demos decide route/floor permission;
- hiding weak simulation under vague text;
- putting Demos social logic in render.

## Shipped Contract

The social Demos system currently guarantees:

- every ordinary A-Life NPC can expose a small, deterministic social circle;
- profile pages show friends/enemies without pre-rendering the population;
- relation scores use one-byte `[-127, 127]` NPC-NPC semantics with scaled thresholds compatible with personal player relation;
- real game events can create capped posts;
- NPCs react through their social edges;
- durable relation changes are sparse, capped and save-sanitized;
- reserved active-floor AI hooks can use social edges only with no full graph scan;
- cold visits use migration/arrival infrastructure;
- deaths, samosbor, caravans, quests and economy facts can surface socially;
- no ordinary NPC refill or hidden off-floor simulation is introduced.
