import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, FloorLevel, RoomType, W } from '../src/core/types';
import { World } from '../src/core/world';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { debugForceHermodoorBorer, updateHermodoorBorer } from '../src/systems/hermodoor_borer';
import { addTestRoom, makeGameState, makeTestPlayer } from './helpers';

function setupBorerWorld() {
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
    msgs: [],
  });
  const player = makeTestPlayer({ id: 1, x: 5.5, y: 4.5, angle: 0 });
  const entities = [player];
  const nextEntityId = { v: 2 };

  debugForceHermodoorBorer(world, player, entities, state, nextEntityId);

  return { world, state, player, entities, nextEntityId, doorIdx };
}

test('resolves active borer if monster is killed during warning phase', () => {
  const { world, state, entities, nextEntityId } = setupBorerWorld();

  const monster = entities.find(e => e.id !== 1);
  assert.ok(monster, 'Monster should have been spawned');
  monster!.alive = false;

  updateHermodoorBorer(world, entities, state, 1, nextEntityId);

  const foundMsg = state.msgs.some(m => m.text === 'Гермоточильщик убит до поломки. Дверь держит.');
  assert.ok(foundMsg, 'Should push success message when monster is killed before damage');
});

test('damages door when time passes damage threshold', () => {
  const { world, state, entities, nextEntityId } = setupBorerWorld();

  state.time = 20; // 1 + debug damage delay (9s) = 10s. So 20s is well past it.
  updateHermodoorBorer(world, entities, state, 1, nextEntityId);

  const damageEvents = getRecentEvents(state, { type: 'hermodoor_borer_damage' });
  assert.equal(damageEvents.length, 1, 'Should emit damage event when time passes threshold');

  const foundMsg = state.msgs.some(m => m.text.includes('Гермоточильщик испортил'));
  assert.ok(foundMsg, 'Should push damage message');
});

test('clears stale records on floor change', () => {
  const { world, state, entities, nextEntityId } = setupBorerWorld();

  state.currentFloor = FloorLevel.HELL;
  state.time = 20;

  updateHermodoorBorer(world, entities, state, 1, nextEntityId);

  const damageEvents = getRecentEvents(state, { type: 'hermodoor_borer_damage' });
  assert.equal(damageEvents.length, 0, 'Should not emit damage event if floor changed');
});

test('applies trap counterplay if door is closed while monster is near', () => {
  const { world, state, entities, nextEntityId, doorIdx } = setupBorerWorld();

  const monster = entities.find(e => e.id !== 1);
  assert.ok(monster, 'Monster should have been spawned');

  const doorX = doorIdx % W;
  const doorY = (doorIdx / W) | 0;

  monster!.x = doorX + 0.5;
  monster!.y = doorY + 0.5;

  const door = world.doors.get(doorIdx);
  assert.ok(door, 'Door should exist');
  door!.state = DoorState.HERMETIC_CLOSED;

  state.time = 15;
  updateHermodoorBorer(world, entities, state, 1, nextEntityId);

  const foundMsg = state.msgs.some(m => m.text.includes('Гермодверь прищемила точильщика. Он скребёт медленнее.'));
  assert.ok(foundMsg, 'Should push trap message when monster is near closed door');
  assert.ok((monster!.hp ?? 0) < 100, 'Monster should have taken damage'); // Initially has some HP, reduced by 12.
});
