import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Faction, FloorLevel, RoomType } from '../src/core/types';
import { World } from '../src/core/world';
import { buildContextSnapshot } from '../src/systems/context';
import {
  createWorldEventState,
  getRecentContextFacts,
  publishEvent,
} from '../src/systems/events';
import { getRecentRumorLead } from '../src/systems/npc_memory';
import {
  ROOM_MEMORY_BITS,
  clearRoomMemory,
  getRoomMemory,
  roomMemoryHas,
} from '../src/systems/room_memory';
import { observeRecentRumorEventsForNpc, selectRumorForNpc } from '../src/systems/rumor';
import { addTestRoom, makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

test('player consequence events leave room memory residue bits', () => {
  clearRoomMemory();
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });

  publishEvent(state, {
    type: 'item_deposited',
    roomId: 11,
    actorId: 0,
    actorFaction: Faction.PLAYER,
    severity: 3,
    privacy: 'local',
    tags: ['resident_relief', 'relief'],
  });
  publishEvent(state, {
    type: 'item_deposited',
    roomId: 12,
    actorId: 0,
    actorFaction: Faction.PLAYER,
    severity: 3,
    privacy: 'local',
    tags: ['evidence', 'report'],
  });
  publishEvent(state, {
    type: 'hermodoor_borer_repaired',
    roomId: 13,
    actorId: 0,
    actorFaction: Faction.PLAYER,
    severity: 2,
    privacy: 'local',
    tags: ['repair'],
  });
  publishEvent(state, {
    type: 'shelter_tally_handled',
    roomId: 14,
    actorId: 0,
    actorFaction: Faction.PLAYER,
    severity: 3,
    privacy: 'local',
    tags: ['shelter_choice', 'samosbor'],
  });

  assert.equal(roomMemoryHas(getRoomMemory(FloorLevel.LIVING, 11), ROOM_MEMORY_BITS.HELP), true);
  assert.equal(roomMemoryHas(getRoomMemory(FloorLevel.LIVING, 12), ROOM_MEMORY_BITS.INFORM), true);
  assert.equal(roomMemoryHas(getRoomMemory(FloorLevel.LIVING, 13), ROOM_MEMORY_BITS.REPAIR), true);
  assert.equal(roomMemoryHas(getRoomMemory(FloorLevel.LIVING, 14), ROOM_MEMORY_BITS.SAMOSBOR), true);
});

test('witnessed theft becomes context fact, room memory, and rumor lead', () => {
  clearRoomMemory();
  const now = 4_000;
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    time: now,
    worldEvents: createWorldEventState(),
  });
  state.worldEvents!.nextId = 20_000;
  const world = new World();
  addTestRoom(world, {
    id: 7,
    type: RoomType.STORAGE,
    x: 20,
    y: 20,
    w: 6,
    h: 6,
    name: 'Склад пайков',
    zoneId: 2,
  });
  const player = makeTestPlayer({ id: 0, x: 22, y: 22 });
  const npc = makeTestNpc({ id: 50501, x: 22.5, y: 22.5, name: 'Соседка' });

  publishEvent(state, {
    type: 'item_stolen',
    roomId: 7,
    zoneId: 2,
    actorId: player.id,
    actorName: player.name,
    actorFaction: Faction.PLAYER,
    itemId: 'water',
    itemName: 'Вода',
    containerId: 91,
    severity: 4,
    privacy: 'witnessed',
    tags: ['container', 'theft', 'witnessed'],
    data: { containerName: 'Общий ящик' },
  });

  const memory = getRoomMemory(FloorLevel.LIVING, 7);
  assert.ok(memory);
  assert.equal(roomMemoryHas(memory, ROOM_MEMORY_BITS.THEFT), true);

  const facts = getRecentContextFacts(state, { kind: 'theft', now, limit: 1 });
  assert.equal(facts.length, 1);
  assert.equal(facts[0].roomId, 7);
  assert.equal(facts[0].itemId, 'water');
  assert.equal(facts[0].tags.includes('residue_moved_loot'), true);

  const snapshot = buildContextSnapshot(npc, { world, state, player, time: now });
  assert.equal(snapshot.hasRoomMemoryTheft, true);
  assert.equal(snapshot.hasRecentPlayerTheft, true);
  assert.equal(observeRecentRumorEventsForNpc(npc, snapshot, now), 1);

  const line = selectRumorForNpc(npc, snapshot, now);
  assert.ok(line);
  assert.match(line, /Жилая зона|Склад пайков|вода/i);
});

test('rare trade event becomes a concrete rumor lead', () => {
  const now = 6_000;
  const state = makeGameState({
    currentFloor: FloorLevel.KVARTIRY,
    time: now,
    worldEvents: createWorldEventState(),
  });
  state.worldEvents!.nextId = 30_000;
  const player = makeTestPlayer({ id: 0, name: 'Игрок' });
  const npc = makeTestNpc({ id: 50502, name: 'Меняла' });
  const snapshot = buildContextSnapshot(npc, { state, player, time: now });

  publishEvent(state, {
    type: 'player_sell_item',
    actorId: player.id,
    actorName: player.name,
    actorFaction: Faction.PLAYER,
    targetId: npc.id,
    targetName: npc.name,
    itemId: 'slime_sample_silver',
    itemName: 'Серебряная слизь',
    severity: 3,
    privacy: 'public',
    tags: ['trade', 'silver_slime'],
    data: { rumorIds: ['silver_slime_sale_suspicion'] },
  });

  assert.equal(observeRecentRumorEventsForNpc(npc, snapshot, now), 1);
  const line = selectRumorForNpc(npc, snapshot, now);
  assert.ok(line);
  assert.match(line, /прозрач|слиз/i);
  assert.equal(getRecentRumorLead(now)?.itemId, 'slime_sample_silver');
});
