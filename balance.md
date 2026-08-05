# ГИГАХРУЩ: Баланс-Контракт

> Центральный документ баланса.
>
> Роль: описывает численный прогресс игры: деньги, уровни, HP/XP, награды, цены, scarcity, этажную опасность, рост риска по `abs(z)`, NPC/monster level pressure and expedition reward economy. Связан с `alife.md`, `economics.md`, `items.md`, `floors.md` and `quests.md`.

Дата: 2026-05-20
Статус: релизный баланс-документ, основанный на текущих `README.md`, `architecture.md`, `alife.md`, `desdoc.md` и фактическом коде `src/`.

`README.md` остается картой shipped behavior. Этот документ не обещает, что все целевые числа уже идеально выдержаны. Он фиксирует, какие численные рычаги в коде уже есть, какие диапазоны считать релизной нормой, какие дыры закрывать первыми и какими метриками доказывать, что баланс стал лучше.

## 1. Главный Принцип

Единица баланса в ГИГАХРУЩе - не один выстрел, не один предмет и не один NPC. Единица баланса - вылазка.

Нормальная вылазка должна иметь:

1. Цель: поручение, контракт, слух, дефицит, документ, производство, спасение или месть.
2. Подготовку: вода, еда, бинт, патроны, фильтр, документ, дверь, деньги или доверие.
3. Риск: монстр, люди, самосбор, кража, долг, маршрут, недостоверная карта или нехватка времени.
4. Возврат: лут, XP, деньги, репутация, поломка, смерть NPC, слух или новый враг.
5. След в симуляции: событие, дефицит, измененный контейнер, мертвый persistent NPC, испорченный маршрут или измененная фракционная обстановка.

Баланс не должен сглаживать последствия до нуля. Он должен делать последствия читаемыми, оплачиваемыми и игровыми.

## 2. Нельзя Делать

- Нельзя чинить релизный баланс через ordinary background refill людей.
- Нельзя молча заменять убитого A-Life NPC другим человеком в том же слоте.
- Нельзя делать monster refill только потому, что счетчик монстров упал.
- Нельзя респавнить quest giver после смерти как будто смерти не было.
- Нельзя сериализовать весь A-Life пул.
- Нельзя запускать off-floor pathfinding, combat, needs, LOS или full-floor scans ради баланса.
- Нельзя повышать live NPC cap, чтобы совпасть с размером A-Life bucket.
- Нельзя превращать фракционные event spawns в скрытую замену населения.
- Нельзя балансировать редкое оружие только DPS-числом: у него должен быть доступ, риск, расход, шум, задержка, самоповреждение, потеря лута или сюжетная цена.

## 3. Текущая Численная Опора

### Игрок И Потребности

- Новый игрок стартует в `src/main.ts` с `100 HP`, `100 maxHp`, `100₽`, пустым инвентарем, без оружия, `freshRPG(1)` и `10 PSI`.
- Пункт сборов вылазки в `src/gen/living/expedition_prep.ts` дает публичный минимальный набор: `water x1`, `bread x1`, `bandage x1`, `ammo_9mm x4`, маршрутные бумаги и талоны.
- `freshNeeds()` дает стартовые еду/воду примерно `70..100`, сон `60..100`, мочу `0..30`, кал `0..20`.
- Дрейн в `src/systems/needs.ts`: еда `0.08/s`, вода `0.12/s`, сон `0.05/s`.
- При нуле: голод `0.3 HP/s`, обезвоживание `0.5 HP/s`, overflow pee/poo `0.1 HP/s`.

Практический вывод: стартовая вода `70..100` живет примерно `9.7..13.9` минут реального времени без пополнения; еда `14.6..20.8` минут. Это уже близко к правильному survival-давлению.

### RPG

- HP уровня: `100 + 10 * (level - 1)`.
- PSI уровня: `10 + 1 * (level - 1)`.
- XP threshold: `80 * L + 5 * L^2`; переход с 1 на 2 уровень требует `180 XP`.
- STR дает melee damage без hard cap: `+1%` за каждое очко силы; maxHP без hard cap: `+1` за каждое очко силы; level добавляет `+level-1` к базовому урону melee-оружия, кулаки остаются `level`.
- AGI дает скорость без hard cap: `+1%` к движению за каждое очко ловкости; attack cooldown и spread улучшаются обратной асимптотой без floor.
- INT дает maxPSI без hard cap: `+1` за каждое очко интеллекта; XP, contract reward и document reward растут по мягким асимптотам; PSI cost уменьшается обратной асимптотой без floor.

### Экономика

- `src/data/items.ts`: 253 item ids, цена `0..24000`.
- Грубые группы цен: еда обычно до `40`, напитки до `18`, медицина до `220`, ammo обычно до `300`, инструменты до `1500`, оружие до `24000`.
- Топ-выбросы: `gravity_beam_emitter=24000`, `bfg=12500`, `psi_beam=9000`, `gauss=7200`.
- `src/data/resources.ts`: 17 ресурсов. Примеры: water `120/35`, food `140/40`, medicine `70/20`, ammo `80/18`, psi `20/5`, slime samples `12/3`.
- Цена через `src/systems/economy.ts`: item value * scarcity * demand * tariff * trader spread.
- Scarcity surplus floor `0.65`; default scarcity cap `4`, price cap `5`, reward cap `3`.
- Default trade spread: buy `1.15`, sell `0.85`; scientist sell `0.92`, wild sell `0.72`.
- Floor/route demand multipliers в `src/data/economy_rules.ts` в основном `1.08..1.42`.

### Контракты И Награды

- `src/data/contracts.ts`: 205 assignment templates at runtime.
- Ordinary non-authored NPCs are selected as procedural quest givers at `10%` when the floor assigns quest affordances; plot NPCs stay on authored quest rules.
- Authoring-base денежные награды примерно `0..340`, median около `115`, average около `119`; runtime `quest_rewards` сейчас платит примерно `2x` по деньгам для принятых системных/процедурных заданий.
- XP награды примерно `2x` от authoring-base и формульной сложности; обычный процедурный baseline начинается от `40 * difficulty`.
- Rank `0..4`; relation delta примерно `-8..14`.
- Scarcity и INT могут умножать денежную награду.

### Производство, Караваны, Банк, Рынок

- `src/data/factories.ts`: 12 factories, 42 recipes.
- Production cycles: `60..420s`.
- Production runtime caps: rooms `64`, states `128`.
- Caravan lanes: 6 lanes, fees `18..42`, small caravan seat fees `24..44`, risk `2..4`, cargo deltas `2..6`.
- Banking: deposit `1%` per 60 game minutes, loan `1.5%`, credit limit `500`.
- Stock market: random tick `45s`, spread `0.6%`, commission `1.2%`, max random move `5.5%`, max event move `12%`, drift cap `18%`.

### Бой

- Physical weapon stats live in `src/data/weapons.ts`.
- Melee: урон `3..52`, cooldown `0.20..1.35`, reach `1.35..2.35`, durability `14..120`.
- Ranged examples: `makarov 22/0.52`, `ppsh 8/0.07`, `shotgun 12x7/1.2`, `ak47 26/0.14`, `machinegun 13/0.05`, `grenade 90 AoE 4.5`, `gauss 180`, `bfg 270 AoE 9`, `GBE 500` deletion beam range `30`.
- Расход патронов сейчас ровно `1` ammo item за выстрел, включая дробовик с pellets.
- PSI stats live in `src/data/psi.ts`: cost `3..23`, projectile damage `12..96`, no passive regen.
- Monster base stats: 67 видов, HP `8..1000`, speed `0..3.15`.
- Monster level scaling: HP `+12%`, damage `+10%`, speed `+2%` per zone level.
- Floor zone bonus: Maintenance `+4`, Hell `+9`, Void `+15`.
- Mechanical monster modifier variants are removed; new creatures are standalone packages with ecology/counterplay data, and special tactics use generic bounded AI profiles.

### Самосбор

- New game samosbor timer: `120..180s`.
- Warning window: `18s`.
- Active duration: `12..90s * variant.durationMult`.
- Seal timing: `10s + variant/modifier delta` before end.
- Unsheltered pressure: fog radius `4`, fog strength `155`, `-4 HP`, `-3 PSI`.
- Variant weights: classic `60`, wet `20`, electric `16`, meat `14`, maronary `4`, istotit `3`, veretar `4`.
- Variant duration range roughly `0.82..1.15`, spawn `0.52..1.18`, seal delta `-2..+4` before modifiers.

### A-Life

- `src/systems/alife.ts`: target pool `1_000_000`, fallback `100_000`.
- Runtime memory heuristic: about `43 MB / 100k`, heap reserve `512 MB`, desktop hint `8 GB`.
- Save stores seed, total, dead ids, dead plot ids, changed-record overrides; override cap `12_000`.
- Story floor weights: Kvartiry `10000`, Living `7000`, Ministry `4500`, Maintenance `3500`, Hell `1100`.
- Design floor weight: `520 + danger * 360`.
- Floor plan minimum bucket: `32`.
- Faction base weights: citizens `100`, wild `16`, liquidators `14`, scientists `7`, cultists `4`.
- Majority faction on procedural floors multiplies matching faction by `4.5`.
- Money heavy tail capped at `5_000_000`; bank floor multiplier `6.5`, Ministry `2.4`, Maintenance `1.25`, Hell `0.45`.
- Active floor is limited by generator template slots and entity soft limits, not by total assigned records.
- Entity soft limits: NPC `5000`, monsters `10000`, item drops `100000`.

## 4. Релизные Целевые Диапазоны

### Вылазка

| Тип вылазки | Реальное время | Деньги | XP | Ресурсная цена | Риск |
| --- | ---: | ---: | ---: | --- | --- |
| Стартовая безопасная | 3..6 мин | 60..120₽ | 30..70 | 0..1 вода, 0..1 бинт, 0..12 9mm | один малый бой или социальный риск |
| Обычная ранняя | 6..10 мин | 120..220₽ | 60..120 | 1 вода, 1 еда/бинт, 6..18 9mm | 2..4 малых боя или один medium |
| Средняя маршрутная | 8..14 мин | 150..300₽ | 90..180 | 1..2 воды, 1 медицина, 12..35 ammo | контракт, документ, самосборный риск |
| Высокий риск | 10..18 мин | 300..700₽ | 150..280 | редкий расходник, доступ, долг или репутация | elite, глубокий этаж, кража, самосбор |
| Редкий jackpot | любое | 1000₽+ | 0..400 | уникальный доступ или тяжелое последствие | major faction, rare item, deep route |

Награда выше `1000₽` не должна быть обычным контрактом. Она должна быть редким предметом, rank 4, deep route, банковским/рыночным событием, крупной кражей или authored последствием.

### Потребности

- Обычная экспедиция без пополнения должна жить `8..12` минут по воде и `12..18` минут по еде.
- Warning threshold должен наступать минимум за `90..150s` до HP damage.
- Вода должна быть жестче еды: если игрок пренебрег подготовкой, обезвоживание должно стать первой долгой угрозой.
- Sleep pressure не должен быть главным early killer. Его роль - ухудшать длинные маршруты, не ломать первые 10 минут.
- Pee/poo pressure остается жанровой странностью и маршрутизатором к санузлам, но не должен быть главным источником смерти в первой вылазке.

### Инвентарь

Сейчас `25` слотов и default stack `999` делают hoarding возможным. Для релизного survival это допустимо только если scarcity держится доступностью, а не весом.

Целевые stack caps, если будет отдельный pass:

| Группа | Цель stack cap |
| --- | ---: |
| Вода/еда | 5..10 |
| Медицина | 3..8 |
| 9mm / мелкие патроны | 60..120 |
| Дробь / гарпуны / energy | 10..40 |
| Документы | 1..5 |
| Контрабанда | 1..6 |
| Редкие samples | 1..3 |

Если `999` остается, документировать это как осознанную аркадную уступку и балансировать через доступ, кражу, свидетелей, цены и события.

### XP И Уровни

- Level 2: после `2..3` малых квестов или `8..12` minor kills.
- Level 3: после `1..2` нормальных вылазок.
- Level 5: после нескольких экспедиций, не после одной high-scarcity цепочки.
- INT bonus должен ускорять рост, но не превращать контракты в единственную правильную экономику.
- Измерять time-to-level для INT `0`, `5`, `10`.

### Деньги

| Сущность | Целевой liquid cash |
| --- | ---: |
| Обычный жилец | 0..80₽ |
| Обычный торговец/кладовщик | 80..500₽ |
| Ликвидатор/ученый/служебный NPC | 60..700₽ |
| Министерство/банк special | 500..2000₽ |
| Редкий authored rich | 2000₽+ с явной защитой/событием |

Процедурные миллионеры могут существовать в A-Life pool как редкий хвост, но не должны становиться обычным активным торговым источником. Если такой NPC материализован и доступен для торговли/убийства, это должно быть событие уровня floor story, а не случайный кошелек.

## 5. Экономика И Scarcity

### Рублевая База

Цены должны соотноситься с пользой:

- Вода: цена за hydration должна быть дешевой, но scarcity быстро поднимает давление.
- Еда: дешевле медицины, дороже пустого мусора, полезна как bait и запас маршрута.
- HP: медицина должна стоить ощутимо больше еды/воды; сильная медицина не должна быть дешевле ammo для одного medium боя.
- PSI: восстановление ПСИ должно быть дороже HP за пункт, потому что passive regen отсутствует.
- Документы: цена должна отражать доступ, риск аудита и альтернативный путь, не только sell value.
- Редкие samples: цена должна создавать выбор - сдать НИИ, продать, спрятать, использовать, подделать или унести.

### Формула Награды

- Legal fetch: total reward value `1.3..2.0x` consumed target value.
- Illegal fetch/theft: `2.0..3.0x`, но с faction/audit/theft risk.
- Kill contract: expected ammo + medicine cost + `25..75%`.
- Visit/inspect: меньше денег, больше route knowledge, documents, permits, rumors.
- Escort/TALK: плата ниже kill, но выше visit, если нужен cross-floor маршрут.
- Repair: оплата должна покрывать item input plus social/economy change, но не печатать деньги.

`rewardResourceId` и scarcity multiplier не должны поднимать обычный контракт выше high-risk диапазона без изменения риска.

### Теневые Цены Ресурсов

Для production нужно назначить shadow ruble values всем abstract resources и валидировать recipes:

| Ресурс | Предлагаемый shadow price |
| --- | ---: |
| labor | 4..8₽ |
| drink_water | 2..5₽ |
| food | 4..8₽ |
| medicine | 25..55₽ |
| metal | 8..18₽ |
| ammo | 12..35₽ |
| tools | 25..70₽ |
| paper/documents | 8..45₽ |
| fuel | 35..80₽ |
| electronics | 60..160₽ |
| psi | 150..400₽ |
| slime/zhelemish/contraband | context-only, через риск и фракцию |

Public/room recipe output should be input shadow value * `1.1..1.4`.
Locked/illegal/faction recipe output can be `1.5..2.2`, but must have access risk.
Energy cells, door kits and ammo batches need extra scrutiny because they convert abstract stock into high-value route power.

### Контейнеры

`src/data/container_defs.ts` defines `proceduralValueCap`. Procedural floor loot uses value budgeting, but generic room container seeding must also enforce a max sell value or use a separately named cap.

Цели:

- Public emergency box: survival support, not jackpot.
- Room/owner containers: modest value, social risk.
- Locked safe/secret stash: strong value, audit/theft risk.
- Weapon crate: ammo and weapon access, not free early military kit.
- Production output container: must offer a decision: buy, steal, repair, guard, reroute, expose.

Metric: generated container sell value should stay under `proceduralValueCap`, except authored containers that explicitly document why they exceed it.

### Торговля

- Default spread buy `1.15` / sell `0.85` is good as a baseline.
- Wild sell `0.72` should make black-market liquidation worse unless the item is contraband.
- Scientist sell `0.92` is strong; keep science samples narrow and event-tagged.
- Traders must have cash caps. A rich buyer without liquidity cap turns rare loot into immediate snowball.

### Караваны

Caravan `feeRubles` and `seatFeeRubles` are balance levers only if the runtime actually deducts money.

Цели:

- Paying a lane tariff should cost listed rubles or a clearly equivalent item/debt.
- Seat fee should buy route access, not free relation.
- Caravan success should move resource stock over multiple ticks or events, not instantly erase shortage.
- Raid/reroute/report must have different economy and reputation outcomes.

Metric: caravan action ROI must be visible as supply stability, route access or relation, not free money.

### Банк И Фондовый Рынок

Bank deposit at `1%` per game hour and stock random move up to `5.5%` every `45s` can outrun expedition income once player has capital.

Релизная цель:

- Passive deposit yield must stay below expedition yield.
- Loan should fund one sortie, not stock leverage.
- No reliable doubling of account in under `30` real minutes without event knowledge, rare risk or exploit.
- Round-trip market friction should exceed casual random edge.

Предлагаемое направление:

- Deposit closer to `0.1..0.3%` per game day, or add bank risk/tax/lockup.
- Keep loan rate punitive and social: debt opens doors but closes others.
- Market should reward information from events/rumors, not idle clicking.

## 6. Оружие, Патроны И PSI

### Ролевые Тиры

| Tier | Роль | Пример | Баланс-правило |
| --- | --- | --- | --- |
| Emergency melee | выжить без ammo | knife, pipe, wrench | доступно, но рискованно |
| Industrial melee/tool | ресурсная работа и бой | crowbar, hammer, fire hook | полезно вне боя или durability-gated |
| Sidearm | точный дешевый выстрел | makarov, TT, nagant | ammo pressure, noise, low burst |
| Shotgun burst | коридорный стоппер | shotgun, TOZ | один shell = сильный burst, shells редкие |
| Прожиг патронов | темп за расход | ППШ, AK, machinegun | DPS высокий, ammo/noise/heat сильные |
| Rare energy | поздний tier | gauss, plasma, BFG, GBE | access + rare ammo + лут/мир risk |
| PSI | emergency/utility | strike, phase, control | нет regen, cost решает |

Любое оружие выше своего tier должно иметь один явный ограничитель:

- ammo rarity;
- windup/reload/cooldown;
- noise and faction response;
- durability;
- self-risk;
- access permit;
- relation/audit risk;
- loot destruction;
- world destruction;
- high PSI cost.

### Бюджет Патронов

- Small ammo source: `1` medium fight или `2..4` trash kills.
- Weapon crate: `2..3` fights, но через access/theft/faction gate.
- Стартовая firearm path: `6..12` 9mm, не больше.
- Дробь считать burst resource, не обычной bullet currency.
- Energy cell не должна быть просто дорогой пулей; это late-route decision.
- GBE/deletion beam балансируется как world-editing tool, а не DPS.

### TTK

| Ситуация | Цель |
| --- | --- |
| Trash monster dies | `1..3` cheap hits/shots |
| Medium monster dies | `3..6` prepared hits/shots |
| Heavy monster dies | требует подготовки, kiting, burst или отказа от боя |
| Player vs isolated trash | `8..15s` до смерти при ошибках |
| Player vs medium | `4..8s` до смерти |
| Player vs elite | `2..4s` после читаемого warning/windup |
| Boss/heavy ranged | смерть возможна только после телеграфа или игнора механики |

Hell/Void high damage допустим, но generic hit по full-health same-tier игроку должен обычно оставить время на одно решение: дверь, угол, лечение, рывок, PSI, отход.

### PSI

Правило: passive PSI regen нет. Это хорошо для survival.

Цели:

- Cheap PSI: utility, finisher, escape.
- High PSI: решить одну emergency, не заменить ammo economy.
- Brainburn остается level-gated и не bypass-ит boss readability без явного exception.
- Item descriptions and `src/data/psi.ts` must match. Несовпадение cost/damage в релизе ломает доверие к HUD.

## 7. Монстры

Монстр должен быть не HP/speed мешком, а правилом поведения.

| Вид | Роль | Баланс-ошибка игрока |
| --- | --- | --- |
| SBORKA | быстрый слабый расход патронов | поздний дешевый выстрел, узкий поворот |
| KRYSNOZHKA | пищевая стая | еда в кармане, поздняя дробь |
| TVAR | средняя ближняя угроза | прижался к панели, не держал дистанцию |
| POLZUN | медленный танк | бой в двери, ванной или воде |
| EYE | дальняя линия обзора | стоял на прямой, не сломал LOS |
| SHADOW | темный ambush | не вышел в свет, не отступил |
| REBAR | debris lurker | принял железо у стены за декор |
| PECHATEED | документная угроза | тащил бумаги в бой |
| TUBE_EEL | вода/трубы | стоял в лотке |
| PARAGRAPH | дальний бюрократический выстрел | не вошел после залпа |
| NELYUD | ложный человек | подпустил без выхода и свидетеля |
| KOSTOREZ/SAFEGUARD | telegraphed elite | остался в замахе, не сбил дробью |

### Варианты

Целевые коридоры множителей:

- HP: `0.55..1.60`.
- Speed: `0.75..1.40`.
- Damage: `0.80..1.55`.

Damage multiplier above `1.25` needs stronger cue/counterplay or lower HP. Ambush variants need death-log clarity. Armored variants need route answer: shotgun, heavy weapon, PSI, bait, light, water edge, document drop, door, angle or refusal.

## 8. Самосбор

Самосбор должен быть местным выбросом, не бесконечной мясорубкой.

Правильная структура:

1. Предупреждение: сирена/тишина/экран/NPC bark/map signal.
2. Решение: укрыться, бежать, закрыть дверь, спасти NPC, бросить лут, рискнуть.
3. Активная фаза: fog, monsters, local beat, ограниченная зона давления.
4. Aftermath: shortage, residue, route block, container theft, faction panic, rumor.

Балансировать нужно не total spawns, а active threats near player.

Цели:

- Warning `18s` должен быть реальным временем решения.
- Near-player active pressure: обычно `3..7` угроз.
- Rare spike: `8..10` угроз, только при high-risk или плохом укрытии.
- Fog spawn cadence должен отступать, если локальная плотность уже высокая.
- Unsheltered pressure `-4 HP/-3 PSI` хороша как предупреждение, но не должна убивать без шанса понять источник.
- Aftermath должен создавать проблему, а не только декор.

Метрики:

- threats within radius 20 during active phase;
- player damage during warning/active/aftermath;
- shelter success rate;
- aftermath events per samosbor;
- resource stock deltas after samosbor;
- deaths by source: fog, monster, door, need, faction.

## 9. A-Life Баланс

A-Life меняет главный смысл баланса: мир не refillится, а истощается и мигрирует.

### Бюджеты

| Бюджет | Что значит | Кто владеет |
| --- | --- | --- |
| Identity budget | 100k/1m persistent NPC records | `systems/alife.ts` |
| Floor assignment budget | route-key buckets | A-Life generation data |
| Live slot budget | generator templates + entity caps | `gen/`, entity limits |
| Event actor budget | samosbor/quest/faction/caravan/lift actors | owning event system |
| Economy output budget | NPC pockets + containers + rewards + production | economy/content modules |

Большой bucket не означает больше live actors. Live density задают templates, authored anchors, explicit encounters и soft limits.

### Постоянные Смерти

Убийство NPC теперь стоит:

- минус торговец или покупатель;
- минус quest candidate;
- минус witness;
- минус pocket/cash carrier;
- минус family/social edge;
- минус faction body;
- изменение слухов/отношений;
- empty materialization slot on revisit.

Это не баг. Баланс должен сделать цену читаемой и не давать игроку бесконечно фармить одно и то же население.

### Источники Квестов

Сейчас A-Life records получают стабильный `canGiveQuest` при генерации identity: шанс `10%` без профессий-фонтанов поручений. Контекстный reroll для неперсистентных NPC использует тот же `10%` и не перезаписывает `persistentNpcId`.

Цель:

- Разделить `canGiveQuest` как affordance и `currentlyOfferingQuest` как cooldown/state.
- Мерить offers per 100 NPC interactions.
- Ввести cooldown per `persistentNpcId`, если плотность превращает этаж в бесконечную доску.
- Killing quest giver is a world fact, not spawn failure.
- Fallback content должен быть data-defined, не respawn.

### Метрики ALife

Минимальный релизный balance snapshot:

- `alife_total`, `alive`, `dead`, `dead_per_floor_key`;
- `floor_bucket_size`, `template_slots`, `materialized_count`, `dead_empty_slots`;
- `npc_live_count / 5000`, `monster_live_count / 10000`;
- faction distribution assigned vs materialized;
- level p50/p90/p99/max by floor danger and faction;
- money p50/p90/p99/max and counts `>=100k`, `>=1m`, `>=5m`;
- average inventory slots/value by faction/floor;
- quest offers/accepted/completed/failed per hour;
- faction event rate per 10 minutes;
- event NPCs/hour, event drops/hour, pressure cells/hour;
- permanent deaths/hour by player, NPC, samosbor, event;
- save override pressure: `overrides / 12000`.

## 10. Фракции, Кража, Документы

Коридоры отношений:

- Relation `-100..100`.
- Hostile threshold `-50`.
- A-Life personal jitter `±12`.
- Normal quest completion: faction `+1`, giver personal `+2..8`.
- Forgery/theft severity should be high enough that repeated abuse closes services before it becomes best economy path.

Documents are route keys, not vendor trash. A forged pass must buy access at the price of audit risk. A stolen official paper must be economically useful but socially dangerous.

Цели кражи:

- Public container: low value, low social cost.
- Room/owner container: medium value, witness/audit risk.
- Faction container: faction cost and delayed consequence.
- Secret stash: high value, discovery risk, illegal market hook.
- Safe: high document value, strong lock/audit/faction path.

## 11. Аудит Мудрецов: Consensus Дыры

Эта секция добавлена после независимого аудита экономики, боя/выживания и A-Life. Здесь `100%` означает не вкус и не стиль, а code-confirmed риск: если проблему не закрыть, любые численные правки будут ненадежны.

### 100% Code-Confirmed P0

| Проблема | Почему ломает баланс | Релизная рекомендация | Метрика |
| --- | --- | --- | --- |
| NPC death finalization не единая | смерть от NPC, монстра, needs или hazard может удалить live entity до записи A-Life death | любая смерть NPC проходит через финализатор до cleanup: A-Life death, plot death, quest fail/notify, event, loot drop один раз | `unfinalized_dead_npc = 0`; deaths by source fold into A-Life/plot |
| Караваны могут быть бесплатными | `feeRubles` и `seatFeeRubles` являются ценами только в data, если runtime их не списывает | paid caravan action должен списать деньги, предмет или долг; иначе не показывать цену | `caravan_paid_actions_without_cost = 0` |
| Container value caps не универсальны | `proceduralValueCap` не должен быть декоративным; room containers, safes, stashes и weapon crates могут выдать route power раньше времени | применять cap ко всем generated room containers или разделить `proceduralFloorValueCap` и static room caps; authored exceed требует reason/tag | `generated_container_value_p50/p90/p99/max by kind` |
| Passive finance обгоняет вылазки | deposit `1%` per game hour и stock move до `5.5% / 45s` могут заменить expedition loop после накопления капитала | passive finance p75 за 30 real minutes ниже ordinary expedition p50; рынок дает edge через rumors/events, не idle ticks | `finance_yield_30m: expedition/bank/stock`; `reliable_double_30m = 0` |
| Contract reward stacking выходит за tier | scarcity cap + INT reward превращают обычный contract в jackpot без jackpot-risk | считать reward after all modifiers; rank 0..2 <= `300₽`, rank 3 <= `700₽`, `1000₽+` только `jackpot/high_risk/deep_route` | `contract_reward_after_modifiers_p95/max by rank/risk` |
| Persistent quest sources без stable lock | transient `entity.id` не годится как долгоживущая identity; persistent NPC может рематериализоваться и снова стать источником | quest stores `giverPersistentNpcId` and `targetPersistentNpcId`; per persistent NPC `currentlyOfferingQuest`/cooldown | `same_npc_quests_per_game_day <= 1`; `offers_per_100_interactions` |
| Dense floors становятся доской торговли/поручений | тысячи NPC нельзя превращать в тысячи vendors/quest boards | интерактивная плотность считается отдельно от live density: offer NPC, active vendors, generated trade inventory, buy liquidity | `offer_npc_near_player`, `active_vendors_near_player`, `generated_trade_value_per_100_npc` |
| Production recipes не доказаны shadow value | output containers могут превращать abstract stock в ammo, energy, food или tools без реальной цены доступа | каждый recipe проходит input shadow audit; ammo/energy/door kits требуют отдельного access-risk | `recipe_output_sell_value / input_shadow_value` |

### P0 Implementation Notes

- Death finalizer должен вызываться до `cleanupDeadEntities()` и быть общим для player kill, NPC combat, monster kill, needs, hazards, samosbor и faction events.
- `persistent wealth != trade liquidity`: off-floor богатство может существовать в A-Life, но active buy budget должен быть отдельным и малым.
- Любой `1000₽+` payout должен объясняться риском: deep route, rare item, faction betrayal, debt, timed danger, major theft или authored plot consequence.
- Если `proceduralValueCap` остается только для procedural floor loot, переименовать его; иначе документ и data будут обещать больше, чем runtime делает.

### P1 High-Risk Recommendations

- Первый samosbor после new game должен быть не раньше `480..720s`, либо быть scripted tutorial samosbor без fog boss и random-map spawn. До первого prep/cache warning должен быть `>=30s`.
- Samosbor fog spawn должен backoff, если hostile threats within radius 20 от игрока `>=7`, within radius 12 `>=4`, или hostile LOS threats `>=3`. Rare spike: максимум `10` угроз в radius 20 и только high-risk variant/modifier.
- Stack `999` для еды, воды, медицины, ammo и grenade превращает survival-инвентарь в склад. Если оставить `999`, это explicit arcade concession; иначе перейти к caps из секции inventory.
- `generateNpcTradeItems()` не должен создавать route-power supply faucet. `door_kit`, rare tools, permits, energy ammo и late weapons требуют faction/access/event gate.
- Faction/caravan/samosbor/hack actors делятся на `temporaryEventActor` и `persistentArrival`. Первый имеет bounded lifetime/loot и не население; второй получает или резервирует A-Life identity.
- Early murder/theft не должен срезать weapon/document ladder: в safe radius `<=80` клеток от старта не должно быть random armed firearm NPC кроме authored/tutorial. Убийство armed service NPC вызывает response within `30..60s` или закрывает услуги/доступ.
- Rare energy нельзя балансировать одним `ammo_energy`: GBE/BFG требуют unique charge, audit/noise/loot destruction или `1..3` uses до пополнения.
- Route-bypass PSI (`phase`, `mark/recall`, `control`) не должен проходить quest-critical locks, hermetic seals и authored hard gates без explicit exception; bypass должен стоить `>=70%` current max PSI или расходник/долгий cooldown.
- INT надо проверять как possible dominant stat: time-to-level и rubles/hour при INT `0/5/10`; INT не должен давать `>25%` total sortie ROI преимущества без боевого или социального риска.
- Kill contracts по monster kind должны иметь place/source/risk binding, если награда выше low-tier. Случайный kill того же вида не должен закрывать expensive contract без route commitment.

### Пересобранный P0 Список

1. Единый NPC death finalizer до cleanup.
2. Реальная оплата caravan tariffs/seats.
3. Универсальные generated container value caps или честное переименование cap.
4. Passive finance ниже expedition yield.
5. Contract reward tier caps after scarcity + INT.
6. Persistent quest source state/cooldown by stable id.
7. Dense-floor interactive density caps: quest offers, vendors, trade inventory, active liquidity.
8. Production shadow-value audit.
9. Samosbor first-run delay and local threat backoff.
10. Route-power supply gates: early murder/theft, rare energy, PSI bypass, generated NPC trade.

## 12. Баланс QA

### Обязательные Проверки

- Data-only/doc-only: read and inspect; typecheck only if TS changed.
- Gameplay systems, save/load, AI, generation, rendering, economy: `npm run check`.
- Render/UI changes: smoke or browser check plus visual inspection.
- Release candidate: `npm run check:full` when Chrome is available.

### Баланс-Снимок, Который Нужно Добавить

Нужен debug/read-only snapshot, который можно запускать без ручного прохождения:

- item value distribution by type;
- weapon DPS/resource/cost table;
- PSI cost/damage text mismatch audit;
- contract reward distribution before/after scarcity;
- generated container value distribution by kind;
- A-Life level/money/faction percentiles;
- active floor materialization count and empty dead slots;
- unfinalized dead NPC count by source;
- quest offers per 100 NPC interactions and same persistent NPC quests per day;
- active vendor count, generated NPC trade value and buy liquidity near player;
- caravan paid actions without cost;
- local samosbor threat count over time;
- finance yield comparison: expedition vs bank vs stock;
- contract reward after all modifiers by rank/risk tag;
- production recipe input/output shadow value;
- carried water/food minutes and ammo fights from current inventory.

### Сценарии Плейтеста

1. Стартовая вылазка: взять публичный набор, дойти до первого контракта, пережить один малый риск, вернуться.
2. Дефицит патронов: пройти 3 ранних боя с ПМ и ограниченным 9mm; проверить, что melee/retreat остаются решениями.
3. Дробовой залп: один shell должен решить коридорную проблему, но не стать универсальным ответом на этаж.
4. Путь кражи: украсть из owner/faction container, увидеть экономическую выгоду и социальную цену.
5. Укрытие от самосбора: получить warning, закрыться, пережить, увидеть aftermath.
6. Провал самосбора: игнорировать warning, получить понятный damage/death cause.
7. Постоянство смерти A-Life: убить ordinary NPC, уйти/вернуться, подтвердить empty slot and event consequence.
8. Экономика контрактов: завершить legal, illegal, kill, visit, repair contracts and compare reward/cost.
9. Производственный цикл: взять output, проверить shadow value and access risk.
10. Финансовый цикл: попытаться заработать банком/рынком быстрее вылазок; это не должно быть надежным default.
11. Смерть не от игрока: дать монстру/NPC/hazard убить persistent NPC, уйти/вернуться, подтвердить permanent death.
12. Плотный этаж: на Kvartiry/high-density floor измерить offers per 100 interactions, active vendors and generated trade value.
13. Караванная оплата: оплатить tariff/seat и подтвердить реальный cost before reward.
14. Контейнерный cap: сгенерировать safes/weapon crates/tool lockers and compare sell value to declared cap.

## 13. Готовность Баланс-Пасса

Баланс-пасс считается релизно полезным, если:

- первая вылазка не зависит от удачного seed для базового выживания;
- оружие имеет разные роли, а не одну DPS-лестницу;
- дефицит патронов заставляет выбирать, но не делает бой нечитаемым;
- самосбор дает warning, shelter decision и aftermath;
- контракты оплачивают риск, а не печатают деньги;
- производство и караваны меняют scarcity с ценой и задержкой;
- банк/рынок не заменяют экспедиции;
- убийство persistent NPC сохраняется и имеет понятную цену;
- A-Life не подменяется refill-логикой;
- все `100%` consensus P0 из аудита имеют runtime gate или explicit metric failure;
- death cause, HUD, слухи и события объясняют игроку, почему он проиграл или выиграл;
- все новые balance changes проходят соответствующий gate и имеют один конкретный маршрут проверки.
