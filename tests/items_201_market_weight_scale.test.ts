import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestPlayer } from './helpers';

const ITEM_ID = 'market_weight_scale';

function containerPoolIds(kind: ContainerKind): Set<string> {
  return new Set(CONTAINER_DEFS[kind].itemPool.map(item => item.defId));
}

test('market weight scale is a trade-stall proof good', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Рыночные весы');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.KITCHEN, RoomType.OFFICE, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.28);
  assert.equal(def.value, 88);
  assert.equal(getStack(def), 1);
  assert.equal(resourceForItem(def.id)?.id, 'tools');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['trade', 'market', 'resident_good']) {
    assert.ok(def.tags?.includes(tag), `market_weight_scale must carry ${tag}`);
  }
});

test('market weight scale is reachable through cashbox theft and sale choice', () => {
  assert.ok(containerPoolIds(ContainerKind.CASHBOX).has(ITEM_ID));

  const player = makeTestPlayer();
  assert.equal(addItem(player, ITEM_ID, 1), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.canDrop, true);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 88₽');
});
