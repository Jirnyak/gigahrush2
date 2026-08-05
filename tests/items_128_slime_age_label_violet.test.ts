import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { inventoryItemCategory } from '../src/systems/inventory';

const ITEM_ID = 'slime_age_label_violet';

test('violet slime age label is rare high-tier slime proof', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Бирка взрослой слизи');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.HQ, RoomType.PRODUCTION]);
  assert.equal(def.spawnW, 0.08);
  assert.equal(def.value, 130);
  assert.equal(getStack(def), 4);
  assert.equal(inventoryItemCategory(def.id), 'documents');
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));

  for (const tag of ['document', 'slime', 'age_label', 'violet_slime', 'evidence']) {
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
  }
});

test('violet slime age label is stealable from slime NII cold storage', () => {
  const gen = generateSlimeNiiDesignFloor();

  const cabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('sample')
    && container.tags.includes('cold_storage')
    && container.inventory.some(item => item.defId === ITEM_ID),
  );

  assert.ok(cabinet, 'slime_nii should expose slime_age_label_violet through cold sample storage');
  assert.equal(cabinet.access, 'locked');
  assert.equal(cabinet.name, 'Холодный шкаф зелёных и белых проб');
  assert.equal(cabinet.inventory.find(item => item.defId === ITEM_ID)?.count, 1);
});
