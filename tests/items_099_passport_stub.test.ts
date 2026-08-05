import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { CONTRACTS } from '../src/data/contracts';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { RUMORS } from '../src/data/rumors';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'passport_stub';

test('passport stub remains the existing identity document item', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Паспортный корешок');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.OFFICE]);
  assert.equal(resourceForItem(def.id)?.id, 'documents');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'identity', 'passport', 'access', 'evidence']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `passport_stub registry must publish ${tag}`);
  }

  const player = makeTestPlayer();
  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');
});

test('passport stub has reachable steal, reward, archive and black-market decisions', () => {
  const lead = RUMORS.find(rumor => rumor.id === 'lead_ministry_queue_hall_stub');
  assert.equal(lead?.lead?.itemId, ITEM_ID);
  assert.ok(lead?.lead?.action.includes('укради корешок'));

  assert.ok(CONTRACTS.some(contract => contract.rewardItem === ITEM_ID));

  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 99 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 34);

  const sale = getRecentEvents(state, { type: 'player_sell_item', limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.ok(sale.tags.includes('identity'));
  assert.ok(sale.tags.includes('black_market'));
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
});
