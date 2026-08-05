import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { EntityType, ItemType, RoomType, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { FACTORY_BY_ID } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateBrownSlimeCleanup } from '../src/gen/maintenance/brown_slime_cleanup';
import { generateSlimeDeactivationFurnace } from '../src/gen/maintenance/slime_deactivation_furnace';

function itemDropIds(entities: Entity[]): string[] {
  return entities
    .filter(e => e.type === EntityType.ITEM_DROP)
    .flatMap(e => e.inventory ?? [])
    .map(item => item.defId);
}

function containerItemIds(world: World): string[] {
  return world.containers
    .flatMap(container => container.inventory)
    .map(item => item.defId);
}

test('alkali powder is storage and production cleanup reagent', () => {
  const def = ITEMS.alkali_powder;

  assert.ok(def);
  assert.equal(def.name, 'Щёлочная присыпка');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.PRODUCTION]);
  assert.equal(def.stack, 8);
  assert.equal(resourceForItem(def.id)?.id, 'tools');

  for (const tag of ['cleanup', 'brown_slime', 'alkali', 'reagent']) {
    assert.ok(def.tags?.includes(tag), `alkali_powder item must publish ${tag} tag`);
    assert.ok(ITEM_TAGS.alkali_powder?.includes(tag), `alkali_powder tags must publish ${tag} tag`);
  }
});

test('alkali powder is reachable from brown slime cleanup and deactivation furnace content', () => {
  const cleanupWorld = new World();
  const cleanupEntities: Entity[] = [];

  generateBrownSlimeCleanup({ world: cleanupWorld, entities: cleanupEntities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const cleanupRoom = cleanupWorld.rooms.find(room => room.name === 'Сухой обход: коричневая слизь');
  assert.ok(cleanupRoom, 'brown slime cleanup room should be generated');
  const cleanupDrops = itemDropIds(cleanupEntities);
  assert.ok(cleanupDrops.includes('alkali_powder'), 'cleanup room loot should expose alkali_powder');
  assert.ok(cleanupDrops.includes('brown_slime_cleanup_act'), 'cleanup room should still expose the cleanup act');
  assert.ok(cleanupDrops.includes('slime_sample_brown'), 'cleanup room should still expose a brown slime sample');

  const furnaceWorld = new World();
  const furnaceEntities: Entity[] = [];

  generateSlimeDeactivationFurnace({ world: furnaceWorld, entities: furnaceEntities, nextId: { v: 1 }, spawnX: 512, spawnY: 512 });

  const furnaceDrops = itemDropIds(furnaceEntities);
  const furnaceContainers = containerItemIds(furnaceWorld);
  assert.ok(furnaceDrops.includes('alkali_powder'), 'furnace intake loot should expose alkali_powder');
  assert.ok(furnaceContainers.includes('alkali_powder'), 'furnace containers should stock alkali_powder');
  assert.ok(furnaceContainers.includes('slime_sample_brown'), 'furnace production container should keep the brown sample path visible');
});

test('slime deactivation furnace spends alkali with the brown sample', () => {
  const recipe = FACTORY_BY_ID.slime_deactivation_furnace?.recipes.find(r => r.id === 'burn_brown_slime_sample');

  assert.ok(recipe);
  assert.deepEqual(recipe.inputItems?.map(item => item.defId), ['slime_sample_brown', 'alkali_powder']);
  assert.ok(recipe.outputTags.includes('alkali'));
  assert.ok(recipe.eventTags?.includes('alkali'));
});
