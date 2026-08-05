import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, Occupation, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'lice_shampoo';

test('lice shampoo is reachable hygiene stock for medical and bathroom routes', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Шампунь от вшей');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.MEDICAL, RoomType.BATHROOM]);
  assert.equal(def.spawnW, 0.45);
  assert.equal(def.value, 26);
  assert.equal(getStack(def), 4);
  assert.equal(resourceForItem(def.id)?.id, 'medicine');
  assert.equal(inventoryItemCategory(def.id), 'trade');
  assert.equal(def.use, undefined, 'lice shampoo is trade/status stock until parasite status exists');

  const medicineSupply = RESOURCES.find(resource => resource.id === 'medicine');
  assert.ok(medicineSupply?.itemIds.includes(ITEM_ID), 'lice shampoo must pressure sanitary medicine stock');

  const medicalCabinet = CONTAINER_DEFS[ContainerKind.MEDICAL_CABINET];
  assert.ok(medicalCabinet.itemPool.some(item => item.defId === ITEM_ID), 'medical cabinets must expose lice shampoo as stealable stock');

  for (const tag of ['hygiene', 'parasite', 'medical', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
  assert.equal(def.tags?.includes('medicine'), false, 'lice shampoo must not become instant medicine');
});

test('lice shampoo stays a sell or save decision in inventory', () => {
  const player = makeTestPlayer();

  assert.equal(addItem(player, ITEM_ID, 2), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.canDrop, true);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 26₽/шт · 52₽');
});

test('doctor and storekeeper trade can expose lice shampoo', () => {
  const savedRandom = Math.random;
  try {
    Math.random = (() => {
      const rolls = [0, (8 + 0.01) / 10, 0];
      return () => rolls.shift() ?? 0;
    })();
    const doctorTrade = generateNpcTradeItems(makeTestNpc({ occupation: Occupation.DOCTOR }));
    assert.ok(doctorTrade.some(item => item.defId === ITEM_ID), 'doctor trade pool must expose lice shampoo');

    Math.random = (() => {
      const rolls = [0, (9 + 0.01) / 21, 0];
      return () => rolls.shift() ?? 0;
    })();
    const storekeeperTrade = generateNpcTradeItems(makeTestNpc({ occupation: Occupation.STOREKEEPER }));
    assert.ok(storekeeperTrade.some(item => item.defId === ITEM_ID), 'storekeeper trade pool must expose vending hygiene goods');
  } finally {
    Math.random = savedRandom;
  }
});
