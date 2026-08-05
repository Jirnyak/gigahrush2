import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'mail_intercept_slip';

test('mail intercept slip is office and black-market mail evidence', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Лист перехвата почты');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.SMOKING));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.ok(RESOURCES.find(resource => resource.id === 'contraband')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'mail', 'stolen', 'contraband', 'evidence']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `mail_intercept_slip must publish ${tag}`);
  }
});

test('mail intercept slip can be sold as stolen delivery intelligence', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 104 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 40);
  assert.ok(state.msgs.some(line => line.text.includes('Лист перехвата почты')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['mail', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.ok(sale.tags.includes('black_market'));
  assert.ok(sale.tags.includes('contraband'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
