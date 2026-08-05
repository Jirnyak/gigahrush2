import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';

test('wire coil publishes source roles and repair decisions', () => {
  const def = ITEMS.wire_coil;

  assert.equal(def.id, 'wire_coil');
  assert.equal(def.name, 'Моток провода');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.PRODUCTION, RoomType.STORAGE]);
  assert.ok(def.spawnW > 0);

  for (const tag of ['repair_input', 'electronics', 'source_old_boxes', 'source_cabinets', 'trade', 'emergency_panel', 'pneumomail']) {
    assert.ok(ITEM_TAGS.wire_coil?.includes(tag), `wire_coil must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `wire_coil item def must carry ${tag}`);
  }
});

test('wire coil is reachable as tool stock and electronics pressure', () => {
  assert.equal(resourceForItem('wire_coil')?.id, 'tools');
  assert.ok(RESOURCE_BY_ID.electronics.itemIds.includes('wire_coil'));

  const toolLocker = CONTAINER_DEFS[ContainerKind.TOOL_LOCKER].itemPool;
  assert.ok(toolLocker.some(item => item.defId === 'wire_coil'), 'tool lockers expose wire coil as stealable repair stock');
});
