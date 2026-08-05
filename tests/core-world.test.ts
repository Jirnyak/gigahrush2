import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { Cell, DoorState, Feature, W } from '../src/core/types';
import {
  REACH_GATE_HERMETIC,
  REACH_GATE_KEY,
  REACH_GATE_NONE,
  World,
  auditReachability,
  classifyReachabilityCell,
  describeReachability,
  hasReachableAdjacentCell,
} from '../src/core/world';

test('World wraps coordinates and measures toroidal distance', () => {
  const world = new World();

  assert.equal(world.wrap(-1), W - 1);
  assert.equal(world.wrap(W + 2), 2);
  assert.equal(world.idx(-1, -1), (W - 1) * W + (W - 1));
  assert.equal(world.delta(0, W - 1), -1);
  assert.equal(world.delta(W - 1, 0), 1);
  assert.equal(world.dist(0, 0, W - 1, 0), 1);
  assert.equal(world.dist2(0, 0, W - 1, W - 1), 2);
  assert.equal(world.dist2(1, 1, 1023, 1023), 8);
});

test('World get() and set() correctly handle out-of-bounds coordinates via toroidal wrap', () => {
  const world = new World();
  const testVal = Cell.WALL;

  // Set at normalized coords
  world.set(W - 1, W - 1, testVal);
  world.set(0, 0, Cell.WATER);

  // Get via out of bounds negative coords
  assert.equal(world.get(-1, -1), testVal);

  // Get via out of bounds large coords
  assert.equal(world.get(W, W), Cell.WATER);

  // Set via out of bounds negative coords
  world.set(-2, -2, Cell.DOOR);
  assert.equal(world.get(W - 2, W - 2), Cell.DOOR);

  // Set via out of bounds large coords
  world.set(W + 5, W + 5, Cell.LIFT);
  assert.equal(world.get(5, 5), Cell.LIFT);
});

test('World solid() respects door states and passable cells', () => {
  const world = new World();
  const i = world.idx(10, 10);

  world.cells[i] = Cell.FLOOR;
  assert.equal(world.solid(10, 10), false);

  world.cells[i] = Cell.WATER;
  assert.equal(world.solid(10, 10), false);

  world.cells[i] = Cell.DOOR;
  world.doors.set(i, { idx: i, state: DoorState.CLOSED, roomA: -1, roomB: -1, keyId: '', timer: 0 });
  assert.equal(world.solid(10, 10), true);

  world.doors.get(i)!.state = DoorState.OPEN;
  assert.equal(world.solid(10, 10), false);

  world.doors.get(i)!.state = DoorState.LOCKED;
  assert.equal(world.solid(10, 10), true);

  world.doors.get(i)!.state = DoorState.HERMETIC_OPEN;
  assert.equal(world.solid(10, 10), false);

  world.doors.get(i)!.state = DoorState.HERMETIC_CLOSED;
  assert.equal(world.solid(10, 10), true);

  world.cells[i] = Cell.LIFT;
  assert.equal(world.solid(10, 10), true);
});

test('reachability audit classifies door gates, water, and lift adjacency', () => {
  const world = new World();
  const start = world.idx(10, 10);
  const closedDoor = world.idx(11, 10);
  const lockedDoor = world.idx(12, 10);
  const keyRoom = world.idx(13, 10);
  const hermeticDoor = world.idx(10, 11);
  const hermeticRoom = world.idx(10, 12);
  const water = world.idx(9, 10);
  const lift = world.idx(9, 11);
  const isolated = world.idx(30, 30);
  const missingDoor = world.idx(30, 31);

  world.cells[start] = Cell.FLOOR;
  world.cells[closedDoor] = Cell.DOOR;
  world.doors.set(closedDoor, { idx: closedDoor, state: DoorState.CLOSED, roomA: -1, roomB: -1, keyId: '', timer: 0 });
  world.cells[lockedDoor] = Cell.DOOR;
  world.doors.set(lockedDoor, { idx: lockedDoor, state: DoorState.LOCKED, roomA: -1, roomB: -1, keyId: 'service_key', timer: 0 });
  world.cells[keyRoom] = Cell.FLOOR;
  world.cells[hermeticDoor] = Cell.DOOR;
  world.doors.set(hermeticDoor, { idx: hermeticDoor, state: DoorState.HERMETIC_CLOSED, roomA: -1, roomB: -1, keyId: '', timer: 0 });
  world.cells[hermeticRoom] = Cell.FLOOR;
  world.cells[water] = Cell.WATER;
  world.cells[lift] = Cell.LIFT;
  world.cells[isolated] = Cell.FLOOR;
  world.cells[missingDoor] = Cell.DOOR;

  assert.deepEqual(classifyReachabilityCell(world, water), { passable: true, reason: 'water', gateMask: REACH_GATE_NONE });
  assert.deepEqual(classifyReachabilityCell(world, closedDoor), { passable: true, reason: 'door_closed', gateMask: REACH_GATE_NONE });
  assert.deepEqual(classifyReachabilityCell(world, lockedDoor), { passable: true, reason: 'door_locked', gateMask: REACH_GATE_KEY });
  assert.deepEqual(classifyReachabilityCell(world, hermeticDoor), { passable: true, reason: 'door_hermetic_closed', gateMask: REACH_GATE_HERMETIC });
  assert.deepEqual(classifyReachabilityCell(world, lift), { passable: false, reason: 'lift', gateMask: REACH_GATE_NONE });
  assert.deepEqual(classifyReachabilityCell(world, missingDoor), { passable: false, reason: 'door_missing', gateMask: REACH_GATE_NONE });

  const audit = auditReachability(world, start);
  assert.equal(describeReachability(audit, world, start), 'reachable');
  assert.equal(describeReachability(audit, world, keyRoom), 'gated by key');
  assert.equal(describeReachability(audit, world, hermeticRoom), 'gated by hermetic door');
  assert.equal(describeReachability(audit, world, isolated), 'unreachable (open)');
  assert.equal(audit.reachable[lift], 0);
  assert.equal(hasReachableAdjacentCell(world, audit, lift), true);
});

test('World dirty markers are monotonic signed counters', () => {
  const world = new World();
  const wallVersion = world.wallTexVersion;
  const fogVersion = world.fogVersion;

  world.markWallTexDirty();
  world.markFogDirty();

  assert.equal(world.wallTexVersion, (wallVersion + 1) | 0);
  assert.equal(world.fogVersion, (fogVersion + 1) | 0);
});

function carveLightTestFloor(world: World, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      world.cells[world.idx(x, y)] = Cell.FLOOR;
    }
  }
}

function carveLightTestCorridor(world: World, x0: number, y: number, length: number): void {
  for (let x = x0; x < x0 + length; x++) {
    world.cells[world.idx(x, y)] = Cell.FLOOR;
  }
}

test('World bakeLights lights nearby cells without leaking past radius', () => {
  const world = new World();
  const cx = 100;
  const cy = 100;
  carveLightTestFloor(world, cx, cy, 10);
  world.features[world.idx(cx, cy)] = Feature.LAMP;

  world.bakeLights();

  assert.equal(world.light[world.idx(cx, cy)], 1);
  assert.ok(world.light[world.idx(cx + 4, cy)] > 0);
  assert.equal(world.light[world.idx(cx + 9, cy)], 0);
});

test('World bakeLights blocks lamp propagation behind walls', () => {
  const world = new World();
  const cx = 120;
  const cy = 120;
  carveLightTestCorridor(world, cx, cy, 7);
  world.features[world.idx(cx, cy)] = Feature.LAMP;
  const wall = world.idx(cx + 2, cy);
  world.cells[wall] = Cell.WALL;

  world.bakeLights();

  assert.ok(world.light[wall] > 0);
  assert.equal(world.light[world.idx(cx + 4, cy)], 0);
});

test('World bakeLights blocks closed doors and passes open doors', () => {
  const world = new World();
  const cx = 140;
  const cy = 140;
  carveLightTestCorridor(world, cx, cy, 7);
  world.features[world.idx(cx, cy)] = Feature.LAMP;
  const doorIdx = world.idx(cx + 2, cy);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.CLOSED, roomA: -1, roomB: -1, keyId: '', timer: 0 });

  world.bakeLights();

  assert.ok(world.light[doorIdx] > 0);
  assert.equal(world.light[world.idx(cx + 4, cy)], 0);

  world.doors.get(doorIdx)!.state = DoorState.OPEN;
  world.bakeLights();

  assert.ok(world.light[world.idx(cx + 4, cy)] > 0);
});

test('World bakeLights makes candles smaller and weaker than lamps', () => {
  const lampWorld = new World();
  const candleWorld = new World();
  const cx = 160;
  const cy = 160;
  carveLightTestFloor(lampWorld, cx, cy, 10);
  carveLightTestFloor(candleWorld, cx, cy, 10);
  lampWorld.features[lampWorld.idx(cx, cy)] = Feature.LAMP;
  candleWorld.features[candleWorld.idx(cx, cy)] = Feature.CANDLE;

  lampWorld.bakeLights();
  candleWorld.bakeLights();

  assert.equal(lampWorld.light[lampWorld.idx(cx, cy)], 1);
  assert.ok(candleWorld.light[candleWorld.idx(cx, cy)] < lampWorld.light[lampWorld.idx(cx, cy)]);
  assert.ok(candleWorld.light[candleWorld.idx(cx + 4, cy)] > 0);
  assert.equal(candleWorld.light[candleWorld.idx(cx + 6, cy)], 0);
});
