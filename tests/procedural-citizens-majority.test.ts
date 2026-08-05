import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, EntityType, FloorLevel, LiftDirection, W } from '../src/core/types';
import {
  auditReachability,
  hasReachableAdjacentCell,
  type ReachabilityAudit,
} from '../src/core/world';
import { makeProceduralFloorSpec, type ProceduralFloorSpec } from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { getRouteCueMarkers } from '../src/systems/route_cues';

function forcedCitizensSpec(): ProceduralFloorSpec {
  const base = makeProceduralFloorSpec(45_045, 3);
  return {
    ...base,
    danger: 2,
    geometryId: 'living_blocks',
    baseFloor: FloorLevel.LIVING,
    majorityId: 'citizens',
    anomalyId: 'none',
    title: `гражданский тест: ${base.title}`,
  };
}

function hasReachableLift(gen: ReturnType<typeof generateProceduralFloor>, audit: ReachabilityAudit, direction: LiftDirection): boolean {
  const world = gen.world;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return true;
  }
  return false;
}

function maxLiveNpcBucket(entities: ReturnType<typeof generateProceduralFloor>['entities'], bucketSize: number): number {
  const side = Math.ceil(W / bucketSize);
  const counts = new Int32Array(side * side);
  let max = 0;
  for (const entity of entities) {
    if (!entity.alive || entity.type !== EntityType.NPC) continue;
    const bx = Math.min(side - 1, Math.max(0, Math.floor(entity.x / bucketSize)));
    const by = Math.min(side - 1, Math.max(0, Math.floor(entity.y / bucketSize)));
    const next = ++counts[by * side + bx];
    if (next > max) max = next;
  }
  return max;
}

test('citizens majority procedural floors expose public shelters trade theft and escort routes', () => {
  const gen = generateProceduralFloor(forcedCitizensSpec());
  const world = gen.world;
  const roomNames = world.rooms.map(room => room.name);

  assert.equal(roomNames.some(name => name.startsWith('Общая кухня') || name.startsWith('Пайковая кухня')), true);
  assert.equal(roomNames.some(name => name.startsWith('Гражданское укрытие') || name.startsWith('Тихая ниша укрытия')), true);
  assert.equal(roomNames.some(name => name.startsWith('Свидетельский карман') || name.startsWith('Общий зал свидетелей')), true);

  const citizenContainers = world.containers.filter(container => container.tags.includes('citizens'));
  assert.equal(citizenContainers.some(container =>
    container.access === 'public' &&
    container.tags.includes('share_supplies') &&
    container.tags.includes('resident_relief')), true);
  assert.equal(citizenContainers.some(container =>
    container.access === 'owner' &&
    container.tags.includes('trade') &&
    container.tags.includes('buyable')), true);
  assert.equal(citizenContainers.some(container =>
    container.access === 'owner' &&
    container.tags.includes('witness') &&
    container.tags.includes('steal_with_witnesses')), true);

  const escortCue = getRouteCueMarkers(world).find(marker =>
    marker.tags.includes('citizens') &&
    marker.tags.includes('escort') &&
    marker.tags.includes('shelter'),
  );
  assert.notEqual(escortCue, undefined, 'citizens majority should register an escort cue to a shelter');

  const audit = auditReachability(world, world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true, 'up lift should remain reachable');
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true, 'down lift should remain reachable');
  assert.equal(maxLiveNpcBucket(gen.entities, 32) <= 16, true, 'citizens profile should respect NPC bucket cap');
});
