import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORY_BY_ID, productionOutputResourceIds, productionRouteGoals } from '../src/data/factories';
import { ITEMS, ITEM_TAGS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';

const ITEM_ID = 'rubber_tube';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('rubber tube is a medical and production repair input', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Резиновая трубка');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.PRODUCTION, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.65);
  assert.equal(def.stack, 6);

  for (const tag of ['rubber', 'repair_input', 'medical', 'production', 'brewing', 'still', 'factory_input', 'tools']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
  }

  assert.equal(resourceForItem(ITEM_ID)?.id, 'tools');
  assert.ok(RESOURCES.find(resource => resource.id === 'industrial_slurry')?.itemIds.includes(ITEM_ID));
});

test('rubber tube can be stolen from medical/tool storage and spent on brewing production', () => {
  assert.ok(containerPoolIds(ContainerKind.MEDICAL_CABINET).has(ITEM_ID), 'medical cabinets expose rubber tubing');
  assert.ok(containerPoolIds(ContainerKind.TOOL_LOCKER).has(ITEM_ID), 'tool lockers expose rubber tubing');

  const kitchen = FACTORY_BY_ID.communal_kitchen;
  const recipe = kitchen.recipes.find(row => row.id === 'start_braga_bucket');

  assert.ok(recipe, 'communal kitchen must expose the braga bucket route');
  assert.ok(recipe.inputItems?.some(input => input.defId === ITEM_ID && input.count === 1));
  assert.deepEqual(recipe.outputs, [{ defId: 'braga_bucket', count: 1 }]);
  assert.ok(recipe.eventTags?.includes('brewing'));
  assert.ok(productionRouteGoals(kitchen, recipe).includes('repair'), 'input-gated brewing gives a spend decision');
  assert.ok(productionRouteGoals(kitchen, recipe).includes('steal'), 'owner-gated brewing keeps the theft decision');
  assert.ok(productionOutputResourceIds(kitchen, recipe).includes('contraband'));
});
