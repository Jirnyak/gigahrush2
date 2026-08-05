import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, LiftDirection, RoomType, W, ZoneFaction, type Room } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { territorySharesForDesignFloor } from '../src/data/floor_territory';
import { HUMAN_TERRITORY_OWNERS } from '../src/data/factions';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { countTerritoryCells, territoryHqAnchors, territoryRoomOwner } from '../src/systems/territory';

function passableCells(world: ReturnType<typeof generateDesignFloor>['world']): number {
  let count = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function reachableCells(reachable: Uint8Array): number {
  let count = 0;
  for (const value of reachable) count += value;
  return count;
}

function reachableLift(world: ReturnType<typeof generateDesignFloor>['world'], reachable: Uint8Array, direction: LiftDirection): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    if (reachable[world.idx(x + 1, y)] || reachable[world.idx(x - 1, y)] || reachable[world.idx(x, y + 1)] || reachable[world.idx(x, y - 1)]) return true;
  }
  return false;
}

function hermeticShellCells(world: ReturnType<typeof generateDesignFloor>['world'], room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (world.hermoWall[world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

function nearbySupportRooms(world: ReturnType<typeof generateDesignFloor>['world'], hq: Room): number {
  const cx = hq.x + (hq.w >> 1);
  const cy = hq.y + (hq.h >> 1);
  let count = 0;
  for (const room of world.rooms) {
    if (room.id === hq.id) continue;
    if (
      room.type !== RoomType.KITCHEN &&
      room.type !== RoomType.BATHROOM &&
      room.type !== RoomType.STORAGE &&
      room.type !== RoomType.MEDICAL &&
      room.type !== RoomType.OFFICE &&
      room.type !== RoomType.COMMON
    ) continue;
    if (world.dist2(cx, cy, room.x + (room.w >> 1), room.y + (room.h >> 1)) <= 112 * 112) count++;
  }
  return count;
}

test('genfix 091 podad preserves living-tunnel macro while adding mid/micro rooms and cell territory', () => {
  const gen = generateDesignFloor('podad', 61061);
  const world = gen.world;
  const audit = auditReachability(world, world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const reachable = reachableCells(audit.reachable);
  const microRooms = world.rooms.filter(room => room.name.includes('Микрокиста Подада'));
  const organStations = world.rooms.filter(room => room.name.includes('Станция органа Подада'));
  const scarYards = world.rooms.filter(room => room.name.includes('Рубец самосбора Подада'));
  const taggedHqs = world.rooms.filter(room => room.name.includes('[podad_hq:'));
  const hasDownLift = world.cells.some((cell, idx) => cell === Cell.LIFT && world.liftDir[idx] === LiftDirection.DOWN);

  assert.equal(world.rooms.length >= 260, true, `rooms ${world.rooms.length}`);
  assert.equal(world.doors.size >= 600, true, `doors ${world.doors.size}`);
  assert.equal(passableCells(world) >= 280_000, true, `passable ${passableCells(world)}`);
  assert.equal(reachable >= 280_000, true, `reachable ${reachable}`);
  assert.equal(microRooms.length >= 190, true, `micro rooms ${microRooms.length}`);
  assert.equal(organStations.length >= 28, true, `organ stations ${organStations.length}`);
  assert.equal(scarYards.length >= 4, true, `scar yards ${scarYards.length}`);
  assert.equal(taggedHqs.length, 5);
  assert.equal(reachableLift(world, audit.reachable, LiftDirection.UP), true);
  assert.equal(hasDownLift, false);

  const anchors = territoryHqAnchors(world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const counts = new Map(countTerritoryCells(world).map(row => [row.owner, row.cells]));
  const totalCells = W * W;
  const targetRows = territorySharesForDesignFloor('podad');
  const targetTotal = targetRows.reduce((sum, row) => sum + row.share, 0);
  const dominant = [...counts.entries()]
    .filter(([owner]) => owner !== ZoneFaction.SAMOSBOR)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells ${ZoneFaction[owner]}`);
  }
  assert.equal(dominant, ZoneFaction.CULTIST);
  assert.equal((counts.get(ZoneFaction.SAMOSBOR) ?? 0) > 0, true, 'samosbor pressure cells');

  for (const target of targetRows) {
    const actualShare = (counts.get(target.owner) ?? 0) / totalCells;
    const expectedShare = target.share / targetTotal;
    assert.equal(Math.abs(actualShare - expectedShare) <= 0.03, true, `${ZoneFaction[target.owner]} share ${actualShare.toFixed(3)}`);
  }

  for (const anchor of anchors) {
    const room = world.rooms[anchor.roomId];
    assert.equal(room.type, RoomType.HQ, `HQ type ${ZoneFaction[anchor.owner]}`);
    assert.equal(room.sealed, true, `sealed HQ ${ZoneFaction[anchor.owner]}`);
    assert.equal(territoryRoomOwner(world, room.id), anchor.owner, `HQ owner ${ZoneFaction[anchor.owner]}`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `hermetic shell ${ZoneFaction[anchor.owner]}`);
    assert.equal(nearbySupportRooms(world, room) >= 2, true, `support rooms ${ZoneFaction[anchor.owner]}`);
  }
});
