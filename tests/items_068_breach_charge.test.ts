import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  DoorState,
  EntityType,
  Faction,
  ItemType,
  RoomType,
  Tex,
  type Entity,
  type Room,
} from '../src/core/types';
import { World } from '../src/core/world';
import { FACTORIES, productionOutputResourceIds } from '../src/data/factories';
import { ITEMS, WEAPON_ROLE_TIERS, WEAPON_STATS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { resolveBreachChargeExplosion } from '../src/systems/breach_charge';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { makeGameState } from './helpers';

test('breach charge is a scarce engineer self-ammo weapon with factory access', () => {
  const def = ITEMS.breach_charge;
  const stats = WEAPON_STATS.breach_charge;

  assert.equal(def.name, 'Пробивной заряд');
  assert.equal(def.type, ItemType.WEAPON);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.PRODUCTION]);
  assert.equal(def.stack, 2);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.equal(WEAPON_ROLE_TIERS.breach_charge, 'grenade');

  assert.equal(stats.isRanged, true);
  assert.equal(stats.ammoType, 'breach_charge');
  assert.equal(stats.aoeRadius, 3.4);
  assert.ok(stats.dmg > WEAPON_STATS.grenade.dmg);

  for (const tag of ['breach', 'engineer', 'self_ammo', 'collateral', 'door_work', 'biomass']) {
    assert.ok(def.tags?.includes(tag), `breach_charge item must carry ${tag} tag`);
    assert.ok(ITEM_TAGS.breach_charge?.includes(tag), `breach_charge tag registry must publish ${tag}`);
  }

  const armory = FACTORIES.find(factory => factory.id === 'armory_bench');
  const recipe = armory?.recipes.find(row => row.id === 'assemble_breach_charge');
  assert.ok(armory);
  assert.ok(recipe);
  assert.deepEqual(recipe.outputs, [{ defId: 'breach_charge', count: 1 }]);
  assert.equal(recipe.outputAccess, 'faction');
  assert.ok(recipe.eventTags?.includes('breach_charge'));
  assert.ok(productionOutputResourceIds(armory, recipe).includes('ammo'));
});

test('breach charge opens nearby ordinary doors, walls and biomass but not protected shelter cells', () => {
  const world = new World();
  const room: Room = {
    id: 0,
    type: RoomType.CORRIDOR,
    x: 8,
    y: 8,
    w: 8,
    h: 8,
    doors: [],
    sealed: false,
    name: 'Тестовый коридор',
    apartmentId: -1,
    wallTex: Tex.CONCRETE,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms[0] = room;

  const floor = (x: number, y: number): void => {
    const idx = world.idx(x, y);
    world.cells[idx] = Cell.FLOOR;
    world.floorTex[idx] = Tex.F_CONCRETE;
    world.roomMap[idx] = room.id;
    world.zoneMap[idx] = 3;
  };
  for (let y = 7; y <= 14; y++) {
    for (let x = 7; x <= 15; x++) floor(x, y);
  }

  const doorIdx = world.idx(11, 10);
  world.cells[doorIdx] = Cell.DOOR;
  world.wallTex[doorIdx] = Tex.DOOR_METAL;
  world.floorTex[doorIdx] = Tex.F_CONCRETE;
  world.roomMap[doorIdx] = room.id;
  world.zoneMap[doorIdx] = 3;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.LOCKED, roomA: room.id, roomB: -1, keyId: 'test_key', timer: 0 });
  room.doors.push(doorIdx);

  const concreteIdx = world.idx(12, 10);
  world.cells[concreteIdx] = Cell.WALL;
  world.wallTex[concreteIdx] = Tex.CONCRETE;
  world.zoneMap[concreteIdx] = 3;

  const meatIdx = world.idx(11, 11);
  world.cells[meatIdx] = Cell.WALL;
  world.wallTex[meatIdx] = Tex.MEAT;
  world.zoneMap[meatIdx] = 3;

  const protectedIdx = world.idx(10, 11);
  world.cells[protectedIdx] = Cell.WALL;
  world.wallTex[protectedIdx] = Tex.CONCRETE;
  world.aptMask[protectedIdx] = 1;
  world.zoneMap[protectedIdx] = 3;

  const hermoIdx = world.idx(12, 11);
  world.cells[hermoIdx] = Cell.WALL;
  world.wallTex[hermoIdx] = Tex.HERMO_WALL;
  world.hermoWall[hermoIdx] = 1;
  world.zoneMap[hermoIdx] = 3;

  const player: Entity = {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 11.5,
    y: 10.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    name: 'Вы',
    faction: Faction.PLAYER,
  };
  const state = makeGameState({ worldEvents: createWorldEventState() });
  const beforeCellVersion = world.cellVersion;
  const beforeWallVersion = world.wallTexVersion;
  const beforeFloorVersion = world.floorTexVersion;
  const beforeFeatureVersion = world.featureVersion;

  const result = resolveBreachChargeExplosion(world, state, player, 'breach_charge', 11.5, 10.5, 3.4);

  assert.equal(result.breachedDoors, 1);
  assert.equal(result.breachedWalls, 2);
  assert.equal(result.breachedBiomass, 1);
  assert.equal(result.changedCells, 3);
  assert.ok(result.protectedBlocked >= 2);
  assert.equal(world.doors.has(doorIdx), false);
  assert.equal(world.cells[doorIdx], Cell.FLOOR);
  assert.equal(world.cells[concreteIdx], Cell.FLOOR);
  assert.equal(world.cells[meatIdx], Cell.FLOOR);
  assert.equal(world.cells[protectedIdx], Cell.WALL);
  assert.equal(world.cells[hermoIdx], Cell.WALL);
  assert.ok(world.cellVersion > beforeCellVersion);
  assert.ok(world.wallTexVersion > beforeWallVersion);
  assert.ok(world.floorTexVersion > beforeFloorVersion);
  assert.ok(world.featureVersion > beforeFeatureVersion);

  const event = getRecentEvents(state, { type: 'collateral_damage', tags: ['breach_charge'], limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.itemId, 'breach_charge');
  assert.equal(event.zoneId, 3);
  assert.equal(event.data?.changedCells, 3);
  assert.equal(event.data?.breachedDoors, 1);
  assert.equal(event.data?.breachedBiomass, 1);
});
