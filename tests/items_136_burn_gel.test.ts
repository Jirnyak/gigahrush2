import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { getRecentEvents } from '../src/systems/events';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'burn_gel';

test('burn gel is reachable burn medicine in medical and HQ stock', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Противоожоговый гель');
  assert.equal(def.type, ItemType.MEDICINE);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.HQ, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.75);
  assert.equal(def.value, 46);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');
  assert.equal(inventoryItemCategory(def.id), 'medicine');
  assert.ok(RESOURCES.find(resource => resource.id === 'medicine')?.itemIds.includes(def.id));

  for (const tag of ['medicine', 'burn', 'slime_counterplay']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `burn_gel registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `burn_gel item must carry ${tag}`);
  }
});

test('burn gel is a small consumable treatment decision', () => {
  const player = makeTestPlayer({ id: 136, hp: 40, maxHp: 80 });
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 136 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter применить');

  useItem(player, 0, state.msgs, state.time, state, 7);

  assert.equal(player.hp, 62);
  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Лечение +22')));

  const event = getRecentEvents(state, { type: 'player_use_item', tags: ['burn', 'slime_counterplay'], limit: 1 })[0];
  assert.equal(event?.itemId, ITEM_ID);
  assert.equal(event?.zoneId, 7);
});
