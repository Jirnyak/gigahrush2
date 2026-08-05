import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorLevel, type GameState } from '../src/core/types';
import { createEconomyFloorState } from '../src/data/economy';
import { ensureEconomyState, getAdjustedItemPrice, invalidateEconomyPrices } from '../src/systems/economy';
import { makeGameState } from './helpers.js';

function resetFloor(state: GameState, floor: FloorLevel): void {
  const economy = ensureEconomyState(state);
  economy.floors[floor] = createEconomyFloorState(floor);
}

test('invalidateEconomyPrices increments priceVersion', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);
  const econ = ensureEconomyState(state);

  const prevVersion = econ.priceVersion;
  invalidateEconomyPrices(state);

  assert.equal(econ.priceVersion, prevVersion + 1);
});

test('invalidateEconomyPrices forces getAdjustedItemPrice to recalculate', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);
  const econ = ensureEconomyState(state);

  // Set initial stock
  const floorState = econ.floors[FloorLevel.LIVING]!;
  floorState.resources['drink_water'] = { stock: 10, target: 10, lastDelta: 0 };

  // Cache the price
  const initialPrice = getAdjustedItemPrice(state, 'water');

  // Bypass changeResourceStock to artificially change the stock without triggering a natural version bump.
  // Less stock means higher price due to scarcity.
  floorState.resources['drink_water'].stock = 0;

  // Since the price is cached, we expect it to return the initial cached price
  const cachedPrice = getAdjustedItemPrice(state, 'water');
  assert.equal(cachedPrice, initialPrice, 'Price should be cached and remain unchanged before invalidation');

  // Invalidate prices
  invalidateEconomyPrices(state);

  // Now it should recalculate and reflect the new stock (scarcity -> higher price)
  const newPrice = getAdjustedItemPrice(state, 'water');
  assert.ok(newPrice > initialPrice, 'Price should be recalculated and be higher due to scarcity after invalidation');
});
