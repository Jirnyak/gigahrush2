import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { World } from '../src/core/world';
import { summarizeProceduralSmog } from '../src/systems/procedural_anomalies';
import { makeGameState } from './helpers';
import { setFloorRunState } from '../src/systems/procedural_floors';
import { FloorLevel } from '../src/core/types';
import { PROCEDURAL_FLOOR_ZS, proceduralFloorKey } from '../src/data/procedural_floors';

const testZ = PROCEDURAL_FLOOR_ZS[0]; // use an actual procedural Z
const testKey = proceduralFloorKey(testZ);

test('summarizeProceduralSmog ignores non-smog anomaly', () => {
  const world = new World();
  const state = makeGameState();
  setFloorRunState(state, { currentZ: testZ, specs: { [testKey]: { key: testKey, z: testZ, ordinal: 1, seed: 1, depth: Math.abs(testZ), danger: 1, geometryId: 'living_blocks', baseFloor: FloorLevel.LIVING, majorityId: 'citizens', anomalyId: 'none', title: 'none' } } }, FloorLevel.LIVING);

  assert.deepEqual(summarizeProceduralSmog(world, state), []);
});

test('summarizeProceduralSmog handles smog active but ungenerated source', () => {
  const world = new World();
  world.anomalySmogSource = -1;
  const state = makeGameState();
  setFloorRunState(state, { currentZ: testZ, specs: { [testKey]: { key: testKey, z: testZ, ordinal: 1, seed: 1, depth: Math.abs(testZ), danger: 1, geometryId: 'living_blocks', baseFloor: FloorLevel.LIVING, majorityId: 'citizens', anomalyId: 'smog', title: 'smog' } } }, FloorLevel.LIVING);

  assert.deepEqual(summarizeProceduralSmog(world, state), ['smog: spec active, source not generated']);
});

test('summarizeProceduralSmog summarizes active smog correctly', () => {
  const world = new World();
  world.anomalySmogSource = world.idx(10, 5);
  world.roomMap[world.anomalySmogSource] = 42;
  world.anomalySmogCells = [world.idx(10, 5), world.idx(11, 5)];
  world.anomalySmogHandled = false;
  const state = makeGameState();
  setFloorRunState(state, { currentZ: testZ, specs: { [testKey]: { key: testKey, z: testZ, ordinal: 1, seed: 1, depth: Math.abs(testZ), danger: 1, geometryId: 'living_blocks', baseFloor: FloorLevel.LIVING, majorityId: 'citizens', anomalyId: 'smog', title: 'smog' } } }, FloorLevel.LIVING);

  const expected = [
    'smog: active source=10,5 room=42 cells=2',
    'smog choices: filter, wet cloth, reroute, or E on source with wrench/valve/vacuum'
  ];

  assert.deepEqual(summarizeProceduralSmog(world, state), expected);
});

test('summarizeProceduralSmog summarizes handled smog correctly', () => {
  const world = new World();
  world.anomalySmogSource = world.idx(15, 20);
  world.roomMap[world.anomalySmogSource] = 7;
  world.anomalySmogCells = [world.idx(15, 20)];
  world.anomalySmogHandled = true;
  const state = makeGameState();
  setFloorRunState(state, { currentZ: testZ, specs: { [testKey]: { key: testKey, z: testZ, ordinal: 1, seed: 1, depth: Math.abs(testZ), danger: 1, geometryId: 'living_blocks', baseFloor: FloorLevel.LIVING, majorityId: 'citizens', anomalyId: 'smog', title: 'smog' } } }, FloorLevel.LIVING);

  const expected = [
    'smog: handled source=15,20 room=7 cells=1',
    'smog choices: filter, wet cloth, reroute, or E on source with wrench/valve/vacuum'
  ];

  assert.deepEqual(summarizeProceduralSmog(world, state), expected);
});
