import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

const ITEM_ID = 'resident_trinket_box';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('resident trinket box is a reachable living-block trade good', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Коробка жильцовых мелочей');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.LIVING, RoomType.STORAGE, RoomType.COMMON]);
  assert.equal(def.spawnW, 0.45);
  assert.equal(def.value, 34);
  assert.equal(getStack(def), 3);
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(resourceForItem(def.id), undefined);

  for (const tag of ['resident_good', 'valuable', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `resident_trinket_box registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `resident_trinket_box item must carry ${tag}`);
  }
});

test('resident trinket box is a steal, save or sell decision', () => {
  const player = makeTestPlayer({ inventory: [{ defId: ITEM_ID, count: 2 }] });
  const info = getInventorySlotActionInfo(player, 0);

  assert.ok(containerPoolIds(ContainerKind.WOODEN_CHEST).has(ITEM_ID));
  assert.equal(info?.category, 'trade');
  assert.equal(info?.canUse, false);
  assert.equal(info?.canDrop, true);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 34₽/шт · 68₽');
});
