import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ContainerKind, FloorLevel, ItemType, RoomType } from '../src/core/types';
import { CONTAINER_DEFS } from '../src/data/container_defs';
import { FACTORIES } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCES, resourceForItem } from '../src/data/resources';
import { getRecentEvents } from '../src/systems/events';
import { addItem, getInventorySlotActionInfo, inventoryItemCategory, useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

const ITEM_ID = 'blueprint_t1_folder';

test('blueprint t1 folder is reachable tier one recipe paperwork', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Папка чертежей Т1');
  assert.equal(def.type, ItemType.MISC);
  assert.ok(def.spawnRooms.includes(RoomType.OFFICE));
  assert.ok(def.spawnRooms.includes(RoomType.STORAGE));
  assert.equal(def.spawnW, 0.6);
  assert.equal(def.stack, 3);
  assert.equal(resourceForItem(def.id)?.id, 'paper');
  assert.ok(RESOURCES.find(resource => resource.id === 'documents')?.itemIds.includes(def.id));
  assert.equal(inventoryItemCategory(def.id), 'documents');
  assert.ok(CONTAINER_DEFS[ContainerKind.FILING_CABINET].itemPool.some(item => item.defId === ITEM_ID));

  for (const tag of ['document', 'blueprint', 'recipe', 'production', 'access', 'tier1']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `blueprint_t1_folder registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `blueprint_t1_folder item must carry ${tag}`);
  }
});

test('blueprint t1 folder unlocks a reusable metal shop recipe', () => {
  const recipe = FACTORIES
    .find(factory => factory.id === 'metal_shop')
    ?.recipes.find(entry => entry.id === 'assemble_t1_door_kit');

  assert.ok(recipe, 'metal_shop should expose a T1 blueprint recipe');
  assert.deepEqual(recipe.inputItems, [{ defId: ITEM_ID, count: 1 }]);
  assert.ok(recipe.outputs.some(output => output.defId === 'door_kit' && output.count === 1));
  assert.ok(recipe.outputs.some(output => output.defId === ITEM_ID && output.count === 1));
  assert.ok(recipe.eventTags?.includes('recipe_unlock'));
});

test('blueprint t1 folder can be sold instead of saved for production', () => {
  const player = makeTestPlayer();
  const state = makeGameState({ currentFloor: FloorLevel.LIVING, time: 105 });

  assert.equal(addItem(player, ITEM_ID, 1), true);
  assert.equal(getInventorySlotActionInfo(player, 0)?.useLabel, 'Enter проверить');

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, ITEM_ID), 0);
  assert.equal(player.money, 72);
  assert.ok(state.msgs.some(line => line.text.includes('Папка чертежей Т1')));

  const sale = getRecentEvents(state, { type: 'player_sell_item', tags: ['black_market', 'blueprint'], limit: 1 })[0];
  assert.equal(sale?.itemId, ITEM_ID);
  assert.equal(sale.data?.outcome, 'black_market_document_sale');
  assert.equal(sale.data?.rewardMoney, 72);
});
