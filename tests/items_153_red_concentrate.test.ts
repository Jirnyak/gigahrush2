import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'red_concentrate';

test('red concentrate is premium office and HQ food', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Красный концентрат');
  assert.equal(def.type, ItemType.FOOD);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.HQ));
  assert.equal(def.spawnW > 0, true);
  assert.equal(def.spawnW < ITEMS.grey_briquette.spawnW, true);
  assert.equal(def.value > ITEMS.grey_briquette.value, true);
  assert.equal(def.value > ITEMS.liquidator_ration.value, true);
  assert.equal(resourceForItem(def.id)?.id, 'food');
  assert.ok(RESOURCES.find(resource => resource.id === 'food')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'food');

  for (const tag of ['bait_sugar', 'concentrate', 'premium_ration', 'bribe']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `red_concentrate registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `red_concentrate item must carry ${tag}`);
  }
});

test('using red concentrate spends the bribe ration as food', () => {
  const player = makeTestPlayer({
    id: 153,
    inventory: [{ defId: ITEM_ID, count: 1 }],
    needs: { food: 30, water: 60, sleep: 70, pee: 0, poo: 0 },
  });
  const state = makeGameState({ currentFloor: FloorLevel.MINISTRY, time: 153 });

  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter применить');

  useItem(player, 0, state.msgs, state.time, state, 9);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.needs?.food, 56);
  assert.ok(state.msgs.some(line => line.text.includes('Сытость +26')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['premium_ration', 'bribe'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.zoneId, 9);
  assert.ok(event?.tags.includes('concentrate'));
});
