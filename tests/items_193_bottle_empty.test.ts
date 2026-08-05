import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, Occupation, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { FACTORIES } from '../src/data/factories';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory } from '../src/systems/inventory';
import { makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'bottle_empty';

test('empty bottle is a kitchen container item with trade and brewing roles', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Бутылка');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.KITCHEN, RoomType.LIVING, RoomType.STORAGE]);
  assert.equal(def.spawnW, 1);
  assert.equal(def.value, 2);
  assert.equal(getStack(def), 12);
  assert.equal(resourceForItem(ITEM_ID)?.id, 'industrial_slurry');
  assert.ok(RESOURCE_BY_ID.industrial_slurry.itemIds.includes(ITEM_ID));
  assert.equal(inventoryItemCategory(ITEM_ID), 'trade');

  for (const tag of ['container', 'resident_good', 'water_container', 'reagent', 'brewing', 'factory_input', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
});

test('empty bottle is reachable through kitchens, living storage and braga production', () => {
  assert.ok(
    CONTAINER_DEFS[ContainerKind.FRIDGE].itemPool.some(item => item.defId === ITEM_ID),
    'fridges expose kitchen bottle theft',
  );
  assert.ok(
    CONTAINER_DEFS[ContainerKind.WOODEN_CHEST].itemPool.some(item => item.defId === ITEM_ID),
    'living chests expose resident bottle loot',
  );
  assert.ok(
    CONTAINER_DEFS[ContainerKind.TRASH_BIN].itemPool.some(item => item.defId === ITEM_ID),
    'trash bins expose public bottle scavenging',
  );

  const bragaRecipe = FACTORIES
    .find(factory => factory.id === 'communal_kitchen')
    ?.recipes.find(recipe => recipe.id === 'start_braga_bucket');
  assert.ok(bragaRecipe?.inputItems?.some(input => input.defId === ITEM_ID && input.count === 1));
  assert.ok(bragaRecipe?.outputs.some(output => output.defId === 'braga_bucket' && output.count === 1));
});

test('cook trade can expose empty bottles, leaving a save or sell decision', () => {
  const savedRandom = Math.random;
  try {
    Math.random = (() => {
      const rolls = [0, 0.99, 0];
      return () => rolls.shift() ?? 0;
    })();
    const trade = generateNpcTradeItems(makeTestNpc({ occupation: Occupation.COOK }));
    assert.ok(trade.some(item => item.defId === ITEM_ID), 'cook trade must expose bottle purchases');
  } finally {
    Math.random = savedRandom;
  }

  const player = makeTestPlayer();
  assert.equal(addItem(player, ITEM_ID, 2), true);

  const info = getInventorySlotActionInfo(player, 0);
  assert.equal(info?.category, 'trade');
  assert.equal(info?.useLabel, 'Enter нет действия');
  assert.equal(info?.canUse, false);
  assert.equal(info?.sellLabel, 'Справка: базовая цена 2₽/шт · 4₽');
});
