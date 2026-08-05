# A-Life Population

> Центральный документ живого мира.
>
> Роль: описывает persistent NPC identity, deaths, foldback, off-floor records, macro consequences, faction/economy/quest context and future migration/resettlement rules. Связан с `ai.md` for live active-floor behavior, `economics.md` for resources and wealth, `korovan.md` for cold A-Life/caravan macro logistics, and `balance.md` for progression pressure.

Persistent A-Life is a central game feature of ГИГАХРУЩ: the building is not a spawn faucet, it is inhabited.

The player does not enter an empty procedural map that slowly fills itself. The population already exists. Entering a floor activates the slice of that population assigned to that floor; leaving the floor freezes it. Killing someone removes that person from the global population forever.

## Design Goal

The next implementation target is:

- A seed-sized population around `100_000` procedural NPC identities per run on every supported runtime, bounded by a `131_072` technical capacity.
- No million-size pool, no memory/device/browser tier and no fallback population branch.
- Every ordinary NPC has a stable identity, floor assignment, faction, occupation, age, sex, level, deterministic default loadout, family/friend graph, rank state, quest potential and death state.
- Quest NPCs are part of the same identity model instead of being a separate magical category.
- Only the active floor is materialized into live `entities`.
- Off-floor NPCs do not pathfind, fight, tick needs or run frame AI.
- The player can theoretically depopulate the Khrushchev block. The count goes down, not back up to a target cap.

Current shipped baseline:

- `src/systems/alife.ts` now uses a seed-sized population plan around the `100_000` baseline with `131_072` as the technical identity capacity. There is no million-size runtime branch and no mobile/memory fallback population branch.
- A run-start population plan distributes every created record across story floors, routed design floors and the per-run procedural floor deck before first active-floor generation. Plot/authored/event reserved identities are counted inside the same pool. Package reservations with `reservedIdentityId = npc:<id>` and `presence: 'population'` can materialize through ordinary floor slots; `event_only` package reservations and legacy plot reservations stay event/authored-owned.
- Live `entities` still contain only the active floor.
- Generator-owned ambient NPCs become placement templates; A-Life records are materialized into those slots.
- `alifeId` and `persistentNpcId` identify materialized procedural NPCs and converted reserved plot arrivals such as the Hell holdout Major Grom arrival.
- `plotNpcId` deaths are tracked by A-Life so killed named NPCs do not reappear on later generation.
- Materialized A-Life NPCs carry personal `playerRelation`; AI hostility checks it before falling back to faction hostility.
- Core persistent route/numeric fields are no longer stored as JS string/number properties on every A-Life record: `floorKey` is interned through a route-key dictionary plus `Uint16Array` index, and base floor, danger, faction, occupation, age, sex code, flags, `level`, `str`, `agi`, `int`, HP, money/account balance, family id, sprite, sprite seed, kill counters, `playerRelation` and `karma` live in typed-array columns inside the A-Life state, while snapshots expose ordinary strings/numbers to callers.
- Ordinary generated loadout is dynamically generated from seed, faction, danger and level by the universal procedural loot system (`src/systems/procedural_loot.ts`) which uses the `ITEMS` registry as the single source of truth; it is not stored as a `weapon` string plus `inventory` array on every untouched A-Life record. Only captured/overridden custom loadout is kept as a sparse per-record override, including package-projected exact `weapon`, `tool` and `inventory` loadouts.
- Browser saves store A-Life seed, total population, up to `65_536` dead A-Life ids, dead plot ids, bounded changed-record overrides and capped persistent mobility state. Full live entities are not serialized.
- `src/systems/alife_migration.ts` runs a bounded cold migration cadence: inactive-floor journeys move records between route keys, active-floor arrivals materialize near lift anchors, and active departures require live NPCs to reach a lift anchor before the record moves.
- `src/systems/demos_social.ts` owns the compact Demos relation graph: slot `0` is `NPC -> player`, slots `1..9` are `NPC -> NPC`, start fill usually reaches up to 5 public relations total, and gameplay/social deltas can grow circles up to 10 public relations without adding object graphs.
- Small caravan runs can carry `memberAlifeIds`; surviving members are moved to the destination route key on arrival.

Active-floor behavior, full-pass AI, pathfinding, NPC intent selection, short mass-combat step, monster behavior and samosbor reactions are specified in [ai.md](ai.md). This file owns persistent identity and population facts; `ai.md` owns what materialized live actors decide to do.

## Недопустимый Паттерн: Фиксированный Префикс Живого Мира

A-Life, live AI, economy, factions, quests, migrations and shelter/route systems must never turn storage order into gameplay truth. A bounded optimization such as "look at the first 96 rooms", "take `candidates[0]` after insertion order", "scan the first N entities" or "use `anchors[0]` when no preference exists" is unacceptable for any gameplay-visible decision on a large floor.

This is not a style preference. On Kvartiry-scale maps a fixed prefix scan becomes mass behavior: NPCs select the same side of `world.rooms`, arrivals pile into the first lift anchor, work/shelter/economy targets bias toward generation order, and a performance cap silently becomes a world rule.

Allowed bounded scans:

- actor-local rotating cursor stored on AI/runtime state;
- deterministic window offset keyed by actor id, intent, floor key, room count or migration id;
- spatial index or radius query with a cap where the index order is not the gameplay score;
- reservoir/weighted sample before final scoring;
- full candidate scoring followed by a small top-N only after the score is already meaningful;
- explicit authored order only when the data contract says order is the feature, such as a plot step list.

Required review checks when touching A-Life-adjacent systems:

- Search for `.slice(0`, `candidates[0]`, `world.rooms.find`, `for (const room of world.rooms)`, `for (let i = 0; i < entities.length`, `SCAN_CAP`, `ROOM_CAP`, `ANCHOR_CAP` and similar bounded scans.
- If the scan does not cover the full collection, prove that start order is rotated, spatially local, scored before truncation or authored by contract.
- Add a regression test with more candidates than the cap. The expected target must be able to live beyond the old prefix.
- For huge story floors such as Kvartiry, run a seed-fixed metric pass: door/room counts, linked-door counts, A-Life traveler/template counts and a check that special rooms and anchors are reachable.
- Economy and faction systems must follow the same rule: no first-factory, first-zone, first-room or first-resource bias unless the definition order is explicitly the player-facing priority.

If no fair bounded scan can be proven quickly, use a deterministic rotated window first and then score inside that window. A cheap rotating window is acceptable; a stable first-prefix cap is not.

## Current Gaps Against The Bible

These are current implementation limits, not new design goals:

- Death is permanent in memory, but save/load persistence for procedural A-Life deaths is capped at `65_536` ids. A player can depopulate active floors, but "depopulate the whole run-sized A-Life pool and preserve every death through save/load" is not fully true yet.
- Contract/assignment quest conversion can still use a live giver id or a synthetic fallback id; it does not consistently bind generated quest givers to `persistentNpcId`.
- Some authored plot NPC generators still use `plotNpcId` as the live identity path; reserved A-Life plot identities exist inside the fixed pool budget, and Hell holdout Major Grom now binds to his reserved record, but not every authored plot actor has been converted to materialize directly from that reserved record.
- Off-floor macro life is represented by cold migration, caravans, contracts, economy/faction state, compact events and bounded Demos social consequences. There is not yet a separate slow batch A-Life simulation for rank summaries.

## Core Rule

There is no ordinary background refill.

Allowed population creation:

- Initial run creation of the A-Life identity pool.
- Floor generation producing geometry and ambient placement templates.
- Materialization of existing A-Life records when the player enters or rebuilds a floor.
- Explicit authored/event spawns: samosbor, quest waves, lift encounters, hack backlash, emergency responses, caravans and scripted consequences.

Forbidden population creation:

- Timed refill-to-cap for ordinary NPCs.
- Monster refill just because the monster count dropped.
- Silent replacement of a killed persistent NPC by another persistent NPC in the same materialized slot.
- Generator code that invents ordinary ambient NPC identity after A-Life materialization.

Event actor policy:

- If an event spawns an ordinary person who can survive beyond the event, that person should reserve or receive a persistent identity.
- If an event spawns temporary pressure, the actor must stay scoped to that event and must not count as population refill.
- Faction reinforcements, caravans and evacuees are authored arrivals now; when they persist beyond an event, they must become explicit migrations rather than hidden replacement of dead residents.

If a system needs a person, it should first ask whether that person is:

- An existing persistent A-Life NPC.
- A named authored `plotNpcId` NPC.
- A temporary event actor with a bounded event reason.

## Mental Model

```txt
Run start
  -> build route/floor run
  -> build one population plan
  -> create A-Life identity pool
  -> distribute every identity by floor route key

Enter floor
  -> generate world geometry and content
  -> use generated ambient NPCs as placement templates
  -> remove those template NPCs
  -> materialize live NPC entities from the floor's A-Life slice
  -> run active-floor AI/combat/quests/trade on those individual entities

Leave floor / rebuild / save
  -> fold live A-Life entity state back into records
  -> keep current-floor player/runtime state
  -> freeze all off-floor records

NPC death
  -> mark A-Life record dead
  -> drop inventory into current floor
  -> never materialize that identity again
```

The system is deliberately cinematic and data-oriented. Off-floor life is represented by compact facts and slow aggregate state, not invisible per-NPC simulation.

Active-floor mass combat is allowed to be much simpler than an individual social routine. A materialized NPC still has its own identity, faction, relation to the player, role, current intent, needs, inventory, HP, target and counters, but a dense fight can resolve through the shared short combat-step documented in [ai.md](ai.md): choose a hostile faction target, move, hit or fire a physical projectile, and write real consequences. Those consequences are what A-Life cares about at foldback time.

## Occupation As Routine Driver

`Occupation` is the primary code-level profession template for ordinary A-Life NPCs. It is not flavor text and not a user-extensible questionnaire field. It answers what this person normally does when materialized: where they try to work, what rooms they value, what needs they satisfy efficiently, what they can trade or teach, how Demos describes them, what speech/bark pools fit them, and which economy/factory hooks can use them.

Current implementation already uses occupation across A-Life generation, AI utility, room routine, needs recovery, Demos profiles, trade/economy, factory worker eligibility, craft lessons, dialogue and visual defaults. The design direction is to make that relationship explicit and unified:

- every ordinary A-Life NPC has exactly one base `occupation`;
- occupation chooses the default work-room affordances, such as kitchen for cooks, medical for doctors, office for secretaries, production for mechanics and electricians, storage for storekeepers, route/corridor pressure for hunters/travelers;
- faction, territory and floor theme decide where that work can happen, not the occupation alone;
- generated home/work anchors should bind to concrete rooms when the active floor exists, then fold back as compact ids or sparse overrides when needed;
- materialized routine should normally cycle through work, need satisfaction, social/rest, patrol/travel and samosbor emergency behavior through shared AI utilities;
- local roles such as "работница этажа 69" sit below occupation as `roleId`, tags, work text, visual family and placement profile, unless the role becomes a reusable profession across A-Life/economy/AI.

Occupation is the default routine, not the only possible routine. Plot/design NPCs may have explicit special A-Life rules: tutorial lock, quest escort, guard duty, scripted arrival, faction command, shelter behavior or another bounded authored state. Such rules should be data/package/quest driven and temporary or stateful, while the NPC still keeps a normal occupation as the fallback routine. When the special rule expires or is not active, the NPC returns to the occupation-driven ordinary life model.

Adding a new occupation is a developer-level systems change. It must update the code/data profile that drives generation weights, work-room affordances, routine weights, need/economy hooks, labels/speech, Demos and save/schema expectations. A user NPC package may choose from existing occupations and add `roleId`/tags, but it must not invent a new occupation string.

Known documentation/implementation debt: occupation rules are still spread across several files instead of one profile registry. `problems.md` tracks that as a consolidation target; this file defines the intended ownership.

## Identity Fields

An A-Life record should be able to answer:

- Who is this person?
- Where do they belong?
- What can they do when materialized?
- What happened to them permanently?

Current fields:

- `id`: stable numeric A-Life id.
- `floorKey`: story/design/procedural route key, stored internally as an interned dictionary index.
- `floor`: base `FloorLevel`, stored as a byte column.
- `danger`: floor/context danger `1..5`, stored as a byte column and used for deterministic loadout.
- `faction`: current faction, stored as a byte column.
- `occupation`: runtime sprite/role, stored as a byte column.
- `name`, `female`, `age`, `sex`: display, grammar and demographic context. Age is clamped to `1..100`; sex is a compact `male`/`female` value mirrored to the legacy female flag for grammar.
- `height`, `radius`: физические габариты персонажа (игрока и NPC) напрямую зависят от возраста. У детей рост (и скейл спрайта, и коллизия) плавно растет, у взрослых используется Гауссиана вокруг 1.8м.
- `familyId`: current compact family grouping.
- `canGiveQuest`: active/authored quest affordance; persistent A-Life NPCs get a stable `10%` candidate roll instead of a special quest-giver caste or a universal offer flag.
- `level`, `str`, `agi`, `int`: RPG state.
- `hp`, `maxHp`: folded health.
- `money`, `accountRubles`: folded cash/account economy in unsigned integer columns.
- `weapon`, `inventory`: only custom/touched loadout overrides. Untouched ordinary loadout is generated lazily from seed and compact columns during materialization.
- `sprite`, `spriteSeed`, `npcVisualId`: folded visual identity. `npcVisualId` selects a special procedural visual family for any authored or procedural NPC; `sprite` remains the atlas/static/fallback slot, and occupation sprites are generated only when no special visual is present.
- `kills`, `npcKills`, `monsterKills`: unsigned integer columns; default is zero.
- `playerRelation`: optional personal attitude to the player. Absence means "not individually initialized yet"; on first materialization it is initialized from the NPC faction's current relation to the player plus a small deterministic fluctuation.
- `karma`: compact moral/social charge in `[-127, 127]`. Scientists skew high, cultists skew low, every NPC still has deterministic fluctuation.
- `x`, `y`, `angle`: optional last known position.
- `dead`: permanent removal flag stored in the A-Life flags byte.

Storage note:

- Route key index, base floor, danger, faction, occupation, age, sex, boolean flags, RPG byte stats, health, cash/account wealth, family id, sprite fields, kill counters, `playerRelation` and `karma` are stored as typed-array columns, not as own properties on each persistent record object.
- Age uses `Uint8Array`; sex uses a byte code column with `0` as unset, `1` male and `2` female.
- `level`, `str`, `agi` and `int` use byte-safe caps; the shared runtime RPG level cap is `255`.
- `playerRelation` uses an `Int8Array` with an unset sentinel; `karma` uses signed-char-compatible `[-127, 127]`.
- Current-floor live `Entity` objects still expose normal number/string/array fields. The compact form is the cold persistent pool, and `getAlifeNpcRecordSnapshot()` is the public boundary view.
- `getAlifeNpcRecordSnapshot()` remains the public view API for systems and UI that need ordinary number fields.

Target fields:

- `homeFloorKey`, `homeRoomId` or procedural home anchor.
- `workFloorKey`, `workRoomId` or faction/work anchor.
- `needProfileId`, `routineSeed` and `roleAiId` for deterministic individual active-floor behavior.
- `shiftOffsetMinutes`, `duty`, `sociability`, `riskTolerance`, `greed` and `panicBias` as compact numeric traits when the AI implementation needs persistent personality.
- `friends`: bounded ids through Demos social graph slots; current storage supports player slot plus up to 9 NPC links, with ordinary start fill usually leaving free slots for later relationships.
- `family`: spouse/parent/child/sibling ids through compact relation edges.
- `rank`: faction or global social rank.
- `playerSeen`, `lastSeenAt`.
- `questSeed`, `questRole`, `questState`.
- `reputation`, `debt`, `fear`, `loyalty` as compact social values.

Do not add large object graphs. Use ids, typed arrays or bounded sparse override records.

## Procedural Identity Generation

A-Life generation must be at least as varied as the old per-floor procedural population. It should preserve floor taste, faction pressure and special local visuals while moving identity ownership into one persistent pool.

Generation inputs:

- route floor key and base `FloorLevel`
- danger `1..5`
- procedural floor majority faction when available
- authored/design floor id, such as `floor_69` or `bank_floor`
- deterministic run seed and A-Life id
- data profiles from `src/data/alife_generation.ts`

Level distribution:

- Levels are generated across `1..100`.
- Most NPCs should remain around levels `1..10`.
- High levels are a long tail, not a flat random range.
- Current implementation uses a logarithmic/asymptotic distribution close to `1/L`, with danger and elite factions shifting the tail upward.
- Level `100` exists, but should be rare enough that reaching it still feels exceptional.

Age distribution:

- Ordinary age is deterministic from run seed, floor route key, faction, occupation and level.
- Level is only one soft input: higher level nudges age upward, but rare prodigies and veterans prevent "all strong NPCs are old" and "all low-level NPCs are children".
- `Occupation.CHILD` records receive child ages; reserved child identities without an authored age get a deterministic child fallback.
- `floor_69` ordinary and authored staff stay adult but young-biased; its authored workers are in their twenties unless a role explicitly says otherwise.
- Authored NPC packages can set exact age/sex through `PlotNpcDef`, and those values reserve into A-Life, live spawn and Demos snapshots.

Faction distribution:

- Faction weights are data profiles, not a switch that every future faction must edit by hand.
- Citizens are the largest default population.
- Liquidators, wild residents, scientists and cultists are rarer and floor-biased.
- Cultists are globally rare but dominant on Hell/cult routes.
- Procedural floors boost their majority faction without excluding minorities.
- Adding a new faction should mean adding a profile with weights, occupations, wealth and pockets.

Floor-specific visuals:

- Special floor NPC visuals must survive A-Life materialization.
- If a generated floor provides a special ambient template sprite, A-Life stores that sprite on the record during materialization.
- `floor_69` female NPC sprites are the first concrete case: A-Life must not replace them with generic traveler art.
- Future special floors should expose their local visual language through templates or data tags, not renderer-side A-Life exceptions.

Wealth distribution:

- Money uses a heavy tail.
- Most NPCs carry little cash.
- Procedural millionaires can exist, but should be very rare.
- Billionaire/ministry/bank oligarch roles should usually be authored or quest-owned identities, not common procedural output.
- Ministry, bank and high-status profiles multiply wealth without making rich NPCs common.

Inventory generation:

- Initial inventory comes from faction, occupation, danger and common pockets, but for untouched ordinary records it is regenerated lazily instead of persisted per NPC.
- Weapons remain loadout items and are included in the materialized inventory.
- NPC looting/trading can change inventory later; touched inventory folds back into A-Life custom loadout overrides.
- Inventories stay small and capped. Variety should come from weighted profiles and floor context, not huge per-NPC arrays.

Counters and relation:

- Default counters are zero by absence.
- Persistent counters should include kills, NPC kills, monster kills, rank score inputs and personal relation to the player.
- Relation-to-player is a compact number first; detailed memories should be event facts or sparse overrides.
- Initial personal relation is faction relation to the player plus deterministic per-NPC fluctuation. This keeps faction mood recognizable while making individuals vary.
- If personal relation reaches the same hostile threshold as faction hostility, that NPC treats the player as hostile even if the faction as a whole has not crossed the threshold.
- Player damage to an NPC lowers that NPC's personal relation and, when the factions are not already hostile, lowers the faction relation too.
- Personal relation changes that enter Demos propagate through the changed NPC's bounded outgoing social circle with `derivedDelta = round(sourceDelta * circleRelation / 127)`: friends inherit the sign, enemies invert it, weak/zero ties have weak/no effect.
- Completing a quest gives the issuing faction a small fixed positive relation gain in normal cases (`+1`); the individual giver gets a stronger but capped personal gain because the task mattered to that person.
- Karma is affected by deeds: attacking a non-enemy, stealing and urinating on owned floor reduce it. Positive karma sources can be added later through rescue, repair, honest quest outcomes and shelter help.
- Rank menus and leaderboards should be views over level, wealth, kills, karma, quests and survival facts.

## Player As A-Life Actor

The player is part of A-Life as an actor, not as one of the ordinary NPC pool slots.

Current shipped state:

- The player entity has the same `karma`, `kills`, `npcKills`, `monsterKills` and rank-score inputs as NPCs.
- The player starts with `karma = 0`.
- The player's personal relation to self is `playerRelation = 100`.
- The player appears in the A-Life top-100 rating with a real global rank among alive persistent NPCs.
- Saves store the player's A-Life actor fields together with normal player state.

This keeps future possession simple: controlling another persistent NPC should be a controlled-agent swap, not a rewrite of AI, rank, karma or inventory rules. The selected body already has identity, faction, floor, inventory, karma, rank inputs and personal relations; the game only needs to move player control and camera/input ownership onto that entity.

Apartments and homes:

- Full room/home assignment can wait until first floor visit, because the real apartment graph exists only after generation.
- Before first visit, the pool knows floor identity and can know intended home/work anchors later.
- On first materialization, generated rooms and placement templates can bind records to concrete coordinates, rooms and special local visuals.

## Floor Keys

Population is assigned by route identity, not just by base enum floor.

- Story floors: `story:living`, `story:kvartiry`, `story:ministry`, etc.
- Design floors: their `DesignFloorId`, e.g. `bank_floor`.
- Procedural floors: their per-run spec key, e.g. `z13`.

This makes routed floors persistent even when multiple floors share the same base `FloorLevel`.

## Route Population Shape

A-Life distribution is route-key weighted and data-driven. The current code gives ordinary story-floor population the strongest weights around dense residential/social anchors (`KVARTIRY`, `LIVING`), lower ordinary weights for industrial/Hell anchors, and no ordinary NPC allocation for `VOID`. Authored design floors use `src/data/design_floor_population.ts`; procedural floors use `proceduralPopulationBudget()` plus `floorRunZAllowsNpcs()`.

That means "farther from the center gets harsher" is a systemic bias, not a single hardcoded formula. Route depth, danger, anomaly pressure, floor role and local overrides can all shift the mix. Extreme endgame stops can be ordinary-NPC-free while still adding monster/protocol pressure; nearer authored floors can be unusually dangerous if their role demands it.

## Materialization Contract

Floor generators still own construction:

- world geometry
- rooms
- lifts
- POIs
- authored NPCs
- monsters
- loot
- ambient placement templates

A-Life owns ordinary procedural NPC identity:

- It removes ambient generator NPCs that are not `plotNpcId`, not already persistent and not special quest/event actors.
- It uses those removed NPCs only as placement templates.
- It materializes existing records into the first matching slots for that floor.
- Dead slots stay empty.
- Existing AI, combat, trade and quest systems operate on materialized entities.

The template slot rule matters. If floor generation provides 5,000 ambient NPC slots and 100 matching A-Life records are dead, the floor materializes 4,900 A-Life NPCs. It does not pull 100 unrelated people from deeper in the pool to hide the deaths.

This is also the active-floor budget. A floor may own thousands of identity records, but live materialization uses the shared 4096 NPC+monster actor soft cap, authored anchors and explicit encounters. Future work must not materialize every assigned record just because it exists in the pool.

If a player clears a floor, the deaths remain real. The floor can later receive people only through explicit migration or arrival logic: unassigned overflow residents, caravans, refugees, faction movement or quest consequences. If lazy migration brings people to the currently active floor, they should enter through a believable anchor such as a lift, stairwell, caravan route or event door.

## Named And Quest NPCs

Current shipped behavior:

- Authored named NPCs keep `plotNpcId`.
- A-Life records killed `plotNpcId` values and filters those named NPCs on later floor generation.
- Persistent A-Life NPCs can be quest candidates through their stable `canGiveQuest` affordance. It is a `10%` roll, not a separate population caste and not true for every persistent NPC.

Target behavior:

- Plot NPCs should be declared as fixed A-Life identities with reserved ids.
- Side quest NPCs should also resolve to reserved or generated A-Life identities.
- Quest references should prefer stable ids: `plotNpcId` or `persistentNpcId`, not transient live entity ids.
- Generated quest givers should remain attached to the same A-Life person after save/load/floor travel.
- Killing a quest giver should be a real quest fact, not a recoverable spawn failure.
- Any suitable NPC can become a quest source by data/rules. Being "quest NPC" is a current role, not a different species of NPC.

Practical migration path:

1. Keep `plotNpcId` as the stable authored identity key.
2. Add reserved A-Life ids for plot/side NPCs.
3. Store quest references by `persistentNpcId`.
4. Make quest generation draw from `canGiveQuest` A-Life records on the active floor.
5. Remove remaining generic quest-giver assumptions based on live entity id.

## Families, Friends And Social Graphs

The social graph should be compact and useful, not decorative.

Minimum viable graph:

- `familyId` groups 2-8 NPCs.
- A family prefers the same floor and compatible home zone.
- A few friend edges cross family boundaries.
- Faction and occupation bias friend selection.

Gameplay effects:

- Killing one NPC can make relatives fearful, hostile, grieving or rumor-bearing.
- Family members can inherit quests, debts, grudges or keys.
- Friends can report deaths or point to last known positions.
- Reputation changes can spread through a small local graph rather than all NPCs.
- The shipped baseline stores compact per-NPC relation-to-player and Demos social relation overrides. Family/friend/enemy propagation modifies only bounded local outgoing edges and never scans the full population.

Do not simulate all social relationships every frame. Update graph consequences through event publication and slow, bounded ticks.

## Rank And Growth

A-Life should make the population grow with the player.

Current shipped state:

- NPCs have RPG level/attributes.
- Materialized NPCs use existing combat and can be killed permanently.
- The Faction/A-Life panel shows a cached `A-LIFE РЕЙТИНГ ТОП 100` list and the player's own global rank.

Target rank model:

- Global and per-faction leaderboards can be derived from compact record fields.
- Current rank inputs: level, kills, NPC kills, monster kills, wealth and karma.
- Future rank inputs: quest outcomes, faction standing, survival time, family consequences and off-floor event victories.
- Rank score should be formula-driven and expandable: killing higher-level enemies, completing valuable quests, gaining money and surviving major events can all add score.
- Named lists such as "лучший ликвидатор", "самый богатый жилец" or "главный убийца этажа" are views over the same facts, not hardcoded special systems.
- High-rank NPCs should be discoverable through rumors, faction panels or logs.
- NPCs should gain XP only when materialized or through rare aggregate off-floor events.
- Off-floor growth must be coarse and bounded, never hidden per-frame combat.

Example visible outputs:

- "Петя Петушко, 17 уровень, 42 убийства, пропал на z13."
- "Самый опасный ликвидатор этажа: Майор Кравченко."
- "Семья Ивановых потеряла троих после второго самосбора."

## Monsters

Persistent A-Life is primarily about NPCs.

Monster policy:

- Initial monster placement remains generator/event owned.
- Samosbor, quest waves, lift encounters, hack backlash and authored consequences may spawn monsters.
- Ordinary timed monster refill is not part of A-Life.

Future option:

- Important monsters and bosses can get persistent identity records.
- Ordinary monsters can remain ecology/event pressure.
- If monster persistence is added, it should use a separate compact pool or ecology state, not the NPC social graph.

## Off-Floor Simulation

Off-floor NPCs are frozen by default.

Allowed off-floor updates:

- Very slow aggregate faction pressure.
- Event summaries.
- Quest deadline consequences.
- Caravan/economy effects.
- Rare rank changes from coarse events.
- Death or migration only when caused by a recorded event.
- Lazy bounded batches over off-floor records, e.g. process `N` identities per slow tick and stop immediately at the budget.

Forbidden off-floor updates:

- Pathfinding.
- Needs ticking.
- Per-NPC combat.
- Per-NPC line-of-sight or noise reaction.
- Full floor scans.

This preserves the fantasy of a living building without spending CPU on invisible theatre.

Lazy off-floor work is allowed only as expandable aggregate A-Life. It must never become honest current-floor simulation for floors the player cannot see.

The active floor is different: it is the honest live simulation surface. Every materialized NPC/monster receives the active-floor AI pass regardless of distance from the player. This full-pass model is the current AI foundation; cheap combat, cached target scans and actor-local decision cooldowns are performance mechanics, not absence of life. If a current-floor NPC or monster dies, wounds someone, drops inventory, creates blood/bullet marks, changes relation or publishes a compact event, that fact must be visible when the player reaches the place or when the live state folds back into A-Life/floor memory.

## Save Model

Current save shape version is in `src/systems/save_runtime.ts`.

A-Life save data stores:

- population version
- seed
- total population count
- dead A-Life ids
- dead plot NPC ids
- bounded changed-record overrides: position, health, cash, account balance, inventory, RPG state, visual seed/sprite and changed counters
- capped mobility state: journeys, pending arrivals, cursor and tick accumulator

The full pool is regenerated deterministically from seed and run route state, then overrides are applied.

Rules:

- Do not serialize the live `entities` array.
- Do not serialize all `100_000` full records when deterministic reconstruction plus overrides is enough.
- Bump save shape if persistent identity fields become required, if floor allocation changes, or if route floor keys/reserved plot ids can move existing NPC identities.
- Current development saves may be invalidated instead of migrated.

## Scaling Target

The selected population target is seed-sized:

- Use around `100_000` procedural NPC identities on every supported runtime, with deterministic per-run jitter and `131_072` as the technical capacity.
- Do not branch population size by browser heap, device memory, mobile/touch status or platform.
- Keep active-floor materialization around the existing floor population budgets, roughly thousands of live NPCs, not the full bucket.

Measured on 2026-05-20 with the current JS object pool in Node/V8:

- `100_000` records: about `42.6 MB` heap, about `101 ms` creation.

The architecture still stays compact because the cold A-Life identities are persistent records, not live actors:

- Use ids and compact numeric fields.
- Prefer deterministic generation from seed.
- Store sparse overrides for changed records.
- Avoid per-record object churn in hot paths.
- Do not put large strings, arrays or behavior histories on every record unless memory has been measured.
- Keep full `100_000`-pool scans out of frame-time systems.

## Integration Rules

- `systems/alife.ts` is the owner of persistent procedural NPC identity.
- `core/types.ts` may expose only primitive identity fields needed by live `Entity`.
- `gen/` can create placement templates but must not implement refill logic.
- `systems/ai/` consumes live entities only; active-floor behavior, pathfinding, utility intent selection and monster behavior contracts live in [ai.md](ai.md).
- `systems/quests.ts` should move toward stable persistent ids.
- `systems/events.ts` should record deaths, rank changes and social consequences.
- Migration, resettlement and off-floor event passes must be slow, bounded and explicit; they are not refill-to-cap.
- `render/` should display A-Life facts but never own A-Life decisions.
- Debug tools may inspect, kill, teleport or rank A-Life records, but must call system APIs.

Useful telemetry:

- total population, alive count, dead count
- current floor key, floor bucket size and materialized count
- template slot count and empty-dead-slot count
- changed-record override count and cap pressure
- faction/rank/family summaries for the active floor
- recent A-Life events: death, migration, quest-giver loss, rank change, family reaction

## Owner Decisions

Decisions recorded on 2026-05-26:

1. Target population is around `100_000` procedural NPC identities per run with `131_072` as technical capacity. The old million target and adaptive fallback branch are retired.
2. Active floor population remains bounded by the existing floor budgets, roughly thousands of NPCs, not the whole floor bucket.
3. NPCs can migrate between floors only through explicit implemented events, caravans, quests or resettlement logic.
4. Off-floor migration/event work may process records in bounded batches of `N`; it must not become full simulation.
5. Death is permanent for every NPC, including authored, plot and quest NPCs. There is no respawn.
6. Any suitable NPC can be a quest source. Quest-giver is a role produced by rules/content, not a separate global class.
7. Family, friend and relation-to-player data should become real gameplay when memory allows it: fear, revenge, rumor, discounts, help, hostility.
8. Rank is formula-driven and expandable. Start with score from level, kills, high-level kills, money, quests and survival; expose special lists as views.
9. A cleared floor stays meaningfully changed, but can later receive explicit migrants, overflow residents, caravans, refugees or faction arrivals.
10. If migration reaches the active floor, new arrivals should appear through believable anchors such as lifts or route entrances.
11. Rank and population should get gameplay UI, not only debug output.
12. Killing everyone is simply possible. It does not need to be a win condition yet; endings/achievements can extend it later.

## Completion Definition

A-Life is considered fully integrated when:

- All ordinary generated NPCs materialize from A-Life records.
- Plot and side NPCs have reserved persistent identities.
- Quests reference stable identity, not transient entity id.
- The player can depopulate a floor and the absence persists until explicit migration/resettlement changes it.
- The global alive count can only decrease through permanent deaths; floor population counts change through explicit migration/outcome rules.
- Rank/family/friend data has at least one visible gameplay surface.
- Save/load preserves deaths, touched state and quest identity.
- No ordinary NPC or monster system refills to a cap in the background.
- Active-floor NPC and monster behavior follows the local individualized AI contract in [ai.md](ai.md) instead of synchronizing ordinary NPCs through a global schedule.
