import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, LiftDirection, Tex } from '../src/core/types';
import type { World } from '../src/core/world';
import {
  makeProceduralFloorSpec,
  type ProceduralFloorSpec,
} from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { measureGeometryMetrics } from '../src/gen/geometry_metrics';
import {
  auditReachability,
  describeReachability,
  hasReachableAdjacentCell,
  type ReachabilityAudit,
} from '../src/core/world';

function forcedFractalSpec(): ProceduralFloorSpec {
  const base = makeProceduralFloorSpec(59_059, 9);
  return {
    ...base,
    anomalyId: 'fractal_floor',
    danger: 5,
    title: `фрактальный пол: ${base.title}`,
  };
}

function assertReachableLift(world: World, audit: ReachabilityAudit, direction: LiftDirection): void {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return;
  }
  assert.fail(`fractal_floor: no reachable ${LiftDirection[direction]} lift`);
}

function assertReachableTeleportScreens(world: World, audit: ReachabilityAudit): void {
  for (const idx of world.anomalyTeleports.keys()) {
    assert.equal(audit.reachable[idx], 1, `fractal teleport screen: ${describeReachability(audit, world, idx)}`);
  }
}

test('fractal floor cuts recursive gaps but keeps route anchors reachable', () => {
  const gen = generateProceduralFloor(forcedFractalSpec());
  const world = gen.world;
  const spawnIdx = world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  const audit = auditReachability(world, spawnIdx);
  let abyssCells = 0;
  let protectedAbyssCells = 0;

  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.ABYSS) continue;
    if (world.floorTex[i] === Tex.F_ABYSS) abyssCells++;
    if (world.aptMask[i] || world.hermoWall[i]) protectedAbyssCells++;
  }

  const metrics = measureGeometryMetrics(world, {
    id: 'fractal_floor',
    spawn: { x: gen.spawnX, y: gen.spawnY },
    coarseSize: 64,
    densityBucketSize: 32,
    losSampleCount: 16,
    losMaxDistance: 48,
  });

  assert.equal(world.cells[spawnIdx], Cell.FLOOR);
  assertReachableLift(world, audit, LiftDirection.UP);
  assertReachableLift(world, audit, LiftDirection.DOWN);
  assert.equal(protectedAbyssCells, 0, 'fractal deletion must not touch protected cells');
  assert.equal(abyssCells >= 300, true, `expected meaningful fractal gaps, got ${abyssCells}`);
  assert.equal(abyssCells < 50_000, true, `fractal domain should stay bounded, got ${abyssCells}`);
  assert.equal(world.rooms.filter(room => room.name.startsWith('Фрактал ')).length >= 3, true);
  assert.equal(world.anomalyTeleports.size >= 2, true);
  assertReachableTeleportScreens(world, audit);
  assert.equal(metrics.pathEntropy >= 0.5, true, `path entropy ${metrics.pathEntropy}`);
  assert.equal(metrics.nonSealedRoomReachability.unreachable <= 25, true, `Expected max 25 unreachable rooms, got ${metrics.nonSealedRoomReachability.unreachable}`);
});
