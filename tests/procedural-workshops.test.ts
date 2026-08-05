import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Feature, FloorLevel, RoomType, W, type Room } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { makeProceduralFloorSpec, type ProceduralFloorSpec } from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { measureGeometryMetrics } from '../src/gen/geometry_metrics';

function reachableRoomCenter(gen: ReturnType<typeof generateProceduralFloor>, room: Room): boolean {
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const cx = gen.world.wrap(room.x + Math.floor(room.w / 2));
  const cy = gen.world.wrap(room.y + Math.floor(room.h / 2));
  return audit.reachable[gen.world.idx(cx, cy)] === 1;
}

function roomFeatureCount(gen: ReturnType<typeof generateProceduralFloor>, rooms: readonly Room[]): number {
  let count = 0;
  const ids = new Set(rooms.map(room => room.id));
  for (let i = 0; i < W * W; i++) {
    if (!ids.has(gen.world.roomMap[i])) continue;
    if (gen.world.features[i] === Feature.MACHINE || gen.world.features[i] === Feature.APPARATUS) count++;
  }
  return count;
}

test('forced workshops geometry exposes dock loops, tool chords and factory decision containers', () => {
  const base = makeProceduralFloorSpec(1, -34);
  const spec: ProceduralFloorSpec = {
    ...base,
    key: 'test_workshops_geometry',
    z: -34,
    depth: 34,
    danger: 4,
    geometryId: 'workshops',
    baseFloor: FloorLevel.MAINTENANCE,
    majorityId: 'liquidators',
    anomalyId: 'none',
    title: 'Тестовый цеховой этаж',
  };

  const gen = generateProceduralFloor(spec);
  const metrics = measureGeometryMetrics(gen.world, {
    id: spec.geometryId,
    spawn: { x: gen.spawnX, y: gen.spawnY },
    losSampleCount: 16,
    losMaxDistance: 48,
  });

  const dockRooms = gen.world.rooms.filter(room => room.name.includes('доковая петля'));
  const toolRooms = gen.world.rooms.filter(room => room.name.startsWith('Инструментальная хорда'));
  const factoryRooms = gen.world.rooms.filter(room =>
    room.type === RoomType.PRODUCTION &&
    (room.name.includes('станочная линия') ||
      room.name.includes('док выдачи') ||
      room.name.includes('верстак смены') ||
      room.name.includes('ремонтная линия')),
  );
  const workshopDecision = gen.world.containers.filter(container => container.tags.includes('workshop_decision'));

  assert.equal(metrics.loopCount > 0, true, 'workshop floor should have at least one coarse loop');
  assert.equal(dockRooms.length >= 1, true, 'workshop floor should name at least one dock loop room');
  assert.equal(toolRooms.length >= 1, true, 'workshop floor should name at least one tool-room chord');
  assert.equal(factoryRooms.length >= 4, true, 'workshop floor should expose several factory cells');
  assert.equal(roomFeatureCount(gen, factoryRooms) >= 16, true, 'factory cells should contain machines and apparatus');
  assert.equal(reachableRoomCenter(gen, dockRooms[0]), true, 'dock loop should remain reachable');
  assert.equal(reachableRoomCenter(gen, toolRooms[0]), true, 'tool-room chord should remain reachable');

  assert.equal(workshopDecision.length >= 3, true, 'decision triangle should seed repair/sabotage/output containers');
  assert.equal(workshopDecision.every(container => typeof container.factoryId === 'string'), true);
  assert.equal(workshopDecision.some(container => container.tags.includes('sabotage')), true);
  assert.equal(workshopDecision.some(container => container.tags.includes('steal_output')), true);
  assert.equal(workshopDecision.some(container => container.tags.includes('repair_line')), true);
  assert.equal(workshopDecision.some(container => container.inventory.some(item => item.defId === 'gear')), true);

  let reachableFloor = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (gen.world.cells[i] === Cell.FLOOR) reachableFloor++;
  }
  assert.equal(reachableFloor > 18_000, true, 'workshop geometry should stay broad enough for route play');
});
