import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORY_BY_ID, productionOutputResourceIds, productionRouteGoals } from '../src/data/factories';
import { ITEMS, ITEM_TAGS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

const ITEM_ID = 'water_filter_regulator';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('water filter regulator is a maintenance repair part with kitchen reachability', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Регулятор фильтра воды');
  assert.equal(def.type, ItemType.MISC);
  assert.equal(def.stack, 3);
  assert.equal(def.spawnW > 0, true, 'regulator must be reachable through normal loot');
  assert.equal(def.spawnRooms.includes(RoomType.KITCHEN), true, 'kitchens expose water repair parts');
  assert.equal(def.spawnRooms.includes(RoomType.PRODUCTION), true, 'maintenance-like production rooms expose repair parts');

  for (const tag of ['water', 'filter', 'regulator', 'repair', 'repair_input', 'maintenance', 'tools']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
  }

  assert.equal(resourceForItem(ITEM_ID)?.id, 'tools');
});

test('water filter regulator is reachable from lockers and utility-room repair production', () => {
  assert.ok(containerPoolIds(ContainerKind.METAL_CABINET).has(ITEM_ID), 'metal cabinets can hold stolen/regulator stock');
  assert.ok(containerPoolIds(ContainerKind.TOOL_LOCKER).has(ITEM_ID), 'tool lockers can hold service regulator stock');

  const factory = FACTORY_BY_ID.utility_room;
  const recipe = factory.recipes.find(r => r.id === 'service_water_filter');
  assert.ok(recipe, 'utility room must expose water filter service recipe');
  assert.deepEqual(recipe.inputItems, [{ defId: 'pump_passport', count: 1 }]);
  assert.ok(recipe.outputs.some(output => output.defId === ITEM_ID && output.count === 1));
  assert.ok(productionRouteGoals(factory, recipe).includes('repair'), 'passport-gated service gives repair decision');
  assert.ok(productionOutputResourceIds(factory, recipe).includes('tools'));
});
