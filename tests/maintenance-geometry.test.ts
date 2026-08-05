import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  EntityType,
  Faction,
  FloorLevel,
  Occupation,
  RoomType,
  W,
  ZoneFaction,
  type Entity,
  type Room,
  type TerritoryOwner,
} from '../src/core/types';
import type { World } from '../src/core/world';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner, territoryOwnerName } from '../src/data/factions';
import { generateFloor } from '../src/gen/floor_manifest';
import { getEmergencyPanels } from '../src/systems/emergency_panels';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAt,
  territoryRoomOwner,
} from '../src/systems/territory';
import { assertReachableRouteLifts } from './generator_helpers';

const MAINTENANCE_TARGET_SHARES: readonly { owner: TerritoryOwner; share: number }[] = [
  { owner: ZoneFaction.CITIZEN, share: 0.16 },
  { owner: ZoneFaction.LIQUIDATOR, share: 0.58 },
  { owner: ZoneFaction.CULTIST, share: 0.05 },
  { owner: ZoneFaction.SCIENTIST, share: 0.07 },
  { owner: ZoneFaction.WILD, share: 0.14 },
];

function reachableCellCount(reachable: Uint8Array): number {
  let count = 0;
  for (const value of reachable) count += value;
  return count;
}

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

function isAmbientNpcTemplate(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined &&
    entity.faction !== Faction.PLAYER &&
    entity.occupation !== Occupation.CHILD;
}

test('maintenance macro geometry exposes wet, dry, duct, panel and repair route choices', () => {
  const gen = generateFloor(FloorLevel.MAINTENANCE, 61_061);
  const reachable = assertReachableRouteLifts(gen, 'maintenance story floor');

  assert.equal(gen.world.rooms.length >= 4_400 && gen.world.rooms.length <= 4_800, true, `maintenance reference room count: ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 65 && gen.world.doors.size <= 150, true, `maintenance reference door count: ${gen.world.doors.size}`);
  assert.equal(gen.world.containers.length >= 30 && gen.world.containers.length <= 150, true, `maintenance reference container count: ${gen.world.containers.length}`);
  assert.equal(gen.entities.length >= 8_200 && gen.entities.length <= 9_000, true, `maintenance reference entity count: ${gen.entities.length}`);
  assert.equal(reachableCellCount(reachable) >= 280_000 && reachableCellCount(reachable) <= 305_000, true, `maintenance reference reachability: ${reachableCellCount(reachable)}`);
  assert.equal(passableCellCount(gen.world) >= 280_000 && passableCellCount(gen.world) <= 305_000, true, `maintenance reference passable cells: ${passableCellCount(gen.world)}`);
  assert.equal(wallCellCount(gen.world) >= 740_000 && wallCellCount(gen.world) <= 775_000, true, `maintenance reference wall cells: ${wallCellCount(gen.world)}`);

  const requiredRooms = [
    'Главная насосная: сухой остров',
    'Затопленный бассейн: сухие кромки',
    'Дренажное поле: сухие рейки',
    'Сервисный воздуховод: сухой обход',
    'Щитовая хорда: водяной байпас',
    'Ремонтная обходная хорда: сухой склад',
  ];
  for (const name of requiredRooms) {
    const room = gen.world.rooms.find(candidate => candidate?.name === name);
    assert.ok(room, `${name} should be generated`);
    const ci = gen.world.idx(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2));
    assert.equal(reachable[ci], 1, `${name} should be reachable from spawn`);
  }

  const panels = getEmergencyPanels(gen.world);
  const panelDefs = new Set(panels.map(panel => panel.defId));
  for (const id of ['panel_power', 'panel_water', 'panel_doors', 'panel_vent']) {
    assert.equal(panelDefs.has(id), true, `${id} should be available on the maintenance panel chord`);
  }
  for (const panel of panels) {
    assert.equal(reachable[panel.idx], 1, `${panel.defId} should be reachable`);
    assert.equal(panel.roomId >= 0, true, `${panel.defId} should be inside a room`);
  }

  let reachableWater = 0;
  let reachableDry = 0;
  for (let i = 0; i < gen.world.cells.length; i++) {
    if (!reachable[i]) continue;
    if (gen.world.cells[i] === Cell.WATER) reachableWater++;
    else if (gen.world.cells[i] === Cell.FLOOR) reachableDry++;
  }
  assert.equal(reachableWater >= 900, true, 'wet shortcut network should be substantial');
  assert.equal(reachableDry >= 18_000, true, 'dry long-path network should remain substantial');
});

test('genfix 077 maintenance has cell-first territory HQs and owned faction squad placement', () => {
  const gen = generateFloor(FloorLevel.MAINTENANCE, 61_061);
  const world = gen.world;
  const anchors = territoryHqAnchors(world);
  const hqByOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  const counts = new Map(countTerritoryCells(world).map(row => [row.owner, row.cells]));
  const shares = new Map([...counts].map(([owner, cells]) => [owner, cells / (W * W)]));
  let dominantOwner = ZoneFaction.CITIZEN;

  for (const target of MAINTENANCE_TARGET_SHARES) {
    const cells = counts.get(target.owner) ?? 0;
    const actual = shares.get(target.owner) ?? 0;
    assert.equal(cells > 0, true, `${territoryOwnerName(target.owner)} owns cells`);
    assert.equal(Math.abs(actual - target.share) <= 0.025, true, `${territoryOwnerName(target.owner)} share ${actual.toFixed(3)}`);
    if (cells > (counts.get(dominantOwner) ?? 0)) dominantOwner = target.owner;
  }
  assert.equal(dominantOwner, ZoneFaction.LIQUIDATOR, 'liquidators dominate collector territory');

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const anchor = hqByOwner.get(owner);
    assert.ok(anchor, `${territoryOwnerName(owner)} HQ anchor`);
    const room = world.rooms[anchor.roomId];
    assert.ok(room, `${territoryOwnerName(owner)} HQ room`);
    assert.equal(room.type, RoomType.HQ, `${territoryOwnerName(owner)} HQ type`);
    assert.equal(room.sealed, true, `${territoryOwnerName(owner)} sealed HQ`);
    assert.equal(room.apartmentId, -1, `${territoryOwnerName(owner)} HQ is not an apartment`);
    assert.equal(territoryRoomOwner(world, room.id), owner, `${territoryOwnerName(owner)} room owner`);
    assert.equal(territoryOwnerAt(world, anchor.x, anchor.y), owner, `${territoryOwnerName(owner)} anchor cell owner`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `${territoryOwnerName(owner)} hermetic shell`);
    assert.equal(nearbySupportRooms(world, room) >= 2, true, `${territoryOwnerName(owner)} support rooms`);
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

  let ambientTotal = 0;
  let ambientOwned = 0;
  for (const entity of gen.entities) {
    if (!isAmbientNpcTemplate(entity) || entity.faction === undefined) continue;
    ambientTotal++;
    if (territoryOwnerAt(world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction)) ambientOwned++;
  }
  assert.equal(ambientTotal >= 500, true, `ambient NPC templates ${ambientTotal}`);
  assert.equal(ambientOwned / ambientTotal >= 0.9, true, `own-territory NPC ratio ${ambientOwned / ambientTotal}`);
});
