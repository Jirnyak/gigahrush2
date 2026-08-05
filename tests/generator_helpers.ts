import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { Cell, LiftDirection, W } from '../src/core/types';
import type { World } from '../src/core/world';
import type { FloorGeneration } from '../src/gen/floor_manifest';

interface GeneratorTiming {
  label: string;
  ms: number;
}

const generatorTimings: GeneratorTiming[] = [];
const RUN_GENERATION_MATRIX = process.env.GIGAHRUSH_GENERATION_MATRIX === '1';
const GENERATION_SKIP_REASON = 'run npm run test:generation for the full generation matrix';

const ORTHO_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

export function timeFloorGeneration<T extends FloorGeneration>(label: string, fn: () => T): T {
  const startedAt = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    generatorTimings.push({ label, ms: elapsedMs });
  }
}

export function printSlowestFloorGenerators(limit = 8): void {
  if (generatorTimings.length === 0) return;
  const slowest = [...generatorTimings].sort((a, b) => b.ms - a.ms).slice(0, limit);
  const totalMs = generatorTimings.reduce((sum, item) => sum + item.ms, 0);
  console.log(`Generation timing: ${generatorTimings.length} floor generator calls, total ${totalMs.toFixed(1)}ms, slowest ${slowest.length}:`);
  for (const item of slowest) console.log(`- ${item.ms.toFixed(1)}ms ${item.label}`);
}

export function testGenerationMatrix(name: string, fn: () => void): void {
  test(name, { skip: RUN_GENERATION_MATRIX ? false : GENERATION_SKIP_REASON }, fn);
}

function playableBounds(world: World): { count: number; minX: number; minY: number; maxX: number; maxY: number } {
  const out = { count: 0, minX: W, minY: W, maxX: -1, maxY: -1 };
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const cell = world.cells[world.idx(x, y)];
      if (cell !== Cell.FLOOR && cell !== Cell.WATER && cell !== Cell.DOOR && cell !== Cell.LIFT) continue;
      out.count++;
      if (x < out.minX) out.minX = x;
      if (y < out.minY) out.minY = y;
      if (x > out.maxX) out.maxX = x;
      if (y > out.maxY) out.maxY = y;
    }
  }
  return out;
}

export function assertFullFootprint(world: World, label: string): void {
  const bounds = playableBounds(world);
  assert.equal(bounds.minX, 0, `${label} minX`);
  assert.equal(bounds.minY, 0, `${label} minY`);
  assert.equal(bounds.maxX, W - 1, `${label} maxX`);
  assert.equal(bounds.maxY, W - 1, `${label} maxY`);
  assert.equal(bounds.count >= 18_000, true, `${label} playable cells`);
}

export function reachableCells(gen: FloorGeneration): Uint8Array {
  const world = gen.world;
  const out = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  const start = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  out[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (out[ni]) continue;
      if (world.cells[ni] !== Cell.FLOOR && world.cells[ni] !== Cell.DOOR && world.cells[ni] !== Cell.WATER) continue;
      out[ni] = 1;
      queue[tail++] = ni;
    }
  }

  return out;
}

export function hasReachableLift(gen: FloorGeneration, reachable: Uint8Array, direction: LiftDirection): boolean {
  const world = gen.world;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      if (reachable[world.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

export function assertReachableRouteLifts(gen: FloorGeneration, label: string): Uint8Array {
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  assert.equal(spawnCell, Cell.FLOOR, `${label} spawn floor`);
  const reachable = reachableCells(gen);
  assert.equal(hasReachableLift(gen, reachable, LiftDirection.UP), true, `${label} reachable up lift`);
  assert.equal(hasReachableLift(gen, reachable, LiftDirection.DOWN), true, `${label} reachable down lift`);
  return reachable;
}
