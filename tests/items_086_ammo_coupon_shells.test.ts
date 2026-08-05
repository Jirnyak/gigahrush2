import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('ammo coupon shells is reachable official shotgun ammo paperwork', () => {
  const def = ITEMS.ammo_coupon_shells;

  assert.equal(def.id, 'ammo_coupon_shells');
  assert.equal(def.name, 'Талон на дробь');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'ammo');

  for (const tag of ['document', 'coupon', 'weapon_permit', 'ammo', 'single_use', 'official']) {
    assert.ok(ITEM_TAGS.ammo_coupon_shells?.includes(tag), `ammo_coupon_shells must publish ${tag}`);
  }
});

test('ammo coupon shells redeems into legal shotgun shells', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'ammo_coupon_shells', count: 1 }] });
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 86 });

  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter погасить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'ammo_coupon_shells'), 0);
  assert.equal(countInventoryItem(player, 'ammo_shells'), 4);
  assert.ok(state.msgs.some(line => line.text.includes('Талон на дробь погашен')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['ammo_coupon'], limit: 1 })[0];
  assert.equal(event?.itemId, 'ammo_coupon_shells');
  assert.equal(event?.data?.outcome, 'shell_coupon_redeemed');
  assert.equal(event?.data?.outputItemId, 'ammo_shells');
  assert.equal(event?.data?.outputCount, 4);
});
