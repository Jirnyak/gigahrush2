import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, FloorLevel, W, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { SIDE_QUESTS } from '../src/data/plot';
import { generatePressovik } from '../src/gen/maintenance/pressovik';
import { getCellHazardMoveMultiplier } from '../src/systems/cell_hazards';
import { getRecentEvents, publishEvent } from '../src/systems/events';
import { makeGameState } from './helpers';

function playerAt(x: number, y: number): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    name: 'Вы',
  };
}

test('Pressovik registers a stop quest with timing and production hooks', () => {
  const quest = SIDE_QUESTS.find(q => q.id === 'pressovik_manual_stop');
  assert.ok(quest, 'missing pressovik stop quest');
  assert.equal(quest.giverNpcId, 'pressovik_stop_master');
  assert.equal(quest.eventTags?.includes('pressovik'), true);
  assert.equal(quest.eventTags?.includes('timing'), true);
  assert.equal(quest.eventTags?.includes('production'), true);
});

test('Pressovik generation places readable lanes, rewards, monsters, and a stoppable hazard', () => {
  const world = new World();
  const entities: Entity[] = [];
  generatePressovik({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const line = world.rooms.find(room => room.name.includes('Прессовик: брикетная линия'));
  assert.ok(line, 'missing pressovik line room');
  assert.ok(world.rooms.some(room => room.name.includes('сервисный обход')), 'missing service bypass');
  assert.ok(entities.some(e => e.type === EntityType.NPC && e.plotNpcId === 'pressovik_stop_master'), 'missing stop NPC');
  assert.ok(entities.some(e => e.type === EntityType.MONSTER), 'missing pressure monsters');

  const stop = world.containers.find(c => c.tags.includes('pressovik_stop'));
  const output = world.containers.find(c => c.tags.includes('pressovik_output'));
  assert.ok(stop, 'missing stop container');
  assert.ok(output, 'missing output container');
  assert.ok(output.inventory.some(item => item.defId === 'metal_sheet'), 'output lacks metal trace');

  let hazardCell = -1;
  for (let y = line.y; y < line.y + line.h && hazardCell < 0; y++) {
    for (let x = line.x; x < line.x + line.w; x++) {
      const actor = playerAt(x, y);
      if (getCellHazardMoveMultiplier(world, actor) < 1) {
        hazardCell = world.idx(x, y);
        break;
      }
    }
  }
  assert.notEqual(hazardCell, -1, 'press lanes should register a cell hazard');

  const hx = hazardCell % W;
  const hy = (hazardCell / W) | 0;
  assert.ok(getCellHazardMoveMultiplier(world, playerAt(hx, hy)) < 1, 'hazard should slow before stop');

  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 30 });
  publishEvent(state, {
    type: 'item_deposited',
    zoneId: stop.zoneId,
    roomId: stop.roomId,
    x: stop.x,
    y: stop.y,
    actorId: 1,
    actorName: 'Вы',
    itemId: 'gear',
    itemName: 'Шестерня',
    itemCount: 1,
    severity: 3,
    privacy: 'private',
    tags: ['container', 'deposit', ...stop.tags],
  });

  assert.equal(getCellHazardMoveMultiplier(world, playerAt(hx, hy)), 1, 'stop action should clear unsafe lanes');
  const stopped = getRecentEvents(state, { type: 'room_blocked_production', limit: 1 })[0];
  assert.ok(stopped, 'missing pressovik stopped event');
  assert.equal(stopped.tags.includes('pressovik'), true);
  assert.equal(stopped.tags.includes('stopped'), true);
});
