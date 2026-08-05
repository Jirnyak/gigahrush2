# ГИГАХРУЩ Online Mode Plan

> Центральный документ будущего online mode.
>
> Роль: описывает optional future multiplayer/online mode, Cloudflare/Durable Object direction, relaxed trust, shared facts and budget constraints. It must not affect the core single-player browser game, which remains primary and fully playable offline.

Status: feasibility roadmap and implementation decision, not shipped behavior and not a public promise. Created 2026-05-24, revised 2026-05-25 after second architecture review, no-anti-cheat correction and critical host-AOI review, revised 2026-06-02 after host-player Cloudflare test planning and hundreds-player server-track review.

Scope: полноценный опциональный online mode через Cloudflare Workers/Durable Objects, где Cloudflare является sync/interaction authority для shared facts, а не полной удаленной копией offline-симуляции. Локальная single-player игра, `npm run dev`, single-file build и local save остаются полностью playable без Cloudflare, WebSocket, D1 и сети.

## 1. Цель

Долгосрочно сделать онлайн-режим, где игроки могут вместе находиться на одном этаже, видеть друг друга, перемещаться, стрелять друг в друга, использовать общие двери, контейнеры, терминалы, переживать общий самосбор и работать с online-authoritative economy. До 128 игроков на один online floor instance - stretch target after gates, а не обещание первого публичного релиза.

Важное техническое уточнение цели "каждый этаж это воркер": в терминах Cloudflare это должен быть один Durable Object shard на online floor instance за единым Worker gateway, а не отдельный deployed Worker script на каждый этаж. Отдельный Worker на этаж создаст churn в конфиге/deploy и не решит координацию общего состояния. Durable Objects являются подходящим Cloudflare primitive для shared stateful room.

## Decision Addendum 2026-05-25

Второе ревью с учетом бюджета `$10/month`, уже работающей Net Sphere и идеи "первый игрок как host" меняет формулировку лучшего решения:

- Текущий план в целом технически правильный: Worker gateway + Durable Objects для shared realtime, D1 для профилей/ledger/summaries, offline baseline отдельно.
- План был слишком оптимистичен как roadmap: "full online до 128" нельзя звучать как обещание раннего релиза или гарантированная стоимость `$10/month`.
- Лучший путь после no-anti-cheat правки: **relaxed-trust online first, strict server authority only where useful**. Клиенты локально считают base floor, рендер, звук, HUD, prediction, private PvE и offline save.
- Player-host authority подходит для первого playable co-op/soft online. Cloudflare/Durable Objects нужны там, где требуется общий порядок, reconnect, бюджетные лимиты, persistent summaries или strict optional economy.

## Trust Correction 2026-05-25

Новая продуктовая правка: **anti-cheat is explicitly out of scope**.

- Онлайн-режим не является competitive mode.
- В online нет profit extraction, real-money stakes, ranked ladder или esport-баланса.
- Если игроки хотят читерить, это не проблема проекта.
- Не проектировать системы ради предотвращения cheating.
- Не добавлять legacy/migration scaffolding ради старых online протоколов или старых online saves.

Что это меняет:

- Player-host и client-authoritative участки становятся допустимыми для playable co-op и soft online, если они честно помечены как relaxed-trust.
- PvP fairness не является инженерной целью. Host advantage, client prediction advantage и modded clients приемлемы как социальный риск, а не технический blocker.
- Online economy может быть soft/social economy: рынок-импульсы, заявки, склад и обмен могут принимать client-claimed facts, если они не обещают scarcity, ranked value или честную глобальную торговлю.
- Server-authoritative logic остается полезной, но как инструмент согласованности, восстановления, очередей, стоимости и UX, а не как античит.

Что все равно остается обязательным, но не как anti-cheat:

- payload size caps, чтобы не положить Worker/DO/браузер;
- rate limits и budget gates, чтобы не сжечь `$10/month`;
- protocol/build/ruleset checks, чтобы клиенты не расходились из-за разных версий;
- idempotency keys для retries/reconnect, чтобы баги сети не дублировали действия случайно;
- bounded storage retention, чтобы D1/DO не росли бесконечно;
- local/offline fallback, чтобы online outage не ломал игру.

Главный сдвиг: **authority is a consistency/cost choice, not a fairness requirement**.

Architecture decision table:

| Option | Cost | Pros | Fatal limits | Decision |
| --- | ---: | --- | --- | --- |
| Player-host relay: first player is truth | low Cloudflare compute | cheap playable co-op, reuses local sim, no anti-cheat burden | host disconnect, mobile sleep, poor 128-player uplink, weak persistence | valid first playable co-op / relaxed-trust mode |
| Hybrid server-authoritative sync layer | controlled | most game work stays local, Cloudflare owns shared ordering and scarce state | still needs careful protocol, AOI, caps, load tests | chosen path for shared public shards if realtime grows |
| Full headless server-authoritative offline sim | high | clean consistency, easiest persistence | expensive, large port of game simulation, out of `$10/month` early scope | late target only if strict shared sim is actually needed |

Budget envelope:

- Current Net Sphere polling/chat/stats/market impulses is the correct cheap cloud baseline and should stay compatible.
- `$10/month` supports Workers Paid plus controlled test shards, not unlimited always-on 128-player floors.
- Workers Paid has a `$5/month` minimum and includes static assets/Worker usage allowances.
- Durable Objects add request/duration/storage billing. Incoming WebSocket messages are discounted for billing at a 20:1 ratio, but 128 players sending input all month still becomes expensive.
- Rough order of magnitude for one always-active 128-player floor from incoming WS messages only: 8 Hz for 30 days is about 2.65B messages, billed as about 132.7M DO requests after 20:1, roughly `$19.76` over the included request allotment before duration, D1 and logs. 6 Hz is still roughly `$14.78` over included; 4 Hz is roughly `$9.80` over included.
- One always-hot floor DO can fit inside included duration; multiple always-hot DOs or non-hibernating rooms can exceed the budget. Hibernation helps idle rooms, queues and chat, not active realtime floors.
- Therefore the default host-browser full-sim cap must start at **2 players**, move to **4** only after the first gameplay soak, and move to **8** only after AOI/bandwidth/reconnect gates. 16+ players is a separate experimental/strict-shard scale track, not the first relay POC.

Promise boundary:

- Public copy may say "optional online experiments / НЕТ-СФЕРА online tests" until load gates pass.
- Do not market "до 128 игроков на этаже" until 128-client soak, reconnect storm, malformed-frame/cost-stress tests, D1 outage and DO restart tests pass.
- Do not market "как offline, но online" until server-owned PvE/NPC/quests/samosbor/shared patches exist.
- Do not promise protected/scarce global economy from player-host sessions or local offline inventory. Soft economy may accept client claims if labeled as relaxed-trust.

Minimum kill switches before gameplay:

- global online disabled;
- feature flags: `presence`, `movement`, `pvp`, `patches`, `samosbor`, `exchange`, `pve`;
- per-region/per-shard player caps;
- protocol/build/ruleset mismatch rejection;
- budget gate that closes new joins before projected monthly spend crosses target;
- economy hard-off on duplicate ledger/claim anomaly;
- patch hard-off on client/server floor mismatch.

## Realtime Meeting POC Decision 2026-05-25

Goal for the next online test is no longer "128-player full online". The concrete proof of concept is:

1. Two players enter online mode.
2. Both join the same route identity: `{runSeed, floorKey, z, rulesetVersion}`.
3. If they are on the same floor shard, they can see each other in the same corridor.
4. They can shoot, see projectiles/hits as shared events, and throw/drop/pick up a simple item.
5. Then scale the same room path to 4-8 players.

Critical correction after reviewing the current runtime loop: the POC must preserve the living offline simulation. NPCs, monsters, projectiles, samosbor, hazards and containers are not optional cosmetics. The online floor must feel like the current offline floor with more player-controlled actors inside it.

Second critical correction after the host/AOI review: this is **not** "each peer locally plays its own authoritative piece of the floor". That would desync. The working model is:

- host browser plays almost like normal offline and simulates the whole active floor;
- every peer is a remote-controlled actor inside the host simulation;
- peer renders local base geometry, but live dynamic truth comes from host AOI snapshots/events;
- host decides meaningful world changes: movement acceptance, damage, drops, pickups, doors, NPC/monster results and later patches;
- Cloudflare relays/order/buffers only. It is not the floor simulator.

Recommended first realtime transport:

- Use Cloudflare Worker only as the HTTP/WebSocket gateway.
- Use one Durable Object as the room for one online floor instance.
- Do **not** start with WebRTC/P2P. It adds signaling, NAT/TURN, privacy and host-migration complexity before the basic gameplay question is answered.
- Do **not** start by porting the full sim into Cloudflare. The first full-sim online POC should be **host-browser authoritative**: one player's browser runs the current full floor simulation, and Cloudflare relays/buffers state to peers.
- The Durable Object is the room relay, membership registry, reconnect buffer and small shared-state buffer. It is not the full simulator in POC 2.

Exact shape:

```txt
browser client
  -> wss://game.example/api/online/v1/floor-ws
  -> Cloudflare Worker route
  -> FloorRoomDO for {runSeed, floorKey, z, rulesetVersion, roomOrdinal}
  -> host browser simulates full floor
  -> FloorRoomDO relays host snapshots/events to peers
```

What the Durable Object owns in POC:

- room membership format: slots 0-7, but POC cap is 2;
- current route identity and ruleset/build version;
- player public transforms: x, y, yaw, selected sprite/equipment summary;
- short ordered event ring: `player_join`, `player_leave`, `move_snapshot`, `shot_spawn`, `projectile_hit`, `item_drop`, `item_pickup`, `chat_ping`;
- small shared item overlay: dropped item id, def id, count, x/y, owner slot, TTL;
- simple projectile/event ids and TTL;
- heartbeat/reconnect timeout;
- budget/rate caps and max payload sizes;
- host election/lease: who currently owns the full floor simulation;
- latest host snapshot buffer for reconnecting peers;
- optional host-transfer marker if the room later supports migration.

What stays on the clients:

- base floor generation;
- WebGL/canvas rendering;
- local movement prediction;
- local projectile visuals;
- on the host: the full current offline simulation loop, including NPCs, monsters, projectiles, samosbor, hazards, containers, AI and local world mutation;
- on peers: rendered mirrors of host-owned NPCs/monsters/projectiles/items plus their own local input/prediction;
- local inventory, except for POC item drop/pickup mirror events;
- expensive AI/world mutation only on host; peers keep rendering, audio and local presentation.

Authority for POC:

- Host browser is the source of truth for the living floor simulation.
- DO is the source of truth for room membership, host lease, event ordering and reconnect buffering.
- Peers send input/action intents to the host through DO.
- Host sends snapshots/events through DO to peers: player transforms, NPC/monster snapshots, projectile spawns/hits, dropped item state, container mutations, samosbor phase and small world patches.
- For item POC, host decides `item_drop` and `item_pickup`; DO assigns/relays ordered ids so peers apply them once.

Why DO relay before WebRTC/P2P:

- no NAT/WebRTC complexity;
- uses the existing browser sim instead of porting `main.ts`, AI, samosbor and generation into a server runtime;
- all players use the same connection shape;
- still serverless and still cheap for 2-8 players;
- host loss is the main weakness. First POC may freeze/end on any host loss. Later normal host leave can use a visible loading checkpoint handoff; sudden loss may still freeze/end the room.

When WebRTC/player-host becomes useful:

- private rooms with heavier host-owned NPC/PvE simulation;
- if DO relay bandwidth/cost becomes too high;
- if a specific co-op expedition needs host to stream richer state;
- after the WebSocket relay POC proves the gameplay loop.

## Server Scale Addendum 2026-06-02

Cloudflare host-player testing is the right next experiment, but it must not become the hidden final architecture for public high-cap rooms. It proves whether two people can meet on one route floor while one browser keeps the living offline simulation running and Cloudflare relays ordered facts. It does **not** prove that one player browser can host dozens or hundreds of players.

If the target becomes "сотни игроков", the design needs a real server track:

- host-browser relay remains the small co-op/public-test path: 2 players first, then 4, then 8, 16 only as an experiment;
- WebRTC remains a possible private-room bandwidth optimization after WebSocket relay proves gameplay;
- public 32/64/128+ rooms require a headless floor simulator or equivalent dedicated server authority;
- hundreds of players require server-owned AOI, actor slots, snapshots, room lifetime and reconnect, not a player tab with a weak uplink and browser sleep risk.

The server track is not an anti-cheat requirement. It exists for capacity, uptime, reconnect, hostless public rooms, predictable cost and consistent shared state. Cheating is still out of scope unless a future mode explicitly introduces protected scarcity or competitive stakes.

Do not treat a Durable Object full simulator as the automatic hundreds-player server. A single DO is useful for room relay, ordering, queueing and small state, but it is single-threaded and cost-sensitive under action-game message rates. A serious high-cap room likely needs:

- a headless Node/JS/TS or native server process that runs the current-floor simulation without render, audio, DOM, canvas or local save;
- Cloudflare Worker/D1/DO kept as identity, lobby, token, status, metrics, ambient Net Sphere and optional relay/fallback;
- direct or proxied WebSocket connection from clients to the selected headless room server using a short-lived token minted by the Worker/Lobby;
- a room registry/heartbeat so the Worker can reject joins, queue players, expose capacity and close rooms before cost or health limits are crossed;
- the same protocol ids as host-relay mode: `slotId`, `actorNetId`, `eventSeq`, `patchSeq`, route identity and ruleset/build version.

Preferred minimal combination:

```txt
Cloudflare Worker/Wrangler
  -> serves the game and all `/api/net/*` / `/api/online/*`
  -> owns status, tokens, version checks, budget gates and kill switches
  -> routes small realtime rooms to Durable Objects
  -> routes high-cap rooms to a headless room server

D1
  -> Net Sphere profile, chat, event summaries, market impulses, optional strict ledgers

Durable Objects
  -> room registry, queue, host lease, reconnect reservation, small event rings

Cloudflare Containers or external headless server
  -> hot 32/64/128+ current-floor simulation when host-browser relay is too small
```

This keeps Cloudflare as one control plane instead of adding a separate online stack. Cloudflare Containers are the first server candidate because they can be managed from the Worker/Wrangler deployment shape already used by the project, but they must still pass pricing, startup, WebSocket, regional placement and long-room soak tests. If Containers do not fit always-hot action rooms, the same control plane can point at an external VPS/bare-metal/headless service through a signed endpoint token.

Plan early to avoid repainting the code later:

- online protocol must have an explicit authority mode: `host_relay`, `webrtc_host`, `headless_server`, `strict_do_shard`;
- browser clients must not assume slot 0 is always a player-host forever;
- remote actor movement/action shims must be written as generic "authority applies actor intent", not "peer talks only to local host player";
- AOI, snapshot, reliable event and sparse patch code must be usable by both host-browser and headless-server modes;
- server-facing simulation code must be extractable from `main.ts` into systems-level hooks without WebGL/canvas/input dependencies.
- Wrangler config must stay the single deploy/config surface where possible: existing D1 binding, future DO namespaces and optional container/server routing should be reviewed together.

Server-track triggers:

- product goal changes from 2/4/8 co-op test to 32+ public players on one floor;
- host upstream, frame time, tab throttling or disconnect rates dominate 4/8-player tests;
- normal host loss can no longer freeze/end public rooms acceptably;
- NPC/monster/samosbor persistence must survive without any player host;
- Cloudflare relay cost is acceptable for coordination but not for per-frame high-cap traffic;
- the phrase "сотни игроков" becomes a public or design target instead of a private stretch question.

Server-track first milestone:

1. Run one headless online floor room with the same `{runSeed, floorKey, z, rulesetVersion}` identity as the host-relay POC.
2. Simulate player slots, simple movement, basic shooting, simple drops, doors and capped NPC/monster mirrors without render/UI/audio.
3. Keep the base floor generated from seed, but send only AOI snapshots and reliable events.
4. Let two browsers connect without any browser host.
5. Then test 8, 16, 32 and 64 synthetic clients before claiming real public capacity.

Hundreds-player target:

- 100+ is not "same as 8 but more seats". It needs load-tested AOI, sector/bucket ownership, outbound byte budgets, action token buckets, degradation policy and likely multiple server processes or sector workers behind one floor identity.
- 128 remains a protocol ceiling and stretch target until 128-client soak passes.
- 200-500 players on one floor is a separate architecture program. It may require sector servers, lower action cadence, event-only far actors, crowd compression, soft PvE outside AOI and explicit UX language that far players are not all fully simulated at combat fidelity.

Six-role architecture verdict for full current-floor online:

1. **Cloudflare DO full simulator**: clean in theory, bad first move. Current `main.ts` owns browser loop order, render/audio/UI-adjacent state, projectiles, samosbor rebuilds, AI, floor memory and many systems. Porting it into a Worker/DO headless runtime is a major extraction project and risks budget/duration limits.
2. **VPS headless simulator**: technically strongest for full shared simulation, but not serverless and adds ops. Good later if host-browser POC proves demand and a fixed monthly bill is preferred.
3. **Host-browser full simulator through Cloudflare relay**: best POC. It preserves current offline behavior with least porting. Limits are host uptime, bandwidth, tab throttling, and snapshot design.
4. **WebRTC host-browser**: good later for bandwidth savings, but not first. Needs signaling, STUN/TURN, fallback and more debugging.
5. **Lockstep deterministic clients**: poor fit. Current simulation uses variable dt, `Math.random`, mutable arrays, browser timing and many side effects; deterministic lockstep would be a rewrite.
6. **Async/ambient Net Sphere**: still valuable, but it cannot satisfy "players meet on the same floor with NPCs/mobs alive".

## Chosen Technical Project 2026-05-25

The accepted implementation direction is:

```txt
players
  -> WebSocket
  -> Cloudflare Worker online route
  -> Durable Object floor room
  -> first browser on the floor is host and runs the full current-floor sim
  -> Durable Object relays host snapshots/events to peers
```

This is the logical continuation of current Net Sphere only if it stays a separate realtime layer. Existing `/api/net/*` remains ambient polling: profile, heartbeat, chat, stats, death/samosbor summaries and soft market impulses. New `/api/online/v1/*` is the realtime room layer. The two systems share identity style and same-origin deployment, but they must not share realtime state.

Minimum route:

- `GET /api/online/v1/status`: online enabled, protocol, caps, feature flags, budget gate status.
- `POST /api/online/v1/join`: validates `NET-GEN`, session id, build/ruleset, route identity and returns room key/join token.
- `GET /api/online/v1/floor-ws`: WebSocket upgrade routed by Worker to `FloorRoomDO`.

First implementation does **not** need `LobbyDO`, `MarketDO`, R2, KV, new D1 tables or binary frames. Those belong after the 2-player room proves the gameplay question.

`FloorRoomDO` POC responsibilities:

- one room key: `online:v1:{rulesetVersion}:{runSeed}:{floorKey}:{z}:{roomOrdinal}`;
- max 2 seats first: slot 0 host, slot 1 peer;
- host lease and host reconnect window;
- WebSocket membership, short-lived join token and reconnect reservation;
- ordered event ring, initially 512 events or 120 seconds;
- latest host snapshot/keyframe buffer;
- tiny drop overlay and action idempotency table;
- rate/payload caps and room close/freeze reason;
- no AI, no pathfinding, no full `World`, no local save, no A-Life pool, no D1 writes per frame.

Host browser responsibilities:

- runs the current offline floor loop for the **whole active 1024x1024 floor**, not only the host's current room;
- owns all live floor simulation: NPCs, monsters, projectiles, dropped items, hazards, containers, samosbor and local world mutation;
- creates host-local remote player actors for peers and applies peer inputs/actions to those actors before projectile/AI simulation;
- treats remote players as gameplay actors for collision, HP, weapon state, simple inventory, projectile ownership and AOI;
- expands AI interest/hot anchors from one local `player` to `host player + remote player actors`, otherwise far peers will see cold/semi-dead PvE;
- sends lossy per-peer AOI snapshots for current state and reliable events for consequences;
- in the first POC, hard or normal host loss may freeze/end the room. Normal loading handoff is a later checkpoint milestone;
- stays foreground desktop-only in early tests. Hidden/mobile host is invalid for POC.

Peer browser responsibilities:

- generates/renders the same base floor locally for view, sound and UI;
- sends input/action intents to host through DO;
- renders host-owned snapshots for remote players, NPCs, monsters, projectiles and drops in its own area;
- does **not** run authoritative local AI/samosbor/projectile/world mutation while attached to the room;
- predicts only local camera/movement where useful, then reconciles with host self-correction;
- keeps offline save separate and can fall back to local play if room freezes.

First POC cap is **2 players**. Do not start at 4 or 8. The first question is narrower: can two browsers enter the same online floor, one become host, and the other see a living floor driven by the host.

Scale gates:

- **2 players**: 30-minute desktop foreground host soak, shots, one item drop/pickup, NPC/monster mirror, no unbounded buffers.
- **4 players**: only after 2-player gate; per-recipient AOI, reconnect ring, host upstream p95 below 50 KB/s, host FPS above 45 in combat.
- **8 players**: only after 4-player gate; hard AOI caps, host health monitor, room inbound below 200 msg/s, p99 snapshot age below 500 ms, mobile peers allowed but mobile host still disabled.
- **16+**: separate experimental track. If 8 fails because host bandwidth/sleep dominates, either keep rooms at 4 or investigate VPS/headless/WebRTC later.

The POC is one-floor only. No synchronized multi-floor travel yet, no online save merge, no strict economy, no full world patch stream during normal play, no 128-player claim. If the host exits or dies in the first POC, the room may freeze/end. Host handoff is intentionally moved after stable 2-player gameplay.

### Whole-Floor Host And Per-Peer AOI

"Whole floor" means the host browser owns and advances the entire active floor simulation:

- all rooms and corridors on the current generated floor;
- all live NPCs/monsters currently materialized on that floor;
- all projectiles, dropped items, hazards, samosbor phase, open doors, changed containers and local world mutations;
- all remote player actors inserted into the host simulation.

AOI is only a network/send filter. Peers should not receive the whole entity list every snapshot. Each peer receives the rooms and nearby cells around that peer, not around the host. A practical rule for POC:

- always send all player slots;
- send the peer's current room, connected doorway threshold cells and nearby rooms that are visible/adjacent;
- send a radius around the peer, initially 48 cells, then tune by bandwidth;
- always include actors that recently damaged, targeted or were targeted by that peer even if they are just outside radius;
- send far-away floor state only through reliable events or cold handoff/resync chunks, not hot snapshots.

This keeps the gameplay model "one host simulates the full floor" while keeping the network model "each peer receives only the useful local slice".

### Remote Actor And AI Focus Requirements

The critical game-side blocker is not Cloudflare. The critical blocker is that current runtime behavior is centered on one special local `player`.

POC must add a small host-side online actor layer before claiming "real multiplayer":

- each peer gets a host-local remote actor with `slotId`, `actorNetId`, x/y/angle/pitch, hp, alive state, weapon/tool summary and minimal online inventory;
- remote actor ids are mapped to host-local `Entity.id`, but protocol never trusts local ids;
- peer movement is not applied by `movePlayer()` directly; it needs a separate remote movement function with the same toroidal/collision semantics;
- peer firing is not applied by `playerActions()` directly; it needs a remote action function that spawns host-owned projectiles/events for that actor;
- peer drop/pickup is host-decided and limited to simple item stacks first;
- NPC/monster AI needs interest centers for host player and remote actors, so mobs near a far peer do not become cold just because the host is elsewhere;
- monster/player targeting can remain imperfect in POC, but it must at least allow remote actors to be attacked, damaged and visible as combat participants.

Renderer blocker:

- Current renderer skips `EntityType.PLAYER` for sprite drawing. POC should either render remote players as NPC-like mirror actors or change the generic render path to skip only the local player id and draw remote players.
- Map/minimap should not promise exact far remote-player dots in POC. Far players can disappear as "somewhere else on the floor" until AOIs overlap.

Interaction blocker:

- Do not expose full `activateInteraction()` to peers in POC. It opens local UI and touches NPC menus, containers, terminals, lift travel and quest paths built around the local player.
- First shared actions should be movement, look, shoot, hit/damage, simple item drop, simple item pickup and maybe one door toggle.
- NPC dialogue, trade, terminals, complex containers, quest state and lift travel are later protocols.

### Host Handoff Policy

Host handoff is **not** part of the first 2-player gameplay POC. It becomes a later loading checkpoint milestone after remote actors, AOI, simple combat and simple item transfer are stable.

There are two different host-loss cases.

Normal leave / normal lift exit / normal quit:

1. If handoff is not implemented yet, the room freezes/ends cleanly.
2. Later, host sends `handoff_begin` with `handoffEpoch`, current `hostTick`, route identity and target next-host slot.
3. `FloorRoomDO` freezes new gameplay actions and tells peers to show `ЗАГРУЗКА`.
4. Host builds a loading-time **full current-floor checkpoint**, not a pretty base+diff patch.
5. Package is chunked through DO to the next host. DO relays, tracks hash/size/timeout and does not treat it as durable cloud save.
6. Next host restores the checkpoint, rebuilds dirty versions/entity index, clears stale AI paths, recalculates `nextEntityId`, inserts player slots and sends `handoff_ready`.
7. DO switches `hostSlot`, increments host epoch and broadcasts `host_changed`.
8. Peers request full AOI keyframes from the new host and resume.

Hard crash / tab killed / network loss:

- earliest POC may simply freeze/end the room after lease timeout;
- data loss is acceptable for this relaxed online mode;
- later builds can keep low-frequency host checkpoints, but that is not a blocker for the first meeting POC.

The first robust handoff package should be a full-floor checkpoint in a `floor_memory`-style shape, not a mutation diff. Current code has no universal runtime mutation journal, and different systems mutate doors, containers, fog, marks, cells, entities and samosbor state through different paths.

Checkpoint contents:

- `floorEpoch`, `hostTick`, `gameTime`, inactive/cooldown samosbor counters and phase metadata;
- route identity, ruleset/build id and current floor key;
- packed current `World` arrays/rooms/zones/doors/containers/surface/anomaly/rail/screen state in the same spirit as `floor_memory`;
- sanitized live NPCs, monsters, item drops and temporary hazards;
- remote player slot state, positions, hp/status/equipment and minimal online inventories;
- event/action cursors;
- recent reliable event ring cursor so peers do not reapply old consequences.

Checkpoint exclusions/abort conditions:

- no active samosbor handoff in the first version. If samosbor is active, warning, wave, pending aftermath or geometry rebuild is in progress, abort handoff and freeze/end;
- projectiles may be discarded during loading handoff. Do not try to preserve in-flight bullets first;
- stale AI paths should be cleared and recalculated by the new host;
- if checkpoint is too large or times out, abort and end/freeze the room.

This handoff is allowed to be visibly rough. Showing `ЗАГРУЗКА` is correct. The target is continuity good enough for relaxed co-op, not deterministic replay.

### Six Role Decision Round

The six review roles converged on the same answer:

1. **Runtime/host integrator**: this is the least invasive full-sim path because `main.ts` already runs one complete browser sim. Biggest risk is the single-player global `player` and monolithic loop. First POC should use remote mirror actors and generic hooks, not a broad multi-player core rewrite.
2. **Cloudflare/Net Sphere architect**: add `/api/online/v1/*` beside `/api/net/*`. Keep current Net Sphere untouched. For POC use one `FloorRoomDO`; no new D1/R2/KV; DO validates WebSocket, lease, ordering and buffers only.
3. **Protocol engineer**: JSON-first is acceptable for 2/4/8. Batch every 50-100 ms. Snapshots are lossy latest state; events are reliable ordered facts. Use `slotId`/`actorNetId`, never local `Entity.id` as network authority.
4. **Gameplay/full-sim reviewer**: NPCs, mobs and samosbor must not become cosmetics. Host owns them; peers mirror them. First blockers are remote actor control, multi-focus AI and online action shims, not Cloudflare.
5. **Ops/cost planner**: `$10/month` supports controlled small room-hours, not unlimited always-active rooms. First POC should freeze/end on host loss; handoff is a later loading checkpoint. Budget gates and stop metrics are required before public tests.
6. **Adversarial architect**: this is a conditional relaxed-trust meeting POC, not a final MMO architecture. DO full sim, VPS, WebRTC and deterministic lockstep all lose as first moves under current code/budget, but the host relay also fails if peer is not a real host-world actor.

### POC Protocol Shape

JSON frames should be batched envelopes:

```json
{
  "v": 1,
  "seq": 42,
  "ack": { "snapshot": 120, "event": 88, "input": 54 },
  "sentAt": 1710000000000,
  "messages": []
}
```

Core message groups:

- `hello` / `welcome`: protocol, build, ruleset, join token, slot, role, host slot, caps.
- `lease_renew` / `lease`: host epoch, host tick/time, expiry.
- `input`: peer movement/look/button state, coalesced and relayed to host.
- `action`: edge facts such as `fire_edge`, `drop`, `pickup`, `equip_weapon`, `interact`.
- `snapshot`: host-owned lossy state for players, AOI actors, projectiles, drops and samosbor phase.
- `event`: reliable ordered facts: `shot_spawn`, `projectile_hit`, `actor_damage`, `actor_death`, `item_drop`, `item_pickup`, `door_state`, `samosbor_phase`, `system_msg`.
- `handoff_begin` / `handoff_chunk` / `handoff_ready` / `host_changed`: later loading-time checkpoint transfer from old host to new host, not part of first gameplay POC.
- `resync_req` / `resync`: replay event ring or ask host for a full AOI keyframe.
- `heartbeat` / `heartbeat_ack`: room liveness when no gameplay frame is flowing.

Cadence targets:

- 2p: input 10 Hz, snapshots 8 Hz, combat burst 12 Hz, full AOI keyframe 1 Hz.
- 4p: input 8 Hz, snapshots 6-8 Hz, combat burst 10 Hz.
- 8p: input 6 Hz, snapshots 4-6 Hz, combat burst 8 Hz.

Payload caps:

- input batch target under 1 KB, hard cap 4 KB;
- event frame target under 4 KB, hard cap 16 KB;
- normal snapshot target 2-8 KB per peer, hard cap 24 KB;
- full AOI keyframe target 8-24 KB, hard cap 64 KB;
- resync chunks hard cap 256 KB total.

AOI caps:

- 2p: 80 actors, 64 projectiles, 32 drops;
- 4p: 64 actors, 48 projectiles, 24 drops;
- 8p: 48 actors, 32 projectiles, 16 drops.

Priority order when caps overflow: players, damage participants, hostile actors, active projectiles, nearest drops, cosmetic actors.

### Acceptance Tests For First Gameplay POC

The first successful POC means all of this works at once:

- two desktop browsers open the same build and join the same `{runSeed, floorKey, z, rulesetVersion}`;
- first browser becomes host, second becomes peer;
- third browser is rejected or queued because the POC cap is 2;
- both players see each other in the same corridor;
- host-owned NPC/monster movement appears on the peer;
- peer input moves a host-local remote actor and host sees it;
- host AI treats the remote actor as an interest/combat anchor, so peer-side nearby mobs are not cold just because host is elsewhere;
- host shoots and peer sees projectile/hit event;
- peer shoots and host applies it through the remote actor path;
- one simple item can be dropped by one player and picked up by the other through ordered events;
- normal host quit, hidden tab, killed tab or network loss freezes/ends the room within 15 seconds without corrupting offline play;
- reconnect within 20 seconds recovers the same slot if the host is still valid;
- room runs 30 minutes without unbounded event/snapshot growth.

Stop promotion if any of these are true:

- projected Cloudflare spend crosses `$8/month` before public cap;
- host loss creates unresolved room state for more than 15 seconds;
- peer AOI looks empty/dead because AI remains centered only on host player;
- reconnect duplicates item/action events;
- p99 snapshot age exceeds 750 ms in 2/4-player soak;
- host upstream is sustained above 120 KB/s;
- room remains allocated with no valid host for more than 60 seconds;
- offline mode or existing `/api/net/*` behavior changes.

## 2. Non-Negotiable Boundaries

- Offline remains the product baseline: the existing browser game must run, save, load and build with no network.
- Online mode is an additional gameplay branch, not a migration of `gigahrush_save`.
- Current local save stays under `gigahrush_save`. Online uses separate profile/save keys and separate server records.
- `$10/month` is a hard operating envelope for early public online. Design for caps, hibernation, low Hz, budget gates and feature kill switches.
- 128-player floors are a stretch target after measured load/cost gates, not an initial entitlement.
- D1 is not a realtime game server. D1 stores profiles, summaries, economy ledgers and audit trails only.
- Realtime shared floor state lives in Durable Objects with WebSocket clients.
- No server-side renderer, sprites, sound, WebGL or canvas logic.
- No full `World` typed-array blobs over the network during normal play.
- No anti-cheat requirement. Do not spend complexity on preventing cheating.
- Local inventory, player-host sessions and modded clients may feed relaxed-trust online surfaces if those surfaces are not sold as protected scarcity.
- Player-host authority is allowed for private/co-op/soft online. Its limits are reliability, scale and persistence, not cheating.
- Failure path must be explicit: if online is down, local game continues and online surfaces degrade.

## 3. Current Project Facts

Current implementation is a zero-runtime-dependency TypeScript/Vite browser game. The active runtime loads one 1024x1024 toroidal floor into a data-oriented `World` with typed arrays, flat `entities`, procedural generation, WebGL/canvas rendering, canvas HUD and browser local save.

Relevant shipped architecture:

- `src/core/world.ts`: `World` owns cell arrays, texture arrays, features, doors, rooms, zones, containers, dirty versions and toroidal helpers.
- `src/core/types.ts`: `W = 1024`, `TICK_S = 1 / 60`, six base `FloorLevel` values, flat `EntityType`.
- `src/systems/procedural_floors.ts`: per-run vertical route uses `runSeed`, route ids and `z=-50..+50`.
- `src/systems/floor_memory.ts`: visited floors persist as live or packed snapshots keyed by route floor identity.
- `src/systems/alife.ts`: persistent ordinary NPC identity is compact and only materializes on the active floor.
- `src/systems/save_runtime.ts` / `save.md`: current local save shape version source; old shapes are rejected, not migrated.
- `src/systems/save_payload.ts`: local save caps inventory, containers, quests, status, event data and avoids full live entity serialization.
- `src/systems/interactions.ts`: shared `E` dispatcher owns doors, lifts, NPCs, containers, terminals and generated interactables.
- `src/systems/events.ts`: bounded public/private event buffers already provide compact cross-system facts.

Current Net Sphere is optional cloud telemetry, not multiplayer:

- `functions/worker.ts` routes only `/api/net/*`; all other paths go to Worker Assets.
- `cloudflare/d1/net_sphere.sql` defines `net_players`, `net_sessions`, `net_events`, `net_chat`, `net_market_impulses`, `net_market_budgets`, `net_market_snapshots`.
- `functions/api/net/hello.ts` accepts heartbeat/profile progress and returns stats/profile/chat/events.
- `functions/api/net/chat.ts` supports short terminal chat with cooldown.
- `functions/api/net/event.ts` stores idempotent `samosbor` and `death` summaries.
- `functions/api/net/market.ts` accepts bounded market impulses and returns aggregated quote snapshots.
- `src/systems/net_sphere.ts` keeps `NET-...` in `localStorage`, `SES-...` in `sessionStorage`, heartbeats every 30 seconds, polls open terminal every 5 seconds and market every 30 seconds.
- `src/render/net_sphere_ui.ts` draws the terminal in canvas and keeps text sanitized.

Current Net Sphere safety limits:

- API returns `Cache-Control: no-store`.
- Missing `GIGA_NET` returns soft `503`; static game still serves.
- JSON body cap is 4096 bytes.
- Chat message cap is 160 chars.
- Nickname cap is 24 chars.
- Online window is 90 seconds.
- Chat retention is 7 days; event retention is 30 days; market impulse retention is 14 days.
- Market accepts max 16 impulses per payload; server budget is 8 impulses or magnitude 240 per minute per `net_gen:session`.

What can be reused:

- Worker Assets + same-origin API deployment shape.
- `NET-GEN`/session identity as anonymous profile handle.
- Sanitizers and bounded payload style.
- Current `/api/net/market` as public aggregate quote layer.
- Route identity crossing client/server boundary: `runSeed`, `routeId`, `floorZ`.
- Canvas terminal/UI patterns and offline error language.
- Local stock market's ability to soft-apply remote quote snapshots.

What must be newly built:

- WebSocket transport.
- Durable Object floor shards.
- Queue and capacity enforcement.
- Online actor/session authority by mode: client/host for relaxed rooms, server for strict shards.
- Input sequence, reconciliation and snapshot deltas.
- PvP damage/projectiles authority by mode.
- Shared world patch overlay.
- Shared inventory/loot claims.
- Online economy state: soft client-claimed mode first, strict ledger only if a future feature needs protected scarcity.
- Online save/profile separation.
- Budget/cost gates, payload caps, idempotency for retries and rollback/kill switch.

## 4. Target Architecture

### 4.1 Cloudflare Layout

Keep one deployed Worker as the ingress and asset host:

- `ASSETS`: existing static `dist/`.
- `GIGA_NET`: existing D1 binding for Net Sphere compatibility.
- `ONLINE_LOBBY`: Durable Object namespace for queues and shard assignment.
- `ONLINE_FLOORS`: Durable Object namespace for floor shards.
- `ONLINE_MARKET`: Durable Object namespace for hot exchange state.
- `ONLINE_ROOM_REGISTRY`: optional Durable Object namespace for headless room registry, capacity, region and heartbeat if `LobbyDO` grows too large.
- Optional Cloudflare Containers deployment for headless room servers, controlled/routed by the Worker after the host-relay cap is proven too small.
- Optional external `HEADLESS_ROOM_ENDPOINT` only if Cloudflare Containers fail cost/startup/latency/soak gates.
- Optional `ONLINE_REPLAYS` R2 bucket for compressed historical snapshots/replay/audit exports.
- Optional KV for public config only: protocol version, news, kill switch cache. KV must not be authority for seats, trades or inventory.

Proposed routes:

- `GET /api/online/v1/status`
- `POST /api/online/v1/profile`
- `POST /api/online/v1/join`
- `POST /api/online/v1/leave`
- `GET /api/online/v1/shards`
- `GET /api/online/v1/ws`
- `GET /api/online/v1/economy/snapshot`
- `POST /api/online/v1/economy/listing`
- `POST /api/online/v1/economy/buy`
- `POST /api/online/v1/economy/cancel`
- `POST /api/online/v1/economy/claim`

Existing `/api/net/*` remains compatible and should not be broken by online rollout.

Cloudflare control-plane rule:

- Wrangler/Worker remains the single public entrypoint for static game, Net Sphere, online status, join tokens, caps and kill switches.
- D1 keeps durable profile/economy/event facts, not hot movement/combat ticks.
- Durable Objects own lobby/room coordination and small realtime state.
- Containers or an external headless server own only hot high-cap floor simulation when the chosen authority mode is `headless_server`.
- Clients should not care whether the room authority is host-browser, DO relay, Cloudflare Container or external server; `/api/online/v1/join` returns `authorityMode`, endpoint details and a short-lived token.
- Do not fork Net Sphere. Its identity/profile/status surfaces become the stable base used by realtime online.

### 4.2 Durable Object Classes

`LobbyDO`

- Owns exact queues by `{region, routeSeed, floorKey, z, rulesetVersion}`.
- Assigns `shardOrdinal`.
- Holds reconnect reservations.
- Enforces configured active seat cap per shard; hard protocol maximum is 128.
- Not required for the first 2-player host-relay POC. Add it when public queues or 4/8-player room selection become real.
- Host-relay profiles use 2/4/8 caps. 16+ belongs to a later experimental or strict-shard scale track after load and cost gates.
- Returns `joined`, `queued`, `version_mismatch`, `room_full`, `online_disabled` or `bad_identity`.

`FloorShardDO`

- One online floor instance.
- Key: `online:v1:{region}:{rulesetVersion}:{runSeed}:{floorKey}:{z}:{shardOrdinal}`.
- Holds active WebSockets using Durable Object WebSocket hibernation API.
- Owns player slots, online actor state, sparse world patch overlay, public samosbor phase, shared interaction locks, reliable event ring and recent input ring.
- Owns ordering and validation for shared facts. In the chosen POC it is named/implemented as a `FloorRoomDO` relay and must not run the full offline floor simulation.
- Uses event-driven/coalesced ticks where possible; active PvP/combat shards may run bounded fixed ticks.
- Persists enough state to recover after eviction/restart.
- Does not store full browser `World`.

`MarketDO`

- Owns hot online exchange state and rate budgets.
- Batches D1 writes.
- Computes online quote pressure and fees.
- Keeps all item/economy mutations idempotent.

Optional `SectorDO`

- Phase 2 scale primitive if 128-player PvP hotspots overload one `FloorShardDO`.
- `FloorShardDO` remains the floor identity coordinator; `SectorDO`s own dense local combat sockets and state by 64x64 sector groups.

### 4.3 Region And Location

Durable Objects are single-location stateful objects. Region must be part of the shard key before the first object is created. The Worker should choose region from user preference, latency probe or coarse geography before first `ONLINE_FLOORS.get(id)` call. Do not pre-create shards from CI in a random location.

Reconnect should return to the same shard key. If latency is bad, move only through explicit floor transfer or new run/session, not by silently moving a live shard.

### 4.4 Identity And Auth

Current `NET-GEN` is a visible profile/recovery handle, not a secret. Full online needs a private browser secret:

- `netGen`: visible stable handle, can be typed with `/netgen`.
- `netSecret`: random private secret in `localStorage`, never shown in chat/UI.
- `sessionId`: tab/session id in `sessionStorage`.
- `joinToken`: short-lived signed token minted by Worker/Lobby and scoped to shard, route, region, build, protocol and expiry.
- `reconnectNonce`: one-use token for slot recovery.

Rules:

- Same `netGen` + valid `netSecret` can recover or take over own session.
- Same `netGen` without secret is not allowed to control the online account.
- Public chat/events must never reveal another player's raw `netGen`.
- Every mutating command carries `clientSeq` and an idempotency key where it can affect durable state.

## 5. Client Architecture

Add the online runtime beside Net Sphere, not inside render or content modules:

- `src/systems/online_profile.ts`: net identity, private secret, online save key, consent flags, profile status.
- `src/systems/online_transport.ts`: WebSocket client, JSON-first batched frames for POC, reconnect, backoff, ack, sequence windows; binary framing only after measurements justify it.
- `src/systems/online_runtime.ts`: state machine `disabled | connecting | queued | online | reconnecting | degraded | offline`.
- `src/systems/online_floor.ts`: remote actors, server snapshots, sparse world patch overlay and shared interaction locks.
- `src/systems/online_inventory.ts`: online warehouse cache and claim receipts.
- `src/systems/online_economy.ts`: listings, escrow, fees, market snapshots.
- `src/render/online_ui.ts`: canvas-only online status, queue, presence and exchange panels.

`main.ts` should receive only generic hooks:

- initialize online input/profile;
- call online tick after local input collection and before/after simulation in a documented order;
- route floor transitions into online leave/join;
- draw online UI snapshots through existing HUD path.

Do not add route-specific online code to `main.ts`.

## 6. Realtime Protocol

Use JSON for REST, join, debug and the first 2/4/8 host-relay POC. Batch messages every 50-100 ms and use array tuples for hot snapshot data. Compact binary frames are a later optimization after 8-player soak shows JSON is the bottleneck.

Handshake:

- `hello`: `{ onlineProtocol, buildId, rulesetVersion, netGen, sessionId, routeSeed, floorKey, z, region, clientCaps }`
- server response: `{ shardKey, slot, tickRate, snapshotRate, queue?, serverTime, joinTokenExpiresAt }`

Client to server:

- `input`: `clientSeq`, `lastServerSeq`, `dtMs`, movement axes, yaw, buttons, selected weapon/tool.
- `action`: fire, reload, interact, use item, drop, terminal command.
- `ack`: last snapshot/event sequence.
- `ping`: latency and clock smoothing.

DO/host to client:

- `snapshot`: sequence, time, host-owned latest state, visible actors, compact correction flags.
- `event`: reliable ring items: shot, hit, death, door changed, container claim, terminal result, samosbor beat.
- `patch`: sparse world mutation overlay with patch version.
- `queue`: position/eta/heartbeat.
- `error/close`: typed reason and fallback instruction.

Cadence for future strict shards:

- Budget mode client input: 4-6 Hz sustained, 8 Hz only after shard health/cost gates; short 12 Hz combat burst with token bucket.
- Server shared-state cadence: event-driven/coalesced 100-250 ms where possible, not an always-on full offline sim loop.
- Server combat movement tick: 10 Hz only for active shards/features that need it.
- Server snapshots: 3-5 Hz baseline; 10 Hz in combat AOI if the shard is healthy.
- Client render: 60 FPS prediction/interpolation.

Packet targets:

- input frame <= 64 bytes after envelope.
- action <= 256 bytes.
- normal state delta <= 4-8 KB per client.
- typical AOI snapshot target <= 0.5-1.5 KB per client.
- world patch chunk <= 16 KB.
- lift/join overlay replay <= 16 KB typical, chunked 64-256 KB worst-case resync outside hot path.
- chat remains 160 chars.
- reject or close frames far below Cloudflare's 32 MiB received-message limit.

Online protocol ids must not reuse local `Entity.id` as network authority. Use explicit namespaces:

- `slotId`: stable 0-127 player slot inside the shard.
- `actorNetId`: server-owned actor id for players, monsters, projectiles and temporary hazards.
- `entityLocalId`: optional client mirror id, never trusted by the server.
- `patchId` / `eventSeq`: monotonic server ids for idempotent patch/event application.

## 7. Simulation Authority

### 7.1 Base Principle

Offline mode remains client-authoritative exactly as now. Online design now has two explicit trust tiers:

1. **Relaxed-trust online**: clients or player-hosts may be authoritative for movement, combat, loot, samosbor and local shared state. This is acceptable because anti-cheat, competitive fairness and protected scarcity are not goals.
2. **Server-authoritative shared shards**: used only where one ordered state improves UX, reconnect, persistence, queueing, cost control or cross-client consistency.

When a feature chooses server authority, it owns:

- player position and velocity;
- online player stats, equipment, status effects, cooldowns and carried online inventory;
- PvP hits and deaths;
- projectiles that can hit online players;
- shared doors, locks, terminals and containers;
- online loot mint/burn;
- online samosbor phase;
- online floor patch overlay;
- market/listing/wallet/escrow.

The client may predict for responsiveness. In server-authoritative shards the server wins conflicts; in player-host/co-op rooms the host wins conflicts; in soft asynchronous Net Sphere surfaces conflicts can simply be aggregated or ignored.

Online profile state does not have to be protected from cheating. It only has to be clearly separated by mode. Strict server-owned inventory/economy can exist later, but the baseline online mode may use client-claimed stats, gear, progress and market impulses as soft social data.

This is hybrid authority, not full cloud simulation. Clients are expected to compute everything private and presentational locally: procedural floor generation from seed, WebGL, sound, HUD, prompt targeting, prediction, interpolation, private local PvE and offline save. The server owns only the shared ordering/persistence that a specific mode chooses to centralize.

Player-hosted authority is inside the design space now. A host may be the truth for a private expedition or relaxed public room. The product must label this honestly instead of pretending it is competitive or protected.

### 7.2 World Representation

Client generates the base floor locally from the same route seed and source code. Server stores:

- floor identity;
- build/ruleset/generator version;
- compact collision/passability digest or chunk cache;
- sparse mutation overlay;
- actor slots and spatial buckets;
- reliable event ring;
- shared interactable lock table;
- online container/loot table;
- samosbor state.

Do not transfer `World.cells`, `roomMap`, `wallTex`, `floorTex`, `features`, `fog` as full arrays during play. Full snapshots are cold recovery/debug assets only, compressed and bounded.

Client applies server patch overlay by mutating local runtime `World` through existing dirty-version patterns. Every cell/door/feature/fog patch must bump the same dirty versions local systems/render caches expect.

Patch schema must be strict and idempotent:

- `patchSeq`, `patchId`, `basePatchVersion`, optional `expectedOldValue` or chunk hash.
- typed operations for cell, feature, door, container, fog, light and room-door updates.
- one local patch applier owns all dirty-version bumps: `cellVersion`, `surfaceVersion`, texture versions, fog version, door/collision caches and light rebuild flags.
- ordered application only; missing patches request resync instead of guessing.
- early online should whitelist a small patch set: doors, locks, loot claims, terminal flags and samosbor aftermath cells.

### 7.3 Movement

In server-authoritative shards the client sends intents, not final coordinates. In relaxed-trust/player-host rooms, the host or client may send accepted coordinates/snapshots directly. Validation here is for consistency and bug containment, not anti-cheat.

Server-authoritative shard validation:

- max speed by player stats/status/equipment;
- collision against compact passability and door state;
- toroidal wrap using the same `W=1024` semantics;
- impossible teleport/acceleration;
- sequence monotonicity.

If the server is authoritative, it should not use client `dtMs` blindly as simulation truth. It should run fixed server ticks, consume inputs by sequence, clamp accumulated input age and apply collision radius against `World.solid()`-equivalent semantics. LIFT and closed/locked door states need explicit passability rules. Reachability audits are not movement collision and must not be used as a realtime collision substitute.

Client prediction:

- local player moves immediately;
- server snapshots reconcile position/angle;
- corrections under a small threshold smooth over 100-150 ms;
- hard corrections snap with a short HUD/status line only if needed.

Remote players:

- interpolate delayed snapshots;
- no per-frame pathfinding;
- no remote actor allocations per packet;
- stable 128-slot arrays on client and server.

Toroidal interpolation and hit tests must always use shortest wrapped deltas. Without this, players crossing the 0/1024 seam will visually snap and PvP traces can miss or hit across the wrong side of the map.

### 7.4 Shooting And Damage

PvP does not need anti-cheat or competitive fairness. Choose authority by mode:

- relaxed co-op/player-host: host decides shots, damage and death;
- soft public room: clients/host may report hits and deaths as accepted events;
- stricter shared shard: server decides hits for consistency/reconnect, not because cheating must be stopped.

Reuse data:

- weapon ids and stats from `src/data/weapons.ts`, `src/data/psi.ts`, `src/data/catalog.ts`;
- damage/death presentation from existing damage/death systems;
- events through compact event drafts.

Rules:

- Client sends `fire` action with seq, weapon id, local aim angle, predicted muzzle position and input timestamp.
- In strict shard mode, server validates weapon equipped, cooldown, ammo/energy, status, and server-side angle/position tolerance.
- Hitscan or projectile simulation runs in `FloorShardDO` at server tick.
- Server returns `shot` and `hit/death` events.
- Client can draw predicted muzzle flash immediately but must reconcile ammo/hit/death from server.
- Friendly fire/PvP rules must be data-driven per shard: `pvp=open | faction_limited | duel | disabled`.

For strict shard mode, do not blindly enable every local weapon behavior online. Maintain an online weapon whitelist with deterministic server implementations for hitscan, simple projectile, beam and area damage. In relaxed host mode, more local weapon behavior can be allowed because host-side consequences are accepted.

Strict shard hitscan needs bounded lag compensation for playability: keep a short per-actor position history ring, rewind only within a capped window, then validate line of sight, toroidal delta, weapon range and shooter state. The server result is final in that shard mode.

Projectile budget:

- Server projectile slots capped per shard.
- Short-lived projectile ring, no unbounded arrays.
- Projectiles only tick while alive and in active AOI.
- Explosions and beams produce bounded patch/hit events.

### 7.5 Interactions

Current `systems/interactions.ts` directly mutates local world/state. Online mode needs a split:

- `findInteractionTarget` can remain local for prompt targeting.
- `tryInteract` in online mode emits intent for shared targets.
- Server executes shared mutations and returns result/patch/event.
- Local-only overlays can remain local when they have no shared/economic effect.
- Every shared interaction target needs a canonical key stable across clients: door id, room id + local index, container lot id, terminal id, lift id or authored interactable id.
- Synthetic UI offsets, display names and local entity ids are not valid server targets.

Shared targets from early to late:

1. Doors and lifts: open/close/locked/hermetic state.
2. One simple online container class with claim reservation.
3. Net terminals and exchange operations.
4. Dangerous floor terminals/hack backlash.
5. Complex quest/NPC interactions.

Interaction locks:

- short TTL, usually 2-5 seconds;
- bound to player slot and target id;
- released on action complete, disconnect or timeout;
- never block offline local play.

Server interaction validation:

- player is in range and line of sight if the interaction requires it;
- target exists in the server floor overlay and matches the expected version;
- player has required online item, permit, role, cooldown and status;
- mutation is idempotent under the action key;
- result returns as patch/event/item delta, never as "client please mutate shared state yourself".

Reward, damage, economy and quest side effects from online interactions must flow through the server result. The client can show local prompt text, but not decide shared consequences.

### 7.6 Inventory, Loot And Containers

Offline inventory stays local. Online inventory has two possible modes.

Soft relaxed-trust mode:

- client can publish bounded item summaries, loot claims or listings as social/economic signals;
- server caps payload/rate/storage, but does not try to prove that the item was earned;
- cheating is acceptable because the mode does not promise protected scarcity.

Strict shared mode, if a later feature needs it, has three buckets:

- `online_carry`: server-authoritative items carried during online session.
- `net_warehouse`: durable online storage.
- `local_inventory`: current offline/single-player inventory. Soft economy may read client-claimed summaries from it; strict economy must not treat it as protected scarcity.

Strict online loot flow:

- FloorShardDO mints loot only from server-authoritative events.
- Pickup is a server claim against a loot lot id.
- Server sends item delta to `online_carry`.
- Client renders result and may mirror it in the online local save cache.
- Extraction/terminal deposit moves `online_carry` to `net_warehouse`.
- Claim to offline is one-way: online lot burns, local item is granted with receipt.

Strict no rollback loop:

- A local claimed item can be used offline.
- It cannot be sold back into online exchange unless it re-enters through a server-authoritative online event.

### 7.7 Samosbor

Online samosbor has two tracks.

For the chosen host-browser POC:

- host owns samosbor timer/phase and sends AOI-visible samosbor warning/active state;
- peers render warning/effects locally from host snapshots/events;
- active geometry rebuild, wave frontier, pending aftermath and shelter resolution are not part of the first meeting POC;
- if a large samosbor rebuild would happen before resync support exists, the online room may show `ЗАГРУЗКА`, freeze or end.

For later strict shards, samosbor may become shard-authoritative:

- FloorShardDO schedules warning, active phase, shelter checks, aftermath and patch version.
- Clients render warnings/effects locally.
- Server records who was sheltered, exposed, damaged or killed.
- World mutation is sparse patch overlay, not full regeneration broadcast.
- Economy gets bounded `samosbor_supply_shock` events.
- Shock/aftermath events must be idempotent by shard phase id so reconnects and retries cannot duplicate damage, loot destruction or economy pressure.

Offline samosbor remains unchanged.

Online clients must not run local samosbor damage or geometry mutation while attached to a host/strict shard. They render effects from host/server phase/timer data, apply ordered patches when that milestone exists, and receive authoritative exposure/shelter results. Shelter checks should use host/server-defined shelter volumes or room tags, not a peer-only guess from local floor memory.

### 7.8 NPCs, Monsters And A-Life

The chosen POC is **host-owned full current-floor PvE**, not PvP-only presence. The host browser keeps the existing NPC, monster, projectile, hazard, container and samosbor simulation alive. Peers mirror host-owned actors and send inputs/actions to the host.

POC rules:

- host owns NPC/monster AI and all damage against host-owned actors;
- host sends AOI snapshots for NPCs, monsters, projectiles and drops;
- peer does not run authoritative local NPC/monster/projectile/samosbor mutation while attached to the room;
- peer may keep local base floor/render systems alive, but shared actors are replaced/overridden by host mirrors;
- remote player actors in the host sim need stable `slotId`/`actorNetId` mapping; local `Entity.id` remains host-local only;
- host AI scheduling and targeting must treat remote players as interest/combat anchors, not only the local `player.id`;
- if renderer still skips all `EntityType.PLAYER`, remote players must be represented as NPC-like mirror actors or the renderer must skip only the local player id;
- no A-Life pool sync, no off-floor simulation sync, no local floor memory upload.

Strict server-authoritative monsters/NPCs are a later branch if host relay fails or public rooms need persistence. That later branch should phase in simple capped monsters first, then limited NPC terminal/trade actors, then online A-Life facts. Do not hide that as part of the first meeting POC.

Samosbor is included visually/statefully in the host-owned room, but geometry rebuild and floor epoch changes are later resync gates. First meeting POC can mirror samosbor phase and immediate actor consequences, then freeze/close on large world rebuild until `floorEpoch` and patch resync exist.

Hard constraints:

- No server per-frame full-world scans.
- No materializing 1,000,000 A-Life records online.
- No generator-side identity refill.
- No content-specific online branches in `main.ts`.
- No full local quest save upload to server.

Server actor caps for early PvE:

- host-relay player slots: 2 first, then 4, then 8 after gates; hard protocol max 128 is only a future format ceiling.
- 256 simple projectile slots.
- host snapshot AOI caps: 80/64/48 NPC/monster actors for 2/4/8 player tests.
- 32-64 online monster/NPC slots in later strict combat shards; 128 only after CPU/load gates.
- AI tick LOD: hot 10 Hz, warm 2 Hz, cold event-only.

### 7.9 Floor Memory

Local `floor_memory.ts` remains local. Online floor memory is separate:

- FloorShardDO owns online overlay state while active.
- Cold floor state persists as compact patch log and summary.
- D1 stores metadata and recent durable events.
- R2 can store compressed historical snapshots/replays if needed.
- On shard restart, server reconstructs from seed + durable overlay + recent event ring.

Do not attempt to upload the player's packed local floor memory as shared state.

Online floor entry ignores local `floor_memory` mutations for shared authority. The client may use local memory only for private rendering/cache hints when compatible with the server patch version. A disconnected online branch must not merge back into shared online state after the fact.

### 7.10 Lift Transfer Boundary

Lifts are the best coarse synchronization boundary. They cannot be the only synchronization point while multiple players share a floor, but they should be the place where the client performs the largest reconciliation.

Two-phase transfer:

1. Client sends `leave_floor_request`: direction, lift target key, `clientSeq`, `lastServerSeq`, `lastPatchSeq`, idempotency key.
2. Current `FloorShardDO` validates that the online actor is at a usable lift, closes unacked shared actions and issues `transferTicket`.
3. Worker/Lobby resolves the target shard by `{region, rulesetVersion, runSeed, floorKey, z, shardOrdinal}`.
4. Target `FloorShardDO` returns `enter_floor_snapshot`: route identity, generator/ruleset version, base digest, `patchEpoch`, `patchSeq`, overlay snapshot/chunks, authoritative door/container/terminal/samosbor state, player online state, arrival lift anchor, event cursor and AOI actors.
5. Client locally generates or restores a compatible base floor, applies overlay through the patch applier, then leaves loading state.

Route lift topology must be authoritative online. Current offline logic can mirror/normalize lift anchors locally, but online target shards must publish the final return-lift layout as shared patch data so all clients agree.

Disconnect policy:

- before leave commit: actor remains on old shard;
- after leave commit before target join: `transferTicket` resumes target arrival;
- after target join: old shard cannot own the actor;
- missed patches or shard epoch changes force overlay resync, not local merge guessing.

## 8. Online Economy And НЕТ-Биржа

Current `/api/net/market` is aggregate quote influence. Under the no-anti-cheat correction, the first online economy should stay **soft**: client-claimed impulses, listings and summaries are accepted as diegetic social signals, not protected scarcity.

Strict server-authoritative inventory, escrow and ledger are optional later features for UX consistency, not anti-cheat or real-money protection.

### 8.1 Trust Boundary

- Offline inventory, cash, local bank, local stock portfolio and local floor economy remain local.
- Soft НЕТ-биржа may accept client-claimed goods/impulses because cheating is allowed and there is no competitive/profit stake.
- Soft listings must be labeled as НЕТ-сигналы/заявки, not guaranteed scarce assets.
- Strict server-authoritative inventory can exist later as `НЕТ-склад`, `НЕТ-счет`, escrow, listings and ledger if the gameplay needs persistent shared scarcity.
- Online goods claimed into offline may be either soft receipts or strict burn receipts depending on the mode.

### 8.2 Item Identity

The base game item shape is `{ defId, count, data? }`. Soft online can transmit bounded client-claimed item summaries. Strict online normalizes it:

- Fungible stack: food, water, common ammo, simple resources. Stack key: `defId + normalizedDataHash + quality + sealState`.
- Unique lot: weapons, tools with durability, documents, samples, rare trophies, contraband, meaningful `data`.
- `item_kind_id` maps to source `defId`.
- `catalog_hash` or `catalog_version` freezes compatibility and allows old lots to be disabled after item changes.
- `item_data_json` is whitelist-only: durability, charge, seal state, contamination, permit kind, evidence grade, origin shard and source event key.
- Quest/key/debug/personal story items should be hidden from soft public listings by default for UX clarity, not anti-cheat.

### 8.3 D1 Exchange Tables

For strict economy mode, add tables without replacing current market impulse tables:

- `net_accounts(net_gen, wallet_rubles, escrow_rubles, risk_score, trade_locked_until, created_at, updated_at)`
- `net_item_kinds(kind_id, def_id, resource_id, trade_class, stack_policy, base_value, tags_json, catalog_hash, enabled)`
- `net_inventory_lots(lot_id, owner_net_gen, item_kind_id, quantity, identity_hash, item_data_json, source, source_shard, source_event_key, status, version, created_at, updated_at)`
- `net_listings(listing_id, seller_net_gen, lot_id, quantity, unit_price, currency, status, fee_quote_json, expires_at, version, created_at, updated_at)`
- `net_escrows(escrow_id, listing_id, buyer_net_gen, seller_net_gen, lot_id, quantity, gross, fee, tax, status, idempotency_key, expires_at, created_at, updated_at)`
- `net_exchange_ledger(ledger_id, tx_key, net_gen, kind, rubles_delta, lot_id, item_delta, listing_id, escrow_id, balance_after, created_at)`
- `net_exchange_claims(claim_id, net_gen, lot_id, quantity, status, claimed_at, local_receipt_key)`
- `net_risk_flags(flag_id, net_gen, listing_id, lot_id, reason, severity, created_at)`

Strict mode required unique keys:

- `source_event_key`
- `idempotency_key`
- `(seller_net_gen, status)`
- `(item_kind_id, status, unit_price)`
- `(net_gen, tx_key)`

### 8.4 Transaction Model

D1 supports prepared statements and batched statements; batches execute sequentially and roll back the sequence on failure. Use that for strict buy/list/cancel when possible. Where full transaction helpers are not available in the local adapter, use compare-and-swap status transitions plus idempotency keys. In soft mode, these are not anti-dupe measures; they only prevent accidental double-submission from retries.

Create listing:

1. Validate account/session/rate budget.
2. Check seller owns a `held` lot.
3. CAS lot from `held` to `listed`.
4. Insert `open` listing.
5. Write ledger row.

Buy listing:

1. Idempotency key = buyer + listing + client nonce.
2. CAS listing from `open` to `reserved`.
3. Check buyer balance.
4. Move rubles into escrow, then settle seller minus fee/tax.
5. Move or split lot to buyer.
6. Mark escrow `settled`, listing `sold` or partially open.
7. Write double-entry ledger rows.

Cancel listing:

1. Seller only.
2. CAS `open/listed` to `cancelled`.
3. Return lot to `held` only if no active escrow exists.

Claim to local:

1. Server creates one-time `claim_id`.
2. Client receives item payload and local receipt.
3. Server immediately marks online lot `claimed/burned`.
4. Repeated claim returns the same receipt and never mints another online lot.

### 8.5 Fees, Taxes And Risk

- Listing fee reduces spam.
- Sale fee is the base НЕТ-Обмен commission.
- Route tax depends on shard/floor danger, faction control and samosbor pressure.
- Contraband risk applies to forgeries, samples, documents and illegal weapons.
- Withdrawal fee applies when moving online items into offline local inventory.
- Fees publish compact impulses into the existing aggregate market: `online_exchange`, `tax`, `tariff`, `trade`, `contraband`, `documents`.

Risk is gameplay:

- Listings have `risk_grade`: clean, suspicious, contraband, contaminated, forged.
- Documents/samples can be `unchecked`, `passed`, `flagged`, `confiscated`.
- Buyer sees risk before purchase.
- High-risk sellers get higher fees, cooldowns, listing limits or quarantine.
- Fraud flags affect online exchange only, not offline play.

### 8.6 НЕТ-Терминалы

НЕТ-терминалы become the in-world exchange entry:

- Offline/API unavailable: show local bank, cached quotes and "Маркет offline. Игра локальна."
- Online: tabs `НЕТ-БАНК`, `НЕТ-СКЛАД`, `БИРЖА`, `ЗАЯВКИ`, `ДОСТАВКА`, `РИСК`.
- Without online auth: read-only quotes and local bank.
- With online auth: listings, buy/sell, escrow history, claim receipts.
- On floor shards: show local tax, delivery delay, inspection risk and samosbor delay.
- Every irreversible boundary needs explicit confirmation: item, count, price, fee, tax, risk.

## 9. Scaling And Performance

### 9.1 128-Player Reality Check

One Durable Object is single-threaded and has a soft request throughput limit. 128 players at 20 Hz would send 2560 input messages/sec before chat/actions/reconnect, which is not a good target for one DO.

The cost reality is just as important as throughput. With the 2026 Durable Objects pricing model, incoming WebSocket messages are discounted for request billing at 20:1, but a single 128-player floor active all month still exceeds the `$10/month` envelope at normal action-game input rates.

Rough incoming-message cost model for one floor, before Worker requests, D1, logs and duration:

| Scenario | Incoming WS messages/month | DO billable requests after 20:1 | Approx. DO request overage after included 1M |
| --- | ---: | ---: | ---: |
| 128 players * 8 Hz * 30 days | ~2.65B | ~132.7M | ~$19.76 |
| 128 players * 6 Hz * 30 days | ~1.99B | ~99.5M | ~$14.78 |
| 128 players * 4 Hz * 30 days | ~1.33B | ~66.4M | ~$9.80 |

This means `$10/month` can support the current Net Sphere plus controlled test shards, not unlimited always-on 128-player action floors.

Recommended capacities for the chosen host-browser relay path:

- v0 closed test: 2 players, JSON frames, one foreground desktop host, 30-minute room soak.
- v1 closed test: 4 players, per-recipient AOI, reconnect ring, host upstream/FPS gates.
- v2 alpha test: 8 players, lower Hz, hard AOI caps, host health monitor, mobile peers allowed but no mobile host.
- v3 experiment: 16 players only if 8-player soak is cheap and stable. At this point decide whether to keep host relay, add WebRTC for private rooms, or move serious public rooms to a headless/VPS/strict-shard branch.
- v4 32+ public shard: not a host-browser POC promise. Requires separate load/cost architecture.
- v5 128-player floor: only after cost/load gates, aggressive batching, AOI, possible sector DOs or non-browser host architecture.

The UX can say "до 128 на этаже" only when queue, degradation and soak tests prove it.

### 9.1.1 Hundreds-Player Server Track

The host-browser relay path has a deliberate scale ceiling. It is for proving gameplay with a living floor and for small relaxed rooms, not for hundreds of players.

Hard rule:

- 2/4/8 players: host-browser relay through Cloudflare DO is the planned test path.
- 16 players: experiment only, after 8-player soak and cost review.
- 32+ public players: start server-track work before raising public cap.
- 100+ players: requires a headless/server authority track; do not attempt it by raising the browser-host cap.

Why a server is required for hundreds:

- a player browser cannot be treated as reliable public infrastructure;
- foreground-only desktop host, tab throttling and sleep are incompatible with long-lived public rooms;
- host upstream becomes the bottleneck before game design does;
- public rooms need hostless lifetime, clean reconnect and controlled degradation;
- AOI and outbound bandwidth must be enforced by infrastructure, not by one player's tab;
- a real server gives a fixed place for metrics, load tests, crash handling and controlled room shutdown.

The first server should not be a new game. It should be a headless authority for the same online floor contract:

- input: route identity, ruleset/build version, join tokens and player intents;
- output: AOI snapshots, reliable events, sparse patches and close/freeze reasons;
- no render, WebGL, sound, HUD, canvas UI, local save or DOM;
- no full hidden A-Life simulation beyond the active online floor;
- no full `World` blob broadcast during play;
- bounded actor/projectile/drop arrays and sector buckets;
- same toroidal movement/collision semantics as the browser floor.

Cloudflare role in server-track:

- Worker/Lobby mints signed join tokens and exposes `/api/online/v1/status`;
- D1 stores profiles, summaries, soft market facts and optional strict economy ledgers;
- DOs can still own small queues, room registry, reconnect reservations or fallback relay;
- the headless room server owns hot per-frame simulation and snapshots;
- if direct server WebSocket is used, Worker returns endpoint + token instead of proxying every hot frame through DO.

Server placement preference:

1. Cloudflare Containers as the first minimal integration candidate, because they keep Worker/Wrangler deployment, routing, tokens and room registry in one provider family.
2. External VPS/bare-metal/headless host behind Cloudflare only if Containers fail always-hot room economics, startup time, regional placement or sustained WebSocket soak.
3. Durable Object full sim only for narrow strict systems or very small shards, not as the default 100+ player action server.

Do not duplicate the API surface for each placement. Both Cloudflare Container and external headless server should consume the same join token, room key, authority mode and protocol envelope. The difference is routing and operations, not gameplay shape.

Server room capacity should move through gates:

- 8 synthetic clients: sanity check against host-relay behavior.
- 16 synthetic clients: basic AOI/backpressure.
- 32 synthetic clients: first public-server candidate.
- 64 synthetic clients: public shard candidate only after p99 snapshot age, bytes/client and CPU headroom are measured.
- 128 synthetic clients: stretch target soak before any public claim.
- 200+ synthetic clients: separate sectorization/crowd-compression program, not a normal cap bump.

Server-track stop signs:

- server code begins to duplicate render/UI/local-save logic;
- `main.ts` gains content-specific online branches;
- per-frame full-world scans appear in the server loop;
- Cloudflare D1 is used as a hot tick database;
- clients receive full-floor entity/world state instead of AOI slices;
- public copy promises hundreds before synthetic and real-client soak tests pass.

### 9.2 Interest Management

Use toroidal AOI:

- Sector size: 64x64 cells.
- Floor has 16x16 sectors.
- Player subscribes to own sector plus 3x3 neighborhood.
- Snapshot hard cap: 32 actor states by default.
- Priority: own player, damage participants, visible/nearby actors, party/faction/enemies, recent interactions, then distance.

No full-floor broadcast.

### 9.3 Server Memory

Target active shard heap: 16-32 MB.

Allowed:

- typed arrays for 128 player slots;
- actor slot arrays;
- spatial buckets;
- sparse patch maps;
- event rings;
- small collision/passability chunk cache;
- queue/session metadata.

Avoid:

- full browser `World` object;
- renderer arrays;
- full NPC pool;
- full local save;
- megabyte JSON blobs;
- per-message allocations in hot paths.

### 9.4 WebSocket Hibernation

Use Durable Object WebSocket hibernation API (`acceptWebSocket`) for sockets. It reduces idle costs for queues, idle rooms, chat/presence and empty floors. Active realtime floor shards stay hot while they process frequent messages/timers, so hibernation is a recovery/cost tool, not a substitute for a bounded tick.

Socket attachments should contain only identity, slot, floor key, sector, last seq and rate counters. Critical inventory/save state belongs in DO storage or D1, not WebSocket attachment memory.

### 9.5 Backpressure

- Join token expires in 20-30 seconds.
- Disconnect slot grace 15-30 seconds for active combat, 60-120 seconds for reconnect reservation if safe.
- Queue heartbeat 10-15 seconds.
- AFK degrades send rate, then moves to queue/offline.
- Outbound backlog first drops cosmetics, then sends latest-only snapshots, then reduces snapshot Hz, then closes slow clients.
- Input spam stores latest movement intent and rejects actions by token bucket.
- Oversized/invalid frames close early with clear code.

## 10. Observability, Abuse And Ops

Cloudflare budget alerts are useful for notification, but the game needs its own budget gate because alerts do not act as an automatic multiplayer kill switch.

Minimum metrics:

- active players by shard;
- queue depth and join accept/reject;
- tick p50/p95/p99;
- tick overruns;
- input messages/sec;
- outgoing bytes estimate;
- snapshot actors and bytes;
- dropped/coalesced input;
- reconnect success;
- disconnect reason;
- D1 rows read/written;
- economy flush latency;
- projected monthly DO request/duration spend;
- budget-gate closures and rejected joins;
- 429, 5xx, DO overload, isolate limit errors;
- resilience/cost counters: invalid envelope, malformed action, impossible move in strict shard mode, rate limited, oversized frame, duplicate idempotency key, suspicious cost spike.

Logging rules:

- No per-packet console logging.
- Structured sampled logs only.
- Retained traces go to Logpush/R2 or equivalent durable sink.
- Public bug reports should reference shard key hash, not raw private identity.

Cost and resilience layers:

- Worker validates method/path/protocol/payload before routing to DO.
- Optional Cloudflare WAF/Bot/Turnstile only for suspicious join bursts.
- Worker-level coarse rate limiting by IP+netGen+route.
- DO exact per-session token buckets.
- Server-authoritative PvP/world/economy only for strict consistency modes, not for anti-cheat.
- Moderation path for chat/report/mute before public beta.

## 11. Implementation Roadmap

### Phase 0: Contract And Harness

Deliver:

- Accept this `online.md` as a decision doc, not shipped behavior or a public promise.
- Add no gameplay behavior yet.
- Keep existing Net Sphere `/api/net/*` behavior as the cheap cloud baseline.
- Add test harness for online state machine, fake DO protocol and synthetic WebSocket load in later code task.
- Add Cloudflare docs notes to `cloudflare.md` only when actual bindings/routes ship.

Exit:

- `npm run check:readonly`.
- `git diff --check`.

### Phase 1: Profile, Mode Selection And Kill Switch

Deliver:

- Title/menu entry: `ЛОКАЛЬНО` and `ОНЛАЙН: НЕТ-СФЕРА`.
- Separate `gigahrush_online_profile`.
- Private `netSecret`.
- `/api/online/v1/status`.
- Global online kill switch.
- Feature flags for `presence`, `movement`, `pvp`, `patches`, `samosbor`, `exchange`, `pve`.
- Budget gate that disables new joins before the monthly target is exceeded.
- Online disabled response that never blocks offline.

Exit:

- Local save/load untouched.
- Online unavailable path verified in browser.

### Phase 2: Lobby, Queue, WebSocket Presence

Deliver:

- Worker online gateway.
- Direct Worker route to `FloorRoomDO`; `LobbyDO` waits until public queues or 4/8-player room selection need it.
- `FloorRoomDO` skeleton with hibernating WebSockets.
- 2-player POC room for the same `{runSeed, floorKey, z, rulesetVersion}`.
- Remote player transform presence on the same floor.
- Ordered event ring and 2-slot membership before any broader queue work.

Exit:

- Two browser clients join the same online floor and see each other's position/yaw.
- Third fake client queues or receives `room_full` in the 2-player POC cap profile.
- Reconnect recovers slot within TTL.
- Offline and existing `/api/net/*` unaffected.

### Phase 2.5: Minimum Shared Gameplay POC

Deliver:

- Host-browser full current-floor simulation for one online floor room.
- Peer input/actions relayed to host through `FloorRoomDO`.
- Host creates a real remote actor for the peer, with `slotId`, `actorNetId`, x/y/angle/pitch, hp, weapon and minimal online inventory.
- Remote actor movement/action handling is separate from the local `movePlayer()` / `playerActions()` singleton path.
- AI interest centers include host player and remote actor so the peer AOI is not a dead pocket.
- Host simulates the whole floor, while realtime snapshots are per-peer AOI slices for players, NPCs, monsters, projectiles, dropped items and samosbor phase.
- `shot_spawn` / projectile state from host broadcast to peers.
- `projectile_hit` event from host broadcast to peers.
- `item_drop` event from host that creates a shared dropped item with TTL.
- `item_pickup(dropId)` event where host decides pickup and DO relays ordered result.
- Host loss path freezes/ends the room cleanly. No handoff in this phase.
- Small canvas/HUD indication that this is relaxed online test mode.

Exit:

- Two players on the same floor can meet while NPCs/mobs continue to exist and move in the host simulation.
- Both players see host-owned NPCs/monsters/projectiles well enough to understand the shared scene.
- One player can shoot and the other sees the projectile/hit event.
- One player can drop one simple item and the other can pick it up.
- Host normal leave, hidden tab, hard crash or network loss may freeze/end the room in this phase.
- No full `World` transfer.
- No full A-Life pool sync.
- No Cloudflare-hosted headless sim yet.
- No strict economy.
- No lift travel, NPC trade/dialogue, terminal UI, quest progression or full containers for peers.
- No active samosbor rebuild; mirror phase/warnings only or freeze/loading when rebuild would happen.
- Room remains stable for 30 minutes with 2 clients.

### Phase 3: Prediction, AOI And 4-Player Host Relay

Deliver:

- Input sequence/ack.
- Client prediction and reconciliation.
- Toroidal movement validation.
- AOI snapshots.
- JSON tuple/delta snapshots; binary only if JSON is proven to be the bottleneck.
- Raise cap from 2 to 4 only after Phase 2.5 passes.

Exit:

- Two clients see smooth remote movement.
- Impossible movement is rejected or ignored by the host/DO consistency layer.
- 4-client movement soak passes before raising cap to 8.
- 32-client movement soak is a later strict-shard gate, not this POC.

### Phase 4: 8-Player Host Relay And Combat Polish

Deliver:

- Raise cap from 4 to 8 only after 4-player soak.
- Host-owned projectile/hit/death events for player-vs-player and player-vs-host-owned NPC/monster combat.
- Snapshot Hz degradation under load.
- Host health monitor: foreground status, frame time, outbound queue, missed lease renewals.
- Clear freeze/end UI for host loss.
- Keep strict economy and strict server PvP out of this phase.

Exit:

- Shooter and target see the same ordered hit/death facts from host events.
- Replay/duplicate fire/drop/pickup action ignored.
- Disconnect during combat has defined relaxed-trust result.
- 8-player room stays within host upstream, DO handler and snapshot-age stop metrics.

### Phase 4.5: Loading Checkpoint Host Handoff

Deliver:

- Normal host leave/quit/floor-exit handoff after 2/4-player gameplay is stable.
- `handoff_begin`, `handoff_chunk`, `handoff_ready`, `host_changed` protocol.
- Loading-time full current-floor checkpoint in a `floor_memory`-style shape.
- DO relay with chunk hash, size cap and timeout; no durable cloud save.
- Abort conditions: active samosbor, samosbor warning/wave/aftermath, active combat burst, too many in-flight projectiles, oversized checkpoint.
- Projectiles may be discarded during handoff.
- New host restores world, actors, player slots, cursors, clears stale AI paths and recalculates `nextEntityId`.

Exit:

- Normal host leave promotes another player after visible `ЗАГРУЗКА`.
- Handoff failure freezes/ends the room without corrupting offline play.
- No requirement for seamless migration.

### Phase 4.6: Strict Shard Research, Only If Needed

Deliver:

- Decide whether host relay remains enough for public online.
- If not, prototype one narrow server-authoritative system: simple movement/combat actors or a VPS/headless sim harness.
- Do not start this until 8-player host relay has real failure metrics.

Exit:

- Written go/no-go on host relay vs WebRTC vs headless/VPS vs DO strict shards.

### Phase 4.7: Headless Server Foundation, Only If Public 32+ Is The Goal

Deliver:

- Start only if 8-player host relay is not enough, public 32+ becomes an explicit target, or host loss/upstream/sleep makes browser-host rooms unacceptable.
- Define authority mode values: `host_relay`, `webrtc_host`, `headless_server`, `strict_do_shard`.
- Extract the minimum reusable online floor authority contract from the host POC: actor slots, input intents, action application, AOI snapshots, reliable event ring, sparse patch stream and room close reasons.
- Build a headless floor harness with no render, audio, HUD, DOM, pointer-lock, canvas, local save or browser-only APIs.
- Keep floor generation seed-compatible enough for the same `{runSeed, floorKey, z, rulesetVersion}` room identity.
- Run basic server-owned movement, shooting, simple drops, one door class and capped NPC/monster mirrors.
- Worker/Lobby returns `{ endpoint, joinToken, roomKey, authorityMode }` for a headless room.
- Prototype Cloudflare Containers first if the current Cloudflare product limits, pricing and local `wrangler` workflow fit the room harness.
- Keep an external headless endpoint path as the fallback with the same Worker-minted token and same protocol envelope.
- Add room registry heartbeat from headless authority to Worker/DO: region, capacity, active seats, tick p95/p99, outbound bytes/client, build/ruleset, close reason.
- Keep D1 out of the hot loop.

Exit:

- Two browsers connect to the same headless room with no browser host.
- 8 synthetic clients match or exceed host-relay stability.
- 16 and 32 synthetic clients run with measured AOI, CPU and byte budgets.
- Server shutdown, crash or token expiry returns clients to local/degraded play without corrupting offline save.
- Written decision on whether public 32+ proceeds through headless server, stays capped at 8/16, or waits.

### Phase 4.8: 64/128 Server Scale Gates, Only After Phase 4.7

Deliver:

- 32-client real/synthetic soak before any 32 public cap.
- 64-client soak before any public large-shard label.
- 128-client soak before any `до 128 игроков` public claim.
- Sector/bucket AOI ownership if one headless room process cannot hold p99 snapshot age and outbound bytes.
- Degradation policy: lower Hz, drop cosmetics, far-actor compression, queue new joins, then close room before overload.
- Cost model comparing direct server WebSocket, Cloudflare-relayed WebSocket and WebRTC/private rooms.

Exit:

- p99 snapshot age, tick time, outbound bytes/client, reconnect success and crash recovery meet the published cap.
- Public copy names only the cap that passed soak.
- 200+ remains a separate sectorization program unless tested.

### Phase 5: Shared Interactions And Sparse World Patches

Deliver:

- Shared doors.
- One online container class.
- Interaction locks.
- Sparse patch overlay with versioning.
- Patch application bumps local dirty versions.

Exit:

- Two clients see same door/container result.
- Stale patch and stale interaction lock are ignored.
- Offline interaction path unchanged.

### Phase 6: Online Samosbor

Deliver:

- Shard-authoritative samosbor warning/active/aftermath.
- Shelter checks for online players.
- Bounded world mutation patches.
- Economy shock event.

Exit:

- Clients see same samosbor phase.
- No full-world network transfer.
- Local offline samosbor unchanged.

### Phase 7: Online Exchange

Deliver:

- `MarketDO`.
- Exchange D1 tables.
- Online wallet and warehouse.
- Listings, buy, cancel, escrow, claim receipt.
- One-way online-to-local withdrawal.

Exit:

- Soft economy clearly labels client-claimed listings/impulses as relaxed-trust.
- Strict economy, if enabled, does not accidentally duplicate item or rubles on retries.
- D1 writes are batched and indexed.

### Phase 8: Shared PvE And NPCs

Deliver:

- Capped server-authoritative simple monsters.
- Shared monster damage/death.
- Limited NPC terminal/trade actors.
- A-Life online event facts, not full pool simulation.

Exit:

- Hot actor budget remains bounded.
- No per-frame full-world scan.
- Ordinary NPC refill rules remain intact.

### Phase 9: Public Beta And Scale

Deliver:

- Closed test shard.
- Public beta shard.
- Load/chaos tests.
- Status text in Net Sphere.
- Emergency kill switch and versioned DO classes.
- Cost dashboards or budget guard reviewed before raising caps.

Exit:

- 64-player soak passes before public beta cap.
- 128-player queue/soak test passes before any public 128 claim.
- Browser/mobile checks pass.
- Cost/error metrics reviewed.

## 12. Risk Register

| Risk | Severity | Problem | Best solution |
| --- | --- | --- | --- |
| `$10/month` treated as enough for unlimited realtime | Critical | always-on 128-player action floors can exceed budget from WS messages/duration | budget gate, low Hz, caps 2/4/8 first, 16+ only after host-relay soak |
| Player-host treated as scalable infrastructure | Critical | host disconnects, mobile sleep, weak uplink and no persistence break rooms | first POC may freeze/end; later normal leave uses loading checkpoint handoff; do not use as public high-cap backbone |
| Hundreds-player goal planned too late | Critical | host-relay code can bake in player-host assumptions and make server migration expensive | define authority modes early; keep actor/AOI/event/patch protocol reusable by host and headless server |
| Cloudflare DO mistaken for hundreds-player game server | Critical | one DO full sim is single-threaded, cost-sensitive and not a natural full-floor engine host | use DO for relay/queue/ordering/small state; use headless room server for 32/64/128+ hot simulation if needed |
| Cloudflare Container treated as magic VPS | Critical | containers may have startup, pricing, regional or always-hot room constraints that differ from a fixed server | prototype Containers first inside Cloudflare control plane, but keep the same protocol usable by external headless endpoint |
| D1 used for realtime | Critical | query latency, single DB throughput, cost, queue overload | Durable Objects for realtime; D1 only durable summaries/economy |
| One DO overloaded by 128 players | Critical | 128 at high Hz exceeds practical single-object budget | prove 2/4/8 relay first; 32+ needs separate scale architecture |
| Headless server becomes a second game | Critical | duplicated render/UI/save/local systems drift from browser gameplay | server owns only authority loop: seed floor, actor intents, AOI snapshots, events, sparse patches, no render/UI/local save |
| Soft economy accidentally presented as protected scarcity | Critical | players expect fair scarce trade from client-claimed data | label soft economy clearly; strict ledger only for strict features |
| `NET-GEN` treated as password | Critical | visible/recoverable id can be stolen | private `netSecret` + short-lived join token |
| Client/server floor mismatch | High | players see different walls/doors | build id, ruleset version, route seed, floor key and patch version in handshake |
| World patch breaks render/AI caches | High | stale collision/light/fog data | patch API must bump dirty versions exactly like runtime geometry mutations |
| Peer treated as local mini-sim | High | peer AI/projectiles/items/doors diverge from host | peer is mirror/prediction only; host owns dynamic truth |
| Singleton `player` paths reused for peers | High | movement/actions/UI mutate the host local player or open wrong UI | remote actor movement/action functions separate from `movePlayer()` / `playerActions()` |
| AI remains centered on host player only | High | far peer AOI looks dead because nearby mobs are cold | multi-focus AI interest centers: host player + remote actors |
| Remote player not renderable | High | renderer currently skips all `EntityType.PLAYER` sprites | use NPC-like mirror actor first or render all players except local player id |
| PvP fairness overdesigned | High | anti-cheat complexity delays playable online with no product upside | accept cheating; choose authority for UX/reconnect only |
| Mobile WebSocket instability | High | background tab/reconnect pain | reconnect TTL, local degraded continuation, no modal during combat |
| Host handoff becomes a hidden cloud save promise | High | seamless migration and diff replay are too fragile without a mutation journal | later handoff is rare loading-time checkpoint, chunked through DO, aborted during samosbor/combat/oversize cases |
| Cloudflare object pinned to bad region | High | latency for whole shard | choose region before object creation; region in shard key |
| Chat/market cost or moderation abuse | High | spam can harm users or spend budget even if cheating is allowed | sanitization, caps, cooldowns, report/mute, token buckets |
| Online breaks offline | High | violates product baseline | kill switch, separate code path, browser tests with API 503 |
| 128-player claim before tests | High | marketing promise exceeds measured capacity and budget | publish only tested caps; keep 128 as stretch until soak/chaos pass |
| Server memory blowup | High | full `World`/entity arrays exceed isolate | compact overlays and typed slot arrays only |
| Samosbor desync | Medium | clients disagree on hazard/patch | first POC mirrors phase/warnings only or freezes on rebuild; later host/server patch sequence |
| Complex NPC/A-Life scope creep | Medium | impossible first milestone | phase PvE/NPC after PvP/interactions; capped server actors |
| Schema churn | Medium | stale online saves/trades | separate online shape version; reject stale current-shape explicitly |
| Cost surprise | Medium | too many hot shards/messages | metrics, daily budget alarms, soft caps, hibernation when idle |

## 13. Load And Chaos Tests

Required before public 128-player claim:

- 16, 32, 64 and 128 WebSocket clients on one floor for 10 minutes.
- 64 and 128 clients for one hour soak.
- 256 join attempts to test queue/backpressure.
- Hotspot crowd with PvP burst.
- Door/container spam.
- Samosbor phase during full shard.
- Toroidal seam crossing.
- Malformed/cost-stress clients: oversized frames, invalid seq, 100 msg/s spam, reconnect storm.
- Mobile/background tab reconnect.
- D1 unavailable while floor shard is active.
- Worker redeploy mid-session.
- DO restart/hibernation constructor recovery.
- Protocol version mismatch and rollback.

Pass gates:

- p99 shard tick stays under budget.
- no full floor disconnect on deploy/restart.
- no unbounded queue growth.
- no duplicate economy commit.
- offline game remains playable when `/api/online/v1` returns `503`.

## 14. Validation Commands

Docs-only plan:

```bash
git diff --check
```

Future code changes:

```bash
npm run typecheck
npm run test:unit
npm run content:audit
npm run check:readonly
npm run check
```

Browser/render/input changes:

```bash
npm run check:browser
npm run check:full
```

Cloudflare changes:

```bash
npm run cf:setup
npm run cf:schema
npm run cf:dev
npm run cf:deploy
```

Release:

```bash
npm run check:release
```

## 15. Documentation Update Rules

Do not update `README.md` until behavior ships. It documents shipped facts only.

Do update `cloudflare.md` when actual new Worker routes, Durable Object bindings, D1 schema files or setup commands are added.

Do update `architecture.md` only if online introduces a new durable layer contract that implementation actually follows.

Do not add migration promises for local saves. If online save shape breaks, bump separate online shape version and reject stale online saves explicitly.

## 16. Best Decisions

- Do not build anti-cheat. Cheating is accepted because online has no competitive/profit stake.
- Use relaxed-trust/soft online first: clients compute private/presentation work locally, and Cloudflare commits only the shared facts a mode actually needs.
- Use Durable Objects as floor shards, not separate deployed Workers per floor.
- Allow player-host authority for co-op/soft rooms; its limits are uptime, scale and persistence, not trust.
- Use server-authoritative shards only for consistency, reconnect, shared ordering, cost control or strict optional economy.
- Keep offline and online saves separate forever.
- Keep current `/api/net/*` as compatibility/telemetry.
- Use WebSockets only for realtime; keep REST for profile/economy/admin.
- Use JSON-first batched frames for 2/4/8 host-relay POC; use binary frames only after measurements show JSON is the bottleneck.
- Make PvP authority mode explicit: host-authoritative is fine for relaxed rooms; server-authoritative is optional for stricter shards.
- Treat 128 players as a proven scale/cost target, not the first MVP.
- Start caps at 2, then 4, then 8 for host-browser full-sim relay. Treat 16+ as a later experimental branch and 128 as a proven scale/cost target only after soak and budget gates.
- Treat 32+ public rooms and any "сотни игроков" goal as a headless/server-authority track, not as a browser-host cap increase.
- Keep the protocol authority-mode aware from the start so `host_relay` can later become `headless_server` without rewriting actor ids, AOI snapshots, event rings and patch streams.
- Use Cloudflare for identity, lobby, status, budget gates, ambient Net Sphere, queues and small-state relay; do not make D1 or one full-sim DO the hot hundreds-player server.
- Prefer one Cloudflare control plane: existing Net Sphere, Worker/Wrangler, D1, Durable Objects, optional Containers and optional external headless endpoints all hang off `/api/net/*` and `/api/online/*`.
- Try Cloudflare Containers first for a headless room server if current pricing/startup/soak limits fit; keep external headless server as fallback without changing gameplay protocol.
- Start with soft client-claimed economy; add server-minted ledger only if a feature needs protected scarcity.
- Add kill switches and budget gates before public online.

## 17. Sources Checked

Local project sources:

- `README.md`
- `architecture.md`
- `cloudflare.md`
- `wrangler.jsonc`
- `functions/worker.ts`
- `functions/api/net/common.ts`
- `functions/api/net/hello.ts`
- `functions/api/net/stats.ts`
- `functions/api/net/chat.ts`
- `functions/api/net/event.ts`
- `functions/api/net/market.ts`
- `cloudflare/d1/net_sphere.sql`
- `cloudflare/d1/net_sphere_market.sql`
- `src/core/types.ts`
- `src/core/world.ts`
- `src/systems/net_sphere.ts`
- `src/render/net_sphere_ui.ts`
- `src/systems/save_runtime.ts`
- `src/systems/save_payload.ts`
- `src/systems/interactions.ts`
- `src/systems/events.ts`
- `src/systems/floor_memory.ts`
- `src/systems/procedural_floors.ts`
- `src/systems/entity_index.ts`
- `src/systems/stock_market.ts`
- `src/systems/inventory.ts`

Official Cloudflare sources checked on 2026-05-24, with pricing rechecked on 2026-05-25 and Containers/control-plane direction rechecked on 2026-06-02:

- Durable Objects WebSockets and hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Containers overview: https://developers.cloudflare.com/containers/
- Cloudflare Containers product page: https://workers.cloudflare.com/product/containers/
- Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Durable Objects rules: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- D1 Database API: https://developers.cloudflare.com/d1/worker-api/d1-database/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare budget alerts: https://developers.cloudflare.com/billing/manage/budget-alerts/
