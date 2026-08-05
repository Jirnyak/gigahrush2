import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, Occupation, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'import_toiletpaper';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('import toiletpaper is a distinct premium hygiene barter item', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Туалетная бумага «Импорт»');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.BATHROOM, RoomType.STORAGE, RoomType.COMMON]);
  assert.equal(def.spawnW, 0.18);
  assert.equal(def.value, 18);
  assert.equal(def.value > ITEMS.toiletpaper.value, true, 'import roll must differ from basic toiletpaper');
  assert.equal(getStack(def), 6);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['paper', 'hygiene', 'import', 'vending', 'barter', 'resident_good', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
});

test('import toiletpaper can be bought, stolen, sold or saved', () => {
  assert.ok(containerPoolIds(ContainerKind.CASHBOX).has(ITEM_ID), 'cashboxes expose automagazine-style stock');

  const player = makeTestPlayer();
  assert.equal(addItem(player, ITEM_ID, 2), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.canDrop, true);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 18₽/шт · 36₽');
});

test('storekeeper trade can expose imported toiletpaper', () => {
  const savedRandom = Math.random;
  try {
    let exposed = false;
    for (let selector = 0; selector < 1 && !exposed; selector += 0.001) {
      Math.random = (() => {
        const rolls = [0, selector, 0];
        return () => rolls.shift() ?? 0;
      })();

      const trade = generateNpcTradeItems(makeTestNpc({ occupation: Occupation.STOREKEEPER }));
      exposed = trade.some(item => item.defId === ITEM_ID);
    }
    assert.ok(exposed, 'storekeepers should sell automagazine hygiene goods');
  } finally {
    Math.random = savedRandom;
  }
});
