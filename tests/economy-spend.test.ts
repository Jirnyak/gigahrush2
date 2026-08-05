import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorLevel } from '../src/core/types';
import { spendResources, ensureEconomyState, changeResourceStock } from '../src/systems/economy';
import { makeGameState } from './helpers';

test('spendResources successfully spends resources and returns true', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  const econ = ensureEconomyState(state);

  const floorState = econ.floors[FloorLevel.LIVING] || { resources: {} };

  changeResourceStock(state, 'drink_water', 10, FloorLevel.LIVING);
  changeResourceStock(state, 'metal', 5, FloorLevel.LIVING);

  const updatedFloorState = econ.floors[FloorLevel.LIVING]!;
  const newWater = updatedFloorState.resources['drink_water'].stock;
  const newMetal = updatedFloorState.resources['metal'].stock;

  const result = spendResources(state, [
    { id: 'drink_water', count: 3 },
    { id: 'metal', count: 2 }
  ]);

  assert.equal(result, true);

  assert.equal(updatedFloorState.resources['drink_water'].stock, newWater - 3);
  assert.equal(updatedFloorState.resources['metal'].stock, newMetal - 2);
});

test('spendResources returns false and does not mutate stock if resources are insufficient', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  const econ = ensureEconomyState(state);
  changeResourceStock(state, 'drink_water', 0, FloorLevel.LIVING);
  const updatedFloorState = econ.floors[FloorLevel.LIVING]!;

  const startWater = updatedFloorState.resources['drink_water'].stock;
  changeResourceStock(state, 'drink_water', -startWater + 2, FloorLevel.LIVING);

  const startMetal = updatedFloorState.resources['metal'].stock;
  changeResourceStock(state, 'metal', -startMetal + 5, FloorLevel.LIVING);

  const result = spendResources(state, [
    { id: 'drink_water', count: 3 },
    { id: 'metal', count: 2 }
  ]);

  assert.equal(result, false);

  assert.equal(updatedFloorState.resources['drink_water'].stock, 2);
  assert.equal(updatedFloorState.resources['metal'].stock, 5);
});

test('spendResources returns false if resource is missing entirely', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  const econ = ensureEconomyState(state);
  changeResourceStock(state, 'drink_water', 0, FloorLevel.LIVING);
  const updatedFloorState = econ.floors[FloorLevel.LIVING]!;

  const startWater = updatedFloorState.resources['drink_water'].stock;
  changeResourceStock(state, 'drink_water', -startWater + 5, FloorLevel.LIVING);

  const result = spendResources(state, [
    { id: 'drink_water', count: 3 },
    { id: 'missing_resource', count: 1 }
  ]);

  assert.equal(result, false);

  assert.equal(updatedFloorState.resources['drink_water'].stock, 5);
});

test('spendResources respects the passed floor level argument', () => {
  const state = makeGameState({ currentFloor: FloorLevel.MAINTENANCE });

  const econ = ensureEconomyState(state);
  changeResourceStock(state, 'drink_water', 0, FloorLevel.LIVING);
  const livingFloorState = econ.floors[FloorLevel.LIVING]!;

  const startWater = livingFloorState.resources['drink_water'].stock;
  changeResourceStock(state, 'drink_water', -startWater + 5, FloorLevel.LIVING);

  const result = spendResources(state, [
    { id: 'drink_water', count: 3 }
  ], FloorLevel.LIVING);

  assert.equal(result, true);

  assert.equal(livingFloorState.resources['drink_water'].stock, 2);
});
