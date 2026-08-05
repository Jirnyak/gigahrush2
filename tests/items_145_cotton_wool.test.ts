import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

const ITEM_ID = 'cotton_wool';

test('cotton wool is a reachable medical filter component', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Вата');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.BATHROOM, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.9);
  assert.equal(def.value, 6);
  assert.equal(getStack(def), 12);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');
  assert.equal(inventoryItemCategory(def.id), 'other');
  assert.equal(def.use, undefined, 'cotton wool is a component to save, sell or spend, not instant healing');

  const medicineSupply = RESOURCES.find(resource => resource.id === 'medicine');
  assert.ok(medicineSupply?.itemIds.includes(ITEM_ID), 'cotton_wool must pressure medicine stock');

  for (const tag of ['medical', 'filter', 'component']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `cotton_wool registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `cotton_wool item must carry ${tag}`);
  }
});

test('cotton wool stays a sell or save decision in inventory', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, ITEM_ID, 2), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'other');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.canDrop, true);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 6₽/шт · 12₽');
});
