import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, ContainerKind, DoorState, LiftDirection, RoomType, Tex, W } from '../src/core/types';
import { World } from '../src/core/world';
import { makeProceduralFloorSpec, type ProceduralFloorSpec } from '../src/data/procedural_floors';
import { generateProceduralFloor } from '../src/gen/procedural_floor';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function walkableWithoutHermeticSeal(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  if (cell === Cell.FLOOR || cell === Cell.WATER) return true;
  if (cell !== Cell.DOOR) return false;
  return world.doors.get(idx)?.state !== DoorState.HERMETIC_CLOSED;
}

function reachableWithoutHermeticSeal(world: World, spawnX: number, spawnY: number): Uint8Array {
  const out = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  const start = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  assert.equal(walkableWithoutHermeticSeal(world, start), true, 'spawn must be passable');
  out[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (out[ni] || !walkableWithoutHermeticSeal(world, ni)) continue;
      out[ni] = 1;
      queue[tail++] = ni;
    }
  }

  return out;
}

function hasReachableLift(world: World, reachable: Uint8Array, direction: LiftDirection): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of DIRS) {
      if (reachable[world.idx(x + dx, y + dy)]) return true;
    }
  }
  return false;
}

test('scientist majority procedural floors stamp labs samples and optional sealed cells without blocking lifts', () => {
  const base = makeProceduralFloorSpec(48_048, 3);
  const spec: ProceduralFloorSpec = {
    ...base,
    danger: 3,
    geometryId: 'living_blocks',
    baseFloor: base.baseFloor,
    majorityId: 'scientists',
    anomalyId: 'none',
    title: `научная смена: ${base.title}`,
  };
  const gen = generateProceduralFloor(spec);
  const world = gen.world;
  const labs = world.rooms.filter(room =>
    room.name.startsWith('Чистая лабораторная ячейка') ||
    room.name.startsWith('Карантинная ячейка') ||
    room.name.startsWith('Гермоклетка') ||
    room.name.startsWith('Грязная пробная') ||
    room.name.startsWith('Обзорная НИИ'),
  );
  const sampleCorridors = world.rooms.filter(room => room.name.startsWith('Пробный коридор НИИ'));
  const sealed = labs.filter(room => room.name.startsWith('Гермоклетка'));
  const scientistCaches = world.containers.filter(container => container.tags.includes('scientist_majority_lab'));

  assert.equal(labs.length >= 6, true, 'scientist majority should create several lab/observation cells');
  assert.equal(labs.some(room => room.type === RoomType.MEDICAL), true, 'labs should include medical sample cells');
  assert.equal(labs.some(room => room.name.startsWith('Обзорная НИИ')), true, 'labs should include observation rooms');
  assert.equal(sampleCorridors.length >= 1, true, 'scientist majority should mark sample corridors');
  assert.equal(sampleCorridors.length >= 1, true, 'scientist majority should mark sample corridors');

  for (const room of sealed) {
    assert.equal(room.doors.length <= 1, true, `${room.name} must remain an optional leaf room`);
    for (const doorIdx of room.doors) {
      assert.equal(world.doors.get(doorIdx)?.state, DoorState.HERMETIC_CLOSED, `${room.name} door should be hermetic`);
    }
  }

  let cleanTiles = 0;
  let dirtyTiles = 0;
  for (const room of labs) {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        const ci = world.idx(room.x + dx, room.y + dy);
        if (world.roomMap[ci] !== room.id) continue;
        if (world.floorTex[ci] === Tex.F_TILE) cleanTiles++;
        if (world.floorTex[ci] === Tex.F_CONCRETE || world.floorTex[ci] === Tex.F_GUT) dirtyTiles++;
      }
    }
  }
  assert.equal(cleanTiles > 0 && dirtyTiles > 0, true, 'labs should expose clean and dirty borders');

  assert.equal(scientistCaches.length >= 3, true, 'scientist majority should expose sample medicine and observation caches');
  assert.equal(scientistCaches.some(container => container.kind === ContainerKind.MEDICAL_CABINET && container.tags.includes('harvest_sample')), true);
  assert.equal(scientistCaches.some(container => container.kind === ContainerKind.MEDICAL_CABINET && container.tags.includes('steal_medicine')), true);
  assert.equal(scientistCaches.some(container => container.kind === ContainerKind.FILING_CABINET && container.tags.includes('expose_lab')), true);
  assert.equal(scientistCaches.every(container => container.access === 'faction' && container.tags.includes('sample_audit')), true);

  const routeReachable = reachableWithoutHermeticSeal(world, gen.spawnX, gen.spawnY);
  assert.equal(hasReachableLift(world, routeReachable, LiftDirection.UP), true, 'up lift must not require a sealed lab cell');
  assert.equal(hasReachableLift(world, routeReachable, LiftDirection.DOWN), true, 'down lift must not require a sealed lab cell');
});
