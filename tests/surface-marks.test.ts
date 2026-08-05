import test from 'node:test';
import assert from 'node:assert/strict';
import { Cell } from '../src/core/types';
import { World } from '../src/core/world';
import { getBlackHandMarkCells, stampBlackHandMark, stampBlackHandTrail } from '../src/systems/surface_marks';

test('stampBlackHandMark works on floor cells', () => {
  const world = new World();
  world.set(10, 10, Cell.FLOOR);

  stampBlackHandMark(world, 10, 10, 12345);

  const cells = getBlackHandMarkCells(world);
  assert.equal(cells.length, 1, 'Should record one mark cell');
  assert.equal(cells[0].x, 10);
  assert.equal(cells[0].y, 10);
});

test('stampBlackHandMark fails on invalid cell type', () => {
  const world = new World();
  world.set(10, 10, Cell.ABYSS); // Assuming Cell.ABYSS is not in canStampBlackHandCell (which is floor, door, water, wall)

  stampBlackHandMark(world, 10, 10, 12345);

  const cells = getBlackHandMarkCells(world);
  assert.equal(cells.length, 0, 'Should not record any mark cell');
});

test('stampBlackHandMark respects the 48-cell cap', () => {
  const world = new World();
  for (let i = 0; i < 50; i++) {
    world.set(10 + i, 10, Cell.FLOOR);
  }

  for (let i = 0; i < 50; i++) {
    stampBlackHandMark(world, 10 + i, 10, 12345);
  }

  const cells = getBlackHandMarkCells(world);
  assert.equal(cells.length, 48, 'Should cap recorded marks at 48');
});

test('stampBlackHandTrail places marks up to the limit', () => {
  const world = new World();
  const trailCells: {x: number, y: number}[] = [];

  for (let i = 0; i < 15; i++) {
    world.set(20 + i, 20, Cell.FLOOR);
    trailCells.push({x: 20 + i, y: 20});
  }

  stampBlackHandTrail(world, trailCells, 12345);

  const cells = getBlackHandMarkCells(world);
  assert.equal(cells.length, 12, 'Should record 12 mark cells from the trail');
});

test('stampBlackHandMark updates the surface version and pending dirty cells', () => {
  const world = new World();
  world.set(30, 30, Cell.FLOOR);
  const initialVersion = world.surfaceVersion;
  world.clearPendingSurfaceDirtyCells();

  stampBlackHandMark(world, 30, 30, 12345);

  assert.ok(world.surfaceVersion > initialVersion, 'Should increment surfaceVersion');
  const dirty = world.pendingSurfaceDirtyCells();
  assert.ok(dirty && dirty.length > 0, 'Should mark cells dirty');
  assert.ok(dirty?.includes(world.idx(30, 30)), 'Should mark the stamped cell dirty');
});
