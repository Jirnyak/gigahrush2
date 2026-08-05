import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'liquidator_ration';

test('liquidator ration is the closed-issue nutritious concentrate', () => {
  const def = ITEMS[ITEM_ID];
  const daily = ITEMS.grey_briquette;

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Черный сухпай ликвидатора');
  assert.equal(def.type, ItemType.FOOD);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.HQ]);
  assert.equal(def.spawnW, 1);
  assert.equal(def.value, 15);
  assert.equal(resourceForItem(def.id)?.id, 'food');
  assert.equal(inventoryItemCategory(def.id), 'food');
  assert.ok(RESOURCES.find(resource => resource.id === 'food')?.itemIds.includes(def.id));
  assert.ok(def.value > daily.value, 'liquidator ration must stay more valuable than daily concentrate');

  for (const tag of ['bait_meat', 'concentrate', 'nutritious_concentrate', 'black_concentrate', 'field_ration', 'closed_issue', 'liquidator']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `liquidator_ration registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `liquidator_ration item must carry ${tag}`);
  }
});

test('using liquidator ration spends a high-nutrition field meal', () => {
  const player = makeTestPlayer({
    id: 149,
    needs: { food: 20, water: 70, sleep: 80, pee: 0, poo: 0 },
  });
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE, time: 149 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter применить');

  useItem(player, 0, state.msgs, state.time, state, 12);

  assert.equal(player.needs?.food, 60);
  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Сытость +40')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['nutritious_concentrate', 'liquidator'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.zoneId, 12);
  assert.ok(event?.tags.includes('black_concentrate'));
});
