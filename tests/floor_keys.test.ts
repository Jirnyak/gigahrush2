import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { FloorLevel } from '../src/core/types';
import { floorKeyForEntry } from '../src/systems/floor_keys';

test('floorKeyForEntry returns story key when storyFloor is defined', () => {
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MAINTENANCE, storyFloor: FloorLevel.MINISTRY }), 'story:ministry');
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MAINTENANCE, storyFloor: FloorLevel.KVARTIRY }), 'story:kvartiry');
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MINISTRY, storyFloor: FloorLevel.VOID }), 'story:void');
});

test('floorKeyForEntry returns design key when designFloorId is defined', () => {
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MAINTENANCE, designFloorId: 'roof' }), 'design:roof');
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MAINTENANCE, designFloorId: 'spetspriemnik' }), 'design:spetspriemnik');
});

test('floorKeyForEntry returns procedural key when spec is defined', () => {
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MAINTENANCE, spec: { key: 'some_proc_key' } }), 'procedural:some_proc_key');
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MAINTENANCE, spec: { key: 'another-key' } }), 'procedural:another-key');
});

test('floorKeyForEntry returns correct key when z is defined and valid', () => {
  // Assuming z=50 corresponds to 'roof' design floor (from src/data/design_floors.ts)
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MAINTENANCE, z: 50 }), 'design:roof');
  // Assuming zForStoryFloor logic resolves properly for a known Z
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MAINTENANCE, z: -2 }), 'design:oranzhereya_betona');
});

test('floorKeyForEntry falls back to baseFloor when no better info is provided', () => {
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MAINTENANCE }), 'story:maintenance');
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.LIVING }), 'story:living');
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.HELL }), 'story:hell');
});

test('floorKeyForEntry priority check', () => {
  // Should pick storyFloor over designFloorId, spec, z, and baseFloor
  assert.equal(
    floorKeyForEntry({ baseFloor: FloorLevel.VOID, storyFloor: FloorLevel.MINISTRY, designFloorId: 'roof', spec: { key: 'test' }, z: 50 }),
    'story:ministry'
  );

  // Should pick designFloorId over spec, z, and baseFloor
  assert.equal(
    floorKeyForEntry({ baseFloor: FloorLevel.VOID, designFloorId: 'roof', spec: { key: 'test' }, z: -100 }),
    'design:roof'
  );

  // Should pick spec over z, and baseFloor
  assert.equal(
    floorKeyForEntry({ baseFloor: FloorLevel.VOID, spec: { key: 'test' }, z: 50 }),
    'procedural:test'
  );
});

test('floorKeyForEntry truncates z value correctly', () => {
  // Test that a fractional Z is properly Math.trunc-ed
  assert.equal(floorKeyForEntry({ baseFloor: FloorLevel.MAINTENANCE, z: 50.9 }), 'design:roof');
});
