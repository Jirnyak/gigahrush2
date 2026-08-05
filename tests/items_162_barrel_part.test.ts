import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { FACTORY_BY_ID, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('barrel part is a reachable armory component, not a loose duplicate barrel', () => {
  const def = ITEMS.barrel_part;

  assert.equal(def.id, 'barrel_part');
  assert.equal(def.name, 'Заготовка ствола');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(resourceForItem(def.id)?.id, 'metal');

  for (const tag of ['weapon_component', 'barrel', 'armory', 'production', 'repair_input', 'metal']) {
    assert.ok(ITEM_TAGS.barrel_part?.includes(tag), `barrel_part registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `barrel_part item must carry ${tag}`);
  }
});

test('barrel part is spent through guarded armory recipes', () => {
  const armory = FACTORY_BY_ID.armory_bench;
  const chizhRecipe = armory.recipes.find(recipe => recipe.id === 'assemble_chizh3');
  const eralashnikovRecipe = armory.recipes.find(recipe => recipe.id === 'recondition_eralashnikov');

  assert.ok(chizhRecipe);
  assert.ok(eralashnikovRecipe);

  for (const recipe of [chizhRecipe, eralashnikovRecipe]) {
    assert.ok(recipe.inputItems?.some(input => input.defId === 'barrel_part' && input.count === 1));
    assert.ok(productionRouteGoals(armory, recipe).includes('repair'));
    assert.ok(productionRouteGoals(armory, recipe).includes('steal'));
  }

  assert.deepEqual(chizhRecipe.outputs, [{ defId: 'chizh3_shotgun', count: 1 }]);
  assert.deepEqual(eralashnikovRecipe.outputs, [{ defId: 'eralashnikov_auto', count: 1 }]);
});
