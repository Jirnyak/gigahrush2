import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, EntityType, Faction, type Entity, type RailTrainTrack } from '../src/core/types';
import { World } from '../src/core/world';
import {
  addRailTrainRoute,
  installRailTrainsFromGeneration,
  isRidingRailTrain,
  snapshotRailTrainsForRebuild,
  tryUseRailTrain,
  updateRailTrains,
} from '../src/systems/rail_trains';
import { makeGameState } from './helpers';

function makeRailWorld(): { world: World; track: RailTrainTrack } {
  const world = new World();
  const cells: number[] = [];
  for (let x = 10; x < 54; x++) {
    const ci = world.idx(x, 20);
    world.cells[ci] = Cell.WATER;
    cells.push(ci);
  }
  const platformCells: number[] = [];
  for (let x = 18; x <= 24; x++) {
    const ci = world.idx(x, 18);
    world.cells[ci] = Cell.FLOOR;
    platformCells.push(ci);
  }
  return {
    world,
    track: {
      id: 'test_line',
      label: 'Тестовая линия',
      cells,
      stationOffsets: [10, 32],
      platformCells,
      loop: true,
    },
  };
}

test('rail train can board at a platform and keeps the passenger on route', () => {
  const { world, track } = makeRailWorld();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  const train = addRailTrainRoute(world, entities, nextId, track, {
    id: 'test_train',
    label: 'Тестовый состав',
    speed: 8,
    length: 5,
    initialOffset: 10,
    stopSeconds: 2,
  });
  assert.ok(train);

  const player: Entity = {
    id: nextId.v++,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 21.5,
    y: 18.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    faction: Faction.PLAYER,
  };
  entities.push(player);
  const state = makeGameState();

  assert.equal(tryUseRailTrain(world, player, state, 20.5, 20.5), true);
  assert.equal(isRidingRailTrain(world, player), true);

  updateRailTrains(world, entities, player, state, 0.1);
  state.time = 3;
  updateRailTrains(world, entities, player, state, 0.5);

  const playerCell = world.idx(Math.floor(player.x), Math.floor(player.y));
  assert.equal(track.cells.includes(playerCell), true);
  assert.equal(train.offset >= 0 && train.offset < track.cells.length, true);
});

test('rail train rebuild install clears stale train cells and exits interrupted passenger to platform', () => {
  const before = makeRailWorld();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  const train = addRailTrainRoute(before.world, entities, nextId, before.track, {
    id: 'test_train',
    label: 'Тестовый состав',
    speed: 8,
    length: 5,
    initialOffset: 10,
    stopSeconds: 2,
  });
  assert.ok(train);

  const player: Entity = {
    id: nextId.v++,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 21.5,
    y: 18.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    hp: 100,
    maxHp: 100,
    faction: Faction.PLAYER,
  };
  entities.push(player);
  const state = makeGameState();

  assert.equal(tryUseRailTrain(before.world, player, state, 20.5, 20.5), true);
  assert.equal(isRidingRailTrain(before.world, player), true);
  const snapshot = snapshotRailTrainsForRebuild(before.world);

  const generated = makeRailWorld();
  const generatedEntities: Entity[] = [];
  const generatedNextId = { v: 100 };
  assert.ok(addRailTrainRoute(generated.world, generatedEntities, generatedNextId, generated.track, {
    id: 'test_train',
    label: 'Тестовый состав',
    speed: 8,
    length: 5,
    initialOffset: 10,
    stopSeconds: 2,
  }));

  const live = makeRailWorld();
  const staleIdx = live.world.idx(900, 900);
  live.world.railTrainCells.set(staleIdx, 99);
  const liveEntities = [player];
  installRailTrainsFromGeneration(live.world, liveEntities, { v: 200 }, generated.world, new Map(), snapshot);

  assert.equal(live.world.railTrainCells.has(staleIdx), false);
  assert.equal(live.world.railTrains.length, 1);
  assert.equal(live.world.railTrains[0].passengerId, -1);
  assert.equal(isRidingRailTrain(live.world, player), false);
  const playerCell = live.world.idx(Math.floor(player.x), Math.floor(player.y));
  assert.equal(live.track.platformCells.includes(playerCell), true);
});
