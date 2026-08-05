import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, EntityType, Faction, FloorLevel, MonsterKind, QuestType, RoomType, Tex, ZoneFaction, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { createWorldEventState } from '../src/systems/events';
import {
  isMapCellExplored,
  isMapCellFreshForMarkers,
  mapCellFogAmount,
  mapExplorationStats,
  mapExplorationVersion,
  resetMapExploration,
  revealMapArea,
  revealQuestTargetOnMap,
  revealWholeMap,
  revealMapZone,
  syncMapExplorationAfterSamosborWave,
  updateMapExploration,
} from '../src/systems/map_exploration';
import { getNpcPackageByPlotNpcId, npcPackageDisplayName } from '../src/data/npc_packages';
import { offerQuest } from '../src/systems/quests';
import { cancelSamosborWave, finishSamosborWave, startSamosborWave } from '../src/systems/samosbor_wave';
import { makeGameState } from './helpers';

function plotNpcName(plotNpcId: string): string {
  const pack = getNpcPackageByPlotNpcId(plotNpcId);
  assert.ok(pack, `missing NPC package for plot NPC ${plotNpcId}`);
  return npcPackageDisplayName(pack);
}

test('map zone reveal includes corridor geometry without revealing other zones', () => {
  const world = new World();
  resetMapExploration(world);

  const corridor = world.idx(20, 20);
  const door = world.idx(21, 20);
  const lift = world.idx(22, 20);
  const water = world.idx(23, 20);
  const abyss = world.idx(24, 20);
  const wall = world.idx(25, 20);
  const otherZoneFloor = world.idx(26, 20);

  world.cells[corridor] = Cell.FLOOR;
  world.cells[door] = Cell.DOOR;
  world.cells[lift] = Cell.LIFT;
  world.cells[water] = Cell.WATER;
  world.cells[abyss] = Cell.ABYSS;
  world.cells[wall] = Cell.WALL;
  world.cells[otherZoneFloor] = Cell.FLOOR;

  for (const idx of [corridor, door, lift, water, abyss, wall]) world.zoneMap[idx] = 7;
  world.zoneMap[otherZoneFloor] = 8;

  revealMapZone(world, 7);

  assert.equal(isMapCellExplored(world, corridor), true);
  assert.equal(isMapCellExplored(world, door), true);
  assert.equal(isMapCellExplored(world, lift), true);
  assert.equal(isMapCellExplored(world, water), true);
  assert.equal(isMapCellExplored(world, abyss), true);
  assert.equal(isMapCellExplored(world, wall), false);
  assert.equal(isMapCellExplored(world, otherZoneFloor), false);
});

test('zone reveal treats touched rooms as whole map elements', () => {
  const world = new World();
  resetMapExploration(world);

  const left = world.idx(30, 30);
  const right = world.idx(31, 30);
  world.cells[left] = Cell.FLOOR;
  world.cells[right] = Cell.FLOOR;
  world.zoneMap[left] = 3;
  world.zoneMap[right] = 4;
  world.roomMap[left] = 0;
  world.roomMap[right] = 0;
  world.rooms.push({
    id: 0,
    type: RoomType.COMMON,
    x: 30,
    y: 30,
    w: 2,
    h: 1,
    doors: [],
    sealed: false,
    name: 'test room',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.CONCRETE,
  });

  revealMapZone(world, 3);

  assert.equal(isMapCellExplored(world, left), true);
  assert.equal(isMapCellExplored(world, right), true);
});

function makeMapPlayer(x: number, y: number): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Вы',
    faction: Faction.PLAYER,
  };
}

function carveMapTestFloor(world: World, cx: number, cy: number, half: number, roomId: number, zoneId = 0): void {
  world.zones[zoneId] = { id: zoneId, cx, cy, faction: ZoneFaction.CITIZEN, hasLift: false, fogged: false, level: 1, hqRoomId: -1 };
  world.rooms[roomId] = {
    id: roomId,
    type: RoomType.COMMON,
    x: cx - half,
    y: cy - half,
    w: half * 2 + 1,
    h: half * 2 + 1,
    doors: [],
    sealed: false,
    name: `map room ${roomId}`,
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  for (let y = cy - half; y <= cy + half; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      const idx = world.idx(x, y);
      world.cells[idx] = Cell.FLOOR;
      world.zoneMap[idx] = zoneId;
      world.roomMap[idx] = roomId;
      world.floorTex[idx] = Tex.F_CONCRETE;
    }
  }
}

test('player movement reveals only local cell trail, not the whole entered room', () => {
  const world = new World();
  carveMapTestFloor(world, 12, 12, 2, 0, 0);
  carveMapTestFloor(world, 40, 40, 7, 1, 1);
  resetMapExploration(world);
  const player = makeMapPlayer(12, 12);
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });

  updateMapExploration(world, player, state);
  const firstVersion = mapExplorationVersion(world);
  assert.equal(firstVersion > 0, true);
  const farRoomIdx = world.idx(46, 40);
  assert.equal(isMapCellExplored(world, farRoomIdx), false);

  updateMapExploration(world, player, state);
  assert.equal(mapExplorationVersion(world), firstVersion);

  player.x = 40.5;
  player.y = 40.5;
  updateMapExploration(world, player, state);

  assert.equal(isMapCellExplored(world, world.idx(40, 40)), true);
  assert.equal(isMapCellExplored(world, farRoomIdx), false);
  assert.equal(mapExplorationVersion(world) > firstVersion, true);
});

test('explored map cells age into fog of war until revisited', () => {
  const world = new World();
  carveMapTestFloor(world, 12, 12, 2, 0, 0);
  carveMapTestFloor(world, 40, 40, 2, 1, 1);
  resetMapExploration(world);
  const player = makeMapPlayer(12, 12);
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });

  updateMapExploration(world, player, state);
  const remote = world.idx(40, 40);
  revealMapArea(world, 40, 40, 1);
  assert.equal(isMapCellExplored(world, remote), true);
  assert.equal(isMapCellFreshForMarkers(world, remote), true);

  state.time = 140;
  updateMapExploration(world, player, state);
  assert.equal(isMapCellExplored(world, remote), true);
  assert.equal(isMapCellFreshForMarkers(world, remote), false);
  assert.ok(mapCellFogAmount(world, remote) > 0.8);

  player.x = 40.5;
  player.y = 40.5;
  updateMapExploration(world, player, state);
  assert.equal(isMapCellFreshForMarkers(world, remote), true);
  assert.equal(mapCellFogAmount(world, remote), 0);
});

test('active talk quest reveals the target NPC room on the map', () => {
  const world = new World();
  carveMapTestFloor(world, 12, 12, 2, 0, 0);
  carveMapTestFloor(world, 80, 80, 4, 1, 1);
  resetMapExploration(world);
  const player = makeMapPlayer(12, 12);
  const target: Entity = {
    id: 20,
    type: EntityType.NPC,
    x: 80.5,
    y: 80.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Целевой сосед',
    faction: Faction.CITIZEN,
  };
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
    quests: [{
      id: 1,
      type: QuestType.TALK,
      giverId: 10,
      giverName: 'Ольга',
      desc: 'Поговорить с целевым соседом.',
      targetNpcId: target.id,
      targetNpcName: target.name,
      done: false,
    }],
  });

  updateMapExploration(world, player, state);
  assert.equal(isMapCellExplored(world, world.idx(84, 80)), false);
  revealQuestTargetOnMap(world, player, state, state.quests[0], [player, target]);

  assert.equal(isMapCellExplored(world, world.idx(84, 80)), true);
});

test('active visit quest reveals the resolved target room on the map', () => {
  const world = new World();
  carveMapTestFloor(world, 12, 12, 2, 0, 0);
  carveMapTestFloor(world, 92, 92, 4, 1, 1);
  resetMapExploration(world);
  const player = makeMapPlayer(12, 12);
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
    quests: [{
      id: 2,
      type: QuestType.VISIT,
      giverId: 10,
      giverName: 'Яков',
      desc: 'Проверить дальнюю комнату.',
      targetRoom: 1,
      done: false,
    }],
  });

  updateMapExploration(world, player, state);
  assert.equal(isMapCellExplored(world, world.idx(96, 92)), false);
  revealQuestTargetOnMap(world, player, state, state.quests[0]);

  assert.equal(isMapCellExplored(world, world.idx(96, 92)), true);
});

test('active kill quest reveals a radius around the nearest target monster marker', () => {
  const world = new World();
  carveMapTestFloor(world, 12, 12, 2, 0, 0);
  const monsterIdx = world.idx(120, 120);
  world.cells[monsterIdx] = Cell.FLOOR;
  world.zoneMap[monsterIdx] = 2;
  resetMapExploration(world);
  const player = makeMapPlayer(12, 12);
  const monster: Entity = {
    id: 30,
    type: EntityType.MONSTER,
    x: 120.5,
    y: 120.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    monsterKind: MonsterKind.TVAR,
  };
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
    quests: [{
      id: 3,
      type: QuestType.KILL,
      giverId: 10,
      giverName: 'Сержант Баринов',
      desc: 'Убить тварь.',
      targetMonsterKind: MonsterKind.TVAR,
      killCount: 0,
      killNeeded: 1,
      done: false,
    }],
  });

  updateMapExploration(world, player, state);
  assert.equal(isMapCellExplored(world, monsterIdx), false);
  revealQuestTargetOnMap(world, player, state, state.quests[0], [player, monster]);

  assert.equal(isMapCellExplored(world, monsterIdx), true);
});

test('accepting a quest from an NPC reveals the target room once', () => {
  const world = new World();
  carveMapTestFloor(world, 12, 12, 2, 0, 0);
  carveMapTestFloor(world, 80, 80, 4, 1, 1);
  resetMapExploration(world);
  const player = makeMapPlayer(12, 12);
  const olga: Entity = {
    id: 10,
    type: EntityType.NPC,
    x: 12.5,
    y: 13.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: plotNpcName('olga'),
    faction: Faction.CITIZEN,
    plotNpcId: 'olga',
    canGiveQuest: true,
  };
  const barni: Entity = {
    id: 11,
    type: EntityType.NPC,
    x: 80.5,
    y: 80.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: plotNpcName('barni'),
    faction: Faction.CITIZEN,
    plotNpcId: 'barni',
    canGiveQuest: true,
  };
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });

  updateMapExploration(world, player, state);
  assert.equal(isMapCellExplored(world, world.idx(84, 80)), false);

  offerQuest(olga, player, world, [player, olga, barni], state, state.msgs, { v: 20 });

  assert.equal(state.quests.length, 1);
  assert.equal(isMapCellExplored(world, world.idx(84, 80)), true);
});

test('debug revealWholeMap marks every cell explored', () => {
  const world = new World();
  carveMapTestFloor(world, 12, 12, 1, 0, 0);
  resetMapExploration(world);
  const player = makeMapPlayer(12, 12);
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  const distantWallIdx = world.idx(90, 90);

  updateMapExploration(world, player, state);
  assert.equal(isMapCellExplored(world, distantWallIdx), false);

  assert.equal(revealWholeMap(world), world.cells.length);
  assert.equal(isMapCellExplored(world, distantWallIdx), true);
  assert.equal(mapExplorationStats(world).cells, world.cells.length);
});

test('local samosbor map fog does not reveal the whole rebuilt patch room on re-entry', () => {
  cancelSamosborWave();
  const cx = 40;
  const cy = 40;
  const world = new World();
  carveMapTestFloor(world, cx, cy, 10, 0);
  resetMapExploration(world);
  const player = makeMapPlayer(cx, cy);
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    samosborActive: true,
    samosborCount: 1,
    worldEvents: createWorldEventState(),
  });
  const entities = [player];

  updateMapExploration(world, player, state);
  const farHiddenIdx = world.idx(cx + 4, cy);
  assert.equal(isMapCellExplored(world, farHiddenIdx), true);

  assert.equal(startSamosborWave(world, entities, state, 'small', cx, cy, { seed: 99, radius: 4, budgetCellsPerTick: 64 }), true);
  const beforeHideVersion = mapExplorationVersion(world);
  const replacementWorld = new World();
  carveMapTestFloor(replacementWorld, cx, cy, 10, 2);
  const replacement = { world: replacementWorld, entities: [], spawnX: cx + 0.5, spawnY: cy + 0.5 };
  finishSamosborWave(world, entities, state, replacement);
  syncMapExplorationAfterSamosborWave(world, state);

  assert.equal(isMapCellExplored(world, world.idx(cx, cy)), false);
  assert.equal(isMapCellExplored(world, farHiddenIdx), false);
  assert.equal(mapExplorationVersion(world) > beforeHideVersion, true);

  updateMapExploration(world, player, state);

  assert.equal(isMapCellExplored(world, world.idx(cx, cy)), true);
  assert.equal(isMapCellExplored(world, farHiddenIdx), false);
  cancelSamosborWave();
});
