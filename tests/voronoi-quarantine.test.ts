import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { auditReachability, hasReachableAdjacentCell } from '../src/core/world';
import {
  Cell,
  DoorState,
  EntityType,
  Faction,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  Occupation,
  RoomType,
  W,
  ZoneFaction,
  type Entity,
  type Room,
} from '../src/core/types';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../src/data/factions';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { territorySharesForDesignFloor } from '../src/data/floor_territory';
import { PROCEDURAL_FLOOR_ZS } from '../src/data/procedural_floors';
import { SIDE_QUESTS } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  getVoronoiQuarantineLayout,
  VORONOI_QUARANTINE_BASE_FLOOR,
  VORONOI_QUARANTINE_ROOM_NAMES,
  VORONOI_QUARANTINE_ROUTE_ID,
  VORONOI_QUARANTINE_Z,
} from '../src/gen/design_floors/voronoi_quarantine';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAt,
  territoryRoomOwner,
} from '../src/systems/territory';

let cachedGeneration: ReturnType<typeof generateDesignFloor> | undefined;

function generatedVoronoiQuarantine(): ReturnType<typeof generateDesignFloor> {
  cachedGeneration ??= generateDesignFloor(VORONOI_QUARANTINE_ROUTE_ID);
  return cachedGeneration;
}

function hasReachableLift(gen: ReturnType<typeof generateDesignFloor>, direction: LiftDirection): boolean {
  const world = gen.world;
  const audit = auditReachability(world, world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return true;
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
  let count = 0;
  const hx = hq.x + (hq.w >> 1);
  const hy = hq.y + (hq.h >> 1);
  for (const room of world.rooms) {
    if (!room || room.id === hq.id || room.type === RoomType.HQ) continue;
    if (
      room.type !== RoomType.KITCHEN &&
      room.type !== RoomType.BATHROOM &&
      room.type !== RoomType.STORAGE &&
      room.type !== RoomType.MEDICAL &&
      room.type !== RoomType.OFFICE &&
      room.type !== RoomType.COMMON &&
      room.type !== RoomType.PRODUCTION
    ) continue;
    const d2 = world.dist2(hx, hy, room.x + (room.w >> 1), room.y + (room.h >> 1));
    if (d2 <= 128 * 128) count++;
  }
  return count;
}

function isAmbientNpcTemplate(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined;
}

function passableRoomCells(world: ReturnType<typeof generateDesignFloor>['world'], room: Room): number {
  let count = 0;
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const idx = world.idx(x, y);
      if (world.roomMap[idx] !== room.id) continue;
      if (world.cells[idx] === Cell.FLOOR || world.cells[idx] === Cell.WATER) count++;
    }
  }
  return count;
}

test('voronoi_quarantine is registered as a Kvartiry-band authored quarantine route', () => {
  const route = designFloorById(VORONOI_QUARANTINE_ROUTE_ID);
  assert.equal(route?.z, VORONOI_QUARANTINE_Z);
  assert.equal(route?.baseFloor, VORONOI_QUARANTINE_BASE_FLOOR);
  assert.equal(route?.baseFloor, FloorLevel.KVARTIRY);
  assert.equal(route?.displayName, 'Вороной-карантин');
  assert.equal(designFloorAtZ(VORONOI_QUARANTINE_Z)?.id, VORONOI_QUARANTINE_ROUTE_ID);
  assert.equal(PROCEDURAL_FLOOR_ZS.includes(VORONOI_QUARANTINE_Z), false);
});

test('voronoi_quarantine population profile targets sanitary staff and infected pressure', () => {
  const route = designFloorById(VORONOI_QUARANTINE_ROUTE_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);

  assert.equal(profile.npcTarget, 980);
  assert.equal(profile.monsterTarget, 1420);
  assert.equal(profile.npcNoun, 'санитар ячейки');
  assert.equal(profile.npcFactions.some(entry => entry.value === Faction.SCIENTIST && entry.weight >= 30), true);
  assert.equal(profile.npcFactions.some(entry => entry.value === Faction.LIQUIDATOR && entry.weight >= 30), true);
  assert.equal(profile.npcOccupations.some(entry => entry.value === Occupation.DOCTOR && entry.weight >= 30), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.HEAD_SLUG), true);
  assert.equal(profile.monsterBiasKinds.includes(MonsterKind.CHERNOSLIZ), true);
  assert.equal(profile.monsterTags.includes('quarantine'), true);
  assert.equal((profile.npcPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal((profile.monsterPlacement.anchors?.length ?? 0) >= 4, true);
});

test('voronoi_quarantine generator builds connected Laguerre quarantine cells', () => {
  const gen = generatedVoronoiQuarantine();
  const layout = getVoronoiQuarantineLayout(gen.world);
  assert.ok(layout);
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const reachableCells = audit.reachable.reduce((sum, value) => sum + value, 0);
  const microRooms = gen.world.rooms.filter(room => room.name.includes('Вороной-микроячейка'));
  const irregularMicroRooms = microRooms.filter(room => passableRoomCells(gen.world, room) < room.w * room.h * 0.88);

  assert.equal(layout.lloydPasses, 2);
  assert.equal(layout.macroSiteCount >= 30, true, `macro sites ${layout.macroSiteCount}`);
  assert.equal(layout.siteCount >= 10_000, true, `sites ${layout.siteCount}`);
  assert.equal(layout.midCellCount, 0);
  assert.equal(layout.microCellCount >= 10_000, true, `micro cells ${layout.microCellCount}`);
  assert.equal(layout.microDoorCount >= 10_000, true, `micro doors ${layout.microDoorCount}`);
  assert.equal(layout.connected, true);
  assert.equal(layout.adjacencyEdges.length >= layout.macroSiteCount - 1, true);
  assert.equal(layout.ridgeDoorCount >= layout.macroSiteCount * 3, true, `ridge doors ${layout.ridgeDoorCount}`);
  assert.equal(layout.lockedPassDoorCount >= 1, true);
  assert.equal(layout.supplyConnectorDoorCount >= 1, true);
  assert.equal(layout.siteCellCounts.filter(count => count > 0).every(count => count > 700), true);
  assert.equal(gen.world.rooms.length >= 10_000, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 10_000, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachableCells >= 430_000, true, `reachable ${reachableCells}`);
  assert.equal(microRooms.length >= 10_000, true, `micro rooms ${microRooms.length}`);
  assert.equal(irregularMicroRooms.length >= 9_000, true, `irregular micro rooms ${irregularMicroRooms.length}`);

  for (const roomName of Object.values(VORONOI_QUARANTINE_ROOM_NAMES)) {
    assert.equal(gen.world.rooms.some(room => room.name === roomName), true, roomName);
  }

  assert.equal(hasReachableLift(gen, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, LiftDirection.DOWN), true);
});

test('voronoi_quarantine has cell-first faction shares, HQs and owned ambient NPC placement', () => {
  const gen = generatedVoronoiQuarantine();
  const world = gen.world;
  const anchors = territoryHqAnchors(world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const counts = new Map(countTerritoryCells(world).map(row => [row.owner, row.cells]));
  const totalCells = W * W;
  const targetRows = territorySharesForDesignFloor(VORONOI_QUARANTINE_ROUTE_ID);
  const targetTotal = targetRows.reduce((sum, row) => sum + row.share, 0);
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / totalCells;
  const dominant = [...counts.entries()]
    .filter(([owner]) => owner !== ZoneFaction.SAMOSBOR)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const anchor = anchors.find(candidate => candidate.owner === owner);
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor for ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells for ${ZoneFaction[owner]}`);
    assert.ok(anchor);
    const room = world.rooms[anchor.roomId];
    assert.equal(room.type, RoomType.HQ, `HQ type for ${ZoneFaction[owner]}`);
    assert.equal(room.sealed, true, `sealed HQ for ${ZoneFaction[owner]}`);
    assert.equal(territoryRoomOwner(world, room.id), owner, `HQ owner for ${ZoneFaction[owner]}`);
    assert.equal(territoryOwnerAt(world, anchor.x, anchor.y), owner, `anchor cell owner for ${ZoneFaction[owner]}`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `hermetic shell for ${ZoneFaction[owner]}`);
    assert.equal(nearbySupportRooms(world, room) >= 2, true, `support rooms for ${ZoneFaction[owner]}`);
  }

  for (const target of targetRows) {
    if (target.owner === ZoneFaction.SAMOSBOR) continue;
    const expected = target.share / targetTotal;
    assert.equal(Math.abs(share(target.owner) - expected) <= 0.035, true, `${ZoneFaction[target.owner]} share ${share(target.owner).toFixed(3)}`);
  }
  assert.equal(dominant, ZoneFaction.SCIENTIST);

  let ambientTotal = 0;
  let ambientOwned = 0;
  for (const entity of gen.entities) {
    if (!isAmbientNpcTemplate(entity) || entity.faction === undefined) continue;
    ambientTotal++;
    if (territoryOwnerAt(world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction)) ambientOwned++;
  }
  assert.equal(ambientTotal >= 900, true, `ambient NPC templates ${ambientTotal}`);
  assert.equal(ambientOwned / ambientTotal >= 0.95, true, `own-territory NPC ratio ${ambientOwned / ambientTotal}`);
});

test('voronoi_quarantine exposes pass, border, escort and supply decisions', () => {
  const gen = generatedVoronoiQuarantine();
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const questIds = new Set(SIDE_QUESTS.map(quest => quest.id));
  const lockedDoors = [...gen.world.doors.values()].filter(door => door.state === DoorState.LOCKED);
  const zoneFactions = new Set(gen.world.zones.map(zone => zone.faction));

  for (const plotNpcId of [
    'voronoi_quarantine_doctor_pavel',
    'voronoi_quarantine_clerk_zoya',
    'voronoi_quarantine_infected_lev',
    'voronoi_quarantine_quartermaster_marta',
  ]) {
    assert.equal(npcs.some(entity => entity.plotNpcId === plotNpcId), true, plotNpcId);
  }

  assert.equal(lockedDoors.some(door => door.keyId === 'official_quarantine_clearance'), true);
  assert.equal(lockedDoors.some(door => door.keyId === 'forged_quarantine_clearance'), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('supply_connector') && container.tags.includes('open_supply')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('forgery') && container.inventory.some(item => item.defId === 'blank_form')), true);
  assert.equal(gen.entities.some(entity => entity.type === EntityType.MONSTER && entity.monsterKind === MonsterKind.CHERNOSLIZ), true);
  assert.equal(zoneFactions.has(ZoneFaction.LIQUIDATOR), true);
  assert.equal(zoneFactions.has(ZoneFaction.SAMOSBOR), true);

  for (const questId of [
    'voronoi_quarantine_decon_border',
    'voronoi_quarantine_forge_pass',
    'voronoi_quarantine_escort_infected',
    'voronoi_quarantine_open_supply_connector',
  ]) {
    assert.equal(questIds.has(questId), true, questId);
  }
});
