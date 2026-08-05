import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEMS } from '../src/data/catalog';
import { ITEM_TAGS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('foam grenade act is official HQ paperwork for legal foam issue', () => {
  const def = ITEMS.foam_grenade_act;

  assert.equal(def.id, 'foam_grenade_act');
  assert.equal(def.name, 'Акт выдачи 6П10');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.OFFICE]);
  assert.equal(def.stack, 2);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.ok(RESOURCES.find(resource => resource.id === 'paper')?.itemIds.includes(def.id));
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'weapon_permit', 'foam', 'official', 'liquidator', 'issue', 'single_use', 'access']) {
    assert.ok(ITEM_TAGS.foam_grenade_act?.includes(tag), `foam_grenade_act must publish ${tag}`);
  }
});

test('foam grenade act redeems into one legal 6p10 foam grenade', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'foam_grenade_act', count: 1 }] });
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 90 });

  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter погасить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'foam_grenade_act'), 0);
  assert.equal(countInventoryItem(player, 'foam_grenade_6p10'), 1);
  assert.ok(state.msgs.some(line => line.text.includes('Акт выдачи 6П10 погашен')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['foam'], limit: 1 })[0];
  assert.equal(event?.itemId, 'foam_grenade_act');
  assert.equal(event?.data?.outcome, 'foam_grenade_act_redeemed');
  assert.equal(event?.data?.outputItemId, 'foam_grenade_6p10');
  assert.equal(event?.data?.outputCount, 1);
});
