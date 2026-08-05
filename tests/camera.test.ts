import test from 'node:test';
import assert from 'node:assert/strict';
import * as cameraApi from '../src/systems/camera';
import {
  CAMERA_DEATH_FLOOR_HEIGHT,
  CAMERA_STANDING_HEIGHT,
  createRuntimeCamera,
  moveFreeCamera,
  resetRuntimeCamera,
  runtimeCameraView,
  setFreeCameraFromSubject,
  startDeathCamera,
  updateRuntimeCamera,
} from '../src/systems/camera';
import { Cell, W } from '../src/core/types';
import { World } from '../src/core/world';
import { makeTestPlayer } from './helpers';

function openWorld(): World {
  const world = new World();
  world.cells.fill(Cell.FLOOR);
  return world;
}

function rng(values: readonly number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0.5;
}

test('runtime camera follows the controlled actor by default', () => {
  const camera = createRuntimeCamera();
  const player = makeTestPlayer({ x: 12.5, y: 20.25, angle: 1.2, pitch: -0.2 });
  let view = runtimeCameraView(camera, player, 1.1);

  assert.equal(view.mode, 'player');
  assert.equal(view.x, player.x);
  assert.equal(view.y, player.y);
  assert.equal(view.angle, player.angle);
  assert.equal(view.pitch, player.pitch);
  assert.equal(view.height, CAMERA_STANDING_HEIGHT);
  assert.equal(view.fovRadians, 1.1);

  player.x = 44;
  player.y = 55;
  player.angle = -0.4;
  player.pitch = 0.3;
  view = runtimeCameraView(camera, player, 0.9);

  assert.equal(view.x, 44);
  assert.equal(view.y, 55);
  assert.equal(view.angle, -0.4);
  assert.equal(view.pitch, 0.3);
  assert.equal(view.fovRadians, 0.9);
});

test('runtime player camera adds bounded inertial head bob from real movement', () => {
  const camera = createRuntimeCamera();
  const world = openWorld();
  const player = makeTestPlayer({ x: 12, y: 20, angle: 1.2, pitch: -0.1, alive: true });

  updateRuntimeCamera(camera, world, 1 / 60, player);
  for (let i = 0; i < 10; i++) {
    player.x += 0.034;
    updateRuntimeCamera(camera, world, 1 / 60, player);
  }
  const view = runtimeCameraView(camera, player);

  assert.equal(view.mode, 'player');
  assert.equal(view.x, player.x);
  assert.equal(view.y, player.y);
  assert.equal(view.angle, player.angle);
  assert.equal(view.pitch, player.pitch);
  assert.equal(view.height !== CAMERA_STANDING_HEIGHT, true);
  assert.equal(Math.abs(view.height - CAMERA_STANDING_HEIGHT) > 0.006, true);
  assert.equal(Math.abs(view.height - CAMERA_STANDING_HEIGHT) < 0.035, true);
});

test('free camera moves without mutating the controlled actor', () => {
  const camera = createRuntimeCamera();
  const world = openWorld();
  const player = makeTestPlayer({ x: 100, y: 100, angle: Math.PI / 2, pitch: 0.1 });

  setFreeCameraFromSubject(camera, player);
  moveFreeCamera(camera, world, { forward: 1, strafe: 1, vertical: 1, turn: 1, pitch: -1, speed: 2 }, 0.5);
  const view = runtimeCameraView(camera, player, 1.2);

  assert.equal(view.mode, 'free');
  assert.notEqual(view.x, player.x);
  assert.notEqual(view.y, player.y);
  assert.notEqual(view.angle, player.angle);
  assert.equal(player.x, 100);
  assert.equal(player.y, 100);
  assert.equal(player.angle, Math.PI / 2);
  assert.equal(view.fovRadians, 1.2);

  resetRuntimeCamera(camera);
  assert.equal(runtimeCameraView(camera, player).mode, 'player');
});

test('death camera captures actor transform and stops following later actor movement', () => {
  const camera = createRuntimeCamera();
  const world = openWorld();
  const player = makeTestPlayer({ x: 30, y: 40, angle: 0, pitch: 0 });

  startDeathCamera(camera, player.x, player.y, player.angle, rng([0.5, 0.5]));
  player.x = 300;
  player.y = 400;
  updateRuntimeCamera(camera, world, 0.1);
  const view = runtimeCameraView(camera, player);

  assert.equal(view.mode, 'death');
  assert.notEqual(view.x, player.x);
  assert.notEqual(view.y, player.y);
  assert.equal(Number.isFinite(view.angle), true);
  assert.equal(Number.isFinite(view.pitch), true);
  assert.equal(Number.isFinite(view.height), true);
});

test('death camera drops to floor height and clamps there', () => {
  const camera = createRuntimeCamera();
  const world = openWorld();
  const player = makeTestPlayer({ x: 10, y: 10, angle: 0 });

  startDeathCamera(camera, player.x, player.y, player.angle, rng([0.5, 0.5]));
  updateRuntimeCamera(camera, world, 1);
  const view = runtimeCameraView(camera, player);

  assert.equal(view.height, CAMERA_DEATH_FLOOR_HEIGHT);
});

test('death camera bounces from solid world cells', () => {
  const camera = createRuntimeCamera();
  const world = openWorld();
  world.cells[world.idx(11, 10)] = Cell.WALL;
  const player = makeTestPlayer({ x: 10.6, y: 10.5, angle: 0 });

  startDeathCamera(camera, player.x, player.y, player.angle, rng([0.5, 0.5]));
  updateRuntimeCamera(camera, world, 0.2);
  const view = runtimeCameraView(camera, player);

  assert.equal(view.mode, 'death');
  assert.equal(view.x < player.x, true);
});

test('death camera wraps toroidal coordinates', () => {
  const camera = createRuntimeCamera();
  const world = openWorld();
  const player = makeTestPlayer({ x: W - 0.1, y: 12.5, angle: 0 });

  startDeathCamera(camera, player.x, player.y, player.angle, rng([0.5, 0.5]));
  updateRuntimeCamera(camera, world, 0.1);
  const view = runtimeCameraView(camera, player);

  assert.equal(view.x >= 0, true);
  assert.equal(view.x < W, true);
  assert.equal(view.x < 1, true);
});

test('camera module does not expose old death camera entry points', () => {
  const camera = createRuntimeCamera();
  startDeathCamera(camera, 1, 1, 0, rng([0.5, 0.5]));
  assert.equal('death' in camera, false);
  assert.equal('DeathCam' in cameraApi, false);
  assert.equal('initDeathCam' in cameraApi, false);
  assert.equal('updateDeathCam' in cameraApi, false);
  assert.equal('getDeathCamAngle' in cameraApi, false);
  assert.equal('getDeathCamPitch' in cameraApi, false);
});
