import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'samosbor_alarm_schedule';

test('samosbor alarm schedule is reachable office and HQ alarm paperwork', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'График тревог');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.desc.includes('Не предсказывает Самосбор'));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.ok(def.spawnRooms.includes(RoomType.COMMON));
  assert.equal(def.stack, 2);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'samosbor', 'alarm', 'schedule', 'evidence']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `samosbor_alarm_schedule must publish ${tag}`);
  }
});

test('samosbor alarm schedule can be traded as false-alarm evidence', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 112 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 44);
  assert.ok(state.msgs.some(line => line.text.includes('График тревог')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['samosbor', 'audit_risk'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.ok(sale.tags.includes('black_market'));
  assert.ok(sale.tags.includes('trade'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
  assert.equal(sale.data?.rewardMoney, 44);
});
