import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  updateSamosbor,
  resetSamosborRuntimeForTests,
  getSamosborFrontTickAccumForTests,
  setSamosborFrontTickAccumForTests,
  setActiveSamosborFrontsForTests,
  SAMOSBOR_FRONT_TICK_INTERVAL,
  SAMOSBOR_FRONT_MAX_CATCHUP_TICKS
} from '../../src/systems/samosbor.js';
import { setActiveSamosborVariantForTests } from '../../src/systems/samosbor_variants_runtime.js';
import { World, GameState, FloorLevel, Entity } from '../../src/core/types.js';

function createMockWorld(): World {
  return {
    width: 10,
    height: 10,
    cells: new Uint8Array(100),
    fog: new Uint8Array(100),
    aptMask: new Uint8Array(100),
    hermoWall: new Uint8Array(100),
    zoneMap: new Int16Array(100).fill(-1),
    walkable: new Uint8Array(100),
    rooms: [],
    zones: [],
    decorations: [],
    items: [],
    factions: {},
    dirtyRects: []
  } as unknown as World;
}

function createMockGameState(): GameState {
  return {
    tick: 0,
    time: 0,
    clock: { day: 1, hour: 12, minute: 0 },
    samosborActive: true,
    samosborTimer: 100, // Make sure it's not going to end immediately
    samosborCount: 0,
    currentFloor: FloorLevel.LIVING,
    gameOver: false,
    zoneTags: {}
  } as unknown as GameState;
}

test('Samosbor catchup logic caps catchup to prevent multi-tick bursts', async (t) => {
  resetSamosborRuntimeForTests();
  const world = createMockWorld();
  const state = createMockGameState();
  const entities: Entity[] = [];
  const nextId = { v: 1 };

  // Set up an active front so the block runs
  setActiveSamosborFrontsForTests([{
    type: 'wave',
    age: 0,
    maxAge: 100,
    processed: 0,
    changed: 0,
    monstersSpawned: 0,
    head: 0,
    frontier: [0],
    dead: false,
    visited: new Set([0])
  }]);

  setActiveSamosborVariantForTests({
    def: { id: 'wave' },
    subsystems: [],
    sealTimingDelta: 0
  });

  setSamosborFrontTickAccumForTests(0);

  // Provide a large dt (e.g. 1.0s).
  // SAMOSBOR_FRONT_TICK_INTERVAL = 0.05
  // SAMOSBOR_FRONT_MAX_CATCHUP_TICKS = 2
  // We expect catchup loop to run 2 times.
  // It will subtract 0.05 * 2 = 0.1 from accum.
  // accum becomes 0.9.
  // Drain logic: if accum > 0.05 * 2 (0.1), then accum = 0.05 * 0.5 = 0.025.

  updateSamosbor(world, entities, state, 1.0, nextId);

  const finalAccum = getSamosborFrontTickAccumForTests();
  // We expect exactly 0.025
  const expectedAccum = SAMOSBOR_FRONT_TICK_INTERVAL * 0.5;
  assert.equal(Math.abs(finalAccum - expectedAccum) < 0.0001, true, 'Accumulated time should be capped and drained');
  setActiveSamosborVariantForTests(null);
  setActiveSamosborFrontsForTests([]);
});
