import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorLevel } from '../src/core/types';
import { makeGameState } from './helpers';
import { getItemPriceMultiplier, getAdjustedItemPrice, primeTradePriceCache, changeResourceStock } from '../src/systems/economy';

test('getItemPriceMultiplier returns 1 for unknown item', () => {
  const state = makeGameState();
  const multiplier = getItemPriceMultiplier(state, 'unknown_non_existent_item_123');
  assert.equal(multiplier, 1);
});

test('getAdjustedItemPrice returns 0 for unknown item', () => {
  const state = makeGameState();
  const price = getAdjustedItemPrice(state, 'unknown_non_existent_item_123');
  assert.equal(price, 0);
});

test('getItemPriceMultiplier returns valid multiplier for existing item', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const multiplier = getItemPriceMultiplier(state, 'water');
  // Water is a known item, should have a multiplier > 0
  assert.ok(multiplier > 0);
});

test('getAdjustedItemPrice returns valid price for existing item', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const price = getAdjustedItemPrice(state, 'water');
  // Water is a known item, should have a price > 0
  assert.ok(price > 0);
});

test('getItemPriceMultiplier uses cache and updates when stock changes', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  const initialMultiplier = getItemPriceMultiplier(state, 'water');
  const initialPrice = getAdjustedItemPrice(state, 'water');

  // Call again, should use cache and be the exact same
  assert.equal(getItemPriceMultiplier(state, 'water'), initialMultiplier);
  assert.equal(getAdjustedItemPrice(state, 'water'), initialPrice);

  // Change stock to affect scarcity
  changeResourceStock(state, 'drink_water', -100, FloorLevel.LIVING);

  // Cache should be invalidated because priceVersion incremented
  const newMultiplier = getItemPriceMultiplier(state, 'water');
  const newPrice = getAdjustedItemPrice(state, 'water');

  // Usually scarcity increases when stock drops
  assert.notEqual(newMultiplier, initialMultiplier);
  assert.notEqual(newPrice, initialPrice);
});

test('primeTradePriceCache pre-populates the cache for given inventories', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const inventory1 = [{ defId: 'water', count: 1 }];
  const inventory2 = [{ defId: 'ration', count: 1 }];

  // Also pass an undefined/null inventory to ensure it doesn't crash
  primeTradePriceCache(state, [inventory1, undefined, inventory2]);

  const waterMultiplier = getItemPriceMultiplier(state, 'water');
  const rationMultiplier = getItemPriceMultiplier(state, 'ration');

  assert.ok(waterMultiplier > 0);
  assert.ok(rationMultiplier > 0);
});
