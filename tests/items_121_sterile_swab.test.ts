import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { generateSlimeNiiDesignFloor } from '../src/gen/design_floors/slime_nii';
import { inventoryItemCategory } from '../src/systems/inventory';

const ITEM_ID = 'sterile_swab';

test('sterile swab is stackable NII evidence sampleware', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Стерильный мазок');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.OFFICE]);
  assert.equal(def.spawnW, 0.8);
  assert.equal(getStack(def), 12);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['sample', 'swab', 'medical', 'nii', 'evidence']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `sterile_swab registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `sterile_swab item must carry ${tag}`);
  }
});

test('sterile swab is stealable from slime NII science storage', () => {
  const gen = generateSlimeNiiDesignFloor();

  const cabinet = gen.world.containers.find(container =>
    container.tags.includes('slime_nii')
    && container.tags.includes('science')
    && container.inventory.some(item => item.defId === ITEM_ID && item.count === 4),
  );

  assert.ok(cabinet, 'slime_nii should expose sterile_swab through NII science storage');
  assert.equal(cabinet.access, 'owner');
  assert.equal(cabinet.name, 'Картотека директора НИИ слизи');
});
