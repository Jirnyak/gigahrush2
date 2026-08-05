import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { inventoryItemCategory } from '../src/systems/inventory';

const SEAL_ID = 'sample_cork_seal';

test('sample cork seal is reachable sampleware stock', () => {
  const def = ITEMS[SEAL_ID];

  assert.equal(def.id, SEAL_ID);
  assert.equal(def.name, 'Пробковая пломба');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.OFFICE, RoomType.MEDICAL, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.7);
  assert.equal(def.value, 9);
  assert.equal(getStack(def), 12);
  assert.equal(resourceForItem(def.id)?.id, 'slime_samples');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  const sampleSupply = RESOURCES.find(resource => resource.id === 'slime_samples');
  assert.ok(sampleSupply?.itemIds.includes(SEAL_ID), 'cork seals must pressure sampleware supply');

  for (const tag of ['sampleware', 'seal', 'component', 'evidence', 'trade']) {
    assert.ok(ITEM_TAGS[SEAL_ID]?.includes(tag), `sample_cork_seal registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `sample_cork_seal item must carry ${tag}`);
  }
  assert.equal(ITEM_TAGS[SEAL_ID]?.includes('sample'), false, 'empty seal must not be treated as a taken sample');
  assert.equal(def.tags?.includes('sample'), false, 'empty seal must not carry taken-sample tag');
});
