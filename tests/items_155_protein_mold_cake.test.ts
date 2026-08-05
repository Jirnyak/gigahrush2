import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'protein_mold_cake';

test('protein mold cake is a reachable fungal food ration', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Плесневой белковый брикет');
  assert.equal(def.type, ItemType.FOOD);
  assert.ok(def.spawnRooms.includes(RoomType.KITCHEN));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(def.spawnRooms.includes(RoomType.BATHROOM));
  assert.equal(def.spawnW > 0, true);
  assert.equal(def.value, 12);
  assert.equal(resourceForItem(def.id)?.id, 'food');
  assert.equal(inventoryItemCategory(def.id), 'food');

  for (const tag of ['bait', 'bait_fungal', 'concentrate', 'mold_food']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `protein_mold_cake registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `protein_mold_cake item must carry ${tag}`);
  }
});

test('using protein mold cake spends a mold-origin ration and publishes bait tags', () => {
  const player = makeTestPlayer({
    id: 155,
    inventory: [{ defId: ITEM_ID, count: 1 }],
    needs: { food: 30, water: 60, sleep: 80, pee: 0, poo: 0 },
  });
  const state = makeGameState({ time: 155 });

  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter применить');

  useItem(player, 0, state.msgs, state.time, state, 4);

  assert.equal(player.needs?.food, 58);
  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Сытость +28')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['bait_fungal', 'mold_food'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.zoneId, 4);
  assert.ok(event?.tags.includes('concentrate'));
});
