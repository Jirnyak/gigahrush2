import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { AIGoal, Cell, DoorState, EntityType, RoomType, Tex, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { setPathBlockerRow, PATH_BLOCKER_SUBDIV } from '../src/core/path_blockers';
import {
  bfsPath,
  freezeNavigationCacheForWorld,
  followPath,
  getPathfindingStats,
  gotoNearestRoomType,
  gotoRoom,
  setPathContext,
  steerEntityTowardCell,
  tryAssignPathToCell, subcellIdx,
  unfreezeNavigationCacheForWorld,
} from '../src/systems/ai/pathfinding';
import { setDoorState } from '../src/systems/door_state';

function makeCorridorWorld(): World {
  const world = new World();
  for (let x = 0; x <= 40; x++) world.set(x, 10, Cell.FLOOR);
  for (let y = 9; y <= 11; y++) {
    for (let x = 20; x <= 22; x++) {
      world.set(x, y, Cell.FLOOR);
      world.roomMap[world.idx(x, y)] = 0;
    }
  }
  world.rooms.push({
    id: 0,
    type: RoomType.LIVING,
    x: 20,
    y: 9,
    w: 3,
    h: 3,
    doors: [],
    sealed: false,
    name: 'Тестовая комната',
    apartmentId: 0,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  });
  return world;
}

function makeCornerWorld(): World {
  const world = new World();
  for (let x = 0; x <= 10; x++) world.set(x, 10, Cell.FLOOR);
  for (let y = 10; y <= 14; y++) world.set(10, y, Cell.FLOOR);
  return world;
}

function makeOpenPlazaWorld(): World {
  const world = new World();
  for (let y = 10; y <= 16; y++) {
    for (let x = 0; x <= 8; x++) {
      world.set(x, y, Cell.FLOOR);
    }
  }
  return world;
}

function blockCellFully(world: World, x: number, y: number): void {
  const idx = world.idx(x, y);
  for (let row = 0; row < PATH_BLOCKER_SUBDIV; row++) setPathBlockerRow(world, idx, row, 0x0f);
}

function npc(id: number, x: number): Entity {
  return {
    id,
    type: EntityType.NPC,
    x,
    y: 10.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    ai: { goal: AIGoal.IDLE, tx: 0, ty: 0, path: [], pi: 0, stuck: 0, timer: 0 },
  };
}

function assertContiguous(path: readonly number[]): void {
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1] % 4096;
    const ay = (path[i - 1] / 4096) | 0;
    const bx = path[i] % 4096;
    const by = (path[i] / 4096) | 0;
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    const isAdjacentX = dx <= 1 || dx === 4095;
    const isAdjacentY = dy <= 1 || dy === 4095;
    assert.ok(isAdjacentX && isAdjacentY && (dx !== 0 || dy !== 0));
  }
}

test('bfsPath reuses the baked navigation tree for identical endpoints', () => {
  const world = makeCorridorWorld();
  setPathContext([], 0);

  const first = bfsPath(world, 0.5, 10.5, 21.5, 10.5);
  const second = bfsPath(world, 0.5, 10.5, 21.5, 10.5);

  assert.ok(first.length > 0);
  assertContiguous(first);
  assert.deepEqual(second, first);
  assert.equal(getPathfindingStats().cacheHits, 1);
});

test('samosbor mode does not invalidate baked navigation without geometry changes', () => {
  const world = makeCorridorWorld();
  setPathContext([], 0, false);
  const first = bfsPath(world, 0.5, 10.5, 21.5, 10.5);

  setPathContext([], 0.1, true);
  const second = bfsPath(world, 0.5, 10.5, 21.5, 10.5);
  const stats = getPathfindingStats();

  assert.ok(first.length > 0);
  assert.deepEqual(second, first);
  assert.equal(stats.bfsCalls, 0);
  assert.equal(stats.cacheHits, 1);
});

test('frozen navigation cache survives temporary samosbor geometry dirties until unfreeze', () => {
  const world = makeCorridorWorld();
  setPathContext([], 0);
  const first = bfsPath(world, 0.5, 10.5, 21.5, 10.5);
  assert.ok(first.length > 0);

  freezeNavigationCacheForWorld(world);
  world.set(10, 10, Cell.WALL);
  world.markCellsDirty();

  setPathContext([], 0.1, true);
  const staleDuringWave = bfsPath(world, 0.5, 10.5, 21.5, 10.5);
  let stats = getPathfindingStats();
  assert.deepEqual(staleDuringWave, first);
  assert.equal(stats.bfsCalls, 0);
  assert.equal(stats.cacheHits, 1);

  unfreezeNavigationCacheForWorld(world);
  setPathContext([], 0.2, false);
  assert.deepEqual(bfsPath(world, 0.5, 10.5, 21.5, 10.5), []);
  stats = getPathfindingStats();
  assert.equal(stats.bfsCalls, 1);
});

test('nested samosbor navigation freezes survive inner wave unfreeze', () => {
  const world = makeCorridorWorld();
  setPathContext([], 0);
  const first = bfsPath(world, 0.5, 10.5, 21.5, 10.5);
  assert.ok(first.length > 0);

  freezeNavigationCacheForWorld(world);
  freezeNavigationCacheForWorld(world);
  world.set(10, 10, Cell.WALL);
  world.markCellsDirty();

  unfreezeNavigationCacheForWorld(world);
  setPathContext([], 0.1, true);
  assert.deepEqual(bfsPath(world, 0.5, 10.5, 21.5, 10.5), first);
  assert.equal(getPathfindingStats().bfsCalls, 0);

  unfreezeNavigationCacheForWorld(world);
  setPathContext([], 0.2, false);
  assert.deepEqual(bfsPath(world, 0.5, 10.5, 21.5, 10.5), []);
  assert.equal(getPathfindingStats().bfsCalls, 1);
});

test('ordinary closed doors are routeable while locked and hermetic doors block navigation', () => {
  const world = makeCorridorWorld();
  const doorIdx = world.idx(10, 10);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.CLOSED, roomA: -1, roomB: 0, keyId: '', timer: 0 });

  setPathContext([], 0);
  assert.equal(bfsPath(world, 0.5, 10.5, 21.5, 10.5).length > 0, true);

  world.doors.get(doorIdx)!.state = DoorState.LOCKED;
  world.markCellsDirty();
  unfreezeNavigationCacheForWorld();
  setPathContext([], 1);
  assert.deepEqual(bfsPath(world, 0.5, 10.5, 21.5, 10.5), []);

  world.doors.get(doorIdx)!.state = DoorState.HERMETIC_CLOSED;
  world.markCellsDirty();
  unfreezeNavigationCacheForWorld();
  setPathContext([], 2, true);
  assert.deepEqual(bfsPath(world, 0.5, 10.5, 21.5, 10.5), []);
});

test('ordinary door open and close does not dirty navigation topology', () => {
  const world = makeCorridorWorld();
  const doorIdx = world.idx(10, 10);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.CLOSED, roomA: -1, roomB: 0, keyId: '', timer: 0 });

  setPathContext([], 0);
  assert.equal(bfsPath(world, 0.5, 10.5, 21.5, 10.5).length > 0, true);

  const beforeOpen = world.cellVersion;
  assert.equal(setDoorState(world, world.doors.get(doorIdx), DoorState.OPEN), true);
  assert.equal(world.cellVersion, beforeOpen);
  assert.equal(bfsPath(world, 0.5, 10.5, 21.5, 10.5).length > 0, true);

  const beforeClose = world.cellVersion;
  assert.equal(setDoorState(world, world.doors.get(doorIdx), DoorState.CLOSED), true);
  assert.equal(world.cellVersion, beforeClose);
  assert.equal(bfsPath(world, 0.5, 10.5, 21.5, 10.5).length > 0, true);
});

test('door state helper invalidates baked navigation when passability changes', () => {
  const world = makeCorridorWorld();
  const doorIdx = world.idx(10, 10);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.HERMETIC_OPEN, roomA: -1, roomB: 0, keyId: '', timer: 0 });

  setPathContext([], 0);
  assert.equal(bfsPath(world, 0.5, 10.5, 21.5, 10.5).length > 0, true);
  const beforeVersion = world.cellVersion;

  assert.equal(setDoorState(world, world.doors.get(doorIdx), DoorState.HERMETIC_CLOSED), true);
  unfreezeNavigationCacheForWorld();
  assert.ok(world.cellVersion > beforeVersion);
  assert.deepEqual(bfsPath(world, 0.5, 10.5, 21.5, 10.5), []);
});

test('baked navigation invalidates and respects full fine blockers', () => {
  const world = makeCorridorWorld();
  setPathContext([], 0);
  assert.equal(bfsPath(world, 0.5, 10.5, 10.5, 10.5).length > 0, true);

  blockCellFully(world, 5, 10);
  unfreezeNavigationCacheForWorld();
  setPathContext([], 0.1);

  assert.deepEqual(bfsPath(world, 0.5, 10.5, 10.5, 10.5), []);
  const actor = npc(90, 0.5);
  assert.equal(tryAssignPathToCell(world, actor, 10, 10), 'not_found');
});

test('followPath treats split-axis drift without waypoint progress as stuck', () => {
  const world = makeCorridorWorld();
  const actor = npc(91, 4.0);
  setPathContext([], 0);
  assert.equal(tryAssignPathToCell(world, actor, 10, 10), 'assigned');

  blockCellFully(world, 5, 10);
  for (let tick = 0; tick < 40; tick++) {
    setPathContext([], tick / 10);
    followPath(world, actor, 0.1); 
  }

  assert.equal(actor.ai!.goal, AIGoal.IDLE);
  assert.equal(actor.ai!.path.length, 0);
  assert.equal(actor.x < 5.1, true);
});

test('routine gotoRoom assigns every caller from baked navigation during samosbor', () => {
  const world = makeCorridorWorld();
  const npcs = [0, 1, 2, 3, 4, 5].map((x, i) => npc(i + 1, x + 0.5));

  setPathContext([], 0, true);
  for (const e of npcs) gotoRoom(world, e, 0);

  let stats = getPathfindingStats();
  assert.equal(stats.routineUsed, 0);
  assert.equal(stats.routineDenied, 0);
  assert.equal(stats.bfsCalls, 1);
  assert.equal(npcs.filter(e => e.ai!.path.length > 0).length, 6);

  setPathContext([], 0.1, true);
  gotoRoom(world, npcs[4], 0);
  stats = getPathfindingStats();
  assert.equal(stats.routineDenied, 0);
  assert.equal(stats.routineDeferred, 0);
  assert.equal(stats.bfsCalls, 0);
  assert.equal(stats.cacheHits >= 1, true);
  assert.ok(npcs[4].ai!.path.length > 0);
});

test('behavior room flow field assigns many actors from one baked field', () => {
  const world = makeCorridorWorld();
  const npcs = [0, 1, 2, 3, 4, 5].map((x, i) => npc(i + 10, x + 0.5));

  setPathContext([], 0);
  for (const e of npcs) {
    assert.notEqual(gotoNearestRoomType(world, e, RoomType.LIVING), 'not_found');
    assertContiguous(e.ai!.path);
  }

  let stats = getPathfindingStats();
  assert.equal(stats.routineDenied, 0);
  assert.equal(stats.routineDeferred, 0);
  assert.equal(stats.bfsCalls, 2);
  assert.equal(npcs.filter(e => e.ai!.path.length > 0).length, 6);

  setPathContext([], 0.1);
  assert.notEqual(gotoNearestRoomType(world, npcs[0], RoomType.LIVING), 'not_found');
  stats = getPathfindingStats();
  assert.equal(stats.bfsCalls, 0);
  assert.equal(stats.cacheHits >= 1, true);
});

test('path steering follows baked path chunks instead of the final point vector', () => {
  const world = makeCornerWorld();
  const player = npc(100, 0);
  player.type = EntityType.NPC;
  player.persistentNpcId = 'player';
  player.x = 0.5;
  player.y = 10.5;

  setPathContext([], 0);
  const steering = steerEntityTowardCell(world, player, 10, 14);

  assert.ok(steering);
  console.log('STEERING:', steering);
  assert.ok(steering.nextCell !== undefined);
});

test('followPath string-pulls visible path cells into organic diagonal movement', () => {
  const world = makeOpenPlazaWorld();
  const actor = npc(200, 0.5);
  actor.y = 10.5;
  actor.ai!.path = [
    subcellIdx(1, 10),
    subcellIdx(1, 11),
    subcellIdx(2, 11),
    subcellIdx(2, 12),
    subcellIdx(3, 12),
    subcellIdx(3, 13),
    subcellIdx(4, 13),
  ];

  followPath(world, actor, 1);

  assert.equal(actor.x > 0.55, true);
  assert.equal(actor.y > 10.55, true);
});

test('followPath keeps corner safety while smoothing a grid path', () => {
  const world = makeCornerWorld();
  const actor = npc(201, 6.5);
  actor.y = 10.5;
  actor.ai!.path = [
    subcellIdx(7, 10),
    subcellIdx(8, 10),
    subcellIdx(9, 10),
    subcellIdx(10, 10),
    subcellIdx(10, 11),
    subcellIdx(10, 12),
    subcellIdx(10, 13),
    subcellIdx(10, 14),
  ];

  followPath(world, actor, 1);

  assert.equal(actor.x > 7.0, true);
  assert.equal(Math.abs(actor.y - 10.5) < 0.08, true);
});

test('followPath prefers a visible final goal over a baked tree detour', () => {
  const world = makeOpenPlazaWorld();
  const actor = npc(202, 0.5);
  actor.y = 10.5;
  actor.ai!.tx = 4.5;
  actor.ai!.ty = 10.5;
  actor.ai!.path = [
    subcellIdx(0, 11),
    subcellIdx(0, 12),
    subcellIdx(1, 12),
    subcellIdx(2, 12),
    subcellIdx(3, 12),
    subcellIdx(4, 12),
    subcellIdx(4, 11),
    subcellIdx(4, 10),
  ];

  followPath(world, actor, 1);

  assert.equal(actor.x > 1.0, true);
  assert.equal(Math.abs(actor.y - 10.5) < 0.12, true);
});
