import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorLevel } from '../src/core/types';
import { ensureEconomyState } from '../src/systems/economy';
import { makeGameState } from './helpers';

test('ensureEconomyState initializes economy state when undefined', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  // Ensure economy is undefined
  delete (state as any).economy;

  const economy = ensureEconomyState(state);

  assert.ok(economy);
  assert.equal(typeof economy.priceVersion, 'number');
  assert.ok(economy.floors);
  assert.ok(economy.floors[FloorLevel.LIVING]);
  assert.equal(economy.floors[FloorLevel.LIVING].floor, FloorLevel.LIVING);

  // Also check it mutated the state
  assert.equal((state as any).economy, economy);
});

test('ensureEconomyState normalizes invalid economy state', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  // Provide invalid economy
  (state as any).economy = { priceVersion: 'not-a-number' };

  const economy = ensureEconomyState(state);

  assert.ok(economy);
  assert.equal(typeof economy.priceVersion, 'number');
  assert.equal(economy.priceVersion, 1);
  assert.ok(economy.floors);
  assert.ok(economy.floors[FloorLevel.LIVING]);
});

test('ensureEconomyState adds current floor if missing', () => {
  const state = makeGameState({ currentFloor: FloorLevel.KVARTIRY });

  // Set up a valid economy but missing KVARTIRY
  const initialEconomy = {
    priceVersion: 1,
    floors: {
      [FloorLevel.LIVING]: { floor: FloorLevel.LIVING, resources: {}, lastTickAt: 0 }
    },
    routes: {}
  };
  (state as any).economy = initialEconomy;

  const economy = ensureEconomyState(state);

  assert.equal(economy, initialEconomy);
  assert.ok(economy.floors[FloorLevel.KVARTIRY]);
  assert.equal(economy.floors[FloorLevel.KVARTIRY].floor, FloorLevel.KVARTIRY);
});

test('ensureEconomyState returns existing state when valid and floor exists', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  const initialEconomy = {
    priceVersion: 5,
    floors: {
      [FloorLevel.LIVING]: { floor: FloorLevel.LIVING, resources: {}, lastTickAt: 100 }
    },
    routes: {}
  };
  (state as any).economy = initialEconomy;

  const economy = ensureEconomyState(state);

  assert.equal(economy, initialEconomy);
  assert.equal(economy.priceVersion, 5);
  assert.equal(economy.floors[FloorLevel.LIVING].lastTickAt, 100);
});
