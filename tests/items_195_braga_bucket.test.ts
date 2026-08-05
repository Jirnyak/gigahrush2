import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { ItemType, RoomType } from '../src/core/types';
import { FACTORY_BY_ID, productionOutputResourceIds, productionRouteGoals } from '../src/data/factories';
import { ITEM_TAGS, ITEMS, getStack } from '../src/data/items';
import { resourceForItem } from '../src/data/resources';
import {
  BLACK_MARKET_88_STOCK,
  createBlackMarket88DesignState,
  quoteBlackMarket88Purchase,
} from '../src/gen/design_floors/black_market_88';
import { inventoryItemCategory } from '../src/systems/inventory';

const ITEM_ID = 'braga_bucket';

test('braga bucket is a reachable contraband brewing intermediate', () => {
  const def = ITEMS[ITEM_ID];

  assert.equal(def.id, ITEM_ID);
  assert.equal(def.name, 'Ведро браги');
  assert.equal(def.type, ItemType.MISC);
  assert.deepEqual(def.spawnRooms, [RoomType.KITCHEN, RoomType.SMOKING, RoomType.STORAGE]);
  assert.equal(def.spawnW, 0.12);
  assert.equal(getStack(def), 1);
  assert.equal(resourceForItem(def.id)?.id, 'contraband');
  assert.equal(inventoryItemCategory(def.id), 'trade');

  for (const tag of ['brewing', 'contraband', 'black_market', 'kitchen', 'factory_output', 'trade']) {
    assert.ok(ITEM_TAGS[ITEM_ID]?.includes(tag), `registry must publish ${tag}`);
    assert.ok(def.tags?.includes(tag), `item must carry ${tag}`);
  }
});

test('braga bucket can be bought on Black Market 88 or produced in a kitchen', () => {
  const offer = BLACK_MARKET_88_STOCK.find(row => row.itemId === ITEM_ID);
  assert.ok(offer, 'Black Market 88 should sell a braga bucket as risky survival stock');
  assert.equal(offer.lane, 'survival');
  assert.equal(offer.heatDelta > 0, true, 'buying braga should raise market heat');

  const quote = quoteBlackMarket88Purchase(createBlackMarket88DesignState(), offer.id, 1, 0);
  assert.ok(quote);
  assert.equal(quote.itemId, ITEM_ID);
  assert.equal(quote.locked, false);
  assert.equal(quote.buyPrice > ITEMS[ITEM_ID].value, true);

  const kitchen = FACTORY_BY_ID.communal_kitchen;
  const recipe = kitchen.recipes.find(row => row.id === 'start_braga_bucket');
  assert.ok(recipe);
  assert.deepEqual(recipe.inputItems, [
    { defId: 'sugar_pack', count: 1 },
    { defId: 'bottle_empty', count: 1 },
    { defId: 'rubber_tube', count: 1 },
  ]);
  assert.deepEqual(recipe.outputs, [{ defId: ITEM_ID, count: 1 }]);
  assert.equal(recipe.outputAccess, 'owner');
  assert.ok(recipe.eventTags?.includes('audit_risk'));
  assert.ok(productionRouteGoals(kitchen, recipe).includes('steal'));
  assert.ok(productionRouteGoals(kitchen, recipe).includes('repair'));
  assert.ok(productionOutputResourceIds(kitchen, recipe).includes('contraband'));
});
