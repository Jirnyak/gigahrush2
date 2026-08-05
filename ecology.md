# Monster Ecology

> Центральный документ экологии монстров.
>
> Роль: описывает, как monster ecology устроена в проекте: где живут данные, генерация, active-floor AI, counterplay, слухи, события, самосборные реакции, тесты и границы с A-Life. Связан с `monsters.md` for monster packages, `ai.md` for live actor execution, `alife.md` for persistent NPC identity, `samosbor.md` for rebuild pressure, and `architecture.md` for layer ownership.

`ecology.md` - не batch-план и не перечень заявок. Это активный root-док, который фиксирует контракт системы: каждый монстр должен быть маленьким правилом мира, а не только HP/speed/sprite. Правило должно менять хотя бы одно решение игрока, NPC или генерации: маршрут, дистанцию, свет, воду, дверь, шум, документ, приманку, толпу, укрытие, самосборное убежище, слух или решение "драться/обходить/кормить/запирать/жечь/докладывать/бежать".

Текущая реализация проверяется по `src/entities/monster.ts`, `src/data/monster_ecology.ts`, `src/systems/ai/monster.ts`, `src/systems/ai/tactics.ts`, ecology-related helpers under `src/systems/`, generation call sites and focused `tests/monster_*.test.ts`. Старые `ecology_0.md`..`ecology_11.md` являются batch/orchestration материалом и лежат в `../gatbage/history/batches/ecology/`.

## Current Baseline

Shipped monster ecology is already part of the runtime:

- `MONSTERS` and `MONSTER_ECOLOGY` cover the current 67 `MonsterKind` values.
- `MonsterDef` owns stats, sprite generator registration, ranged/projectile shape, `aiFlags`, floor list, local counterplay and loot hints.
- `MonsterEcologyDef` owns spawn identity: floors, rooms, weights, rarity, samosbor gating, role, cue, rule, floor fit, counterplay, death-log hint, rumor ids and rare drops.
- `chooseFloorMonsterKind()` and `rankMonsterEcology()` select monsters for floor/procedural generation through ecology data, rarity gates, room/floor context and route pressure.
- `publishEvent()` enriches monster events with ecology tags and compact ecology payload through `monsterEcologyTags()` / `monsterEcologyEventData()`.
- `src/systems/ai/monster.ts` owns the shared live monster loop: target, movement, melee, ranged fire, windups, flag behavior, counterplay transitions and death consequences.
- `src/systems/ai/tactics.ts` owns bounded actor tactic profiles for richer local behavior. The reference profile is `slime_woman`.
- Supporting systems such as `monster_bait`, `monster_traits`, `monster_terrain`, `monster_counterplay`, `matka_source`, `slimevik`, `gnilushka`, `fog_shark`, `blood_plant`, `borshchevik`, `pseudolift` and `safeguard` express reusable ecological pressure where a simple flag is not enough.
- Tests audit registry coverage, sprite readability, ecology event data, bait/counterplay behavior, family-specific rules and full-pass AI invariants.

Monster ecology is active-floor truth. It does not create hidden off-floor realtime simulation, does not refill dead populations, and does not decide rendering.

## Ecology, AI And A-Life

These three docs own different questions:

- `ecology.md`: what rule a monster adds to the world, where it spawns, what stimuli it reads, what counterplay changes state, what evidence teaches the player, and what caps keep it cheap.
- `ai.md`: how materialized live actors think and execute on the loaded 1024x1024 toroidal floor: full-pass AI, utility, path fields, target scans, tactic profiles, movement and combat cadence.
- `alife.md`: who persistent ordinary NPCs are, where they belong, which deaths and social facts survive floor transitions, and why off-floor NPCs are frozen by default.

Boundary rules:

- Ecology may read live NPC/monster facts through AI/runtime APIs, but it must not mutate the A-Life pool directly.
- A monster can target the player, NPCs or other monsters when faction/hostility rules allow it. Player-only ecology is an exception, not the default.
- If an ecological effect kills, infects, scares, saves or moves an ordinary NPC and that fact must persist, it should surface through events, A-Life foldback, quest/faction/economy state or an explicit bounded save section.
- Monster persistence, if added later, should be a separate compact ecology/state pool. It must not be mixed into the ordinary NPC social graph.
- Ordinary monster placement remains generation/event owned. Timed refill-to-cap after monster deaths is forbidden.

The correct mental model:

```txt
ecology data
  -> generation chooses kind and context
  -> active-floor AI executes a cheap baseline
  -> flags/profiles/helpers add bounded local rules
  -> events, marks, rumors, drops and floor memory preserve consequences
  -> A-Life only receives persistent NPC-facing facts
```

## Layer Ownership

`core/`

- Owns primitive enums and state shapes such as `MonsterKind`, `Entity`, `World`, `RoomType`, `Cell`, `Feature` and toroidal coordinate helpers.
- New ecology should prefer ids, flags, data fields and generic runtime helpers before adding new core fields.
- A new `MonsterKind` is justified only when the creature is a reusable base monster with distinct rules.

`entities/`

- Owns monster packages: `MonsterDef`, procedural sprites and registry wiring.
- A package should not know generator internals, save shape or render placement.
- `MonsterAIFlag` is a compact vocabulary for behavior families. Add a flag only when it is generic enough for more than one content case or clearly belongs in the shared monster loop.

`data/`

- `src/data/monster_ecology.ts` owns ecology facts, selection weights, rarity, spawn context, cues, counterplay, rumors and rare drops.
- It must not mutate `World`, live entities, save state, DOM or renderer state.
- Ecology text is player-facing design data. Russian is canonical unless a task explicitly asks for translation.

`gen/`

- Owns initial placement: rooms, route stops, special sources, authored nests, trap anchors, wet/dark/fog pockets, loot and reachable set pieces.
- Generation chooses monster kinds through ecology data and local context, not through Russian display-name lookups or renderer sprite ids.
- Route/design/procedural floors may add authored monster scenes, but route-specific logic stays in the floor module or manifest, not in `main.ts`.

`systems/`

- Owns runtime ecology behavior: bait markers, local terrain checks, tactic profiles, source caps, counterplay reactions, cell hazards, noise/fog/water/light stimuli and compact events.
- Runtime helpers must be generic, bounded and reusable. Avoid a new subsystem for one monster when a flag/profile or authored module expresses the rule.
- All expensive reads need a radius, cap, cadence, TTL, dirty-version check or generation-time anchor.

`render/`

- Reads monster state and draws procedural sprites, marks, particles, HUD/log cues and map facts.
- Render may display ecology evidence; it must not own gameplay state or decide counterplay.
- Do not hide weak monster readability under full-screen postprocess noise. Improve cue, silhouette, mark, light, particle, sound or log evidence instead.

## Ecology Card

Every new or reworked monster should be readable as one ecology card:

```txt
kind
role
archetype
floors / rooms / route pressure
territory or source anchor
primary stimuli
combat rule
counterplay transition
samosbor reaction
implementation lane
performance cap
debug/test path
```

Required meaning:

- `role`: what pressure the monster adds.
- `archetype`: which shared behavior family expresses it.
- `territory/source anchor`: room, wall edge, wet line, lamp, fog pocket, office field, corpse, vent, lift, screen, source nest, door threshold, route scar or none.
- `primary stimuli`: hostile sight, recent damage, noise, bait/food, document scent, corpse, blood, light, dark, fog, water, wet line, fire, door/container event, pack call or samosbor pressure.
- `combat rule`: how ordinary baseline target/move/hit/shoot behavior changes while the rule is active.
- `counterplay transition`: what action changes state, target, windup, route, anchor, hunger, fear, reveal, reset or source output.
- `samosbor reaction`: amplified, displaced, born, shelter conflict or exempt.
- `implementation lane`: data-only, existing flag, new shared flag/helper, tactic profile, narrow generic system, authored floor module or save/runtime change.
- `performance cap`: scan radius, result cap, cadence, lifetime, child cap, source cap, hazard cell cap or generation-time placement.
- `debug/test path`: focused unit test, debug command, floor set piece, rumor/lead or map/editor route that reaches the behavior.

HP-only or sprite-only additions are not ecology. A monster can be simple, but it still needs a learnable rule.

## Archetypes

Use these archetypes before inventing bespoke behavior:

- `chaser`: direct pursuit with one readable weakness.
- `crowd_chaser`: cheap common pressure that becomes dangerous in doors, queues or tight rooms.
- `wall_edge`: stronger near walls, panels, seams, braces, weak-wall cells or door jams.
- `line_turret`: ranged or beam threat with windup, line break and recovery.
- `light_lock`: stronger near lamps/lit cells or weaker in darkness.
- `ambusher`: waits in fog, water, corpse, container, door, debris, darkness or furniture context.
- `territorial`: pressures a room, feature, wet patch, source nest, lamp cluster, office field or door threshold and resets away from it.
- `resource_predator`: responds to food, bait, documents, corpses, blood, light, noise or exposed loot.
- `pack_hunter`: shares target through capped local neighbors and deterministic slots.
- `parasite_controller`: uses hosts, command, possession or infection through strict caps and visible counterplay.
- `source_hive`: creates capped children or hazards from a visible source and stops when the source is sealed, burned, killed or exhausted.
- `mimic_threshold`: remains false/neutral/trap-like until a local reveal condition.
- `conditional_neutral`: can be fed, sampled, avoided, traded with, helped, reported or provoked.
- `room_puzzle_boss`: rare room-bound rule with explicit route/resource answer.

Archetypes can map to existing `AIGoal`, `monsterStage`, `ai.*` scalar fields, `aiFlags`, cell hazards, room memory, marks, events and tactic facts. They do not require a new enum per monster state.

## Implementation Lanes

Prefer the cheapest lane that produces a real decision:

1. `ecology data`: role, cue, rule, counterplay, rumor and spawn context only.
2. Existing `aiFlag`: reuse current behavior before adding a new flag.
3. New shared `aiFlag` or helper: only when several monsters need the same local rule.
4. `ActorTacticProfile`: for local multi-phase behavior with fixed radius/cap/cadence.
5. Narrow generic system: for sources, hazards, terrain, room memory, stimuli, bait or pack sharing that multiple families use.
6. Authored floor module: for a set piece that should not become a reusable monster rule.
7. Save/runtime shape change: last resort for persistent consequences that cannot be represented by existing events, floor memory, A-Life foldback, quest/faction/economy state or current save sections.

Do not build one custom state machine per monster. The shared ecology vocabulary should stay smaller than the monster count.

## Stimuli

Stimuli are compact local facts. They are not a global sense bus and not a full-floor memory scan.

Common stimuli:

- hostile sight or current combat target;
- recent incoming damage;
- noise or last sound point;
- bait, food, govnyak or open resource scent;
- documents, forms, permits or protocol pressure;
- corpse, blood, drops or opened container;
- light, dark, fog, water, wet line, dry concrete or fire;
- door, wall, weak panel, furniture or room-memory event;
- pack howl, source pulse, parasite command or NET/screen signal;
- samosbor warning, active pressure, scar or aftermath.

Each stimulus should have source id/cell, radius, severity, tags and TTL or cooldown. Monsters read it through local helpers, `entity_index`, existing path/terrain systems, room state or bounded scans. No monster should scan all entities, all rooms, all items, all events or the whole 1024x1024 world every frame.

## Territory And Sources

Territory is the spatial reason a monster exists.

Allowed anchors:

- home room, trap room or authored POI;
- door threshold, lift tambour or corridor choke;
- wall edge, weak panel, debris field or brace line;
- water line, dry edge, drain, sink/toilet cluster or slime patch;
- fog/dark pocket, light cluster, lamp line or office field;
- corpse nest, food pile, document office, screen/server/apparatus;
- source nest, plant root, vent, abyss, samosbor scar or route-specific floor mark.

Territorial monsters should not chase forever across the whole floor unless they are explicitly a route-level pressure. They pressure an edge, return to an anchor, lose strength outside it, flee/reset, or convert the room through a capped source/hazard rule.

Sources must be visible and capped:

- child count cap;
- hazard cell cap;
- spawn cooldown;
- source alive/dead check;
- entity soft-limit check;
- cleanup counterplay and event.

Killing or sealing a source should stop source output. It should not silently refill another source elsewhere unless generation/samosbor explicitly created one.

## Counterplay

Counterplay must change state, not only damage numbers.

Good counterplay can:

- interrupt a windup;
- break line of sight;
- scare or split a pack;
- satisfy hunger with bait;
- expose a mimic;
- deny a wall/wet/light/fog/source anchor;
- force a reset or flee phase;
- cut a wet line, light lock, fog pocket or document scent;
- make the monster choose a different target;
- create a rumor, event, mark, drop, clue or route warning.

Required evidence:

- cue before or during danger: sound, sprite posture, floor mark, local log, rumor, map/room clue, light/fog/water behavior or source animation;
- concise rule in `MonsterDef.counterplay` and `MonsterEcologyDef.counterplay`;
- death/fail wording where the cause is not obvious;
- at least one test/debug/floor path when behavior changes topology, source output, status, projectile behavior or special counterplay.

Counterplay must work for the world too. If noise scares a pack, an NPC noise event can scare it. If dry light weakens a slime monster, any actor forcing it onto dry lit concrete should matter. If document scent attracts a predator, an NPC carrying documents is a valid ecological target.

## Samosbor Ecology

Every monster card needs a samosbor line:

- `amplified`: samosbor raises aggression, source output, fog/water/dark strength, route pressure or hazard severity.
- `displaced`: monster flees a changing room, moves to edge, follows victims, loses anchor or enters reset.
- `born`: monster appears from samosbor aftermath, scar, source or authored rebuild consequence.
- `shelter_conflict`: monster affects shelter doors, room safety, denial, panic or NPC escort choices.
- `exempt`: baseline movement/combat already reacts honestly, so no special samosbor rule is needed.

Samosbor ecology is not population refill. It is a local event/rebuild/source consequence with a visible reason and a cap.

Runtime geometry mutations caused by ecology must bump the relevant world dirty versions through existing helpers or local precedent so AI/path/render caches stay valid.

## Performance Contract

The active floor can contain thousands of live NPCs and monsters. Ecology work is accepted only with an explicit bound:

- target/stimulus scan: local radius and result cap;
- repeated sensing: actor-local cooldown and deterministic jitter;
- pack behavior: one pulse/share fact, capped neighbors and no all-to-all brain;
- source spawning: child cap, cooldown, source id and entity soft-limit check;
- terrain check: local cells, bounded line, fixed queue or generation-time anchor;
- event output: cooldown and compact payload;
- debug trace: sampled facts or bounded ring buffer, never full behavior history;
- save persistence: sparse ids/facts only, not full actor histories.

Mass monsters should usually be stats plus one or two flags plus readable cue. Rare monsters can use richer profiles because there are few of them.

## Save And Persistence

Transient ecology state should not enter save:

- tactic timers;
- current target caches;
- local scan results;
- scratch arrays;
- windup internals that can restart safely;
- temporary source cooldowns unless the source state itself is persistent.

Persistent consequences may enter existing systems:

- dead monsters and marks through floor memory;
- ordinary NPC deaths/relation consequences through A-Life foldback;
- source cleanup through room state, events, floor memory or a bounded runtime/save section;
- quest, faction, economy or route consequences through their existing save sections;
- player inventory, item drops and rare loot through current item/container systems.

If ecology requires a new persistent section, cap it, sanitize malformed current-version input, bump `SAVE_SHAPE_VERSION` if shape compatibility breaks, and add focused tests. Do not add cross-version migration scaffolding by default.

## Adding Or Reworking A Monster

Use this order:

1. Check whether the idea can be expressed by an existing `MonsterKind`, ecology data, room state, mark, event, item, source or authored floor module.
2. If a new reusable creature is necessary, add a focused `src/entities/<id>.ts` package and register it in `src/entities/monster.ts`.
3. Add or update `MonsterEcologyDef`: floors, rooms, spawn weight, rarity, samosbor count, role, cue, rule, counterplay, rumor ids and rare drops.
4. Choose the cheapest implementation lane: data, existing flag, new shared flag/helper, tactic profile, narrow system or authored floor module.
5. Keep target choice generic: player, NPC or monster where hostility and rule allow.
6. Add compact events/rumors/marks only on meaningful transitions.
7. Add focused tests for registry coverage, selection gates, behavior transition, caps and non-player target validity.
8. Update README only if shipped implementation facts or counts change.

Do not add content-specific logic in `main.ts`, `core/world.ts`, `render/webgl.ts` or the broad AI orchestrator.

## Debug And Tests

Useful test lanes:

- registry audit: every `MonsterKind` has `MonsterDef`, sprite, ecology data, counterplay and event tags;
- selection audit: floor/room/rare/zero-weight monsters are selected or excluded correctly;
- full-pass audit: remote monsters and NPCs still update outside player proximity;
- target audit: ecological behavior can select NPC targets when valid;
- cadence audit: special scans do not run every frame;
- cap audit: pack/source/parasite/hazard children stop at fixed limits;
- counterplay audit: bait, light, dry edge, line break, wall denial, reveal or windup interrupt changes state;
- save audit: persistent ecology facts are bounded and stale saves are rejected when shape changes.

Debug output should show sampled facts rather than whole histories: kind, archetype/profile id, current stimulus, target id, anchor cell/room, scan cap, cooldown, last counterplay transition and source child count.

## Anti-Patterns

Reject these:

- player-only monster truth when NPC targets should be valid;
- timed monster refill after deaths;
- one bespoke state machine per monster;
- per-frame full-world, full-room, full-event, full-item or full-entity scans;
- per-actor BFS;
- off-floor monster combat simulation;
- renderer-owned gameplay state;
- Russian display-name lookups in hot logic;
- unbounded source children, hazards, logs, rumors or debug arrays;
- save-shape changes for transient timers or caches;
- new `FloorLevel` values for route monsters, traps or ecology stops;
- hardcoded route/floor content in `main.ts`;
- broad AI rewrites before one reachable rule ships.
