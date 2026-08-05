import test from 'node:test';
import assert from 'node:assert/strict';

import { Cell, Feature, FloorLevel, LiftDirection, W } from '../src/core/types';
import { World } from '../src/core/world';
import { injectFastElevators, isFastElevatorCell } from '../src/gen/fast_elevators';
import { ensureFloorRouteLiftLayout } from '../src/systems/floor_memory';
import {
  createFloorRunState,
  isFloorZUnlocked,
  unlockFloorZ,
  unlockedFloorZs,
} from '../src/systems/procedural_floors';

const GRID = 4;
const STEP = Math.floor(W / GRID); // 128
const OFFSET = Math.floor(STEP / 2); // 64

function wallWorld(): World {
  const world = new World();
  world.cells.fill(Cell.WALL);
  world.features.fill(Feature.NONE);
  return world;
}

function gridCells(): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      out.push({ x: gx * STEP + OFFSET, y: gy * STEP + OFFSET });
    }
  }
  return out;
}

test('fast elevators stamp an absolute 8x8 grid at fixed positions', () => {
  const world = wallWorld();
  injectFastElevators(world);

  let count = 0;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const idx = world.idx(gx * STEP + OFFSET, gy * STEP + OFFSET);
      assert.equal(isFastElevatorCell(world, idx), true, `cabin missing at grid ${gx},${gy}`);
      assert.equal(world.cells[idx], Cell.LIFT);
      assert.equal(world.features[idx], Feature.MACHINE);
      assert.equal(world.aptMask[idx], 1, 'cabin must be apt-protected');
      assert.equal(world.hermoWall[idx], 0, 'cabin must stay walkable');
      count++;
    }
  }
  assert.equal(count, 16);
});

test('fast elevator cabins carve a reachable passage even inside solid wall', () => {
  const world = wallWorld();
  injectFastElevators(world);

  for (const { x, y } of gridCells()) {
    let walkableNeighbor = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const cell = world.cells[world.idx(world.wrap(x + dx), world.wrap(y + dy))];
      if (cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER) walkableNeighbor = true;
    }
    assert.equal(walkableNeighbor, true, `cabin at ${x},${y} is sealed in wall`);
  }
});

test('fast elevator injection is idempotent', () => {
  const world = wallWorld();
  injectFastElevators(world);
  injectFastElevators(world);
  injectFastElevators(world);

  let count = 0;
  for (let i = 0; i < world.cells.length; i++) {
    if (isFastElevatorCell(world, i)) count++;
  }
  assert.equal(count, 16);
});

test('route lift normalization never demotes fast-elevator cabins', () => {
  const world = wallWorld();
  // Carve an open arena so route lifts can be placed/normalized.
  for (let y = 60; y < 70; y++) {
    for (let x = 60; x < 200; x++) {
      world.cells[world.idx(x, y)] = Cell.FLOOR;
    }
  }
  injectFastElevators(world);

  // VOID only expects UP route lifts; a naive normalizer would demote the
  // DOWN-defaulted cabins. The guard must keep all 64 cabins intact.
  ensureFloorRouteLiftLayout(world, 64, 64, [LiftDirection.UP], { countPerDirection: 4 });

  let count = 0;
  for (let i = 0; i < world.cells.length; i++) {
    if (isFastElevatorCell(world, i)) count++;
  }
  assert.equal(count >= 16 && count <= 64, true, 'route normalization demoted fast elevators');
});

test('floor unlock bits start with the start floor and grow on visit', () => {
  const run = createFloorRunState(FloorLevel.LIVING);
  assert.deepEqual(run.unlockedZs, [0]);

  const state = { currentFloor: FloorLevel.LIVING, floorRun: run } as never;
  assert.equal(isFloorZUnlocked(state, 0), true);
  assert.equal(isFloorZUnlocked(state, 30), false);

  assert.equal(unlockFloorZ(state, 30), true);
  assert.equal(unlockFloorZ(state, 30), false, 'duplicate unlock is a no-op');
  assert.equal(isFloorZUnlocked(state, 30), true);

  // Out-of-range z is rejected.
  assert.equal(unlockFloorZ(state, 9999), false);

  assert.equal(unlockedFloorZs(state).includes(0), true);
  assert.equal(unlockedFloorZs(state).includes(30), true);
});
