import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, FloorLevel, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { RESOURCES } from '../src/data/resources';
import { BLACK_MARKET_88_STOCK } from '../src/gen/design_floors/black_market_88';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'stolen_terminal_stamp';

test('stolen terminal stamp is a risky terminal forgery document', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Украденная печать терминала');
  assert.equal(def.type, ItemType.MISC);
  assert.equal(def.stack, 1);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.SMOKING));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'terminal', 'stamp', 'contraband', 'forgery', 'audit', 'black_market']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `stolen_terminal_stamp must publish ${tag}`);
  }

  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(ITEM_ID));
  assert.ok(RESOURCES.find(resource => resource.id === 'contraband')?.itemIds.includes(ITEM_ID));
});

test('stolen terminal stamp is reachable through office theft and Black Market 88', () => {
  assert.ok(
    CONTAINER_DEFS[ContainerKind.SAFE].itemPool.some(entry => entry.defId === ITEM_ID),
    'office safes must be able to hold the stolen terminal stamp',
  );

  const offer = BLACK_MARKET_88_STOCK.find(row => row.itemId === ITEM_ID);
  assert.equal(offer?.lane, 'documents');
  assert.equal(offer?.count, 1);
  assert.equal((offer?.heatDelta ?? 0) > 0, true);
});

test('stolen terminal stamp can be sold as black market document risk', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 200 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 118);
  assert.ok(state.msgs.some(line => line.text.includes('Украденная печать терминала')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.equal(sale?.data?.outcome, 'black_market_document_sale');
  assert.equal(sale?.data?.rewardMoney, 118);
  assert.ok(sale?.tags.includes('forgery'));
});
