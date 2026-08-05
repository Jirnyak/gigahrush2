import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorLevel, type GameState, type RPGStats } from '../src/core/types';
import { createEconomyFloorState } from '../src/data/economy';
import { ensureEconomyState, getScarcityAdjustedReward } from '../src/systems/economy';
import { makeGameState } from './helpers';

function setResourceStock(state: GameState, floor: FloorLevel, resourceId: string, stock: number, target: number): void {
  const economy = ensureEconomyState(state);
  if (!economy.floors[floor]) economy.floors[floor] = createEconomyFloorState(floor);
  economy.floors[floor]!.resources[resourceId] = { stock, target };
}

test('getScarcityAdjustedReward scales linearly when multiplier is 1', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setResourceStock(state, FloorLevel.LIVING, 'drink_water', 100, 100);

  const reward = getScarcityAdjustedReward(state, 'drink_water', 10, FloorLevel.LIVING, 3);
  assert.equal(reward, 10);
});

test('getScarcityAdjustedReward boosts rewards when resource is scarce', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  // Extreme scarcity
  setResourceStock(state, FloorLevel.LIVING, 'drink_water', 0, 100);

  const reward = getScarcityAdjustedReward(state, 'drink_water', 10, FloorLevel.LIVING, 3);
  // It should be around 10 * 2.3 (rewardPressureMax for drink_water) = 23
  assert.ok(reward > 10);
  assert.equal(reward, 23);
});

test('getScarcityAdjustedReward uses cap properly', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setResourceStock(state, FloorLevel.LIVING, 'drink_water', 0, 100);

  const rewardWithLowerCap = getScarcityAdjustedReward(state, 'drink_water', 10, FloorLevel.LIVING, 1.5);
  // It should be 10 * 1.5 = 15 because we capped it to 1.5
  assert.equal(rewardWithLowerCap, 15);
});

test('getScarcityAdjustedReward applies RPG int multiplier', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setResourceStock(state, FloorLevel.LIVING, 'drink_water', 100, 100);

  const rpgStats: RPGStats = { str: 0, agi: 0, int: 5, level: 1, xp: 0 };

  // Base is 10, int multiplier should increase it
  const baseReward = getScarcityAdjustedReward(state, 'drink_water', 10, FloorLevel.LIVING, 3);
  const rpgReward = getScarcityAdjustedReward(state, 'drink_water', 10, FloorLevel.LIVING, 3, rpgStats);

  assert.equal(baseReward, 10);
  assert.ok(rpgReward > 10);
});

test('getScarcityAdjustedReward does not go below baseReward when there is a surplus', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  // Extreme surplus
  setResourceStock(state, FloorLevel.LIVING, 'drink_water', 200, 100);

  const reward = getScarcityAdjustedReward(state, 'drink_water', 10, FloorLevel.LIVING, 3);

  // It should be 10, because it uses Math.max(1, ...)
  assert.equal(reward, 10);
});

test('getScarcityAdjustedReward handles invalid resourceId gracefully', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  const reward = getScarcityAdjustedReward(state, 'invalid_resource_id_123', 10, FloorLevel.LIVING, 3);

  // getResourceContractPressure checks RESOURCE_BY_ID, returns 1 for invalid
  assert.equal(reward, 10);
});

test('getScarcityAdjustedReward rounds results properly', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  setResourceStock(state, FloorLevel.LIVING, 'drink_water', 90, 100);

  // A small deviation should lead to a non-integer totalMultiplier before rounding.
  // With 90 stock and 100 target, it returns a multiplier > 1.

  const reward = getScarcityAdjustedReward(state, 'drink_water', 10, FloorLevel.LIVING, 3);
  assert.equal(Number.isInteger(reward), true);
  assert.ok(reward >= 10);
});
