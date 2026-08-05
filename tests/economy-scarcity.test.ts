import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel } from '../src/core/types';
import { getResourceScarcity, ensureEconomyState } from '../src/systems/economy';
import { makeGameState } from './helpers';

test('getResourceScarcity returns 1 for an unknown resource ID', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const scarcity = getResourceScarcity(state, 'unknown_resource_id');
  assert.equal(scarcity, 1);
});

test('getResourceScarcity returns 1 when stock equals target', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const econ = ensureEconomyState(state);
  const floorState = econ.floors[FloorLevel.LIVING]!;

  // Choose a known resource, e.g., 'drink_water'
  const resId = 'drink_water';
  floorState.resources[resId] = { stock: 100, target: 100, lastDelta: 0 };

  const scarcity = getResourceScarcity(state, resId);
  assert.equal(scarcity, 1);
});

test('getResourceScarcity returns less than 1 when stock is greater than target (surplus)', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const econ = ensureEconomyState(state);
  const floorState = econ.floors[FloorLevel.LIVING]!;

  const resId = 'drink_water';
  floorState.resources[resId] = { stock: 200, target: 100, lastDelta: 0 };

  const scarcity = getResourceScarcity(state, resId);
  assert.ok(scarcity < 1, `Expected scarcity < 1, got ${scarcity}`);
});

test('getResourceScarcity returns greater than 1 when stock is less than target (deficit)', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const econ = ensureEconomyState(state);
  const floorState = econ.floors[FloorLevel.LIVING]!;

  const resId = 'drink_water';
  floorState.resources[resId] = { stock: 10, target: 100, lastDelta: 0 };

  const scarcity = getResourceScarcity(state, resId);
  assert.ok(scarcity > 1, `Expected scarcity > 1, got ${scarcity}`);
});

test('getResourceScarcity defaults to currentFloor if floor parameter is not provided', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const econ = ensureEconomyState(state);

  const resId = 'drink_water';

  // Set distinct stocks for two different floors
  econ.floors[FloorLevel.LIVING]!.resources[resId] = { stock: 10, target: 100, lastDelta: 0 }; // Deficit
  econ.floors[FloorLevel.MINISTRY] = {
    floor: FloorLevel.MINISTRY,
    resources: { [resId]: { stock: 200, target: 100, lastDelta: 0 } },
    lastTickAt: 0,
  }; // Surplus

  const scarcityImplicit = getResourceScarcity(state, resId);
  const scarcityExplicitLiving = getResourceScarcity(state, resId, FloorLevel.LIVING);
  const scarcityExplicitMinistry = getResourceScarcity(state, resId, FloorLevel.MINISTRY);

  assert.equal(scarcityImplicit, scarcityExplicitLiving);
  assert.notEqual(scarcityImplicit, scarcityExplicitMinistry);
  assert.ok(scarcityImplicit > 1, 'Expected deficit on default floor');
  assert.ok(scarcityExplicitMinistry < 1, 'Expected surplus on other floor');
});
