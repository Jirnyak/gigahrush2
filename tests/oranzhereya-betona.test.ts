import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  DoorState,
  EntityType,
  Feature,
  FloorLevel,
  LiftDirection,
  MonsterKind,
  RoomType,
  W,
  ZoneFaction,
  type Entity,
} from '../src/core/types';
import { auditReachability, hasReachableAdjacentCell } from '../src/core/world';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { ACTIVE_ACTOR_SOFT_LIMIT } from '../src/data/entity_limits';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../src/data/factions';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  ORANZHEREYA_BETONA_BASE_FLOOR,
  ORANZHEREYA_BETONA_DISPLAY_NAME,
  ORANZHEREYA_BETONA_ROUTE_ID,
  ORANZHEREYA_BETONA_Z,
  ORANZHEREYA_MICRO_ROOM_PREFIXES,
  ORANZHEREYA_ROOM_NAMES,
  measureOranzhereyaBetonaGeometry,
} from '../src/gen/design_floors/oranzhereya_betona';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';
import type { FloorGeneration } from '../src/gen/floor_manifest';

let cached: FloorGeneration | undefined;

function oranzhereya(): FloorGeneration {
  cached ??= generateDesignFloor(ORANZHEREYA_BETONA_ROUTE_ID);
  return cached;
}

test('oranzhereya_betona is registered as the z -2 scarcity greenhouse route', () => {
  const route = designFloorById(ORANZHEREYA_BETONA_ROUTE_ID);

  assert.equal(route?.z, ORANZHEREYA_BETONA_Z);
  assert.equal(route?.baseFloor, FloorLevel.LIVING);
  assert.equal(route?.baseFloor, ORANZHEREYA_BETONA_BASE_FLOOR);
  assert.equal(route?.displayName, ORANZHEREYA_BETONA_DISPLAY_NAME);
  assert.equal(route?.danger, 3);
  assert.equal(designFloorAtZ(ORANZHEREYA_BETONA_Z)?.id, ORANZHEREYA_BETONA_ROUTE_ID);
});

test('oranzhereya_betona generates reachable crop rooms, water graph, and lifts', () => {
  const gen = oranzhereya();
  const metrics = measureOranzhereyaBetonaGeometry(gen.world);
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));

  assert.equal(gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))], Cell.FLOOR);
  assert.equal(metrics.cropCells >= 400, true, `crop cells ${metrics.cropCells}`);
  assert.equal(metrics.waterCells >= 300, true, `water cells ${metrics.waterCells}`);
  assert.equal(metrics.basinContainers, 1);
  assert.equal(metrics.publicHarvestContainers >= 1, true);
  assert.equal(metrics.sabotageContainers, 1);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.UP), true);
  assert.equal(hasReachableLift(gen, audit, LiftDirection.DOWN), true);

  for (const name of [
    ORANZHEREYA_ROOM_NAMES.pump,
    ORANZHEREYA_ROOM_NAMES.northRows,
    ORANZHEREYA_ROOM_NAMES.southRows,
    ORANZHEREYA_ROOM_NAMES.waterBasin,
    ORANZHEREYA_ROOM_NAMES.burnTrench,
    ORANZHEREYA_ROOM_NAMES.marketStall,
  ]) {
    assert.equal(reachableRoomCellCount(gen, audit.reachable, name) > 0, true, name);
  }
});

test('oranzhereya_betona exposes harvest, poison, burn, reroute, and guard choices', () => {
  const gen = oranzhereya();
  const quests = new Set(getSideQuestRegistrySnapshot().map(quest => quest.id));
  const plotIds = new Set(gen.entities.filter(e => e.type === EntityType.NPC).map(e => e.plotNpcId));
  const monsterKinds = new Set(gen.entities.filter(e => e.type === EntityType.MONSTER).map(e => e.monsterKind));

  for (const id of [
    'oranzhereya_agronom_nadya',
    'oranzhereya_irrigator_gleb',
    'oranzhereya_guard_arsen',
    'oranzhereya_market_sonya',
  ]) {
    assert.equal(plotIds.has(id), true, id);
  }

  for (const questId of [
    'oranzhereya_save_clean_crop',
    'oranzhereya_reroute_water',
    'oranzhereya_burn_infestation',
    'oranzhereya_poison_market_crop',
  ]) {
    assert.equal(quests.has(questId), true, questId);
  }

  assert.equal(monsterKinds.has(MonsterKind.BORSHCHEVIK), true);
  assert.equal(monsterKinds.has(MonsterKind.SPORE_CARPET), true);
  assert.equal(monsterKinds.has(MonsterKind.CHERNOSLIZ), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('harvest') &&
    container.inventory.some(item => item.defId === 'mushroom_mass')), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('reroute') &&
    container.inventory.some(item => item.defId === 'valve_tag')), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('burn_infestation') &&
    container.inventory.some(item => item.defId === 'ammo_fuel')), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('sabotage_drop') &&
    container.inventory.some(item => item.defId === 'acid_bottle')), true);
});

test('oranzhereya_betona expands greenhouse macro, mid blocks, and micro storage', () => {
  const gen = oranzhereya();
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  let floorCells = 0;
  let reachableCells = 0;
  let waterCells = 0;
  let tables = 0;
  let shelves = 0;
  let screens = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER || cell === Cell.LIFT) floorCells++;
    if (audit.reachable[i]) reachableCells++;
    if (cell === Cell.WATER) waterCells++;
    if (gen.world.features[i] === Feature.TABLE) tables++;
    if (gen.world.features[i] === Feature.SHELF) shelves++;
    if (gen.world.features[i] === Feature.SCREEN) screens++;
  }
  const microRooms = gen.world.rooms.filter(room => ORANZHEREYA_MICRO_ROOM_PREFIXES.some(prefix => room.name.includes(prefix)));

  assert.equal(gen.world.rooms.length >= 260, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 600, true, `doors ${gen.world.doors.size}`);
  assert.equal(floorCells >= 250_000, true, `floor cells ${floorCells}`);
  assert.equal(reachableCells >= 250_000, true, `reachable ${reachableCells}`);
  assert.equal(waterCells >= 20_000, true, `water ${waterCells}`);
  assert.equal(microRooms.length >= 220, true, `micro rooms ${microRooms.length}`);
  assert.equal(tables >= 1_000, true, `tables ${tables}`);
  assert.equal(shelves >= 300, true, `shelves ${shelves}`);
  assert.equal(screens >= 60, true, `screens ${screens}`);
});

test('oranzhereya_betona owns cell territory from greenhouse HQ anchors', () => {
  const gen = oranzhereya();
  const anchors = territoryHqAnchors(gen.world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const rows = countTerritoryCells(gen.world, 4);
  const counts = new Map(rows.map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  let dominant = ZoneFaction.CITIZEN;
  let dominantCells = -1;

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 30_000, true, `owned cells ${ZoneFaction[owner]}`);
    if ((counts.get(owner) ?? 0) > dominantCells) {
      dominant = owner;
      dominantCells = counts.get(owner) ?? 0;
    }
    const anchor = anchors.find(candidate => candidate.owner === owner);
    const room = anchor ? gen.world.rooms[anchor.roomId] : undefined;
    assert.ok(room, `HQ room ${ZoneFaction[owner]}`);
    assert.equal(room.type, RoomType.HQ, `HQ type ${ZoneFaction[owner]}`);
    assert.equal(room.sealed, true, `sealed HQ ${ZoneFaction[owner]}`);
    assert.equal(territoryRoomOwner(gen.world, room.id), owner, `HQ owner ${ZoneFaction[owner]}`);
    assert.equal(room.doors.some(doorIdx => {
      const door = gen.world.doors.get(doorIdx);
      return door?.state === DoorState.HERMETIC_OPEN || door?.state === DoorState.HERMETIC_CLOSED;
    }), true, `hermetic door ${ZoneFaction[owner]}`);
  }

  assert.equal(dominant, ZoneFaction.CITIZEN);
  assert.equal(share(ZoneFaction.CITIZEN) >= 0.40 && share(ZoneFaction.CITIZEN) <= 0.52, true, `citizen share ${share(ZoneFaction.CITIZEN)}`);
  assert.equal(share(ZoneFaction.LIQUIDATOR) >= 0.07 && share(ZoneFaction.LIQUIDATOR) <= 0.14, true, `liquidator share ${share(ZoneFaction.LIQUIDATOR)}`);
  assert.equal(share(ZoneFaction.CULTIST) >= 0.035 && share(ZoneFaction.CULTIST) <= 0.09, true, `cultist share ${share(ZoneFaction.CULTIST)}`);
  assert.equal(share(ZoneFaction.SCIENTIST) >= 0.19 && share(ZoneFaction.SCIENTIST) <= 0.29, true, `scientist share ${share(ZoneFaction.SCIENTIST)}`);
  assert.equal(share(ZoneFaction.WILD) >= 0.10 && share(ZoneFaction.WILD) <= 0.18, true, `wild share ${share(ZoneFaction.WILD)}`);

  let ambientOwned = 0;
  let ambientTotal = 0;
  for (const entity of gen.entities) {
    if (!isAmbientNpcTemplate(entity) || entity.faction === undefined) continue;
    ambientTotal++;
    if (territoryOwnerAt(gen.world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction)) ambientOwned++;
  }
  assert.equal(ambientTotal > 0, true);
  assert.equal(ambientOwned / ambientTotal >= 0.95, true, `own-territory NPC ratio ${ambientOwned / ambientTotal}`);
});

test('oranzhereya_betona uses a bounded food-water population profile', () => {
  const route = designFloorById(ORANZHEREYA_BETONA_ROUTE_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = oranzhereya();
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);

  assert.equal(profile.npcTarget, 980);
  assert.equal(profile.monsterTarget, 920);
  assert.equal(profile.npcNoun, 'тепличник');
  assert.equal(profile.monsterTags.includes('greenhouse'), true);
  assert.equal(profile.monsterTags.includes('spore'), true);
  assert.equal(profile.npcTarget + profile.monsterTarget <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal((profile.npcPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal((profile.monsterPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal((profile.npcPlacement.roomWeights?.[RoomType.KITCHEN] ?? 0) > 1, true);
  assert.equal(npcs.length >= profile.npcTarget && npcs.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(monsters.length >= profile.monsterTarget && monsters.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
});

function isAmbientNpcTemplate(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1;
}

function hasReachableLift(
  gen: FloorGeneration,
  audit: ReturnType<typeof auditReachability>,
  direction: LiftDirection,
): boolean {
  const world = gen.world;
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    if (hasReachableAdjacentCell(world, audit, i)) return true;
  }
  return false;
}

function reachableRoomCellCount(gen: FloorGeneration, reachable: Uint8Array, roomName: string): number {
  const room = gen.world.rooms.find(candidate => candidate.name === roomName);
  if (!room) return 0;
  let count = 0;
  for (let i = 0; i < W * W; i++) {
    if (gen.world.roomMap[i] === room.id && reachable[i]) count++;
  }
  return count;
}
