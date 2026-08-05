import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Feature, FloorLevel, LiftDirection, RoomType, Tex } from '../src/core/types';
import { World, auditReachability, hasReachableAdjacentCell, type ReachabilityAudit } from '../src/core/world';
import { makeProceduralFloorSpec, type ProceduralFloorSpec } from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';
import { getHladonColdStatus, HLADON_COLD_SHELL_RADIUS } from '../src/systems/hladon';
import { addTestRoom, makeTestPlayer } from './helpers';

function carveOuterFloor(world: World, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const ci = world.idx(x, y);
      if (world.roomMap[ci] >= 0) continue;
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
    }
  }
}

function roomCenter(room: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return {
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
  };
}

function hasReachableLift(world: World, audit: ReachabilityAudit, direction: LiftDirection): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return true;
  }
  return false;
}

test('Hladon runtime builds BFS cold shells and invalidates after current-world changes', () => {
  const world = new World();
  const room = addTestRoom(world, {
    id: 0,
    x: 20,
    y: 20,
    w: 6,
    h: 6,
    type: RoomType.STORAGE,
    name: 'Хладон: тестовый карман',
  });
  carveOuterFloor(
    world,
    room.x - HLADON_COLD_SHELL_RADIUS - 2,
    room.y - HLADON_COLD_SHELL_RADIUS - 2,
    room.w + HLADON_COLD_SHELL_RADIUS * 2 + 4,
    room.h + HLADON_COLD_SHELL_RADIUS * 2 + 4,
  );

  const core = roomCenter(room);
  const shell = { x: room.x - 1, y: core.y };
  const far = { x: room.x - HLADON_COLD_SHELL_RADIUS - 2, y: core.y };
  let player = makeTestPlayer({ x: core.x + 0.5, y: core.y + 0.5 });

  assert.equal(getHladonColdStatus(world, player).level, 2);
  player = makeTestPlayer({ x: shell.x + 0.5, y: shell.y + 0.5 });
  assert.equal(getHladonColdStatus(world, player).level, 1);
  player = makeTestPlayer({ x: far.x + 0.5, y: far.y + 0.5 });
  assert.equal(getHladonColdStatus(world, player).level, 0);

  const shellIdx = world.idx(shell.x, shell.y);
  world.cells[shellIdx] = Cell.WALL;
  world.markCellsDirty();
  player = makeTestPlayer({ x: shell.x + 0.5, y: shell.y + 0.5 });
  assert.equal(getHladonColdStatus(world, player).level, 0, 'cell-version mutation should rebuild the cold mask');

  room.name = 'Хладон: разморожен тестовый карман';
  player = makeTestPlayer({ x: core.x + 0.5, y: core.y + 0.5 });
  const thawed = getHladonColdStatus(world, player);
  assert.equal(thawed.activeRooms, 0, 'room-name mutation should rebuild active Hladon rooms');
  assert.equal(thawed.level, 0);
});

test('procedural Hladon anomaly exposes cold shells, reachable warm counterplay and both lift directions', () => {
  const base = makeProceduralFloorSpec(54_054, 9);
  const spec: ProceduralFloorSpec = {
    ...base,
    geometryId: 'communal_knots',
    baseFloor: FloorLevel.KVARTIRY,
    majorityId: 'citizens',
    anomalyId: 'hladon',
    danger: 4,
    title: `хладон: ${base.title}`,
  };
  const gen = generateProceduralFloor(spec);
  const world = gen.world;
  const audit = auditReachability(world, world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const reachable = audit.reachable;
  const coldRooms = world.rooms.filter(room => room.name.startsWith('Хладон:') && !room.name.includes('разморожен'));
  const warmRoom = world.rooms.find(room => room.name.includes('теплый запас'));

  assert.equal(coldRooms.length >= 1, true, 'Hladon anomaly should stamp active cold rooms');
  assert.ok(warmRoom, 'Hladon anomaly should seed a warm counterplay room');
  assert.equal(hasReachableLift(world, audit, LiftDirection.UP), true, 'up lift must stay reachable');
  assert.equal(hasReachableLift(world, audit, LiftDirection.DOWN), true, 'down lift must stay reachable');

  const coldCenter = roomCenter(coldRooms[0]);
  const coldStatus = getHladonColdStatus(world, makeTestPlayer({ x: coldCenter.x + 0.5, y: coldCenter.y + 0.5 }));
  assert.equal(coldStatus.level, 2);
  assert.equal(coldStatus.coreCells > 0, true);
  assert.equal(coldStatus.fringeCells > 0, true, 'BFS shell should create fringe cold cells around core rooms');

  const warmCenter = roomCenter(warmRoom);
  const warmIdx = world.idx(warmCenter.x, warmCenter.y);
  const warmStatus = getHladonColdStatus(world, makeTestPlayer({ x: warmCenter.x + 0.5, y: warmCenter.y + 0.5 }));
  assert.equal(reachable[warmIdx], 1, 'warm counterplay room should be reachable from spawn');
  assert.equal(warmStatus.level, 0, 'warm counterplay room should sit outside the deepest cold shell');

  let warmFeatureCells = 0;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.roomMap[i] !== warmRoom.id) continue;
    if (world.features[i] === Feature.STOVE || world.features[i] === Feature.MACHINE) warmFeatureCells++;
  }
  assert.equal(warmFeatureCells >= 1, true, 'warm room should visibly expose heat counterplay');

  const coldRoomIds = new Set(coldRooms.map(room => room.id));
  let boundaryFogCells = 0;
  let boundaryFrostCells = 0;
  for (let i = 0; i < world.cells.length; i++) {
    if (coldRoomIds.has(world.roomMap[i])) continue;
    if (world.fog[i] > 0) boundaryFogCells++;
    if (world.surfaceMap.has(i)) boundaryFrostCells++;
  }
  assert.equal(boundaryFogCells > 0, true, 'cold transition boundary should expose fog cues');
  assert.equal(boundaryFrostCells > 0, true, 'cold transition boundary should expose frost surface cues');
});
