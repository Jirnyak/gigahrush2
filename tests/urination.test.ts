import test from 'node:test';
import assert from 'node:assert/strict';

import { AIGoal, Cell, EntityType, Faction, Occupation, RoomType, Tex, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { setNpcContext, updateNPC } from '../src/systems/ai/npc_fsm';
import { resetUrinationTraceCadenceForTests, stampUrineTrace } from '../src/systems/urination';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function npc(id: number, faction: Faction, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.NPC,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    faction,
    occupation: faction === Faction.WILD ? Occupation.TRAVELER : Occupation.CLEANER,
    needs: { food: 80, water: 80, sleep: 80, pee: 90, poo: 0 },
    hp: 80,
    maxHp: 80,
    ai: { goal: AIGoal.IDLE, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function addBathroom(world: World, id: number, x: number, y: number, w: number, h: number): void {
  world.rooms.push({
    id,
    type: RoomType.BATHROOM,
    x,
    y,
    w,
    h,
    doors: [],
    sealed: false,
    name: 'test bathroom',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  });
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      world.roomMap[world.idx(xx, yy)] = id;
    }
  }
}

function countYellowPixels(world: World): number {
  let count = 0;
  for (const cell of world.surfaceMap.values()) {
    for (let i = 0; i < cell.length; i += 4) {
      if (cell[i + 3] <= 0) continue;
      if (cell[i] >= 160 && cell[i + 1] >= 130 && cell[i + 2] <= 80) count++;
    }
  }
  return count;
}

test('shared urine trace stamps compact yellow marks at the projected hit point', () => {
  const world = openWorld();
  const actor = npc(10, Faction.CITIZEN, 20.25, 20.5);
  const beforeVersion = world.surfaceVersion;
  const actorCell = world.idx(20, 20);

  const stamped = stampUrineTrace(world, actor, {
    seed: 12345,
    pressure: 1,
    streamLength: 1.5,
    spread: 0.35,
    streamSteps: 24,
    width: 0.055,
    dropCount: 1,
  });

  assert.equal(stamped, true);
  assert.ok(world.surfaceVersion > beforeVersion);
  assert.ok(world.surfaceMap.size <= 3);
  assert.equal(world.surfaceMap.has(actorCell), false);
  assert.ok(countYellowPixels(world) >= 8);
});

test('wild NPC urination is an explicit in-place routine instead of a bathroom path', () => {
  resetUrinationTraceCadenceForTests();
  const world = openWorld();
  addBathroom(world, 0, 40, 40, 5, 5);
  const wild = npc(20, Faction.WILD, 10.5, 10.5);

  setNpcContext([], 10);
  updateNPC(world, [wild], wild, 1, 10, { hour: 12, minute: 0, totalMinutes: 720 }, false);

  assert.ok((wild.needs?.pee ?? 90) < 90);
  assert.equal(wild.ai?.path.length ?? 0, 0);
  assert.ok(world.surfaceMap.size > 0);
  for (const idx of world.surfaceMap.keys()) {
    assert.equal(world.roomMap[idx], -1);
  }
});
