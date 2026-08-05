import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ID = 'sterile_bandage';

test('sterile bandage is reachable stronger medicine', () => {
  const def = ITEMS[ID];
  const bandage = ITEMS.bandage;

  assert.equal(def.id, ID);
  assert.equal(def.name, 'Стерильный бинт');
  assert.equal(def.type, ItemType.MEDICINE);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.HQ]);
  assert.equal(def.spawnW, 0.7);
  assert.equal(def.value, 32);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');
  assert.equal(inventoryItemCategory(def.id), 'medicine');

  const medicineSupply = RESOURCES.find(resource => resource.id === 'medicine');
  assert.ok(medicineSupply?.itemIds.includes(ID), 'sterile bandage must pressure medicine stock');
  assert.ok((def.value ?? 0) > (bandage.value ?? 0), 'sterile bandage must cost more than a dusty bandage');

  for (const tag of ['medicine', 'bandage', 'sterile']) {
    assert.ok(ITEM_TAGS[ID]?.includes(tag), `sterile bandage registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `sterile bandage item must carry ${tag}`);
  }
});

test('sterile bandage heals more than a regular bandage and is consumed', () => {
  const player = makeTestPlayer({
    hp: 40,
    maxHp: 100,
    inventory: [{ defId: ID, count: 1 }],
  });
  const state = makeGameState({ time: 20 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(player.hp, 65);
  assert.equal(countInventoryItem(player, ID), 0);
  assert.ok(state.msgs.some(line => line.text.includes('Лечение +25')));
});
