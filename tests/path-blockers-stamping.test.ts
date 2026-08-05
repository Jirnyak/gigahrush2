import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, ContainerKind, Feature, FloorLevel } from '../src/core/types';
import { World } from '../src/core/world';
import {
  PATH_BLOCKER_ROWS_PER_CELL,
  getPathBlockerRow,
  pathBlockedAt,
} from '../src/core/path_blockers';
import type { PathBlockerDef } from '../src/data/path_blockers';
import {
  clearPathBlockerRegion,
  rebuildPathBlockersFromWorldObjects,
  stampPathBlocker,
  stampPathBlockerDef,
} from '../src/gen/path_blockers';

const RECT_TEST_DEF: PathBlockerDef = {
  id: 'test_rect_blocker',
  tags: ['test'],
  inflateForHuman: false,
  shapes: [{ kind: 'rect', cx: 0.5, cy: 0.5, w: 0.5, h: 0.25 }],
};

const CIRCLE_TEST_DEF: PathBlockerDef = {
  id: 'test_circle_blocker',
  tags: ['test'],
  inflateForHuman: false,
  shapes: [{ kind: 'circle', cx: 0.5, cy: 0.5, r: 0.24 }],
};

function floorWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function rows(world: World, cellIdx: number): number[] {
  const out: number[] = [];
  for (let row = 0; row < PATH_BLOCKER_ROWS_PER_CELL; row++) {
    out.push(getPathBlockerRow(world, cellIdx, row));
  }
  return out;
}

test('rectangle blocker stamping produces expected 8x8 row masks', () => {
  const world = floorWorld();
  const cellIdx = world.idx(30, 30);

  assert.equal(stampPathBlockerDef(world, cellIdx, RECT_TEST_DEF), true);
  assert.deepEqual(rows(world, cellIdx), [
    0b0000,
    0b0110,
    0b0110,
    0b0000,
  ]);
});

test('circle blocker stamping stays symmetrical at 8x8 resolution', () => {
  const world = floorWorld();
  const cellIdx = world.idx(31, 30);

  assert.equal(stampPathBlockerDef(world, cellIdx, CIRCLE_TEST_DEF), true);
  const maskRows = rows(world, cellIdx);

  assert.deepEqual(maskRows, maskRows.slice().reverse(), 'centered circle should mirror across rows');
  assert.equal(maskRows.some(mask => mask !== 0), true);
  for (const mask of maskRows) {
    const reversed = parseInt(mask.toString(2).padStart(4, '0').split('').reverse().join(''), 2);
    assert.equal(mask, reversed, `row mask ${mask.toString(2)} should mirror across columns`);
  }
});

test('blocker stamping skips cells that are already hard topology', () => {
  const world = new World();
  const wallIdx = world.idx(32, 30);
  const before = world.pathBlockerVersion;

  assert.equal(world.cells[wallIdx], Cell.WALL);
  assert.equal(stampPathBlockerDef(world, wallIdx, RECT_TEST_DEF), false);
  assert.equal(world.pathBlockerVersion, before);
  assert.deepEqual(rows(world, wallIdx), new Array(PATH_BLOCKER_ROWS_PER_CELL).fill(0));
});

test('unknown blocker ids fail clearly', () => {
  const world = floorWorld();
  assert.throws(() => stampPathBlocker(world, world.idx(33, 30), 'missing_blocker'), /unknown path blocker def/);
});

test('blocker clearing a region removes masks and bumps version only when data changed', () => {
  const world = floorWorld();
  const cellIdx = world.idx(34, 30);
  stampPathBlockerDef(world, cellIdx, RECT_TEST_DEF);
  const afterStamp = world.pathBlockerVersion;

  assert.equal(clearPathBlockerRegion(world, 34, 30, 1, 1), 1);
  assert.equal(world.pathBlockerVersion > afterStamp, true);
  assert.deepEqual(rows(world, cellIdx), new Array(PATH_BLOCKER_ROWS_PER_CELL).fill(0));

  const afterClear = world.pathBlockerVersion;
  assert.equal(clearPathBlockerRegion(world, 34, 30, 1, 1), 0);
  assert.equal(world.pathBlockerVersion, afterClear);
});

test('rebuild stamps feature and bulky container blockers without reading visual slots', () => {
  const world = floorWorld();
  const tableIdx = world.idx(35, 30);
  const cabinetIdx = world.idx(36, 30);
  const cashboxIdx = world.idx(37, 30);
  world.features[tableIdx] = Feature.TABLE;
  world.addContainer({
    id: 1,
    x: 36,
    y: 30,
    floor: FloorLevel.LIVING,
    roomId: -1,
    zoneId: 0,
    kind: ContainerKind.METAL_CABINET,
    name: 'Шкаф',
    inventory: [],
    capacitySlots: 8,
    access: 'public',
    discovered: true,
    tags: [],
  });
  world.addContainer({
    id: 2,
    x: 37,
    y: 30,
    floor: FloorLevel.LIVING,
    roomId: -1,
    zoneId: 0,
    kind: ContainerKind.CASHBOX,
    name: 'Касса',
    inventory: [],
    capacitySlots: 4,
    access: 'public',
    discovered: true,
    tags: [],
  });

  assert.equal(rebuildPathBlockersFromWorldObjects(world, 0, [tableIdx, cabinetIdx, cashboxIdx]), 2);
  assert.equal(pathBlockedAt(world, 35.5, 30.5), true);
  assert.equal(pathBlockedAt(world, 36.5, 30.5), true);
  assert.equal(pathBlockedAt(world, 37.5, 30.5), false);
});
