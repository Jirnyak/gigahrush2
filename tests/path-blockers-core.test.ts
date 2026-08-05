import { test } from 'node:test';
import assert from 'node:assert/strict';

import { W } from '../src/core/types';
import { World } from '../src/core/world';
import {
  EMPTY_PATH_BLOCKER_ROW,
  PATH_BLOCKER_ROWS_PER_CELL,
  clearAllPathBlockers,
  clearPathBlockersAtCell,
  getPathBlockerRow,
  pathBlockedAt,
  pathBlockerRowOffset,
  pathBlockerSubcell,
  setPathBlockerRow,
} from '../src/core/path_blockers';

test('world path blockers are a flat 8-row-per-cell layer', () => {
  const world = new World();
  const cellIdx = 13;

  assert.equal(world.pathBlockers.length, W * W * PATH_BLOCKER_ROWS_PER_CELL);
  assert.equal(pathBlockerRowOffset(cellIdx, 3), cellIdx * PATH_BLOCKER_ROWS_PER_CELL + 3);
  assert.equal(getPathBlockerRow(world, cellIdx, 3), EMPTY_PATH_BLOCKER_ROW);
  assert.throws(() => pathBlockerRowOffset(cellIdx, -1), RangeError);
  assert.throws(() => pathBlockerRowOffset(cellIdx, PATH_BLOCKER_ROWS_PER_CELL), RangeError);
  assert.throws(() => setPathBlockerRow(world, cellIdx, 0, 16), RangeError);
});

test('path blocker row writes bump version only on actual changes', () => {
  const world = new World();
  const cellIdx = world.idx(8, 9);
  const before = world.pathBlockerVersion;

  assert.equal(setPathBlockerRow(world, cellIdx, 3, 0b1000), true);
  assert.equal(world.pathBlockerVersion, before + 1);
  assert.equal(world.pathBlockerDirtyVersion, world.pathBlockerVersion);
  assert.equal(setPathBlockerRow(world, cellIdx, 3, 0b1000), false);
  assert.equal(world.pathBlockerVersion, before + 1);
});

test('clearing all path blockers clears everything and bumps dirty version once', () => {
  const world = new World();

  // Initially, clearing all does nothing
  assert.equal(clearAllPathBlockers(world), false);

  // Set some blockers
  const cellIdx1 = world.idx(2, 3);
  const cellIdx2 = world.idx(15, 10);
  setPathBlockerRow(world, cellIdx1, 1, 0x0f);
  setPathBlockerRow(world, cellIdx2, 3, 0b1000);

  const beforeClear = world.pathBlockerVersion;

  // Clear all
  assert.equal(clearAllPathBlockers(world), true);
  assert.equal(world.pathBlockerVersion, beforeClear + 1);
  assert.equal(world.pathBlockerDirtyVersion, world.pathBlockerVersion);

  // Check that everything is empty
  for (let i = 0; i < world.pathBlockers.length; i++) {
    assert.equal(world.pathBlockers[i], EMPTY_PATH_BLOCKER_ROW);
  }

  // Clearing again does nothing
  assert.equal(clearAllPathBlockers(world), false);
  assert.equal(world.pathBlockerVersion, beforeClear + 1);
});

test('clearing path blockers at one cell clears all rows with one dirty bump', () => {
  const world = new World();
  const cellIdx = world.idx(10, 11);
  setPathBlockerRow(world, cellIdx, 1, 0x0f);
  setPathBlockerRow(world, cellIdx, 2, 0x09);
  const beforeClear = world.pathBlockerVersion;

  assert.equal(clearPathBlockersAtCell(world, cellIdx), true);
  assert.equal(world.pathBlockerVersion, beforeClear + 1);
  for (let row = 0; row < PATH_BLOCKER_ROWS_PER_CELL; row++) {
    assert.equal(getPathBlockerRow(world, cellIdx, row), EMPTY_PATH_BLOCKER_ROW);
  }
  assert.equal(clearPathBlockersAtCell(world, cellIdx), false);
  assert.equal(world.pathBlockerVersion, beforeClear + 1);
});

test('pathBlockedAt maps centers, subcell edges and torus wrapping', () => {
  const world = new World();
  const cellIdx = world.idx(W - 1, W - 1);
  setPathBlockerRow(world, cellIdx, 0, 0b0001);
  setPathBlockerRow(world, cellIdx, 3, 0b1000);

  assert.equal(pathBlockerSubcell(0.249), 0);
  assert.equal(pathBlockerSubcell(0.25), 1);
  assert.equal(pathBlockedAt(world, W - 0.99, W - 0.99), true);
  assert.equal(pathBlockedAt(world, -0.99, -0.99), true);
  assert.equal(pathBlockedAt(world, W - 0.01, W - 0.01), true);
  assert.equal(pathBlockedAt(world, W - 0.5, W - 0.5), false);
});
