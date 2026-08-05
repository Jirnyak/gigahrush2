import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

const ITEM_ID = 'cloth_roll';

test('cloth roll stays the reachable fabric counterplay component', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Ткань');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.LIVING, RoomType.STORAGE]);
  assert.equal(def.spawnW, 1);
  assert.equal(def.value, 6);
  assert.equal(getStack(def), 8);
  assert.equal(resourceForItem(def.id)?.id, 'tools');
  assert.equal(inventoryItemCategory(def.id), 'other');
  assert.equal(def.use, undefined, 'cloth_roll is spent by world interactions, not direct inventory healing');

  const tools = RESOURCES.find(resource => resource.id === 'tools');
  const slurry = RESOURCES.find(resource => resource.id === 'industrial_slurry');
  assert.ok(tools?.itemIds.includes(ITEM_ID), 'cloth_roll must pressure filter/tool stock');
  assert.ok(slurry?.itemIds.includes(ITEM_ID), 'cloth_roll remains a production material input');

  for (const tag of ['medical', 'filter', 'component', 'cloth', 'wet_cloth', 'samosbor', 'counterplay', 'cold_counter']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `cloth_roll registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `cloth_roll item must carry ${tag}`);
  }
});

test('cloth roll is a save, spend or sell decision in inventory', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, ITEM_ID, 2), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'other');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.canDrop, true);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 6₽/шт · 12₽');
});
