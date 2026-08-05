import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('fuel issue stamp is official liquidator fuel paperwork', () => {
  const def = ITEMS.fuel_issue_stamp;

  assert.equal(def.id, 'fuel_issue_stamp');
  assert.equal(def.name, 'Штамп выдачи топлива');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.equal(def.stack, 3);
  assert.equal(resourceForItem(def.id)?.id, 'fuel');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'stamp', 'fuel', 'single_use', 'official', 'liquidator']) {
    assert.ok(ITEM_TAGS.fuel_issue_stamp?.includes(tag), `fuel_issue_stamp must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `fuel_issue_stamp item must carry ${tag}`);
  }
});

test('fuel issue stamp redeems into one fuel canister', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'fuel_issue_stamp', count: 1 }] });
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 87 });

  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter погасить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'fuel_issue_stamp'), 0);
  assert.equal(countInventoryItem(player, 'ammo_fuel'), 1);
  assert.ok(state.msgs.some(line => line.text.includes('Штамп топлива погашен')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['fuel'], limit: 1 })[0];
  assert.equal(event?.itemId, 'fuel_issue_stamp');
  assert.equal(event?.data?.outcome, 'fuel_stamp_redeemed');
  assert.equal(event?.data?.outputItemId, 'ammo_fuel');
  assert.equal(event?.data?.outputCount, 1);
});
