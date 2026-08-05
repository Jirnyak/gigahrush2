import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, ItemType, Occupation, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { generateNpcTradeItems } from '../src/data/occupation_profiles';
import { FACTORIES } from '../src/data/factories';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import { addItem, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestNpc, makeTestPlayer } from './helpers';

const ITEM_ID = 'sugar_pack';

test('sugar pack is kitchen food with brewing and barter pressure', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Сахар');
  assert.equal(def.type, ItemType.FOOD);
  assert.deepEqual(def.spawnRooms, [RoomType.KITCHEN, RoomType.STORAGE, RoomType.LIVING]);
  assert.equal(def.spawnW, 0.8);
  assert.equal(def.value, 8);
  assert.equal(getStack(def), 8);
  assert.equal(resourceForItem(def.id)?.id, 'food');
  assert.equal(inventoryItemCategory(def.id), 'food');

  for (const tag of ['food', 'sugar', 'brewing', 'barter', 'bait_sugar', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item def must carry ${tag}`);
  }
});

test('sugar pack can be eaten or saved for kitchen brewing', () => {
  const player = makeTestPlayer({ needs: { food: 20, water: 50, sleep: 50, poo: 0, pee: 0 } });
  const state = makeGameState({ time: 30 });

  assert.equal(addItem(player, ITEM_ID, 2), true);
  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 1);
  assert.equal(player.needs?.food, 26);
  assert.ok(state.msgs.some(line => line.text.includes('Сытость +6')));

  const kitchen = FACTORIES.find(factory => factory.id === 'communal_kitchen');
  const recipe = kitchen?.recipes.find(row => row.id === 'start_braga_bucket');
  assert.ok(recipe?.inputItems?.some(item => item.defId === ITEM_ID), 'communal kitchen must spend sugar for braga');
});

test('sugar pack is reachable through fridge loot and cook trade', () => {
  const fridge = CONTAINER_DEFS[ContainerKind.FRIDGE];
  assert.ok(fridge.itemPool.some(item => item.defId === ITEM_ID), 'fridges must expose kitchen theft path');

  const savedRandom = Math.random;
  const rolls = [0, (10 + 0.01) / 12, 0];
  Math.random = () => rolls.shift() ?? 0;
  try {
    const offers = generateNpcTradeItems(makeTestNpc({ occupation: Occupation.COOK }));
    assert.ok(offers.some(offer => offer.defId === ITEM_ID), 'cook trade must expose sugar as kitchen barter');
  } finally {
    Math.random = savedRandom;
  }
});
