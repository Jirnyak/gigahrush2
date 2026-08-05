import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, LiftDirection, RoomType, Tex, W } from '../src/core/types';
import { World } from '../src/core/world';
import type { ProceduralFloorSpec } from '../src/data/procedural_floors';
import {
  createGeometryProtectedSnapshot,
  getGeometryMetrics,
  measureAndRecordGeometryMetrics,
  measureGeometryMetrics,
} from '../src/gen/geometry_metrics';
import { addTestRoom } from './helpers';

function carveLine(world: World, x0: number, x1: number, y: number): void {
  const min = Math.min(x0, x1);
  const max = Math.max(x0, x1);
  for (let x = min; x <= max; x++) {
    const idx = world.idx(x, y);
    world.cells[idx] = Cell.FLOOR;
    world.floorTex[idx] = Tex.F_CONCRETE;
  }
}

function addDoor(world: World, x: number, y: number, roomA: number, roomB: number): number {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.DOOR;
  world.doors.set(idx, {
    idx,
    state: DoorState.CLOSED,
    roomA,
    roomB,
    keyId: '',
    timer: 0,
  });
  world.rooms[roomA].doors.push(idx);
  if (roomB >= 0) world.rooms[roomB].doors.push(idx);
  return idx;
}

function addLift(world: World, x: number, y: number, direction: LiftDirection): number {
  const idx = world.idx(x, y);
  world.cells[idx] = Cell.LIFT;
  world.liftDir[idx] = direction;
  return idx;
}

test('geometry metrics measure reachability, lifts, protected mutations and torus seams', () => {
  const world = new World();
  const first = addTestRoom(world, { id: 0, x: 10, y: 10, w: 6, h: 6, type: RoomType.COMMON });
  const second = addTestRoom(world, { id: 1, x: 24, y: 10, w: 6, h: 6, type: RoomType.STORAGE });
  addTestRoom(world, { id: 2, x: 70, y: 70, w: 5, h: 5, type: RoomType.OFFICE });
  carveLine(world, 15, 24, 12);
  addDoor(world, 16, 12, first.id, -1);
  addDoor(world, 23, 12, second.id, -1);
  addLift(world, 9, 12, LiftDirection.DOWN);
  addLift(world, 30, 12, LiftDirection.UP);

  const seamA = world.idx(0, 100);
  const seamB = world.idx(W - 1, 100);
  world.cells[seamA] = Cell.FLOOR;
  world.cells[seamB] = Cell.FLOOR;

  const protectedMask = new Uint8Array(W * W);
  const protectedIdx = world.idx(11, 11);
  protectedMask[protectedIdx] = 1;
  const protectedSnapshot = createGeometryProtectedSnapshot(world, protectedMask);
  world.wallTex[protectedIdx] = Tex.METAL;

  const metrics = measureAndRecordGeometryMetrics(world, {
    id: 'synthetic',
    spawn: { x: 12, y: 12 },
    anchors: [{ id: 'storage_center', x: 26, y: 12 }],
    protectedMask,
    protectedSnapshot,
    coarseSize: 64,
    densityBucketSize: 16,
    losSampleCount: 12,
    losMaxDistance: 32,
    generationMs: 12.4,
  });

  assert.equal(metrics.id, 'synthetic');
  assert.equal(metrics.passableCount > 0, true);
  assert.equal(metrics.reachableRatio > 0 && metrics.reachableRatio < 1, true);
  assert.equal(metrics.liftPathLength.down > 0, true);
  assert.equal(metrics.liftPathLength.up > metrics.liftPathLength.down, true);
  assert.equal(metrics.nonSealedRoomReachability.total, 3);
  assert.equal(metrics.nonSealedRoomReachability.reachable, 2);
  assert.equal(metrics.nonSealedRoomReachability.unreachable, 1);
  assert.deepEqual(metrics.nonSealedRoomReachability.unreachableRoomIds, [2]);
  assert.equal(metrics.protected.protectedCells, 1);
  assert.equal(metrics.protected.mutationCount, 1);
  assert.equal(metrics.torusSeam.ok, true);
  assert.equal(metrics.torusSeam.horizontalPassablePairs, 1);
  assert.equal(metrics.anchorDistances[0].id, 'storage_center');
  assert.equal(metrics.anchorDistances[0].pathLength > 0, true);
  assert.equal(metrics.generationTime.bucket, 'fast');
  assert.deepEqual(getGeometryMetrics(world, 'synthetic'), [metrics]);
});

test('geometry metrics describe a forced procedural floor', async () => {
  const { makeProceduralFloorSpec } = await import('../src/data/procedural_floors');
  const { generateProceduralFloor } = await import('../src/gen/procedural_floor');
  const base = makeProceduralFloorSpec(20_260_530, 3);
  const spec: ProceduralFloorSpec = {
    ...base,
    danger: 1,
    geometryId: 'living_blocks',
    majorityId: 'citizens',
    anomalyId: 'none',
    title: 'Тестовая геометрия метрик',
  };
  const gen = generateProceduralFloor(spec);
  const metrics = measureGeometryMetrics(gen.world, {
    id: spec.geometryId,
    spawn: { x: gen.spawnX, y: gen.spawnY },
    losSampleCount: 24,
    losMaxDistance: 48,
    generationMs: 48,
  });

  assert.equal(metrics.reachableRatio > 0.65, true);
  assert.equal(metrics.liftPathLength.up > 0, true);
  assert.equal(metrics.liftPathLength.down > 0, true);
  assert.equal(metrics.nonSealedRoomReachability.reachable > 0, true);
  assert.equal(metrics.coarseGraph.nodeCount > 0, true);
  assert.equal(metrics.coarseGraph.pathEntropy >= 0, true);
  assert.equal(metrics.los.rays > 0, true);
  assert.equal(metrics.density.max > 0, true);
  assert.equal(metrics.generationTime.bucket, 'fast');
});

test('geometry metrics are cheap enough for one routed design floor', async () => {
  const { generateDesignFloor } = await import('../src/gen/design_floors/manifest');
  const gen = generateDesignFloor('roof', 20_260_530);
  const metrics = measureGeometryMetrics(gen.world, {
    id: 'roof',
    spawn: { x: gen.spawnX, y: gen.spawnY },
    losSampleCount: 16,
    losMaxDistance: 48,
  });

  assert.equal(metrics.reachableRatio > 0.5, true);
  assert.equal(metrics.liftPathLength.down > 0, true);
  assert.equal(metrics.torusSeam.ok, true);
  assert.equal(metrics.protected.mutationCount, 0);
});
