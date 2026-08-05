import {
  Cell,
  Feature,
  msg,
  type Entity,
  type GameState,
  type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { isPlayerEntity } from '../player_actor';

type RadioChessPhase = 'white' | 'black' | 'file' | 'rank' | 'knight';

interface RadioChessCache {
  seed: number;
  domainCount: number;
  domainRoomIds: Int16Array;
  domainX: Int16Array;
  domainY: Int16Array;
  domainW: Int16Array;
  domainH: Int16Array;
  beaconCount: number;
  beaconIdxs: Int32Array;
  beaconX: Int16Array;
  beaconY: Int16Array;
  beaconFeatures: Uint8Array;
}

interface RadioChessRuntime {
  cache: RadioChessCache;
  disabledBeacons: Uint8Array;
  disabledCount: number;
  tickAccum: number;
  lastCell: number;
  lastPhase: number;
  lastMsgTime: number;
}

export interface RadioChessStatus {
  active: boolean;
  inArena: boolean;
  dangerous: boolean;
  phaseIndex: number;
  safePhase: string;
  disabledBeacons: number;
  totalBeacons: number;
  prompt: string;
}

const PHASE_SECONDS = 5.5;
const PRESSURE_TICK_SECONDS = 0.8;
const PHASES: readonly RadioChessPhase[] = ['white', 'black', 'file', 'rank', 'knight'];
const RADIO_CHESS_ROOM_PREFIX = 'Радио-шахматы';
const cacheByWorld = new WeakMap<World, RadioChessCache>();
const runtimeByState = new WeakMap<GameState, RadioChessRuntime>();

function runtimeFor(state: GameState, world: World, cache: RadioChessCache): RadioChessRuntime {
  const current = runtimeByState.get(state);
  if (current?.cache === cache) return current;
  const disabledBeacons = new Uint8Array(cache.beaconCount);
  let disabledCount = 0;
  for (let i = 0; i < cache.beaconCount; i++) {
    if (world.features[cache.beaconIdxs[i]] !== Feature.MACHINE) continue;
    disabledBeacons[i] = 1;
    disabledCount++;
  }
  const next: RadioChessRuntime = {
    cache,
    disabledBeacons,
    disabledCount,
    tickAccum: 0,
    lastCell: -1,
    lastPhase: -1,
    lastMsgTime: -Infinity,
  };
  runtimeByState.set(state, next);
  return next;
}

function radioChessRoom(room: Room): boolean {
  return room.name.includes(RADIO_CHESS_ROOM_PREFIX);
}

function cacheFor(world: World): RadioChessCache {
  const current = cacheByWorld.get(world);
  if (current) return current;

  const domainRoomIds: number[] = [];
  const domainX: number[] = [];
  const domainY: number[] = [];
  const domainW: number[] = [];
  const domainH: number[] = [];
  const beaconIdxs: number[] = [];
  const beaconX: number[] = [];
  const beaconY: number[] = [];
  const beaconFeatures: number[] = [];
  let seed = 0x51cafe;
  for (const room of world.rooms) {
    if (!radioChessRoom(room)) continue;
    domainRoomIds.push(room.id);
    domainX.push(room.x);
    domainY.push(room.y);
    domainW.push(room.w);
    domainH.push(room.h);
    seed = (seed ^ ((room.x * 73856093) ^ (room.y * 19349663) ^ (room.w * 83492791) ^ room.id)) | 0;

    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        const x = world.wrap(room.x + dx);
        const y = world.wrap(room.y + dy);
        const ci = world.idx(x, y);
        const feature = world.features[ci] as Feature;
        if (feature !== Feature.APPARATUS && feature !== Feature.SCREEN && feature !== Feature.MACHINE) continue;
        beaconIdxs.push(ci);
        beaconX.push(x);
        beaconY.push(y);
        beaconFeatures.push(feature === Feature.MACHINE ? Feature.APPARATUS : feature);
      }
    }
  }

  const next: RadioChessCache = {
    seed,
    domainCount: domainRoomIds.length,
    domainRoomIds: Int16Array.from(domainRoomIds),
    domainX: Int16Array.from(domainX),
    domainY: Int16Array.from(domainY),
    domainW: Int16Array.from(domainW),
    domainH: Int16Array.from(domainH),
    beaconCount: beaconIdxs.length,
    beaconIdxs: Int32Array.from(beaconIdxs),
    beaconX: Int16Array.from(beaconX),
    beaconY: Int16Array.from(beaconY),
    beaconFeatures: Uint8Array.from(beaconFeatures),
  };
  cacheByWorld.set(world, next);
  return next;
}

function phaseIndexAt(time: number, seed: number): number {
  const offset = Math.abs(seed % 997) / 997;
  return Math.floor((time + offset * PHASE_SECONDS) / PHASE_SECONDS);
}

function phaseName(phase: RadioChessPhase): string {
  if (phase === 'white') return 'белые клетки';
  if (phase === 'black') return 'черные клетки';
  if (phase === 'file') return 'четвертые вертикали';
  if (phase === 'rank') return 'четвертые горизонтали';
  return 'ход коня от маяка';
}

function inDomain(world: World, x: number, y: number, cache: RadioChessCache, index: number): boolean {
  const dx = world.delta(cache.domainX[index], x);
  const dy = world.delta(cache.domainY[index], y);
  return dx >= 0 && dy >= 0 && dx < cache.domainW[index] && dy < cache.domainH[index];
}

function domainAt(world: World, x: number, y: number, cache: RadioChessCache): boolean {
  const roomId = world.roomMap[world.idx(x, y)];
  for (let i = 0; i < cache.domainCount; i++) {
    if (cache.domainRoomIds[i] === roomId || inDomain(world, x, y, cache, i)) return true;
  }
  return false;
}

function nearestActiveBeacon(
  world: World,
  x: number,
  y: number,
  cache: RadioChessCache,
  runtime: RadioChessRuntime,
): number {
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < cache.beaconCount; i++) {
    if (runtime.disabledBeacons[i]) continue;
    const d2 = world.dist2(x + 0.5, y + 0.5, cache.beaconX[i] + 0.5, cache.beaconY[i] + 0.5);
    if (d2 >= bestD2) continue;
    bestD2 = d2;
    best = i;
  }
  return best;
}

export function radioChessPhaseDanger(
  x: number,
  y: number,
  phaseIndex: number,
  seed: number,
  beaconX: number,
  beaconY: number,
): boolean {
  const phase = PHASES[((phaseIndex % PHASES.length) + PHASES.length) % PHASES.length];
  const parity = (x + y + seed) & 1;
  if (phase === 'white') return parity !== 0;
  if (phase === 'black') return parity !== 1;
  if (phase === 'file') return Math.abs(x + seed) % 4 !== 0;
  if (phase === 'rank') return Math.abs(y + (seed >> 3)) % 4 !== 0;

  const dx = Math.abs(x - beaconX) % 6;
  const dy = Math.abs(y - beaconY) % 6;
  return !((dx === 1 && dy === 2) || (dx === 2 && dy === 1) || (dx === 4 && dy === 5) || (dx === 5 && dy === 4));
}

function playerCellDanger(
  world: World,
  player: Entity,
  state: GameState,
): { dangerous: boolean; phaseIndex: number; active: boolean; inArena: boolean } {
  const cache = cacheFor(world);
  const runtime = runtimeFor(state, world, cache);
  if (cache.domainCount === 0 || cache.beaconCount === 0 || runtime.disabledCount >= cache.beaconCount) {
    return { dangerous: false, phaseIndex: 0, active: false, inArena: false };
  }

  const x = world.wrap(Math.floor(player.x));
  const y = world.wrap(Math.floor(player.y));
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) {
    return { dangerous: false, phaseIndex: 0, active: false, inArena: false };
  }
  if (!domainAt(world, x, y, cache)) return { dangerous: false, phaseIndex: 0, active: true, inArena: false };
  const beaconIndex = nearestActiveBeacon(world, x, y, cache, runtime);
  if (beaconIndex < 0) return { dangerous: false, phaseIndex: 0, active: false, inArena: true };

  const phaseIndex = phaseIndexAt(state.time, cache.seed);
  const beaconX = cache.beaconX[beaconIndex];
  const beaconY = cache.beaconY[beaconIndex];
  return {
    dangerous: radioChessPhaseDanger(
      x,
      y,
      phaseIndex,
      cache.seed,
      x + Math.round(world.delta(x, beaconX)),
      y + Math.round(world.delta(y, beaconY)),
    ),
    phaseIndex,
    active: true,
    inArena: true,
  };
}

export function getRadioChessStatus(world: World, player: Entity, state: GameState): RadioChessStatus {
  const cache = cacheFor(world);
  const runtime = runtimeFor(state, world, cache);
  const cell = playerCellDanger(world, player, state);
  const phase = PHASES[((cell.phaseIndex % PHASES.length) + PHASES.length) % PHASES.length];
  const safePhase = phaseName(phase);
  return {
    active: cell.active,
    inArena: cell.inArena,
    dangerous: cell.dangerous,
    phaseIndex: cell.phaseIndex,
    safePhase,
    disabledBeacons: runtime.disabledCount,
    totalBeacons: cache.beaconCount,
    prompt: !cell.active
      ? ''
      : cell.inArena
        ? cell.dangerous
          ? `опасная клетка: безопасны ${safePhase}`
          : `клетка держит: безопасны ${safePhase}`
        : `радио-шахматы: безопасны ${safePhase}`,
  };
}

export function updateRadioChessAnomaly(world: World, player: Entity, state: GameState, dt: number): void {
  if (!isPlayerEntity(player)) return;
  const cache = cacheFor(world);
  if (cache.domainCount === 0 || cache.beaconCount === 0) return;
  const runtime = runtimeFor(state, world, cache);
  if (runtime.disabledCount >= cache.beaconCount) return;
  const phaseIndex = phaseIndexAt(state.time, cache.seed);
  const phase = PHASES[phaseIndex % PHASES.length];
  if (phaseIndex !== runtime.lastPhase) {
    runtime.lastPhase = phaseIndex;
    state.msgs.push(msg(`Радио: безопасны ${phaseName(phase)}.`, state.time, '#dd8'));
  }

  runtime.tickAccum += dt;
  if (runtime.tickAccum < PRESSURE_TICK_SECONDS) return;
  runtime.tickAccum -= PRESSURE_TICK_SECONDS;

  const status = playerCellDanger(world, player, state);
  const cell = world.idx(Math.floor(player.x), Math.floor(player.y));
  if (!status.active || !status.dangerous) {
    runtime.lastCell = cell;
    return;
  }

  const movedOntoDanger = runtime.lastCell !== cell;
  runtime.lastCell = cell;
  const hpLoss = movedOntoDanger ? 3 : 1;
  player.hp = Math.max(1, (player.hp ?? 100) - hpLoss);
  if (player.needs) player.needs.sleep = Math.max(0, player.needs.sleep - (movedOntoDanger ? 0.9 : 0.25));
  if (state.time - runtime.lastMsgTime > 3.5) {
    runtime.lastMsgTime = state.time;
    state.msgs.push(msg(movedOntoDanger ? `Пол дал шах: -${hpLoss} HP.` : 'Шах держит подошвы.', state.time, '#fa6'));
  }
}

export function tryUseRadioChessAnomaly(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const cache = cacheFor(world);
  if (cache.beaconCount === 0) return false;
  const runtime = runtimeFor(state, world, cache);
  let targetIndex = -1;
  for (let i = 0; i < cache.beaconCount; i++) {
    const bx = cache.beaconX[i] + 0.5;
    const by = cache.beaconY[i] + 0.5;
    if (world.dist2(lookX, lookY, bx, by) > 3.4) continue;
    if (world.dist2(player.x, player.y, bx, by) > 8.5) continue;
    targetIndex = i;
    break;
  }
  if (targetIndex < 0) return false;

  const targetIdx = cache.beaconIdxs[targetIndex];
  if (runtime.disabledBeacons[targetIndex]) {
    runtime.disabledBeacons[targetIndex] = 0;
    runtime.disabledCount = Math.max(0, runtime.disabledCount - 1);
    world.setFeatureAt(targetIdx, cache.beaconFeatures[targetIndex] as Feature);
    state.msgs.push(msg('Маяк снова читает доску.', state.time, '#dd8'));
  } else {
    runtime.disabledBeacons[targetIndex] = 1;
    runtime.disabledCount = Math.min(cache.beaconCount, runtime.disabledCount + 1);
    world.setFeatureAt(targetIdx, Feature.MACHINE);
    state.msgs.push(msg('Маяк выключен. Клетки рядом молчат.', state.time, '#8cf'));
  }
  return true;
}
