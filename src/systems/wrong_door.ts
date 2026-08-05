/* ── Maronary wrong-door one-shot remap ───────────────────────── */

import { stampSurfaceSplat } from './surface_marks';
import { W, Cell, DoorState, type Entity, type GameState } from '../core/types';
import { World } from '../core/world';
import { publishEvent } from './events';
import { getCurrentPlayerEntity } from './player_actor';
import { territoryOwnerAtIndex } from './territory';

export { ContainerKind, Faction, FloorLevel, Occupation } from '../core/types';

export const WRONG_DOOR_MIN_DIST2 = 18 * 18;
export const WRONG_DOOR_MAX_DIST2 = 96 * 96;

const WRONG_DOOR_SOURCE_RADIUS2 = 30 * 30;
const WRONG_DOOR_TTL = 72;
const WRONG_DOOR_USED_COOLDOWN = 180;
const WRONG_DOOR_EXPIRE_COOLDOWN = 45;
const WRONG_DOOR_TARGET_DOOR_TIMER = 18;
const WRONG_DOOR_MAX_SOURCES = 10;
const WRONG_DOOR_WAIT_THRESHOLD = 12;

export interface WrongDoorRouteOption {
  sourceIdx: number;
  targetIdx: number;
  targetDoorIdx: number;
  sourceRoomId: number;
  targetRoomId: number;
  distance2: number;
  sourceDist2: number;
  targetDanger: number;
}

export interface WrongDoorMapCue {
  id: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  expiresAt: number;
}

interface WrongDoorRemap {
  id: number;
  sourceIdx: number;
  targetIdx: number;
  targetDoorIdx: number;
  sourceRoomId: number;
  targetRoomId: number;
  createdAt: number;
  expiresAt: number;
  reason: string;
}

interface WrongDoorStore {
  nextId: number;
  remaps: WrongDoorRemap[];
  cooldownUntil: number;
}

interface SourceDoor {
  idx: number;
  roomId: number;
  dist2: number;
}

interface TargetExit {
  doorIdx: number;
  idx: number;
  roomId: number;
  danger: number;
}

const stores = new WeakMap<World, WrongDoorStore>();

function storeFor(world: World): WrongDoorStore {
  let store = stores.get(world);
  if (!store) {
    store = { nextId: 1, remaps: [], cooldownUntil: -Infinity };
    stores.set(world, store);
  }
  return store;
}

function jitter(seed: number, n: number): number {
  let x = (seed ^ Math.imul(n + 1, 0x9e3779b1)) | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 1000) / 1000;
}

export function isUsableWrongDoorRoute(option: WrongDoorRouteOption): boolean {
  if (option.sourceIdx === option.targetIdx) return false;
  if (option.sourceRoomId >= 0 && option.sourceRoomId === option.targetRoomId) return false;
  return option.distance2 >= WRONG_DOOR_MIN_DIST2 && option.distance2 <= WRONG_DOOR_MAX_DIST2;
}

export function chooseWrongDoorRouteOption(
  options: readonly WrongDoorRouteOption[],
  seed: number,
): WrongDoorRouteOption | null {
  let best: WrongDoorRouteOption | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    if (!isUsableWrongDoorRoute(option)) continue;
    const routeSpan = Math.sqrt(option.distance2);
    const sourceNearness = -Math.sqrt(option.sourceDist2) * 3.5;
    const dangerBias = option.targetDanger * 18;
    const jitterKey = option.sourceIdx
      ^ Math.imul(option.targetIdx + 1, 131)
      ^ Math.imul(option.targetDoorIdx + 1, 977);
    const score = routeSpan + sourceNearness + dangerBias + jitter(seed, jitterKey) * 12;
    if (score > bestScore) {
      bestScore = score;
      best = option;
    }
  }
  return best;
}

export function wrongDoorCueSecondsLeft(cue: Pick<WrongDoorMapCue, 'expiresAt'>, now: number): number {
  return Math.max(0, Math.ceil(cue.expiresAt - now));
}

export function wrongDoorCueActionLabel(cue: Pick<WrongDoorMapCue, 'expiresAt'>, now: number): string {
  const secondsLeft = wrongDoorCueSecondsLeft(cue, now);
  if (secondsLeft <= 0) return 'СБРОШЕНО';
  if (secondsLeft <= WRONG_DOOR_WAIT_THRESHOLD) return 'ЖДИ';
  return 'НЕ ВЕРЬ';
}

function doorRoomId(door: { roomA: number; roomB: number }): number {
  return door.roomA >= 0 ? door.roomA : door.roomB;
}

function canUseDoorState(state: DoorState): boolean {
  return state !== DoorState.LOCKED && state !== DoorState.HERMETIC_CLOSED;
}

function canUseWrongDoorCell(world: World, idx: number): boolean {
  if (world.cells[idx] !== Cell.DOOR || world.aptMask[idx] || world.hermoWall[idx]) return false;
  const door = world.doors.get(idx);
  return !!door && canUseDoorState(door.state);
}

function isFloorExit(world: World, idx: number): boolean {
  return world.cells[idx] === Cell.FLOOR && world.aptMask[idx] === 0;
}

function targetDanger(world: World, idx: number): number {
  let danger = world.fog[idx] > 40 ? 2 : 0;
  const owner = territoryOwnerAtIndex(world, idx);
  if (owner > 2) danger++;
  return danger;
}

function sourceDoorAt(world: World, idx: number, originX: number, originY: number): SourceDoor | null {
  const door = world.doors.get(idx);
  if (!door || !canUseWrongDoorCell(world, idx)) return null;
  return {
    idx,
    roomId: doorRoomId(door),
    dist2: world.dist2(Math.floor(originX), Math.floor(originY), idx % W, (idx / W) | 0),
  };
}

function collectSourceDoors(world: World, originX: number, originY: number, preferredSourceIdx?: number): SourceDoor[] {
  if (preferredSourceIdx !== undefined) {
    const preferred = sourceDoorAt(world, preferredSourceIdx, originX, originY);
    if (preferred) return [preferred];
  }
  const out: SourceDoor[] = [];
  const ox = Math.floor(originX);
  const oy = Math.floor(originY);
  for (const [idx] of world.doors) {
    if (!canUseWrongDoorCell(world, idx)) continue;
    const door = world.doors.get(idx);
    if (!door) continue;
    const x = idx % W;
    const y = (idx / W) | 0;
    const dist2 = world.dist2(ox, oy, x, y);
    out.push({ idx, roomId: doorRoomId(door), dist2 });
  }
  out.sort((a, b) => a.dist2 - b.dist2 || a.idx - b.idx);
  const near = out.filter(source => source.dist2 <= WRONG_DOOR_SOURCE_RADIUS2);
  return (near.length > 0 ? near : out).slice(0, WRONG_DOOR_MAX_SOURCES);
}

function collectTargetExits(world: World): TargetExit[] {
  const out: TargetExit[] = [];
  const dirs = [-1, 1, -W, W];
  for (const [doorIdx] of world.doors) {
    if (!canUseWrongDoorCell(world, doorIdx)) continue;
    for (const d of dirs) {
      const idx = world.wrap((doorIdx % W) + (d === -1 ? -1 : d === 1 ? 1 : 0))
        + world.wrap(((doorIdx / W) | 0) + (d === -W ? -1 : d === W ? 1 : 0)) * W;
      if (!isFloorExit(world, idx)) continue;
      out.push({
        doorIdx,
        idx,
        roomId: world.roomMap[idx],
        danger: targetDanger(world, idx),
      });
    }
  }
  return out;
}

function routeOptions(
  world: World,
  originX: number,
  originY: number,
  preferredSourceIdx?: number,
): WrongDoorRouteOption[] {
  const sources = collectSourceDoors(world, originX, originY, preferredSourceIdx);
  if (sources.length === 0) return [];
  const targets = collectTargetExits(world);
  const out: WrongDoorRouteOption[] = [];
  for (const source of sources) {
    const sx = source.idx % W;
    const sy = (source.idx / W) | 0;
    for (const target of targets) {
      const tx = target.idx % W;
      const ty = (target.idx / W) | 0;
      out.push({
        sourceIdx: source.idx,
        targetIdx: target.idx,
        targetDoorIdx: target.doorIdx,
        sourceRoomId: source.roomId,
        targetRoomId: target.roomId,
        distance2: world.dist2(sx, sy, tx, ty),
        sourceDist2: source.dist2,
        targetDanger: target.danger,
      });
    }
  }
  return out;
}

function remapSeed(state: GameState, originX: number, originY: number): number {
  return (
    Math.floor(state.time * 10)
    ^ Math.imul(state.samosborCount + 1, 4099)
    ^ Math.imul(Math.floor(originX), 131)
    ^ Math.imul(Math.floor(originY), 977)
  ) | 0;
}

function publishWrongDoorEvent(
  world: World,
  state: GameState,
  remap: WrongDoorRemap,
  phase: 'created' | 'used' | 'expired',
  reason: string,
): void {
  const sourceX = remap.sourceIdx % W;
  const sourceY = (remap.sourceIdx / W) | 0;
  const targetX = remap.targetIdx % W;
  const targetY = (remap.targetIdx / W) | 0;
  publishEvent(state, {
    type: 'door_opened',
    zoneId: world.zoneMap[remap.sourceIdx],
    roomId: remap.sourceRoomId >= 0 ? remap.sourceRoomId : undefined,
    x: phase === 'used' ? targetX : sourceX,
    y: phase === 'used' ? targetY : sourceY,
    actorId: 0,
    actorName: 'Вы',
    severity: phase === 'used' ? 5 : phase === 'created' ? 4 : 3,
    privacy: 'local',
    tags: ['samosbor', 'maronary', 'wrong_door', phase, 'door', 'route', 'samosbor_maronary'],
    data: {
      phase,
      reason,
      remapId: remap.id,
      sourceIdx: remap.sourceIdx,
      targetIdx: remap.targetIdx,
      targetDoorIdx: remap.targetDoorIdx,
      sourceRoomId: remap.sourceRoomId,
      targetRoomId: remap.targetRoomId,
      sourceX,
      sourceY,
      targetX,
      targetY,
      expiresIn: Math.max(0, Math.round(remap.expiresAt - state.time)),
      createdAt: remap.createdAt,
      choices: ['distrust_route', 'risk_shortcut'],
      counterplay: phase === 'created'
        ? 'check_door_number_or_wait_for_expiry'
        : phase === 'used'
          ? 'shortcut_taken_once_trace_recorded'
          : 'route_distrusted_or_expired',
    },
  });
}

function removeRemap(world: World, store: WrongDoorStore, remap: WrongDoorRemap): void {
  if (world.anomalyTeleports.get(remap.sourceIdx) === remap.targetIdx) {
    world.anomalyTeleports.delete(remap.sourceIdx);
  }
  const idx = store.remaps.indexOf(remap);
  if (idx >= 0) store.remaps.splice(idx, 1);
}

function expireRemap(world: World, state: GameState, store: WrongDoorStore, remap: WrongDoorRemap, reason: string): void {
  removeRemap(world, store, remap);
  store.cooldownUntil = Math.max(store.cooldownUntil, state.time + WRONG_DOOR_EXPIRE_COOLDOWN);
  publishWrongDoorEvent(world, state, remap, 'expired', reason);
}

function isRemapTopologyValid(world: World, remap: WrongDoorRemap): boolean {
  if (!canUseWrongDoorCell(world, remap.sourceIdx)) return false;
  const targetDoor = world.doors.get(remap.targetDoorIdx);
  if (!targetDoor || !canUseWrongDoorCell(world, remap.targetDoorIdx)) return false;
  return isFloorExit(world, remap.targetIdx);
}

export function updateWrongDoorRemaps(world: World, state: GameState): void {
  const store = stores.get(world);
  if (!store || store.remaps.length === 0) return;
  for (const remap of [...store.remaps]) {
    if (state.time >= remap.expiresAt) {
      expireRemap(world, state, store, remap, 'timeout');
    } else if (!isRemapTopologyValid(world, remap)) {
      expireRemap(world, state, store, remap, 'topology_changed');
    }
  }
}

export function clearWrongDoorRemaps(world: World, state: GameState, reason: string): void {
  const store = stores.get(world);
  if (!store || store.remaps.length === 0) return;
  for (const remap of [...store.remaps]) expireRemap(world, state, store, remap, reason);
}

export function createWrongDoorRemap(
  world: World,
  state: GameState,
  originX: number,
  originY: number,
  reason: string,
  force = false,
  preferredSourceIdx?: number,
): WrongDoorMapCue | null {
  updateWrongDoorRemaps(world, state);
  const store = storeFor(world);
  if (force && store.remaps.length > 0) clearWrongDoorRemaps(world, state, 'debug_replace');
  if (!force && (store.remaps.length > 0 || state.time < store.cooldownUntil)) return null;

  let selected = chooseWrongDoorRouteOption(routeOptions(world, originX, originY, preferredSourceIdx), remapSeed(state, originX, originY));
  if (!selected && preferredSourceIdx !== undefined) {
    selected = chooseWrongDoorRouteOption(routeOptions(world, originX, originY), remapSeed(state, originX, originY));
  }
  if (!selected) return null;

  const remap: WrongDoorRemap = {
    id: store.nextId++,
    sourceIdx: selected.sourceIdx,
    targetIdx: selected.targetIdx,
    targetDoorIdx: selected.targetDoorIdx,
    sourceRoomId: selected.sourceRoomId,
    targetRoomId: selected.targetRoomId,
    createdAt: state.time,
    expiresAt: state.time + WRONG_DOOR_TTL,
    reason,
  };
  store.remaps.push(remap);
  world.anomalyTeleports.set(remap.sourceIdx, remap.targetIdx);

  const sx = remap.sourceIdx % W;
  const sy = (remap.sourceIdx / W) | 0;
  const tx = remap.targetIdx % W;
  const ty = (remap.targetIdx / W) | 0;
  stampSurfaceSplat(world, sx, sy, 0.5, 0.5, 0.42, 0.72, remap.id * 17 + 3, 35, 255, 94, true);
  stampSurfaceSplat(world, tx, ty, 0.5, 0.5, 0.28, 0.55, remap.id * 17 + 7, 35, 255, 94, false);

  publishWrongDoorEvent(world, state, remap, 'created', reason);
  return {
    id: remap.id,
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    expiresAt: remap.expiresAt,
  };
}

export function createMaronaryWrongDoorRemap(
  world: World,
  entities: Entity[],
  state: GameState,
  reason: string,
  preferredSourceIdx?: number,
): boolean {
  const player = getCurrentPlayerEntity(entities);
  const cue = createWrongDoorRemap(world, state, player?.x ?? W / 2, player?.y ?? W / 2, reason, false, preferredSourceIdx);
  return cue !== null;
}

export function debugCreateWrongDoorRemap(world: World, player: Entity, state: GameState): boolean {
  return createWrongDoorRemap(world, state, player.x, player.y, 'debug_force', true) !== null;
}

export function tryUseWrongDoorRemap(world: World, state: GameState, player: Entity): boolean {
  updateWrongDoorRemaps(world, state);
  const store = stores.get(world);
  if (!store || store.remaps.length === 0) return false;
  const from = world.idx(Math.floor(player.x), Math.floor(player.y));
  const remap = store.remaps.find(r => r.sourceIdx === from);
  if (!remap) return false;
  if (!isRemapTopologyValid(world, remap)) {
    expireRemap(world, state, store, remap, 'blocked_on_use');
    return false;
  }

  const targetDoor = world.doors.get(remap.targetDoorIdx);
  if (targetDoor && targetDoor.state === DoorState.CLOSED) {
    targetDoor.state = DoorState.OPEN;
    targetDoor.timer = Math.max(targetDoor.timer, WRONG_DOOR_TARGET_DOOR_TIMER);
  } else if (targetDoor && targetDoor.state === DoorState.HERMETIC_OPEN) {
    targetDoor.timer = Math.max(targetDoor.timer, WRONG_DOOR_TARGET_DOOR_TIMER);
  }

  player.x = (remap.targetIdx % W) + 0.5;
  player.y = ((remap.targetIdx / W) | 0) + 0.5;
  removeRemap(world, store, remap);
  store.cooldownUntil = Math.max(store.cooldownUntil, state.time + WRONG_DOOR_USED_COOLDOWN);
  publishWrongDoorEvent(world, state, remap, 'used', remap.reason);
  return true;
}

export function getWrongDoorMapCues(world: World, state: GameState | undefined): WrongDoorMapCue[] {
  if (!state) return [];
  const store = stores.get(world);
  if (!store || store.remaps.length === 0) return [];
  const out: WrongDoorMapCue[] = [];
  for (const remap of store.remaps) {
    if (state.time >= remap.expiresAt) continue;
    out.push({
      id: remap.id,
      sourceX: remap.sourceIdx % W,
      sourceY: (remap.sourceIdx / W) | 0,
      targetX: remap.targetIdx % W,
      targetY: (remap.targetIdx / W) | 0,
      expiresAt: remap.expiresAt,
    });
  }
  return out;
}
