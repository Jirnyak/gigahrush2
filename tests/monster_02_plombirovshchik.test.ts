import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  DoorState, EntityType, FloorLevel, MonsterKind,
  type Entity,
} from '../src/core/types';
import { World } from '../src/core/world';
import { generatePlombirovshchik } from '../src/gen/living/plombirovshchik';
import { createWorldEventState, getRecentEvents, publishEvent } from '../src/systems/events';
import { makeGameState } from './helpers';

test('Plombirovshchik uses Shovnik body and opens local seal when killed away from seam', () => {
  const world = new World();
  const entities: Entity[] = [{
    id: 0,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 100.5,
    y: 100.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 1,
    sprite: 0,
    name: 'Вы',
  }];
  const nextId = { v: 1 };

  generatePlombirovshchik(world, 0, entities, nextId, 100, 100);

  const lockedDoors = [...world.doors.values()].filter(door => door.state === DoorState.LOCKED);
  assert.equal(lockedDoors.length, 1);
  assert.ok([...world.doors.values()].some(door => door.state === DoorState.OPEN));

  const monster = entities.find(e => e.type === EntityType.MONSTER && e.name === 'Пломбировщик');
  assert.ok(monster);
  assert.equal(monster.monsterKind, MonsterKind.SHOVNIK);

  const mainRoom = world.rooms[0];
  const state = makeGameState({
    currentFloor: FloorLevel.LIVING,
    worldEvents: createWorldEventState(),
  });
  publishEvent(state, {
    type: 'player_kill_monster',
    floor: FloorLevel.LIVING,
    x: mainRoom.x + 4.5,
    y: mainRoom.y + 5.5,
    actorId: 0,
    actorName: 'Вы',
    targetId: monster.id,
    targetName: 'Пломбировщик',
    monsterKind: MonsterKind.SHOVNIK,
    severity: 3,
    privacy: 'local',
    tags: ['combat', 'kill', 'monster'],
  });

  assert.equal(world.doors.get(lockedDoors[0].idx)?.state, DoorState.HERMETIC_OPEN);
  const routeEvents = getRecentEvents(state, { tags: ['plombirovshchik', 'route_denial'], limit: 4 });
  assert.ok(routeEvents.some(event => event.type === 'door_opened' && event.tags.includes('threat_killed')));
});
