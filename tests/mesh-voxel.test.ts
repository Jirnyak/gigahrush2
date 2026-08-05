import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, Feature } from '../src/core/types';
import { collectVoxelChunks, countSolidVoxels, createVoxelField, fieldHasVoxel } from '../src/render/mesh/voxel/field';
import { buildExposedVoxelMesh, buildGreedyVoxelMesh } from '../src/render/mesh/voxel/greedy_mesh';
import { buildMarchingCubesMesh } from '../src/render/mesh/voxel/marching_cubes';
import {
  VOXEL_FIELD_MAX_DEPTH,
  VOXEL_FIELD_MAX_HEIGHT,
  VOXEL_FIELD_MAX_WIDTH,
  VoxelMaterial,
  voxelOffset,
  type VoxelField,
  type VoxelProfile,
  type VoxelVisualFamily,
  type VoxelWorldLike,
} from '../src/render/mesh/voxel/types';

const SLOT_COUNT = 16;

function makeWorld(size: number): VoxelWorldLike {
  const cells = new Uint8Array(size * size).fill(Cell.FLOOR);
  const features = new Uint8Array(size * size);
  const visualSlots = new Uint8Array(size * size * SLOT_COUNT);
  const wrap = (v: number): number => ((v % size) + size) % size;
  const idx = (x: number, y: number): number => wrap(y) * size + wrap(x);
  for (let x = 0; x < size; x++) {
    cells[idx(x, 0)] = Cell.WALL;
    cells[idx(x, size - 1)] = Cell.WALL;
  }
  for (let y = 0; y < size; y++) {
    cells[idx(0, y)] = Cell.WALL;
    cells[idx(size - 1, y)] = Cell.WALL;
  }
  return { cells, features, visualSlots, idx, wrap };
}

function profile(overrides: Partial<VoxelProfile> = {}): VoxelProfile {
  return {
    voxelEnabled: true,
    key: 'test',
    chunkSize: 6,
    fieldDepth: 6,
    triangleCap: 512,
    solidVoxelCap: 128,
    maxChunksPerFrame: 1,
    voxelRadius: 6,
    visualSlotsPerCell: SLOT_COUNT,
    ...overrides,
  };
}

function classify(code: number): VoxelVisualFamily | undefined {
  if (code === 1) return 'pipe';
  if (code === 2) return 'organic';
  if (code === 3) return 'rubble';
  if (code === 4) return 'cable';
  if (code === 5) return 'ceiling';
  return undefined;
}

function makeSolidField(width: number, height: number, depth: number): VoxelField {
  return {
    width,
    height,
    depth,
    originX: 0,
    originY: 0,
    worldSize: 64,
    seed: 1,
    profileKey: 'solid',
    voxels: new Uint8Array(width * height * depth),
    solidCount: 0,
  };
}

function setVoxel(field: VoxelField, x: number, y: number, z: number, material = VoxelMaterial.CONCRETE): void {
  const offset = voxelOffset(field, x, y, z);
  if (field.voxels[offset] === VoxelMaterial.EMPTY) field.solidCount++;
  field.voxels[offset] = material;
}

function localFieldCoord(field: VoxelField, worldX: number, worldY: number): { x: number; y: number } {
  const x = (worldX - field.originX + field.worldSize) % field.worldSize;
  const y = (worldY - field.originY + field.worldSize) % field.worldSize;
  assert.ok(x >= 0 && x < field.width, `world x ${worldX} maps outside field`);
  assert.ok(y >= 0 && y < field.height, `world y ${worldY} maps outside field`);
  return { x, y };
}

function assertNoVoxelsAtWorldCell(field: VoxelField, worldX: number, worldY: number): void {
  const local = localFieldCoord(field, worldX, worldY);
  for (let z = 0; z < field.depth; z++) {
    assert.equal(fieldHasVoxel(field, local.x, local.y, z), false, `unexpected voxel at ${worldX},${worldY},${z}`);
  }
}

function assertFiniteVertices(vertices: Float32Array): void {
  for (const value of vertices) assert.equal(Number.isFinite(value), true, 'voxel mesh vertex must be finite');
}

test('voxel profile off produces empty field and disabled collect stats', () => {
  const world = makeWorld(8);
  const off = profile({ voxelEnabled: false });
  const field = createVoxelField({ world, seed: 11, chunkX: 0, chunkY: 0, profile: off, worldSize: 8 });
  assert.equal(field.voxels.length, 0);
  assert.equal(field.solidCount, 0);

  const out = [];
  const stats = collectVoxelChunks({ world, cameraX: 2, cameraY: 2, seed: 11, profile: off, worldSize: 8 }, out);
  assert.equal(stats.enabled, false);
  assert.equal(out.length, 0);
});

test('voxel field and greedy mesh are deterministic for same seed and context', () => {
  const world = makeWorld(8);
  world.features![world.idx!(2, 2)] = Feature.MACHINE;
  const options = { world, seed: 77, chunkX: 0, chunkY: 0, profile: profile(), worldSize: 8 };
  const a = createVoxelField(options);
  const b = createVoxelField(options);
  assert.deepEqual(a.voxels, b.voxels);
  assert.equal(a.solidCount, b.solidCount);

  const meshA = buildGreedyVoxelMesh(a, { triangleCap: 512 });
  const meshB = buildGreedyVoxelMesh(b, { triangleCap: 512 });
  assert.equal(meshA.triangleCount, meshB.triangleCount);
  assert.deepEqual(meshA.vertices, meshB.vertices);
});

test('visual slot context does not disturb deterministic wall voxel mesh', () => {
  const world = makeWorld(8);
  const cell = world.idx!(3, 3);
  world.visualSlots![cell * SLOT_COUNT] = 1;
  const ctx = {
    world,
    seed: 123,
    chunkX: 0,
    chunkY: 0,
    profile: profile(),
    visualSlotClassifier: classify,
    worldSize: 8,
  };
  const meshA = buildGreedyVoxelMesh(createVoxelField(ctx), { triangleCap: 512 });
  const meshB = buildGreedyVoxelMesh(createVoxelField(ctx), { triangleCap: 512 });
  assert.ok(meshA.triangleCount > 0);
  assert.equal(meshA.triangleCount, meshB.triangleCount);
  assert.deepEqual(meshA.indices, meshB.indices);
});

test('passable features and visual slots do not become voxel blocks or ceiling slabs', () => {
  const world = makeWorld(8);
  world.features![world.idx!(2, 2)] = Feature.DESK;
  world.features![world.idx!(3, 2)] = Feature.SHELF;
  world.features![world.idx!(4, 2)] = Feature.MACHINE;
  world.features![world.idx!(5, 3)] = Feature.LAMP;
  world.features![world.idx!(6, 3)] = Feature.SCREEN;
  world.surfaceMap = new Map([[world.idx!(5, 2), new Uint8Array([1])]]);
  world.visualSlots![world.idx!(2, 3) * SLOT_COUNT] = 3;
  world.visualSlots![world.idx!(3, 3) * SLOT_COUNT] = 1;
  world.visualSlots![world.idx!(4, 3) * SLOT_COUNT] = 4;
  world.visualSlots![world.idx!(5, 4) * SLOT_COUNT] = 5;

  const field = createVoxelField({
    world,
    seed: 321,
    chunkX: 0,
    chunkY: 0,
    profile: profile(),
    visualSlotClassifier: classify,
    worldSize: 8,
  });

  assertNoVoxelsAtWorldCell(field, 2, 2);
  assertNoVoxelsAtWorldCell(field, 3, 2);
  assertNoVoxelsAtWorldCell(field, 4, 2);
  assertNoVoxelsAtWorldCell(field, 5, 2);
  assertNoVoxelsAtWorldCell(field, 2, 3);
  assertNoVoxelsAtWorldCell(field, 3, 3);
  assertNoVoxelsAtWorldCell(field, 4, 3);
  assertNoVoxelsAtWorldCell(field, 5, 3);
  assertNoVoxelsAtWorldCell(field, 6, 3);
  assertNoVoxelsAtWorldCell(field, 5, 4);
});

test('voxel field dimensions are clamped under constants', () => {
  const world = makeWorld(8);
  const field = createVoxelField({
    world,
    seed: 5,
    chunkX: 0,
    chunkY: 0,
    profile: profile({ chunkSize: 999, fieldDepth: 999 }),
    worldSize: 8,
  });
  assert.ok(field.width <= VOXEL_FIELD_MAX_WIDTH);
  assert.ok(field.height <= VOXEL_FIELD_MAX_HEIGHT);
  assert.ok(field.depth <= VOXEL_FIELD_MAX_DEPTH);
});

test('greedy mesh enforces triangle cap and emits finite vertices', () => {
  const field = makeSolidField(5, 5, 5);
  for (let z = 0; z < 5; z++) {
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) setVoxel(field, x, y, z);
    }
  }
  const mesh = buildGreedyVoxelMesh(field, { triangleCap: 6 });
  assert.ok(mesh.triangleCount <= 6);
  assert.equal(mesh.truncated, true);
  assertFiniteVertices(mesh.vertices);
});

test('greedy meshing reduces or equals exposed-face triangle count for cuboids', () => {
  const field = makeSolidField(5, 5, 5);
  for (let z = 1; z <= 3; z++) {
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) setVoxel(field, x, y, z);
    }
  }
  const exposed = buildExposedVoxelMesh(field, { triangleCap: 10_000 });
  const greedy = buildGreedyVoxelMesh(field, { triangleCap: 10_000 });
  assert.ok(greedy.triangleCount <= exposed.triangleCount);
  assert.equal(exposed.triangleCount, 108);
  assert.equal(greedy.triangleCount, 12);
});

test('collector caps chunks per frame and reports built geometry', () => {
  const world = makeWorld(16);
  world.features![world.idx!(2, 2)] = Feature.APPARATUS;
  const out = [];
  const stats = collectVoxelChunks({
    world,
    cameraX: 2,
    cameraY: 2,
    seed: 88,
    profile: profile({ maxChunksPerFrame: 1, voxelRadius: 18 }),
    worldSize: 16,
  }, out);
  assert.equal(stats.enabled, true);
  assert.equal(stats.chunksConsidered, 1);
  assert.ok(stats.solidVoxels > 0);
  assert.ok(stats.triangles > 0);
  assert.equal(out.length, stats.chunksBuilt);
});

test('solid voxel counter and marching cubes planned API stay bounded', () => {
  const field = makeSolidField(3, 3, 3);
  setVoxel(field, 1, 1, 1, VoxelMaterial.ORGANIC);
  assert.equal(countSolidVoxels(field), 1);
  const mesh = buildMarchingCubesMesh(field, { enabled: true, triangleCap: 10 });
  assert.equal(mesh.triangleCount, 0);
  assert.equal(mesh.skippedReason, 'marching_cubes_planned');
});
