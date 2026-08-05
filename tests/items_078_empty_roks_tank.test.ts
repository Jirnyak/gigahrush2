import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { FACTORIES, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('empty ROKS tank is a reachable fuel production input', () => {
  const def = ITEMS.empty_roks_tank;

  assert.equal(def.id, 'empty_roks_tank');
  assert.equal(def.name, 'Пустой ранцевый бак');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.HQ, RoomType.PRODUCTION, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.25);
  assert.deepEqual(def.tags, ITEM_TAGS.empty_roks_tank);
  assert.ok(def.tags?.includes('repair_input'));
  assert.ok(def.tags?.includes('liquidator'));
  assert.equal(resourceForItem(def.id)?.id, 'fuel');
});

test('empty ROKS tank gives armory repair and steal choices through napalm production', () => {
  const armory = FACTORIES.find(factory => factory.id === 'armory_bench');
  assert.ok(armory);

  const recipe = armory.recipes.find(row => row.id === 'fill_roks_tank');
  assert.ok(recipe);
  assert.equal(recipe.outputAccess, 'faction');
  assert.deepEqual(recipe.inputItems, [{ defId: 'empty_roks_tank', count: 1 }]);
  assert.deepEqual(recipe.outputs, [{ defId: 'napalm_mix', count: 4 }]);
  assert.ok(recipe.outputTags.includes('cleanup'));
  assert.ok(recipe.eventTags?.includes('authorized_output'));
  assert.deepEqual(productionRouteGoals(armory, recipe), ['guard', 'steal', 'repair']);
  assert.equal(ITEMS.napalm_mix.type, ItemType.AMMO);
  assert.equal(resourceForItem('napalm_mix')?.id, 'fuel');
});
