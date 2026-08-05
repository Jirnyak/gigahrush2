import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const COUPON_ID = 'concentrate_bonus_coupon';

test('concentrate bonus coupon is premium ration paperwork', () => {
  const def = ITEMS[COUPON_ID];

  assert.equal(def.id, COUPON_ID);
  assert.equal(def.name, 'Премиальный талон концентрата');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.KITCHEN));
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'ration', 'coupon', 'concentrate', 'single_use', 'official']) {
    assert.ok(ITEM_TAGS[COUPON_ID]?.includes(tag), `concentrate_bonus_coupon must publish ${tag}`);
  }
});

test('concentrate bonus coupon redeems into better concentrate rations', () => {
  const player = makeTestPlayer({ inventory: [{ defId: COUPON_ID, count: 1 }] });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 116 });

  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter погасить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, COUPON_ID), 0);
  assert.equal(countInventoryItem(player, 'green_briquette'), 2);
  assert.ok(state.msgs.some(line => line.text.includes('Премиальный талон погашен')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['concentrate'], limit: 1 })[0];
  assert.equal(event?.itemId, COUPON_ID);
  assert.equal(event?.data?.outcome, 'bonus_concentrate_redeemed');
  assert.equal(event?.data?.outputItemId, 'green_briquette');
  assert.equal(event?.data?.outputCount, 2);
  assert.ok(event?.tags.includes('official'));
});
