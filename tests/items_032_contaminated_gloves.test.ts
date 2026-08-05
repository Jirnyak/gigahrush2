import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateFiltronos } from '../src/gen/maintenance/filtronos';
import { takeFromContainer } from '../src/systems/containers';
import { createWorldEventState, getRecentEvents } from '../src/systems/events';
import { inventoryItemCategory } from '../src/systems/inventory';
import { makeGameState, makeTestPlayer } from './helpers';

test('contaminated gloves are low-value cleanup contraband evidence', () => {
  const def = ITEMS.contaminated_gloves;

  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(def.value, 8);
  assert.equal(getStack(def), 6);
  assert.equal(resourceForItem(def.id)?.id, 'contraband');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['liquidator', 'cleanup', 'contaminated', 'evidence', 'contraband']) {
    assert.ok(ITEM_TAGS.contaminated_gloves?.includes(tag), `contaminated_gloves must publish ${tag} tag`);
    assert.ok(def.tags?.includes(tag), `contaminated_gloves def must carry ${tag} tag`);
  }
});

test('failed Filtronos cache handling generates contaminated gloves', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateFiltronos({ world, entities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const stash = world.containers.find(container => container.tags.includes('filtronos_cache'));
  assert.ok(stash, 'Filtronos generation should expose a filter cache');
  assert.equal(stash.inventory.some(item => item.defId === 'contaminated_gloves'), false);

  const player = makeTestPlayer({ id: 9001, x: stash.x + 0.5, y: stash.y + 0.5 });
  const state = makeGameState({
    currentFloor: FloorLevel.MAINTENANCE,
    worldEvents: createWorldEventState(),
  });

  assert.equal(takeFromContainer(stash, player, 0, 1, { state, world, entities }), true);
  assert.equal(stash.tags.includes('contaminated'), true);
  assert.equal(stash.inventory.some(item => item.defId === 'contaminated_gloves'), true);

  const event = getRecentEvents(state, { tags: ['monster_08_filtronos', 'contaminated'] })[0];
  assert.ok(event, 'failed cache handling should publish a contaminated Filtronos event');
  assert.equal(event.data?.consequenceItem, 'contaminated_gloves');
  assert.equal(event.data?.contaminatedGlovesAdded, true);
});
