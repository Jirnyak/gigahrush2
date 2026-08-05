import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  EntityType,
  FloorLevel,
  type Entity,
} from '../src/core/types';
import { World } from '../src/core/world';
import {
  PERESTANOVSHCHIK_ID,
  generatePerestanovshchik,
} from '../src/gen/void/perestanovshchik';
import {
  createWorldEventState,
  getRecentEvents,
  publishEvent,
} from '../src/systems/events';
import { routeCueCount } from '../src/systems/route_cues';
import { makeGameState } from './helpers';

function generate(): { world: World; entities: Entity[] } {
  const world = new World();
  world.cells[world.idx(512, 512)] = Cell.FLOOR;
  const entities: Entity[] = [];
  generatePerestanovshchik(world, entities, { v: 1 }, 512.5, 512.5);
  return { world, entities };
}

test('Перестановщик generates local paired cells, anchor reward, and side threat', () => {
  const { world, entities } = generate();

  assert.equal(world.anomalyTeleports.size, 4);
  assert.equal(routeCueCount(world), 2);
  assert.ok(world.rooms.some(room => room.name.includes('Перестановщик')));
  assert.ok(entities.some(entity => entity.type === EntityType.MONSTER && entity.name === 'Переставленный жилец'));

  for (const [from, to] of world.anomalyTeleports) {
    assert.equal(world.cells[from], Cell.FLOOR);
    assert.equal(world.cells[to], Cell.FLOOR);
    assert.equal(world.anomalyTeleports.get(to), from);
  }

  const anchor = world.containers.find(container => container.tags.includes(PERESTANOVSHCHIK_ID));
  assert.ok(anchor);
  assert.equal(anchor.tags.includes('anchor_disable'), true);
  assert.equal(anchor.inventory.some(item => item.defId === 'lift_scheme'), true);
  assert.equal(anchor.inventory.some(item => item.defId === 'void_spike'), true);
});

test('anchor container event disables only Перестановщик local teleport pairs', () => {
  const { world } = generate();
  const anchor = world.containers.find(container => container.tags.includes(PERESTANOVSHCHIK_ID));
  assert.ok(anchor);

  const foreignA = world.idx(10, 10);
  const foreignB = world.idx(40, 40);
  world.cells[foreignA] = Cell.FLOOR;
  world.cells[foreignB] = Cell.FLOOR;
  world.anomalyTeleports.set(foreignA, foreignB);
  world.anomalyTeleports.set(foreignB, foreignA);

  const state = makeGameState({
    time: 42,
    currentFloor: FloorLevel.VOID,
    worldEvents: createWorldEventState(),
  });

  publishEvent(state, {
    type: 'container_opened',
    containerId: anchor.id,
    zoneId: anchor.zoneId,
    roomId: anchor.roomId,
    x: anchor.x,
    y: anchor.y,
    actorId: 1,
    actorName: 'Вы',
    itemId: 'void_spike',
    itemName: 'Пустотный шип',
    itemCount: 1,
    itemValue: 1500,
    severity: 1,
    privacy: 'private',
    tags: ['container', 'open', PERESTANOVSHCHIK_ID, 'anchor_disable'],
  });

  assert.equal(world.anomalyTeleports.size, 2);
  assert.equal(world.anomalyTeleports.get(foreignA), foreignB);
  assert.equal(world.anomalyTeleports.get(foreignB), foreignA);
  assert.ok(state.msgs.some(line => line.text.includes('Якорь Перестановщика сорван')));

  const event = getRecentEvents(state, {
    type: 'elevator_loop_exit',
    tags: [PERESTANOVSHCHIK_ID],
    limit: 1,
  })[0];
  assert.ok(event);
  assert.equal(event.data?.outcome, 'anchor_disabled');
  assert.equal(event.tags.includes('monster'), true);
  assert.equal(event.tags.includes('teleport'), true);
  assert.equal(event.tags.includes('route'), true);
});
