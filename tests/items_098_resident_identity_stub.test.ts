import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('resident identity stub is a reachable living-block identity document', () => {
  const def = ITEMS.resident_identity_stub;

  assert.equal(def.id, 'resident_identity_stub');
  assert.equal(def.name, 'Корешок удостоверения личности');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.LIVING));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.equal(def.stack, 6);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'identity', 'resident', 'official', 'access', 'evidence', 'trade']) {
    assert.ok(ITEM_TAGS.resident_identity_stub?.includes(tag), `resident_identity_stub must publish ${tag}`);
  }
});

test('resident identity stub can be sold as basic papers in the living block', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 98 });

  assert.equal(addItem(player, 'resident_identity_stub', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'resident_identity_stub'), 0);
  assert.equal(player.money, 24);
  assert.ok(state.msgs.some(line => line.text.includes('Корешок удостоверения личности')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market'], limit: 1 })[0];
  assert.equal(sale?.itemId, 'resident_identity_stub');
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
  assert.ok(sale.tags.includes('identity'));
});
