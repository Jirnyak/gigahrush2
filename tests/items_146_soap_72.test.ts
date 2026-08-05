import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, ItemType, Occupation, RoomType, type Entity } from '../src/core/types';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { inventoryItemCategory } from '../src/systems/inventory';

const ID = 'soap_72';

test('soap 72 is reachable hygiene trade goods', () => {
  const def = ITEMS[ID];

  assert.equal(def.id, ID);
  assert.equal(def.name, 'Мыло хозяйственное 72%');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.BATHROOM, RoomType.KITCHEN, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.9);
  assert.equal(def.value, 7);
  assert.equal(def.stack, 8);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  const medicineSupply = RESOURCES.find(resource => resource.id === 'medicine');
  assert.ok(medicineSupply?.itemIds.includes(ID), 'soap must pressure sanitary/medicine stock');

  for (const tag of ['hygiene', 'decontamination', 'trade']) {
    assert.ok(ITEM_TAGS[ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
});

test('soap 72 can appear in storekeeper trade', () => {
  const storekeeper: Entity = {
    id: 1,
    type: EntityType.NPC,
    x: 0,
    y: 0,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: 0,
    occupation: Occupation.STOREKEEPER,
  };
  const oldRandom = Math.random;
  const rolls = [0, 0.4, 0.4];
  Math.random = () => rolls.shift() ?? 0.4;
  try {
    const offers = generateNpcTradeItems(storekeeper);
    assert.ok(offers.some(offer => offer.defId === ID), 'storekeeper trade pool must expose soap');
  } finally {
    Math.random = oldRandom;
  }
});
