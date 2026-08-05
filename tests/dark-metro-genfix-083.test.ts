import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  DoorState,
  EntityType,
  FloorLevel,
  RoomType,
  W,
  ZoneFaction,
} from '../src/core/types';
import { designFloorAtZ, designFloorById } from '../src/data/design_floors';
import { HUMAN_TERRITORY_OWNERS, territoryOwnerToFaction } from '../src/data/factions';
import { generateDesignFloor } from '../src/gen/design_floors/manifest';
import {
  DARK_METRO_FUTURE_Z,
  DARK_METRO_HQ_ROOM_NAMES,
  DESIGN_FLOOR_ID,
} from '../src/gen/design_floors/dark_metro';
import {
  countTerritoryCells,
  territoryHqAnchors,
  territoryOwnerAtIndex,
  territoryRoomOwner,
} from '../src/systems/territory';
import {
  assertFullFootprint,
  assertReachableRouteLifts,
} from './generator_helpers';

type DarkMetroGeneration = ReturnType<typeof generateDesignFloor>;

const TARGET_SHARES = new Map<ZoneFaction, number>([
  [ZoneFaction.CITIZEN, 0.14],
  [ZoneFaction.LIQUIDATOR, 0.24],
  [ZoneFaction.CULTIST, 0.14],
  [ZoneFaction.SCIENTIST, 0.08],
  [ZoneFaction.WILD, 0.40],
]);

const REQUIRED_SUPPORT_ROOMS = [
  'Кухня белой петли',
  'Санузел кассовой петли',
  'Оружейная короткого хода',
  'Медшкаф белых ламп',
  'Свечная кухня неверной станции',
  'Кладовая копченых билетов',
  'Лаборатория стрелочного шума',
  'Кабинет фазового расписания',
  'Кухня черного перегона',
  'Общак пассажиров без билета',
  'Западный герморазвал черного перегона',
  'Восточный герморазвал черного перегона',
] as const;

let cachedGeneration: DarkMetroGeneration | undefined;

function darkMetro(): DarkMetroGeneration {
  cachedGeneration ??= generateDesignFloor(DESIGN_FLOOR_ID, 61_061);
  return cachedGeneration;
}

function playableCellCount(gen: DarkMetroGeneration): number {
  let count = 0;
  for (let i = 0; i < W * W; i++) {
    const cell = gen.world.cells[i];
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) count++;
  }
  return count;
}

function reachableCount(reachable: Uint8Array): number {
  let count = 0;
  for (const value of reachable) count += value;
  return count;
}

test('dark_metro is registered as the z-32 Maintenance route shortcut', () => {
  const route = designFloorById(DESIGN_FLOOR_ID);
  assert.equal(route?.z, DARK_METRO_FUTURE_Z);
  assert.equal(route?.baseFloor, FloorLevel.MAINTENANCE);
  assert.equal(route?.displayName, 'Темная пересадка');
  assert.equal(designFloorAtZ(DARK_METRO_FUTURE_Z)?.id, DESIGN_FLOOR_ID);
});

test('dark_metro keeps rail macro shape and fills it with mid and micro station rooms', () => {
  const gen = darkMetro();
  const reachable = assertReachableRouteLifts(gen, 'dark_metro genfix_083');
  const stationBlocks = gen.world.rooms.filter(room => room.name.startsWith('Станционный блок темной пересадки'));
  const stationMicroRooms = gen.world.rooms.filter(room =>
    room.name.startsWith('Кладовая станции темной пересадки') ||
    room.name.startsWith('Будка станции темной пересадки') ||
    room.name.startsWith('Задняя ячейка темной пересадки') ||
    room.name.startsWith('Ламповая ячейка темной пересадки') ||
    room.name.startsWith('Архивная ячейка темной пересадки') ||
    room.name.startsWith('Боковой карман темной пересадки'));
  const serviceIslands = gen.world.rooms.filter(room => room.name.startsWith('Сервисный остров темной пересадки'));
  const blindCells = gen.world.rooms.filter(room => room.name.startsWith('Слепая подсобка темной пересадки'));

  assertFullFootprint(gen.world, 'dark_metro genfix_083');
  assert.equal(gen.world.rooms.length >= 310, true, `rooms ${gen.world.rooms.length}`);
  assert.equal(gen.world.doors.size >= 280, true, `doors ${gen.world.doors.size}`);
  assert.equal(playableCellCount(gen) >= 250_000, true, `playable ${playableCellCount(gen)}`);
  assert.equal(reachableCount(reachable) >= 245_000, true, `reachable ${reachableCount(reachable)}`);
  assert.equal(gen.world.railTracks.length >= 7, true, `rail tracks ${gen.world.railTracks.length}`);
  assert.equal(gen.world.railTrains.length >= 7, true, `rail trains ${gen.world.railTrains.length}`);
  assert.equal(stationBlocks.length >= 24, true, `station blocks ${stationBlocks.length}`);
  assert.equal(stationMicroRooms.length >= 140, true, `station micro rooms ${stationMicroRooms.length}`);
  assert.equal(serviceIslands.length >= 14, true, `service islands ${serviceIslands.length}`);
  assert.equal(blindCells.length >= 30, true, `blind cells ${blindCells.length}`);
});

test('dark_metro has authored mini HQ compounds and target cell-first territory shares', () => {
  const gen = darkMetro();
  const roomNames = new Set(gen.world.rooms.map(room => room.name));
  const anchors = territoryHqAnchors(gen.world);
  const counts = new Map(countTerritoryCells(gen.world).map(row => [row.owner, row.cells]));
  const share = (owner: ZoneFaction): number => (counts.get(owner) ?? 0) / (W * W);
  const dominant = [...counts.entries()]
    .filter(([owner]) => owner !== ZoneFaction.SAMOSBOR)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const name of REQUIRED_SUPPORT_ROOMS) assert.equal(roomNames.has(name), true, name);

  for (const owner of HUMAN_TERRITORY_OWNERS) {
    assert.equal((counts.get(owner) ?? 0) > 0, true, `owned cells ${ZoneFaction[owner]}`);
    assert.equal(anchors.some(anchor => anchor.owner === owner), true, `hq anchor ${ZoneFaction[owner]}`);
    const targetShare = TARGET_SHARES.get(owner);
    assert.ok(targetShare !== undefined);
    assert.equal(Math.abs(share(owner) - targetShare) <= 0.025, true, `owner ${ZoneFaction[owner]} share ${share(owner)}`);
  }

  for (const [key, owner] of [
    ['citizen', ZoneFaction.CITIZEN],
    ['liquidator', ZoneFaction.LIQUIDATOR],
    ['cultist', ZoneFaction.CULTIST],
    ['scientist', ZoneFaction.SCIENTIST],
    ['wild', ZoneFaction.WILD],
  ] as const) {
    const room = gen.world.rooms.find(candidate => candidate.name === DARK_METRO_HQ_ROOM_NAMES[key]);
    assert.ok(room, DARK_METRO_HQ_ROOM_NAMES[key]);
    assert.equal(room.type, RoomType.HQ, DARK_METRO_HQ_ROOM_NAMES[key]);
    assert.equal(room.sealed, true, DARK_METRO_HQ_ROOM_NAMES[key]);
    assert.equal(territoryRoomOwner(gen.world, room.id), owner, DARK_METRO_HQ_ROOM_NAMES[key]);
    assert.equal(room.doors.some(doorIdx => gen.world.doors.get(doorIdx)?.state === DoorState.HERMETIC_OPEN), true, DARK_METRO_HQ_ROOM_NAMES[key]);
  }

  assert.equal(dominant, ZoneFaction.WILD);
});

test('dark_metro ambient veterans prefer their own cell territory after territory spread', () => {
  const gen = darkMetro();
  const ambientNpcs = gen.entities.filter(entity =>
    entity.type === EntityType.NPC &&
    !entity.plotNpcId &&
    !entity.persistentNpcId &&
    entity.alifeId === undefined &&
    entity.questId === -1 &&
    entity.faction !== undefined);
  const ownTerritoryNpcs = ambientNpcs.filter(entity => {
    const idx = gen.world.idx(Math.floor(entity.x), Math.floor(entity.y));
    return territoryOwnerToFaction(territoryOwnerAtIndex(gen.world, idx)) === entity.faction;
  });

  assert.equal(ambientNpcs.length > 0, true);
  assert.equal(ownTerritoryNpcs.length / ambientNpcs.length >= 0.90, true, `own territory NPC share ${ownTerritoryNpcs.length / ambientNpcs.length}`);
});
