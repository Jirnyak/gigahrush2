import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  Cell,
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  RoomType,
  Tex,
  type Entity,
} from '../src/core/types';
import { World } from '../src/core/world';
import {
  METRO_ERROR_ROOM_NAME,
  METRO_STATION_ROOM_NAME,
  metroRoutesForRoom,
} from '../src/data/metro';
import { getRecentEvents } from '../src/systems/events';
import { tryUseMetroRoute } from '../src/systems/metro';
import { makeGameState } from './helpers';

function makeMetroRoom(roomName: string, feature: Feature, panelSlot = 0): World {
  const world = new World();
  const room = {
    id: 0,
    type: RoomType.CORRIDOR,
    x: 10,
    y: 10,
    w: 18,
    h: 8,
    doors: [],
    sealed: false,
    name: roomName,
    apartmentId: -1,
    wallTex: Tex.METAL,
    floorTex: Tex.F_CONCRETE,
  };
  world.rooms.push(room);
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      const ci = world.idx(x, y);
      world.cells[ci] = Cell.FLOOR;
      world.roomMap[ci] = room.id;
    }
  }
  world.features[world.idx(room.x + 2 + panelSlot * 3, room.y + 2)] = feature;
  return world;
}

function testPlayer(inventory: Entity['inventory'] = []): Entity {
  return {
    id: 1,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 12.5,
    y: 12.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 3,
    sprite: 0,
    faction: Faction.PLAYER,
    inventory,
  };
}

function withRandom(value: number, fn: () => void): void {
  const prev = Math.random;
  Math.random = () => value;
  try {
    fn();
  } finally {
    Math.random = prev;
  }
}

test('metro wrong stop sends the player to a local transfer with a return clue', () => {
  const world = makeMetroRoom(METRO_STATION_ROOM_NAME, Feature.SCREEN, 0);
  const player = testPlayer([{ defId: 'metro_ticket', count: 2 }]);
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 10_000 });

  withRandom(0, () => {
    const result = tryUseMetroRoute(world, player, state, 12, 12);

    assert.ok(result);
    assert.equal(result.wrongStop, true);
    assert.equal(result.destination?.kind, 'local');
    if (result.destination?.kind === 'local') assert.equal(result.destination.roomName, METRO_ERROR_ROOM_NAME);
    assert.match(result.message, /белый экран/i);
    assert.equal(player.inventory?.find(i => i.defId === 'metro_ticket')?.count, 1);
  });

  const event = getRecentEvents(state, { type: 'metro_wrong_stop', limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.data?.returnRouteId, 'metro_error_safe_return');
  assert.equal(event.tags.includes('wrong_stop'), true);
});

test('metro blind transfer has a ticket-free safe return route', () => {
  const world = makeMetroRoom(METRO_ERROR_ROOM_NAME, Feature.SCREEN, 0);
  const player = testPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 20_000 });

  const result = tryUseMetroRoute(world, player, state, 12, 12);

  assert.ok(result);
  assert.equal(result.route.safeReturn, true);
  assert.equal(result.wrongStop, false);
  assert.equal(result.destination?.kind, 'local');
  if (result.destination?.kind === 'local') assert.equal(result.destination.roomName, METRO_STATION_ROOM_NAME);
  assert.equal(player.inventory?.length, 0);

  const event = getRecentEvents(state, { type: 'metro_route_taken', limit: 1 })[0];
  assert.ok(event);
  assert.equal(event.data?.safeReturn, true);
  assert.equal(event.tags.includes('safe_return'), true);
});

test('platform panel generation remains bounded to station routes', () => {
  assert.equal(metroRoutesForRoom(METRO_STATION_ROOM_NAME).length, 4);
  assert.equal(metroRoutesForRoom(METRO_ERROR_ROOM_NAME).length, 1);
});
