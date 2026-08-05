import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';

const ITEM_ID = 'cardboard_stack';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('cardboard stack is cheap living paper stock', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Картон');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.LIVING));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(def.spawnW, 1);
  assert.equal(def.value, 3);
  assert.equal(def.stack, 20);
  assert.equal(resourceForItem(def.id)?.id, 'paper');

  for (const tag of ['paper', 'material', 'resident_good']) {
    assert.ok(def.tags?.includes(tag), `cardboard_stack must publish ${tag}`);
  }
});

test('cardboard stack is reachable as living loot and production scrap', () => {
  assert.ok(containerPoolIds(ContainerKind.WOODEN_CHEST).has(ITEM_ID));
  assert.ok(containerPoolIds(ContainerKind.TRASH_BIN).has(ITEM_ID));
  assert.ok(RESOURCES.find(resource => resource.id === 'industrial_slurry')?.itemIds.includes(ITEM_ID));
});
