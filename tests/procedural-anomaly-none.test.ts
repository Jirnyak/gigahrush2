import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, FloorLevel, LiftDirection, type World } from '../src/core/types';
import {
  anomalyById,
  makeProceduralFloorSpec,
  type ProceduralFloorSpec,
} from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import {
  auditReachability,
  hasReachableAdjacentCell,
  type ReachabilityAudit,
} from '../src/core/world';
import {
  proceduralAnomalyEventData,
  proceduralAnomalyEventTags,
} from '../src/systems/procedural_anomalies';

function forcedNoneSpec(): ProceduralFloorSpec {
  const base = makeProceduralFloorSpec(50_050, 3);
  return {
    ...base,
    danger: 1,
    geometryId: 'living_blocks',
    baseFloor: FloorLevel.LIVING,
    majorityId: 'citizens',
    anomalyId: 'none',
    title: 'тестовый этаж без аномалии',
  };
}

function hasReachableLift(world: World, audit: ReachabilityAudit, direction: LiftDirection): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return true;
  }
  return false;
}

test('none procedural anomaly stays inert while forced baseline geometry remains playable', () => {
  const spec = forcedNoneSpec();
  const def = anomalyById('none');

  assert.equal(def.id, 'none');
  assert.deepEqual(def.tags, []);
  assert.deepEqual(proceduralAnomalyEventTags(spec), []);
  assert.deepEqual(proceduralAnomalyEventData(spec), {});

  const gen = generateProceduralFloor(spec);
  const spawnIdx = gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY));
  const audit = auditReachability(gen.world, spawnIdx);

  assert.equal(gen.world.cells[spawnIdx], Cell.FLOOR);
  assert.equal(gen.world.rooms.length > 0, true);
  assert.equal(hasReachableLift(gen.world, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen.world, audit, LiftDirection.DOWN), true);
  assert.equal(gen.world.anomalyTeleports.size, 0);
  assert.equal(gen.world.anomalySmogSource, -1);
  assert.equal(gen.world.anomalySmogCells.length, 0);
  assert.equal(gen.world.anomalySmogHandled, false);
  assert.equal(gen.world.railTracks.length, 0);
  assert.equal(gen.world.railTrains.length, 0);
});
