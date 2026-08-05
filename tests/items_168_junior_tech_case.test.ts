import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';

const ITEM_ID = 'junior_tech_case';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('junior tech case is a reachable electronics casing', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Корпус «Юный техник»');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.LIVING));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.equal(def.spawnW > 0, true);
  assert.equal(def.value, 24);
  assert.equal(def.stack, 6);
  assert.equal(resourceForItem(def.id)?.id, 'electronics');
  assert.ok(RESOURCES.find(resource => resource.id === 'electronics')?.itemIds.includes(def.id));

  for (const tag of ['electronics', 'casing', 'production', 'repair', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `junior_tech_case registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `junior_tech_case item must carry ${tag}`);
  }
});

test('junior tech case appears in cabinet loot pools', () => {
  assert.ok(containerPoolIds(ContainerKind.METAL_CABINET).has(ITEM_ID));
  assert.ok(containerPoolIds(ContainerKind.TOOL_LOCKER).has(ITEM_ID));
});
