import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, Feature, FloorLevel, W } from '../src/core/types';
import { World } from '../src/core/world';
import {
  PATH_BLOCKER_ROWS_PER_CELL,
  getPathBlockerRow,
  pathBlockedAt,
} from '../src/core/path_blockers';
import { pathBlockerIdForContainerKind, pathBlockerIdForFeature } from '../src/data/path_blockers';
import { generateFloor, type FloorGeneration } from '../src/gen/floor_manifest';
import { rebuildPathBlockersFromWorldObjects } from '../src/gen/path_blockers';

let cachedMaintenance: FloorGeneration | undefined;

function maintenanceGeneration(): FloorGeneration {
  cachedMaintenance ??= generateFloor(FloorLevel.MAINTENANCE, 0x51002);
  return cachedMaintenance;
}

function cellHasPathBlocker(world: World, cellIdx: number): boolean {
  for (let row = 0; row < PATH_BLOCKER_ROWS_PER_CELL; row++) {
    if (getPathBlockerRow(world, cellIdx, row) !== 0) return true;
  }
  return false;
}

test('path blocker generation stamps non-empty masks for real bulky features and containers', () => {
  const { world } = maintenanceGeneration();
  let mappedFeatures = 0;
  let blockedFeatures = 0;

  for (let idx = 0; idx < world.features.length; idx++) {
    const feature = world.features[idx] as Feature;
    if (!pathBlockerIdForFeature(feature)) continue;
    mappedFeatures++;
    if (cellHasPathBlocker(world, idx)) blockedFeatures++;
  }

  let bulkyContainers = 0;
  let blockedContainers = 0;
  for (const container of world.containers) {
    if (!pathBlockerIdForContainerKind(container.kind)) continue;
    bulkyContainers++;
    if (cellHasPathBlocker(world, world.idx(container.x, container.y))) blockedContainers++;
  }

  assert.equal(mappedFeatures > 0, true, `mapped feature count ${mappedFeatures}`);
  assert.equal(blockedFeatures > 0, true, `blocked feature count ${blockedFeatures}`);
  assert.equal(bulkyContainers > 0, true, `bulky container count ${bulkyContainers}`);
  assert.equal(blockedContainers, bulkyContainers, `blocked bulky containers ${blockedContainers}/${bulkyContainers}`);
});

test('path blocker generation keeps spawn and lift cells clear', () => {
  const { world, spawnX, spawnY } = maintenanceGeneration();
  const spawnIdx = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  let liftCells = 0;
  let blockedLiftCells = 0;
  let liftThresholdCells = 0;
  let blockedLiftThresholdCells = 0;

  assert.equal(cellHasPathBlocker(world, spawnIdx), false, 'spawn cell should not contain a fine blocker');

  for (let idx = 0; idx < world.cells.length; idx++) {
    if (world.cells[idx] !== Cell.LIFT) continue;
    liftCells++;
    if (cellHasPathBlocker(world, idx)) blockedLiftCells++;
    const x = idx % W;
    const y = (idx / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const near = world.idx(x + dx, y + dy);
      if (world.cells[near] !== Cell.FLOOR) continue;
      liftThresholdCells++;
      if (cellHasPathBlocker(world, near)) blockedLiftThresholdCells++;
    }
  }

  assert.equal(liftCells > 0, true, 'maintenance floor should expose lift cells');
  assert.equal(blockedLiftCells, 0, `blocked lift cells ${blockedLiftCells}/${liftCells}`);
  assert.equal(liftThresholdCells > 0, true, 'maintenance floor should expose lift threshold floor cells');
  assert.equal(blockedLiftThresholdCells, 0, `blocked lift threshold cells ${blockedLiftThresholdCells}/${liftThresholdCells}`);
});

test('cell-list rebuild removes stale masks after feature removal', () => {
  const world = new World();
  const idx = world.idx(40, 41);
  world.cells[idx] = Cell.FLOOR;
  world.features[idx] = Feature.TABLE;

  assert.equal(rebuildPathBlockersFromWorldObjects(world, 0x44, [idx]), 1);
  assert.equal(pathBlockedAt(world, 40.5, 41.5), true);

  world.features[idx] = Feature.NONE;
  assert.equal(rebuildPathBlockersFromWorldObjects(world, 0x44, [idx]), 0);
  assert.equal(pathBlockedAt(world, 40.5, 41.5), false);
});
