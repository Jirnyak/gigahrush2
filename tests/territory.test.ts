import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { Cell, EntityType, Faction, FloorLevel, Occupation, RoomType, Tex, ZoneFaction, type Entity, type Room } from '../src/core/types';
import { World } from '../src/core/world';
import { factionToTerritoryOwner } from '../src/data/factions';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import {
  dominantTerritoryOwnerInRoom,
  initializeCellTerritory,
  paintRoomTerritory,
  paintTerritoryDisc,
  setTerritoryOwnerAt,
  syncZoneMetadataFromTerritory,
  territoryOwnerAt,
  territoryRoomOwner,
  updateTerritoryCapture,
} from '../src/systems/territory';
import { makeGameState } from './helpers';

function singleZoneWorld(owner: ZoneFaction): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  world.zoneMap.fill(0);
  world.zones[0] = {
    id: 0,
    cx: 64,
    cy: 64,
    faction: owner,
    hasLift: false,
    fogged: false,
    level: 2,
    hqRoomId: -1,
  };
  return world;
}

function mappedRoom(world: World, id: number, x: number, y: number, w: number, h: number, type = RoomType.STORAGE): Room {
  const room: Room = {
    id,
    type,
    x,
    y,
    w,
    h,
    doors: [],
    sealed: false,
    name: `room ${id}`,
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms[id] = room;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = world.idx(x + dx, y + dy);
      world.cells[idx] = Cell.FLOOR;
      world.roomMap[idx] = id;
    }
  }
  return room;
}

function npc(id: number, faction: Faction, x: number, y: number): Entity {
  return {
    id,
    type: EntityType.NPC,
    x,
    y,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: `npc ${id}`,
    faction,
    occupation: Occupation.TRAVELER,
    isTraveler: true,
  };
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(file);
  }
  return out;
}

test('cell territory initialization preserves authored cell control over zone metadata', () => {
  const world = singleZoneWorld(ZoneFaction.CITIZEN);
  world.factionControl.fill(ZoneFaction.CULTIST);

  initializeCellTerritory(world);

  assert.equal(territoryOwnerAt(world, 64, 64), ZoneFaction.CULTIST);
  assert.equal(world.zones[0].faction, ZoneFaction.CULTIST);
});

test('cell territory initialization can seed from zone metadata when no authored field exists', () => {
  const world = singleZoneWorld(ZoneFaction.LIQUIDATOR);

  initializeCellTerritory(world);

  assert.equal(territoryOwnerAt(world, 64, 64), ZoneFaction.LIQUIDATOR);
  assert.equal(factionToTerritoryOwner(Faction.SCIENTIST), ZoneFaction.SCIENTIST);
});

test('territory helpers paint cells while preserving protected ownership', () => {
  const world = singleZoneWorld(ZoneFaction.CITIZEN);
  const room = mappedRoom(world, 1, 20, 20, 4, 4);
  const protectedIdx = world.idx(21, 21);
  world.aptMask[protectedIdx] = 1;

  const changed = paintRoomTerritory(world, room.id, ZoneFaction.WILD);

  assert.equal(changed, 15);
  assert.equal(territoryOwnerAt(world, 20, 20), ZoneFaction.WILD);
  assert.equal(territoryOwnerAt(world, 21, 21), ZoneFaction.CITIZEN);

  setTerritoryOwnerAt(world, 24, 20, ZoneFaction.SAMOSBOR);
  const discChanged = paintTerritoryDisc(world, 24, 20, 2, ZoneFaction.LIQUIDATOR, {
    preserveSamosbor: true,
    passableOnly: true,
  });

  assert.equal(discChanged > 0, true);
  assert.equal(territoryOwnerAt(world, 24, 20), ZoneFaction.SAMOSBOR);
});

test('room territory owner derives from mapped cells instead of zone metadata', () => {
  const world = singleZoneWorld(ZoneFaction.LIQUIDATOR);
  const room = mappedRoom(world, 1, 30, 30, 4, 4);
  world.factionControl.fill(ZoneFaction.CITIZEN);
  for (let n = 0; n < 9; n++) {
    setTerritoryOwnerAt(world, room.x + (n % room.w), room.y + ((n / room.w) | 0), ZoneFaction.CULTIST);
  }

  assert.equal(world.zones[0].faction, ZoneFaction.LIQUIDATOR);
  assert.equal(dominantTerritoryOwnerInRoom(world, room.id), ZoneFaction.CULTIST);
  assert.equal(territoryRoomOwner(world, room.id), ZoneFaction.CULTIST);
});

test('zone metadata sync follows dominant cell territory and stays derived', () => {
  const world = singleZoneWorld(ZoneFaction.CITIZEN);
  world.factionControl.fill(ZoneFaction.SCIENTIST);

  syncZoneMetadataFromTerritory(world);

  assert.equal(world.zones[0].faction, ZoneFaction.SCIENTIST);
  assert.equal(territoryOwnerAt(world, 64, 64), ZoneFaction.SCIENTIST);
});

test('territory capture needs local faction pressure, not one idle traveler', () => {
  const world = singleZoneWorld(ZoneFaction.CULTIST);
  world.factionControl.fill(ZoneFaction.CULTIST);
  const state = makeGameState({
    currentFloor: FloorLevel.KVARTIRY,
    time: 10,
    worldEvents: createWorldEventState(),
  });

  const one = [npc(1, Faction.LIQUIDATOR, 64.5, 64.5)];
  assert.equal(updateTerritoryCapture(world, one, state, 2.1), 0);
  assert.equal(territoryOwnerAt(world, 64, 64), ZoneFaction.CULTIST);

  const squad = [
    npc(1, Faction.LIQUIDATOR, 64.5, 64.5),
    npc(2, Faction.LIQUIDATOR, 65.5, 64.5),
  ];
  const changed = updateTerritoryCapture(world, squad, state, 2.1);

  assert.ok(changed > 0);
  assert.equal(territoryOwnerAt(world, 64, 64), ZoneFaction.LIQUIDATOR);
  const event = getRecentEvents(state, { tags: ['territory_capture'], limit: 1 })[0];
  assert.equal(event?.data?.owner, ZoneFaction.LIQUIDATOR);
});

test('territory capture does not overwrite samosbor-owned cells', () => {
  const world = singleZoneWorld(ZoneFaction.CULTIST);
  world.factionControl.fill(ZoneFaction.CULTIST);
  setTerritoryOwnerAt(world, 64, 64, ZoneFaction.SAMOSBOR);
  const state = makeGameState({
    currentFloor: FloorLevel.KVARTIRY,
    time: 20,
    worldEvents: createWorldEventState(),
  });

  const squad = [
    npc(1, Faction.LIQUIDATOR, 64.5, 64.5),
    npc(2, Faction.LIQUIDATOR, 65.5, 64.5),
  ];
  const changed = updateTerritoryCapture(world, squad, state, 2.1);

  assert.equal(changed > 0, true);
  assert.equal(territoryOwnerAt(world, 64, 64), ZoneFaction.SAMOSBOR);
});

test('runtime systems route cell territory reads and writes through territory helpers', () => {
  const root = process.cwd();
  const systemsDir = join(root, 'src/systems');
  const allowed = new Set([
    'src/systems/territory.ts',
  ]);
  const offenders: string[] = [];

  for (const file of tsFiles(systemsDir)) {
    const rel = relative(root, file).replaceAll('\\', '/');
    if (allowed.has(rel)) continue;
    const source = readFileSync(file, 'utf8');
    const pattern = /\bfactionControl\s*(?:\[|\.fill\()/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${rel}:${line}`);
    }
  }

  assert.deepEqual(offenders, []);
});
