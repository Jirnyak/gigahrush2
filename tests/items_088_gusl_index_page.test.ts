import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'gusl_index_page';

test('gusl index page is an official lore and access clue document', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Страница индекса ГУСЛ');
  assert.equal(def.type, ItemType.NOTE);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(def.stack, 1);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'gusl', 'index', 'official', 'lore', 'access']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `gusl_index_page registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `gusl_index_page item must carry ${tag}`);
  }
});

test('gusl index page can be sold as access intelligence in the living block', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 88 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 54);
  assert.ok(state.msgs.some(line => line.text.includes('Страница индекса ГУСЛ')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['gusl'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.ok(sale.tags.includes('black_market'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
