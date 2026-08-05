import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, Occupation, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { inventoryItemCategory } from '../src/systems/inventory';
import { makeTestNpc } from './helpers';

const ITEM_ID = 'ceramic_shards_pack';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

function sampledTradeItemIds(occupation: Occupation): Set<string> {
  const savedRandom = Math.random;
  const out = new Set<string>();
  try {
    for (let i = 0; i < 512; i++) {
      const pick = i / 512;
      let roll = 0;
      Math.random = () => roll++ === 0 ? 0 : pick;
      for (const item of generateNpcTradeItems(makeTestNpc({ occupation }))) out.add(item.defId);
    }
  } finally {
    Math.random = savedRandom;
  }
  return out;
}

test('ceramic shards pack is a tradeable insulation material', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Керамика');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.BATHROOM));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.ok(def.spawnRooms.includes(RoomType.PRODUCTION));
  assert.equal(def.spawnW, 0.8);
  assert.equal(def.value, 8);
  assert.equal(def.stack, 12);
  assert.equal(resourceForItem(def.id)?.id, 'industrial_slurry');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['material', 'ceramic', 'insulation', 'production', 'trade']) {
    assert.ok(def.tags?.includes(tag), `ceramic_shards_pack must publish ${tag}`);
  }
});

test('ceramic shards pack has buy, steal and production-spend paths', () => {
  assert.ok(containerPoolIds(ContainerKind.METAL_CABINET).has(ITEM_ID), 'storage cabinets must expose ceramic');
  assert.ok(containerPoolIds(ContainerKind.TRASH_BIN).has(ITEM_ID), 'trash bins must expose a risky scrap path');
  assert.ok(sampledTradeItemIds(Occupation.STOREKEEPER).has(ITEM_ID), 'storekeeper trade must expose automagazine-style ceramic');
  assert.ok(RESOURCES.find(resource => resource.id === 'industrial_slurry')?.itemIds.includes(ITEM_ID), 'ceramic must feed industrial stock pressure');
});
