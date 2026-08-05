import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, EntityType, FloorLevel, MonsterKind, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import {
  GOLOS_BACK_ROOM_NAME,
  GOLOS_CONTENT_TAG,
  GOLOS_MARK_QUEST,
  GOLOS_ROOM_NAME,
  generateGolosZaDveryu,
} from '../src/gen/living/golos_za_dveryu';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import { makeGameState } from './helpers';

test('Golos Za Dveryu generates one marked sealed threshold with one bounded Nelyud', () => {
  const world = new World();
  world.cells.fill(Cell.WALL);
  const entities: Entity[] = [];

  const result = generateGolosZaDveryu(world, 0, entities, { v: 1 }, 120, 120);
  const front = world.rooms.find(room => room.name === GOLOS_ROOM_NAME);
  const back = world.rooms.find(room => room.name === GOLOS_BACK_ROOM_NAME);

  assert.equal(result.nextRoomId, 2);
  assert.ok(front);
  assert.ok(back);

  const lureDoorIdx = front.doors.find(idx => world.doors.get(idx)?.roomB === back.id);
  assert.equal(lureDoorIdx !== undefined, true);
  assert.equal(world.doors.get(lureDoorIdx!)?.state, DoorState.HERMETIC_CLOSED);
  assert.equal(world.solid(lureDoorIdx! % 1024, (lureDoorIdx! / 1024) | 0), true);

  const monsters = entities.filter(e => e.type === EntityType.MONSTER);
  assert.equal(monsters.length, 1);
  assert.equal(monsters[0].monsterKind, MonsterKind.NELYUD);
  assert.equal(monsters[0].name, 'Голос За Дверью');
  assert.equal(world.roomAt(monsters[0].x, monsters[0].y)?.id, back.id);

  const voiceTrace = world.containers.find(container => container.tags.includes(GOLOS_CONTENT_TAG));
  assert.ok(voiceTrace);
  assert.equal(voiceTrace.inventory.some(item => item.defId === 'bottled_voice'), true);
  assert.equal(voiceTrace.inventory.some(item => item.defId === 'siren_shard'), true);
  assert.equal(world.aptMask[world.idx(front.x + 1, front.y + 1)], 1);
});

test('Golos Za Dveryu quest outcomes publish door-lure rumor events', () => {
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });

  publishEvent(state, {
    type: 'quest_completed',
    severity: 4,
    privacy: 'local',
    tags: ['quest', 'completed', GOLOS_CONTENT_TAG],
    data: { sideQuestId: GOLOS_MARK_QUEST },
  });

  const event = getRecentEvents(state, { tags: ['door_lure'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.type, 'door_sealed');
  assert.equal(event.tags.includes('monster'), true);
  assert.equal(event.tags.includes('samosbor_aftermath'), true);
  assert.equal(event.data?.outcome, 'marked');
  assert.equal(Array.isArray(event.data?.rumorIds), true);
});
