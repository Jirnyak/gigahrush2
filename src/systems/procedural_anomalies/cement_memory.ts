import {
  Cell,
  Feature,
  W,
  msg,
  type Entity,
  type GameState,
} from '../../core/types';
import { World } from '../../core/world';
import { MarkType, stampMark } from '../surface_marks';
import { isPlayerEntity } from '../player_actor';

const AMNESIA_ROOM_PREFIX = 'Амнезийная зона';
const RING_SIZE = 192;
const TICK_SECONDS = 1;
const FRESH_SECONDS = 3.5;
const HARD_SECONDS = 9;
const BAKE_SECONDS = 18;
const DECAY_SECONDS = 42;
const PASSIVE_CLEAR_RADIUS = 12;
const PANEL_CLEAR_RADIUS = 34;
const PANEL_CLEAR_CAP = 96;
const RECENT_CLEAR_SECONDS = 12;

interface MemoryEntry {
  idx: number;
  enteredAt: number;
  stage: number;
}

interface CementMemoryRuntime {
  world: World;
  entries: MemoryEntry[];
  cursor: number;
  lastCell: number;
  tickAccum: number;
  lastHarmAt: number;
  lastMsgAt: number;
}

const runtimeByState = new WeakMap<GameState, CementMemoryRuntime>();

export function updateCementMemoryAnomaly(world: World, player: Entity, state: GameState, dt: number): void {
  if (!isPlayerEntity(player)) return;
  const runtime = runtimeFor(world, state);
  const px = world.wrap(Math.floor(player.x));
  const py = world.wrap(Math.floor(player.y));
  const ci = world.idx(px, py);

  if (isAmnesiaCell(world, ci)) {
    coolLocalMemory(world, runtime, state.time, ci, PASSIVE_CLEAR_RADIUS, 12, false);
    if (state.time - runtime.lastMsgAt > 14) {
      runtime.lastMsgAt = state.time;
      state.msgs.push(msg('Цементная память здесь стирается, шаги становятся легче.', state.time, '#9cf'));
    }
  } else if (ci !== runtime.lastCell && isRecordable(world, ci)) {
    rememberCell(runtime, ci, state.time);
    runtime.lastCell = ci;
  }

  const stage = currentStage(runtime, ci, state.time);
  if (stage >= 2 && state.time - runtime.lastHarmAt > 2.2) {
    runtime.lastHarmAt = state.time;
    player.hp = Math.max(1, (player.hp ?? 100) - (stage === 2 ? 1 : 3));
    if (player.needs) player.needs.sleep = Math.max(0, player.needs.sleep - 0.3);
    if (state.time - runtime.lastMsgAt > 6) {
      runtime.lastMsgAt = state.time;
      state.msgs.push(msg(stage === 2
        ? 'Старый след тянет ноги и режет подошвы.'
        : 'Запекшийся маршрут давит грудь: обратный ход уже закрывает цемент.',
      state.time, stage === 2 ? '#ca8' : '#f84'));
    }
  }

  runtime.tickAccum += dt;
  if (runtime.tickAccum < TICK_SECONDS) return;
  runtime.tickAccum -= TICK_SECONDS;
  ageEntries(world, runtime, state.time);
}

export function tryUseCementMemoryAnomaly(world: World, player: Entity, state: GameState, lookX: number, lookY: number): boolean {
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  if (world.features[ci] !== Feature.APPARATUS || !isAmnesiaCell(world, ci)) return false;
  if (world.dist2(player.x, player.y, x + 0.5, y + 0.5) > 8) return false;

  const runtime = runtimeFor(world, state);
  const cleared = coolLocalMemory(world, runtime, state.time, ci, PANEL_CLEAR_RADIUS, PANEL_CLEAR_CAP, true);
  state.msgs.push(msg(cleared > 0
    ? 'Щиток амнезии сбросил свежие следы. Можно идти обратно, но недолго.'
    : 'Щиток гудит пусто: свежих цементных следов рядом нет.',
  state.time, cleared > 0 ? '#8cf' : '#888'));
  return true;
}

function runtimeFor(world: World, state: GameState): CementMemoryRuntime {
  const current = runtimeByState.get(state);
  if (current && current.world === world) return current;
  const next: CementMemoryRuntime = {
    world,
    entries: Array.from({ length: RING_SIZE }, () => ({ idx: -1, enteredAt: 0, stage: -1 })),
    cursor: 0,
    lastCell: -1,
    tickAccum: 0,
    lastHarmAt: -Infinity,
    lastMsgAt: -Infinity,
  };
  runtimeByState.set(state, next);
  return next;
}

function rememberCell(runtime: CementMemoryRuntime, ci: number, time: number): void {
  const entry = runtime.entries[runtime.cursor];
  entry.idx = ci;
  entry.enteredAt = time;
  entry.stage = 0;
  runtime.cursor = (runtime.cursor + 1) % RING_SIZE;
}

function ageEntries(world: World, runtime: CementMemoryRuntime, time: number): void {
  let fogDirty = false;
  for (const entry of runtime.entries) {
    if (entry.idx < 0) continue;
    const age = time - entry.enteredAt;
    if (age >= DECAY_SECONDS) {
      world.fog[entry.idx] = Math.max(0, world.fog[entry.idx] - 36);
      entry.idx = -1;
      entry.stage = -1;
      fogDirty = true;
      continue;
    }
    const nextStage = age >= BAKE_SECONDS ? 3 : age >= HARD_SECONDS ? 2 : age >= FRESH_SECONDS ? 1 : 0;
    if (nextStage === entry.stage) continue;
    entry.stage = nextStage;
    markStage(world, entry.idx, nextStage);
    fogDirty = true;
  }
  if (fogDirty) world.markFogDirty();
}

function markStage(world: World, ci: number, stage: number): void {
  const x = ci % W;
  const y = (ci / W) | 0;
  if (stage === 1) {
    stampMark(world, x, y, 0.5, 0.5, 0.2, MarkType.SPLAT, ci ^ 0x19, 50, 47, 38, 90);
    world.fog[ci] = Math.max(world.fog[ci], 18);
  } else if (stage === 2) {
    stampMark(world, x, y, 0.5, 0.5, 0.28, MarkType.SCORCH, ci ^ 0x63, 34, 32, 28, 125);
    world.fog[ci] = Math.max(world.fog[ci], 42);
  } else if (stage === 3) {
    stampMark(world, x, y, 0.5, 0.5, 0.38, MarkType.BURN, ci ^ 0xb7, 18, 17, 15, 155);
    world.fog[ci] = Math.max(world.fog[ci], 76);
  }
}

function currentStage(runtime: CementMemoryRuntime, ci: number, time: number): number {
  let best = -1;
  for (const entry of runtime.entries) {
    if (entry.idx !== ci) continue;
    if (time - entry.enteredAt >= DECAY_SECONDS) continue;
    if (entry.stage > best) best = entry.stage;
  }
  return best;
}

function coolLocalMemory(
  world: World,
  runtime: CementMemoryRuntime,
  time: number,
  centerIdx: number,
  radius: number,
  cap: number,
  includeRecent: boolean,
): number {
  let cleared = 0;
  for (let step = 1; step <= RING_SIZE && cleared < cap; step++) {
    const entry = runtime.entries[(runtime.cursor - step + RING_SIZE) % RING_SIZE];
    if (cleared >= cap) break;
    if (entry.idx < 0) continue;
    if (!entryCanBeCleared(world, entry, time, centerIdx, radius, includeRecent)) continue;
    world.fog[entry.idx] = Math.max(0, world.fog[entry.idx] - 80);
    entry.enteredAt = time - DECAY_SECONDS;
    entry.idx = -1;
    entry.stage = -1;
    cleared++;
  }
  if (cleared > 0) world.markFogDirty();
  return cleared;
}

function entryCanBeCleared(
  world: World,
  entry: MemoryEntry,
  time: number,
  centerIdx: number,
  radius: number,
  includeRecent: boolean,
): boolean {
  const ex = entry.idx % W;
  const ey = (entry.idx / W) | 0;
  const cx = centerIdx % W;
  const cy = (centerIdx / W) | 0;
  if (world.dist2(ex + 0.5, ey + 0.5, cx + 0.5, cy + 0.5) <= radius * radius) return true;
  return includeRecent && time - entry.enteredAt <= RECENT_CLEAR_SECONDS;
}

function isRecordable(world: World, ci: number): boolean {
  return (world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WATER) &&
    world.features[ci] !== Feature.LIFT_BUTTON &&
    world.hermoWall[ci] === 0 &&
    world.aptMask[ci] === 0 &&
    !world.doors.has(ci);
}

function isAmnesiaCell(world: World, ci: number): boolean {
  const roomId = world.roomMap[ci];
  return roomId >= 0 && !!world.rooms[roomId]?.name.startsWith(AMNESIA_ROOM_PREFIX);
}
