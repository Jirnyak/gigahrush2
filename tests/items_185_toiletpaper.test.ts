import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, Occupation, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'toiletpaper';

test('toilet paper is improved as reachable hygiene barter stock', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Туалетная бумага');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.BATHROOM, RoomType.STORAGE]);
  assert.equal(def.spawnW, 1);
  assert.equal(def.value, 4);
  assert.equal(getStack(def), 8);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  const paperSupply = RESOURCES.find(resource => resource.id === 'paper');
  assert.ok(paperSupply?.itemIds.includes(ITEM_ID), 'toilet paper must pressure paper supply');

  for (const tag of ['hygiene', 'paper', 'resident_good', 'barter', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
  }
});

test('toilet paper remains stealable public loot and sellable trade goods', () => {
  const trash = CONTAINER_DEFS[ContainerKind.TRASH_BIN];
  assert.ok(trash.itemPool.some(item => item.defId === ITEM_ID), 'trash bins must keep a public steal/find path');

  const player = makeTestPlayer();
  assert.equal(addItem(player, ITEM_ID, 2), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 4₽/шт · 8₽');
});

test('storekeeper trade can expose toilet paper as vending barter', () => {
  const savedRandom = Math.random;
  try {
    let exposed = false;
    for (let target = 0; target < 64 && !exposed; target++) {
      let calls = 0;
      Math.random = () => {
        calls++;
        if (calls === 1) return 0;
        if (calls === 2) return target / 64;
        return 0;
      };
      const offers = generateNpcTradeItems(makeTestNpc({ occupation: Occupation.STOREKEEPER }));
      exposed = offers.some(offer => offer.defId === ITEM_ID);
    }
    assert.ok(exposed, 'storekeepers should sell toilet paper');
  } finally {
    Math.random = savedRandom;
  }
});
