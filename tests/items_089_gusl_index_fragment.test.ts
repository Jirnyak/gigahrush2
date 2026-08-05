import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('gusl index fragment is reachable office paperwork for odd weapon classification', () => {
  const def = ITEMS.gusl_index_fragment;

  assert.equal(def.id, 'gusl_index_fragment');
  assert.equal(def.name, 'Обрывок ГУСЛ');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(def.spawnW > 0);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'gusl', 'index', 'fragment', 'weapon', 'evidence', 'trade']) {
    assert.ok(ITEM_TAGS.gusl_index_fragment?.includes(tag), `gusl_index_fragment must publish ${tag}`);
  }
});

test('gusl index fragment can be sold as a black-market weapon hint', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 89 });

  assert.equal(addItem(player, 'gusl_index_fragment', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'gusl_index_fragment'), 0);
  assert.equal(player.money, 24);
  assert.ok(state.msgs.some(line => line.text.includes('Обрывок ГУСЛ')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market'], limit: 1 })[0];
  assert.equal(sale?.itemId, 'gusl_index_fragment');
  assert.equal(sale?.data?.outcome, 'black_market_document_sale');
  assert.equal(sale?.data?.rewardMoney, 24);
});
