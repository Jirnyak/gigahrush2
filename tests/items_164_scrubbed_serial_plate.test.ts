import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, FloorLevel, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORIES } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'scrubbed_serial_plate';

test('scrubbed serial plate is contraband weapon audit proof', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Сбитая номерная планка');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.SMOKING));
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(def.stack, 3);
  assert.equal(resourceForItem(def.id)?.id, 'metal');
  assert.ok(RESOURCES.find(resource => resource.id === 'contraband')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['contraband', 'weapon', 'serial', 'audit', 'evidence', 'forgery', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `${ITEM_ID} registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `${ITEM_ID} item must carry ${tag}`);
  }
});

test('scrubbed serial plate is reachable through black-market caches and serial scrubbing', () => {
  const secretStashIds = new Set(CONTAINER_DEFS[ContainerKind.SECRET_STASH].itemPool.map(item => item.defId));
  assert.ok(secretStashIds.has(ITEM_ID));

  const scrubRecipe = FACTORIES
    .find(factory => factory.id === 'illegal_ammo_smelter')
    ?.recipes.find(recipe => recipe.id === 'scrub_weapon_serials');

  assert.ok(scrubRecipe);
  assert.ok(scrubRecipe.outputs.some(item => item.defId === ITEM_ID && item.count === 2));
});

test('scrubbed serial plate can be sold as audit-risk black-market proof', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 164 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter сдать/сбыть');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 72);
  assert.ok(state.msgs.some(line => line.text.includes('Сбитая номерная планка продана')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.equal(sale?.data?.outcome, 'weapon_serial_plate_sold');
});

test('scrubbed serial plate can be reported instead of sold', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 165 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 54);
  assert.ok(state.msgs.some(line => line.text.includes('сдана как оружейная улика')));

  const report = getRecentEvents(state, { type: 'player_handoff_item', tags: ['report', 'evidence'], limit: 1 })[0];
  assert.equal(report?.itemId, ITEM_ID);
  assert.equal(report?.data?.outcome, 'weapon_serial_plate_reported');
});
