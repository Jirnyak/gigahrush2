import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Cell, EntityType, FloorLevel, RoomType, W, ZoneFaction, type Room, type TerritoryOwner } from '../src/core/types';
import { auditReachability, type World } from '../src/core/world';
import { HUMAN_TERRITORY_OWNERS, territoryOwnerName } from '../src/data/factions';
import { generateFloor } from '../src/gen/floor_manifest';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAt,
  territoryRoomOwner,
} from '../src/systems/territory';

const LIVING_TARGET_SHARES: readonly { owner: TerritoryOwner; share: number }[] = [
  { owner: ZoneFaction.CITIZEN, share: 0.64 },
  { owner: ZoneFaction.LIQUIDATOR, share: 0.14 },
  { owner: ZoneFaction.CULTIST, share: 0.06 },
  { owner: ZoneFaction.SCIENTIST, share: 0.07 },
  { owner: ZoneFaction.WILD, share: 0.09 },
];

function passableCellCount(world: World): number {
  let count = 0;
  for (const cell of world.cells) {
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function wallCellCount(world: World): number {
  let count = 0;
  for (const cell of world.cells) {
    if (cell === Cell.WALL) count++;
  }
  return count;
}

function reachableCellCount(world: World, spawnX: number, spawnY: number): number {
  const audit = auditReachability(world, world.idx(Math.floor(spawnX), Math.floor(spawnY)));
  let count = 0;
  for (const value of audit.reachable) count += value;
  return count;
}

function territoryShares(world: World): Map<TerritoryOwner, number> {
  const total = W * W;
  return new Map(countTerritoryCells(world).map(row => [row.owner, row.cells / total]));
}

function mappedAptCells(world: World, room: Room): number {
  let count = 0;
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const idx = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[idx] === room.id && world.aptMask[idx]) count++;
    }
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
    if (!room || room.id === hq.id || room.type === RoomType.HQ || room.apartmentId >= 0) continue;
    if (
      room.type !== RoomType.KITCHEN &&
      room.type !== RoomType.BATHROOM &&
      room.type !== RoomType.STORAGE &&
      room.type !== RoomType.MEDICAL &&
      room.type !== RoomType.OFFICE &&
      room.type !== RoomType.COMMON
    ) continue;
    if (world.dist2(cx, cy, room.x + (room.w >> 1), room.y + (room.h >> 1)) <= 96 * 96) count++;
  }
  return count;
}

test('genfix 051 living floor preserves reference geometry and cell-first territory HQs', () => {
  const gen = generateFloor(FloorLevel.LIVING, 61_061);
  const world = gen.world;

  assert.equal(world.rooms.length >= 9_500 && world.rooms.length <= 12_500, true, `living reference room count: ${world.rooms.length}`);
  assert.equal(world.doors.size >= 1_900 && world.doors.size <= 2_800, true, `living reference door count: ${world.doors.size}`);
  assert.equal(world.containers.length >= 50 && world.containers.length <= 150, true, `living reference container count: ${world.containers.length}`);
  assert.equal(gen.entities.length >= 8_000 && gen.entities.length <= 11_000, true, `living reference entity count: ${gen.entities.length}`);
  assert.equal(reachableCellCount(world, gen.spawnX, gen.spawnY) >= 380_000 && reachableCellCount(world, gen.spawnX, gen.spawnY) <= 450_000, true, `living reference reachability: ${reachableCellCount(world, gen.spawnX, gen.spawnY)}`);
  assert.equal(passableCellCount(world) >= 390_000 && passableCellCount(world) <= 460_000, true, `living reference passable cells: ${passableCellCount(world)}`);
  assert.equal(wallCellCount(world) >= 590_000 && wallCellCount(world) <= 650_000, true, `living reference wall cells: ${wallCellCount(world)}`);

  for (const plotNpcId of [
    'shurik_baryga',
    'market_guard_lysyy',
    'market_guard_kaban',
    'blood_plant_senya_red_mold',
    'blood_plant_raya_witness',
    'blood_plant_tikhon_spore',
    'ag17_mira_triage',
    'ag16_nina_obzh',
    'ag03_pasha_concierge',
    'ag03r2_zoya_laundry',
    'ag108_nina_tariff',
    'ag43_seva_cartographer',
    'batushka',
  ]) {
    const npc = gen.entities.find(entity => entity.type === EntityType.NPC && entity.plotNpcId === plotNpcId);
    assert.ok(npc, `${plotNpcId} should spawn on the Living floor`);
    assert.equal(npc.npcPackageId, plotNpcId, `${plotNpcId} should be package-backed`);
  }

  const shares = territoryShares(world);
  let dominantOwner = ZoneFaction.CITIZEN;
  for (const target of LIVING_TARGET_SHARES) {
    const actual = shares.get(target.owner) ?? 0;
    assert.equal(Math.abs(actual - target.share) <= 0.025, true, `${territoryOwnerName(target.owner)} share ${actual}`);
    if (actual > (shares.get(dominantOwner) ?? 0)) dominantOwner = target.owner;
  }
  assert.equal(dominantOwner, ZoneFaction.CITIZEN, 'citizens remain the dominant owner');

  const anchors = territoryHqAnchors(world);
  const hqByOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const anchor = hqByOwner.get(owner);
    assert.ok(anchor, `${territoryOwnerName(owner)} HQ anchor`);
    const room = world.rooms[anchor.roomId];
    assert.ok(room, `${territoryOwnerName(owner)} HQ room`);
    assert.equal(room.type, RoomType.HQ, `${territoryOwnerName(owner)} HQ type`);
    assert.equal(room.sealed, true, `${territoryOwnerName(owner)} sealed HQ`);
    assert.equal(room.apartmentId, -1, `${territoryOwnerName(owner)} HQ is not an apartment`);
    assert.equal(mappedAptCells(world, room), 0, `${territoryOwnerName(owner)} HQ does not overwrite apartment cells`);
    assert.equal(territoryRoomOwner(world, room.id), owner, `${territoryOwnerName(owner)} room owner`);
    assert.equal(territoryOwnerAt(world, anchor.x, anchor.y), owner, `${territoryOwnerName(owner)} anchor cell owner`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `${territoryOwnerName(owner)} hermetic shell`);
    assert.equal(nearbySupportRooms(world, room) >= 4, true, `${territoryOwnerName(owner)} support rooms`);
  }

  for (let i = 0; i < anchors.length; i++) {
    for (let j = i + 1; j < anchors.length; j++) {
      assert.equal(
        world.dist2(anchors[i].x, anchors[i].y, anchors[j].x, anchors[j].y) > 96 * 96,
        true,
        `${territoryOwnerName(anchors[i].owner)} and ${territoryOwnerName(anchors[j].owner)} HQs are distinct`,
      );
    }
  }
});
