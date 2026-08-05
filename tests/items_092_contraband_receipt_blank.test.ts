import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('contraband receipt blank is reachable forgery paperwork', () => {
  const def = ITEMS.contraband_receipt_blank;

  assert.equal(def.id, 'contraband_receipt_blank');
  assert.equal(def.name, 'Пустая расписка контрабанды');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.SMOKING));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'contraband')?.itemIds.includes(def.id));
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'receipt', 'contraband', 'forgery', 'audit']) {
    assert.ok(ITEM_TAGS.contraband_receipt_blank?.includes(tag), `contraband_receipt_blank must publish ${tag}`);
  }
});

test('contraband receipt blank can be sold as black-market document risk', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 92 });

  assert.equal(addItem(player, 'contraband_receipt_blank', 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'contraband_receipt_blank'), 0);
  assert.equal(player.money, 42);
  assert.ok(state.msgs.some(line => line.text.includes('Пустая расписка контрабанды')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['contraband', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, 'contraband_receipt_blank');
  assert.ok(sale.tags.includes('black_market'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
