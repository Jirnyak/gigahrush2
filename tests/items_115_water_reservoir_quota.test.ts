import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType, type GameState } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { ensureEconomyState } from '../src/systems/economy';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'water_reservoir_quota';

function resourceStock(state: GameState, floor: FloorLevel, resourceId: string): number {
  const economy = ensureEconomyState(state);
  return economy.floors[floor]?.resources[resourceId]?.stock ?? 0;
}

test('water reservoir quota is reachable water ration paperwork', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Квота резервуара воды');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.OFFICE, RoomType.KITCHEN, RoomType.HQ]);
  assert.equal(def.stack, 4);
  assert.equal(resourceForItem(def.id)?.id, 'drink_water');
  assert.ok(RESOURCES.find(resource => resource.id === 'paper')?.itemIds.includes(def.id));
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');

  for (const tag of ['document', 'ration', 'coupon', 'water', 'single_use', 'official']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `water_reservoir_quota must publish ${tag}`);
  }
});

test('water reservoir quota redeems into water and pressures water stock', () => {
  const player = makeTestPlayer({ inventory: [{ defId: ITEM_ID, count: 1 }] });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 115 });
  const beforeStock = resourceStock(state, FloorLevel.LIVING, 'drink_water');

  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter погасить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(countInventoryItem(player, 'water'), 3);
  assert.equal(resourceStock(state, FloorLevel.LIVING, 'drink_water'), beforeStock - 3);
  assert.ok(state.msgs.some(line => line.text.includes('Квота воды погашена')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['water'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.data?.outcome, 'water_quota_redeemed');
  assert.equal(event?.data?.outputItemId, 'water');
  assert.equal(event?.data?.outputCount, 3);
});
