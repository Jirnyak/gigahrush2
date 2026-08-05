import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, Faction, MonsterKind, Occupation, RoomType, Tex, W, ZoneFaction, type Entity } from '../src/core/types';
import { auditReachability } from '../src/core/world';
import { HUMAN_TERRITORY_OWNERS, factionToTerritoryOwner } from '../src/data/factions';
import { designFloorById } from '../src/data/design_floors';
import { designFloorPopulationProfile } from '../src/data/design_floor_population';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import type { ProductionBeltGeneration } from '../src/gen/design_floors/production_belt';
import { craftStationCells } from '../src/gen/craft_stations';
import { getCellHazardMoveMultiplier } from '../src/systems/cell_hazards';
import { getRouteCueMarkers } from '../src/systems/route_cues';
import { countTerritoryCells, territoryHqAnchors, territoryOwnerAt, territoryRoomOwner } from '../src/systems/territory';

function roomTypeForEntity(gen: ProductionBeltGeneration, entity: { x: number; y: number }): RoomType | undefined {
  const cell = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
  const roomId = gen.world.roomMap[cell];
  return roomId >= 0 ? gen.world.rooms[roomId]?.type : undefined;
}

function weightOf<T>(items: readonly { value: T; weight: number }[], value: T): number {
  return items.find(item => item.value === value)?.weight ?? 0;
}

function hermeticShellCells(gen: ProductionBeltGeneration, roomId: number): number {
  const room = gen.world.rooms[roomId];
  let cells = 0;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const idx = gen.world.idx(room.x + dx, room.y + dy);
      if (gen.world.hermoWall[idx]) cells++;
    }
  }
  return cells;
}

test('production belt profile matches the Floor 13 industrial density target', () => {
  const route = designFloorById('production_belt');
  assert.ok(route);

  const profile = designFloorPopulationProfile(route);
  assert.equal(profile.npcTarget >= 900 && profile.npcTarget <= 1800, true);
  assert.equal(profile.monsterTarget >= 700 && profile.monsterTarget <= 1600, true);
  assert.equal(weightOf(profile.npcFactions, Faction.CITIZEN) > weightOf(profile.npcFactions, Faction.LIQUIDATOR), true);
  assert.equal(weightOf(profile.npcFactions, Faction.WILD) < weightOf(profile.npcFactions, Faction.LIQUIDATOR), true);

  const workerWeight =
    weightOf(profile.npcOccupations, Occupation.MECHANIC) +
    weightOf(profile.npcOccupations, Occupation.TURNER) +
    weightOf(profile.npcOccupations, Occupation.ELECTRICIAN) +
    weightOf(profile.npcOccupations, Occupation.LOCKSMITH);
  const outsiderWeight =
    weightOf(profile.npcOccupations, Occupation.HUNTER) +
    weightOf(profile.npcOccupations, Occupation.TRAVELER) +
    weightOf(profile.npcOccupations, Occupation.SCIENTIST);
  assert.equal(workerWeight > outsiderWeight * 3, true);
});

test('production belt generation exposes repair, theft, bad batch and industrial population bands', () => {
  const gen = generateDesignFloor('production_belt') as ProductionBeltGeneration;
  const npcs = gen.entities.filter(entity => entity.type === EntityType.NPC);
  const monsters = gen.entities.filter(entity => entity.type === EntityType.MONSTER);

  assert.equal(npcs.length >= 900 && npcs.length <= 1800, true, `npc count ${npcs.length}`);
  assert.equal(monsters.length >= 700 && monsters.length <= 1600, true, `monster count ${monsters.length}`);
  assert.equal(gen.productionState.lines.length, 3);
  assert.deepEqual(
    gen.productionState.lines.map(line => line.factoryId).sort(),
    ['illegal_ammo_smelter', 'metal_shop', 'utility_room'],
  );

  const cues = getRouteCueMarkers(gen.world);
  assert.equal(gen.productionState.cueIds.every(id => cues.some(cue => cue.id === id)), true);
  assert.equal(cues.some(cue => cue.tags.includes('repair')), true);
  assert.equal(cues.some(cue => cue.tags.includes('transfer')), true);
  assert.equal(cues.some(cue => cue.tags.includes('bad_batch')), true);
  assert.equal(cues.some(cue => cue.tags.includes('conveyor_spine')), true);
  assert.equal(cues.some(cue => cue.tags.includes('machine_hazard') && cue.tags.includes('shelter')), true);

  const machineShelterCue = cues.find(cue => cue.id === 'production_belt_machine_shelter');
  assert.ok(machineShelterCue);
  assert.equal(gen.world.rooms[machineShelterCue.targetRoomId!]?.type, RoomType.COMMON);
  const hazardProbe = {
    id: -707,
    type: EntityType.NPC,
    x: machineShelterCue.x,
    y: machineShelterCue.y,
  } as Entity;
  assert.equal(getCellHazardMoveMultiplier(gen.world, hazardProbe) < 1, true);

  let spineTiles = 0;
  for (let i = 0; i < gen.world.floorTex.length; i++) {
    if (gen.world.floorTex[i] === Tex.F_TILE) spineTiles++;
  }
  assert.equal(spineTiles >= 1200, true, `spine tile cells ${spineTiles}`);

  const productionOutputs = gen.world.containers.filter(container => container.tags.includes('production_output'));
  const industrialCaches = gen.world.containers.filter(container => container.tags.includes('industrial_cache'));
  assert.equal(productionOutputs.length >= 3, true);
  assert.equal(industrialCaches.length >= 4, true);
  assert.equal(industrialCaches.some(container => container.access === 'locked'), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('theft')), true);
  assert.equal(gen.world.containers.some(container => container.tags.includes('bad_batch')), true);

  const workerRooms = new Set([RoomType.PRODUCTION, RoomType.HQ, RoomType.COMMON, RoomType.OFFICE]);
  const workerBand = npcs.filter(entity => workerRooms.has(roomTypeForEntity(gen, entity)!)).length;
  const monsterBand = monsters.filter(entity => {
    const roomType = roomTypeForEntity(gen, entity);
    return roomType === RoomType.PRODUCTION || roomType === RoomType.STORAGE || roomType === RoomType.CORRIDOR;
  }).length;
  assert.equal(workerBand >= 100, true, `worker band ${workerBand}`);
  assert.equal(monsterBand >= Math.floor(monsters.length * 0.65), true, `monster band ${monsterBand}/${monsters.length}`);
  assert.equal(monsters.some(entity => entity.monsterKind === MonsterKind.ROBOT || entity.monsterKind === MonsterKind.TRUBNYY_AVTOMAT), true);
});

test('production belt full route adds mid/micro bays and cell-first faction HQs', () => {
  const gen = generateDesignFloor('production_belt', 61061) as ProductionBeltGeneration;
  const reachable = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY))).reachable;
  const reachableCells = reachable.reduce((sum, value) => sum + value, 0);
  const bayRooms = gen.world.rooms.filter(room =>
    room.name.includes('бай') ||
    room.name.includes('остров') ||
    room.name.includes('двор') ||
    room.name.includes('миништаб') ||
    room.name.includes('штаб ленты')
  );
  const microRooms = gen.world.rooms.filter(room => room.name.includes('микроузел'));
  const anchors = territoryHqAnchors(gen.world);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const targetShares = new Map<ZoneFaction, number>([
    [ZoneFaction.CITIZEN, 0.14],
    [ZoneFaction.LIQUIDATOR, 0.50],
    [ZoneFaction.CULTIST, 0.06],
    [ZoneFaction.SCIENTIST, 0.18],
    [ZoneFaction.WILD, 0.12],
  ]);
  const hqTitles = new Map<ZoneFaction, string>([
    [ZoneFaction.CITIZEN, 'Гражданский миништаб смены 14'],
    [ZoneFaction.LIQUIDATOR, 'Ликвидаторский штаб ленты 14'],
    [ZoneFaction.CULTIST, 'Скрытый культовый миништаб'],
    [ZoneFaction.SCIENTIST, 'Научный миништаб контроля брака'],
    [ZoneFaction.WILD, 'Дикий миништаб ночной тары'],
  ]);

  assert.equal(gen.world.rooms.length >= 340, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 280, true, `doors ${gen.world.doors.size}`);
  assert.equal(reachableCells >= 190_000, true, `reachable ${reachableCells}`);
  assert.equal(bayRooms.length >= 120, true, `bay rooms ${bayRooms.length}`);
  assert.equal(microRooms.length >= 80, true, `micro rooms ${microRooms.length}`);

  const anchorBuckets = new Set<string>();
  for (const owner of HUMAN_TERRITORY_OWNERS) {
    const anchor = anchors.find(candidate => candidate.owner === owner);
    const targetShare = targetShares.get(owner)!;
    const share = (counts.get(owner) ?? 0) / (W * W);
    const title = hqTitles.get(owner)!;
    assert.ok(anchor, `missing HQ anchor ${ZoneFaction[owner]}`);
    const anchorRoom = gen.world.rooms[anchor.roomId];
    const coreRoom = gen.world.rooms.find(candidate =>
      candidate.name === `${title}: гермоядро` &&
      candidate.type === RoomType.HQ &&
      territoryRoomOwner(gen.world, candidate.id) === owner
    );
    assert.ok(coreRoom, `missing authored HQ core ${ZoneFaction[owner]}`);
    const supportRooms = gen.world.rooms.filter(candidate => candidate.id !== coreRoom.id && candidate.name.startsWith(`${title}:`));
    anchorBuckets.add(`${Math.floor(anchor.x / 128)}:${Math.floor(anchor.y / 128)}`);
    assert.equal(anchorRoom.type, RoomType.HQ, `HQ anchor type ${ZoneFaction[owner]}`);
    assert.equal(anchorRoom.sealed, true, `HQ anchor sealed ${ZoneFaction[owner]}`);
    assert.equal(coreRoom.sealed, true, `HQ core sealed ${ZoneFaction[owner]}`);
    assert.equal(supportRooms.length >= 5, true, `support rooms ${ZoneFaction[owner]}: ${supportRooms.length}`);
    assert.equal(hermeticShellCells(gen, coreRoom.id) > 0, true, `hermetic shell ${ZoneFaction[owner]}`);
    assert.equal(territoryRoomOwner(gen.world, anchorRoom.id), owner, `anchor room owner ${ZoneFaction[owner]}`);
    assert.equal(territoryRoomOwner(gen.world, coreRoom.id), owner, `core room owner ${ZoneFaction[owner]}`);
    assert.equal(territoryOwnerAt(gen.world, anchor.x, anchor.y), owner, `anchor owner ${ZoneFaction[owner]}`);
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells ${ZoneFaction[owner]}`);
    assert.equal(Math.abs(share - targetShare) <= 0.025, true, `share ${ZoneFaction[owner]}: ${share}`);
  }
  assert.equal(anchorBuckets.size >= HUMAN_TERRITORY_OWNERS.length, true, `anchor buckets ${anchorBuckets.size}`);
  assert.equal((counts.get(ZoneFaction.LIQUIDATOR) ?? 0) > (counts.get(ZoneFaction.SCIENTIST) ?? 0), true);

  const ambientNpcs = gen.entities.filter(entity =>
    entity.type === EntityType.NPC &&
    entity.name?.startsWith('Производственный пояс: работник') === true &&
    entity.faction !== undefined
  );
  const ownTerritoryNpcs = ambientNpcs.filter(entity =>
    territoryOwnerAt(gen.world, entity.x, entity.y) === factionToTerritoryOwner(entity.faction!)
  );
  assert.equal(ambientNpcs.length >= 900, true, `ambient npcs ${ambientNpcs.length}`);
  assert.equal(ownTerritoryNpcs.length >= Math.floor(ambientNpcs.length * 0.9), true, `own territory ${ownTerritoryNpcs.length}/${ambientNpcs.length}`);
});

test('production belt exposes reachable craft lathe and disassembly workbench', () => {
  const gen = generateDesignFloor('production_belt') as ProductionBeltGeneration;
  const audit = auditReachability(gen.world, gen.world.idx(Math.floor(gen.spawnX), Math.floor(gen.spawnY)));
  const lathe = craftStationCells(gen.world, 'craft_lathe');
  const workbench = craftStationCells(gen.world, 'disassembly_workbench');

  assert.equal(lathe.length >= 1, true, 'production belt profile should place a craft_lathe');
  assert.equal(workbench.length >= 1, true, 'production belt profile should place a disassembly_workbench');
  assert.equal(lathe.every(idx => audit.reachable[idx] === 1), true, 'production belt lathe should be reachable from spawn');
  assert.equal(workbench.every(idx => audit.reachable[idx] === 1), true, 'production belt workbench should be reachable from spawn');
});
