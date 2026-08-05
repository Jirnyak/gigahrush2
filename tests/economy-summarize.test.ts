import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { summarizeEconomy, ensureEconomyState } from '../src/systems/economy';
import { makeGameState } from './helpers';
import { RESOURCES } from '../src/data/resources';
import { FloorLevel } from '../src/core/types';
import { createEconomyFloorState } from '../src/data/economy';

test('summarizeEconomy returns expected formatted strings', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const econ = ensureEconomyState(state);
  const floorState = createEconomyFloorState(FloorLevel.LIVING);
  econ.floors[FloorLevel.LIVING] = floorState;

  // Set specific stock values for determinism
  floorState.resources['drink_water'].stock = 50.4;
  floorState.resources['drink_water'].target = 100;

  const summary = summarizeEconomy(state, 1);

  assert.equal(summary.length, 1);
  // Expected format: "Name: stock/target xMult"
  assert.match(summary[0], /^Питьевая вода: 50\/100 x\d+\.\d{2}$/);
});

test('summarizeEconomy respects the limit parameter', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });

  const limit3 = summarizeEconomy(state, 3);
  assert.equal(limit3.length, 3);

  const limit5 = summarizeEconomy(state, 5);
  assert.equal(limit5.length, 5);
});

test('summarizeEconomy handles missing floor state', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  // Do not initialize econ.floors

  const summary = summarizeEconomy(state, 2);
  assert.equal(summary.length, 2);
  assert.ok(summary[0].includes(RESOURCES[0].name));
  assert.ok(summary[1].includes(RESOURCES[1].name));
});

test('summarizeEconomy correctly calculates multiplier (scarcity)', () => {
  const state = makeGameState({ currentFloor: FloorLevel.LIVING });
  const econ = ensureEconomyState(state);
  const floorState = createEconomyFloorState(FloorLevel.LIVING);
  econ.floors[FloorLevel.LIVING] = floorState;

  // Set low stock to increase scarcity
  const res = RESOURCES[0];
  floorState.resources[res.id].stock = res.lowStock / 2;

  const summary = summarizeEconomy(state, 1);

  // Scarcity should be > 1.00
  const match = summary[0].match(/x(\d+\.\d{2})$/);
  assert.ok(match);
  const mult = parseFloat(match[1]);
  assert.ok(mult > 1.0);
});
