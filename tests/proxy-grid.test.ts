import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Feature, W } from '../src/core/types';
import { World } from '../src/core/world';
import {
  createProxyGrid,
  createProxyMask,
  extractProxyDescriptors,
  fillProxyGridDeterministic,
  proxyIndex,
  proxySample01,
  proxyToWorldRect,
  sampleProxyCells,
  stampProxyCell,
  worldToProxy,
} from '../src/gen/proxy_grid';

test('proxy grid conversion wraps between coarse cells and world cells', () => {
  const grid = createProxyGrid(16, 123);

  assert.deepEqual(proxyToWorldRect(grid, -1, -1), { x: 960, y: 960, w: 64, h: 64 });

  const coord = worldToProxy(grid, W + 1, -1);
  assert.equal(coord.x, 0);
  assert.equal(coord.y, 15);
  assert.equal(coord.index, 15 * 16);
  assert.equal(coord.worldX, 1);
  assert.equal(coord.worldY, W - 1);
  assert.equal(coord.localX, 1);
  assert.equal(coord.localY, 63);
});

test('proxy raster stamping respects proxy and world protected masks', () => {
  const world = new World();
  const grid = createProxyGrid(16, 456);
  const proxyMask = createProxyMask(grid);
  proxyMask[proxyIndex(grid, -1, -1)] = 1;

  const blocked = stampProxyCell(world, grid, -1, -1, { cell: Cell.FLOOR }, { protectedProxyMask: proxyMask });
  assert.equal(blocked.stampedProxyCells, 0);
  assert.equal(blocked.skippedProxyCells, 1);
  assert.equal(world.cells[world.idx(W - 1, W - 1)], Cell.WALL);

  world.aptMask[world.idx(1, 1)] = 1;
  const stamped = stampProxyCell(world, grid, 0, 0, { cell: Cell.FLOOR }, { protectedWorldMask: world.aptMask });
  assert.equal(stamped.stampedProxyCells, 1);
  assert.equal(stamped.stampedWorldCells, 64 * 64 - 1);
  assert.equal(stamped.skippedWorldCells, 1);
  assert.equal(stamped.changedWorldCells, 64 * 64 - 1);
  assert.equal(world.cells[world.idx(0, 0)], Cell.FLOOR);
  assert.equal(world.cells[world.idx(1, 1)], Cell.WALL);

  const [descriptor] = extractProxyDescriptors(world, grid, {
    cells: [proxyIndex(grid, 0, 0)],
    protectedWorldMask: world.aptMask,
  });
  assert.equal(descriptor.floorCells, 64 * 64 - 1);
  assert.equal(descriptor.wallCells, 1);
  assert.equal(descriptor.protectedCells, 1);
  assert.equal(descriptor.dominantCell, Cell.FLOOR);
});

test('proxy grid sampling is deterministic from seed and salt', () => {
  const a = fillProxyGridDeterministic(createProxyGrid(64, 789), 12);
  const b = fillProxyGridDeterministic(createProxyGrid(64, 789), 12);
  const c = fillProxyGridDeterministic(createProxyGrid(64, 790), 12);

  assert.equal(proxySample01(a, 3, 4, 99), proxySample01(b, 3, 4, 99));
  assert.notEqual(proxySample01(a, 3, 4, 99), proxySample01(c, 3, 4, 99));
  assert.deepEqual(Array.from(a.values.slice(0, 16)), Array.from(b.values.slice(0, 16)));
  assert.notDeepEqual(Array.from(a.values.slice(0, 16)), Array.from(c.values.slice(0, 16)));
  assert.deepEqual(sampleProxyCells(a, 12, { salt: 5 }), sampleProxyCells(b, 12, { salt: 5 }));
  assert.notDeepEqual(sampleProxyCells(a, 12, { salt: 5 }), sampleProxyCells(c, 12, { salt: 5 }));
});

test('proxy raster stamping rebakes light features', () => {
  const world = new World();
  const grid = createProxyGrid(256, 321);
  const idx = world.idx(0, 0);

  assert.equal(world.light[idx], 0);

  stampProxyCell(world, grid, 0, 0, { cell: Cell.FLOOR, feature: Feature.LAMP });
  assert.equal(world.features[idx], Feature.LAMP);
  assert.equal(world.light[idx] > 0.9, true);

  const featureVersion = world.featureVersion;
  stampProxyCell(world, grid, 0, 0, { feature: Feature.NONE });
  assert.equal(world.features[idx], Feature.NONE);
  assert.equal(world.light[idx], 0);
  assert.equal(world.featureVersion > featureVersion, true);
});
