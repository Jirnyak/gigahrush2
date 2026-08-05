import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, Feature, FloorLevel, LiftDirection, RoomType, W, ZoneFaction, type Room } from '../src/core/types';
import { auditReachability, hasReachableAdjacentCell, type ReachabilityAudit } from '../src/core/world';
import { HUMAN_TERRITORY_OWNERS } from '../src/data/factions';
import { territorySharesForStoryFloor } from '../src/data/floor_territory';
import { generateFloor, type FloorGeneration } from '../src/gen/floor_manifest';
import { VOID_DEAD_LAMP_ROWS, VOID_GEOMETRY_ANCHORS } from '../src/gen/void/geometry';
import { countTerritoryCells, territoryHqAnchors, territoryRoomOwner } from '../src/systems/territory';

const VOID_TEST_SEED = 0x140014;

let cachedVoidGeneration: FloorGeneration | undefined;

function voidFloorForRead(): FloorGeneration {
  cachedVoidGeneration ??= generateFloor(FloorLevel.VOID, VOID_TEST_SEED);
  return cachedVoidGeneration;
}

function startAudit(gen: FloorGeneration): ReachabilityAudit {
  return auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
}

function walkableCount(gen: FloorGeneration): number {
  let count = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    const cell = gen.world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER) count++;
  }
  return count;
}

function reachableCount(audit: ReachabilityAudit): number {
  let count = 0;
  for (const value of audit.reachable) count += value;
  return count;
}

function reachableBucketCount(gen: FloorGeneration, audit: ReachabilityAudit, bucketSize: number): number {
  const side = Math.ceil(W / bucketSize);
  const buckets = new Uint8Array(side * side);
  let count = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (!audit.reachable[i]) continue;
    const cell = gen.world.cells[i];
    if (cell !== Cell.FLOOR && cell !== Cell.DOOR && cell !== Cell.WATER && cell !== Cell.LIFT) continue;
    const x = i % W;
    const y = (i / W) | 0;
    const bucket = Math.min(side - 1, Math.floor(y / bucketSize)) * side + Math.min(side - 1, Math.floor(x / bucketSize));
    if (buckets[bucket]) continue;
    buckets[bucket] = 1;
    count++;
  }
  return count;
}

function reachableLift(gen: FloorGeneration, audit: ReachabilityAudit, direction: LiftDirection): boolean {
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (gen.world.cells[i] === Cell.LIFT && gen.world.liftDir[i] === direction && hasReachableAdjacentCell(gen.world, audit, i)) {
      return true;
    }
  }
  return false;
}

function reachableRoom(gen: FloorGeneration, audit: ReachabilityAudit, name: string): boolean {
  const room = gen.world.rooms.find(candidate => candidate.name === name);
  assert.ok(room, `missing room ${name}`);
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (gen.world.roomMap[i] === room.id && audit.reachable[i]) return true;
  }
  return false;
}

function maxLightNear(gen: FloorGeneration, x: number, y: number, radius: number): number {
  let best = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const light = gen.world.light[gen.world.idx(x + dx, y + dy)];
      if (light > best) best = light;
    }
  }
  return best;
}

function countDeadFixtureRowCells(gen: FloorGeneration): number {
  let count = 0;
  for (const [ax, ay, bx, by] of VOID_DEAD_LAMP_ROWS) {
    const ddx = gen.world.delta(ax, bx);
    const ddy = gen.world.delta(ay, by);
    const steps = Math.max(1, Math.abs(ddx), Math.abs(ddy));
    for (let step = 0; step <= steps; step += 4) {
      const x = gen.world.wrap(Math.round(ax + (ddx * step) / steps));
      const y = gen.world.wrap(Math.round(ay + (ddy * step) / steps));
      const feature = gen.world.features[gen.world.idx(x, y)];
      if (feature === Feature.APPARATUS || feature === Feature.SCREEN) count++;
    }
  }
  return count;
}

function hermeticShellCells(gen: FloorGeneration, room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (gen.world.hermoWall[gen.world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

function nearbySupportRooms(gen: FloorGeneration, hq: Room): number {
  const cx = hq.x + (hq.w >> 1);
  const cy = hq.y + (hq.h >> 1);
  let count = 0;
  for (const room of gen.world.rooms) {
    if (!room || room.id === hq.id || room.type === RoomType.HQ) continue;
    if (
      room.type !== RoomType.KITCHEN &&
      room.type !== RoomType.BATHROOM &&
      room.type !== RoomType.STORAGE &&
      room.type !== RoomType.MEDICAL &&
      room.type !== RoomType.OFFICE &&
      room.type !== RoomType.PRODUCTION &&
      room.type !== RoomType.COMMON
    ) continue;
    if (gen.world.dist2(cx, cy, room.x + (room.w >> 1), room.y + (room.h >> 1)) <= 90 * 90) count++;
  }
  return count;
}

test('VOID story floor uses a reachable impossible graph with expanded route-scale structure', () => {
  const gen = voidFloorForRead();
  const audit = startAudit(gen);
  const walkable = walkableCount(gen);

  assert.equal(reachableCount(audit), walkable);
  assert.equal(gen.world.rooms.length >= 430, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 430, true, `doors ${gen.world.doors.size}`);
  assert.equal(walkable >= 300_000, true, `walkable ${walkable}`);
  assert.equal(reachableBucketCount(gen, audit, 64) >= 220, true, 'reachable buckets cover the route-scale map');
  assert.equal(reachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(reachableLift(gen, audit, LiftDirection.DOWN), true);
  assert.equal(reachableRoom(gen, audit, 'Световой карман'), true);
  assert.equal(reachableRoom(gen, audit, 'Пустотный повторитель'), true);
  assert.equal(reachableRoom(gen, audit, 'Протокольная П-46'), true);
  assert.equal(reachableRoom(gen, audit, 'Касса заемного света'), true);

  const [bossX, bossY] = VOID_GEOMETRY_ANCHORS.boss;
  assert.equal(audit.reachable[gen.world.idx(bossX, bossY)], 1);
});

test('VOID story floor exposes light pockets, listening shells and dead lamp rows', () => {
  const gen = voidFloorForRead();
  const [lightX, lightY] = VOID_GEOMETRY_ANCHORS.lightPocket;
  const [listenX, listenY] = VOID_GEOMETRY_ANCHORS.listeningRoute;
  const [protocolX, protocolY] = VOID_GEOMETRY_ANCHORS.protocolFrame;
  const [fallbackX, fallbackY] = VOID_GEOMETRY_ANCHORS.fallbackBridge;
  const [bossX, bossY] = VOID_GEOMETRY_ANCHORS.boss;
  let litWalkable = 0;

  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    if ((cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER) && gen.world.light[i] > 0.12) litWalkable++;
  }

  assert.equal(maxLightNear(gen, lightX, lightY, 5) > 0.42, true);
  assert.equal(maxLightNear(gen, listenX, listenY, 6) > 0.18, true);
  assert.equal(maxLightNear(gen, protocolX, protocolY, 6) > 0.20, true);
  assert.equal(maxLightNear(gen, fallbackX, fallbackY, 7) > 0.10, true);
  assert.equal(maxLightNear(gen, bossX, bossY, 6) > 0.48, true);
  assert.equal(countDeadFixtureRowCells(gen) >= 24, true);
  assert.equal(litWalkable > 800, true);
  assert.equal(litWalkable < walkableCount(gen) / 2, true);
});

test('VOID story floor has cell-first faction shares and human mini-HQ anchors', () => {
  const gen = voidFloorForRead();
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const totalCells = W * W;
  const targets = territorySharesForStoryFloor(FloorLevel.VOID);
  const targetTotal = targets.reduce((sum, row) => sum + row.share, 0);
  let dominantOwner = ZoneFaction.CITIZEN;

  for (const target of targets) {
    const share = (counts.get(target.owner) ?? 0) / totalCells;
    const expected = target.share / targetTotal;
    assert.equal(Math.abs(share - expected) <= 0.025, true, `${ZoneFaction[target.owner]} share ${share.toFixed(3)} expected ${expected.toFixed(3)}`);
  }

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor for ${ZoneFaction[owner]}`);
    const cells = counts.get(owner) ?? 0;
    assert.equal(cells > 0, true, `owned cells for ${ZoneFaction[owner]}`);
    if (cells > (counts.get(dominantOwner) ?? 0)) dominantOwner = owner;
  }
  assert.equal(dominantOwner, ZoneFaction.WILD);
  assert.equal((counts.get(ZoneFaction.SAMOSBOR) ?? 0) > 0, true, 'samosbor pressure territory exists');

  for (const anchor of anchors) {
    if (!HUMAN_TERRITORY_OWNERS.includes(anchor.owner)) continue;
    const room = gen.world.rooms[anchor.roomId];
    assert.ok(room, `HQ room for ${ZoneFaction[anchor.owner]}`);
    assert.equal(room.type, RoomType.HQ, `HQ type for ${ZoneFaction[anchor.owner]}`);
    assert.equal(room.sealed, true, `sealed HQ for ${ZoneFaction[anchor.owner]}`);
    assert.equal(territoryRoomOwner(gen.world, room.id), anchor.owner, `HQ owner for ${ZoneFaction[anchor.owner]}`);
    assert.equal(hermeticShellCells(gen, room) > 0, true, `hermetic shell for ${ZoneFaction[anchor.owner]}`);
    assert.equal(nearbySupportRooms(gen, room) >= 4, true, `support rooms for ${ZoneFaction[anchor.owner]}`);
  }
});
