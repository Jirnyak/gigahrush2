import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  EntityType,
  Faction,
  Feature,
  FloorLevel,
  type Entity,
} from '../src/core/types';
import { World } from '../src/core/world';
import {
  EKRANNIK_EVENT_DANGER,
  EKRANNIK_EVENT_DISABLED,
  EKRANNIK_EVENT_READ,
  EKRANNIK_ID,
  generateEkrannik,
} from '../src/gen/void/ekrannik';
import { takeFromContainer } from '../src/systems/containers';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { routeCueCount } from '../src/systems/route_cues';
import { makeGameState } from './helpers';

function player(): Entity {
  return {
    id: 1000,
    type: EntityType.NPC, persistentNpcId: 'player',
    x: 512.5,
    y: 512.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    name: 'Вы',
    faction: Faction.PLAYER,
    inventory: [],
  };
}

test('ekrannik misinformation stays local and publishes reversible encounter events', () => {
  const world = new World();
  const entities: Entity[] = [];
  const nextId = { v: 1 };
  generateEkrannik(world, entities, nextId, 512, 512);

  const actor = player();
  entities.push(actor);
  const state = makeGameState({
    currentFloor: FloorLevel.VOID,
    worldEvents: createWorldEventState(),
  });

  const read = world.containers.find(container => container.tags.includes('ekrannik_read'));
  const danger = world.containers.find(container => container.tags.includes('ekrannik_danger'));
  const disable = world.containers.find(container => container.tags.includes('ekrannik_disable'));
  assert.ok(read);
  assert.ok(danger);
  assert.ok(disable);
  assert.equal(world.screenCells.length, 3);
  assert.equal(routeCueCount(world), 1);

  assert.equal(takeFromContainer(read, actor, 0, 1, { state, world, entities }), true);
  assert.equal(takeFromContainer(danger, actor, 0, 1, { state, world, entities }), true);
  assert.equal(takeFromContainer(disable, actor, 0, 1, { state, world, entities }), true);

  const readEvent = getRecentEvents(state, { tags: [EKRANNIK_ID, 'read'], limit: 1 })[0];
  const dangerEvent = getRecentEvents(state, { tags: [EKRANNIK_ID, 'danger'], limit: 1 })[0];
  const disabledEvent = getRecentEvents(state, { tags: [EKRANNIK_ID, 'disabled'], limit: 1 })[0];

  assert.equal(readEvent?.type, EKRANNIK_EVENT_READ);
  assert.equal(dangerEvent?.type, EKRANNIK_EVENT_DANGER);
  assert.equal(disabledEvent?.type, EKRANNIK_EVENT_DISABLED);
  assert.equal(readEvent?.data?.questStateMutated, false);
  assert.equal(state.quests.length, 0);
  assert.equal(
    getRecentEvents(state).some(event => event.type === 'quest_created' || event.type === 'quest_completed' || event.type === 'quest_failed'),
    false,
  );
  assert.equal(world.screenCells.length, 0);
  assert.equal(world.features.some(feature => feature === Feature.SCREEN), false);
});
