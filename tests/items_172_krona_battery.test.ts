import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, Occupation, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getInventorySlotActionInfo, inventoryItemCategory, addItem } from '../src/systems/inventory';
import { makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'krona_battery';

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

test('krona battery is reachable portable power stock', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Батарейка «Крона»');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.LIVING, RoomType.OFFICE, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.8);
  assert.equal(def.value, 18);
  assert.equal(getStack(def), 8);
  assert.equal(resourceForItem(def.id)?.id, 'tools');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  const electronics = RESOURCES.find(resource => resource.id === 'electronics');
  assert.ok(electronics?.itemIds.includes(ITEM_ID), 'krona battery must pressure electronics stock');

  const toolLocker = CONTAINER_DEFS[ContainerKind.TOOL_LOCKER].itemPool;
  assert.ok(toolLocker.some(item => item.defId === ITEM_ID), 'tool lockers must expose cabinet theft path');

  for (const tag of ['electronics', 'battery', 'portable_power', 'tool_power', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
});

test('krona battery stays a save or sell decision until tools consume it', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, ITEM_ID, 2), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.canDrop, true);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 18₽/шт · 36₽');
});

test('storekeeper and electrician trade can expose krona batteries', () => {
  assert.ok(sampledTradeItemIds(Occupation.STOREKEEPER).has(ITEM_ID), 'storekeeper trade must expose vending-style batteries');
  assert.ok(sampledTradeItemIds(Occupation.ELECTRICIAN).has(ITEM_ID), 'electrician trade must expose tool-power batteries');
});
