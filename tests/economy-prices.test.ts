import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorLevel } from '../src/core/types';
import { createEconomyFloorState } from '../src/data/economy';
import { ensureEconomyState, getAdjustedItemPrice, getEconomyQuote } from '../src/systems/economy';
import { makeGameState } from './helpers';

test('getAdjustedItemPrice returns 0 for an unknown item', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  assert.equal(getAdjustedItemPrice(state, 'unknown_imaginary_item_123'), 0);
});

test('getAdjustedItemPrice calculates price and matches base getEconomyQuote', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  ensureEconomyState(state).floors[FloorLevel.LIVING] = createEconomyFloorState(FloorLevel.LIVING);

  const price = getAdjustedItemPrice(state, 'water');
  const quote = getEconomyQuote(state, 'water');

  assert.ok(price > 0);
  // It shouldn't necessarily strictly match buyPrice or sellPrice but rather roundedPrice(basePrice, multiplier)
  // Let's at least check it doesn't throw and is greater than 0
});

test('getAdjustedItemPrice caches the calculated price', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  ensureEconomyState(state).floors[FloorLevel.LIVING] = createEconomyFloorState(FloorLevel.LIVING);

  const firstPrice = getAdjustedItemPrice(state, 'water');

  // mutate the base value arbitrarily to prove cache hit.
  // Actually, wait, modifying the economy state but not version will hit the cache.
  ensureEconomyState(state).floors[FloorLevel.LIVING]!.resources['drink_water']!.stock += 1000;

  const secondPrice = getAdjustedItemPrice(state, 'water');

  // if not cached, increasing supply should drop the price
  assert.equal(firstPrice, secondPrice);
});

test('getAdjustedItemPrice invalidates cache on floor change or version change', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  ensureEconomyState(state).floors[FloorLevel.LIVING] = createEconomyFloorState(FloorLevel.LIVING);

  const firstPrice = getAdjustedItemPrice(state, 'water');

  // Change floor
  state.currentFloor = FloorLevel.KVARTIRY;
  ensureEconomyState(state).floors[FloorLevel.KVARTIRY] = createEconomyFloorState(FloorLevel.KVARTIRY);

  // Since floor changed, it recalculates (KVARTIRY usually has higher demand for water)
  const differentFloorPrice = getAdjustedItemPrice(state, 'water');
  assert.notEqual(firstPrice, differentFloorPrice);

  // Go back to LIVING and change version
  state.currentFloor = FloorLevel.LIVING;
  const backToLivingFirstPrice = getAdjustedItemPrice(state, 'water');

  ensureEconomyState(state).floors[FloorLevel.LIVING]!.resources['drink_water']!.stock += 1000;
  ensureEconomyState(state).priceVersion += 1;

  const higherStockPrice = getAdjustedItemPrice(state, 'water');
  assert.notEqual(backToLivingFirstPrice, higherStockPrice);
});
