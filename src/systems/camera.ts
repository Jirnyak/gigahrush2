/* ── Runtime camera controller ────────────────────────────────── */
/* Camera modes are visual runtime state. They resolve to a small
 * CameraView for render; they do not mutate gameplay ownership. */

import { W } from '../core/types';
import { World } from '../core/world';
import { bfsPath, subcellToWorld } from './ai/pathfinding';

export type CameraMode = 'player' | 'free' | 'death' | 'trailer' | 'cinematic';

export interface CameraSubject {
  x: number;
  y: number;
  angle: number;
  pitch?: number;
  alive?: boolean;
  height?: number;
}

export interface CameraPose {
  x: number;
  y: number;
  angle: number;
  pitch: number;
  height: number;
  fovRadians?: number;
}

export interface CameraView extends CameraPose {
  mode: CameraMode;
  fovRadians: number;
}

export interface TrailerCameraState {
  path: number[];
  targetNodeIndex: number;
  active: boolean;
  time: number;
  angleTarget: number;
  flySpeed: number;
}

export interface CinematicCameraState {
  path: number[][];
  targetNodeIndex: number;
  active: boolean;
  time: number;
  angleTarget: number;
  flySpeed: number;
}

export interface RuntimeCamera {
  mode: CameraMode;
  free: CameraPose;
  bob: CameraBobState;
  trailer?: TrailerCameraState;
  cinematic?: CinematicCameraState;
}

export interface FreeCameraMove {
  forward?: number;
  strafe?: number;
  vertical?: number;
  turn?: number;
  pitch?: number;
  speed?: number;
  turnSpeed?: number;
  pitchSpeed?: number;
  collide?: boolean;
}

interface DeathCameraState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  height: number;
  fx: number;
  fy: number;
  fz: number;
  prevYaw: number;
  timer: number;
  active: boolean;
}

interface CameraBobState {
  phase: number;
  amount: number;
  offset: number;
  lastX: number;
  lastY: number;
  ready: boolean;
}

export const CAMERA_STANDING_HEIGHT = 0.5;
export const CAMERA_DEATH_FLOOR_HEIGHT = 0.12;

const DEFAULT_CAMERA_FOV_RADIANS = Math.PI / 2;
const CAMERA_BOB_STEP_RATE = 9.2;
const CAMERA_BOB_FULL_SPEED = 2.15;
const CAMERA_BOB_HEIGHT = 0.026;
const CAMERA_BOB_MIN_MOVE = 0.001;
const CAMERA_BOB_TELEPORT_DIST = 1.5;
const CAMERA_BOB_RISE = 8.5;
const CAMERA_BOB_FALL = 6;
const CAMERA_BOB_OFFSET_RATE = 16;
const FREE_CAMERA_SPEED = 5.0;
const FREE_CAMERA_TURN_SPEED = 2.5;
const FREE_CAMERA_PITCH_SPEED = 1.6;
const FREE_CAMERA_MIN_HEIGHT = 0.08;
const FREE_CAMERA_MAX_HEIGHT = 8.0;

const DEATH_BALL_RADIUS = 0.2;
const DEATH_FRICTION = 0.65;
const DEATH_BOUNCE = 0.45;
const DEATH_DROP_SPEED = 4.0;
const deathCameraStates = new WeakMap<RuntimeCamera, DeathCameraState>();

function wrapCoord(value: number): number {
  return ((value % W) + W) % W;
}

function clampPitch(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function clampHeight(value: number): number {
  return Math.max(FREE_CAMERA_MIN_HEIGHT, Math.min(FREE_CAMERA_MAX_HEIGHT, value));
}

export function createRuntimeCamera(): RuntimeCamera {
  return {
    mode: 'player',
    free: { x: 0, y: 0, angle: 0, pitch: 0, height: CAMERA_STANDING_HEIGHT },
    bob: createCameraBobState(),
  };
}

export function resetRuntimeCamera(camera: RuntimeCamera): void {
  camera.mode = 'player';
  resetCameraBob(camera.bob);
  deathCameraStates.delete(camera);
}

export function followPlayerCamera(camera: RuntimeCamera): void {
  resetRuntimeCamera(camera);
}

export function setFreeCamera(camera: RuntimeCamera, pose: Partial<CameraPose> & Pick<CameraPose, 'x' | 'y'>): void {
  camera.mode = 'free';
  resetCameraBob(camera.bob);
  deathCameraStates.delete(camera);
  camera.free = {
    x: wrapCoord(pose.x),
    y: wrapCoord(pose.y),
    angle: pose.angle ?? camera.free.angle,
    pitch: clampPitch(pose.pitch ?? camera.free.pitch),
    height: clampHeight(pose.height ?? camera.free.height),
    fovRadians: pose.fovRadians ?? camera.free.fovRadians,
  };
}

export function setFreeCameraFromSubject(camera: RuntimeCamera, subject: CameraSubject, height = CAMERA_STANDING_HEIGHT): void {
  setFreeCamera(camera, {
    x: subject.x,
    y: subject.y,
    angle: subject.angle,
    pitch: subject.pitch ?? 0,
    height,
    fovRadians: camera.free.fovRadians,
  });
}

export function moveFreeCamera(camera: RuntimeCamera, world: World, move: FreeCameraMove, dt: number): void {
  if (camera.mode !== 'free') return;
  const pose = camera.free;
  const turnSpeed = move.turnSpeed ?? FREE_CAMERA_TURN_SPEED;
  const pitchSpeed = move.pitchSpeed ?? FREE_CAMERA_PITCH_SPEED;
  pose.angle += (move.turn ?? 0) * turnSpeed * dt;
  pose.pitch = clampPitch(pose.pitch + (move.pitch ?? 0) * pitchSpeed * dt);
  pose.height = clampHeight(pose.height + (move.vertical ?? 0) * (move.speed ?? FREE_CAMERA_SPEED) * dt);

  const forward = Math.max(-1, Math.min(1, move.forward ?? 0));
  const strafe = Math.max(-1, Math.min(1, move.strafe ?? 0));
  if (forward === 0 && strafe === 0) return;

  const len = Math.sqrt(forward * forward + strafe * strafe);
  const mag = len > 1 ? 1 / len : 1;
  const speed = (move.speed ?? FREE_CAMERA_SPEED) * dt;
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  const nx = wrapCoord(pose.x + (cos * forward - sin * strafe) * mag * speed);
  const ny = wrapCoord(pose.y + (sin * forward + cos * strafe) * mag * speed);
  if (move.collide === true && world.solid(Math.floor(nx), Math.floor(ny))) return;
  pose.x = nx;
  pose.y = ny;
}

export function startDeathCamera(
  camera: RuntimeCamera,
  px: number,
  py: number,
  pAngle: number,
  random: () => number = Math.random,
): void {
  camera.mode = 'death';
  resetCameraBob(camera.bob);
  camera.free = {
    x: wrapCoord(px),
    y: wrapCoord(py),
    angle: pAngle,
    pitch: 0,
    height: CAMERA_STANDING_HEIGHT,
    fovRadians: camera.free.fovRadians,
  };
  deathCameraStates.set(camera, createDeathCameraState(px, py, pAngle, random));
}

export function startCinematicCamera(
  camera: RuntimeCamera,
  px: number,
  py: number,
  waypoints: number[][],
): void {
  camera.mode = 'cinematic';
  resetCameraBob(camera.bob);
  camera.free = {
    x: wrapCoord(px),
    y: wrapCoord(py),
    angle: 0,
    pitch: 0,
    height: CAMERA_STANDING_HEIGHT,
    fovRadians: camera.free.fovRadians,
  };
  camera.cinematic = {
    path: waypoints,
    targetNodeIndex: 0,
    active: true,
    time: 0,
    angleTarget: 0,
    flySpeed: 2.5,
  };
}

export function updateCinematicCamera(camera: RuntimeCamera, world: World, dt: number): void {
  if (camera.mode !== 'cinematic' || !camera.cinematic) return;
  const ts = camera.cinematic;
  ts.time += dt;
  ts.flySpeed = 4.0;

  if (ts.path.length === 0 || ts.targetNodeIndex >= ts.path.length) {
    camera.mode = 'player';
    return;
  }

  while (ts.targetNodeIndex < ts.path.length) {
    const waypoint = ts.path[ts.targetNodeIndex];
    const tx = waypoint[0];
    const ty = waypoint[1];
    const dx = world.delta(camera.free.x, tx);
    const dy = world.delta(camera.free.y, ty);
    const dist2 = dx * dx + dy * dy;

    if (dist2 < 0.64) {
      ts.targetNodeIndex++;
    } else {
      ts.angleTarget = Math.atan2(dy, dx);
      break;
    }
  }

  if (ts.targetNodeIndex >= ts.path.length) {
    camera.mode = 'player';
    return;
  }

  let vx = Math.cos(camera.free.angle) * ts.flySpeed * dt;
  let vy = Math.sin(camera.free.angle) * ts.flySpeed * dt;

  const nx = wrapCoord(camera.free.x + vx);
  const ny = wrapCoord(camera.free.y + vy);

  camera.free.x = nx;
  camera.free.y = ny;

  let diff = ts.angleTarget - camera.free.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  camera.free.angle += diff * Math.min(1, dt * 6.0);

  camera.free.height = CAMERA_STANDING_HEIGHT + Math.sin(ts.time * 0.7) * 0.15;
  camera.free.pitch = Math.sin(ts.time * 1.1) * 0.1;
}

export function startTrailerCamera(
  camera: RuntimeCamera,
  px: number,
  py: number,
): void {
  camera.mode = 'trailer';
  resetCameraBob(camera.bob);
  camera.free = {
    x: wrapCoord(px),
    y: wrapCoord(py),
    angle: 0,
    pitch: 0,
    height: CAMERA_STANDING_HEIGHT,
    fovRadians: camera.free.fovRadians,
  };
  camera.trailer = {
    path: [],
    targetNodeIndex: 0,
    active: true,
    time: 0,
    angleTarget: 0,
    flySpeed: 2.5,
  };
}

function findNewTrailerTarget(world: World, cx: number, cy: number): { x: number; y: number } | null {
  for (let i = 0; i < 50; i++) {
    const rx = Math.floor(Math.random() * W);
    const ry = Math.floor(Math.random() * W);
    if (!world.solid(rx, ry)) {
      const dx = world.delta(cx, rx);
      const dy = world.delta(cy, ry);
      if (Math.sqrt(dx * dx + dy * dy) > 10) return { x: rx, y: ry };
    }
  }
  return null;
}

export function updateTrailerCamera(camera: RuntimeCamera, world: World, dt: number): void {
  if (camera.mode !== 'trailer' || !camera.trailer) return;
  const ts = camera.trailer;
  ts.time += dt;
  ts.flySpeed = 4.0; // Cinematic flight (not too fast to avoid wide orbits)

  // Path navigation
  if (ts.path.length === 0 || ts.targetNodeIndex >= ts.path.length) {
    const target = findNewTrailerTarget(world, camera.free.x, camera.free.y);
    if (target) {
      ts.path = bfsPath(world, camera.free.x, camera.free.y, target.x, target.y);
      ts.targetNodeIndex = 0;
    } else {
      ts.path = [];
    }
  }

  // Follow the path
  while (ts.targetNodeIndex < ts.path.length) {
    const [tx, ty] = subcellToWorld(ts.path[ts.targetNodeIndex]);
    const dx = world.delta(camera.free.x, tx);
    const dy = world.delta(camera.free.y, ty);
    const dist2 = dx * dx + dy * dy;
    
    if (dist2 < 0.64) {
      // Consume the node if we are within 0.8 units radius. This tight radius prevents corner cutting
      // and forces the camera to naturally stay in the center of corridors.
      ts.targetNodeIndex++;
    } else {
      // Calculate required angle to the next valid node
      ts.angleTarget = Math.atan2(dy, dx);
      break;
    }
  }

  // Calculate forward velocity based on camera's current viewing angle
  let vx = Math.cos(camera.free.angle) * ts.flySpeed * dt;
  let vy = Math.sin(camera.free.angle) * ts.flySpeed * dt;
  
  const nx = wrapCoord(camera.free.x + vx);
  const ny = wrapCoord(camera.free.y + vy);

  // Noclip: directly apply velocity without solid checks
  camera.free.x = nx;
  camera.free.y = ny;

  // Smoothly interpolate angle (fast enough to not overshoot tight corners)
  let diff = ts.angleTarget - camera.free.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  camera.free.angle += diff * Math.min(1, dt * 6.0);

  // Cinematic bob and pitch
  camera.free.height = CAMERA_STANDING_HEIGHT + Math.sin(ts.time * 0.7) * 0.15;
  camera.free.pitch = Math.sin(ts.time * 1.1) * 0.1;
}

export function updateRuntimeCamera(camera: RuntimeCamera, world: World, dt: number, subject?: CameraSubject): void {
  const deathCamera = deathCameraStates.get(camera);
  if (camera.mode === 'death' && deathCamera) updateDeathCamera(deathCamera, world, dt);
  if (camera.mode === 'player' && subject) updatePlayerCameraBob(camera.bob, world, subject, dt);
  if (camera.mode === 'trailer') updateTrailerCamera(camera, world, dt);
  if (camera.mode === 'cinematic') updateCinematicCamera(camera, world, dt);
}

export function runtimeCameraView(camera: RuntimeCamera, subject: CameraSubject, fovRadians = DEFAULT_CAMERA_FOV_RADIANS): CameraView {
  const deathCamera = deathCameraStates.get(camera);
  if (camera.mode === 'death' && deathCamera) {
    return {
      mode: 'death',
      x: deathCamera.x,
      y: deathCamera.y,
      angle: deathCameraAngle(deathCamera),
      pitch: deathCameraPitch(deathCamera),
      height: deathCamera.height,
      fovRadians,
    };
  }
  if (camera.mode === 'free' || camera.mode === 'trailer' || camera.mode === 'cinematic') {
    return { mode: camera.mode, ...camera.free, fovRadians: camera.free.fovRadians ?? fovRadians };
  }
  return {
    mode: 'player',
    x: subject.x,
    y: subject.y,
    angle: subject.angle,
    pitch: subject.pitch ?? 0,
    height: playerCameraHeight(camera.bob, subject),
    fovRadians,
  };
}

function createCameraBobState(): CameraBobState {
  return { phase: 0, amount: 0, offset: 0, lastX: 0, lastY: 0, ready: false };
}

function resetCameraBob(bob: CameraBobState): void {
  bob.phase = 0;
  bob.amount = 0;
  bob.offset = 0;
  bob.lastX = 0;
  bob.lastY = 0;
  bob.ready = false;
}

function updatePlayerCameraBob(bob: CameraBobState, world: World, subject: CameraSubject, dt: number): void {
  const sx = wrapCoord(subject.x);
  const sy = wrapCoord(subject.y);
  if (!bob.ready || dt <= 0) {
    bob.lastX = sx;
    bob.lastY = sy;
    bob.ready = true;
    return;
  }

  const dx = world.delta(bob.lastX, sx);
  const dy = world.delta(bob.lastY, sy);
  const dist = Math.sqrt(dx * dx + dy * dy);
  bob.lastX = sx;
  bob.lastY = sy;

  if (dist > CAMERA_BOB_TELEPORT_DIST || subject.alive === false) {
    bob.amount = approach(bob.amount, 0, CAMERA_BOB_FALL, dt);
    bob.offset = approach(bob.offset, 0, CAMERA_BOB_OFFSET_RATE, dt);
    return;
  }

  const speed = dist / Math.max(0.001, dt);
  const speedFrac = Math.min(1, speed / CAMERA_BOB_FULL_SPEED);
  const target = dist > CAMERA_BOB_MIN_MOVE ? speedFrac * speedFrac : 0;
  bob.amount = approach(bob.amount, target, target > bob.amount ? CAMERA_BOB_RISE : CAMERA_BOB_FALL, dt);
  if (target > 0 || bob.amount > 0.001) {
    bob.phase = (bob.phase + dt * CAMERA_BOB_STEP_RATE) % (Math.PI * 2);
  }
  if (bob.amount < 0.0005) bob.amount = 0;
  bob.offset = approach(bob.offset, Math.sin(bob.phase) * CAMERA_BOB_HEIGHT * bob.amount, CAMERA_BOB_OFFSET_RATE, dt);
}

function approach(current: number, target: number, rate: number, dt: number): number {
  const t = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt));
  return current + (target - current) * t;
}

function playerCameraHeight(bob: CameraBobState, subject?: CameraSubject): number {
  let baseHeight = CAMERA_STANDING_HEIGHT;
  if (subject && subject.height !== undefined) {
    baseHeight = CAMERA_STANDING_HEIGHT * (subject.height / 1.8);
  }
  return baseHeight + bob.offset;
}

function createDeathCameraState(px: number, py: number, pAngle: number, random: () => number): DeathCameraState {
  const spreadAngle = pAngle + (random() - 0.5) * Math.PI * 0.8;
  const launchSpeed = 2.0 + random() * 2.5;
  const tilt = -0.3;
  const h = Math.sqrt(1 - tilt * tilt);

  return {
    x: wrapCoord(px),
    y: wrapCoord(py),
    vx: Math.cos(spreadAngle) * launchSpeed,
    vy: Math.sin(spreadAngle) * launchSpeed,
    height: CAMERA_STANDING_HEIGHT,
    fx: Math.cos(pAngle) * h,
    fy: Math.sin(pAngle) * h,
    fz: tilt,
    prevYaw: pAngle,
    timer: 0,
    active: true,
  };
}

function rotateVec(
  vx: number, vy: number, vz: number,
  kx: number, ky: number, kz: number,
  theta: number,
): [number, number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const dot = kx * vx + ky * vy + kz * vz;
  const cx = ky * vz - kz * vy;
  const cy = kz * vx - kx * vz;
  const cz = kx * vy - ky * vx;
  return [
    vx * c + cx * s + kx * dot * (1 - c),
    vy * c + cy * s + ky * dot * (1 - c),
    vz * c + cz * s + kz * dot * (1 - c),
  ];
}

function updateDeathCamera(dc: DeathCameraState, world: World, dt: number): void {
  if (!dc.active) return;
  dc.timer += dt;

  if (dc.height > CAMERA_DEATH_FLOOR_HEIGHT) {
    dc.height = Math.max(CAMERA_DEATH_FLOOR_HEIGHT, dc.height - DEATH_DROP_SPEED * dt);
  }

  const speed = Math.sqrt(dc.vx * dc.vx + dc.vy * dc.vy);
  if (speed < 0.04 && dc.timer > 0.5) {
    dc.vx = 0;
    dc.vy = 0;
    return;
  }

  const decay = Math.pow(DEATH_FRICTION, dt);
  dc.vx *= decay;
  dc.vy *= decay;

  if (speed > 0.01) {
    const ax = -dc.vy / speed;
    const ay = dc.vx / speed;
    const theta = (speed * dt) / DEATH_BALL_RADIUS;
    const [nx, ny, nz] = rotateVec(dc.fx, dc.fy, dc.fz, ax, ay, 0, theta);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    dc.fx = nx / len;
    dc.fy = ny / len;
    dc.fz = nz / len;
  }

  const wxO = Math.floor(wrapCoord(dc.x));
  const wyO = Math.floor(wrapCoord(dc.y));
  let hitX = false;
  let hitY = false;

  const offX = dc.vx > 0 ? DEATH_BALL_RADIUS : -DEATH_BALL_RADIUS;
  const offY = dc.vy > 0 ? DEATH_BALL_RADIUS : -DEATH_BALL_RADIUS;
  const nxPos = dc.x + dc.vx * dt;
  const nyPos = dc.y + dc.vy * dt;

  const cxCheck = Math.floor(wrapCoord(nxPos + offX));
  if (world.solid(cxCheck, wyO)) {
    dc.vx = -dc.vx * DEATH_BOUNCE;
    hitX = true;
  }

  const cyCheck = Math.floor(wrapCoord(nyPos + offY));
  if (world.solid(wxO, cyCheck)) {
    dc.vy = -dc.vy * DEATH_BOUNCE;
    hitY = true;
  }

  if (!hitX && !hitY) {
    const cxD = Math.floor(wrapCoord(nxPos + offX));
    const cyD = Math.floor(wrapCoord(nyPos + offY));
    if (world.solid(cxD, cyD)) {
      dc.vx = -dc.vx * DEATH_BOUNCE;
      dc.vy = -dc.vy * DEATH_BOUNCE;
    }
  }

  dc.x = wrapCoord(dc.x + dc.vx * dt);
  dc.y = wrapCoord(dc.y + dc.vy * dt);
}

function deathCameraAngle(dc: DeathCameraState): number {
  const raw = Math.atan2(dc.fy, dc.fx);
  const xyLen = Math.sqrt(dc.fx * dc.fx + dc.fy * dc.fy);
  const t = Math.min(1, xyLen / 0.4);
  let diff = raw - dc.prevYaw;
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  dc.prevYaw += diff * t;
  return dc.prevYaw;
}

function deathCameraPitch(dc: DeathCameraState): number {
  return clampPitch(dc.fz);
}
