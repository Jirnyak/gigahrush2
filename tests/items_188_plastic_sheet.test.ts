import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, Occupation, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';
import { inventoryItemCategory } from '../src/systems/inventory';
import { makeTestNpc } from './helpers';

const ITEM_ID = 'plastic_sheet';

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

test('plastic sheet is a reachable production material', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Пластик');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.LIVING]);
  assert.equal(def.spawnW, 0.9);
  assert.equal(def.value, 7);
  assert.equal(getStack(def), 12);
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['material', 'plastic', 'production', 'repair_input', 'electronics', 'tools', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
});

test('plastic sheet has buy, steal and resource-pressure paths', () => {
  assert.equal(resourceForItem(ITEM_ID)?.id, 'tools');
  assert.ok(RESOURCE_BY_ID.electronics.itemIds.includes(ITEM_ID), 'electronics pressure must see plastic panels');
  assert.ok(RESOURCE_BY_ID.industrial_slurry.itemIds.includes(ITEM_ID), 'industrial stock must see plastic as raw scrap');
  assert.ok(containerPoolIds(ContainerKind.METAL_CABINET).has(ITEM_ID), 'production cabinets expose stealable plastic stock');
  assert.ok(sampledTradeItemIds(Occupation.STOREKEEPER).has(ITEM_ID), 'storekeeper trade must expose automagazine-style plastic');
});
