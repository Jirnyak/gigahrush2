import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Feature, W } from '../src/core/types';
import { World } from '../src/core/world';
import { nextLifeCell, tryUseConwayLifeAnomaly, updateConwayLifeAnomaly } from '../src/systems/procedural_anomalies/conway_life';
import { addTestRoom, makeGameState, makeTestPlayer } from './helpers';

test('conway life helper applies B3/S23 rules', () => {
  assert.equal(nextLifeCell(false, 3), true);
  assert.equal(nextLifeCell(false, 2), false);
  assert.equal(nextLifeCell(true, 1), false);
  assert.equal(nextLifeCell(true, 2), true);
  assert.equal(nextLifeCell(true, 3), true);
  assert.equal(nextLifeCell(true, 4), false);
});

function countRoomWalls(world: World, roomId: number): number {
  const room = world.rooms[roomId];
  let count = 0;
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const ci = world.idx(x, y);
      if (world.roomMap[ci] === roomId && world.cells[ci] === Cell.WALL) count++;
    }
  }
  return count;
}

test('conway life control freezes and resets an arena without hiding the control', () => {
  const world = new World();
  addTestRoom(world, { id: 0, x: 40, y: 40, w: 16, h: 16, name: 'Игра жизнь: тестовый зал' });
  const controlIdx = world.idx(48, 48);
  world.features[controlIdx] = Feature.APPARATUS;
  for (const [x, y] of [[46, 47], [46, 48], [46, 49], [51, 47], [51, 48], [51, 49]] as const) {
    world.cells[world.idx(x, y)] = Cell.WALL;
  }

  const state = makeGameState({ time: 10 });
  const player = makeTestPlayer({ x: 48.5, y: 47.5, hp: 100 });

  assert.equal(tryUseConwayLifeAnomaly(world, player, state, 48.5, 48.5), true);
  assert.equal(countRoomWalls(world, 0), 0);
  assert.equal(world.features[controlIdx], Feature.APPARATUS);
  assert.equal(world.rooms[0].name.includes('выкл'), true);

  state.time = 12;
  assert.equal(tryUseConwayLifeAnomaly(world, player, state, 48.5, 48.5), true);
  assert.equal(world.rooms[0].name.includes('выкл'), false);
  assert.equal(world.features[controlIdx], Feature.APPARATUS);
  assert.equal(countRoomWalls(world, 0) > 0, true);

  for (let y = 46; y <= 49; y++) {
    for (let x = 47; x <= 50; x++) {
      if (world.dist2(player.x, player.y, x + 0.5, y + 0.5) > 2.25 * 2.25) continue;
      assert.equal(world.cells[world.idx(x, y)], Cell.FLOOR, `player-adjacent reset cell ${x},${y}`);
    }
  }
});

test('conway life world window mutates a bounded noisy field', () => {
  const world = new World();
  for (let y = 4; y < W - 4; y += 8) {
    for (let x = 4; x < W - 4; x += 8) {
      world.cells[world.idx(x, y)] = Cell.WALL;
      world.cells[world.idx(x, y + 1)] = Cell.WALL;
      world.cells[world.idx(x, y + 2)] = Cell.WALL;
    }
  }

  const before = world.cellVersion;
  updateConwayLifeAnomaly(
    world,
    makeTestPlayer({ x: 900.5, y: 900.5, hp: 100 }),
    makeGameState({ time: 0 }),
    1,
  );

  assert.equal(world.cellVersion > before, true);
});
