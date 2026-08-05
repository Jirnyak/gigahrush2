import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { FACTORY_BY_ID, productionOutputResourceIds, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';

const CHIP_ID = 'slime_calcified_chip';

test('calcified slime chip is mature/dead slime sample material', () => {
  const def = ITEMS[CHIP_ID];

  assert.equal(def.id, CHIP_ID);
  assert.equal(def.name, 'Окаменевший скол слизи');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.STORAGE, RoomType.MEDICAL]);
  assert.equal(def.spawnW, 0.18);
  assert.equal(getStack(def), 6);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');

  for (const tag of ['slime', 'sample', 'calcified', 'aftermath', 'reagent', 'nii', 'factory_input']) {
    assert.ok(ITEM_TAGS[CHIP_ID]?.includes(tag), `slime_calcified_chip registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `slime_calcified_chip item must carry ${tag}`);
  }
});

test('calcified slime chip is reachable from deep NII storage', () => {
  const gen = generateSlimeNiiDesignFloor();

  const coldStorage = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('cold_storage')
    && container.inventory.some(item => item.defId === CHIP_ID),
  );

  assert.ok(coldStorage, 'slime_nii should expose slime_calcified_chip in locked cold storage');
  assert.equal(coldStorage.access, 'locked');
  assert.equal(coldStorage.name, 'Холодный шкаф зелёных и белых проб');
  assert.equal(coldStorage.inventory.find(item => item.defId === CHIP_ID)?.count, 1);
});

test('calcified slime chip can be spent as furnace input instead of sold as a sample', () => {
  const factory = FACTORY_BY_ID.slime_deactivation_furnace;
  const recipe = factory.recipes.find(row => row.id === 'calcine_slime_chip');

  assert.ok(recipe, 'slime deactivation furnace must accept calcified slime chips');
  assert.deepEqual(recipe.inputItems, [{ defId: CHIP_ID, count: 1 }]);
  assert.deepEqual(recipe.outputs, [
    { defId: 'deactivated_residue', count: 1 },
    { defId: 'sealant_tube', count: 1 },
  ]);
  assert.equal(recipe.outputAccess, 'room');
  assert.ok(recipe.outputTags.includes('calcified'));
  assert.ok(recipe.eventTags?.includes('calcified_chip'));
  assert.ok(productionRouteGoals(factory, recipe).includes('repair'));
  assert.ok(productionOutputResourceIds(factory, recipe).includes('slime_samples'));
  assert.ok(productionOutputResourceIds(factory, recipe).includes('tools'));
});
