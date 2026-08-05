import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORY_BY_ID, productionOutputResourceIds, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('pump impeller is a reachable Maintenance pump repair component', () => {
  const def = ITEMS.pump_impeller;

  assert.equal(def.id, 'pump_impeller');
  assert.equal(def.name, 'Крыльчатка насоса');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.35);
  assert.equal(def.stack, 2);
  assert.equal(resourceForItem(def.id)?.id, 'metal');

  for (const tag of ['water', 'pump', 'metal', 'repair', 'repair_input', 'production', 'maintenance']) {
    assert.ok(ITEM_TAGS.pump_impeller?.includes(tag), `pump_impeller registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `pump_impeller must carry ${tag}`);
  }

  const metalCabinetPool = CONTAINER_DEFS[ContainerKind.METAL_CABINET].itemPool;
  const toolLockerPool = CONTAINER_DEFS[ContainerKind.TOOL_LOCKER].itemPool;
  assert.ok(metalCabinetPool.some(entry => entry.defId === def.id), 'metal cabinets must expose pump_impeller');
  assert.ok(toolLockerPool.some(entry => entry.defId === def.id), 'tool lockers must expose pump_impeller');
});

test('pump impeller is produced through pump passport water-filter repair', () => {
  const utilityRoom = FACTORY_BY_ID.utility_room;
  const recipe = utilityRoom.recipes.find(row => row.id === 'service_water_filter');

  assert.ok(recipe);
  assert.ok(recipe.inputItems?.some(input => input.defId === 'pump_passport' && input.count === 1));
  assert.ok(recipe.outputs.some(output => output.defId === 'pump_impeller' && output.count === 1));
  assert.ok(recipe.outputs.some(output => output.defId === 'water_filter_regulator' && output.count === 1));
  assert.ok(productionRouteGoals(utilityRoom, recipe).includes('repair'));
  assert.ok(productionOutputResourceIds(utilityRoom, recipe).includes('metal'));
});
