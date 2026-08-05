import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('liquidator field roster is reachable evidence with a document economy role', () => {
  const def = ITEMS.liquidator_field_roster;

  assert.equal(def.id, 'liquidator_field_roster');
  assert.equal(def.name, 'Полевая ведомость ликвидаторов');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'liquidator', 'roster', 'evidence', 'route', 'audit']) {
    assert.ok(ITEM_TAGS.liquidator_field_roster?.includes(tag), `liquidator_field_roster must publish ${tag}`);
  }
});

test('liquidator field roster can be sold as missing-squad evidence in the living block', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 82 });

  assert.equal(addItem(player, 'liquidator_field_roster', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'liquidator_field_roster'), 0);
  assert.equal(player.money, 48);
  assert.ok(state.msgs.some(line => line.text.includes('Полевая ведомость ликвидаторов')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', limit: 1 })[0];
  assert.equal(sale?.itemId, 'liquidator_field_roster');
  assert.ok(sale.tags.includes('black_market'));
  assert.ok(sale.tags.includes('liquidator'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
