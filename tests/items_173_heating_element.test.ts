import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORY_BY_ID, productionOutputResourceIds, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';

const ITEM_ID = 'heating_element';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('heating element is a reachable kitchen and production input', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Нагревательный элемент');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.KITCHEN, RoomType.PRODUCTION, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.55);
  assert.equal(getStack(def), 4);

  for (const tag of ['electronics', 'heat', 'thaw', 'kitchen', 'brewing', 'factory_input', 'production', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
  }

  assert.equal(resourceForItem(ITEM_ID)?.id, 'tools');
  assert.ok(RESOURCE_BY_ID.electronics.itemIds.includes(ITEM_ID), 'electronics pressure must also see heating elements');
  assert.ok(containerPoolIds(ContainerKind.METAL_CABINET).has(ITEM_ID), 'production cabinets expose stolen heater stock');
});

test('heating element can be spent to thaw a frozen slime core', () => {
  const kitchen = FACTORY_BY_ID.communal_kitchen;
  const recipe = kitchen.recipes.find(row => row.id === 'thaw_frozen_slime_core');

  assert.ok(recipe);
  assert.deepEqual(recipe.inputItems, [
    { defId: ITEM_ID, count: 1 },
    { defId: 'frozen_slime_core', count: 1 },
  ]);
  assert.deepEqual(recipe.outputs, [{ defId: 'boiled_slime_residue', count: 1 }]);
  assert.equal(recipe.outputAccess, 'room');
  assert.ok(recipe.eventTags?.includes(ITEM_ID));
  assert.ok(recipe.eventTags?.includes('heat_counter'));
  assert.ok(productionRouteGoals(kitchen, recipe).includes('repair'), 'input-gated thawing gives a spend/repair decision');
  assert.ok(productionOutputResourceIds(kitchen, recipe).includes('slime_samples'));
});
