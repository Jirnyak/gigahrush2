import test from 'node:test';
import assert from 'node:assert/strict';

import { Cell, DoorState, ProjType, W } from '../src/core/types';
import { World } from '../src/core/world';
import { clearParticles, particles, spawnBloodHit, spawnDustBurst, spawnProjectileWallImpact, updateParticles } from '../src/render/blood';
import { traceFirstSolidCell } from '../src/systems/local_space';
import { MarkType, stampMark } from '../src/systems/surface_marks';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function approx(actual: number, expected: number, epsilon = 0.000001): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} ~= ${expected}`);
}

test('local solid trace hits the first wall cell along a horizontal segment', () => {
  const world = openWorld();
  world.set(15, 10, Cell.WALL);

  const hit = traceFirstSolidCell(world, 10.5, 10.5, 10, 0);

  assert.ok(hit);
  assert.equal(hit.cellX, 15);
  assert.equal(hit.cellY, 10);
  assert.equal(hit.axis, 'x');
  approx(hit.t, 0.45);
  approx(hit.u, 0.5);
});

test('local solid trace is null when the segment stays in passable cells', () => {
  const world = openWorld();

  const hit = traceFirstSolidCell(world, 10.5, 10.5, 0, 8);

  assert.equal(hit, null);
});

test('local solid trace respects toroidal wrapping', () => {
  const world = openWorld();
  world.set(0, 10, Cell.WALL);

  const hit = traceFirstSolidCell(world, W - 1.5, 10.5, 4, 0);

  assert.ok(hit);
  assert.equal(hit.cellX, 0);
  assert.equal(hit.cellY, 10);
  approx(hit.t, 0.375);
});

test('local solid trace uses World.solid door semantics', () => {
  const world = openWorld();
  const doorIdx = world.idx(15, 10);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, { idx: doorIdx, state: DoorState.OPEN, roomA: -1, roomB: -1, keyId: '', timer: 0 });

  assert.equal(traceFirstSolidCell(world, 10.5, 10.5, 10, 0), null);

  const door = world.doors.get(doorIdx);
  assert.ok(door);
  door.state = DoorState.CLOSED;

  const hit = traceFirstSolidCell(world, 10.5, 10.5, 10, 0);
  assert.ok(hit);
  assert.equal(hit.cellIdx, doorIdx);
});

test('projectile wall impacts use the same surface map and spawn local impact particles', () => {
  clearParticles();
  const world = openWorld();
  world.set(15, 10, Cell.WALL);
  const beforeVersion = world.surfaceVersion;
  const beforeParticles = particles.length;

  spawnProjectileWallImpact(world, 15, 10, 0.5, 0.4, undefined, ProjType.NORMAL, 15, 10.5);

  assert.ok(world.surfaceVersion > beforeVersion);
  assert.ok(world.surfaceMap.has(world.idx(15, 10)));
  assert.ok(particles.length > beforeParticles);
});

test('dust particles expire without persistent surface marks', () => {
  clearParticles();
  const world = openWorld();
  const beforeVersion = world.surfaceVersion;

  spawnDustBurst(world, 10.5, 10.5, 0.1, 12);
  assert.ok(particles.length > 0);
  updateParticles(world, 2);

  assert.equal(particles.length, 0);
  assert.equal(world.surfaceVersion, beforeVersion);
  assert.equal(world.surfaceMap.size, 0);
});

test('blood particles still land as splat marks', () => {
  clearParticles();
  const world = openWorld();

  spawnBloodHit(world, 10.5, 10.5, 0, 1, false, 0, 0, 0.1);
  const afterHitVersion = world.surfaceVersion;
  assert.ok(particles.length > 0);
  updateParticles(world, 1);

  assert.equal(particles.length, 0);
  assert.ok(world.surfaceVersion > afterHitVersion);
});

test('world replacement invalidates transient particles before landing', () => {
  clearParticles();
  const oldWorld = openWorld();
  const newWorld = openWorld();

  spawnDustBurst(oldWorld, 10.5, 10.5, 0.1, 12);
  assert.ok(particles.length > 0);
  updateParticles(newWorld, 0.016);

  assert.equal(particles.length, 0);
  assert.equal(newWorld.surfaceVersion, 0);
  assert.equal(newWorld.surfaceMap.size, 0);
});

test('ordinary wall bullet impacts near tile edges do not spill into neighbor cells', () => {
  const world = openWorld();
  world.set(15, 10, Cell.WALL);
  world.set(14, 10, Cell.WALL);
  world.set(15, 9, Cell.WALL);
  world.set(14, 9, Cell.WALL);

  spawnProjectileWallImpact(world, 15, 10, 0.01, 0.01, undefined, ProjType.NORMAL, 15, 10);

  assert.ok(world.surfaceMap.has(world.idx(15, 10)));
  assert.equal(world.surfaceMap.has(world.idx(14, 10)), false);
  assert.equal(world.surfaceMap.has(world.idx(15, 9)), false);
  assert.equal(world.surfaceMap.has(world.idx(14, 9)), false);
});

test('organic surface marks still spill across floor cell edges', () => {
  const world = openWorld();

  stampMark(world, 20, 20, 0.02, 0.5, 0.35, MarkType.SPLAT, 12003, 140, 10, 10, 220);

  assert.ok(world.surfaceMap.has(world.idx(20, 20)));
  assert.ok(world.surfaceMap.has(world.idx(19, 20)));
});
