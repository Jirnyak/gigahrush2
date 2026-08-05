import test from 'node:test';
import assert from 'node:assert/strict';

import { Cell, Feature } from '../src/core/types';
import { World, setVisualSlot as setWorldVisualSlot } from '../src/core/world';
import { createMeshChunkCache } from '../src/render/mesh/chunk_cache';
import {
  VISUAL_CELL_CODES,
  type MeshInstance,
  type MeshPassContext,
} from '../src/render/mesh/scene_collect';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function context(world: World, x: number, y: number, seed: number, overrides: Partial<MeshPassContext> = {}): MeshPassContext {
  return {
    world,
    camera: { x, y, z: 0.5, pitch: 0, yaw: 0, fov: 90 },
    seed,
    floorKey: 'test',
    ...overrides,
  };
}

test('chunk cache reuses chunks and invalidates on visual slot version changes', () => {
  const world = openWorld();
  const cache = createMeshChunkCache();
  setWorldVisualSlot(world, world.idx(10, 10), 0, VISUAL_CELL_CODES.RUBBLE_CHUNK);

  const ctx = context(world, 10.5, 10.5, 123, {
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });
  const out: MeshInstance[] = [];
  const first = cache.update(ctx, out);
  assert.equal(first.enabled, true);
  assert.ok(first.chunksBuilt > 0);
  assert.equal(out.some(instance => instance.modelId === 'rubble_chunk'), true);

  const second = cache.update(ctx, out);
  assert.equal(second.enabled, true);
  assert.equal(second.chunksBuilt, 0);
  assert.ok(second.chunksReused > 0);

  setWorldVisualSlot(world, world.idx(10, 11), 0, VISUAL_CELL_CODES.RUBBLE_CHUNK);
  const third = cache.update(ctx, out);
  assert.equal(third.enabled, true);
  assert.ok(third.chunksBuilt > 0);
});

test('chunk cache clears and rebuilds when profile key changes', () => {
  const world = openWorld();
  const cache = createMeshChunkCache();

  const ctxLow = context(world, 10.5, 10.5, 123, {
    mode: 'low',
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const out: MeshInstance[] = [];
  const first = cache.update(ctxLow, out);
  assert.equal(first.enabled, true);
  assert.ok(first.chunksBuilt > 0);
  assert.equal(first.chunksReused, 0);

  const ctxHigh = context(world, 10.5, 10.5, 123, {
    mode: 'high',
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const second = cache.update(ctxHigh, out);
  assert.equal(second.enabled, true);
  assert.ok(second.chunksBuilt > 0);
  assert.equal(second.chunksReused, 0);
});

test('chunk cache clear explicitly removes all entries', () => {
  const world = openWorld();
  const cache = createMeshChunkCache();
  const ctx = context(world, 10.5, 10.5, 123, {
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const out: MeshInstance[] = [];
  const first = cache.update(ctx, out);
  assert.ok(first.chunksBuilt > 0);

  cache.clear();

  const second = cache.update(ctx, out);
  assert.ok(second.chunksBuilt > 0);
  assert.equal(second.chunksReused, 0);
});

test('chunk cache skips building beyond maxChunksPerFrame', () => {
  const world = openWorld();
  const cache = createMeshChunkCache();
  // Large radius to generate many chunk candidates
  const ctx = context(world, 10.5, 10.5, 123, {
    profile: { radius: 64, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 2 },
  });

  const out: MeshInstance[] = [];
  const first = cache.update(ctx, out);

  assert.equal(first.chunksBuilt, 2);

  // It should continue building next frame
  const second = cache.update(ctx, out);
  assert.equal(second.chunksBuilt, 2);
  assert.ok(second.chunksReused > 0);
});

test('chunk cache disables updates when profile enabled is false', () => {
  const world = openWorld();
  const cache = createMeshChunkCache();
  const ctx = context(world, 10.5, 10.5, 123, {
    mode: 'off',
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const out: MeshInstance[] = [];
  const stats = cache.update(ctx, out);

  assert.equal(stats.enabled, false);
  assert.equal(stats.chunksBuilt, 0);
  assert.equal(stats.chunksReused, 0);
  assert.equal(stats.instances, 0);
});

test('chunk cache invalidates on world cell version change', () => {
  const world = openWorld();
  const cache = createMeshChunkCache();
  const ctx = context(world, 10.5, 10.5, 123, {
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const out: MeshInstance[] = [];
  cache.update(ctx, out);

  world.cellVersion++;

  const stats = cache.update(ctx, out);
  assert.ok(stats.chunksBuilt > 0);
});

test('chunk cache invalidates on world surface version change', () => {
  const world = openWorld();
  const cache = createMeshChunkCache();
  const ctx = context(world, 10.5, 10.5, 123, {
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const out: MeshInstance[] = [];
  cache.update(ctx, out);

  world.surfaceVersion++;

  const stats = cache.update(ctx, out);
  assert.ok(stats.chunksBuilt > 0);
});

test('chunk cache invalidates on world feature version change', () => {
  const world = openWorld();
  const cache = createMeshChunkCache();
  const ctx = context(world, 10.5, 10.5, 123, {
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const out: MeshInstance[] = [];
  cache.update(ctx, out);

  world.featureVersion++;

  const stats = cache.update(ctx, out);
  assert.ok(stats.chunksBuilt > 0);
});

test('chunk cache clears when floor key changes', () => {
  const world = openWorld();
  const cache = createMeshChunkCache();
  const ctx1 = context(world, 10.5, 10.5, 123, {
    floorKey: 'floor1',
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const out: MeshInstance[] = [];
  cache.update(ctx1, out);

  const ctx2 = context(world, 10.5, 10.5, 123, {
    floorKey: 'floor2',
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const stats = cache.update(ctx2, out);
  assert.ok(stats.chunksBuilt > 0);
  assert.equal(stats.chunksReused, 0);
});

test('chunk cache clears when seed changes', () => {
  const world = openWorld();
  const cache = createMeshChunkCache();
  const ctx1 = context(world, 10.5, 10.5, 123, {
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const out: MeshInstance[] = [];
  cache.update(ctx1, out);

  const ctx2 = context(world, 10.5, 10.5, 456, {
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const stats = cache.update(ctx2, out);
  assert.ok(stats.chunksBuilt > 0);
  assert.equal(stats.chunksReused, 0);
});

test('chunk cache clears when world identity changes', () => {
  const world1 = openWorld();
  const cache = createMeshChunkCache();
  const ctx1 = context(world1, 10.5, 10.5, 123, {
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const out: MeshInstance[] = [];
  cache.update(ctx1, out);

  const world2 = openWorld();
  const ctx2 = context(world2, 10.5, 10.5, 123, {
    profile: { radius: 2, instanceCap: 64, chunkSize: 8, maxChunksPerFrame: 64 },
  });

  const stats = cache.update(ctx2, out);
  assert.ok(stats.chunksBuilt > 0);
  assert.equal(stats.chunksReused, 0);
});
