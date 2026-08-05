import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';

test('lime bucket is a heavy production and storage sanitation token', () => {
  const def = ITEMS.lime_bucket;

  assert.ok(def);
  assert.equal(def.name, 'Ведро извести');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.STORAGE]);
  assert.equal(def.stack, 1);
  assert.ok(def.spawnW > 0);
  assert.equal(resourceForItem(def.id)?.id, 'tools');

  for (const tag of ['cleanup', 'lime', 'sanitary', 'slime', 'liquidator', 'evidence', 'reagent', 'heavy', 'trade']) {
    assert.ok(def.tags?.includes(tag), `lime_bucket item must publish ${tag} tag`);
    assert.ok(ITEM_TAGS.lime_bucket?.includes(tag), `lime_bucket tags must publish ${tag} tag`);
  }
});

test('lime bucket is reachable from production and storage tool lockers', () => {
  const toolLocker = CONTAINER_DEFS[ContainerKind.TOOL_LOCKER];

  assert.ok(toolLocker.roomTypes.includes(RoomType.PRODUCTION));
  assert.ok(toolLocker.roomTypes.includes(RoomType.STORAGE));
  assert.equal(toolLocker.itemPool.some(item => item.defId === 'lime_bucket'), true);
});
