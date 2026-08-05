import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, RoomType, W, ZoneFaction, type Room } from '../src/core/types';
import { hashSeed, withSeededRandom } from '../src/core/rand';
import { auditReachability } from '../src/core/world';
import { designFloorById } from '../src/data/design_floors';
import { territorySharesForDesignFloor } from '../src/data/floor_territory';
import { applyDesignFloorObjectProfile } from '../src/gen/floor_object_placement';
import { expandDesignFloorGeneration, retuneDesignFloorAfterCellTerritory } from '../src/gen/design_floors/full_floor';
import { generateManhattanCrossroadsDesignFloor } from '../src/gen/design_floors/manhattan_crossroads';
import { floorRunZAllowsNpcs } from '../src/data/procedural_floors';
import { withoutNpcEntities } from '../src/gen/entity_filters';
import type { FloorGeneration } from '../src/gen/floor_manifest';
import {
  countTerritoryCells,
  initializeCellTerritory,
  territoryHqAnchors,
  territoryRoomOwner,
} from '../src/systems/territory';

const ROAD_CENTERS = [104, 232, 344, 512, 680, 792, 920] as const;
const TARGET_SHARES = new Map<ZoneFaction, number>([
  [ZoneFaction.CITIZEN, 0.44],
  [ZoneFaction.LIQUIDATOR, 0.22],
  [ZoneFaction.CULTIST, 0.10],
  [ZoneFaction.SCIENTIST, 0.10],
  [ZoneFaction.WILD, 0.14],
]);

function generateManhattanForTest(runSeed: number): FloorGeneration {
  const route = designFloorById('manhattan_crossroads');
  assert.ok(route);
  const seed = hashSeed('design-floor:manhattan_crossroads', runSeed);
  return withSeededRandom(seed, () => {
    const gen = generateManhattanCrossroadsDesignFloor();
    const expanded = expandDesignFloorGeneration(gen, route);
    applyDesignFloorObjectProfile(expanded.world, expanded.spawnX, expanded.spawnY, route);
    initializeCellTerritory(expanded.world, {
      seed,
      targetShares: territorySharesForDesignFloor('manhattan_crossroads'),
    });
    retuneDesignFloorAfterCellTerritory(expanded.world, 'manhattan_crossroads');
    return floorRunZAllowsNpcs(route.z) ? expanded : withoutNpcEntities(expanded);
  });
}

function passableRoadCell(world: FloorGeneration['world'], x: number, y: number): boolean {
  const cell = world.cells[world.idx(x, y)];
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.LIFT;
}

function roadEdgeCells(
  world: FloorGeneration['world'],
  center: number,
  axis: 'vertical' | 'horizontal',
): number {
  let count = 0;
  const edgeBands = [0, W - 25] as const;
  for (const start of edgeBands) {
    for (let main = start; main < start + 25; main++) {
      for (let offset = -4; offset <= 4; offset++) {
        const x = axis === 'vertical' ? center + offset : main;
        const y = axis === 'vertical' ? main : center + offset;
        if (passableRoadCell(world, x, y)) count++;
      }
    }
  }
  return count;
}

function countReachableCells(reachable: Uint8Array): number {
  return reachable.reduce((sum, value) => sum + value, 0);
}

function hermeticShellCells(world: FloorGeneration['world'], room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (world.hermoWall[world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

test('genfix 043 manhattan crossroads reaches edge roads with dense rooms and cell-first HQ territory', () => {
  const gen = generateManhattanForTest(61_061);
  const world = gen.world;
  const audit = auditReachability(world, world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const microRooms = world.rooms.filter(room =>
    room.name.startsWith('Микролавка перекрестка') ||
    room.name.startsWith('Внутренний квартал')
  );
  const supportRooms = world.rooms.filter(room => room.name.includes('штаба'));
  const hqAnchors = territoryHqAnchors(world);
  const hqOwners = new Set(hqAnchors.map(anchor => anchor.owner));
  const counts = countTerritoryCells(world);
  const totalCells = counts.reduce((sum, row) => sum + row.cells, 0);
  const countByOwner = new Map(counts.map(row => [row.owner, row.cells]));

  assert.equal(world.rooms.length >= 700, true, `rooms ${world.rooms.length}`);
  assert.equal(world.doors.size >= 800, true, `doors ${world.doors.size}`);
  assert.equal(microRooms.length >= 650, true, `micro rooms ${microRooms.length}`);
  assert.equal(supportRooms.length >= 25, true, `support rooms ${supportRooms.length}`);
  assert.equal(countReachableCells(audit.reachable) >= 320_000, true);

  for (const center of ROAD_CENTERS) {
    assert.equal(roadEdgeCells(world, center, 'vertical') >= 120, true, `vertical road edge ${center}`);
    assert.equal(roadEdgeCells(world, center, 'horizontal') >= 120, true, `horizontal road edge ${center}`);
  }

  for (const [owner, targetShare] of TARGET_SHARES) {
    const cells = countByOwner.get(owner) ?? 0;
    const share = cells / totalCells;
    const anchor = hqAnchors.find(candidate => candidate.owner === owner);
    assert.equal(cells > 0, true, `territory cells for ${ZoneFaction[owner]}`);
    assert.equal(Math.abs(share - targetShare) <= 0.025, true, `territory share ${ZoneFaction[owner]}: ${share}`);
    assert.equal(hqOwners.has(owner), true, `HQ owner ${ZoneFaction[owner]}`);
    assert.ok(anchor, `HQ anchor ${ZoneFaction[owner]}`);
    const room = world.rooms[anchor.roomId];
    assert.equal(room.type, RoomType.HQ, `HQ room type ${ZoneFaction[owner]}`);
    assert.equal(room.sealed, true, `HQ sealed ${ZoneFaction[owner]}`);
    assert.equal(territoryRoomOwner(world, room.id), owner, `HQ cell owner ${ZoneFaction[owner]}`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `HQ hermetic shell ${ZoneFaction[owner]}`);
  }

  assert.equal((countByOwner.get(ZoneFaction.CITIZEN) ?? 0) > (countByOwner.get(ZoneFaction.LIQUIDATOR) ?? 0), true);
});
