import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, FloorLevel, RoomType, W } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEMS } from '../src/data/catalog';
import { resourceForItem } from '../src/data/resources';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { debugForceHermodoorBorer, updateHermodoorBorer } from '../src/systems/hermodoor_borer';
import { activateInteraction } from '../src/systems/interactions';
import { addTestRoom, makeGameState, makeTestPlayer } from './helpers';

test('rubber door wedge is a reachable maintenance tool-resource item', () => {
  const item = ITEMS.rubber_door_wedge;

  assert.ok(item);
  assert.equal(item.id, 'rubber_door_wedge');
  assert.equal(item.name, 'Резиновый клин гермодвери');
  assert.deepEqual(item.spawnRooms, [RoomType.PRODUCTION, RoomType.STORAGE]);
  assert.equal(resourceForItem(item.id)?.id, 'tools');
});

test('rubber door wedge repairs a damaged hermodoor through the E interaction path', () => {
  const world = new World();
  const room = addTestRoom(world, {
    id: 0,
    type: RoomType.LIVING,
    x: 4,
    y: 4,
    w: 8,
    h: 8,
    name: 'Тестовое укрытие',
  });
  const doorIdx = world.idx(6, 4);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: DoorState.HERMETIC_OPEN,
    roomA: room.id,
    roomB: -1,
    keyId: '',
    timer: 0,
  });
  room.doors.push(doorIdx);

  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
    time: 1,
    samosborTimer: 20,
  });
  const player = makeTestPlayer({ id: 1, x: 5.5, y: 4.5, angle: 0 });
  const entities = [player];
  const nextEntityId = { v: 2 };

  const debugLines = debugForceHermodoorBorer(world, player, entities, state, nextEntityId);
  assert.equal(debugLines.some(line => line.includes('target=')), true);

  player.inventory = [{ defId: 'rubber_door_wedge', count: 1 }];
  state.time = 20;
  updateHermodoorBorer(world, entities, state, 9, nextEntityId);
  assert.ok(getRecentEvents(state, { type: 'hermodoor_borer_damage', limit: 1 })[0]);

  state.samosborActive = true;
  const result = activateInteraction({
    world,
    state,
    player,
    entities,
    nextEntityId,
    lookX: doorIdx % W,
    lookY: (doorIdx / W) | 0,
  });

  assert.equal(result.handled, true);
  assert.equal(world.doors.get(doorIdx)?.state, DoorState.HERMETIC_CLOSED);
  assert.deepEqual(player.inventory, []);
  const repaired = getRecentEvents(state, { type: 'hermodoor_borer_repaired', limit: 1 })[0];
  assert.equal(repaired?.data?.itemId, 'rubber_door_wedge');
  assert.equal(repaired?.data?.consumed, true);
});
