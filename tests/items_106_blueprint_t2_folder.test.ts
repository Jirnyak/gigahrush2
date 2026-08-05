import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { FACTORY_BY_ID, productionOutputResourceIds, productionRouteGoals } from '../src/data/factories';
import { ITEMS, ITEM_TAGS } from '../src/data/items';
import { MONSTER_ECOLOGY } from '../src/data/monster_ecology';
import { resourceForItem } from '../src/data/resources';

test('blueprint t2 folder is a reachable terminal recipe unlock from fibrous capsules', () => {
  const item = ITEMS.blueprint_t2_folder;
  assert.equal(item.id, 'blueprint_t2_folder');
  assert.equal(item.name, 'Папка чертежей Т2');
  assert.equal(item.type, ItemType.MISC);
  assert.ok(item.tags?.includes('blueprint'));
  assert.ok(item.tags?.includes('terminal'));
  assert.ok(item.tags?.includes('fibrous_capsule'));
  assert.ok(ITEM_TAGS.blueprint_t2_folder?.includes('tier2'));
  assert.equal(resourceForItem(item.id)?.id, 'paper');

  assert.ok(
    MONSTER_ECOLOGY.some(def => def.rareDrops.some(drop => drop.itemId === 'fibrous_capsule_cut')),
    'fibrous capsule cuts must be reachable as monster drops',
  );

  const utilityRoom = FACTORY_BY_ID.utility_room;
  const recipe = utilityRoom.recipes.find(row => row.id === 'decode_fibrous_t2_blueprint');
  assert.ok(recipe);
  assert.deepEqual(recipe.inputItems, [{ defId: 'fibrous_capsule_cut', count: 1 }]);
  assert.deepEqual(recipe.outputs, [{ defId: 'blueprint_t2_folder', count: 1 }]);
  assert.equal(recipe.outputAccess, 'locked');
  assert.equal(recipe.maxOutputItemCount, 1);
  assert.ok(recipe.outputTags.includes('terminal'));
  assert.ok(recipe.eventTags?.includes('fibrous_capsule'));
  assert.ok(productionRouteGoals(utilityRoom, recipe).includes('steal'));
  assert.ok(productionRouteGoals(utilityRoom, recipe).includes('repair'));
  assert.ok(productionOutputResourceIds(utilityRoom, recipe).includes('paper'));
});
