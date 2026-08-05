import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { World } from '../src/core/world';
import { cleanSurfaceArea } from '../src/systems/surface_cleanup';

test('cleanSurfaceArea basics', () => {
  const world = new World();
  const cx = 10;
  const cy = 10;
  const radiusCells = 2;
  const ci = world.idx(cx, cy);

  // Danger field test
  world.dangerField[ci] = 100;

  // Cell surface Map test
  const cell = new Uint8Array(16 * 16 * 4);
  const px = 5, py = 5;
  const ai = ((py * 16 + px) << 2) + 3;
  cell[ai] = 200; // Alpha channel = 200
  world.surfaceMap.set(ci, cell);

  const removed = cleanSurfaceArea(world, cx, cy, radiusCells);

  assert.equal(world.dangerField[ci], 50, 'dangerField should decrease by 50');

  // A = 200, dec = Math.max(24, Math.floor(200 * 0.45)) = Math.max(24, 90) = 90
  // na = max(0, 200 - 90) = 110
  // removed = 200 - 110 = 90
  assert.equal(cell[ai], 110, 'alpha channel should decrease');
  assert.equal(removed, 90, 'removed should equal total decreased amount');
});

test('cleanSurfaceArea should clean multiple pixels and cells', () => {
  const world = new World();
  const cx = 10;
  const cy = 10;
  const radiusCells = 2;

  const ci1 = world.idx(10, 10);
  const cell1 = new Uint8Array(16 * 16 * 4);
  const px1 = 0, py1 = 0;
  const ai1 = ((py1 * 16 + px1) << 2) + 3;
  cell1[ai1] = 200;
  world.surfaceMap.set(ci1, cell1);

  const ci2 = world.idx(11, 10);
  const cell2 = new Uint8Array(16 * 16 * 4);
  const px2 = 1, py2 = 1;
  const ai2 = ((py2 * 16 + px2) << 2) + 3;
  cell2[ai2] = 200;
  world.surfaceMap.set(ci2, cell2);

  const removed = cleanSurfaceArea(world, cx, cy, radiusCells);

  assert.equal(cell1[ai1], 110);
  assert.equal(cell2[ai2], 110);
  assert.equal(removed, 180);
});

test('cleanSurfaceArea options shouldCleanCell is respected', () => {
  const world = new World();
  const cx = 10;
  const cy = 10;
  const radiusCells = 2;

  const ci1 = world.idx(10, 10);
  const cell1 = new Uint8Array(16 * 16 * 4);
  const px1 = 0, py1 = 0;
  const ai1 = ((py1 * 16 + px1) << 2) + 3;
  cell1[ai1] = 200;
  world.surfaceMap.set(ci1, cell1);
  world.dangerField[ci1] = 100;

  const ci2 = world.idx(11, 10);
  const cell2 = new Uint8Array(16 * 16 * 4);
  const px2 = 1, py2 = 1;
  const ai2 = ((py2 * 16 + px2) << 2) + 3;
  cell2[ai2] = 200;
  world.surfaceMap.set(ci2, cell2);
  world.dangerField[ci2] = 100;

  const removed = cleanSurfaceArea(world, cx, cy, radiusCells, {
    shouldCleanCell: (idx: number) => idx === ci1 // Only clean ci1
  });

  assert.equal(cell1[ai1], 110);
  assert.equal(world.dangerField[ci1], 50);

  // ci2 should not be cleaned
  assert.equal(cell2[ai2], 200);
  assert.equal(world.dangerField[ci2], 100);
  assert.equal(removed, 90);
});

test('cleanSurfaceArea minimum dec is respected', () => {
  const world = new World();
  const cx = 10;
  const cy = 10;
  const radiusCells = 2;
  const ci = world.idx(cx, cy);

  // Cell surface Map test
  const cell = new Uint8Array(16 * 16 * 4);
  const px = 5, py = 5;
  const ai = ((py * 16 + px) << 2) + 3;
  cell[ai] = 30; // Alpha channel = 30
  world.surfaceMap.set(ci, cell);

  const removed = cleanSurfaceArea(world, cx, cy, radiusCells);

  // A = 30, dec = Math.max(24, Math.floor(30 * 0.45)) = Math.max(24, 13) = 24
  // na = max(0, 30 - 24) = 6
  // removed = 30 - 6 = 24
  assert.equal(cell[ai], 6, 'alpha channel should decrease');
  assert.equal(removed, 24, 'removed should equal total decreased amount');
});

test('cleanSurfaceArea distances outside radius are ignored', () => {
  const world = new World();
  const cx = 10;
  const cy = 10;
  const radiusCells = 1;
  const ci = world.idx(12, 10); // 2 cells away, should be > radiusCells

  const cell = new Uint8Array(16 * 16 * 4);
  const px = 5, py = 5;
  const ai = ((py * 16 + px) << 2) + 3;
  cell[ai] = 200;
  world.surfaceMap.set(ci, cell);

  const removed = cleanSurfaceArea(world, cx, cy, radiusCells);

  assert.equal(cell[ai], 200, 'cell outside radius should not be cleaned');
  assert.equal(removed, 0);
});
