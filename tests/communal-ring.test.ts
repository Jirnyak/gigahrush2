import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  EntityType,
  FloorLevel,
  LiftDirection,
  RoomType,
  W,
  ZoneFaction,
} from '../src/core/types';
import {
  designFloorAtZ,
  designFloorById,
} from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { ACTIVE_ACTOR_SOFT_LIMIT } from '../src/data/entity_limits';
import { HUMAN_TERRITORY_OWNERS } from '../src/data/factions';
import { getSideQuestRegistrySnapshot } from '../src/data/plot';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  COMMUNAL_RING_DESIGN_FLOOR_ID,
  COMMUNAL_RING_ROUTE_Z,
} from '../src/gen/design_floors/communal_ring';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryRoomOwner,
} from '../src/systems/territory';

let cachedGeneration: ReturnType<typeof generateDesignFloor> | undefined;

function generatedCommunalRing(): ReturnType<typeof generateDesignFloor> {
  cachedGeneration ??= generateDesignFloor(COMMUNAL_RING_DESIGN_FLOOR_ID);
  return cachedGeneration;
}

test('communal_ring is the authored коммуналка route floor', () => {
  const route = designFloorById(COMMUNAL_RING_DESIGN_FLOOR_ID);
  assert.equal(route?.z, COMMUNAL_RING_ROUTE_Z);
  assert.equal(route?.baseFloor, FloorLevel.KVARTIRY);
  assert.equal(route?.displayName, 'Коммунальное кольцо');
  assert.equal(designFloorAtZ(COMMUNAL_RING_ROUTE_Z)?.id, COMMUNAL_RING_DESIGN_FLOOR_ID);
});

test('communal_ring generator creates through communal flats with quest NPCs', () => {
  const gen = generatedCommunalRing();
  const spawnCell = gen.world.cells[gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))];
  const throughRooms = gen.world.rooms.filter(room => room.name.includes('сквозная коммуналка'));
  const smokingRooms = gen.world.rooms.filter(room => room.type === RoomType.SMOKING);
  const serviceLoops = gen.world.rooms.filter(room => room.name.startsWith('Петля '));
  const microRooms = gen.world.rooms.filter(room => (
    room.name.includes('между коридорами') ||
    room.name.includes('микро') ||
    room.name.includes('Кладовка') ||
    room.name.includes('Тесная проходная')
  ));
  const throughRoomIds = new Set(throughRooms.map(room => room.id));
  let internalThroughDoors = 0;
  let externalThroughDoors = 0;

  for (const room of throughRooms) {
    for (const doorIdx of room.doors) {
      const door = gen.world.doors.get(doorIdx);
      if (!door) continue;
      if (throughRoomIds.has(door.roomA) && throughRoomIds.has(door.roomB)) internalThroughDoors++;
      if (door.roomB < 0 || door.roomA < 0) externalThroughDoors++;
    }
  }

  assert.equal(spawnCell, Cell.FLOOR);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.UP && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(gen.world.liftDir.some((dir, idx) => dir === LiftDirection.DOWN && gen.world.cells[idx] === Cell.LIFT), true);
  assert.equal(throughRooms.length >= 20, true);
  assert.equal(internalThroughDoors >= 16, true);
  assert.equal(externalThroughDoors >= 8, true);
  assert.equal(gen.world.rooms.length >= 500, true);
  assert.equal(gen.world.doors.size >= 450, true);
  assert.equal(microRooms.length >= 300, true);
  assert.equal(smokingRooms.length >= 2, true);
  assert.equal(serviceLoops.length >= 5, true);
  assert.equal(serviceLoops.some(room => room.name.includes('курилки')), true);
  assert.equal(gen.world.containers.filter(container => container.tags.includes('through_flat')).length >= 4, true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('grievance')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('buyable') && container.tags.includes('trade')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('evidence_drop') && container.tags.includes('expose')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('secret') && container.tags.includes('hide')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('resident_relief')), true);
  assert.equal(gen.world.containers.some(container => container.inventory.some(item => item.defId === 'shelter_tally')), true);
  assert.equal(gen.entities.some(e => e.type === EntityType.NPC && e.plotNpcId === 'communal_through_nina'), true);
  assert.equal(gen.entities.some(e => e.type === EntityType.NPC && e.plotNpcId === 'communal_primus_yegor'), true);
});

test('communal_ring uses the design population field as a dense social floor', () => {
  const route = designFloorById(COMMUNAL_RING_DESIGN_FLOOR_ID);
  assert.ok(route);
  const profile = designFloorPopulationProfile(route);
  const gen = generatedCommunalRing();
  const mappedByType = new Map<RoomType, number>();
  const zoneFactions = new Set(gen.world.zones.map(zone => zone.faction));

  for (let i = 0; i < W * W; i++) {
    if (gen.world.cells[i] !== Cell.FLOOR) continue;
    const room = gen.world.rooms[gen.world.roomMap[i]];
    if (!room) continue;
    mappedByType.set(room.type, (mappedByType.get(room.type) ?? 0) + 1);
  }

  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);
  assert.equal(profile.npcTarget + profile.monsterTarget, ACTIVE_ACTOR_SOFT_LIMIT);
  assert.equal((profile.npcPlacement.anchors?.length ?? 0) >= 5, true);
  assert.equal((profile.monsterPlacement.anchors?.length ?? 0) >= 4, true);
  assert.equal(npcs.length + monsters.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(npcs.length >= profile.npcTarget && npcs.length <= ACTIVE_ACTOR_SOFT_LIMIT, true);
  assert.equal(monsters.length >= 250 && monsters.length <= profile.monsterTarget, true);
  assert.equal((mappedByType.get(RoomType.CORRIDOR) ?? 0) >= 50_000, true);
  assert.equal((mappedByType.get(RoomType.COMMON) ?? 0) >= 6_000, true);
  assert.equal((mappedByType.get(RoomType.KITCHEN) ?? 0) >= 4_000, true);
  assert.equal((mappedByType.get(RoomType.BATHROOM) ?? 0) >= 2_500, true);
  assert.equal((mappedByType.get(RoomType.PRODUCTION) ?? 0) >= 2_500, true);
  assert.equal((mappedByType.get(RoomType.SMOKING) ?? 0) >= 300, true);
  assert.equal(zoneFactions.has(ZoneFaction.WILD), true);
  assert.equal(zoneFactions.has(ZoneFaction.LIQUIDATOR), true);
  assert.equal(zoneFactions.has(ZoneFaction.SAMOSBOR), true);
});

test('communal_ring seeds authored human faction HQs and target cell territory shares', () => {
  const gen = generatedCommunalRing();
  const anchors = territoryHqAnchors(gen.world);
  const anchorsByOwner = new Map(anchors.map(anchor => [anchor.owner, anchor]));
  const expectedShares = new Map([
    [ZoneFaction.CITIZEN, 0.54],
    [ZoneFaction.LIQUIDATOR, 0.18],
    [ZoneFaction.CULTIST, 0.07],
    [ZoneFaction.SCIENTIST, 0.09],
    [ZoneFaction.WILD, 0.12],
  ]);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const distinctAnchorBuckets = new Set<string>();

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const anchor = anchorsByOwner.get(owner);
    assert.ok(anchor, `missing HQ anchor for ${ZoneFaction[owner]}`);
    const room = gen.world.rooms[anchor.roomId];
    assert.ok(room, `missing HQ room for ${ZoneFaction[owner]}`);
    assert.equal(room.type, RoomType.HQ);
    assert.equal(room.sealed, true);
    assert.equal(room.doors.length >= 1, true);
    assert.equal(territoryRoomOwner(gen.world, room.id), owner);
    assert.equal((counts.get(owner) ?? 0) > 0, true);
    distinctAnchorBuckets.add(`${anchor.x >> 7}:${anchor.y >> 7}`);
  }

  for (const [owner, target] of expectedShares) {
    const share = (counts.get(owner) ?? 0) / (W * W);
    assert.equal(Math.abs(share - target) <= 0.0125, true, `${ZoneFaction[owner]} share ${share}`);
  }

  assert.equal(distinctAnchorBuckets.size >= HUMAN_TERRITORY_OWNERS.length, true);
});

test('communal_ring registers communal service and through-flat side quests', () => {
  const ids = new Set(getSideQuestRegistrySnapshot().map(q => q.id));
  for (const id of [
    'communal_clean_bandages',
    'communal_shower_pressure',
    'communal_notice_dispute',
    'communal_pantry_theft',
    'communal_through_chain_bread',
    'communal_primus_valve',
  ]) {
    assert.equal(ids.has(id), true, id);
  }
});
