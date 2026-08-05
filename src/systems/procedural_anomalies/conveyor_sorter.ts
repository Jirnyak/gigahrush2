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

const CONVEYOR_ROOM_PREFIX = 'Сортировочный конвейер';
const TICK_SECONDS = 0.35;
const PUSH = 0.34;

type Dir = 1 | 2 | 3 | 4;

interface ConveyorCache {
  roomsVersion: number;
  dirs: Map<number, Dir>;
  controls: number[];
  disabledUntil: number;
  tickAccum: number;
  lastMsgAt: number;
}

const cacheByWorld = new WeakMap<World, ConveyorCache>();

export function updateConveyorSorterAnomaly(world: World, player: Entity, state: GameState, dt: number): void {
  if (!isPlayerEntity(player)) return;
  const cache = cacheFor(world);
  if (state.time < cache.disabledUntil) return;

  cache.tickAccum += dt;
  if (cache.tickAccum < TICK_SECONDS) return;
  cache.tickAccum -= TICK_SECONDS;

  const ci = world.idx(Math.floor(player.x), Math.floor(player.y));
  const dir = cache.dirs.get(ci);
  if (!dir) return;

  const next = pushedPosition(world, player.x, player.y, dir);
  if (canStand(world, next.x, next.y)) {
    player.x = next.x;
    player.y = next.y;
  } else {
    player.hp = Math.max(1, (player.hp ?? 100) - 2);
  }

  if (state.time - cache.lastMsgAt > 10) {
    cache.lastMsgAt = state.time;
    state.msgs.push(msg('Сортировочная лента тянет вас к приемнику. Щиток можно заклинить клавишей взаимодействия.', state.time, '#ca8'));
  }
}

export function tryUseConveyorSorterAnomaly(world: World, player: Entity, state: GameState, lookX: number, lookY: number): boolean {
  const cache = cacheFor(world);
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  if (world.features[ci] !== Feature.APPARATUS || !cache.controls.includes(ci)) return false;
  if (world.dist2(player.x, player.y, x + 0.5, y + 0.5) > 8) return false;

  cache.disabledUntil = state.time + 24;
  state.msgs.push(msg('Щиток заклинил сортировку. Ленты замолкли на несколько вдохов.', state.time, '#8cf'));
  return true;
}

function cacheFor(world: World): ConveyorCache {
  const current = cacheByWorld.get(world);
  if (current && current.roomsVersion === world.rooms.length) return current;
  const next: ConveyorCache = {
    roomsVersion: world.rooms.length,
    dirs: new Map(),
    controls: [],
    disabledUntil: 0,
    tickAccum: 0,
    lastMsgAt: -Infinity,
  };
  for (const room of world.rooms) {
    if (!room.name.startsWith(CONVEYOR_ROOM_PREFIX) || room.w < 10 || room.h < 8) continue;
    addRoomLoop(world, room, next);
  }
  cacheByWorld.set(world, next);
  return next;
}

function addRoomLoop(world: World, room: Room, cache: ConveyorCache): void {
  const left = room.x + 2;
  const right = room.x + room.w - 3;
  const top = room.y + 2;
  const bottom = room.y + room.h - 3;
  const midX = room.x + Math.floor(room.w / 2);
  const midY = room.y + Math.floor(room.h / 2);

  for (let x = left; x <= right; x++) {
    addDir(world, cache, x, top, 1);
    addDir(world, cache, x, bottom, 3);
  }
  for (let y = top; y <= bottom; y++) {
    addDir(world, cache, right, y, 2);
    addDir(world, cache, left, y, 4);
  }
  for (let x = left + 1; x <= right - 1; x++) addDir(world, cache, x, midY, 1);
  for (let y = top + 1; y <= bottom - 1; y++) {
    if (y === midY) continue;
    addDir(world, cache, midX, y, y < midY ? 2 : 4);
  }

  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.features[ci] === Feature.APPARATUS) cache.controls.push(ci);
    }
  }
}

function addDir(world: World, cache: ConveyorCache, x: number, y: number, dir: Dir): void {
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  if (world.features[ci] === Feature.LIFT_BUTTON || world.doors.has(ci)) return;
  if (world.features[ci] === Feature.APPARATUS || world.features[ci] === Feature.SHELF) return;
  cache.dirs.set(ci, dir);
}

function pushedPosition(world: World, x: number, y: number, dir: Dir): { x: number; y: number } {
  if (dir === 1) return { x: world.wrap(x + PUSH), y };
  if (dir === 2) return { x, y: world.wrap(y + PUSH) };
  if (dir === 3) return { x: world.wrap(x - PUSH), y };
  return { x, y: world.wrap(y - PUSH) };
}

function canStand(world: World, x: number, y: number): boolean {
  const r = 0.24;
  return !world.solid(Math.floor(x + r), Math.floor(y + r)) &&
    !world.solid(Math.floor(x + r), Math.floor(y - r)) &&
    !world.solid(Math.floor(x - r), Math.floor(y + r)) &&
    !world.solid(Math.floor(x - r), Math.floor(y - r));
}
