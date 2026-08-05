import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { inventoryItemCategory } from '../src/systems/inventory';

const ITEM_ID = 'party_portrait_pin';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('party portrait pin is low-value bureaucratic bribe loot', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Значок с портрета партии');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.OFFICE, RoomType.COMMON, RoomType.LIVING]);
  assert.equal(def.spawnW, 0.55);
  assert.equal(def.value, 22);
  assert.equal(def.stack, 6);
  assert.equal(resourceForItem(def.id)?.id, 'documents');
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(ITEM_ID));

  for (const tag of ['bureaucracy', 'resident_good', 'bribe', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `party portrait pin registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `party portrait pin item must carry ${tag}`);
  }
});

test('party portrait pin is reachable through office/common loot and cashboxes', () => {
  assert.ok(containerPoolIds(ContainerKind.CASHBOX).has(ITEM_ID));
});
