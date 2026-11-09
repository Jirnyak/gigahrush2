# AI — utility brain for embodied NPCs

> **Сверка 2026-11-09 (CANON S25). ГЛАВНОЕ, ЧТО НАДО ПРОЧИТАТЬ ПЕРВЫМ:**
> перемещение — ОДНА система, и описанные ниже «пути движения по интенту» и
> «токен владения движением» в дереве СНЕСЕНЫ. Писатель горизонтальной
> `Velocity` агентов один — `guide_step` ([src/game/guide.h](src/game/guide.h));
> все прочие проходы ЗАЯВЛЯЮТ ЦЕЛЬ рангом. Раздел §4 переписан, остальные
> разделы читать с этой поправкой.
>
> **Сверка 2026-08-23 (сохранена как история, но её собственное содержание
> устарело).** Она утверждала: «`ai_patrol_step` уже ХОДИТ по nav — coarse/fine
> каждый тик». Решёточного нава в дереве нет с 2026-10-12: наряд ходит по ГРАФУ
> ЗОН, цель у него `RoomId`, а не узел решётки. ВАЖНЕЕ и по-прежнему верно:
> CANON S12–S13 объявляет описанную здесь room-модель ОТМЕНЁННОЙ —
> `kRoomAffordance` (белые списки), `kRoomRecovery` (вид назначен), `localScore[]`
> заменяются вектором глаголов и одной суммой скора; ни одного из первых двух
> символов в дереве нет.

> **Status: needs layer (#12a), the pure scorer + selection FSM (#12b), and the
> stagger + steering + embody/loop driver (#12c) all BUILT — the visible crowd
> now moves.** This is the
> porting-target spec for the embodied NPC brain, captured from the reference
> (`../gigahrush`: `needs.ts`, `npc_utility.ts`, `npc_fsm.ts`, and the pathfinding
> steering). Exact per-intent scorer constants were **re-extracted verbatim** (the
> same design-doc → exact-extraction → code flow used for the
> [faction matrix](macrosim.md)) and are now the frozen table in
> [src/game/ai.cpp](src/game/ai.cpp); the per-intent formulas quoted below are the
> shape. It lives in the game layer (`src/game/`, `giga_game`) over the ECS
> ([ecs.md](ecs.md)) and consumes the baked nav ([nav.md](nav.md)) and flee field
> ([diffusion.md](diffusion.md)) — pure game-layer over EnTT + NpcPool, so the
> whole brain is exercised **headless** by `game_test`, exactly like the macro tick.
>
> - **Code:** [src/game/ai.h](src/game/ai.h) / [.cpp](src/game/ai.cpp)
> - **Tests:** `game_test` — `test_needs_all` / `test_needs2_all`
>   ([tests/suite_needs.inl](tests/suite_needs.inl),
>   [suite_needs2.inl](tests/suite_needs2.inl)) and `test_utilai_all`
>   ([tests/suite_utilai.inl](tests/suite_utilai.inl))
> - **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) §L4
> - Upstream of [physics.md](physics.md): a plain NPC has **no `Controller`/`CameraTag`**
>   (those are the *player's* input seam). С 2026-11-09 мозг горизонтальную
>   `Velocity` **НЕ пишет** — он заявляет цель, а пишет её единственный проход
>   ведения `guide_step` ([src/game/guide.h](src/game/guide.h)); дальше
>   [physics.md](physics.md) интегрирует, и ось гравитации по-прежнему её. The
>   player body carries the same `Needs`/`AiBrain` but `ai_step` **skips any
>   camera-holder** — и тот же вопрос стоит ВТОРЫМ РУБЕЖОМ у писателя
>   (`decider_of`), потому что вселение отдаёт `CameraTag` живому жителю
>   ПОСЕРЕДИНЕ кадра, и заявка, поданная до вселения, иначе перетёрла бы ввод
>   человека ([npcs.md](npcs.md): the player is not special).

This is the system that finally makes the **visible crowd move** — wander, queue
for a toilet, flee a threat, seek food, patrol, fight. It runs only on the
**embodied** entities of the live floor (~16k, [floors.md](floors.md)), never on
the cold pool: off-screen life is the macro tick's abstract job
([macrosim.md](macrosim.md)), on-screen life is this brain's. The two never
overlap — the same detailed-near / coarse-far split as everything else.

## Shape — score, pick, commit, steer

Each embodied agent, each frame it is *scheduled* (see stagger), runs a four-stage
pipeline. Only the score stage is pure; the rest is a tiny per-entity FSM state.

### 1. Needs — the drives (data, decaying columns)

A fixed block of **0..100 needs** per agent, stored SoA as a column of `NpcPool`
(not an ECS component — see the Built note below). Rates are authored per second,
and **every embodied body on the live floor is advanced** — O(n) in one floor's
crowd (419 on the demo stack), never the cold 950k, whose lives the macro tick
models abstractly.

That scope was ONLY THE CAMERA HOLDER until 2026-08-06, and the reason it widened
is worth keeping: `needs.h` refused to run the clock for a crowd that had no AI
able to eat, because at 0.12 water/s the whole population dehydrates in ~14
minutes and the building is a morgue before the player reaches floor −3. It named
its own condition — "widen it when the utility AI can walk an NPC to a kitchen" —
and §27's room work met it. Both halves landed together: the crowd's clock, and
`room_recover`, the ambient recovery that keeps it from being a morgue. Measured
in `suite_needs`: 25 minutes with no rooms takes 64 of 64 bodies to zero HP; the
same 25 minutes obeying the scorer costs 0 of 64 a single point.

A resident is also seeded at its own point of the day (`needs_roll_resident` —
the ordinary roll, then the REAL clock advanced by a hashed phase), so a floor is
not 419 people who all ate breakfast on the same frame. The camera holder is the
exception, keyed on the component and never on an identity: whoever holds
`CameraTag` when their row is first seen is starting a trip.

Nominally they decay/rise at
data-driven rates. The reference also scaled them by a character-sheet attribute
block; **в этом дереве масштабирования НЕТ**, и с 2026-10-12 нет и блока — см.
сноску под таблицей:

| Need | Direction | Ref rate (per sec) | Attribute scale, **НЕ ПОРТИРОВАНО** (`rate /= 1 + 0.1·stat`) |
|------|-----------|--------------------|-----------------|
| food | reserve, **falls** | 0.08 | STR (ref: attr slot 0) |
| water | reserve, **falls** | 0.12 | AGI (ref: attr slot 1) |
| sleep | reserve, **falls** | 0.05 | INT (ref: attr slot 2) |
| pee | pressure, **rises only via digestion** | 0.10 (digest) | — |
| poo | pressure, **rises only via digestion** | 0.06 (digest) | — |

Rates are a **table**, not code; attribute scaling would mean a hardier NPC
hungers slower. **Колонка, из которой этот масштаб читался бы, СНЕСЕНА
2026-10-12** решением владельца («перков пока нет и не будет до пострелиза»):
восьмислотовый блок `attrs` в `NpcPool` имел одного писателя (посев) и ноль
читателей, 8 Б × 2²⁰ = 8 МиБ. Правый столбец таблицы выше — ОПИСАНИЕ
ЭТАЛОНА, а не этого кода, и был им всегда (абзац «REFERENCE ONLY» ниже говорил
это ещё до сноса). Когда перки вернутся пострелизом, у них будет СВОЯ колонка и
сразу читатель. Restoring a need (eating, drinking, using a toilet, sleeping) is an
intent's *effect*, applied when the FSM reaches the target. Cold NPCs carry no
fine needs — the macro tick models their lives abstractly; needs materialise only
on embodiment and fold away on de-embodiment, like every other transient
([npcs.md](npcs.md): hp/inventory stay canonical, only transient state folds).

**Built (#12a — [src/game/needs.h](src/game/needs.h) /
[npc_pool.h](src/game/npc_pool.h)).** `Needs` is **a 36-byte row in `NpcPool`, not
an ECS component** (`npc_pool.h`, pinned by a `static_assert`): three **reserves**
that drain (`food` / `water` / `sleep`), two **pressures** that fill (`pee` /
`poo`), the two `pending` digestion pools feeding them (`pendingPee` /
`pendingPoo`), plus `hpDebt` and the `seeded` flag. Reserve or pressure is a
property of the FIELD, not of a tag or an index range. The pool row is the storage
because the macro society sim ticks these on its own coarse clock, with no world
loaded ([macrosim.md](macrosim.md)); `needs_advance(n, dt)` is that pure clock —
no registry, no HP, no allocation — and `needs_step` is the embodied wrapper that
also charges HP and speed:

- **reserves decay** every tick by `rate·dt`. The attribute scaling below is
  **REFERENCE ONLY — NOT PORTED**: `needs_advance(Needs&, float)` takes no
  record and no attribute block, and no `0.1` coefficient exists in `src/game`.
  For the record, the reference slows each by
  `rate /= (1 + 0.1·stat)` — STR slows food, AGI water, INT sleep, read from the
  record's generic 8-slot block; clamped at 0. Этого блока в пуле БОЛЬШЕ НЕТ
  (снесён 2026-10-12, один писатель / ноль читателей, надгробие в
  [npc_pool.h](src/game/npc_pool.h)), так что строка стала чисто исторической:
  вернуть масштаб = завести колонку И читателя одним коммитом.
- **pressures rise only by digesting** their pool: `dp = min(pending, rate·dt);
  v += dp; pending -= dp`, clamped at 100. A **fresh gut (empty pool) holds pee/poo
  flat** — they do not climb on their own; the eat intent (#12b) fills the pool.

`needs_roll(seed)` seeds a fresh body deterministically from its stable id (a
stateless `hash3` per need over an independent salt; per-need bands food/water
70–100, sleep 60–100, pee 0–30, poo 0–20; pending pools empty), so embodiment is
reproducible with **zero stored RNG state**. Every rate, range and the digestion
model are **ported verbatim from the reference `needs.ts`** (same design-doc →
exact-extraction → code flow as the [faction matrix](macrosim.md)); the
`0.1`-per-point attribute coefficient is the ONE thing that was **not**, and the
column it would have read is gone since 2026-10-12 — see above. Restore-on-use — eating / drinking / toilet /
sleep filling or draining a need — is an intent *effect*, so it lands with the
scorer (#12b). Verified headless by `test_needs_all`.

### 2. Utility scorer — 13 intents, pure and stateless

`score(agent, world) -> float[13]`, each clamped **0..100**, one **additive
scorer per intent** (no cross-talk, no shared mutable state — a pure function of
the agent's needs, threat, role, floor rhythm and faction standing). The 13
intents:

`safety · combat · flee · toilet · drink · eat · sleep · work · heal · social ·
patrol · faction_assault · wander`

Purity is load-bearing: it makes the scorer trivially testable in isolation
(headless, like the macro tick) and order-independent, and it keeps **zero
scheduling RAM** — see stagger. `faction_assault` is wired as the
reference's flat 50 gated on `Perception::factionAssaultTarget`, which **has no
producer anywhere in the tree** — so the term is a constant 0 and the intent can
never be selected. `social` biases on `FactionTraits::sociability` ONLY: neither
`hostile()`, `friendly()` nor the per-NPC `rel_` affinity edges are read by the
scorer. The design below is the target, not the code:
[faction matrix](macrosim.md) (#10d) — an agent scores assaulting a nearby member
of a faction its own faction is `hostile()` toward, and `social` biases toward
faction-`friendly()` neighbours and high-affinity relationship edges
(the per-NPC `rel_` block, [npcs.md](npcs.md)).

**Built (#12b — [src/game/ai.cpp](src/game/ai.cpp) `score_intents`).** A pure
`score_intents(perception, needs, out[13])` fills the 13 utilities, each an
additive body clamped to 0..100, then nudged by a per-agent **identity jitter**
(§Scheduling) so a uniform crowd does not tie in lockstep. Every coefficient,
pressure curve (`lowNeedPressure` / `highNeedPressure` / `healthPressure` /
`computeThreatPressure`) and the `clampScore`/`unitish` band logic is **ported
verbatim** from `npc_utility.ts`. The scorer never touches the pool or world: it
reads a **`Perception`** snapshot the driver (#12c) fills from whatever the engine
currently exposes. Signals the target does not yet produce — mobs/combat (#13), a
room-affordance model, a minute-of-day clock, the samosbor event — sit at
zero/`none`/−1 in `Perception`, so **every additive term with a missing input
contributes 0 and the ranking among the live intents (needs-driven + diffusion
threat) is exactly the reference's**; a later system fills the field and its term
switches on with *no scorer edit*. Verified headless by `test_utilai_all` (need- and
threat-driven argmax, the 0..100 range, per-identity spread).

### 3. Selection — argmax with hysteresis (anti-flapping)

Raw argmax over 13 scores flaps every frame at a tie; the reference guards it with
a small state machine (kept as a minimal per-entity FSM record — the current
intent, its start time, its committed path):

- **Switch margin 7** — a new intent must beat the current by this margin to win,
  so near-ties stick. (The FSM override 7, *not* the `npc_utility` default 8 —
  using 8 diverges at the hysteresis boundary.)
- > **НАДГРОБИЕ КЛАССА «АВАРИЙНЫХ ИНТЕНТОВ» (снесён 2026-11-08, решение
  > владельца).** Здесь стояло: «Emergency override 58 — `safety / flee /
  > combat / heal` при счёте ≥ 58 перебивают текущий интент БЕЗ порога». Ни
  > `kEmergencyScore`, ни предиката `intent_is_emergency` в дереве нет; дверь
  > переключения ОДНА — `kSwitchMargin` (7). Довод сноса записан в
  > [ai.h](src/game/ai.h): срочность и так в счёте — угроза входит в
  > `flee`/`safety` с плюсом и в `work`/`social`/`sleep` с минусом, так что
  > настоящая опасность разводит их на ~84 очка против порога 7, а класс
  > избранных закрывал лишь полосу, где счёт почти равен, то есть случай, когда
  > решение и ДОЛЖНО залипать.
- **Stickiness +5 → +12** — the current intent gets a bonus `5 + min(7, t·0.18)`
  that grows the longer it's held, so a chosen task runs to a sensible end instead
  of churning. Applied *inside* the scorer (via `Perception.stickinessAmount`), so
  selection only needs the raw scores.
- **Re-plan every 1.5–4.0 s**, the interval **hash-seeded per agent** so the crowd
  doesn't re-plan in lockstep. Between re-plans the committed path is followed.
- **Path-commitment guard** — don't abandon an in-progress route for a marginally
  better intent; finishing beats thrashing.

**Built (#12b — [src/game/ai.cpp](src/game/ai.cpp) `select_intent`).** The
argmax + hysteresis itself: `select_intent(scores[13], current)` takes the raw
argmax (ties → lower index) и keeps `current` unless a challenger clears the
switch margin. ~~«lets an emergency intent ≥ 58 preempt regardless»~~ — второй
двери больше нет (надгробие выше). The frozen thresholds live as named constants
in [ai.h](src/game/ai.h) (`kSwitchMargin`, and the `stickiness_amount` curve /
re-plan bounds the #12c driver consumes). The **AiBrain** component (current intent + `stateTimer` +
`nextDecisionAt` + a `decisions` re-plan counter) is defined here and folds with
embodiment like `Needs`. Verified headless by `test_utilai_all` (margin
stick/switch, emergency preempt, emergency-below-score fallback, tie-break); the
re-plan **cadence** and the identity **stagger** are the driver's job — see §5.

### 4. Движение — ОДНА система, и решение интента выдаёт только ЦЕЛЬ

> **ПЕРЕПИСАНО 2026-11-09 (CANON S25).** Всё, что этот раздел говорил раньше —
> «движение решает интент», «арбитраж держит токен `AiBrain::motion`», «ведёт
> через `route_step`», — описывало ДВА снесённых механизма. Ниже — код. Доводы,
> знак ранга и замеры не пересказываются: они в CANON S25 и в шапке
> [src/game/guide.h](src/game/guide.h).

Закон владельца: **перемещение в пространстве — одна универсальная агностичная
система; занятие ею ПОЛЬЗУЕТСЯ, но никогда не имеет своей.** Поэтому:

- **Писатель горизонтальной `Velocity` агентов ОДИН** — `guide_step`
  ([src/game/guide.h](src/game/guide.h) / [.cpp](src/game/guide.cpp)), в кадре
  после `wander_step` и перед `slow_step` (слот профайлера `kProfGuide`).
- **Остальные проходы ЗАЯВЛЯЮТ ЦЕЛЬ** компонентой `Steer` (28 байт, живёт РОВНО
  ОДИН тик, помечена тиком): `TargetKind` = `Hold` / `Zone` / `Dir`, ранг
  `SteerRank` = `None < Walk < Chase < Feud < Errand < Patrol < Flee`.
  Сильный ранг перебивает слабый одним сравнением, и **порядок вызовов в кадре
  на исход не влияет** — это и есть главное отличие от токена.
- **Нуль есть «заявки нет».** Любое непонятное значение байта читается как
  «заявки нет», и тело едет на прошлой скорости — то же, что сегодня при
  стаггере. Обратный знак дал бы заявку БЕГСТВА на всю толпу от зануленной
  компоненты.
- **Нав ходьбы — граф зон**, а не решётка: `zone_walk_dir`
  ([src/game/zone_nav.h](src/game/zone_nav.h)) за одной дверью `steer_to_zone`
  ([src/game/guide.h](src/game/guide.h)) — два чтения, ни одной волны (§88/F.2).
  Flee steering reads **`diffusion_gradient`** ([diffusion.md](diffusion.md),
  the flee intent's input, distinct from nav).

> **НАДГРОБИЕ `route_step` (снесён 2026-10-12, §88/F.2 шаг 3).** Этот раздел
> месяцами объявлял решёточный `route_step(coarse, fine, from, to)` «уже
> запечённой лучшей версией» HPA\*-навигации референса. Его больше нет, и это не
> отложка: `CoarseGraph`, `FineNav`, `bake_coarse`, `bake_fine`, `bake_nearest`,
> `route_step`, `coarse_next` **запрещены машиной** —
> [tools/check_source_rules.cmake](tools/check_source_rules.cmake) краснеет на
> вызове, квалификаторе и объявлении типа (надгробия в бэктиках разрешены
> намеренно). Довод сноса — замер: 80% ответов старой двери были «шаг вверх»,
> потому что поля печены над оракулом «тело ВЛЕЗАЕТ в клетку», у которого нет
> понятия ОПОРЫ. Решётка `lattice.h` сама жива и законна — хабы лифтов и
> быстрых перемещений, — запрещена только её НАВИГАЦИОННАЯ роль.

**Built (#12c — [src/game/ai.cpp](src/game/ai.cpp) `ai_step`).** Драйвер
разрешает макро-клетку тела из `Transform` и — если решение того требует —
подаёт ОДНУ заявку:

- **Бегство заявляет `Dir` рангом `Flee`.** Источников пеленга **ДВА**, в
  порядке приоритета: живой `−diffusion_gradient(danger)`, затем запомненный
  away-вектор (`MemDanger`/`MemHurt`). `IntentFlee` — единственный интент этого
  прохода, который заявляет что-либо; у всех прочих `ai_step` скорости не
  касается и заявки не подаёт.
  > **НАДГРОБИЕ ГЕРМОУКРЫТИЙ (2026-08-28).** Третьим — и ПЕРВЫМ по приоритету —
  > источником здесь стоял `door_nearest_shelter` (запечатанная квартира во
  > время самосбора, §23). Гермоукрытий в дереве нет, функции нет, типа
  > `DoorSet` нет; слот в подписи `ai_step` занят `const void* doorsDead` и
  > назван могилой на месте. Новая дверь вернёт укрытия своим законом — см.
  > [Docs/specs/06_SAMOSBOR_AND_CRISIS.md](Docs/specs/06_SAMOSBOR_AND_CRISIS.md) §4.
- **ДЕЛО ЗАЯВЛЯЕТ `Zone` ИЛИ `Hold` РАНГОМ `Errand`,** и решает его не интент, а
  ОДНА СУММА `Σ спрос[глагол] · предложение[глагол] − путь`
  ([game/place.h](src/game/place.h), CANON S12.3/S13.2). Спрос собирается из
  `Needs` теми же кривыми давления, которыми живёт скорер (`needs_low_pressure`
  и соседи, [needs.h](src/game/needs.h)); предложение — `declared + supply`
  комнаты; радиус кандидатов ВЫВОДИТСЯ из храповика `maxOffer` и отсекается
  потолками бинов. Ход — отдельный проход `place_errand_step`, он стоит между
  `ai_patrol_step` и `wander_step`. Вида комнаты в этом нет нигде (S12.2), и
  новый глагол — строка `data/verbs.csv`, а не ряд таблицы в коде.
  > **НАДГРОБИЕ ТАБЛИЦЫ «ИНТЕНТ → ВИД КОМНАТЫ» (rooms-object F, 2026-10-01).**
  > Здесь стояли `intent_room_mask`, `kRoomAffordance` и флоу-поля по виду
  > комнаты; ни одного из этих символов в дереве нет (перепись 2026-10-01
  > насчитала у `intent_room_mask` одно вхождение — сам комментарий).
  > **И ТАМ ЖЕ СТОЯЛ SEAT**, микроцель «одна внутренняя клетка, хешированная от
  > (identity, room)». Его тоже нет: `room_seat_offset` и ротация `attempt` в
  > дереве отсутствуют, а `kSeatArriveM` ([ai.h](src/game/ai.h)) остался
  > ОБЪЯВЛЕНИЕМ с одним вхождением на всё дерево и без читателя. **Это и была
  > главная ложь этого файла о себе:** до правки 2026-11-09 SEAT в ОДНОМ разделе
  > был объявлен и умершим (в абзаце про rooms-object F), и живым («micro goal is
  > the SEAT… a pure function and not stored state» — двумя пунктами ниже), и
  > ещё третий раз живым в §«Roles, seat claims…» как «seat claims (§27)».
  > Вопрос «какой именно стул» вернёт S13.4 скором на пропах комнаты, а не хеш
  > клетки.
  **ПОПРАВКА 2026-11-08 (CANON S24):** «не доходит» перестало означать «ничего
  не делает». Деяние нужды вешается на СОСТОЯНИЕ «стою там, где предлагают», а
  не на прибытие (`src/game/serve.h` / [.cpp](src/game/serve.cpp)), поэтому цикл
  спрос → утоление замкнут и БЕЗ §88: 136–143 тела заняты деянием одновременно,
  Σ 2179 очков бара за 1800 тиков, умерших ноль. Деяние на месте выражается
  заявкой `Hold` того же ранга `Errand` — то есть «стоять» есть ЦЕЛЬ движения, а
  не отсутствие цели, и держит тело владеемым нулём единственный писатель.
  - **MACRO goal** — всё ещё `currentIntent`: выбран скорером, липкий и
    прерываемый. Микроцели в коде сегодня нет (см. надгробие SEAT выше).
  - Темп дела — `kErrandSpeed` ([ai.h](src/game/ai.h)), и он равен обычному шагу
    `kWalkSpeedMps` ([guide.h](src/game/guide.h)). Паника читается паникой
    только пока обычный темп обычен: `kFleeSpeed` есть `kWalkSpeedMps ×
    kPanicPace`, и это равенство прибито гейтом в `tests/suite_utilai.inl`, а не
    памятью. **Оговорка честности:** литерал 1.35 всё ещё выписан в
    `kErrandSpeed`/`kFleeSpeed` ([ai.h](src/game/ai.h)),
    `kFeudWalkSpeed` ([faction_relations.cpp](src/game/faction_relations.cpp)),
    `kWanderLegMetres` ([wander.h](src/game/wander.h)) и
    `kPatrolLegMetres` ([patrol.h](src/game/patrol.h)) — «один дом» объявлен в
    `guide.h`, но переезд числа не закончен.
  - Шаг нацелен в ЦЕНТР СЛЕДУЮЩЕЙ КЛЕТКИ, никогда по голому орту. Это замер, а
    не стиль: орт ведёт тело из любой точки клетки одинаково, поэтому тело,
    вошедшее по касательной, цеплялось за углы — 23 прибытия из 64 против 64 из
    64. Сегодня это свойство живёт в ОДНОМ месте, `steer_to_zone`
    ([guide.h](src/game/guide.h)), а не в трёх копиях.
- **НАРЯД ЗАЯВЛЯЕТ `Zone` РАНГОМ `Patrol`** — отдельный проход
  `ai_patrol_step` ([ai.h](src/game/ai.h)), подпись
  `(reg, zones, layer, const GravityField*, tick)`. Цель — ЗОНА (`PatrolPlan`,
  [patrol.h](src/game/patrol.h)), и это НОГА маршрута, а не разовая точка:
  закрыв ногу, тело выбирает следующую зону от своей identity и `hops`.
- **ПРОГУЛКА — СЛАБЕЙШИЙ ЗАЯВИТЕЛЬ, РАНГ `Walk`,** и за ней никого:
  `wander_step` ([wander.h](src/game/wander.h)) заявляет `Zone` жителю, `Dir`
  или `Hold` погоне моба (ранг `Chase`) и `Hold` замороженному взглядом телу.
  Тело, у которого НИ ОДИН заявитель не подал заявки, не получает записи вовсе
  и едет на прошлой скорости.
- **НАДГРОБИЕ ТОКЕНА (2026-11-09, CANON S25).** Здесь стояло: «драйвер передаёт
  движение ровно одному писателю через токен `AiBrain::motion`», «владельцев
  три — `Wander`/`Ai`/`Errand`», «страж `ai_owns_motion` спрашивает
  `motion_owned()`», «остальные интенты ДЕЛЕГИРУЮТ, токен уходит в
  `MotionOwner::Wander`», «`wander_step` ведёт тело своим file-local
  `kNpcWalkSpeed`». **Ни один из этих символов в дереве больше НЕ ОБЪЯВЛЕН** —
  снесены `MotionOwner`, `motion_owned`, `ai_owns_motion`, байт
  `AiBrain::motion` (ушёл в паддинг, пин 16 байт держится без подкрутки),
  `ai_release` вместе с тремя его вызывающими (выгрузка этажа и два шва
  поездки) и `kNpcWalkSpeed`; в бэктиках они встречаются только в надгробиях.
  Довод сноса — ЗАМЕР, а не
  вкус: прибор-часовой (`--action vedenie`, [steer_probe.h](src/game/steer_probe.h))
  нашёл на этаже 6 **45 двойных записей за 250 тиков**, и перебивал ВСЕГДА
  `investigate_step` — пятый рулевой, который токена не читал вовсе. То есть
  закон «писатель один» токеном НЕ ДЕРЖАЛСЯ; он держался тем, что два звена
  цепочки почти всегда молчат. Проверяемая форма одна: писатель физически один,
  а второй невыразим, потому что у заявителя нет `Velocity` в виде.
  Что пережило снос — знак нуля (`SteerRank::None`, гейт `e2e_test` f8_03 на
  испорченном байте), «деяние рвётся угрозой и не рвётся самим собой» (ранги
  вместо списка владельцев) и «отдаём вандеру на отказе» (заявитель, у которого
  цель не прошла `steer_to_zone`, заявку не подаёт).
- **ОСТАЛОСЬ ДВА РУЛЕВЫХ, И ЭТО НАЗВАНО ВСЛУХ (CANON S25.6).**
  `investigate_step` ([investigate.h](src/game/investigate.h), слух мобов) и
  `faction_feud_step` ([faction_relations.h](src/game/faction_relations.h),
  вражда) пишут скорость САМИ и стоят в кадре НИЖЕ прохода ведения. Разница
  между ними есть, и она важна: вражда ЧИТАЕТ заявку сильнее своего ранга
  (`steer_claimed_by_stronger(..., SteerRank::Feud, ...)`), а слух не читает
  ничего. Прибор показывает **48 двойных записей за 250 тиков на этаже 6, все от
  слуха**. Их переезд в заявки — второй шаг, и он же задаёт владельцу вопрос,
  который сегодня решён порядком вызовов: **слух БЕЗУСЛОВНО перебивает погоню**
  (моб, вцепившийся в жителя, бросает его на любой выстрел).
- **Ось гравитации не трогается НИКОГДА** — её владелец `physics_step`
  ([gravity.md](gravity.md)), какой бы осью она ни была. Это выражено
  единственной формой записи, `steer_write`/`steer_stop`
  ([guide.h](src/game/guide.h)), а плоскость ходьбы — одной дверью
  `steer_frame_of` ([world/gravity.h](src/world/gravity.h)). Прежняя оговорка
  «оба писателя всё ещё пишут букву `z`» устарела дважды: писателей ведения
  один, и ось он берёт из фрейма.

**ДОЛГ, КОТОРЫЙ ПЕРЕЖИЛ СНОС НАВА: ТЕЛО ИДЁТ И НЕ ДОХОДИТ.** Абзац ниже —
история трёх заходов, и `route_step` в нём назван как ПОКОЙНИК (надгробие в
§4 выше), а не как отложка.

> **ЭТОТ АБЗАЦ ПОЛУЧИЛ ЧИСЛО 2026-10-01, И ЧИСЛО МЕНЯЕТ ЕГО ВЕС.**
> Проза, стоявшая здесь месяцами («целевых клеток ждём к #13, следование за
> полями сейчас вело бы тела в стены»), была верна и читалась как мелкий долг.
> Живой прогон (`--shot --frames 9000 --floor 6`, ~800 тыс. вызовов
> снесённого с тех пор `route_step`) говорит другое:
>
> | ответ потока | число | доля |
> |---|---|---|
> | `+z` (вверх) | 637 256 | **80%** |
> | `−z` | 10 542 | 1% |
> | четыре горизонтальных | 151 270 | 19% |
>
> Следствие в поведении: у хода по делам (`place_errand_step`, [game/place.h])
> **ПРИБЫТИЙ НОЛЬ за 108 секунд сима** при 230 идущих телах на тик. То есть это
> не «ждём целевых клеток», а **ни один гравитационно-связанный ходок в дереве не
> доходит до цели**, и `ai_patrol_step` живёт с тем же свойством с 2026-08 —
> просто его прибытие никто никогда не мерил.
>
> Корень глубже, чем «якоря подняты»: `bake_fine` flood'ит по
> `ClearanceField` ([clearance.h]), который отвечает «тело ВЛЕЗАЕТ в клетку» и
> понятия ОПОРЫ не имеет, поэтому кратчайший путь к якорю законно идёт ПО
> ВОЗДУХУ. Лечение — либо вертикальное ребро только над гранью
> (`surface_face_at`, [surface.h]), либо второе «ходячее» поле рядом с
> клиренсом; оба стоят бейка и решения владельца. Наряд — [problems.md] §88.
>
> Что сделано немедленно, потому что это была порча состояния, а не долг:
> последняя нога «прямо на цель» больше не идёт вслепую — перед шагом стоит
> вопрос «знает ли нав эту клетку», иначе тело выходило за проходимое множество
> и теряло маршрут (замер лечения: брошенных целей ~240 → 11).
>
> **ЧЕМ ЭТО КОНЧИЛОСЬ (2026-10-12, §88/F.2 шаг 3):** предмет СНЕСЁН, а не
> вылечен. Решёточный нав ходьбы удалён целиком, все проходы пошли по графу
> зон, и прогулка впервые начала ДОХОДИТЬ (0.00 → 15.52 прибытий на 100
> замеров). Нога НАРЯДА при этом не закрылась (1.04 при полосе 0.49–1.21 до
> правки) — это остаток долга, и круг причин сужен замером; одно из трёх
> подозрений, «арбитраж токена», потеряло предмет 2026-11-09 вместе с токеном.

Real targets — a food item, a toilet cell, a monster — arrive with the
#13 content tables ([items.md](items.md) / [monsters.md](monsters.md)); цель при
этом не станет новым видом движения: заявитель отдаёт либо ЗОНУ, либо ПЕЛЕНГ, и
«точка» отдельным видом НЕ ЗАВЕДЕНА сознательно — она была бы `Dir` с чужим
прибытием, то есть столбцом без читателя (CANON S25.3). Скорер и FSM при этом не
правятся — тот же заглушечный шов, что в §2.

### 5. Driver + scheduling — identity-hash stagger, no queue

`ai_step(reg, pool, danger, grid, layer, now, dt, cfg, mem, doorsDead, world, bus,
tick)` is the per-frame driver (сверено с подписью в
[ai.h](src/game/ai.h) 2026-11-09; `doorsDead` — `const void*`, могила дверей, см.
надгробие в §4; `tick` появился потому, что заявка ведения помечается тиком);
the sweep is layer-scoped, so it iterates
**all** live AI entities every frame (no persistent stripe buffers, no scheduling
wheel or queue), skips camera-holders, decays nothing (that's `needs_step`), and
for each agent either **re-plans or coasts**, then подаёт заявку §4 (скорости не
пишет). Whether an
agent re-plans *this* frame is a compare against its own `AiBrain.nextDecisionAt`
deadline; when it fires, the driver re-scores, re-selects, bumps the `decisions`
counter, and sets the next deadline to
`now + 1.5 + rand01(channel_seed(id,"utility_rethink"))·2.5` — a **per-identity
period** (1.5–4.0 s) drawn from a **stateless hash** (the FNV-1a `channel_seed`
fold, the same stateless-hash trick as the macro tick
[macrosim.md](macrosim.md) and worldgen [core/rng.h](src/core/rng.h)). So two
agents spawned the same frame drift apart permanently and the crowd's cadence
spreads smoothly across frames. The only scheduling state is that one `float`
deadline riding in the FSM record that already folds with embodiment — no wheel,
no queue, no side table. Verified headless by `test_utilai_all` (embodiment attaches
`Needs`/`AiBrain`; one step commits an intent, staggers into [1.5, 4.0] s, and
steers at walk speed with `v.z` untouched; the player is skipped; same id →
identical steer, different id → different heading; a saturating danger ramp
selects flee and drives `−x`; the deadline gates re-planning).

## Data-oriented stance (how it ports, not just what it is)

- **Needs = SoA columns** on the embodied set, decayed in one linear pass — never
  a per-object update method.
- **Scorer = one pure `float[13]` function** — the 13 intents are *rows of a
  scorer table*, added not branched; a new intent is a new row, not a new code
  path. (The reference keeps them as separate additive functions; the port folds
  them into a data-indexed dispatch where clean.)
- **FSM state = the minimum** — current intent + commit time + path handle, a tiny
  per-entity record, not a class hierarchy. The reference parks it in module
  WeakMaps; the port puts it in an ECS component so it folds with embodiment.
- **Steering = ОДНА система и запечённые чтения** — `diffusion_gradient` для
  бегства, граф зон (`zone_walk_dir`, два чтения, ни одной волны) для хода; O(1)
  на шаг, поиска в тике нет. ~~«`route_step` once #13 gives reachable goals»~~ —
  предмет снесён 2026-10-12 и запрещён машиной, надгробие в §4.
  **Занятие НЕ ИМЕЕТ своего движения:** оно выдаёт цель (`Hold`/`Zone`/`Dir`) и
  ранг, несёт её `guide_step` ([guide.h](src/game/guide.h)).
- **Universal** — the player is just an embodied record too; it carries the same
  `Needs`/`AiBrain`, and the driver simply **skips camera-holders** so player input
  drives the identical `Velocity`→physics path. Combat is isotropic: an NPC that
  shoots spawns an honest projectile that can hit anyone, the firer included.

## Roles, seat claims and the steering frame (landed 2026-08-14)

Три инкремента, вставшие сюда из батча marko1olo после переработки
([problems.md] §54). **Двух из трёх в дереве больше нет**, и это надгробия, а не
описание кода:

- > **НАДГРОБИЕ РОЛЕЙ (снесены 2026-11-08, решение владельца).** Здесь лежало
  > описание пяти архетипов как МУЛЬТИПЛИКАТИВНОЙ СТРОКИ скорера (`role.h`,
  > `RoleId`, `RoleTraits`, `role_for`, колонка `role_` пула, `homeRooms`/
  > `workRooms`, `kRoomFieldMask`, Медик над `Needs::hpBank`). Файла
  > `src/game/role.h` в дереве нет; `RoleId` и `role_for` встречаются только в
  > надгробиях `conversation.cpp`, `population.cpp` и `patrol.h`. Важное
  > следствие, которое пережило снос: **наряд никогда не был ролевой
  > политикой** — `ai_patrol_step` не читал ни одного ролевого числа, он читает
  > разбивку зон, соль и два предела, поэтому при сносе ролей он просто
  > переехал в [patrol.h](src/game/patrol.h) целиком.
- > **НАДГРОБИЕ SEAT-ЗАЯВОК (§27; список снесён 2026-10-01, механизм — вместе с
  > эрранд-веткой).** Здесь лежал транзиентный список заявок на место внутри
  > `ai_step` плюс ротация `attempt` в `room_seat_offset`. Ни того, ни другого в
  > дереве нет: список был 512 Б стека на каждый вызов и три предупреждения
  > сборки за массив, который не писался и не читался; `room_seat_offset`
  > отсутствует, `kSeatArriveM` ([ai.h](src/game/ai.h)) — объявление с одним
  > вхождением на всё дерево и без читателя. Вопрос «какой именно стул» вернёт
  > S13.4 скором на пропах комнаты.
- **Steering frame — ЖИВОЙ, и с 2026-11-09 он ОДИН на всё ведение.** Плоскость
  ходьбы берётся одной дверью `steer_frame_of`
  ([world/gravity.h](src/world/gravity.h)) — она же `regime_frame` под капотом, —
  поднимается ОДИН раз на проход, а запись скорости идёт по осям, оставляя ось
  гравитации физике, какой бы осью она ни была (`steer_write`/`steer_stop`,
  [guide.h](src/game/guide.h)). Под NegZ всё сводится к прежним литералам
  бит-в-бит; свойство бокового режима прибито `suite_faction2` §4b с прогонной
  мутацией. **Что здесь ПОЧИНИЛОСЬ сносом копий:** проекция на плоскость жила
  дословной лямбдой в четырёх проходах, и ДВЕ из них писали `vel.v.x`/`vel.v.y`
  напрямую, то есть врали при любой гравитации, кроме −Z (погоня в `wander.cpp`
  и `investigate.cpp`). Первая починена переводом в заявку; `investigate_step`
  ещё нет — он в остатке CANON S25.6. **Оговорка, которая ЖИВА:** away-векторы
  памяти — всё ещё (x, y)-данные, поэтому под боковым режимом проекция честно
  теряет их Z-половину.

## Connections

Consumes needs (this doc), граф зон (`zone_nav.h`; решёточный бейк из
[nav.md](nav.md) снесён 2026-10-12) и flee field
([diffusion.md](diffusion.md)), и the [faction matrix](macrosim.md) (#10d).
**Производит ЗАЯВКУ ЦЕЛИ, а не скорость:** walking-plane `Velocity` пишет
`guide_step` ([src/game/guide.h](src/game/guide.h)) и отдаёт её
[physics.md](physics.md) — тому же интегратору, к которому игрок приходит через
[controller.md](controller.md). Runs on the embodied slice the
[macrosim.md](macrosim.md) macro tick hands to [floors.md](floors.md) streaming.
Content it acts on (food/drink items, weapons, monster targets) comes from the
#13 tables ([items.md](items.md) / [monsters.md](monsters.md)). Room stocks and
production, when they land, plug in through the same room tables —
[production.md](production.md) owns that design.
