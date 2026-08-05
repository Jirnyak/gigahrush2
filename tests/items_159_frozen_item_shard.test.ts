import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { FACTORY_BY_ID, productionOutputResourceIds, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateHladonets } from '../src/gen/maintenance/hladonets';

const ITEM_ID = 'frozen_item_shard';

function itemDropIds(entities: readonly Entity[]): string[] {
  const ids: string[] = [];
  for (const entity of entities) {
    if (entity.type !== EntityType.ITEM_DROP || !entity.inventory) continue;
    for (const item of entity.inventory) ids.push(item.defId);
  }
  return ids;
}

test('frozen item shard is a cold-route anomaly sample and recipe input', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Осколок замороженного предмета');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.PRODUCTION]);
  assert.equal(def.spawnW > 0 && def.spawnW < 0.1, true);
  assert.equal(getStack(def), 4);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(def.use, undefined, 'the shard is a trade/production choice, not an active-use item');

  for (const tag of ['sample', 'anomaly', 'frozen', 'cold', 'evidence', 'factory_input', 'recipe_unlock', 'rare_recipe']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `frozen_item_shard registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `frozen_item_shard item must carry ${tag}`);
  }
});

test('frozen item shard unlocks the rare T3 blueprint recipe', () => {
  const utilityRoom = FACTORY_BY_ID.utility_room;
  const recipe = utilityRoom.recipes.find(row => row.id === 'decode_frozen_t3_blueprint');

  assert.ok(recipe);
  assert.deepEqual(recipe.inputItems, [{ defId: ITEM_ID, count: 1 }]);
  assert.deepEqual(recipe.outputs, [{ defId: 'blueprint_t3_folder', count: 1 }]);
  assert.equal(recipe.outputAccess, 'locked');
  assert.equal(recipe.maxOutputItemCount, 1);
  assert.ok(recipe.outputTags.includes('tier3'));
  assert.ok(recipe.outputTags.includes('limited_output'));
  assert.ok(recipe.eventTags?.includes('rare_recipe_unlock'));
  assert.ok(productionRouteGoals(utilityRoom, recipe).includes('steal'));
  assert.ok(productionRouteGoals(utilityRoom, recipe).includes('repair'));
  assert.ok(productionOutputResourceIds(utilityRoom, recipe).includes('paper'));
});

test('frozen item shard is reachable from Hladonets cold aftermath', () => {
  const world = new World();
  const entities: Entity[] = [];

  generateHladonets({ world, entities, nextId: { v: 1 }, spawnX: 96, spawnY: 96 });

  assert.equal(itemDropIds(entities).includes(ITEM_ID), true);
});
