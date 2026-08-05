import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel, GameState, LiftDirection } from '../src/core/types';
import {
  formatFloorZ,
  createFloorRunState,
  normalizeFloorRunState,
  isFloorZUnlocked,
  unlockFloorZ,
  unlockedFloorZs,
  setFloorRunState,
  floorRunStateForSave
} from '../src/systems/procedural_floors';

function createMockGameState(): GameState {
  return {
    currentFloor: FloorLevel.LIVING,
    time: 0,
    player: {
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 100,
      inventory: [],
    },
    entities: [],
    quests: [],
    msgs: [],
  } as unknown as GameState;
}

test('formatFloorZ formats zero correctly', () => {
  assert.equal(formatFloorZ(0), '+0');
});

test('formatFloorZ formats positive numbers correctly', () => {
  assert.equal(formatFloorZ(5), '+5');
  assert.equal(formatFloorZ(12), '+12');
});

test('formatFloorZ formats negative numbers correctly', () => {
  assert.equal(formatFloorZ(-5), '-5');
  assert.equal(formatFloorZ(-12), '-12');
});

test('createFloorRunState initializes with random seed and currentZ based on FloorLevel', () => {
  const state = createFloorRunState(FloorLevel.LIVING);
  assert.ok(typeof state.runSeed === 'number');
  assert.equal(state.currentZ, 0); // zForStoryFloor(FloorLevel.LIVING) is 0
  assert.deepEqual(state.unlockedZs, [0]);
  assert.deepEqual(state.visited, {});
});

test('createFloorRunState uses provided FloorLevel', () => {
  const state = createFloorRunState(FloorLevel.MINISTRY); // Ministry z is 30
  assert.equal(state.currentZ, 30);
  assert.deepEqual(state.unlockedZs, [30]);
});

test('normalizeFloorRunState falls back correctly for missing or invalid values', () => {
  const normalized = normalizeFloorRunState(null, FloorLevel.LIVING);
  assert.ok(typeof normalized.runSeed === 'number');
  assert.equal(normalized.currentZ, 0);
  assert.deepEqual(normalized.unlockedZs, [0]);
});

test('unlockFloorZ and isFloorZUnlocked', () => {
  const gameState = createMockGameState();
  const runState = createFloorRunState(FloorLevel.LIVING);
  (gameState as any).floorRun = runState;

  // Initially only 0 is unlocked
  assert.equal(isFloorZUnlocked(gameState, 0), true);
  assert.equal(isFloorZUnlocked(gameState, 1), false);

  // Unlock floor 1
  const result1 = unlockFloorZ(gameState, 1);
  assert.equal(result1, true);
  assert.equal(isFloorZUnlocked(gameState, 1), true);

  // Trying to unlock again returns false
  const result2 = unlockFloorZ(gameState, 1);
  assert.equal(result2, false);
});

test('unlockFloorZ rejects invalid Z limits', () => {
  const gameState = createMockGameState();
  const runState = createFloorRunState(FloorLevel.LIVING);
  (gameState as any).floorRun = runState;

  // Try unlocking beyond limits (-49 to 49 usually, but let's test extreme)
  const resultMax = unlockFloorZ(gameState, 999);
  const resultMin = unlockFloorZ(gameState, -999);

  assert.equal(resultMax, false);
  assert.equal(resultMin, false);
});

test('setFloorRunState and floorRunStateForSave', () => {
  const gameState = createMockGameState();

  const state = setFloorRunState(gameState, {
    runSeed: 1234,
    currentZ: 5,
    unlockedZs: [0, 5]
  }, FloorLevel.LIVING);

  assert.equal(state.runSeed, 1234);
  assert.equal(state.currentZ, 5);

  const savedState = floorRunStateForSave(gameState);
  assert.equal(savedState.runSeed, 1234);
  assert.equal(savedState.currentZ, 5);
});
