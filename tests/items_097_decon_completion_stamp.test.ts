import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const STAMP_ID = 'decon_completion_stamp';

test('decon completion stamp is official cleanup paperwork', () => {
  const def = ITEMS[STAMP_ID];

  assert.equal(def.id, STAMP_ID);
  assert.equal(def.name, 'Штамп санобработки');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.ok(def.spawnRooms.includes(RoomType.MEDICAL));
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'decon', 'stamp', 'official', 'cleanup', 'liquidator', 'maintenance', 'trade']) {
    assert.ok(ITEM_TAGS[STAMP_ID]?.includes(tag), `decon_completion_stamp registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `decon_completion_stamp item must carry ${tag}`);
  }
});

test('decon completion stamp can be sold as cleanup proof in the living block', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 97 });

  assert.equal(addItem(player, STAMP_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, STAMP_ID), 0);
  assert.equal(player.money, 35);
  assert.ok(state.msgs.some(line => line.text.includes('Штамп санобработки')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['decon', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, STAMP_ID);
  assert.ok(sale.tags.includes('black_market'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
