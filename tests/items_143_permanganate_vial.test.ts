import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'permanganate_vial';

test('permanganate vial is reachable poison and injection counterplay medicine', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Марганцовка');
  assert.equal(def.type, ItemType.MEDICINE);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.BATHROOM, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.65);
  assert.equal(def.value, 28);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');
  assert.equal(inventoryItemCategory(def.id), 'medicine');
  assert.ok(RESOURCES.find(resource => resource.id === 'medicine')?.itemIds.includes(def.id));

  for (const tag of ['medicine', 'poison_counterplay', 'injection_counterplay', 'reagent']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `permanganate registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `permanganate item must carry ${tag}`);
  }
});

test('permanganate vial is a small consumable treatment and event decision', () => {
  const player = makeTestPlayer({ id: 143, hp: 40, maxHp: 80 });
  const state = makeGameState({ time: 143 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter применить');

  useItem(player, 0, state.msgs, state.time, state, 14);

  assert.equal(player.hp, 50);
  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Лечение +10')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['poison_counterplay', 'injection_counterplay'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.zoneId, 14);
});
