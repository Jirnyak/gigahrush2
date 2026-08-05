import assert from 'node:assert/strict';
import test from 'node:test';
import { FloorLevel, type GameState } from '../src/core/types';
import { createEconomyFloorState } from '../src/data/economy';
import { ensureEconomyState, getResourceContractPressure } from '../src/systems/economy';
import { RESOURCES, ResourceDef } from '../src/data/resources';
import { makeGameState } from './helpers';

function resetFloor(state: GameState, floor: FloorLevel): void {
  const economy = ensureEconomyState(state);
  economy.floors[floor] = createEconomyFloorState(floor);
}

function setResourceStock(state: GameState, floor: FloorLevel, resourceId: string, stock: number, target: number = 100): void {
  const economy = ensureEconomyState(state);
  if (!economy.floors[floor]) {
    economy.floors[floor] = createEconomyFloorState(floor);
  }
  economy.floors[floor]!.resources[resourceId] = { stock, target };
}

test('getResourceContractPressure calculates pressure correctly based on stock and targets', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  resetFloor(state, FloorLevel.LIVING);

  const waterDef = RESOURCES.find(r => r.id === 'drink_water')!;

  // Test 1: Normal state (stock == target) -> pressure should be close to 1
  setResourceStock(state, FloorLevel.LIVING, 'drink_water', 100, 100);
  const pressureNormal = getResourceContractPressure(state, 'drink_water');
  assert.ok(pressureNormal >= 1 && pressureNormal <= 1.1, `Expected normal pressure ~1, got ${pressureNormal}`);

  // Test 2: High scarcity (stock much less than lowStock) -> pressure should be high
  setResourceStock(state, FloorLevel.LIVING, 'drink_water', 0, 100);
  const pressureHigh = getResourceContractPressure(state, 'drink_water');
  assert.ok(pressureHigh > pressureNormal, `Expected high scarcity pressure to be greater than normal`);
  assert.ok(pressureHigh <= (waterDef.rewardPressureMax ?? 3), `Expected pressure to not exceed reward pressure max`);

  // Test 3: Surplus (stock much higher than target) -> pressure should be very low (close to or at 1)
  setResourceStock(state, FloorLevel.LIVING, 'drink_water', 300, 100);
  const pressureSurplus = getResourceContractPressure(state, 'drink_water');
  assert.ok(pressureSurplus <= pressureNormal, `Expected surplus pressure to be less than or equal to normal`);

  // Test 4: Custom max multiplier
  setResourceStock(state, FloorLevel.LIVING, 'drink_water', 0, 100);
  const customMax = 1.5;
  const pressureCustomMax = getResourceContractPressure(state, 'drink_water', FloorLevel.LIVING, customMax);
  assert.ok(pressureCustomMax <= customMax, `Expected pressure ${pressureCustomMax} to be capped at custom max ${customMax}`);
});

test('getResourceContractPressure falls back to 1 for missing resource or stock', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  // Don't set stock to test missing stock case
  const pressureMissing = getResourceContractPressure(state, 'missing_resource');
  assert.equal(pressureMissing, 1);
});
