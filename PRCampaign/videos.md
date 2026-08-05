# GIGAH|RUSH Video Prompt Pack

Дата: 2026-06-05.
Статус: рабочий пакет промтов для генерации трейлеров. Видео в этом проходе не генерировались и не публиковались.

Цель: получить несколько сильных роликов для публичных тредов, Telegram/VK, DTF/forum updates, медиа-питчей и будущих platform-native постов. Промты рассчитаны на Sora 2, Veo и Gemini/video generation. Каждый блок можно копировать как есть.

Для выбора конкретной Google AI поверхности сначала см. `PRCampaign/google_ai.md`: там описано, когда использовать Gemini app, Veo, Flow, Google Vids, NotebookLM, AI Studio/API, Vertex AI, Lyria, Gemini CLI, Jules и другие Google surfaces. Этот файл остается библиотекой самих видеопромтов.

## Что учитывать

Проверены:

- live `/sf/` тред: `https://2ch.org/sf/res/262936.html`;
- первый архивный `/b/` тред: `https://arhivach.vc/thread/1360074/`;
- второй архивный `/b/` тред: `http://arhivach.vc/thread/1362682/` (тот же id через `https` может сбоить);
- `README.md`, `architecture.md`, `desdoc.md`, `samosbor.md`, `scenarist.md`, `taste.md`;
- PR docs: `PRCampaign/KPI.md`, `campaign_plan_ru.md`, `kpi_report_2026-06-04.md`, `copy_pack_ru.md`;
- source anchors: `src/data/base_floors.ts`, `src/data/samosbor_variants.ts`, `src/data/weapons.ts`, `src/entities/monster.ts`, `src/render/textures.ts`, plot/NPC snippets.

Вывод из тредов для трейлеров:

- игрокам не хватает не слов, а ясных сцен: куда идти, что делать, где лифт, зачем еда/вода/патроны, почему страшен самосбор;
- фичи надо показывать в действии, а не перечислять;
- сильные кадры уже цепляют, но ролик должен делать вход понятнее;
- публичная подача должна быть честной: это бесплатная браузерная игра в разработке, не глянцевый AAA и не фейковый MMO.

## Общий запрет для всех промтов

Не использовать:

- точные инженерные размеры, карту, топологию или слова про `1024x1024`;
- "завершенная игра", "релиз мечты", "полностью готовый MMO";
- космос, звездолеты, фэнтези-доспехи, магические замки, generic cyberpunk city, гладкий mobile-game UI;
- красивые абстракции вместо действия;
- длинные псевдофилософские титры;
- случайную латиницу/кириллицу на вывесках, если текст не может быть четким;
- откровенную расчлененку, NSFW, real-world political symbols, recognizable copyrighted characters;
- чистый современный офис, стеклянные небоскребы, лазерный sci-fi, военных спецназовцев в западной экипировке как основу мира.

Если модель плохо пишет текст на экране: попросить оставить таблички без букв, а титры добавить монтажом.

## Визуальная ДНК

Использовать:

- бесконечная бетонная структура, советская хрущевка, коммуналки, кухни, актовый зал, медпункт, оружейная, коридоры, лифты, гермодвери;
- мокрый линолеум, плитка, панельный бетон, ржавые трубы, щитки, лампы, плакаты, карточки, талоны, бланки, печати, списки;
- low-fi WebGL raycaster feeling: жесткая перспектива коридоров, billboard-like silhouettes, процедурные текстуры, пиксельная служебная HUD-плашка;
- NPC как обычные жильцы, ликвидаторы, ученые НИИ, культисты, бандиты, торговцы;
- следы боя как факты мира: пулевые отметины, кровь на полу, открытые контейнеры, закрытые гермы, пустые пайки;
- самосбор как событие с решением: сирена, туман, укрытие, монстры, перестроенный коридор, aftermath;
- варианты самосбора: фиолетовый классический, зеленый Маронарий, золотой Истотит, белый Веретар.

## Важно для Gemini / Veo

Gemini/Veo может отклонять промт из-за слов, перечисленных даже в негативном блоке. Не вставляйте в Gemini длинный `Avoid ...` список с чувствительными категориями. Для Gemini используйте короткие positive-only промты из раздела ниже: они описывают нужный кадр через стиль, предметы и атмосферу, не перечисляя запрещенные темы.

Если Gemini отказал:

- убрать весь негативный промт;
- заменить `survival horror` на `survival suspense`;
- заменить `Soviet` на `late-20th-century Eastern European concrete apartment-block`;
- убрать слова `blood`, `wounded`, `gunfire`, `monster`, `gore`, `NSFW`, `nudity`, `SWAT`, `copyrighted`, `political`;
- не просить текст на вывесках внутри видео;
- начать с одного простого 8-10s кадра без боя, затем усложнять.

## Универсальный негативный промт, не для Gemini

```text
Avoid generic fantasy, spaceships, clean cyberpunk city, glossy mobile-game interface, soft rounded app cards, anime waifu style, superhero costume, medieval armor, photoreal American SWAT team, random unreadable Cyrillic, long fake UI text, exact implementation map dimensions, clean modern office, shiny sci-fi lab, casino colors, comedy mascot tone, explicit gore, nudity, real political symbols, copyrighted characters. Keep the world concrete, Soviet apartment-block, procedural, low-fi, survival horror, readable silhouettes, practical objects, no abstract cosmic imagery unless it is dry and bureaucratic.
```

## Gemini-safe: первый кадр без отказа

Сначала пробовать именно этот короткий вариант. Он не показывает бой и не перечисляет запреты.

```text
Create a 10-second 16:9 cinematic teaser for an original browser game named GIGAH|RUSH. Scene: a late-20th-century Eastern European concrete apartment-block interior, lived-in and worn. A small clinic room opens into a dim corridor with concrete wall panels, linoleum floor, old lamps, pipes, paper notices, a heavy metal shelter door and a simple wall map with colored route marks. An older clinic worker calmly gives a resident a small cloth wrap, bread and a water bottle before an expedition. The resident packs the items into a worn bag. Style: grounded survival suspense, low-fi WebGL raycaster inspiration, procedural texture look, practical lighting, quiet tension, no glossy modern design. Camera: slow push from corridor into the handoff, then closeup of the bag and map. Keep signs mostly blank; add the title later in editing.
```

## Gemini-safe: тот же кадр, еще короче

```text
10-second 16:9 cinematic teaser for GIGAH|RUSH. A worn Eastern European concrete apartment-block corridor, old lamps, pipes, linoleum, paper notices, heavy shelter door, simple route map. In a small clinic room, an older worker gives a resident bread, water and a cloth wrap for an expedition. Low-fi browser-game raycaster mood, practical lighting, quiet suspense, readable concrete textures, no on-screen text. Slow camera push, closeup of hands and bag.
```

## Sora 2: большой синематик трейлер, 9 кусков

Формат: генерировать по 8-10 секунд, 16:9, 24 fps, потом монтировать. Можно делать 9:16 версию, если нужен Shorts/TikTok/Reels hook.

### SORA2-01 - Жилая зона, первый шаг

```text
Duration 8 seconds, 16:9, cinematic trailer shot for a browser survival horror game called GIGAH|RUSH / ГИГАХРУЩ. A Soviet apartment-block living zone inside an unbounded concrete megastructure. Low-fi WebGL raycaster inspiration, but filmed cinematically: hard corridor perspective, procedural concrete panels, linoleum floor, flickering fluorescent lamps, canvas-HUD-like minimal overlay. A tired medic woman in a small infirmary hands a bandage, bread and a bottle of water to a nervous resident. In the background: a corridor with a hermetic metal door, old posters, a wall map with simple colored marks. The player is not a hero, just a resident preparing for a dangerous errand. Mood: practical, oppressive, lived-in, not glossy. No readable text except optional final small label "ГИГАХРУЩ"; if text is not crisp, leave signs blank. Camera: slow push-in from corridor to the handoff, shallow fog, distant siren very faint.
```

Gemini-safe версия этого же кадра:

```text
Create a 10-second 16:9 cinematic teaser for GIGAH|RUSH. A worn Eastern European concrete apartment-block living zone with procedural concrete panels, linoleum, old lamps, pipes, paper notices and a heavy shelter door. A small clinic room opens into the corridor. An older clinic worker calmly gives a resident bread, water and a cloth wrap before an expedition. The resident packs a worn bag beside a simple route map with colored marks. Style: grounded survival suspense, low-fi browser raycaster inspiration, practical lighting, quiet tension, readable silhouettes, mostly blank signage. Camera: slow push-in from corridor to hands, bag and map.
```

### SORA2-02 - Баринов и Макаров

```text
Duration 8 seconds, 16:9, same world and visual style. An improvised armory and shooting range inside a concrete residential block. A stern liquidator instructor gives the player a worn Makarov pistol and eight cartridges on a scratched table. The player fires once down a dim corridor at a paper target; a bright muzzle flash, one clear bullet mark appears on the concrete wall, the sound echoes through pipes. Show ammo scarcity: only a few cartridges, not an action-movie arsenal. Pixel-canvas HUD hint appears as tiny abstract bars, not readable paragraphs. Camera: over-the-shoulder, then quick cut to impact mark. Mood: "a pistol buys one second to reach a door", survival pressure, grounded.
```

### SORA2-03 - Подготовка к вылазке

```text
Duration 8 seconds, 16:9. Close cinematic montage of expedition preparation in a communal room: water bottle, bread, bandage, ammo, documents, a battered map, chalk, a flashlight, a rusty wrench and Makarov laid on a table. Ordinary residents pass behind, one argues at a sink, one checks a list near a radiator. The player packs only a few items into a worn bag. Visual style: gritty Soviet-punk, pixel-raycaster texture influence, procedural concrete, harsh practical light. No fantasy, no hero pose. Camera: macro closeups with fast practical cuts, each item feels usable and scarce.
```

### SORA2-04 - Лифт и вертикальный маршрут

```text
Duration 9 seconds, 16:9. A heavy old elevator in a concrete megastructure. The doors open into a service corridor, then slam shut; indicator lights flicker through impossible route numbers but no exact technical map. The camera rides with the player as the lift descends, passing glimpses of different route floors through door cracks: communal ring, wet utility tunnels, a ministry archive, a dark metro platform, a meat-stained lower passage. The lift is the promise of many small worlds. Keep it grounded in concrete, pipes, metal, paper notices, dirty lamps. No skyscrapers, no spaceship elevator. Camera: claustrophobic interior, rhythmic cuts, pressure rising.
```

Gemini-safe версия без опасной сцены в лифте:

```text
Create a 9-second 16:9 cinematic route-preview shot for GIGAH|RUSH. The camera stands safely in a concrete elevator lobby inside a worn apartment-block megastructure. A service lift is parked with its doors open like a stage frame. The camera does not enter the lift. The open doorway softly crossfades between different route-floor previews: a communal kitchen corridor, a damp utility hallway, an archive with paper folders, a quiet underground platform, and a lower concrete service passage with warm red emergency light. The lift panel shows abstract colored dots instead of readable numbers. Style: grounded survival suspense, low-fi browser raycaster inspiration, concrete, pipes, metal, paper notices, dirty lamps, practical lighting. Calm camera, slow push toward the open doorway, no door impact, no falling, no trapped people, no on-screen text.
```

### SORA2-05 - A-Life: мир живет без игрока

```text
Duration 9 seconds, 16:9. A single active floor feels alive. NPC residents, traders and armed liquidators move through corridors for their own reasons: one carries water, one locks a door, two argue over a ration list, a patrol drags an injured person, a trader hides cartridges under a counter. In the far corridor, gunfire flashes between NPCs before the player arrives. After the fight, bullet marks and blood remain on the floor. Show consequences as persistent traces, not a scripted cutscene. Visual style: low-fi raycaster silhouettes, concrete and linoleum, practical HUD dots on a map overlay, no polished cinematic city.
```

### SORA2-06 - Первый бой, не героический

```text
Duration 8 seconds, 16:9. A narrow concrete corridor during an expedition. A rough monster silhouette, half human and half concrete debris, emerges under flickering light. The player fires two Makarov shots, misses one, hits once; ammo counter almost empty. The player backs toward a hermetic door, then uses a rusty pipe to push the creature away. The monster has a clear silhouette and counterplay: heavy, slow, dangerous up close. Show fear, decision, retreat, not power fantasy. Camera: shaky but readable, no motion blur that hides the action, one muzzle flash, one bullet mark, one impact.
```

### SORA2-07 - Классический Самосбор

```text
Duration 10 seconds, 16:9. Samosbor begins in a residential/service corridor. A dry warning siren starts, hermetic doors begin to seal, purple fog leaks from wall seams and under doors. NPCs run toward shelter, one drops a bag, another pounds on a closing hermetic door. The floor light shifts violet, the HUD becomes a short emergency strip, not a wall of text. A monster shape appears inside the fog, not fully revealed. Important: Samosbor is a local world event, not just a screen filter. Show the corridor physically changing: a side passage becomes blocked, a door twitches, fog leaves residue. Camera: escalating tracking shot from calm corridor to sealed panic.
```

### SORA2-08 - Варианты Самосбора

```text
Duration 10 seconds, 16:9. Fast epic montage of three rare Samosbor variants, each visually distinct and tactical. Maronary: green source glow from a peephole, a wrong door repeats the same corridor, chalk number on a door. Istotit: low golden bell, gold outline around a shelter door, a list of names, only a few people can fit inside. Veretar: white overexposed window, curtain pulled tight, dry pale sand on wet linoleum, a photo burns white. Keep the scenes concrete and practical: doors, lists, curtains, witnesses, water, not abstract magic. No long text. Camera: three precise vignettes, 3 seconds each, crisp color identity.
```

### SORA2-09 - Последствия и титр

```text
Duration 9 seconds, 16:9. After Samosbor. The same floor is changed: purple residue near the baseboard, a sealed door with scratches, an empty ration box, a bullet-marked wall, one missing name on a list, a corridor that no longer matches the map. The player returns to the living zone wounded, with one sample jar and almost no ammo. NPCs look at the bag, not at the camera. End on a simple title card: "ГИГАХРУЩ / GIGAH|RUSH" and below "free browser survival horror" if text can be crisp; otherwise leave only the title for post-production. Mood: epic but dry, consequences matter, no triumphal superhero shot.
```

### POST-CREDITS-01 - выдох и крючок после титра

Gemini-safe версия:

```text
Create a 6-second 16:9 post-credits stinger for the same GIGAH|RUSH trailer. Start from black after the title card, with one soft low cinematic hit, then a quiet concrete elevator lobby in the same worn apartment-block megastructure. The service lift is parked open and still. A worn bag, a bread piece and a water bottle rest on a bench. A simple route map on the wall looks calm at first; then one small green route dot appears where the map was empty. A cup on the bench makes a tiny ripple, the hallway light warms and fades. No people in frame, mostly blank signs, no readable text, no action scene. Mood: relief first, then quiet suspense, like the building quietly continues after the trailer ends.
```

Более тревожная версия для Sora/Veo:

```text
Duration 6 seconds, 16:9, post-credits stinger after the GIGAH|RUSH title card. Black screen, one deep "tudun" bass hit, then silence. Cut to the same concrete service-lift lobby after everyone has left. A worn bag sits on a bench with bread, water and a sealed sample jar. The lift stands open and empty. On the wall map, a green route dot appears by itself, then the elevator indicator adds one extra impossible stop. A fluorescent lamp flickers once; the camera stays still. No jump scare, no creature reveal, just a small bureaucratic wrongness. Fade to black.
```

## Veo: 30-секундный тред-хук

Формат: быстрый ролик для `/sf/`, `/b/`, Telegram, VK. Цель - за 30 секунд объяснить игру лучше, чем шапка треда.

```text
Create a 30-second cinematic gameplay-adjacent trailer, 16:9, 24 fps, gritty low-fi WebGL raycaster aesthetic mixed with filmic camera work.

Subject: GIGAH|RUSH / ГИГАХРУЩ, a free browser survival horror / ARPG shooter about expeditions inside an unbounded Soviet concrete apartment-block megastructure.

Structure:
0-4s: A resident wakes in a concrete living zone, harsh fluorescent light, canvas HUD minimal bars, a medic gives water and a bandage.
4-8s: A stern liquidator instructor puts a worn Makarov and 8 cartridges on a table; one shot at a target, bullet mark remains.
8-12s: Expedition prep closeups: bread, water, ammo, documents, chalk, wrench, map.
12-16s: Old lift doors open into different route floors: communal corridor, wet utility tunnel, ministry archive, dark metro, meat lower passage.
16-21s: NPCs live independently: trader, patrol, residents, gunfight already happened, blood and bullet marks remain.
21-26s: Samosbor starts: purple fog leaks under doors, hermetic doors seal, NPCs run, a monster silhouette appears.
26-30s: Aftermath: changed corridor, white Veretar sand, green Maronary door mark, gold Istotit shelter list, player returns with a sample jar. End title: "ГИГАХРУЩ / GIGAH|RUSH".

Visual DNA: Soviet apartment block, concrete panels, linoleum, rust pipes, hermetic doors, bureaucratic papers, practical lamps, pixel silhouettes, procedural texture look, survival UI.

Tone: epic, tense, concrete, readable. Not a generic horror movie. Not a superhero trailer. Show actions and consequences, not abstract lore.

Negative: no spaceships, no neon cyberpunk city, no fantasy armor, no glossy mobile UI, no clean sci-fi lab, no random long Cyrillic text, no exact map dimensions, no NSFW, no explicit gore.
```

## Gemini / Veo: 20-секундный вертикальный клип

Формат: 9:16, можно делать как короткий loop для канала и треда.

Gemini-safe сначала:

```text
Create a 20-second vertical 9:16 teaser for GIGAH|RUSH, an original browser survival suspense game. Style: late-20th-century Eastern European concrete apartment-block, worn linoleum, old lamps, pipes, paper notices, heavy shelter doors, simple route map, low-fi browser raycaster mood, practical lighting.

Scene plan:
1. Closeup: a resident packs bread, water and a cloth wrap into a worn bag.
2. An old elevator opens into a dim service corridor with pipes and concrete panels.
3. A simple wall map shows one colored route mark; lights flicker and the mark becomes uncertain.
4. Purple mist slides quietly along the floor while a heavy shelter door closes.
5. The same corridor appears changed afterward: route mark moved, residue near the baseboard, empty shelf, title space reserved for editing.

Keep people intact and focused on preparation and shelter. Mostly blank signs, no readable UI paragraphs, no glossy modern design.
```

Более агрессивная версия для моделей, которые не ругаются:

```text
Generate a 20-second vertical 9:16 cinematic trailer clip for GIGAH|RUSH / ГИГАХРУЩ.

Style: gritty Soviet survival horror, browser WebGL raycaster inspiration, procedural concrete textures, pixel-canvas HUD hints, readable silhouettes, handheld but clear camera.

Scene plan:
1. A close hand packs three things: water bottle, bandage, 8 cartridges.
2. Old elevator doors open to a corridor that should not fit inside a residential building.
3. A wall map blinks with a single objective marker, then the marker vanishes as the lights flicker.
4. Purple fog leaks under a hermetic door; a resident slams the seal and another is left outside.
5. A monster silhouette steps through fog; the player fires once, then retreats instead of winning.
6. Final shot: same corridor after the event, changed geometry, bullet marks, residue, title card "ГИГАХРУЩ".

Keep text minimal. If the model cannot render crisp Cyrillic, leave all signage blank and reserve title for editing. No modern glossy UI, no fantasy, no sci-fi spaceship, no clean cyberpunk.
```

## Sora 2 / Veo: серия Самосборов

Эти ролики можно делать отдельными 8-10s клипами и выкладывать как "виды самосбора".

### SAMOSBOR-01 - классический фиолетовый

```text
Duration 9 seconds, 16:9. A classic Samosbor event in a Soviet concrete apartment-block corridor. Purple fog seeps through cracks, under doors and along the floor. Hermetic doors begin sealing with heavy metal clicks. A practical emergency siren reflects in wet linoleum. Residents run toward shelter; one throws a bag through the door before it closes. In the fog, only a rough monster silhouette is visible. The corridor physically changes: a side passage darkens and becomes blocked, residue remains on the baseboard. Style: gritty low-fi WebGL raycaster horror, procedural textures, readable action, no abstract magic.
```

### SAMOSBOR-02 - Маронарий

```text
Duration 9 seconds, 16:9. Maronary variant of Samosbor. No siren, only a thin high beep from the wall. A green glow leaks from a peephole and old screen, burning the air. The player writes a door number with chalk, opens a door, and the same corridor repeats wrong. A map marker points to a short path, but the player refuses it and backs away from the green source. Documents in a pocket twitch as if their owner name changed. Concrete, doors, numbers, chalk, green proof-noise, dry fear. No fantasy portal; it is a wrong-door bureaucratic anomaly.
```

### SAMOSBOR-03 - Истотит

```text
Duration 9 seconds, 16:9. Istotit variant of Samosbor. A low cathedral-like bell replaces the siren, but the setting is still a Soviet apartment corridor. A golden outline appears around a hermetic shelter door. Inside: water bottle, candle, ration list, too few places. Outside: a neighbor knocks and calls by name. The player hesitates at the door handle. Gold dust on the baseboard, a handwritten list of survivors, moral pressure, not religious fantasy. Style: dry, bureaucratic, survival horror, readable faces and hands, no angelic glow, no fantasy church.
```

### SAMOSBOR-04 - Веретар

```text
Duration 9 seconds, 16:9. Veretar variant of Samosbor. A white overexposed window appears where there should be a kitchen wall. The curtain strains outward even though there is no wind. Dry pale sand lies on wet linoleum. A photograph turns white before the camera shutter sound finishes. A resident near the window forgets the route home. The player pulls cloth over the window and backs away toward a dark hermetic door. Tone: terrifying because it is practical and quiet. No cosmic portal, no outer space, no beach, no clean white sci-fi void.
```

## Монстр-промты: тяжелый жуткий силуэт

### MONSTER-01 - толстый ходок в коридоре

Gemini-safe версия:

```text
Create an 8-second 16:9 cinematic creature reveal for GIGAH|RUSH. A worn concrete apartment-block corridor, old lamps, pipes, linoleum floor, paper notices, heavy shelter door in the distance. From the far end of the corridor, a large bulky creature slowly waddles into view. It has a heavy uneven silhouette, short thick legs, slumped shoulders, a rough concrete-and-cloth surface, and moves with a tired side-to-side sway. The floor light flickers as its weight makes small ripples in a puddle. Keep the creature eerie but not graphic: no wounds, no gore, no attack, just presence and movement. Low-fi browser raycaster inspiration, readable silhouette, practical lighting, quiet suspense. Camera stays low and still near the floor, watching the creature approach but stop far away.
```

Sora/Veo версия страшнее:

```text
Duration 8 seconds, 16:9. A narrow concrete corridor in GIGAH|RUSH. Far away, a huge squat monster waddles out from behind a pipe column: heavy belly-like mass, thick uneven arms, shoulders too low, head almost hidden in the torso, skin like dirty concrete, old fabric and damp plaster. It moves slowly, side to side, each step making the linoleum flex and the lamp buzz. The horror is in the weight and inevitability, not speed. No gore, no jump scare. Camera: low angle, long lens down the corridor, tiny HUD dots flicker, the monster stops under a lamp and only its silhouette is fully readable.
```

### MONSTER-02 - бетонник у кухни

```text
Duration 9 seconds, 16:9. A communal kitchen corridor inside a worn apartment-block megastructure. A kettle trembles on a stove, cups rattle on a shelf, water drips from a pipe. A bulky concrete-bodied creature squeezes slowly through a kitchen doorway, too wide for the frame, scraping old paint with its shoulders. It walks with a heavy waddling gait, almost tired, but every small movement feels difficult to stop. The player is not shown fighting; the camera hides behind a half-open pantry door. Style: grounded survival suspense, low-fi raycaster monster silhouette, practical domestic horror, no gore, no fast attack, no fantasy.
```

### MONSTER-03 - силуэт в фиолетовом тумане

Gemini-safe версия:

```text
Create an 8-second 16:9 suspense shot in a concrete service corridor. Thin purple mist moves along the floor. A large rounded creature silhouette is visible behind the mist, waddling slowly across a doorway from left to right. Only its outline is clear: bulky torso, uneven shoulders, short heavy steps. The scene is quiet except for old lamps and distant metal ticks. The creature never touches anyone and remains partly hidden. Mood: strange, heavy, unsettling, like the corridor itself grew a body. Low-fi browser raycaster inspiration, readable silhouette, blank signs, practical lighting.
```

### MONSTER-04 - псевдо-бытовой монстр

```text
Duration 10 seconds, 16:9. A supposedly ordinary storage room in GIGAH|RUSH: shelves, buckets, ration boxes, old coats, a mop, concrete walls. Something large in the corner looks like a pile of coats and repair bags. Slowly it stands up and becomes a fat waddling monster made of coats, concrete dust, swollen plaster and household junk. It takes one clumsy step, knocking a tin cup from a shelf. The camera does not run; it only realizes the object was alive. Keep it weird, domestic and frightening, not graphic. Low-fi raycaster aesthetic, harsh lamp, practical details, no action scene.
```

### MONSTER-05 - поворот за лифтом

```text
Duration 7 seconds, 16:9. Empty concrete elevator lobby after the trailer title. A service lift stands open. From the blind corner beside the lift, a large bulky monster slowly waddles into frame, only half visible: one thick arm, rounded torso, dragging shadow, heavy uneven steps. It pauses, turns its hidden head toward the camera, then the hallway light clicks off. No attack, no gore, no scream. The scare is the reveal that the safe route is occupied. GIGAH|RUSH low-fi browser raycaster mood, concrete, pipes, paper notices, practical light.
```

### MONSTER-06 - монстр как правило геймплея

```text
Create a 12-second 16:9 gameplay-adjacent cinematic for GIGAH|RUSH. Show a bulky slow corridor monster as a tactical problem. Shot 1: the creature waddles down a narrow corridor, too heavy to sprint but hard to push aside. Shot 2: a resident quietly closes a side door and waits. Shot 3: the monster follows sound, turning toward a dropped metal cup. Shot 4: the player marks a route on a simple map and chooses a longer corridor around it. The monster is scary because it controls space, not because it attacks on camera. Concrete apartment-block, linoleum, pipes, low-fi raycaster silhouette, readable movement, no graphic violence.
```

### MONSTER-07 - аморфная туша без лица

Gemini-safe версия:

```text
Create an 8-second 16:9 cinematic creature reveal for GIGAH|RUSH. A dim concrete apartment-block corridor with linoleum floor, pipes, old lamps and blank paper notices. From the far end, a large faceless amorphous creature slowly waddles into view. It has no visible eyes, no mouth and no readable face, only a heavy rounded body, uneven folds, damp pale surface, short dragging steps and a low side-to-side sway. It looks like a shapeless living mass rather than an animal. Keep it eerie and non-graphic: no wounds, no exposed anatomy, no attack, no contact with people. The fear comes from the blank faceless body, weight, silence and slow movement. Low-fi browser raycaster inspiration, readable silhouette, practical light, quiet suspense. Camera stays still and low near the floor.
```

Sora/Veo версия мяснее:

```text
Duration 8 seconds, 16:9. A concrete residential corridor in GIGAH|RUSH, linoleum floor, old pipes, weak fluorescent lamp. A huge amorphous carcass-like monster waddles forward from the dark end of the corridor. It has no face, no eyes, no mouth, no expression: only a sagging rounded meat-like mass under dirty grey-pink skin, heavy folds, uneven shoulders, short thick legs, slow swaying steps. It feels like a butchered shape learned to walk, but keep it non-graphic: no open wounds, no exposed organs, no gore spray. Camera: low static angle, long corridor perspective, the faceless mass stops under a flickering lamp, then the light fades.
```

## Sora 2: A-Life и последствия

```text
Duration 12 seconds, 16:9. Cinematic proof-of-system trailer shot for GIGAH|RUSH. Show a floor before and after the player passes through. Before: ordinary NPCs trade, sleep, carry water, guard a door, argue by a radiator, and a scientist writes a sample label. During: a distant fight happens without the player in frame, muzzle flashes down a corridor, one NPC falls, others flee. After: the player arrives late; bullet marks, blood stains, an empty container, a missing name on a local list, a trader changing prices, a rumor spreading near a kitchen. The world feels alive without the player. Low-fi WebGL raycaster visual identity, concrete, linoleum, service UI, no fake crowds of thousands, no clean cinematic city.
```

## Veo / Gemini: боевая вылазка

```text
Generate a 25-second 16:9 action-survival trailer scene. A player leaves the living zone with a Makarov, a rusty pipe, bread, water and bandage. The route goes through a service corridor with pipes, wet floor and flickering lamps. A slow concrete-heavy monster blocks the path. The player fires twice, sees ammo nearly gone, shuts a door, switches to a pipe and retreats. A second NPC patrol enters from the far side and also fights the monster; bullets leave marks on the wall. The player grabs a sample jar from a broken cabinet and runs back toward the lift as a Samosbor warning starts. The action must be readable: clear monster silhouette, clear muzzle flash, clear retreat choice, no superhero victory.
```

## Sora 2 / Veo: маршрут вниз

```text
Duration 30 seconds, 16:9. Epic vertical-route montage inside GIGAH|RUSH. Begin in a living-zone act hall and move downward through old elevators and route floors. Show each floor as a small world, not a level select: Communal Ring with crowded kitchens, Black Market 88 with contraband under lamps, Production Belt with machines and repair tables, Silicon Net Well with cyan terminals and strange silicon life, Dark Metro with a dangerous short passage, Underhell with living meat walls and a fortified threshold, Podad with moving walls, Spectral Chapel with sound and cult geometry, then a dry green-black Void-like protocol space. Keep all scenes grounded in concrete megastructure, documents, doors, pipes, shelters and survival decisions. Do not reveal exact map size or topology. End on a lift door closing and the title "ГИГАХРУЩ".
```

## Gemini: техно-ролик для Habr/devlog

```text
Create a 35-second technical-cinematic trailer for developers. Show that GIGAH|RUSH is a browser game built from data, not an asset-heavy engine. Visual metaphor, not literal code tutorial.

Shot list:
1. A concrete corridor becomes a clean data grid for one second, then returns to raycaster view.
2. Procedural concrete, linoleum, metal doors and meat walls assemble from simple pixel noise textures.
3. Flat billboard-like NPC and monster silhouettes move through the same floor; the player is just one actor among them.
4. A local event marks the world: bullet holes, blood, opened doors, empty containers.
5. A Samosbor wave rewrites a bounded part of the floor; the same floor remains changed afterward.
6. Final browser frame: one canvas world, no install, title GIGAH|RUSH / ГИГАХРУЩ.

Style: low-level architecture made cinematic, not corporate motion graphics. Use concrete, typed-grid visual motif, WebGL raycaster feeling, minimal HUD. Avoid exact implementation dimensions, no source-code walls of fake text, no Three.js logo, no dependency logos.
```

## Sora 2: хоррор без монстра

```text
Duration 10 seconds, 16:9. No monster visible. A residential corridor in an unbounded concrete apartment structure. The player stands near a kitchen. A kettle boils alone, a fluorescent lamp flickers, water slowly creeps across linoleum from under a locked door. A wall map shows a route marker, then the marker becomes unreliable. The hermetic door at the end clicks once. Purple fog appears only as a thin line at the baseboard. The fear comes from practical details: water, door, list, missing neighbor, not a jumpscare. Low-fi raycaster horror, gritty Soviet domestic setting, cinematic camera.
```

## Sora 2 / Veo: публичный "proof trailer" после критики

Этот ролик отвечает на главный упрек из тредов: "фичи перечислены, но не показаны".

```text
Duration 40 seconds, 16:9. Make a proof-focused trailer for GIGAH|RUSH showing mechanics through actions, not feature lists.

0-5s: The player receives a concrete objective from a medic: take water, bandage, go to the armory.
5-10s: The instructor gives a Makarov; one shot leaves a bullet mark.
10-15s: The player chooses supplies on a table: food, water, ammo, documents, chalk.
15-20s: The lift opens into a different floor; the player follows a route through faction territory.
20-25s: NPCs act independently: trade, patrol, fight, flee.
25-31s: Samosbor warning: hermetic doors seal, purple fog starts, player must shelter.
31-36s: Aftermath: changed corridor, residue, dead NPC not replaced, empty container.
36-40s: Title only: "ГИГАХРУЩ / GIGAH|RUSH - play in browser".

Keep it honest: current playable browser build, gritty low-fi survival horror, no fake open-world city, no impossible AAA crowd, no modern glossy UI.
```

## Короткие loop-промты для тредов

### LOOP-01 - дверь повторилась

```text
8-second seamless loop, 9:16. A player opens a green-lit apartment door in a concrete Soviet corridor, steps through, and appears back in the same corridor from the opposite side. A chalk number on the door changes by one digit. The green Maronary glow is subtle, dangerous, bureaucratic. Low-fi raycaster horror style, no fantasy portal, no readable long text.
```

### LOOP-02 - герма закрывается

```text
8-second seamless loop, 9:16. Purple fog crawls along wet linoleum as a heavy hermetic door slowly closes. A hand pushes a water bottle through the gap, another hand grabs it from inside, then the door seals. Concrete panels, emergency light, muffled siren, survival decision. No gore, no monster reveal, just pressure.
```

### LOOP-03 - лифт не туда

```text
8-second seamless loop, 9:16. Old Soviet elevator doors open again and again, each time revealing a different impossible floor: communal kitchen, archive corridor, service tunnel, dark metro, meat-walled lower passage. Same elevator frame, different route world. Gritty, low-fi, readable, no exact map or technical dimensions.
```

### LOOP-04 - Веретарское окно

```text
8-second seamless loop, 9:16. A white overexposed window appears in a concrete corridor where no window should exist. A curtain pulls outward, dry sand trickles onto wet linoleum, and a photograph on the floor slowly turns white. Quiet, practical horror, no outer space, no bright sci-fi portal.
```

## Suno AI: музыка для трейлера

Для Suno не использовать имена конкретных артистов и не просить "как группа X". Лучше описывать жанр, темп, инструменты, структуру, настроение и монтажные точки.

### SUNO-01 - главный трейлер, эпик дарк хард

Style prompt:

```text
Original dark epic industrial metal trailer score, 92 BPM, heavy distorted bass, low brass, taiko drums, Soviet civil-defense siren texture, concrete reverb, male Slavic choir vowels, hard percussion hits, suspense build, no pop hook, cinematic final impact
```

Lyrics prompt:

```text
[Instrumental intro]
Тихо. Двери считают шаги.
Лифт помнит, кто вышел.

[Low male choir]
Са-мо-сбор.
Са-мо-сбор.

[Build]
Вода. Патроны. Хлеб. Документы.
Герма закрыта.
Карта молчит.

[Drop]
ГИГАХРУЩ.
Дом идет.
Этаж не простил.

[Final]
Са-мо-сбор.
Не геройствуй.
Дойди обратно.
```

### SUNO-02 - чистый инструментал для монтажа

```text
Instrumental only. Dark epic industrial orchestral metal for a survival suspense game trailer. 88 BPM intro rising to 104 BPM. Deep concrete-like percussion, taiko drums, metal pipe hits, distorted sub bass, low strings, brass swells, distant emergency siren, cold synth drones, short choir vowel stabs, huge final trailer hit, tense but not heroic, grim apartment-block atmosphere.
```

### SUNO-03 - Самосбор начинается

Style prompt:

```text
Dark hard industrial trailer music, 100 BPM, emergency siren rhythm, huge drums, distorted bass pulses, metallic pipe percussion, low choir, dissonant strings, oppressive concrete atmosphere, cinematic horror action build, final alarm cutoff
```

Lyrics prompt:

```text
[Whispered]
Сначала укрытие.
Потом слова.

[Choir]
Са-мо-сбор.
Са-мо-сбор.

[Percussion build]
Гермы. Щели. Туман.
Карта. Дверь. Обход.

[Hard drop]
Не смотри в свет.
Не верь короткому пути.
Держи воду.
Держи дверь.

[Outro]
После отбоя
этаж будет другим.
```

### SUNO-04 - Маронарий, зеленый неправильный путь

```text
Original dark industrial suspense track, 96 BPM, high electronic beep motif, broken elevator chime, metallic ticks, deep bass drone, cold green-screen synth, low whispered choir, restrained percussion, wrong-door anxiety, bureaucratic anomaly mood, no pop melody, cinematic loopable ending.

Lyrics: "Не иди на писк. Сверь номер двери. Карта предлагает короткий путь. Длинный путь живее."
```

### SUNO-05 - Истотит, золотая герма

```text
Original dark sacred-industrial trailer cue, 78 BPM, low bell, heavy slow drums, male choir vowels, cold room reverb, sparse strings, metal door impacts, solemn but threatening shelter mood, survival choice, no church hymn melody, cinematic final bell.

Lyrics: "Золотой контур. Мест меньше, чем фамилий. Воду под лавку. Руку от ручки. Кто внутри - в ведомость."
```

### SUNO-06 - Веретар, белое окно

```text
Original pale dark ambient industrial score, 72 BPM, dry white-noise texture, distant outdoor alarm, low drone, slow metal creaks, minimal percussion, cold strings, overexposed silence, unsettling window motif, restrained cinematic dread, no melody at first, final bass hit.

Lyrics: "Белое окно не двор. Занавесь. Отойди. Песок сухой даже на мокром полу."
```

### SUNO-07 - короткий тредовый удар на 20-30 секунд

```text
Short dark epic trailer sting, 24 seconds, industrial metal orchestral hybrid, 110 BPM, heavy drums, distorted bass, concrete corridor reverb, siren rise, three huge impacts, low choir chants "Samosbor", final title hit for GIGAH|RUSH, intense but clean mix, made for a video teaser.
```

### SUNO-08 - после титров, тудун и пустой лифт

```text
Post-credits stinger, 12 seconds, almost silent dark ambient. One deep "tudun" bass hit, long concrete reverb, distant elevator hum, tiny green electronic beep, soft cup-ripple sound, low sub drone, one final quiet metal click. Minimal, suspenseful, no melody, no drums after the first hit.
```

### SUNO-09 - славянский женский хор в хтонь и культ

Style prompt:

```text
Original dark epic Slavic folk horror trailer score, 84 BPM rising to 112 BPM, begins with distant unaccompanied Eastern European female village choir, elderly women's lament voices, open "oooo" vowels, cold stairwell reverb, then gradually adds low throat-like male drone, heavy frame drums, metal pipe percussion, distorted sub bass, dark brass, ritual handclaps, chthonic industrial pulse, final cult procession climax, huge cinematic trailer hit, grim concrete megastructure atmosphere, no pop beat, no modern club sound
```

Lyrics prompt:

```text
[Distant female choir, very soft]
О-о-о-о...
Ой, не ходи за герму.
О-о-о-о...
Ой, не верь короткой двери.

[Old women's lament]
Воду под лавку.
Хлеб под платок.
Имя в тетрадь.
Шаг за порог.

[Low chthonic drone enters]
Са-мо-сбор.
Са-мо-сбор.
Дом идет снизу.
Дом идет сквозь пол.

[Ritual build]
Стук по трубе.
Пепел в щели.
Карта молчит.
Лифт не велели.

[Cult procession climax]
О-о-о-о...
ГИ-ГА-ХРУЩ.
О-о-о-о...
СА-МО-СБОР.

[Final hit]
Не открывай.
Дойди обратно.
```

Короткая версия для поля Style в Suno, если lyrics не нужны:

```text
Dark epic Slavic folk horror into chthonic cult industrial trailer music, female village choir and elderly lament "oooo" vowels, cold stairwell reverb, low male drone, heavy frame drums, metal pipe percussion, distorted sub bass, ritual handclaps, dark brass, slow dread build into huge cult-procession climax, concrete megastructure atmosphere, no pop, no club beat.
```

## Пост-обработка после генерации

Рекомендуемый монтаж:

- держать титры отдельно от генерации, чтобы не получить битую кириллицу;
- добавить реальные ссылки только в посте, не внутри видео;
- использовать MyIndie первым для RU/CIS: `https://myindie.ru/games/game/gigahrush`;
- direct build вторым, если площадка разрешает: `https://gigahrush.bileter.workers.dev`;
- itch mirror для EN/global: `https://tenevik.itch.io/gigahrush`;
- подпись к ролику: "Синематик по текущей браузерной игре ГИГАХРУЩ, не запись чистого gameplay";
- для тредов просить фидбек не по "нравится/не нравится", а по первому заходу: куда идти, виден ли лифт, читается ли угроза самосбора, понятна ли подготовка.

## Готовые короткие подписи

```text
ГИГАХРУЩ - бесплатный браузерный survival horror / ARPG shooter про вылазки в безграничной бетонной структуре. NPC живут, этажи меняются, САМОСБОР закрывает двери и оставляет последствия.
```

```text
Трейлерный синематик по текущему билду ГИГАХРУЩА. В игре уже есть подготовка к вылазке, лифты, фракции, A-Life NPC, бой, квесты и варианты САМОСБОРА. Нужен фидбек по первым минутам: понятно ли, куда идти и где начинается интерес.
```

```text
Самосбор не заставка: он закрывает гермы, гонит туман, поднимает монстров, меняет часть этажа и оставляет следы. Хотим показать это в роликах понятнее, чем в длинной шапке треда.
```
