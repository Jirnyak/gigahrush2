import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, EntityType, Faction, FloorLevel, LiftDirection, MonsterKind, Occupation, RoomType, W, ZoneFaction, type Entity, type Room } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../src/data/factions';
import { territorySharesForDesignFloor } from '../src/data/floor_territory';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  TURING_NURSERY_BASE_FLOOR,
  TURING_NURSERY_ROOM_PREFIX,
  TURING_NURSERY_ROUTE_ID,
  TURING_NURSERY_Z,
  measureTuringNurseryMetrics,
} from '../src/gen/design_floors/turing_nursery';
import { entityInActiveCellHazard } from '../src/systems/cell_hazards';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';

type TuringGeneration = ReturnType<typeof generateDesignFloor>;

let cached: TuringGeneration | undefined;

function nursery(): TuringGeneration {
  cached ??= generateDesignFloor(TURING_NURSERY_ROUTE_ID);
  return cached;
}

test('turing_nursery is registered as a Kvartiry route floor', () => {
  const route = designFloorById(TURING_NURSERY_ROUTE_ID);
  assert.equal(route?.z, TURING_NURSERY_Z);
  assert.equal(route?.baseFloor, FloorLevel.KVARTIRY);
  assert.equal(route?.baseFloor, TURING_NURSERY_BASE_FLOOR);
  assert.equal(route?.displayName, 'Ясли Тьюринга');
  assert.equal(route?.danger, 4);
  assert.equal(designFloorAtZ(TURING_NURSERY_Z)?.id, TURING_NURSERY_ROUTE_ID);

  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  assert.equal(profile.npcTarget, 1050);
  assert.equal(profile.monsterTarget, 1450);
  assert.equal(profile.npcNoun, 'лаборант яслей');
  assert.equal(profile.monsterTags.includes('reaction_diffusion'), true);
  assert.equal((profile.npcPlacement.roomWeights?.[RoomType.MEDICAL] ?? 0) > 1.5, true);
});

test('turing_nursery generates reaction lanes, static hazards, route cues, and lifts', () => {
  const gen = nursery();
  const metrics = measureTuringNurseryMetrics(gen);
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const cueTags = new Set(getRouteCueMarkers(gen.world).flatMap(marker => marker.tags));
  const hazardProbe = findHazardProbe(gen);

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(metrics.reactionRooms >= 14, true, `reaction rooms ${metrics.reactionRooms}`);
  assert.equal(metrics.wetCells >= 220, true, `wet cells ${metrics.wetCells}`);
  assert.equal(metrics.laneCells >= 900, true, `lane cells ${metrics.laneCells}`);
  assert.equal(metrics.bridgeCells >= 500, true, `bridge cells ${metrics.bridgeCells}`);
  assert.equal(metrics.decisionContainers >= 9, true, `decision containers ${metrics.decisionContainers}`);
  assert.equal(cueTags.has('inoculation'), true);
  assert.equal(cueTags.has('burn_bridge'), true);
  assert.equal(cueTags.has('expose_growth'), true);
  assert.ok(hazardProbe);
  assert.equal(gen.world.cells.some((cell, idx) => cell === Cell.LIFT && gen.world.liftDir[idx] === LiftDirection.UP), true);
  assert.equal(gen.world.cells.some((cell, idx) => cell === Cell.LIFT && gen.world.liftDir[idx] === LiftDirection.DOWN), true);
});

test('turing_nursery exposes inoculate, harvest, burn, and exposure decisions', () => {
  const gen = nursery();
  const quests = new Set(getSideQuestRegistrySnapshot().map(quest => quest.id));
  const plotIds = new Set(gen.entities.filter(e => e.type === EntityType.NPC).map(e => e.plotNpcId));
  const monsterKinds = new Set(gen.entities.filter(e => e.type === EntityType.MONSTER).map(e => e.monsterKind));

  for (const id of [
    'turing_nursery_mother_agafya',
    'turing_nursery_liquidator_bryzga',
    'turing_nursery_child_sava',
    'turing_nursery_registrar_milena',
  ]) {
    assert.equal(plotIds.has(id), true, id);
  }

  for (const questId of [
    'turing_nursery_inoculate_basin',
    'turing_nursery_burn_bridge',
    'turing_nursery_expose_growth_child',
    'turing_nursery_growth_audit',
  ]) {
    assert.equal(quests.has(questId), true, questId);
  }

  assert.equal(monsterKinds.has(MonsterKind.CHERNOSLIZ), true);
  assert.equal(monsterKinds.has(MonsterKind.SLIME_WOMAN), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('inoculation') &&
    container.inventory.some(item => item.defId === 'decon_fluid')), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('harvest') &&
    container.inventory.some(item => item.defId === 'blue_glow_sample_sealed')), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('burn_bridge') &&
    container.inventory.some(item => item.defId === 'napalm_mix')), true);
  assert.equal(gen.world.containers.some(container =>
    container.tags.includes('expose_growth') &&
    container.inventory.some(item => item.defId === 'nii_forged_audit')), true);
  assert.equal(gen.world.rooms.some(room => room.name.startsWith(TURING_NURSERY_ROOM_PREFIX)), true);
});

test('genfix 041 turing_nursery ships full-scale reaction nursery and cell-first territory', () => {
  const gen = nursery();
  const world = gen.world;
  const audit = auditReachability(world, world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const reachable = reachableCells(audit.reachable);
  const passable = passableCells(world);
  const nurseryRooms = world.rooms.filter(room => room.name.startsWith(TURING_NURSERY_ROOM_PREFIX));
  const microRooms = world.rooms.filter(room =>
    room.name.includes('микроячейка') ||
    room.name.includes('шкаф') ||
    room.name.includes('малый отсек'));
  const hermeticHqs = world.rooms.filter(room =>
    room.type === RoomType.HQ &&
    room.sealed &&
    hermeticShellCells(world, room) > 0);

  assert.equal(world.rooms.length >= 800, true, `rooms ${world.rooms.length}`);
  assert.equal(world.doors.size >= 60, true, `doors ${world.doors.size}`);
  assert.equal(passable >= 360_000, true, `passable ${passable}`);
  assert.equal(reachable >= 360_000, true, `reachable ${reachable}`);
  assert.equal(nurseryRooms.length >= 760, true, `nursery rooms ${nurseryRooms.length}`);
  assert.equal(microRooms.length >= 650, true, `micro rooms ${microRooms.length}`);
  assert.equal(hermeticHqs.length >= 5, true, `hermetic HQs ${hermeticHqs.length}`);

  const anchors = territoryHqAnchors(world);
  const anchorOwners = new Set(anchors.map(anchor => anchor.owner));
  const counts = new Map(countTerritoryCells(world).map(row => [row.owner, row.cells]));
  const targetRows = territorySharesForDesignFloor(TURING_NURSERY_ROUTE_ID);
  const targetTotal = targetRows.reduce((sum, row) => sum + row.share, 0);
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()]
    .filter(([owner]) => owner !== ZoneFaction.SAMOSBOR)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal(anchorOwners.has(owner), true, `missing HQ anchor for ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 40_000, true, `owned cells for ${ZoneFaction[owner]}`);
  }
  assert.equal(dominant, ZoneFaction.SCIENTIST);

  for (const target of targetRows) {
    if (target.owner === ZoneFaction.SAMOSBOR) continue;
    assert.equal(Math.abs(share(target.owner) - target.share / targetTotal) <= 0.04, true, `${ZoneFaction[target.owner]} share ${share(target.owner).toFixed(3)}`);
  }

  let ambientTotal = 0;
  let ambientOwned = 0;
  for (const entity of gen.entities) {
    if (!isAmbientNpcTemplate(entity) || entity.faction === undefined) continue;
    ambientTotal++;
    if (territoryOwnerAt(world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction)) ambientOwned++;
  }
  assert.equal(ambientTotal >= 900, true, `ambient NPC templates ${ambientTotal}`);
  assert.equal(ambientOwned / ambientTotal >= 0.95, true, `own-territory NPC ratio ${ambientOwned / ambientTotal}`);

  for (const anchor of anchors) {
    const room = world.rooms[anchor.roomId];
    assert.equal(room.type, RoomType.HQ, `HQ type for ${ZoneFaction[anchor.owner]}`);
    assert.equal(territoryRoomOwner(world, room.id), anchor.owner, `HQ owner for ${ZoneFaction[anchor.owner]}`);
    assert.equal(room.sealed, true, `sealed HQ for ${ZoneFaction[anchor.owner]}`);
    assert.equal(hermeticShellCells(world, room) > 0, true, `hermetic shell for ${ZoneFaction[anchor.owner]}`);
    assert.equal(nearbySupportRooms(world, room) >= 2, true, `support rooms for ${ZoneFaction[anchor.owner]}`);
  }
});

function passableCells(world: TuringGeneration['world']): number {
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

function hermeticShellCells(world: TuringGeneration['world'], room: Room): number {
  let count = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      if (world.hermoWall[world.idx(room.x + dx, room.y + dy)]) count++;
    }
  }
  return count;
}

function nearbySupportRooms(world: TuringGeneration['world'], hq: Room): number {
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

function isAmbientNpcTemplate(entity: Entity): boolean {
  return entity.type === EntityType.NPC &&
    entity.alive &&
    entity.plotNpcId === undefined &&
    entity.persistentNpcId === undefined &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== Faction.PLAYER &&
    entity.occupation !== Occupation.CHILD;
}

function findHazardProbe(gen: TuringGeneration): Entity | null {
  for (const room of gen.world.rooms) {
    if (!room.name.includes('вычислительная чаша')) continue;
    for (let y = room.y + 2; y < room.y + room.h - 2; y++) {
      for (let x = room.x + 2; x < room.x + room.w - 2; x++) {
        const idx = gen.world.idx(x, y);
        if (gen.world.cells[idx] !== Cell.WATER && gen.world.cells[idx] !== Cell.FLOOR) continue;
        const probe = {
          id: 99,
          type: EntityType.NPC,
          x: (idx % W) + 0.5,
          y: ((idx / W) | 0) + 0.5,
          angle: 0,
          pitch: 0,
          alive: true,
          speed: 1,
          sprite: 0,
        } as Entity;
        if (entityInActiveCellHazard(gen.world, probe, [TURING_NURSERY_ROUTE_ID])) return probe;
      }
    }
  }
  return null;
}
