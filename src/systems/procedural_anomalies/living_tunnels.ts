import {
  W,
  Cell,
  Feature,
  Tex,
  msg,
  type Entity,
  type GameState,
  type WorldEventSeverity,
} from '../../core/types';
import { World } from '../../core/world';
import { RUNTIME_TOPOLOGY_LIMITS } from '../../data/runtime_topology';
import { consumeToolDurability, hasItem, removeItem } from '../inventory';
import { publishEvent } from '../events';
import { isPlayerEntity } from '../player_actor';
import { stampSurfaceSplat } from '../surface_marks';

const LIVING_TUNNEL_RE = /\[living_tunnel:(-?\d+),(-?\d+),(-?\d+),(\d+)\]/g;
const LIVING_TUNNEL_TICK_SECONDS = 0.42;
const PLAYER_CELL_PROTECT_R2 = 1.35 * 1.35;
const ROUTE_ANCHOR_PROTECT_RADIUS = 2;
const DIRS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
] as const;

interface TunnelCellSnapshot {
  cell: Cell;
  roomMap: number;
  wallTex: Tex;
  floorTex: Tex;
  feature: Feature;
  fog: number;
}

interface LivingTunnelRoot {
  x: number;
  y: number;
  dir: number;
  seed: number;
  age: number;
  maxLen: number;
  trail: number[][];
  controlIdx: number;
  stoppedUntil: number;
}

interface LivingTunnelRuntime {
  roots: LivingTunnelRoot[];
  refs: Map<number, number>;
  base: Map<number, TunnelCellSnapshot>;
  accum: number;
  nextMsgAt: number;
}

const runtimeByWorld = new WeakMap<World, LivingTunnelRuntime | null>();

function hash32(v: number): number {
  v |= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

function routeAnchorNearby(world: World, ci: number): boolean {
  const x = ci % W;
  const y = (ci / W) | 0;
  for (let dy = -ROUTE_ANCHOR_PROTECT_RADIUS; dy <= ROUTE_ANCHOR_PROTECT_RADIUS; dy++) {
    for (let dx = -ROUTE_ANCHOR_PROTECT_RADIUS; dx <= ROUTE_ANCHOR_PROTECT_RADIUS; dx++) {
      const ni = world.idx(x + dx, y + dy);
      if (world.cells[ni] === Cell.LIFT || world.features[ni] === Feature.LIFT_BUTTON) return true;
    }
  }
  return false;
}

function mutableTunnelCell(world: World, ci: number): boolean {
  const cell = world.cells[ci] as Cell;
  if (cell === Cell.LIFT || cell === Cell.DOOR || cell === Cell.ABYSS) return false;
  if (routeAnchorNearby(world, ci)) return false;
  if (world.hermoWall[ci] !== 0 || world.aptMask[ci] !== 0 || world.doors.has(ci) || world.containerMap.has(ci)) return false;
  const feature = world.features[ci] as Feature;
  if (feature === Feature.LIFT_BUTTON || feature === Feature.SCREEN || feature === Feature.APPARATUS) return false;
  if (feature !== Feature.NONE && feature !== Feature.LAMP) return false;
  return cell === Cell.FLOOR || cell === Cell.WALL || cell === Cell.WATER;
}

function parseRoots(world: World): LivingTunnelRoot[] {
  const roots: LivingTunnelRoot[] = [];
  for (const room of world.rooms) {
    if (!room.name.includes('[living_tunnel:')) continue;
    LIVING_TUNNEL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = LIVING_TUNNEL_RE.exec(room.name))) {
      if (roots.length >= RUNTIME_TOPOLOGY_LIMITS.livingTunnelsMaxRoots) return roots;
      const x = world.wrap(Number(match[1]));
      const y = world.wrap(Number(match[2]));
      const seed = Number(match[3]) >>> 0;
      const maxLen = Math.max(28, Math.min(RUNTIME_TOPOLOGY_LIMITS.livingTunnelsMaxTrailPatches, Number(match[4]) | 0));
      roots.push({
        x,
        y,
        dir: hash32(seed ^ room.id) & 3,
        seed,
        age: 0,
        maxLen,
        trail: [],
        controlIdx: world.idx(x, y),
        stoppedUntil: 0,
      });
    }
  }
  return roots;
}

function runtimeFor(world: World): LivingTunnelRuntime {
  const cached = runtimeByWorld.get(world);
  if (cached) return cached;
  if (cached === null) return { roots: [], refs: new Map(), base: new Map(), accum: 0, nextMsgAt: 0 };

  const roots = parseRoots(world);
  const runtime: LivingTunnelRuntime = {
    roots,
    refs: new Map(),
    base: new Map(),
    accum: 0,
    nextMsgAt: 0,
  };
  runtimeByWorld.set(world, roots.length > 0 ? runtime : null);
  return runtime;
}

function snapshotCell(world: World, ci: number): TunnelCellSnapshot {
  return {
    cell: world.cells[ci] as Cell,
    roomMap: world.roomMap[ci],
    wallTex: world.wallTex[ci] as Tex,
    floorTex: world.floorTex[ci] as Tex,
    feature: world.features[ci] as Feature,
    fog: world.fog[ci],
  };
}

function playerProtectsCell(world: World, player: Entity, ci: number): boolean {
  const x = ci % W;
  const y = (ci / W) | 0;
  return world.dist2(player.x, player.y, x + 0.5, y + 0.5) <= PLAYER_CELL_PROTECT_R2;
}

function restoreCell(world: World, player: Entity, state: GameState, runtime: LivingTunnelRuntime, ci: number): number {
  const snap = runtime.base.get(ci);
  runtime.base.delete(ci);
  if (!snap) return 0;

  if (isPlayerEntity(player) && playerProtectsCell(world, player, ci)) {
    world.cells[ci] = Cell.FLOOR;
    world.floorTex[ci] = Tex.F_GUT;
    world.fog[ci] = Math.max(world.fog[ci], 24);
    if (state.time >= runtime.nextMsgAt) {
      runtime.nextMsgAt = state.time + 5;
      player.hp = Math.max(1, (player.hp ?? 100) - 3);
      state.msgs.push(msg('Тоннель зарастает под ногами: бетон оставил живую царапину.', state.time, '#fa4'));
    }
    return 1;
  }

  world.cells[ci] = snap.cell;
  world.roomMap[ci] = snap.roomMap;
  world.wallTex[ci] = snap.wallTex;
  world.floorTex[ci] = snap.floorTex;
  world.setFeatureAt(ci, snap.feature);
  world.fog[ci] = snap.fog;
  return 1;
}

function addTunnelRef(world: World, runtime: LivingTunnelRuntime, ci: number): void {
  const refs = runtime.refs.get(ci) ?? 0;
  if (refs === 0) runtime.base.set(ci, snapshotCell(world, ci));
  runtime.refs.set(ci, refs + 1);
}

function carveTunnelCell(world: World, runtime: LivingTunnelRuntime, ci: number): boolean {
  if (!mutableTunnelCell(world, ci)) return false;
  addTunnelRef(world, runtime, ci);
  if (world.cells[ci] === Cell.WALL) world.roomMap[ci] = -1;
  world.cells[ci] = Cell.FLOOR;
  if (world.features[ci] === Feature.LAMP) world.setFeatureAt(ci, Feature.NONE);
  world.floorTex[ci] = Tex.F_GUT;
  world.wallTex[ci] = Tex.GUT;
  world.fog[ci] = Math.max(world.fog[ci], 24 + (ci & 15));
  return true;
}

function releasePatch(world: World, player: Entity, state: GameState, runtime: LivingTunnelRuntime, patch: readonly number[]): number {
  let changed = 0;
  for (const ci of patch) {
    const refs = runtime.refs.get(ci);
    if (refs === undefined) continue;
    if (refs > 1) {
      runtime.refs.set(ci, refs - 1);
      continue;
    }
    runtime.refs.delete(ci);
    changed += restoreCell(world, player, state, runtime, ci);
  }
  return changed;
}

function patchRadius(root: LivingTunnelRoot): number {
  return ((root.age + root.seed) & 31) === 0 ? 2 : 1;
}

function carvePatch(world: World, runtime: LivingTunnelRuntime, root: LivingTunnelRoot): number[] {
  const patch: number[] = [];
  const radius = patchRadius(root);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius + 1) continue;
      const ci = world.idx(root.x + dx, root.y + dy);
      if (patch.includes(ci)) continue;
      if (!carveTunnelCell(world, runtime, ci)) continue;
      patch.push(ci);
    }
  }
  return patch;
}

function canAdvanceTo(world: World, x: number, y: number): boolean {
  let open = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (mutableTunnelCell(world, world.idx(x + dx, y + dy))) open++;
    }
  }
  return open >= 3;
}

function nextDirection(root: LivingTunnelRoot): number[] {
  let dir = root.dir;
  const h = hash32(root.seed ^ Math.imul(root.age + 1, 0x45d9f3b));
  if ((h & 7) === 0) dir = (dir + ((h & 8) ? 1 : 3)) & 3;
  if ((h & 63) === 0) dir = (dir + 2) & 3;
  return [dir, (dir + 1) & 3, (dir + 3) & 3, (dir + 2) & 3];
}

function advanceRoot(world: World, player: Entity, state: GameState, runtime: LivingTunnelRuntime, root: LivingTunnelRoot): number {
  let chosen = -1;
  for (const dir of nextDirection(root)) {
    const d = DIRS[dir];
    if (!canAdvanceTo(world, root.x + d.x, root.y + d.y)) continue;
    chosen = dir;
    break;
  }
  if (chosen < 0) {
    root.dir = (root.dir + 1) & 3;
    root.age++;
    return 0;
  }

  const d = DIRS[chosen];
  root.dir = chosen;
  root.x = world.wrap(root.x + d.x);
  root.y = world.wrap(root.y + d.y);
  root.age++;

  let changed = 0;
  const patch = carvePatch(world, runtime, root);
  if (patch.length > 0) {
    root.trail.push(patch);
    changed += patch.length;
  }
  while (root.trail.length > root.maxLen) changed += releasePatch(world, player, state, runtime, root.trail.shift() ?? []);
  return changed;
}

function publishLivingTunnelUse(
  world: World,
  player: Entity,
  state: GameState,
  root: LivingTunnelRoot,
  method: string,
  severity: WorldEventSeverity,
  data: Record<string, unknown>,
): void {
  const ci = world.idx(Math.floor(player.x), Math.floor(player.y));
  publishEvent(state, {
    type: 'player_use_item',
    zoneId: world.zoneMap[ci],
    roomId: world.roomMap[ci],
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    itemId: method,
    itemName: method,
    severity,
    privacy: 'local',
    tags: ['player', 'procedural', 'anomaly', 'living_tunnels', 'topology', 'repair'],
    data: {
      rootX: root.controlIdx % W,
      rootY: (root.controlIdx / W) | 0,
      ...data,
    },
  });
}

function rootNearControl(
  world: World,
  runtime: LivingTunnelRuntime,
  player: Entity,
  lookX: number,
  lookY: number,
): LivingTunnelRoot | undefined {
  let best: LivingTunnelRoot | undefined;
  let bestD2 = 4;
  for (const root of runtime.roots) {
    const x = root.controlIdx % W;
    const y = (root.controlIdx / W) | 0;
    if (world.dist2(player.x, player.y, x + 0.5, y + 0.5) > 9) continue;
    const d2 = world.dist2(lookX, lookY, x + 0.5, y + 0.5);
    if (d2 >= bestD2) continue;
    bestD2 = d2;
    best = root;
  }
  return best;
}

function rootNearActiveCut(
  world: World,
  runtime: LivingTunnelRuntime,
  player: Entity,
  lookX: number,
  lookY: number,
): LivingTunnelRoot | undefined {
  let best: LivingTunnelRoot | undefined;
  let bestD2 = 2.25;
  for (const root of runtime.roots) {
    for (let trailIndex = root.trail.length - 1; trailIndex >= 0; trailIndex--) {
      const patch = root.trail[trailIndex];
      for (const ci of patch) {
        if (!runtime.refs.has(ci)) continue;
        const x = ci % W;
        const y = (ci / W) | 0;
        if (world.dist2(player.x, player.y, x + 0.5, y + 0.5) > 9) continue;
        const d2 = world.dist2(lookX, lookY, x + 0.5, y + 0.5);
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        best = root;
      }
    }
  }
  return best;
}

function clearOldTrail(world: World, player: Entity, state: GameState, runtime: LivingTunnelRuntime, root: LivingTunnelRoot, limit: number): number {
  let cleared = 0;
  const count = Math.min(root.trail.length, limit);
  for (let i = 0; i < count; i++) cleared += releasePatch(world, player, state, runtime, root.trail.shift() ?? []);
  return cleared;
}

function stampRepairScar(world: World, root: LivingTunnelRoot, state: GameState, cleared: number, method: string): void {
  if (cleared <= 0 && method === 'bare_hands') return;
  const x = root.controlIdx % W;
  const y = (root.controlIdx / W) | 0;
  const sealed = method === 'sealant_tube';
  stampSurfaceSplat(
    world,
    x,
    y,
    0.5,
    0.5,
    sealed ? 0.58 : 0.42,
    sealed ? 0.74 : 0.48,
    root.seed ^ Math.floor(state.time * 10) ^ cleared,
    sealed ? 174 : 128,
    sealed ? 190 : 142,
    sealed ? 166 : 128,
    false,
  );
}

export function updateLivingTunnelsAnomaly(world: World, player: Entity, state: GameState, dt: number): void {
  if (!isPlayerEntity(player)) return;
  const runtime = runtimeFor(world);
  if (runtime.roots.length === 0) return;

  runtime.accum += dt;
  if (runtime.accum < LIVING_TUNNEL_TICK_SECONDS) return;
  const steps = Math.min(4, Math.floor(runtime.accum / LIVING_TUNNEL_TICK_SECONDS));
  runtime.accum %= LIVING_TUNNEL_TICK_SECONDS;

  let changed = 0;
  for (let step = 0; step < steps; step++) {
    for (const root of runtime.roots) {
      if (state.time < root.stoppedUntil) continue;
      changed += advanceRoot(world, player, state, runtime, root);
    }
  }

  if (changed > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFeaturesDirty(true);
    world.markFogDirty();
  }

  if (changed > 18 && state.time >= runtime.nextMsgAt) {
    const near = runtime.roots.some(root => world.dist2(player.x, player.y, root.x + 0.5, root.y + 0.5) < 80 * 80);
    if (near) {
      runtime.nextMsgAt = state.time + 11;
      state.msgs.push(msg(`Живые тоннели шевелятся: ${runtime.roots.length} узл., ${runtime.refs.size} открытых клеток.`, state.time, '#8fa'));
    }
  }
}

export function livingTunnelsInteractionTargetId(world: World, lookX: number, lookY: number): number | null {
  const runtime = runtimeFor(world);
  for (const root of runtime.roots) {
    const x = root.controlIdx % W;
    const y = (root.controlIdx / W) | 0;
    if (world.dist2(lookX, lookY, x + 0.5, y + 0.5) <= 4) return root.controlIdx + 560000;
  }
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ci = world.idx(x + dx, y + dy);
      if (runtime.refs.has(ci)) return ci + 560000;
    }
  }
  return null;
}

export function tryUseLivingTunnelsAnomaly(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const runtime = runtimeFor(world);
  if (runtime.roots.length === 0) return false;
  const root = rootNearControl(world, runtime, player, lookX, lookY) ?? rootNearActiveCut(world, runtime, player, lookX, lookY);
  if (!root) return false;

  let method = 'bare_hands';
  let duration = 6;
  let severity: WorldEventSeverity = 3;
  if (hasItem(player, 'sealant_tube')) {
    removeItem(player, 'sealant_tube', 1);
    method = 'sealant_tube';
    duration = 42;
    severity = 4;
  } else if (player.tool === 'jackhammer' || player.tool === 'uv_spotlight') {
    method = player.tool;
    consumeToolDurability(player, player.tool === 'jackhammer' ? 1 : 2, state.msgs, state.time, state);
    duration = player.tool === 'jackhammer' ? 24 : 18;
  } else {
    player.hp = Math.max(1, (player.hp ?? 100) - 4);
  }

  const cleared = clearOldTrail(world, player, state, runtime, root, method === 'bare_hands' ? 8 : 28);
  stampRepairScar(world, root, state, cleared, method);
  root.stoppedUntil = Math.max(root.stoppedUntil, state.time + duration);
  world.markCellsDirty();
  world.markWallTexDirty();
  world.markFloorTexDirty();
  world.markFeaturesDirty(true);
  world.markFogDirty();

  if (method === 'sealant_tube') {
    state.msgs.push(msg(`Герметик схватил живой узел. Старые ходы слиплись: ${cleared} кл.`, state.time, '#8cf'));
  } else if (method === 'jackhammer' || method === 'uv_spotlight') {
    state.msgs.push(msg(`Узел сбит с ритма. Тоннель замер и зарастил ${cleared} кл.`, state.time, '#8cf'));
  } else {
    state.msgs.push(msg('Голыми руками узел только вздрогнул. Бетон укусил кожу.', state.time, '#fa4'));
  }

  publishLivingTunnelUse(world, player, state, root, method, severity, {
    stoppedSeconds: duration,
    clearedCells: cleared,
  });
  return true;
}
