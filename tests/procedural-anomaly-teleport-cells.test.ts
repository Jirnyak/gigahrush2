import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Feature, FloorLevel, LiftDirection, W } from '../src/core/types';
import type { World } from '../src/core/world';
import {
  makeProceduralFloorSpec,
  type ProceduralFloorSpec,
} from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import {
  auditReachability,
  hasReachableAdjacentCell,
  type ReachabilityAudit,
} from '../src/core/world';

function forcedTeleportSpec(): ProceduralFloorSpec {
  const base = makeProceduralFloorSpec(52_052, 9);
  return {
    ...base,
    danger: 4,
    geometryId: 'communal_knots',
    baseFloor: FloorLevel.KVARTIRY,
    majorityId: 'citizens',
    anomalyId: 'teleport_cells',
    title: 'тестовый этаж с перескоками клеток',
  };
}

function hasReachableLift(world: World, audit: ReachabilityAudit, direction: LiftDirection): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return true;
  }
  return false;
}

function hasLiftBackboneNear(world: World, ci: number): boolean {
  const x = ci % W;
  const y = (ci / W) | 0;
  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      const ni = world.idx(x + dx, y + dy);
      if (world.cells[ni] === Cell.LIFT || world.features[ni] === Feature.LIFT_BUTTON) return true;
    }
  }
  return false;
}

function hasLampNear(world: World, ci: number): boolean {
  const x = ci % W;
  const y = (ci / W) | 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (world.features[world.idx(x + dx, y + dy)] === Feature.LAMP) return true;
    }
  }
  return false;
}

function assertTeleportEndpointSafe(world: World, ci: number): void {
  assert.equal(world.cells[ci], Cell.FLOOR, `teleport endpoint ${ci} must be a floor cell`);
  assert.equal(world.features[ci], Feature.SCREEN, `teleport endpoint ${ci} must be visible as a screen`);
  assert.equal(world.screenCells.includes(ci), true, `teleport endpoint ${ci} must be registered as a screen`);
  assert.equal(world.aptMask[ci], 0, `teleport endpoint ${ci} must not touch apartment protection`);
  assert.equal(world.hermoWall[ci], 0, `teleport endpoint ${ci} must not touch hermetic walls`);
  assert.equal(world.doors.has(ci), false, `teleport endpoint ${ci} must not replace a door`);
  assert.equal(world.containerMap.has(ci), false, `teleport endpoint ${ci} must not replace a container`);
  assert.equal(hasLiftBackboneNear(world, ci), false, `teleport endpoint ${ci} must not sit on the lift backbone`);
  assert.equal(hasLampNear(world, ci), true, `teleport endpoint ${ci} should have a readable lamp marker`);
}

test('teleport_cells anomaly creates sparse readable bidirectional pairs without gating lifts', () => {
  const gen = generateProceduralFloor(forcedTeleportSpec());
  const spawnIdx = gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  const audit = auditReachability(gen.world, spawnIdx);

  assert.equal(hasReachableLift(gen.world, audit, LiftDirection.UP), true, 'up lift must be reachable without teleport pairs');
  assert.equal(hasReachableLift(gen.world, audit, LiftDirection.DOWN), true, 'down lift must be reachable without teleport pairs');
  assert.equal(gen.world.anomalyTeleports.size % 2, 0);
  assert.equal(gen.world.anomalyTeleports.size >= 12, true, 'teleport endpoints should remain sparse but present');

  const pairs = new Set<string>();
  for (const [from, to] of gen.world.anomalyTeleports) {
    assert.notEqual(from, to, `teleport endpoint ${from} must not point to itself`);
    assert.equal(gen.world.anomalyTeleports.get(to), from, `teleport endpoint ${from} must have a reverse pair`);
    assertTeleportEndpointSafe(gen.world, from);
    assertTeleportEndpointSafe(gen.world, to);
    pairs.add(from < to ? `${from}:${to}` : `${to}:${from}`);
  }

  assert.equal(pairs.size * 2, gen.world.anomalyTeleports.size, 'teleport pair map should contain only mirrored pairs');
});
