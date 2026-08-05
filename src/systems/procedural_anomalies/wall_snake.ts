import { Cell, Feature, Tex, msg, type Entity, type GameState } from '../../core/types';
import { World } from '../../core/world';
import { RUNTIME_TOPOLOGY_LIMITS } from '../../data/runtime_topology';
import { isPlayerEntity } from '../player_actor';

interface SnakeRuntime {
  path: Int32Array;
  body: Int32Array;
  controlIdx: number;
  head: number;
  length: number;
  direction: 1 | -1;
  stepSeconds: number;
  stepAccum: number;
  warnedUntil: number;
  stoppedUntil: number;
  lastMsgTime: number;
}

interface SnakeFieldRuntime {
  snakes: SnakeRuntime[];
  growthAccum: number;
  growthSeconds: number;
  growthState: number;
  topologyAccum: number;
  topologySeconds: number;
}

const WALL_SNAKE_RE = /\[wall_snake:(-?\d+),(-?\d+),(\d+),(\d+)\]/g;
const snakeByWorld = new WeakMap<World, SnakeFieldRuntime | null>();
const LARVA_BODY_TEX = Tex.LARVA_BODY;
const LARVA_HEAD_TEX = Tex.DARK;
const EATEN_FLOOR_TEX = Tex.F_GUT;
const FLESH_FLOOR_TEX = Tex.F_MEAT;
const FLESH_WALL_TEX_A = Tex.MEAT;
const FLESH_WALL_TEX_B = Tex.GUT;
const WALL_SNAKE_TOPOLOGY_SECONDS = 0.78;
const FLESH_GROWTH_MAX_STEPS = 1;
const FLESH_GROWTH_ATTEMPTS = 64;

function hash32(v: number): number {
  v |= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

function perimeterPoint(world: World, x0: number, y0: number, w: number, h: number, step: number): number {
  const len = Math.max(1, (w + h) * 2 - 4);
  let t = ((step % len) + len) % len;
  if (t < w) return world.idx(x0 + t, y0);
  t -= w;
  if (t < h - 1) return world.idx(x0 + w - 1, y0 + 1 + t);
  t -= h - 1;
  if (t < w - 1) return world.idx(x0 + w - 2 - t, y0 + h - 1);
  t -= w - 1;
  return world.idx(x0, y0 + h - 2 - t);
}

function mutableSnakeCell(world: World, ci: number): boolean {
  const cell = world.cells[ci] as Cell;
  if (
    cell !== Cell.FLOOR &&
    cell !== Cell.WATER &&
    !(cell === Cell.WALL && (isFleshBlock(world, ci) || isLarvaBlock(world, ci)))
  ) return false;
  if (world.hermoWall[ci] !== 0 || world.aptMask[ci] !== 0 || world.doors.has(ci) || world.containerMap.has(ci)) return false;
  const feature = world.features[ci] as Feature;
  return feature === Feature.NONE || feature === Feature.LAMP;
}

function isFleshBlock(world: World, ci: number): boolean {
  if ((world.cells[ci] as Cell) !== Cell.WALL) return false;
  const tex = world.wallTex[ci] as Tex;
  return tex === FLESH_WALL_TEX_A || tex === FLESH_WALL_TEX_B;
}

function isLarvaBlock(world: World, ci: number): boolean {
  if ((world.cells[ci] as Cell) !== Cell.WALL) return false;
  const tex = world.wallTex[ci] as Tex;
  return tex === LARVA_BODY_TEX || tex === LARVA_HEAD_TEX;
}

function setLarvaCell(world: World, ci: number, head: boolean): void {
  world.cells[ci] = Cell.WALL;
  world.wallTex[ci] = head ? LARVA_HEAD_TEX : LARVA_BODY_TEX;
  world.floorTex[ci] = EATEN_FLOOR_TEX;
}

function setEatenCavity(world: World, ci: number): void {
  if (world.hermoWall[ci] !== 0 || world.aptMask[ci] !== 0 || world.doors.has(ci) || world.containerMap.has(ci)) return;
  if ((world.cells[ci] as Cell) === Cell.LIFT) return;
  world.cells[ci] = Cell.FLOOR;
  world.wallTex[ci] = FLESH_WALL_TEX_B;
  world.floorTex[ci] = EATEN_FLOOR_TEX;
}

function canGrowFlesh(world: World, ci: number, playerIdx: number): boolean {
  if (ci === playerIdx) return false;
  const cell = world.cells[ci] as Cell;
  if (cell !== Cell.FLOOR && cell !== Cell.WATER) return false;
  if (world.hermoWall[ci] !== 0 || world.aptMask[ci] !== 0 || world.doors.has(ci) || world.containerMap.has(ci)) return false;
  const feature = world.features[ci] as Feature;
  return feature === Feature.NONE || feature === Feature.LAMP;
}

function setFleshBlock(world: World, ci: number, seed: number): void {
  world.cells[ci] = Cell.WALL;
  world.wallTex[ci] = (seed & 3) === 0 ? FLESH_WALL_TEX_B : FLESH_WALL_TEX_A;
  world.floorTex[ci] = FLESH_FLOOR_TEX;
}

function initSnake(world: World): SnakeFieldRuntime | null {
  const cached = snakeByWorld.get(world);
  if (cached !== undefined) return cached;

  const snakes: SnakeRuntime[] = [];
  const seen = new Set<string>();
  for (const room of world.rooms) {
    WALL_SNAKE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WALL_SNAKE_RE.exec(room.name)) !== null) {
      if (snakes.length >= RUNTIME_TOPOLOGY_LIMITS.wallSnakeMaxSnakes) break;
      const x0 = Number(match[1]);
      const y0 = Number(match[2]);
      const w = Number(match[3]);
      const h = Number(match[4]);
      const key = `${x0}:${y0}:${w}:${h}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const perimeter = Math.max(0, Math.min(RUNTIME_TOPOLOGY_LIMITS.wallSnakeMaxPathCells, (w + h) * 2 - 4));
      if (perimeter < 18) continue;
      const controlIdx = perimeterPoint(world, x0, y0, w, h, 0);
      const pathCells: number[] = [];
      for (let i = 0; i < perimeter; i++) {
        const ci = perimeterPoint(world, x0, y0, w, h, i);
        if (!mutableSnakeCell(world, ci)) continue;
        pathCells.push(ci);
      }
      const count = pathCells.length;
      if (count < 18) continue;
      const path = Int32Array.from(pathCells);
      const body = new Int32Array(Math.min(RUNTIME_TOPOLOGY_LIMITS.wallSnakeMaxBodyCells, Math.max(12, 8 + Math.floor(count / 5))));
      const length = Math.min(body.length, 10 + Math.floor(count / 9));
      const snakeSeed = hash32(
        Math.imul(x0 + 1024, 73856093)
          ^ Math.imul(y0 + 1024, 19349663)
          ^ Math.imul(w, 83492791)
          ^ Math.imul(h, 2654435761)
          ^ snakes.length,
      );
      const direction: 1 | -1 = (snakeSeed & 1) === 0 ? 1 : -1;
      const stepSeconds = 0.24 + ((snakeSeed >>> 8) % 21) * 0.011 + Math.min(0.08, count * 0.0006);
      for (let i = 0; i < length; i++) {
        const pi = (count - direction * i) % count;
        body[i] = pi;
        setLarvaCell(world, path[pi], i === 0);
      }
      snakes.push({
        path,
        body,
        controlIdx,
        head: 0,
        length,
        direction,
        stepSeconds,
        stepAccum: ((snakeSeed >>> 16) / 0xffff) * stepSeconds,
        warnedUntil: 0,
        stoppedUntil: 0,
        lastMsgTime: -Infinity,
      });
    }
    if (snakes.length >= RUNTIME_TOPOLOGY_LIMITS.wallSnakeMaxSnakes) break;
  }

  if (snakes.length === 0) {
    snakeByWorld.set(world, null);
    return null;
  }

  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  const runtime = {
    snakes,
    growthAccum: 0,
    growthSeconds: WALL_SNAKE_TOPOLOGY_SECONDS,
    growthState: hash32(snakes.reduce((acc, snake) => acc ^ snake.path.length ^ snake.controlIdx, 0x51a4e)),
    topologyAccum: 0,
    topologySeconds: WALL_SNAKE_TOPOLOGY_SECONDS,
  };
  snakeByWorld.set(world, runtime);
  return runtime;
}

function bodyContains(snake: SnakeRuntime, pathIndex: number): boolean {
  for (let i = 0; i < snake.length; i++) {
    if (snake.body[i] === pathIndex) return true;
  }
  return false;
}

function snakeBodyAtCell(snake: SnakeRuntime, idx: number): boolean {
  for (let i = 0; i < snake.length; i++) {
    if (snake.path[snake.body[i]] === idx) return true;
  }
  return false;
}

function restoreTail(world: World, snake: SnakeRuntime): void {
  const tailSlot = snake.length - 1;
  const tailPathIndex = snake.body[tailSlot];
  if (tailPathIndex < 0) return;
  setEatenCavity(world, snake.path[tailPathIndex]);
}

function pushHead(world: World, snake: SnakeRuntime, nextHead: number): void {
  restoreTail(world, snake);
  for (let i = snake.length - 1; i > 0; i--) snake.body[i] = snake.body[i - 1];
  snake.body[0] = nextHead;
  snake.head = nextHead;
  if (snake.length > 1) setLarvaCell(world, snake.path[snake.body[1]], false);
  setLarvaCell(world, snake.path[nextHead], true);
}

function shrinkSnake(world: World, snake: SnakeRuntime, nextLength: number): boolean {
  const clamped = Math.max(6, Math.min(snake.length, nextLength));
  let changed = clamped !== snake.length;
  for (let i = clamped; i < snake.length; i++) {
    const pathIndex = snake.body[i];
    setEatenCavity(world, snake.path[pathIndex]);
    changed = true;
  }
  snake.length = clamped;
  return changed;
}

function markWallSnakeCellsDirty(world: World): void {
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
}

function playerOnPath(world: World, snake: SnakeRuntime, player: Entity, pathIndex: number): boolean {
  const ci = snake.path[pathIndex];
  return world.idx(Math.floor(player.x), Math.floor(player.y)) === ci;
}

function wallSnakeControlAt(world: World, snake: SnakeRuntime, lookIdx: number): boolean {
  return snake.controlIdx === lookIdx && (world.features[lookIdx] as Feature) === Feature.SCREEN;
}

function findSnakeTarget(world: World, runtime: SnakeFieldRuntime, lookIdx: number): SnakeRuntime | null {
  for (const snake of runtime.snakes) {
    if (wallSnakeControlAt(world, snake, lookIdx) || snakeBodyAtCell(snake, lookIdx)) return snake;
  }
  return null;
}

function hurtPlayer(player: Entity, state: GameState, amount: number): void {
  player.hp = Math.max(1, (player.hp ?? 100) - amount);
  if (player.needs) player.needs.sleep = Math.max(0, player.needs.sleep - amount * 0.15);
  state.msgs.push(msg(`Белая личинка жует проход под ногами: -${amount} HP. Ждите хвост или клиньте экран.`, state.time, '#f84'));
}

function runtimeRand(runtime: SnakeFieldRuntime): number {
  let x = runtime.growthState || 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  runtime.growthState = x >>> 0;
  return runtime.growthState;
}

function growOneFleshBlock(world: World, runtime: SnakeFieldRuntime, player: Entity): boolean {
  const playerIdx = world.idx(Math.floor(player.x), Math.floor(player.y));
  for (let attempt = 0; attempt < FLESH_GROWTH_ATTEMPTS; attempt++) {
    const r = runtimeRand(runtime);
    const snake = runtime.snakes[r % runtime.snakes.length];
    const sourcePathIndex = (r >>> 8) % snake.path.length;
    const sourceIdx = snake.path[sourcePathIndex];
    if (!isFleshBlock(world, sourceIdx)) continue;
    const direction = (r & 0x10000) === 0 ? 1 : -1;
    for (let side = 0; side < 2; side++) {
      const targetPathIndex = (sourcePathIndex + direction * (side + 1) + snake.path.length) % snake.path.length;
      const targetIdx = snake.path[targetPathIndex];
      if (snakeBodyAtCell(snake, targetIdx) || !canGrowFlesh(world, targetIdx, playerIdx)) continue;
      setFleshBlock(world, targetIdx, r ^ targetPathIndex);
      return true;
    }
  }
  return false;
}

function updateFleshGrowth(world: World, runtime: SnakeFieldRuntime, player: Entity, dt: number): boolean {
  runtime.growthAccum += dt;
  let steps = 0;
  let changed = false;
  while (runtime.growthAccum >= runtime.growthSeconds && steps < FLESH_GROWTH_MAX_STEPS) {
    runtime.growthAccum -= runtime.growthSeconds;
    changed = growOneFleshBlock(world, runtime, player) || changed;
    steps++;
  }
  return changed;
}

export function updateWallSnakeAnomaly(world: World, player: Entity, state: GameState, dt: number): void {
  if (!isPlayerEntity(player)) return;
  const runtime = initSnake(world);
  if (!runtime || runtime.snakes.length === 0) return;

  for (const snake of runtime.snakes) {
    if (state.time < snake.stoppedUntil) continue;
    for (let i = 0; i < snake.length; i++) {
      if (playerOnPath(world, snake, player, snake.body[i])) {
        if (state.time >= snake.warnedUntil) {
          hurtPlayer(player, state, 3);
          snake.warnedUntil = state.time + 1.0;
        }
        break;
      }
    }
  }

  runtime.topologyAccum += dt;
  if (runtime.topologyAccum < runtime.topologySeconds) return;
  const topologyDt = Math.min(runtime.topologyAccum, runtime.topologySeconds * 1.5);
  runtime.topologyAccum %= runtime.topologySeconds;

  let changed = updateFleshGrowth(world, runtime, player, topologyDt);
  for (const snake of runtime.snakes) {
    if (state.time < snake.stoppedUntil) continue;
    snake.stepAccum += topologyDt;
    if (snake.stepAccum < snake.stepSeconds) continue;
    snake.stepAccum %= snake.stepSeconds;

    let nextHead = (snake.head + snake.direction + snake.path.length) % snake.path.length;
    for (let turn = 0; turn < 4 && bodyContains(snake, nextHead); turn++) {
      nextHead = (nextHead + snake.direction + snake.path.length) % snake.path.length;
    }

    if (playerOnPath(world, snake, player, nextHead)) {
      if (state.time >= snake.warnedUntil) {
        hurtPlayer(player, state, 9);
        snake.warnedUntil = state.time + 1.0;
        if (state.time - snake.lastMsgTime > 3) {
          snake.lastMsgTime = state.time;
          state.msgs.push(msg('Черная голова личинки сминает вас на ходу.', state.time, '#fa4'));
        }
      }
    }

    pushHead(world, snake, nextHead);
    changed = true;
  }
  if (changed) markWallSnakeCellsDirty(world);
}

function removeOne(player: Entity, ids: readonly string[]): string {
  const inv = player.inventory;
  if (!inv) return '';
  for (const id of ids) {
    const item = inv.find(v => v.defId === id && v.count > 0);
    if (!item) continue;
    item.count--;
    if (item.count <= 0) inv.splice(inv.indexOf(item), 1);
    return id;
  }
  return '';
}

export function tryUseWallSnakeAnomaly(world: World, player: Entity, state: GameState, lookX: number, lookY: number): boolean {
  const runtime = initSnake(world);
  if (!runtime) return false;
  const lookIdx = world.idx(Math.floor(lookX), Math.floor(lookY));
  const snake = findSnakeTarget(world, runtime, lookIdx);
  const closeEnough = world.dist2(player.x, player.y, lookX, lookY) <= 5.8;
  if (!snake || !closeEnough) return false;

  const bait = removeOne(player, ['gear', 'spring', 'metal_sheet', 'bread', 'rawmeat', 'mushroom_mass']);
  if (bait) {
    snake.stoppedUntil = Math.max(snake.stoppedUntil, state.time + 7);
    if (shrinkSnake(world, snake, snake.length - 2)) markWallSnakeCellsDirty(world);
    state.msgs.push(msg('Приманка ушла в экран. Личинка застряла, побелела дугой и укоротилась.', state.time, '#8cf'));
  } else {
    snake.stoppedUntil = Math.max(snake.stoppedUntil, state.time + 2.5);
    state.msgs.push(msg('Экран щелкнул пустым зубом. Нужна железка, еда, сырое мясо или грибная масса.', state.time, '#fa4'));
  }
  return true;
}
