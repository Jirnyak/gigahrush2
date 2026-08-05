import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, DoorState, LiftDirection, RoomType, W, ZoneFaction, type Room } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import { countTerritoryCells, territoryHqAnchors } from '../src/systems/territory';

const TARGET_SHARES = new Map<ZoneFaction, number>([
  [ZoneFaction.CITIZEN, 0.18],
  [ZoneFaction.LIQUIDATOR, 0.36],
  [ZoneFaction.CULTIST, 0.08],
  [ZoneFaction.SCIENTIST, 0.24],
  [ZoneFaction.WILD, 0.14],
]);

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

function reachableLift(world: ReturnType<typeof generateDesignFloor>['world'], reachable: Uint8Array, direction: LiftDirection): boolean {
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    if (reachable[world.idx(x + 1, y)] || reachable[world.idx(x - 1, y)] || reachable[world.idx(x, y + 1)] || reachable[world.idx(x, y - 1)]) return true;
  }
  return false;
}

test('antenna court expands into mid/micro rooms and five cell-first territories', () => {
  const gen = generateDesignFloor('antenna_court', 61_061);
  const world = gen.world;
  const audit = auditReachability(world, world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const reachableCells = audit.reachable.reduce((sum, value) => sum + value, 0);
  const microRooms = world.rooms.filter(room =>
    room.name.includes('малые радиокомнаты') ||
    room.name.includes('сектор') ||
    room.name.includes('ячейки'));
  const hqAnchors = territoryHqAnchors(world);
  const counts = countTerritoryCells(world);
  const totalCells = counts.reduce((sum, row) => sum + row.cells, 0);
  const countByOwner = new Map(counts.map(row => [row.owner, row.cells]));
  const liquidatorCells = countByOwner.get(ZoneFaction.LIQUIDATOR) ?? 0;

  assert.equal(world.rooms.length >= 400, true, `rooms ${world.rooms.length}`);
  assert.equal(world.doors.size >= 400, true, `doors ${world.doors.size}`);
  assert.equal(microRooms.length >= 280, true, `micro rooms ${microRooms.length}`);
  assert.equal(reachableCells >= 220_000, true, `reachable ${reachableCells}`);
  assert.equal(reachableLift(world, audit.reachable, LiftDirection.UP), true);
  assert.equal(reachableLift(world, audit.reachable, LiftDirection.DOWN), true);
  assert.equal([...world.doors.values()].some(door => door.state === DoorState.HERMETIC_OPEN), true);

  for (const [owner, targetShare] of TARGET_SHARES) {
    const cells = countByOwner.get(owner) ?? 0;
    const share = cells / totalCells;
    const anchor = hqAnchors.find(candidate => candidate.owner === owner);
    assert.equal(cells > 0, true, `cells for ${owner}`);
    assert.equal(Math.abs(share - targetShare) <= 0.025, true, `owner ${owner} share ${share}`);
    assert.ok(anchor, `HQ anchor for ${owner}`);
    const room = world.rooms[anchor.roomId];
    assert.equal(room.type === RoomType.HQ, true, `HQ type for ${owner}`);
    assert.equal(room.sealed, true, `sealed HQ for ${owner}`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `hermetic shell for ${owner}`);
  }

  for (const row of counts) {
    if (row.owner === ZoneFaction.SAMOSBOR) continue;
    assert.equal(liquidatorCells >= row.cells, true, `liquidators dominant over ${row.owner}`);
  }
});
