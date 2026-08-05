import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, FloorLevel, RoomType, W, ZoneFaction, type Room } from '../src/core/types';
import { HUMAN_TERRITORY_OWNERS } from '../src/data/factions';
import { generateFloor, type FloorGeneration } from '../src/gen/floor_manifest';
import { World } from '../src/core/world';
import { countTerritoryCells, territoryHqAnchors } from '../src/systems/territory';

const MINISTRY_TARGET_SHARES = new Map<ZoneFaction, number>([
  [ZoneFaction.CITIZEN, 0.48],
  [ZoneFaction.LIQUIDATOR, 0.24],
  [ZoneFaction.CULTIST, 0.08],
  [ZoneFaction.SCIENTIST, 0.14],
  [ZoneFaction.WILD, 0.06],
]);

function unlockedWalkable(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.LIFT) return true;
  if (cell !== Cell.DOOR) return false;
  const door = world.doors.get(idx);
  return door?.state !== DoorState.LOCKED;
}

function unlockedReachability(world: World, spawnX: number, spawnY: number): Uint8Array {
  const start = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  const reachable = new Uint8Array(W * W);
  if (!unlockedWalkable(world, start)) return reachable;

  const q = [start];
  reachable[start] = 1;
  let head = 0;
  while (head < q.length) {
    const idx = q[head++];
    const x = idx % W;
    const y = (idx / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = world.idx(x + dx, y + dy);
      if (reachable[next] || !unlockedWalkable(world, next)) continue;
      reachable[next] = 1;
      q.push(next);
    }
  }
  return reachable;
}

function roomReachable(gen: FloorGeneration, reachable: Uint8Array, name: string): boolean {
  const room = gen.world.rooms.find(candidate => candidate?.name === name);
  assert.ok(room, `${name} exists`);
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = gen.world.idx(room.x + dx, room.y + dy);
      if (gen.world.roomMap[idx] === room.id && reachable[idx]) return true;
    }
  }
  return false;
}

function reachableLiftCount(world: World, reachable: Uint8Array): number {
  let count = 0;
  for (let idx = 0; idx < world.cells.length; idx++) {
    if (world.cells[idx] === Cell.LIFT && reachable[idx]) count++;
  }
  return count;
}

function hermeticShellCells(world: World, room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (world.hermoWall[world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

function nearbySupportRooms(world: World, hq: Room): number {
  const cx = hq.x + (hq.w >> 1);
  const cy = hq.y + (hq.h >> 1);
  let count = 0;
  for (const room of world.rooms) {
    if (!room || room.id === hq.id || room.type === RoomType.HQ) continue;
    if (
      room.type !== RoomType.KITCHEN &&
      room.type !== RoomType.BATHROOM &&
      room.type !== RoomType.STORAGE &&
      room.type !== RoomType.MEDICAL &&
      room.type !== RoomType.OFFICE &&
      room.type !== RoomType.COMMON
    ) continue;
    if (world.dist2(cx, cy, room.x + (room.w >> 1), room.y + (room.h >> 1)) <= 72 * 72) count++;
  }
  return count;
}

test('ministry macro landmarks are navigable without authority keys', () => {
  const gen = generateFloor(FloorLevel.MINISTRY, 20_260_530);
  const world = gen.world;
  const reachable = unlockedReachability(world, gen.spawnX, gen.spawnY);
  const crossBooths = world.rooms.filter(room => room.name.startsWith('Окно центрального креста'));

  assert.equal(world.rooms.length >= 650, true, `rooms ${world.rooms.length}`);
  assert.equal(world.doors.size >= 650, true, `doors ${world.doors.size}`);
  assert.equal(crossBooths.length >= 32, true, `central cross booths ${crossBooths.length}`);
  for (const [x, y] of [[24, W / 2], [W - 24, W / 2], [W / 2, 24], [W / 2, W - 24]] as const) {
    assert.equal(world.cells[world.idx(x, y)], Cell.FLOOR, `central cross reaches ${x},${y}`);
  }

  assert.equal(roomReachable(gen, reachable, 'Портретный зал центральных подписей'), true);
  assert.equal(roomReachable(gen, reachable, 'Клетка клерков временной выдачи'), true);
  assert.equal(roomReachable(gen, reachable, 'Копировальная комната мокрых справок'), true);
  assert.equal(roomReachable(gen, reachable, 'Жалобная яма с обратной нумерацией'), true);

  const seal = world.rooms.find(room => room?.name === 'Шкаф гербовых печатей');
  assert.ok(seal, 'seal cabinet exists');
  assert.equal(seal.doors.length, 1, 'seal cabinet is a leaf room');
  const sealDoor = world.doors.get(seal.doors[0]);
  assert.equal(sealDoor?.state, DoorState.LOCKED);
  assert.equal(sealDoor?.keyId, 'key');

  let reachableOutsideSeal = false;
  const doorX = seal.doors[0] % W;
  const doorY = (seal.doors[0] / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const idx = world.idx(doorX + dx, doorY + dy);
    if (world.roomMap[idx] !== seal.id && reachable[idx]) reachableOutsideSeal = true;
  }
  assert.equal(reachableOutsideSeal, true, 'locked seal cabinet sits on a reachable optional branch');

  let lockedDoors = 0;
  for (const door of world.doors.values()) {
    if (door.state === DoorState.LOCKED) lockedDoors++;
  }
  assert.equal(lockedDoors > 0, true, 'ministry has optional locked authority doors');
  assert.equal(reachableLiftCount(world, reachable), 16, 'all ministry lifts remain reachable without locked doors');

  const hqAnchors = territoryHqAnchors(world);
  const hqByOwner = new Map(hqAnchors.map(anchor => [anchor.owner, anchor]));
  const counts = countTerritoryCells(world);
  const countByOwner = new Map(counts.map(row => [row.owner, row.cells]));
  const totalCells = counts.reduce((sum, row) => sum + row.cells, 0);
  let dominantOwner = ZoneFaction.CITIZEN;
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const anchor = hqByOwner.get(owner);
    assert.ok(anchor, `HQ anchor for ${ZoneFaction[owner]}`);
    const room = world.rooms[anchor.roomId];
    assert.ok(room, `HQ room for ${ZoneFaction[owner]}`);
    assert.equal(room.type, RoomType.HQ, `HQ type for ${ZoneFaction[owner]}`);
    assert.equal(room.sealed, true, `sealed HQ for ${ZoneFaction[owner]}`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `hermetic shell for ${ZoneFaction[owner]}`);
    assert.equal(nearbySupportRooms(world, room) >= 4, true, `support rooms for ${ZoneFaction[owner]}`);

    const cells = countByOwner.get(owner) ?? 0;
    const share = cells / totalCells;
    const target = MINISTRY_TARGET_SHARES.get(owner) ?? 0;
    assert.equal(cells > 0, true, `territory cells for ${ZoneFaction[owner]}`);
    assert.equal(Math.abs(share - target) <= 0.025, true, `${ZoneFaction[owner]} share ${share.toFixed(3)}`);
    if (cells > (countByOwner.get(dominantOwner) ?? 0)) dominantOwner = owner;
  }
  assert.equal(dominantOwner, ZoneFaction.CITIZEN);
});
