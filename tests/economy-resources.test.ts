import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorLevel } from '../src/core/types';
import { canSpendResources, changeResourceStock } from '../src/systems/economy';
import { makeGameState } from './helpers';

test('canSpendResources returns true for empty inputs', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  assert.equal(canSpendResources(state, []), true);
});

test('canSpendResources returns true when the floor has enough stock', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  // By default floor has some base stock (e.g. food is > 0)
  assert.equal(canSpendResources(state, [{ id: 'food', count: 10 }]), true);
});

test('canSpendResources returns false when the floor does not have enough stock', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  // Deplete stock
  changeResourceStock(state, 'food', -10000);
  assert.equal(canSpendResources(state, [{ id: 'food', count: 10 }]), false);
});

test('canSpendResources returns false when requesting an unknown resource', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  assert.equal(canSpendResources(state, [{ id: 'unknown_resource_id', count: 1 }]), false);
});

test('canSpendResources handles multiple resources correctly', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  // Both available by default
  assert.equal(canSpendResources(state, [
    { id: 'food', count: 5 },
    { id: 'drink_water', count: 5 }
  ]), true);

  // Deplete one
  changeResourceStock(state, 'drink_water', -10000);

  // One available, one not
  assert.equal(canSpendResources(state, [
    { id: 'food', count: 5 },
    { id: 'drink_water', count: 5 }
  ]), false);
});

test('canSpendResources respects the specified floor vs current floor', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  // Deplete food on the current floor (LIVING)
  changeResourceStock(state, 'food', -10000, FloorLevel.LIVING);

  // Should fail since LIVING has no food
  assert.equal(canSpendResources(state, [{ id: 'food', count: 10 }]), false);
  assert.equal(canSpendResources(state, [{ id: 'food', count: 10 }], FloorLevel.LIVING), false);

  // Should succeed for another floor like MINISTRY which hasn't been depleted
  assert.equal(canSpendResources(state, [{ id: 'food', count: 10 }], FloorLevel.MINISTRY), true);
});
