# ГИГАХРУЩ: Экономика

Дата: 2026-05-27
Статус: центральный документ макроэкономики, лута, наград и численного прогресса. Ниже сохранен полный план фундаментального реворка и внедренного фундамента; shipped facts отражаются в `README.md`. `balance.md` остается текущим баланс-контрактом, `alife.md` - контрактом постоянного населения, `korovan.md` - контрактом холодной A-Life/караванной логистики, `ai.md` - контрактом активного AI.

> Центральный документ экономики.
>
> Роль: описывает деньги, цены, производство, ресурсы, фракционные рынки, зоны, scarcity, караваны, банк, контракты and inter-floor macro pressure. Связан с `balance.md`, `alife.md`, `korovan.md`, `items.md`, `floors.md` and `quests.md`.

Документ собран после чтения `README.md`, `architecture.md`, `balance.md`, `alife.md`, `ai.md` и релевантных `src/` файлов. Шесть параллельных обзоров были разделены по зонам: экономика/торговля, лут, оружие/PSI/RPG, квестовые награды, A-Life wealth, AI/опасность. Три исходных обзора оборвались на удаленной компакции инструмента, поэтому недостающие зоны были повторены короткими срезами.

## 0. Shipped Foundation 2026-05-27

Внедрено первым проходом:

- `src/data/economics.ts` задает E0..E4 money bands, топ-gear value floors, `PSI >= 10_000₽`, major reward tags и depth-aware procedural loot caps.
- `src/systems/quest_rewards.ts` стал runtime-расчетом наград для system contracts и procedural NPC quests по objective value, route depth, danger, giver level/wealth, scarcity и major tags.
- `src/data/items.ts` ребейзнут под длинную лестницу: sidearms больше не стоят меньше стартовых денег, mid rifles/launchers/flamers/LMG ушли в тысячи, energy/PSI/top gear ушли в десятки и сотни тысяч, а базовая `ammo_energy` держится в сотнях как дорогой боеприпас, не как отдельное endgame-оружие.
- Procedural floor loot теперь ограничивается не только `danger`, но и `abs(z)`: случайный высокий danger около старта не открывает E4 loot cap, а глубокие route floors сохраняют дорогие weapon crates/stashes.
- A-Life NPC wealth разнесен на те же честные денежные поля, что и у игрока: `money` как наличные и `accountRubles` как счет; wealth считается суммой, а save shape поднят.
- Добавлены unit tests для PSI/top gear floors, физической weapon ladder, depth-aware loot caps и bounded quest reward difficulty.

## 1. Главная Цель

Экономика должна выдержать длинный прогресс:

- старт: `100₽` - это много, игрок считает воду, бинты, патроны и мелкий долг;
- ранняя игра: сотни рублей уже позволяют подготовить вылазку, но не купить безопасность;
- середина: тысячи и десятки тысяч рублей открывают оружие, документы, производство, караваны и рискованные сделки;
- поздняя игра: сотни тысяч рублей нужны для топового оружия, PSI, редких зарядов и фракционных доступов;
- эндгейм: миллионы существуют как богатство мира и NPC-миллионеров, но не как обычная добыча из кармана.

Рубль должен быть не только счетчиком. Он должен связывать вылазку, риск, лут, NPC, фракцию, производство, караваны, банк, рынок, самосбор и постоянные смерти.

## 2. Жесткие Правила

- Не делать обычный population refill ради экономики.
- Не превращать NPC-миллионера в мешок с миллионами после убийства.
- Не добавлять per-frame full-world, full-entities или full-A-Life scans.
- Не делать новый `FloorLevel` для экономических тиров, этажных номеров, маршрутов или лут-ступеней.
- Не прятать content-specific экономику в `main.ts`, `render/`, `core/world.ts` или broad AI.
- Не балансировать BFG, GBE, gauss и сильное PSI только ценой: нужны доступ, заряд, шум, аудит, потеря лута, cooldown, фракционная цена или route risk.
- Если новая persistent state shape нужна для караванов, trade reserves, wealth overrides или quest cooldowns, bump `SAVE_SHAPE_VERSION` и reject stale saves явно.

## 3. Владение Системами

Деньги, ресурсы, цены:

- `src/data/resources.ts` - ресурсные классы и item-to-resource mapping.
- `src/data/economy.ts` - save/state формы экономики floor/route.
- `src/data/economy_rules.ts` - demand, tariff, trade spread, route decision rules.
- `src/systems/economy.ts` - scarcity, prices, adjusted rewards, stock mutation, events.
- `src/systems/trade.ts` - player/NPC trade transactions and liquidity failure.

A-Life wealth:

- `src/systems/alife.ts` - persistent `record.money` cash, `record.accountRubles` account balance, foldback, deaths, save projection.
- `src/data/alife_generation.ts` - faction wealth multipliers, pockets and generation profiles.
- `src/systems/alife_rating.ts` - rank/social score view.

Loot and containers:

- `src/data/items.ts` - item values, spawn rooms, weights, tags, use effects.
- `src/data/container_defs.ts` - container kind pools, access, value caps.
- `src/systems/containers.ts` - runtime access, theft, buy/unlock, stock events, save normalization.
- `src/data/procedural_floors.ts` and `src/gen/procedural_floor.ts` - route danger, procedural loot caps and placement.
- `src/data/monster_ecology.ts` and `src/systems/monster_drops.ts` - monster rare drop definitions and kill-time drops.

Weapons, PSI, HP, damage:

- `src/data/weapons.ts` - physical weapon stats and role tiers.
- `src/data/psi.ts` - PSI weapon stats.
- `src/data/items.ts` - weapon/PSI item prices and availability tags.
- `src/systems/rpg.ts` - XP, HP, PSI, attribute multipliers, monster scaling, quest reward helpers.
- `src/systems/inventory.ts`, `src/systems/psi.ts`, `src/systems/weapon_beams.ts`, `src/systems/ai/combat.ts`, `src/main.ts` - execution paths that currently apply weapon/PSI/combat effects.

Quests and contracts:

- `src/data/plot.ts` - plot and side quest definitions/registries.
- `src/data/contracts.ts` - system assignment templates, target route metadata, static rewards.
- `src/systems/quests.ts` - quest generation, completion, payout, relation changes.
- `src/systems/contracts.ts` - contract conversion and adjusted contract money paths.

AI and floor risk:

- `src/data/design_floors.ts`, `src/data/procedural_floors.ts` - route `z`, danger, role and anomaly.
- `src/gen/design_floors/population.ts`, `src/gen/procedural_floor.ts` - floor population/loot/monster use of danger.
- `src/entities/monster.ts`, `src/data/monster_ecology.ts`, `src/systems/ai/monster.ts` - monster threat identity, ecology and behavior.

Finance and logistics:

- `src/data/banking.ts`, `src/systems/banking.ts` - player account, deposits, loans, ledger.
- `src/data/stock_market.ts`, `src/systems/stock_market.ts` - quote and portfolio loops.
- `src/data/caravans.ts`, `src/systems/caravans.ts` - caravan lanes, resource movement, active runs.
- `src/data/factories.ts`, `src/systems/production.ts` - production input/output conversion.

Craft components:

- `src/data/craft_materials.ts`, `src/data/item_composition.ts`, `src/data/craft_recipes.ts` and `src/systems/crafting.ts` describe personal item crafting/disassembly. These 9 craft materials are not `ResourceDef`s and do not automatically enter floor scarcity, caravans or market quotes.
- Economy hints are advisory only: `mechanics` relates to tools/labor/metal, `electronics` to existing electronics, `chemical` to fuel/medicine/industrial slurry, and `bio` to slime/zhelemish/fungal inputs. `cybernetics`, `psimatter` and `metamatter` are rare craft materials, not broad macro resources.

## 4. Current Gaps To Fix

The current code already has useful pieces, but they do not yet form one long economy.

- Prices are too compressed for long progress. Current top item prices are around tens of thousands, while the target needs top weapons in hundreds of thousands and NPC wealth in millions.
- A-Life now separates NPC `money` cash and `accountRubles` account balance, but gameplay does not yet explain rich NPC wealth through assets, credit, vaults, debt, trade reserve or social protection.
- Many expensive weapons/PSI are not clearly tied to resources in the economy quote path. `ItemType.WEAPON` has no generic resource fallback, so rare energy and PSI can bypass scarcity/tariff unless explicitly listed.
- BFG, GBE, gauss and plasma compete for the same `ammo_energy` resource. That is too flat for late game.
- Monster rare drops depend mostly on monster kind and RNG, not route `z`, danger, anomaly, pressure or economy context.
- Container pools are broad kind-level pools. They need floor/danger overlays and stricter early scarcity.
- Generated container caps are still small and local; they do not express a long ladder from empty early floor to deep high-value stash.
- Quest rewards are stored and paid as flat numbers in many places. Distance, route depth, plot phase, giver level and objective risk are not one canonical reward calculation.
- Passive finance can outrun the expedition loop if capital grows enough. Deposits and stock movement must not become the best low-risk activity.
- Caravans have limited persistent A-Life member ids and saved active-run continuity, but ownership, escorts, debt and asset risk are not yet one economy contract.

## 5. Target Money Scale

Use these as target bands, not exact constants. All prices are pre-scarcity base values unless stated otherwise.

| Band | Progress | Liquid cash player expects | Ordinary quest payout | Generated loot sale value | Gear target |
| --- | --- | ---: | ---: | ---: | --- |
| E0 | старт, hub, first safe run | `0..250₽` | `25..180₽` | `0..90₽` | water, bread, bandage, 9mm, knife, pipe |
| E1 | early route | `250..2_000₽` | `120..800₽` | `20..450₽` | pistol, cheap shotgun, basic tools |
| E2 | mid route | `2_000..25_000₽` | `600..6_000₽` | `150..4_000₽` | rifles, SMG, grenades, production tools |
| E3 | late route | `25_000..250_000₽` | `4_000..45_000₽` | `1_000..80_000₽` | energy weapons, rare ammo, strong PSI |
| E4 | endgame wealth | `250_000₽..millions` | `25_000..250_000₽` | `10_000..250_000₽` | BFG, GBE, vault assets, route-changing PSI |

Rules:

- `100₽` must remain meaningful at start. A starter run should not casually produce several thousand rubles.
- `1_000₽+` early payout requires visible risk: theft, faction audit, dangerous route, rare sample, deep target, debt, timed pressure or authored consequence.
- `100_000₽+` payout is not normal contract money. It is a late route asset, vault theft, faction betrayal, unique weapon sale, high-risk market event or plot-scale outcome.
- `1_000_000₽+` is wealth tier, not pocket cash. It should appear through A-Life rank, bank assets, debts, contracts, safe ownership and world rumors.

## 6. Target Price Ladder

Basic survival:

- water/tea/bread: `2..15₽`;
- ordinary food: `5..60₽`;
- bandage/simple medicine: `15..150₽`;
- strong medicine/PSI stabilizer: `250..2_500₽`;
- 9mm and light ammo: `5..25₽` per useful shot equivalent;
- shells, 7.62, harpoon, belt chunks: `40..600₽` per tactical unit.

Weapons:

- early melee/tools: `15..300₽`;
- sidearms: `300..1_500₽`;
- early shotgun/SMG: `900..5_000₽`;
- mid rifles, launchers, flamers, LMG: `5_000..40_000₽`;
- late energy weapons: `40_000..150_000₽`;
- BFG/GRN/GBE class: `120_000..500_000₽` equivalent, usually not normal-shop purchase;
- unique world-editing gear can exceed `500_000₽` if it is controlled by vault, route, charge or faction access.

PSI:

- PSI weapons/items should not be cheaper than `10_000₽` in value scale.
- If PSI is granted by a quest before the player can normally buy it, count it as a valuable reward in the quest budget. Do not multiply item entities with special restricted or crippled duplicate versions.
- Utility PSI that changes route topology or agency, such as phase, control, mark/recall and brainburn, needs either high money price, percentage max-PSI cost, rare reagent, cooldown, route-lock exceptions or audit risk.
- Late PSI beam/void class should sit in `25_000..100_000₽+` and be constrained by PSI economy, not only inventory price.

Top gear ammo:

- BFG/GBE/GRN must not be balanced only by plain `ammo_energy` at about `300₽`.
- Add unique charges, charge packs, degraded batteries or faction-owned cells.
- Strong shots need a per-use economy decision: `5_000..20_000₽` equivalent for endgame shots, or explicit non-money cost such as destroyed loot, route heat, debt, audit or permanent faction hostility.

## 7. A-Life Wealth Model

A-Life now has the right universal money boundary:

- `AlifeNpcRecord.money` is cash in pockets/inventory.
- `AlifeNpcRecord.accountRubles` is the NPC bank/account balance.
- NPC wealth is `money + accountRubles`, same conceptual split as player cash plus account.
- Rich records are rare and total wealth is capped at `5_000_000`.
- Ordinary generation keeps about `8..14%` of each NPC's capital as cash and puts the rest on account; there is no artificial pocket cap.

Keep that boundary and make it player-facing.

Wealth tiers:

| Tier | Total wealth | Pocket cash | Gameplay meaning |
| --- | ---: | ---: | --- |
| poor | `0..100₽` | about `8..14%` | resident, queue, ration, small debt |
| stable | `100..2_000₽` | about `8..14%` | ordinary trader, worker, minor official |
| official | `2_000..50_000₽` | about `8..14%` | permit access, better trade reserve, documents |
| rich | `50_000..1_000_000₽` | about `8..14%` | protected assets, safe keys, debt papers |
| millionaire | `1_000_000₽+` | about `8..14%` | rare A-Life actor, faction protection, vault/route event |

Rules:

- Killing rich NPC exposes the cash share, not the full account balance.
- Rich wealth converts into assets: bank ledger, debt note, safe ownership, caravan share, protected storage, trade reserve, rumors, faction response.
- Selling to a rich trader should use a bounded trade reserve derived from wealth and role. It must still be depleted and folded back.
- Persistent NPC trade inventory should be deterministic or event-gated. Do not let menu-open random restock become an infinite faucet.
- Millionaire deaths should publish events with `persistentNpcId`, wealth tier, faction, floor/room and consequence tags.

## 8. Loot Rework

Loot has to stop being a flat room lottery and become a risk ladder.

### Loot Sources

| Source | Early | Mid | Late |
| --- | --- | --- | --- |
| public containers | survival only | survival plus small documents | still low, not jackpot |
| room/owner containers | small value, theft risk | useful supplies, social cost | faction audit, selected value |
| locked safes | papers/access, not huge cash | permits, debt, samples | vault keys, asset notes, rare route papers |
| weapon crates | tiny early ammo | controlled guns/ammo | rare charges and restricted weapons |
| monsters | low-value trophies | samples/reagents | high-value trophies from dangerous kinds |
| NPCs | pocket cash, small loadout | gear and social consequence | assets, keys, reserve, faction response |
| high route floors | sparse but valuable | strong guarded stashes | primary source of rare loot |

### Early Scarcity

On starting and near-center floors:

- most containers should be empty, survival-only, or socially risky;
- sell value of casual room loot should stay low;
- weapon crates should mostly be ammo scraps, knives, weak firearms or locked faction property;
- strong route power must come from authored/debug/tutorial paths, not random early container luck;
- public prep can provide minimal survival kit, but it must not become a free store.

### High-Depth Loot

High-numbered route stops and high `abs(z)` floors should be where serious loot appears:

- rare energy charge packs;
- high-value PSI reagents;
- monster trophies that sell for thousands or tens of thousands;
- vault papers, faction debt, bank keys, route permits;
- late weapons as guarded, audited, or consequence-heavy finds;
- high-value containers with explicit access, threat, or event reason.

### Monster Drops

Current monster rare drops are a good base, but they need context:

```txt
dropChance = baseKindChance
  * dangerMult
  * routeDepthMult
  * anomalyMult
  * firstKillOrEliteMult
  * economyDemandMult
  * localCapBackoff
```

Implementation direction:

- keep rare drop definitions in `src/data/monster_ecology.ts`;
- extend `dropMonsterRareLoot()` with optional risk context: route key, z, danger, base floor, anomaly, monster level;
- publish trophy/drop events with resource id, danger, z and monster kind;
- mutate resource stock on sale, handoff, production use or explicit extraction, not every time a body falls;
- add caps so high-density monsters do not print infinite high-value loot.

### Containers

The current `proceduralValueCap` concept should become universal and explicit.

Targets:

- public emergency box: `0..120₽`, survival support only;
- ordinary room/owner container: `0..300₽` early, `100..2_000₽` mid, but theft risk;
- locked safe: documents/access first, `300..10_000₽` depending on depth/risk;
- weapon crate: ammo and access, not free early military kit;
- deep vault/stash: `10_000..250_000₽` only with route/faction/threat reason.

If a generated container exceeds its cap, it needs an authored reason/tag. Otherwise the audit should fail.

## 9. Quest Reward Rework

One reward helper should compute money and XP at quest acceptance time, then stored `Quest.moneyReward` and `Quest.xpReward` remain the completion payload.

Inputs:

- quest type: fetch, visit, kill, talk, escort, repair, steal, expose, route, hold;
- objective value: item value/count, target danger, monster threat, hold duration, repair input value;
- floor route: target z, current z, route distance, danger, anomaly, story/design/procedural role;
- plot phase: main plot step, prerequisite depth, campaign distance from start;
- giver: `persistentNpcId`, faction, occupation, level, wealth tier, relation;
- risk: combat, theft, audit, samosbor, deadline, cross-floor travel, faction hostility;
- scarcity: `rewardResourceId`, resource stock and demand;
- player modifiers: INT bonus, reputation, debt, route knowledge, but capped.

Difficulty score:

```txt
D = typeBase
  * objectiveMult
  * routeDistanceMult
  * routeDangerMult
  * plotPhaseMult
  * giverLevelMult
  * riskMult
  * urgencyMult
```

Suggested multipliers:

```txt
typeBase: VISIT 0.8, TALK 0.9, FETCH 1.0, REPAIR 1.15, KILL 1.35, STEAL/EXPOSE 1.6, HOLD/ESCORT 1.8
routeDistanceMult: 1.0..2.4
routeDangerMult: 1.0..3.0
plotPhaseMult: 1.0..4.0
giverLevelMult: 1.0..2.0
riskMult: 1.0..3.0
urgencyMult: 1.0..1.5
```

Money:

```txt
moneyReward = roundBand(
  baseCashRate
  * D
  * scarcityMult
  * giverWealthOrFactionBudget
  * playerIntRewardMultCapped
)
```

XP:

```txt
xpReward = round(20 * D * learningMult)
```

Caps:

- ordinary local procedural quest near start: usually under `250₽`;
- early cross-floor or minor combat: `150..800₽`;
- mid route contract: `800..8_000₽`;
- late/deep/high-risk contract: `5_000..45_000₽`;
- plot-scale, betrayal, vault, rare-route or boss contract: `25_000..250_000₽`;
- `100_000₽+` always needs explicit tags: `deep_route`, `jackpot`, `vault`, `faction_betrayal`, `boss`, `unique_weapon`, `major_asset`.

Authored rewards:

- Keep authored item rewards, but audit their sell value against the computed reward band.
- If an authored reward exceeds the band, require `rewardOverrideReason` or equivalent data tag.
- Avoid silently using expensive item rewards to bypass cash caps.

## 10. Combat And RPG Economy

The current base RPG line is usable as an early/mid layer:

- base HP starts at `100`;
- level adds HP and PSI linearly;
- STR/INT add HP/PSI;
- monster HP/damage scale by zone level.

That does not by itself support late tens-of-thousands HP without absurd levels. Add combat tier scaling as data, not scattered formulas.

Target HP bands:

| Band | Player | Ordinary NPC | Monster/elite |
| --- | ---: | ---: | ---: |
| early | `80..180` | `40..180` | `8..800` |
| mid | `250..900` | `120..1_200` | `500..3_500` |
| late | `1_200..5_000` | `800..6_000` | `3_000..12_000` |
| endgame | `3_000..15_000` | `2_000..20_000` | `10_000..50_000` |

Direction:

- keep `src/systems/rpg.ts` as base level math;
- add data-driven combat tier multipliers for route depth, monster archetype, NPC loadout tier and boss/world-threat identity;
- do not make all enemies sponges: late trash can stay killable, late elites/bosses get high HP and mechanics;
- keep TTK readable by tying damage, ammo cost and exposure time to the same tier;
- add a read-only balance snapshot for weapon cost, damage, ammo cost, burst damage and shots-to-kill at `100/300/1_000/3_000/10_000/30_000 HP`.

Top weapon target damage:

- early weapons: `7..150` damage;
- mid rifles/shotguns/grenades: `150..800` effective burst;
- late energy/anti-elite: `800..2_500`;
- BFG/GRN: `2_500..7_000` AoE/effective burst;
- GBE: world-editing beam with capped cells/targets, rare charge and collateral risk, not just DPS.

## 11. AI And Economy

AI should affect economy through bounded public facts, not hidden global scans.

Use AI/floor risk as inputs:

- active route `z`, danger, anomaly and design floor role;
- monster kind, level, ecology role and counterplay;
- NPC faction, wealth tier, role and relation;
- local events: combat, theft, death, samosbor, caravan, hack backlash, rescue;
- nearby threat count from existing entity index and bounded queries.

Economy outputs:

- trophy/drop events;
- faction demand and tariff events;
- buyer/seller liquidity pressure;
- quest urgency and reward modifiers;
- stock market impulses from meaningful world events;
- caravan risk and route heat.

Do not:

- scan all monsters or NPCs every frame for prices;
- make renderer decide value;
- let AI spawn loot just because a player needs money;
- use global event logs without local caps/cooldowns.

## 12. Finance, Production, Caravans

Finance:

- deposits must not beat ordinary expedition yield at similar time/risk;
- loans fund one or two sorties, not stock leverage;
- market edge comes from rumors/events/Net Sphere signals, not idle random ticks;
- banking actions published by bank floors should connect to ledger functions, not remain only event text.

Production:

- every recipe needs input shadow value and output value audit;
- ammo, energy, door kits and route tools need access/risk multipliers;
- production output containers should create decisions: buy, steal, repair, guard, reroute, expose.

Caravans:

- tariffs and seat fees must be paid in rubles, item, debt or faction consequence;
- active caravan state and persistent member ids should stay bounded and save-shaped;
- small caravan members should remain persistent A-Life ids or explicit temporary event actors;
- resource movement should happen over events/ticks and publish scarcity changes, not erase shortage instantly.

## 13. Implementation Campaign

### Phase 0: Metrics Before Edits

Add a read-only economics snapshot:

- item value distribution by type/tag/resource;
- weapon/PSI price, resource id, damage, ammo/PSI cost, burst and TTK table;
- generated container value distribution by kind/floor/danger;
- monster rare drop expected value by kind/danger/z;
- quest reward distribution before/after scarcity/INT;
- A-Life wealth percentiles, millionaire counts, active money percentiles;
- trade liquidity near player and by role;
- finance yield comparison: expedition vs bank vs stock;
- production recipe shadow value ratios;
- caravan paid action cost checks.

### Phase 1: Source Of Truth Tables

Create data-owned economics profiles:

- money band definitions;
- item resource ownership and audit;
- combat tier definitions;
- loot tier definitions;
- quest reward profiles;
- wealth tier definitions;
- top weapon charge/access profiles.

Do not put this in `main.ts`.

### Phase 2: Price And Resource Rebase

- Reprice weapons and PSI to target bands.
- Ensure rare energy and PSI have `resourceId` through resource mapping.
- Add unique charge or access cost for BFG/GBE/GRN.
- Lower passive finance rates or add lockup/risk so expeditions remain primary.
- Add tests that top gear is not ordinary early random loot.

### Phase 3: Loot Profiles

- Split container base pools from floor/danger overlays.
- Make early containers sparse and low-value.
- Add deep route/high-danger stash profiles.
- Add monster drop risk context.
- Add generated container cap tests and monster drop expected-value tests.

### Phase 4: Quest Reward Engine

- Add pure reward computation helper.
- Recompute rewards at acceptance, not completion.
- Include route z/danger, plot phase, giver level, objective value and risk.
- Audit authored rewards against computed band.
- Add tests for monotonicity and caps.

### Phase 5: Combat Tier Rework

- Keep current RPG as base layer.
- Add tier multipliers for late HP/damage.
- Reprice and rescale top weapons/PSI together.
- Add TTK snapshot tests and update `balance.md` after code is real.

### Phase 6: A-Life Wealth Gameplay

- Add derived wealth tiers and bounded trade reserve.
- Add pocket cash/cash note death policy.
- Add millionaire/vault/debt/safe gameplay hooks.
- Store sparse touched state only.
- Add save/load tests if persistent shape changes.

### Phase 7: Finance And Logistics

- Save active caravan state if needed.
- Connect banking floor events to ledger operations.
- Unify special route economy, especially black market route state, with generic `EconomyRouteState`.
- Add finance ROI tests.

## 14. Required Tests And Gates

For implementation passes:

- `npm run typecheck` for narrow data-only work.
- `npm run check:readonly` for data, reward, resource and test changes.
- `npm run check` for systems, generation, save/load, A-Life, quest, loot, combat, economy or AI changes.
- `npm run check:browser` or `npm run check:full` only if render/UI/browser behavior changes.

Focused tests to add:

- item/resource audit: rare energy and PSI resolve to resources;
- top gear access audit: no BFG/GBE/GRN in ordinary early random pools;
- PSI price audit: PSI weapons have base value `>=10_000₽`, and quest-granted PSI counts against the quest reward budget at full value;
- quest reward monotonicity: danger, distance, plot phase and giver level increase reward within caps;
- generated container cap by kind/floor/danger;
- monster drop EV by kind/danger/z;
- A-Life millionaire active cash cap and trade reserve depletion;
- NPC death cash policy and no million-cash drop;
- finance yield vs expedition yield;
- caravan cost and save continuity if active runs become persistent;
- production shadow value ratio.

## 15. Definition Of Done

The economics pass is useful when:

- early game still makes `100₽` feel like meaningful money;
- common loot near start cannot skip weapon/route progression;
- top guns cost hundreds of thousands or equivalent access/risk;
- PSI starts at `10_000₽+` value scale, and quest-granted PSI is treated as a valuable reward rather than a separate crippled item;
- high-value loot comes mainly from high-risk NPCs, monsters, safes, vaults and high-depth route floors;
- quest rewards scale with objective, route distance, plot phase, giver level and floor danger;
- A-Life millionaires remain rare, persistent and meaningful without becoming raw cash drops;
- passive finance does not replace expeditions;
- AI and monster danger publish bounded economic facts without new full scans;
- docs are updated only after shipped code makes the facts true.
