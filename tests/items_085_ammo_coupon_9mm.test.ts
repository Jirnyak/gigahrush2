import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('ammo coupon 9mm is reachable official ammo paperwork', () => {
  const def = ITEMS.ammo_coupon_9mm;

  assert.equal(def.id, 'ammo_coupon_9mm');
  assert.equal(def.name, 'Талон на 9мм');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'ammo');

  for (const tag of ['document', 'coupon', 'weapon_permit', 'ammo', 'single_use', 'official']) {
    assert.ok(ITEM_TAGS.ammo_coupon_9mm?.includes(tag), `ammo_coupon_9mm must publish ${tag}`);
  }
});

test('ammo coupon 9mm redeems into legal 9mm ammo', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'ammo_coupon_9mm', count: 1 }] });
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 85 });

  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter погасить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'ammo_coupon_9mm'), 0);
  assert.equal(countInventoryItem(player, 'ammo_9mm'), 10);
  assert.ok(state.msgs.some(line => line.text.includes('Талон на 9мм погашен')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['ammo_coupon'], limit: 1 })[0];
  assert.equal(event?.itemId, 'ammo_coupon_9mm');
  assert.equal(event?.data?.outcome, 'ammo_coupon_redeemed');
  assert.equal(event?.data?.outputItemId, 'ammo_9mm');
  assert.equal(event?.data?.outputCount, 10);
});
