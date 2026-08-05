import {
  W,
  Cell,
  Feature,
  Tex,
  msg,
  type Entity,
  type GameState,
  type Room,
} from '../../core/types';
import { World } from '../../core/world';
import { RUNTIME_TOPOLOGY_LIMITS } from '../../data/runtime_topology';
import { consumeToolDurability, hasItem } from '../inventory';

const CONWAY_LIFE_ROOM_PREFIX = 'Игра жизнь:';
const CONWAY_LIFE_DISABLED = 'выкл';
const LIFE_TICK_SECONDS = 0.75;
const LIFE_FIELD_WINDOW_SIZE = 128;
const LIFE_FIELD_SHIFT_SECONDS = 60;
const PLAYER_PROTECT_R2 = 2.25 * 2.25;
const LIFE_WALL_FOG = 34;

interface ConwayLifeArena {
  roomId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  mask: Uint8Array;
  current: Uint8Array;
  next: Uint8Array;
  controlIdx: number;
  active: boolean;
  alive: number;
}

interface ConwayLifeRuntime {
  arenas: ConwayLifeArena[];
  field: ConwayLifeField;
  accum: number;
  nextMsgAt: number;
}

interface ConwayLifeField {
  x: number;
  y: number;
  mask: Uint8Array;
  current: Uint8Array;
  next: Uint8Array;
  windowToken: number;
  active: boolean;
  alive: number;
}

const runtimeByWorld = new WeakMap<World, ConwayLifeRuntime>();

export function nextLifeCell(alive: boolean, neighbors: number): boolean {
  return neighbors === 3 || (alive && neighbors === 2);
}

function hash32(v: number): number {
  v |= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

function isConwayRoom(room: Room): boolean {
  return room.name.startsWith(CONWAY_LIFE_ROOM_PREFIX);
}

function isDisabledRoom(room: Room): boolean {
  return room.name.includes(CONWAY_LIFE_DISABLED);
}

function enableRoomName(room: Room): void {
  room.name = room.name.replace(`; ${CONWAY_LIFE_DISABLED}`, '');
}

function localIndex(arena: ConwayLifeArena, dx: number, dy: number): number {
  return dy * arena.w + dx;
}

function fieldIndex(dx: number, dy: number): number {
  return dy * LIFE_FIELD_WINDOW_SIZE + dx;
}

function findControl(world: World, room: Room): number {
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const ci = world.idx(room.x + dx, room.y + dy);
      if (world.roomMap[ci] === room.id && world.features[ci] === Feature.APPARATUS) return ci;
    }
  }
  return -1;
}

function nearDoor(world: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (world.doors.has(world.idx(x + dx, y + dy))) return true;
    }
  }
  return false;
}

function mutableRuntimeCell(world: World, room: Room, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  if (world.roomMap[ci] !== room.id) return false;
  if (world.hermoWall[ci] !== 0 || world.aptMask[ci] !== 0) return false;
  if (world.doors.has(ci) || nearDoor(world, x, y)) return false;
  if (world.containerMap.has(ci)) return false;
  if (world.cells[ci] === Cell.LIFT || world.features[ci] === Feature.LIFT_BUTTON) return false;
  const feature = world.features[ci] as Feature;
  if (feature !== Feature.NONE && feature !== Feature.LAMP) return false;
  return world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WALL;
}

function mutableFieldCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  if (world.hermoWall[ci] !== 0 || world.aptMask[ci] !== 0) return false;
  if (world.doors.has(ci) || nearDoor(world, x, y)) return false;
  if (world.containerMap.has(ci)) return false;
  if (world.cells[ci] === Cell.LIFT || world.features[ci] === Feature.LIFT_BUTTON) return false;
  const feature = world.features[ci] as Feature;
  if (feature !== Feature.NONE && feature !== Feature.LAMP) return false;
  return world.cells[ci] === Cell.FLOOR || world.cells[ci] === Cell.WALL;
}

function buildArena(world: World, room: Room): ConwayLifeArena | null {
  const len = room.w * room.h;
  if (len > RUNTIME_TOPOLOGY_LIMITS.conwayLifeMaxArenaCells) return null;
  const mask = new Uint8Array(len);
  const current = new Uint8Array(len);
  const next = new Uint8Array(len);
  let mutable = 0;
  let alive = 0;

  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const li = dy * room.w + dx;
      if (!mutableRuntimeCell(world, room, x, y)) continue;
      const ci = world.idx(x, y);
      mask[li] = 1;
      mutable++;
      if (world.cells[ci] === Cell.WALL) {
        current[li] = 1;
        alive++;
      }
    }
  }

  if (mutable < 32) return null;
  return {
    roomId: room.id,
    x: room.x,
    y: room.y,
    w: room.w,
    h: room.h,
    mask,
    current,
    next,
    controlIdx: findControl(world, room),
    active: !isDisabledRoom(room),
    alive,
  };
}

function runtimeFor(world: World): ConwayLifeRuntime {
  const existing = runtimeByWorld.get(world);
  if (existing) return existing;

  const arenas: ConwayLifeArena[] = [];
  for (const room of world.rooms) {
    if (arenas.length >= RUNTIME_TOPOLOGY_LIMITS.conwayLifeMaxArenas) break;
    if (!isConwayRoom(room)) continue;
    const arena = buildArena(world, room);
    if (arena) arenas.push(arena);
  }
  const fieldCells = LIFE_FIELD_WINDOW_SIZE * LIFE_FIELD_WINDOW_SIZE;
  const runtime = {
    arenas,
    field: {
      x: 0,
      y: 0,
      mask: new Uint8Array(fieldCells),
      current: new Uint8Array(fieldCells),
      next: new Uint8Array(fieldCells),
      windowToken: -1,
      active: false,
      alive: 0,
    },
    accum: 0,
    nextMsgAt: 0,
  };
  runtimeByWorld.set(world, runtime);
  return runtime;
}

function neighborCount(arena: ConwayLifeArena, dx: number, dy: number): number {
  let n = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue;
      const nx = dx + ox;
      const ny = dy + oy;
      if (nx < 0 || ny < 0 || nx >= arena.w || ny >= arena.h) continue;
      n += arena.current[localIndex(arena, nx, ny)];
    }
  }
  return n;
}

function cellNearPlayer(world: World, player: Entity, x: number, y: number): boolean {
  return world.dist2(player.x, player.y, x + 0.5, y + 0.5) <= PLAYER_PROTECT_R2;
}

function commitArena(world: World, player: Entity, arena: ConwayLifeArena): number {
  const room = world.rooms[arena.roomId];
  if (!room) return 0;
  let changed = 0;
  let alive = 0;
  for (let dy = 0; dy < arena.h; dy++) {
    for (let dx = 0; dx < arena.w; dx++) {
      const li = localIndex(arena, dx, dy);
      if (!arena.mask[li]) continue;
      const x = world.wrap(arena.x + dx);
      const y = world.wrap(arena.y + dy);
      const ci = world.idx(x, y);
      if (!mutableRuntimeCell(world, room, x, y)) {
        arena.current[li] = 0;
        arena.next[li] = 0;
        continue;
      }
      const wasAlive = arena.current[li] !== 0;
      let nowAlive = arena.next[li] !== 0;
      if (nowAlive && !wasAlive && cellNearPlayer(world, player, x, y)) nowAlive = false;
      arena.current[li] = nowAlive ? 1 : 0;
      if (nowAlive) alive++;
      if (nowAlive === wasAlive) continue;
      changed++;
      world.cells[ci] = nowAlive ? Cell.WALL : Cell.FLOOR;
      if (nowAlive) {
        world.wallTex[ci] = Tex.DARK;
        world.fog[ci] = Math.max(world.fog[ci], LIFE_WALL_FOG);
      } else {
        world.floorTex[ci] = Tex.F_CONCRETE;
        world.fog[ci] = Math.max(8, Math.min(world.fog[ci], 22));
      }
    }
  }
  arena.alive = alive;
  return changed;
}

function seededAlive(arena: ConwayLifeArena, dx: number, dy: number, seed: number): boolean {
  const edge = dx <= 2 || dy <= 2 || dx >= arena.w - 3 || dy >= arena.h - 3;
  const h = hash32((dx * 73856093) ^ (dy * 19349663) ^ (arena.roomId * 83492791) ^ seed);
  if (edge) return (h & 15) === 0;
  if ((dx + seed) % 11 === 0 && dy > 3 && dy < arena.h - 4) return (h % 100) < 38;
  if ((dy + arena.roomId) % 13 === 0 && dx > 3 && dx < arena.w - 4) return (h % 100) < 34;
  return (h % 100) < 24;
}

function resetArena(world: World, player: Entity, arena: ConwayLifeArena, seed: number): number {
  const room = world.rooms[arena.roomId];
  if (!room) return 0;
  arena.active = true;
  arena.next.fill(0);
  let changed = 0;
  let alive = 0;

  for (let dy = 0; dy < arena.h; dy++) {
    for (let dx = 0; dx < arena.w; dx++) {
      const li = localIndex(arena, dx, dy);
      if (!arena.mask[li]) continue;
      const x = world.wrap(arena.x + dx);
      const y = world.wrap(arena.y + dy);
      const ci = world.idx(x, y);
      if (!mutableRuntimeCell(world, room, x, y)) {
        arena.current[li] = 0;
        continue;
      }
      const wasAlive = arena.current[li] !== 0;
      const nowAlive = !cellNearPlayer(world, player, x, y) && seededAlive(arena, dx, dy, seed);
      arena.current[li] = nowAlive ? 1 : 0;
      if (nowAlive) {
        alive++;
        world.cells[ci] = Cell.WALL;
        world.wallTex[ci] = Tex.DARK;
        world.fog[ci] = Math.max(world.fog[ci], LIFE_WALL_FOG);
      } else {
        world.cells[ci] = Cell.FLOOR;
        world.floorTex[ci] = Tex.F_CONCRETE;
        world.fog[ci] = Math.max(4, Math.min(world.fog[ci], 22));
      }
      if (nowAlive !== wasAlive) changed++;
    }
  }

  arena.alive = alive;
  return changed;
}

function tickArena(world: World, player: Entity, arena: ConwayLifeArena): number {
  if (!arena.active) return 0;
  for (let dy = 0; dy < arena.h; dy++) {
    for (let dx = 0; dx < arena.w; dx++) {
      const li = localIndex(arena, dx, dy);
      if (!arena.mask[li]) {
        arena.next[li] = 0;
        continue;
      }
      const alive = arena.current[li] !== 0;
      const born = nextLifeCell(alive, neighborCount(arena, dx, dy));
      arena.next[li] = born ? 1 : 0;
    }
  }
  return commitArena(world, player, arena);
}

function fieldNeighborCount(field: ConwayLifeField, dx: number, dy: number): number {
  let n = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) continue;
      const nx = dx + ox;
      const ny = dy + oy;
      if (nx < 0 || ny < 0 || nx >= LIFE_FIELD_WINDOW_SIZE || ny >= LIFE_FIELD_WINDOW_SIZE) continue;
      n += field.current[fieldIndex(nx, ny)];
    }
  }
  return n;
}

function selectFieldWindow(world: World, state: GameState, field: ConwayLifeField): void {
  const token = Math.max(0, Math.floor(state.time / LIFE_FIELD_SHIFT_SECONDS));
  if (field.active && field.windowToken === token) return;

  const maxOrigin = W - LIFE_FIELD_WINDOW_SIZE;
  const seed = hash32(
    Math.imul(token + 1, 0x9e3779b1)
      ^ Math.imul((state.tick | 0) + 1, 0x85ebca6b)
      ^ Math.imul(world.cellVersion + 1, 0xc2b2ae35),
  );
  field.x = hash32(seed ^ 0x71c0) % (maxOrigin + 1);
  field.y = hash32(seed ^ 0x71c1) % (maxOrigin + 1);
  field.windowToken = token;
  field.active = true;
  field.next.fill(0);
  let alive = 0;
  let mutable = 0;

  for (let dy = 0; dy < LIFE_FIELD_WINDOW_SIZE; dy++) {
    for (let dx = 0; dx < LIFE_FIELD_WINDOW_SIZE; dx++) {
      const x = field.x + dx;
      const y = field.y + dy;
      const li = fieldIndex(dx, dy);
      const canMutate = mutableFieldCell(world, x, y);
      field.mask[li] = canMutate ? 1 : 0;
      const isAlive = canMutate && world.cells[world.idx(x, y)] === Cell.WALL;
      field.current[li] = isAlive ? 1 : 0;
      if (canMutate) mutable++;
      if (isAlive) alive++;
    }
  }
  field.alive = alive;
  if (mutable < 64) field.active = false;
}

function commitField(world: World, player: Entity, field: ConwayLifeField): number {
  let changed = 0;
  let alive = 0;

  for (let dy = 0; dy < LIFE_FIELD_WINDOW_SIZE; dy++) {
    for (let dx = 0; dx < LIFE_FIELD_WINDOW_SIZE; dx++) {
      const li = fieldIndex(dx, dy);
      if (!field.mask[li]) continue;
      const x = field.x + dx;
      const y = field.y + dy;
      const ci = world.idx(x, y);
      if (!mutableFieldCell(world, x, y)) {
        field.current[li] = 0;
        field.next[li] = 0;
        continue;
      }
      const wasAlive = field.current[li] !== 0;
      let nowAlive = field.next[li] !== 0;
      if (nowAlive && cellNearPlayer(world, player, x, y)) nowAlive = false;
      field.current[li] = nowAlive ? 1 : 0;
      if (nowAlive) alive++;
      if (nowAlive === wasAlive) continue;
      changed++;
      world.cells[ci] = nowAlive ? Cell.WALL : Cell.FLOOR;
      if (nowAlive) {
        world.wallTex[ci] = Tex.DARK;
        world.floorTex[ci] = Tex.F_VOID;
        world.fog[ci] = Math.max(world.fog[ci], LIFE_WALL_FOG);
      } else {
        world.wallTex[ci] = Tex.CONCRETE;
        world.floorTex[ci] = Tex.F_CONCRETE;
        world.fog[ci] = Math.max(4, Math.min(world.fog[ci], 22));
      }
    }
  }

  field.alive = alive;
  return changed;
}

function tickField(world: World, player: Entity, field: ConwayLifeField): number {
  if (!field.active) return 0;
  for (let dy = 0; dy < LIFE_FIELD_WINDOW_SIZE; dy++) {
    for (let dx = 0; dx < LIFE_FIELD_WINDOW_SIZE; dx++) {
      const li = fieldIndex(dx, dy);
      if (!field.mask[li]) {
        field.next[li] = 0;
        continue;
      }
      const alive = field.current[li] !== 0;
      field.next[li] = nextLifeCell(alive, fieldNeighborCount(field, dx, dy)) ? 1 : 0;
    }
  }
  return commitField(world, player, field);
}

function arenaNearControl(world: World, runtime: ConwayLifeRuntime, player: Entity, lookX: number, lookY: number): ConwayLifeArena | undefined {
  let best: ConwayLifeArena | undefined;
  let bestD2 = 4;
  for (const arena of runtime.arenas) {
    if (arena.controlIdx < 0) continue;
    const cx = arena.controlIdx % W;
    const cy = (arena.controlIdx / W) | 0;
    if (world.dist2(player.x, player.y, cx + 0.5, cy + 0.5) > 7) continue;
    const d2 = world.dist2(lookX, lookY, cx + 0.5, cy + 0.5);
    if (d2 >= bestD2) continue;
    bestD2 = d2;
    best = arena;
  }
  return best;
}

function disableArena(world: World, arena: ConwayLifeArena): number {
  const room = world.rooms[arena.roomId];
  if (!room) return 0;
  arena.active = false;
  arena.next.fill(0);
  let cleared = 0;
  for (let dy = 0; dy < arena.h; dy++) {
    for (let dx = 0; dx < arena.w; dx++) {
      const li = localIndex(arena, dx, dy);
      if (!arena.mask[li] || !arena.current[li]) continue;
      const x = world.wrap(arena.x + dx);
      const y = world.wrap(arena.y + dy);
      const ci = world.idx(x, y);
      if (!mutableRuntimeCell(world, room, x, y)) {
        arena.current[li] = 0;
        continue;
      }
      world.cells[ci] = Cell.FLOOR;
      world.floorTex[ci] = Tex.F_CONCRETE;
      world.fog[ci] = Math.max(4, Math.min(world.fog[ci], 18));
      arena.current[li] = 0;
      cleared++;
    }
  }
  arena.alive = 0;
  return cleared;
}

export function updateConwayLifeAnomaly(world: World, player: Entity, state: GameState, dt: number): void {
  const runtime = runtimeFor(world);
  selectFieldWindow(world, state, runtime.field);
  runtime.accum += dt;
  if (runtime.accum < LIFE_TICK_SECONDS) return;
  runtime.accum %= LIFE_TICK_SECONDS;

  let changed = 0;
  let active = runtime.field.active ? 1 : 0;
  let alive = 0;
  for (const arena of runtime.arenas) {
    if (arena.active) active++;
    changed += tickArena(world, player, arena);
    alive += arena.alive;
  }
  changed += tickField(world, player, runtime.field);
  alive += runtime.field.alive;
  if (changed > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFogDirty();
  }
  const fieldNearPlayer = runtime.field.active
    && world.dist2(player.x, player.y, runtime.field.x + LIFE_FIELD_WINDOW_SIZE / 2, runtime.field.y + LIFE_FIELD_WINDOW_SIZE / 2) < 90 * 90;
  const arenaNearPlayer = runtime.arenas[0]
    ? world.dist2(player.x, player.y, runtime.arenas[0].x, runtime.arenas[0].y) < 90 * 90
    : false;
  if (active > 0 && changed > 18 && state.time >= runtime.nextMsgAt && (fieldNearPlayer || arenaNearPlayer)) {
    runtime.nextMsgAt = state.time + 11;
    state.msgs.push(msg(`Живой бетон щелкнул: ${active} пол., ${alive} клеток.`, state.time, '#8fa'));
  }
}

export function tryUseConwayLifeAnomaly(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const runtime = runtimeFor(world);
  if (runtime.arenas.length === 0) return false;
  const arena = arenaNearControl(world, runtime, player, lookX, lookY);
  if (!arena) return false;
  if (!arena.active) {
    const seed = hash32(Math.floor(state.time * 1000) ^ (state.tick | 0) ^ Math.imul(arena.roomId + 1, 0x45d9f3b));
    const changed = resetArena(world, player, arena, seed);
    const room = world.rooms[arena.roomId];
    if (room && isDisabledRoom(room)) enableRoomName(room);
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFogDirty();
    state.msgs.push(msg(`Автомат сбросил поле. ${changed} клеток снова вошли в ритм.`, state.time, '#8cf'));
    return true;
  }

  const prepared = player.tool === 'wrench' || player.tool === 'uv_spotlight' || hasItem(player, 'circuit_board') || hasItem(player, 'relay_diagram');
  if (player.tool === 'wrench' || player.tool === 'uv_spotlight') {
    consumeToolDurability(player, player.tool === 'wrench' ? 1 : 2, state.msgs, state.time, state);
  }
  const cleared = disableArena(world, arena);
  const room = world.rooms[arena.roomId];
  if (room && !isDisabledRoom(room)) room.name = `${room.name}; ${CONWAY_LIFE_DISABLED}`;
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFogDirty();

  if (!prepared) {
    player.hp = Math.max(1, (player.hp ?? 100) - 5);
    state.msgs.push(msg(`Автомат заглушен голыми руками. ${cleared} клеток осыпалось, пальцы дрожат.`, state.time, '#fa8'));
  } else {
    state.msgs.push(msg(`Глушитель поймал ритм. ${cleared} живых клеток стали полом.`, state.time, '#8cf'));
  }
  return true;
}
