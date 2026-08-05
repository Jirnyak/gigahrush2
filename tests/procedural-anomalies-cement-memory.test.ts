import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Feature, FloorLevel, LiftDirection, RoomType } from '../src/core/types';
import { World as WorldImpl, auditReachability, hasReachableAdjacentCell, type ReachabilityAudit, type World } from '../src/core/world';
import {
  makeProceduralFloorSpec,
  type ProceduralFloorSpec,
} from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { tryUseCementMemoryAnomaly, updateCementMemoryAnomaly } from '../src/systems/procedural_anomalies/cement_memory';
import { setCurrentPlayerEntity } from '../src/systems/player_actor';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import { testGenerationMatrix } from './generator_helpers';
import { addTestRoom, makeGameState, makeTestPlayer } from './helpers';

function forcedCementMemorySpec(): ProceduralFloorSpec {
  const base = makeProceduralFloorSpec(60_060, -9);
  return {
    ...base,
    anomalyId: 'cement_memory',
    danger: 4,
    geometryId: 'communal_knots',
    baseFloor: FloorLevel.KVARTIRY,
    majorityId: 'citizens',
    title: 'тестовая цементная память',
  };
}

function hasReachableLift(world: World, audit: ReachabilityAudit, direction: LiftDirection): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return true;
  }
  return false;
}

testGenerationMatrix('cement memory generation adds panels, pressure corridors, cue, and keeps route lifts reachable', () => {
  const gen = generateProceduralFloor(forcedCementMemorySpec());
  const world = gen.world;
  const spawnIdx = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  const audit = auditReachability(world, spawnIdx);

  assert.equal(hasReachableLift(world, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(world, audit, LiftDirection.DOWN), true);
  assert.equal(world.rooms.some(room => room.name.startsWith('Амнезийная зона')), true);
  assert.equal(world.rooms.some(room => room.name.includes('[cement_pressure]')), true);
  assert.equal(world.features.some(feature => feature === Feature.APPARATUS), true);

  const cue = getRouteCueMarkers(world).find(marker => (
    marker.tags.includes('cement_memory') &&
    marker.tags.includes('trail_scar')
  ));
  assert.notEqual(cue, undefined);
  assert.equal(cue!.tags.includes('route_pressure'), true);
  assert.equal(cue!.tags.includes('trail_scar'), true);
  assert.equal(audit.reachable[world.idx(Math.floor(cue!.x), Math.floor(cue!.y))], 1);
  assert.equal(audit.reachable[world.idx(Math.floor(cue!.targetX), Math.floor(cue!.targetY))], 1);
});

test('cement memory runtime uses a fixed recent-cell ring and ages no faster than one second', () => {
  const world = new WorldImpl();
  addTestRoom(world, { id: 1, x: 10, y: 10, w: 260, h: 4, type: RoomType.CORRIDOR, name: 'Тестовый следовой коридор' });
  const state = makeGameState();
  const player = makeTestPlayer({ x: 11.5, y: 11.5, hp: 100 });
  setCurrentPlayerEntity(player);

  try {
    for (let i = 0; i < 210; i++) {
      player.x = 11.5 + i;
      player.y = 11.5;
      state.time = 0;
      updateCementMemoryAnomaly(world, player, state, 0);
    }

    const firstIdx = world.idx(11, 11);
    const recentIdx = world.idx(220, 11);
    state.time = 20;
    updateCementMemoryAnomaly(world, player, state, 0.99);
    assert.equal(world.fog[recentIdx], 0);

    updateCementMemoryAnomaly(world, player, state, 0.02);
    assert.equal(world.fog[firstIdx], 0);
    assert.equal(world.fog[recentIdx] >= 76, true);

    updateCementMemoryAnomaly(world, player, state, 0);
    assert.equal(player.hp, 97);
  } finally {
    setCurrentPlayerEntity(undefined);
  }
});

test('cement memory panel clears local or recent pressure without wiping distant old trails', () => {
  const world = new WorldImpl();
  addTestRoom(world, { id: 1, x: 58, y: 20, w: 10, h: 6, type: RoomType.CORRIDOR, name: 'Ближний след' });
  addTestRoom(world, { id: 2, x: 80, y: 20, w: 8, h: 8, type: RoomType.COMMON, name: 'Амнезийная зона 1: щиток' });
  addTestRoom(world, { id: 3, x: 300, y: 300, w: 8, h: 8, type: RoomType.CORRIDOR, name: 'Дальний след' });
  const panelIdx = world.idx(83, 23);
  world.features[panelIdx] = Feature.APPARATUS;

  const state = makeGameState();
  const player = makeTestPlayer({ x: 62.5, y: 23.5, hp: 100 });
  setCurrentPlayerEntity(player);

  try {
    updateCementMemoryAnomaly(world, player, state, 0);
    player.x = 303.5;
    player.y = 303.5;
    updateCementMemoryAnomaly(world, player, state, 0);

    state.time = 20;
    updateCementMemoryAnomaly(world, player, state, 1);
    const localIdx = world.idx(62, 23);
    const farIdx = world.idx(303, 303);
    assert.equal(world.fog[localIdx] >= 76, true);
    assert.equal(world.fog[farIdx] >= 76, true);

    player.x = 83.5;
    player.y = 23.5;
    state.time = 25;
    assert.equal(tryUseCementMemoryAnomaly(world, player, state, 83.5, 23.5), true);
    assert.equal(world.fog[localIdx], 0);
    assert.equal(world.fog[farIdx] >= 76, true);
  } finally {
    setCurrentPlayerEntity(undefined);
  }
});
