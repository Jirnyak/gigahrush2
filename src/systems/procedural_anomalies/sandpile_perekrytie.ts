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
import { ITEMS } from '../../data/catalog';
import { RUNTIME_TOPOLOGY_LIMITS } from '../../data/runtime_topology';
import { hasItem, removeItem } from '../inventory';
import { publishEvent } from '../events';
import { isPlayerEntity } from '../player_actor';

interface SandpileArena {
  roomId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  seed: number;
  orientation: number;
  controlX: number;
  controlY: number;
  controlIdx: number;
  stress: Uint8Array;
  collapseAt: number;
  stableUntil: number;
  lastHintAt: number;
  collapsed: boolean;
}

interface SandpileRuntime {
  arenas: SandpileArena[];
}

const SANDPILE_RE = /\[sandpile_perekrytie:(-?\d+),(-?\d+),(\d+),(\d+),(\d+),([01]),(-?\d+),(-?\d+)\]/g;
const COLLAPSE_DELAY_SECONDS = 4.25;
const STABILIZE_SECONDS = 90;
const MANUAL_STABILIZE_SECONDS = 28;
const ROUTE_ANCHOR_PROTECT_RADIUS = 3;
const STABILIZER_ITEMS = ['metal_sheet', 'sealant_tube', 'gear'] as const;
const runtimeByWorld = new WeakMap<World, SandpileRuntime | null>();

function hash32(v: number): number {
  v |= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

function localIndex(w: number, lx: number, ly: number): number {
  return ly * w + lx;
}

function sample01(seed: number, lx: number, ly: number): number {
  return hash32(seed ^ Math.imul(lx + 37, 0x9e3779b1) ^ Math.imul(ly + 17, 0x85ebca6b)) / 4294967296;
}

function buildSandpileStress(w: number, h: number, seed: number): Uint8Array {
  const values = new Uint8Array(w * h);
  const topples = new Uint8Array(w * h);
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const maxRadius = Math.max(1, Math.min(w, h) * 0.5);

  for (let ly = 1; ly < h - 1; ly++) {
    for (let lx = 1; lx < w - 1; lx++) {
      const radial = Math.max(0, 3 - Math.floor(Math.hypot(lx - cx, ly - cy) / maxRadius * 4));
      values[localIndex(w, lx, ly)] = 1 + Math.floor(sample01(seed, lx, ly) * 5) + radial;
    }
  }

  const piles = [
    [Math.floor(cx), Math.floor(cy), 18],
    [Math.max(2, Math.floor(w * 0.3)), Math.max(2, Math.floor(h * 0.38)), 9],
    [Math.min(w - 3, Math.floor(w * 0.72)), Math.min(h - 3, Math.floor(h * 0.66)), 9],
  ] as const;
  for (const [lx, ly, grains] of piles) values[localIndex(w, lx, ly)] += grains;

  for (let pass = 0; pass < 128; pass++) {
    let changed = false;
    for (let ly = 1; ly < h - 1; ly++) {
      for (let lx = 1; lx < w - 1; lx++) {
        const i = localIndex(w, lx, ly);
        if (values[i] < 4) continue;
        values[i] -= 4;
        topples[i] = Math.min(15, topples[i] + 1);
        values[localIndex(w, lx + 1, ly)]++;
        values[localIndex(w, lx - 1, ly)]++;
        values[localIndex(w, lx, ly + 1)]++;
        values[localIndex(w, lx, ly - 1)]++;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const stress = new Uint8Array(w * h);
  for (let i = 0; i < stress.length; i++) stress[i] = Math.min(15, values[i] + topples[i] * 2);
  return stress;
}

function localPoint(world: World, arena: Pick<SandpileArena, 'x' | 'y' | 'w' | 'h'>, x: number, y: number): { x: number; y: number } {
  return {
    x: ((world.delta(arena.x, x) % arena.w) + arena.w) % arena.w,
    y: ((world.delta(arena.y, y) % arena.h) + arena.h) % arena.h,
  };
}

function arenaIdx(world: World, arena: Pick<SandpileArena, 'x' | 'y'>, lx: number, ly: number): number {
  return world.idx(arena.x + lx, arena.y + ly);
}

function isRim(arena: Pick<SandpileArena, 'w' | 'h'>, lx: number, ly: number): boolean {
  return lx === 0 || ly === 0 || lx === arena.w - 1 || ly === arena.h - 1;
}

function isSeam(arena: Pick<SandpileArena, 'w' | 'h' | 'orientation'>, lx: number, ly: number): boolean {
  if (arena.orientation === 0) return lx === Math.floor(arena.w / 2) && ly >= 2 && ly <= arena.h - 3;
  return ly === Math.floor(arena.h / 2) && lx >= 2 && lx <= arena.w - 3;
}

function unstableCollapseCell(arena: SandpileArena, lx: number, ly: number): boolean {
  if (isRim(arena, lx, ly) || isSeam(arena, lx, ly)) return false;
  return arena.stress[localIndex(arena.w, lx, ly)] >= 6;
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

function mutableSlabCell(world: World, ci: number): boolean {
  const cell = world.cells[ci] as Cell;
  if (cell === Cell.LIFT || cell === Cell.DOOR || cell === Cell.ABYSS) return false;
  if (routeAnchorNearby(world, ci)) return false;
  if (world.hermoWall[ci] !== 0 || world.aptMask[ci] !== 0 || world.doors.has(ci) || world.containerMap.has(ci)) return false;
  const feature = world.features[ci] as Feature;
  if (feature === Feature.LIFT_BUTTON || feature === Feature.SCREEN || feature === Feature.APPARATUS) return false;
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.WALL;
}

function detectCollapsed(world: World, arena: Omit<SandpileArena, 'collapsed'>): boolean {
  let abyss = 0;
  for (let ly = 1; ly < arena.h - 1; ly++) {
    for (let lx = 1; lx < arena.w - 1; lx++) {
      if (!unstableCollapseCell(arena as SandpileArena, lx, ly)) continue;
      if (world.cells[arenaIdx(world, arena, lx, ly)] === Cell.ABYSS) abyss++;
      if (abyss >= 4) return true;
    }
  }
  return false;
}

function parseArenas(world: World): SandpileArena[] {
  const arenas: SandpileArena[] = [];
  for (const room of world.rooms) {
    if (!room?.name.includes('[sandpile_perekrytie:')) continue;
    SANDPILE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SANDPILE_RE.exec(room.name))) {
      if (arenas.length >= RUNTIME_TOPOLOGY_LIMITS.sandpileMaxArenas) return arenas;
      const x = world.wrap(Number(match[1]));
      const y = world.wrap(Number(match[2]));
      const w = Math.max(8, Math.min(40, Number(match[3]) | 0));
      const h = Math.max(8, Math.min(32, Number(match[4]) | 0));
      if (w * h > RUNTIME_TOPOLOGY_LIMITS.sandpileMaxArenaCells) continue;
      const seed = Number(match[5]) >>> 0;
      const orientation = Number(match[6]) === 1 ? 1 : 0;
      const controlX = Math.max(0, Math.min(w - 1, Number(match[7]) | 0));
      const controlY = Math.max(0, Math.min(h - 1, Number(match[8]) | 0));
      const arena = {
        roomId: room.id,
        x,
        y,
        w,
        h,
        seed,
        orientation,
        controlX,
        controlY,
        controlIdx: world.idx(x + controlX, y + controlY),
        stress: buildSandpileStress(w, h, seed),
        collapseAt: 0,
        stableUntil: 0,
        lastHintAt: -Infinity,
        collapsed: false,
      };
      arena.collapsed = detectCollapsed(world, arena);
      arenas.push(arena);
    }
  }
  return arenas;
}

function runtimeFor(world: World): SandpileRuntime {
  const cached = runtimeByWorld.get(world);
  if (cached) return cached;
  if (cached === null) return { arenas: [] };
  const arenas = parseArenas(world);
  const runtime = { arenas };
  runtimeByWorld.set(world, arenas.length > 0 ? runtime : null);
  return runtime;
}

function insideArena(world: World, arena: SandpileArena, x: number, y: number): boolean {
  const dx = world.delta(arena.x, x);
  const dy = world.delta(arena.y, y);
  return dx >= 0 && dy >= 0 && dx < arena.w && dy < arena.h;
}

function passableSafeCell(world: World, ci: number): boolean {
  const x = ci % W;
  const y = (ci / W) | 0;
  const cell = world.cells[ci] as Cell;
  return (cell === Cell.FLOOR || cell === Cell.WATER) &&
    world.hermoWall[ci] === 0 &&
    world.aptMask[ci] === 0 &&
    !world.doors.has(ci) &&
    !world.solid(x, y);
}

function nearestRimSafeCell(world: World, arena: SandpileArena, x: number, y: number): { x: number; y: number } | null {
  let best: { x: number; y: number; d2: number } | null = null;
  for (let ly = 0; ly < arena.h; ly++) {
    for (let lx = 0; lx < arena.w; lx++) {
      if (!isRim(arena, lx, ly) && lx !== arena.controlX && ly !== arena.controlY) continue;
      const ci = arenaIdx(world, arena, lx, ly);
      if (!passableSafeCell(world, ci)) continue;
      const wx = world.wrap(arena.x + lx);
      const wy = world.wrap(arena.y + ly);
      const d2 = world.dist2(x + 0.5, y + 0.5, wx + 0.5, wy + 0.5);
      if (!best || d2 < best.d2) best = { x: wx, y: wy, d2 };
    }
  }
  return best;
}

function arenaAt(world: World, lookX: number, lookY: number): { arena: SandpileArena; lx: number; ly: number; ci: number } | null {
  const runtime = runtimeFor(world);
  const x = world.wrap(Math.floor(lookX));
  const y = world.wrap(Math.floor(lookY));
  const ci = world.idx(x, y);
  for (const arena of runtime.arenas) {
    if (!insideArena(world, arena, x, y)) continue;
    const p = localPoint(world, arena, x, y);
    return { arena, lx: p.x, ly: p.y, ci };
  }
  return null;
}

function stabilizerItem(player: Entity): string {
  for (const itemId of STABILIZER_ITEMS) if (hasItem(player, itemId)) return itemId;
  return '';
}

function publishSandpileEvent(
  world: World,
  player: Entity,
  state: GameState,
  arena: SandpileArena,
  outcome: string,
  severity: WorldEventSeverity,
  extra: Record<string, unknown> = {},
): void {
  const ci = world.idx(Math.floor(player.x), Math.floor(player.y));
  publishEvent(state, {
    type: outcome === 'collapsed' ? 'collateral_damage' : 'player_use_item',
    zoneId: world.zoneMap[ci],
    roomId: world.roomMap[ci],
    x: player.x,
    y: player.y,
    actorId: player.id,
    actorName: player.name ?? 'Вы',
    actorFaction: player.faction,
    severity,
    privacy: 'local',
    tags: ['player', 'procedural', 'anomaly', 'sandpile_perekrytie', 'collapse', outcome],
    data: {
      arenaX: arena.x,
      arenaY: arena.y,
      arenaW: arena.w,
      arenaH: arena.h,
      ...extra,
    },
  });
}

function collapseArena(world: World, player: Entity, state: GameState, arena: SandpileArena): void {
  let collapsedCells = 0;
  let openedSeamCells = 0;
  let featureDirty = false;
  const px = world.wrap(Math.floor(player.x));
  const py = world.wrap(Math.floor(player.y));
  let protectedIdx = -1;
  if (insideArena(world, arena, px, py)) {
    const p = localPoint(world, arena, px, py);
    if (unstableCollapseCell(arena, p.x, p.y)) {
      const safe = nearestRimSafeCell(world, arena, px, py);
      if (safe) {
        player.x = safe.x + 0.5;
        player.y = safe.y + 0.5;
        player.hp = Math.max(1, (player.hp ?? 100) - 7);
        state.dmgFlash = Math.max(state.dmgFlash ?? 0, 0.4);
        state.msgs.push(msg('Плита ушла вниз. Вы выскочили на несущий край, но бетон ударил по ребрам.', state.time, '#fa4'));
      } else {
        protectedIdx = world.idx(px, py);
        player.hp = Math.max(1, (player.hp ?? 100) - 10);
        state.msgs.push(msg('Перекрытие просело, оставив под вами один дрожащий остров бетона.', state.time, '#f84'));
      }
    }
  }

  for (let ly = 1; ly < arena.h - 1; ly++) {
    for (let lx = 1; lx < arena.w - 1; lx++) {
      const ci = arenaIdx(world, arena, lx, ly);
      if (ci === protectedIdx || !mutableSlabCell(world, ci)) continue;
      if (isSeam(arena, lx, ly)) {
        if (world.cells[ci] !== Cell.FLOOR) {
          world.cells[ci] = Cell.FLOOR;
          openedSeamCells++;
        }
        world.wallTex[ci] = Tex.METAL;
        world.floorTex[ci] = Tex.F_TILE;
        world.fog[ci] = Math.max(world.fog[ci], 34);
        continue;
      }
      if (!unstableCollapseCell(arena, lx, ly)) continue;
      if (world.features[ci] !== Feature.NONE) {
        world.features[ci] = Feature.NONE;
        featureDirty = true;
      }
      world.cells[ci] = Cell.ABYSS;
      world.wallTex[ci] = Tex.DARK;
      world.floorTex[ci] = Tex.F_ABYSS;
      world.fog[ci] = Math.max(world.fog[ci], 58);
      collapsedCells++;
    }
  }

  arena.collapsed = true;
  arena.collapseAt = 0;
  if (collapsedCells > 0 || openedSeamCells > 0) {
    world.markCellsDirty();
    world.markWallTexDirty();
    world.markFloorTexDirty();
    world.markFogDirty();
    if (featureDirty) world.markFeaturesDirty(false);
  }
  state.msgs.push(msg('Песчаное перекрытие осыпалось. Средина стала провалом, зато старая перемычка легла коротким мостом.', state.time, '#fc6'));
  publishSandpileEvent(world, player, state, arena, 'collapsed', 4, { collapsedCells, openedSeamCells });
}

export function updateSandpilePerekrytieAnomaly(world: World, player: Entity, state: GameState, _dt: number): void {
  if (!isPlayerEntity(player)) return;
  const runtime = runtimeFor(world);
  if (runtime.arenas.length === 0) return;
  const px = world.wrap(Math.floor(player.x));
  const py = world.wrap(Math.floor(player.y));
  for (const arena of runtime.arenas) {
    if (arena.collapsed) continue;
    if (arena.collapseAt > 0 && state.time >= arena.collapseAt) {
      collapseArena(world, player, state, arena);
      return;
    }
    if (!insideArena(world, arena, px, py)) continue;
    const p = localPoint(world, arena, px, py);
    if (!unstableCollapseCell(arena, p.x, p.y)) continue;
    if (state.time - arena.lastHintAt < 7) continue;
    arena.lastHintAt = state.time;
    const stable = state.time < arena.stableUntil;
    state.msgs.push(msg(stable
      ? 'Под ногами песчаная плита, но свежая распорка держит трещины.'
      : 'Под ногами хрустит песчаная плита. Нужен край, распорка или осознанный обвал.',
    state.time, stable ? '#8cf' : '#fa4'));
    return;
  }
}

function stabilizeArena(world: World, player: Entity, state: GameState, arena: SandpileArena): boolean {
  if (arena.collapsed) {
    state.msgs.push(msg('Стабилизатор показывает пустоту: это перекрытие уже ушло вниз.', state.time, '#888'));
    return true;
  }

  const itemId = stabilizerItem(player);
  const seconds = itemId ? STABILIZE_SECONDS : MANUAL_STABILIZE_SECONDS;
  if (itemId) removeItem(player, itemId, 1);
  arena.stableUntil = Math.max(arena.stableUntil, state.time + seconds);
  arena.collapseAt = 0;
  const item = itemId ? ITEMS[itemId] : undefined;
  state.msgs.push(msg(itemId
    ? `${item?.name ?? itemId} ушла в распорку. Плита держится дольше.`
    : 'Рычаг стабилизатора поймал плиту вручную, но без металла это ненадолго.',
  state.time, itemId ? '#8cf' : '#fa4'));
  publishSandpileEvent(world, player, state, arena, itemId ? 'stabilized_item' : 'stabilized_manual', itemId ? 2 : 1, {
    itemId: itemId || undefined,
    seconds,
  });
  return true;
}

function triggerArena(world: World, player: Entity, state: GameState, arena: SandpileArena): boolean {
  if (arena.collapsed) {
    state.msgs.push(msg('Под плитой уже открыт провал. Остался только край и короткая бетонная перемычка.', state.time, '#888'));
    return true;
  }
  if (state.time < arena.stableUntil) {
    const left = Math.max(1, Math.ceil(arena.stableUntil - state.time));
    state.msgs.push(msg(`Распорка еще держит песчаную плиту: примерно ${left} с.`, state.time, '#8cf'));
    return true;
  }
  if (arena.collapseAt > state.time) {
    const left = Math.max(1, Math.ceil(arena.collapseAt - state.time));
    state.msgs.push(msg(`Песок уже пошел вниз. Обвал через ${left} с.`, state.time, '#fa4'));
    return true;
  }
  arena.collapseAt = state.time + COLLAPSE_DELAY_SECONDS;
  state.msgs.push(msg('Вы добили критическую трещину. До обвала несколько секунд: уйдите на край или к стабилизатору.', state.time, '#f84'));
  publishSandpileEvent(world, player, state, arena, 'triggered', 3, { collapseDelaySeconds: COLLAPSE_DELAY_SECONDS });
  return true;
}

export function sandpilePerekrytieInteractionTargetId(world: World, lookX: number, lookY: number): number | null {
  const target = arenaAt(world, lookX, lookY);
  if (!target) return null;
  if (target.ci === target.arena.controlIdx) return target.ci + 585000;
  if (!target.arena.collapsed && (unstableCollapseCell(target.arena, target.lx, target.ly) || isSeam(target.arena, target.lx, target.ly))) {
    return target.ci + 585000;
  }
  return null;
}

export function tryUseSandpilePerekrytieAnomaly(
  world: World,
  player: Entity,
  state: GameState,
  lookX: number,
  lookY: number,
): boolean {
  const target = arenaAt(world, lookX, lookY);
  if (!target) return false;
  if (target.ci === target.arena.controlIdx) return stabilizeArena(world, player, state, target.arena);
  if (unstableCollapseCell(target.arena, target.lx, target.ly) || isSeam(target.arena, target.lx, target.ly)) {
    return triggerArena(world, player, state, target.arena);
  }
  return false;
}
