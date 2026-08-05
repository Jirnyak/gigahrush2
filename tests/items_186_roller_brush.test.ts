import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, Occupation, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'roller_brush';

test('roller brush is a reachable painting and repair trade item', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Валик');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.STORAGE, RoomType.PRODUCTION, RoomType.LIVING]);
  assert.equal(def.spawnW, 0.7);
  assert.equal(def.value, 12);
  assert.equal(getStack(def), 4);
  assert.equal(resourceForItem(def.id)?.id, 'tools');
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(def.use, undefined, 'roller brush remains trade/repair stock until wall marks are generic');

  for (const tag of ['paint', 'repair', 'repair_input', 'resident_good', 'trade', 'source_automagazine', 'source_storage']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
});

test('roller brush can be stolen from storage or bought from storekeepers', () => {
  const toolLocker = CONTAINER_DEFS[ContainerKind.TOOL_LOCKER].itemPool;
  assert.ok(toolLocker.some(item => item.defId === ITEM_ID), 'tool lockers must expose storage-theft rollers');

  const savedRandom = Math.random;
  try {
    let seen = false;
    for (let i = 0; i < 64 && !seen; i++) {
      Math.random = (() => {
        const rolls = [0, (i + 0.01) / 64, 0];
        return () => rolls.shift() ?? 0;
      })();
      const storekeeperTrade = generateNpcTradeItems(makeTestNpc({ occupation: Occupation.STOREKEEPER }));
      seen = storekeeperTrade.some(item => item.defId === ITEM_ID);
    }
    assert.ok(seen, 'storekeeper trade must expose automagazine-style rollers');
  } finally {
    Math.random = savedRandom;
  }
});

test('roller brush is a save, sell or drop decision until painting is executable', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, ITEM_ID, 2), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.canDrop, true);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 12₽/шт · 24₽');
});
