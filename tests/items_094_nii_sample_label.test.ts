import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { inventoryItemCategory } from '../src/systems/inventory';

const LABEL_ID = 'nii_sample_label';

test('nii sample label is official NII sample paperwork', () => {
  const def = ITEMS[LABEL_ID];

  assert.equal(def.id, LABEL_ID);
  assert.equal(def.name, 'Наклейка НИИ для пробы');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.OFFICE]);
  assert.equal(def.spawnW, 0.45);
  assert.equal(getStack(def), 10);
  assert.equal(inventoryItemCategory(def.id), 'documents');
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));

  for (const tag of ['document', 'sample', 'label', 'nii', 'legal_handoff']) {
    assert.ok(ITEM_TAGS[LABEL_ID]?.includes(tag), `nii_sample_label registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `nii_sample_label item must carry ${tag}`);
  }
});

test('nii sample label is stealable from slime NII science storage', () => {
  const gen = generateSlimeNiiDesignFloor();

  const cabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('science')
    && container.inventory.some(item => item.defId === LABEL_ID),
  );

  assert.ok(cabinet, 'slime_nii should expose nii_sample_label through NII science storage');
  assert.equal(cabinet.access, 'owner');
  assert.equal(cabinet.name, 'Картотека директора НИИ слизи');
  assert.equal(cabinet.inventory.find(item => item.defId === LABEL_ID)?.count, 3);
});
