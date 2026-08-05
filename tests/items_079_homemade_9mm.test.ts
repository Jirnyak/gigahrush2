import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType } from '../src/core/types';
import { FACTORY_BY_ID } from '../src/data/factories';
import { ITEM_TAGS, ITEMS } from '../src/data/items';
import { RESOURCE_BY_ID, resourceForItem } from '../src/data/resources';
import { BLACK_MARKET_88_STOCK } from '../src/gen/design_floors/black_market_88';
import { useItem } from '../src/systems/inventory';
import { countInventoryItem, makeGameState, makeTestPlayer } from './helpers';

test('homemade 9mm is contraband ammo with explicit resource pressure', () => {
  const def = ITEMS.homemade_9mm;

  assert.equal(def.id, 'homemade_9mm');
  assert.equal(def.name, 'Кустарные 9мм');
  assert.equal(def.type, ItemType.AMMO);
  assert.deepEqual(def.spawnRooms, []);
  assert.equal(def.spawnW, 0);
  assert.equal(resourceForItem(def.id)?.id, 'ammo');
  assert.ok(RESOURCE_BY_ID.contraband.itemIds.includes(def.id));

  for (const tag of ['homemade', 'contraband', 'black_market', 'production', 'audit']) {
    assert.ok(ITEM_TAGS.homemade_9mm?.includes(tag), `homemade_9mm must publish ${tag}`);
  }
});

test('homemade 9mm is reachable from the illegal smelter and Black Market 88', () => {
  const smelter = FACTORY_BY_ID.illegal_ammo_smelter;
  const recipe = smelter.recipes.find(row => row.id === 'cast_homemade_9mm');

  assert.ok(recipe);
  assert.deepEqual(recipe.inputItems, [{ defId: 'homemade_ammo_instruction', count: 1 }]);
  assert.deepEqual(recipe.outputs, [
    { defId: 'homemade_9mm', count: 3 },
    { defId: 'homemade_ammo_instruction', count: 1 },
  ]);
  assert.ok(recipe.outputTags.includes('illegal'));
  assert.ok(recipe.outputTags.includes('homemade'));

  const marketRow = BLACK_MARKET_88_STOCK.find(row => row.itemId === 'homemade_9mm');
  assert.ok(marketRow);
  assert.equal(marketRow.lane, 'weapons');
  assert.ok(marketRow.heatDelta > 0);
});

test('homemade 9mm can be unpacked into ordinary 9mm before firing', () => {
  const player = makeTestPlayer({ inventory: [{ defId: 'homemade_9mm', count: 1 }] });
  const state = makeGameState({ time: 80 });

  useItem(player, 0, state.msgs, state.time, state);

  assert.equal(countInventoryItem(player, 'homemade_9mm'), 0);
  assert.equal(countInventoryItem(player, 'ammo_9mm'), 6);
  assert.ok(state.msgs.some(line => line.text.includes('Кустарные 9мм перебраны')));
});
