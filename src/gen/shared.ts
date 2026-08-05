/* ── Shared maze generation utilities ─────────────────────────── */

import {
  W,
  Cell,
  Tex,
  RoomType,
  DoorState,
  Feature,
  ZoneFaction,
  LiftDirection,
  type Room,
  type Zone,
} from '../core/types';
import { World } from '../core/world';
import { irandFrom, pickFrom, shuffleWith, type RandomSource } from '../core/rand';
import { ROOM_DEFS } from '../data/catalog';

/* ── RNG helpers ─────────────────────────────────────────────── */
export const rng = (lo: number, hi: number, rand: RandomSource = Math.random): number => irandFrom(rand, lo, hi);
export const pick = <T>(a: readonly T[], rand: RandomSource = Math.random): T => pickFrom(rand, a);
export const shuffle = <T>(a: T[], rand: RandomSource = Math.random): T[] => shuffleWith(rand, a);

export type ArrivalSpawnReason =
  | 'matched_lift'
  | 'fallback_any_lift'
  | 'fallback_same_xy'
  | 'fallback_near_same_xy'
  | 'fallback_generator_spawn'
  | 'fallback_near_generator_spawn'
  | 'fallback_first_passable'
  | 'fallback_forced_generator_spawn';

export interface ArrivalSpawnResolution {
  x: number;
  y: number;
  angle?: number;
  reason: ArrivalSpawnReason;
  fallback: boolean;
  debug: string;
  preferredLiftDirection?: LiftDirection;
  liftDirection?: LiftDirection;
  anchorX?: number;
  anchorY?: number;
  spawnCell: number;
  anchorCell?: number;
}

export interface ArrivalSpawnOptions {
  preferredLiftDirection?: LiftDirection;
  referenceX?: unknown;
  referenceY?: unknown;
  fallbackX: number;
  fallbackY: number;
  searchRadius?: number;
}

interface ArrivalCandidate {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  anchorCell: number;
  liftDirection: LiftDirection;
  kind: 'lift';
  score: number;
}

interface AnchorSearch {
  candidate: ArrivalCandidate | null;
  anchors: number;
  passableAdjacent: number;
  unreachableAdjacent: number;
}

export function oppositeLiftDirection(direction: LiftDirection): LiftDirection {
  return direction === LiftDirection.DOWN ? LiftDirection.UP : LiftDirection.DOWN;
}

export function routeArrivalLiftDirection(travelDirection: LiftDirection, canContinueRoute: boolean): LiftDirection {
  return canContinueRoute ? travelDirection : oppositeLiftDirection(travelDirection);
}

function liftDirectionName(direction: LiftDirection | undefined): string {
  if (direction === LiftDirection.UP) return 'up';
  if (direction === LiftDirection.DOWN) return 'down';
  return 'any';
}

function finiteNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function passableArrivalCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  const cell = world.cells[ci];
  return (cell === Cell.FLOOR || cell === Cell.WATER) && !world.solid(x, y);
}

function walkableArrivalPathCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  const cell = world.cells[ci];
  return (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR) && !world.solid(x, y);
}

function findFirstPassableCell(world: World): number {
  for (let i = 0; i < W * W; i++) {
    if (passableArrivalCell(world, i % W, (i / W) | 0)) return i;
  }
  return -1;
}

function nearestPassableCell(world: World, x: number, y: number, radius: number): number {
  const sx = world.wrap(Math.floor(x));
  const sy = world.wrap(Math.floor(y));
  if (passableArrivalCell(world, sx, sy)) return world.idx(sx, sy);

  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const px = world.wrap(sx + dx);
        const py = world.wrap(sy + dy);
        if (passableArrivalCell(world, px, py)) return world.idx(px, py);
      }
    }
  }

  return -1;
}

function reachableArrivalCells(world: World, fallbackX: number, fallbackY: number, radius: number): Uint8Array | null {
  let seed = nearestPassableCell(world, fallbackX, fallbackY, radius);
  if (seed < 0) seed = findFirstPassableCell(world);
  if (seed < 0) return null;

  const reachable = new Uint8Array(W * W);
  const queue = new Int32Array(W * W);
  let head = 0;
  let tail = 0;
  reachable[seed] = 1;
  queue[tail++] = seed;

  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const nx = world.wrap(x + dx);
      const ny = world.wrap(y + dy);
      const ni = world.idx(nx, ny);
      if (reachable[ni] || !walkableArrivalPathCell(world, nx, ny)) continue;
      reachable[ni] = 1;
      queue[tail++] = ni;
    }
  }

  return reachable;
}

function candidateAngle(world: World, x: number, y: number, anchorX: number, anchorY: number): number {
  const dx = world.delta(x + 0.5, anchorX + 0.5);
  const dy = world.delta(y + 0.5, anchorY + 0.5);
  return Math.atan2(dy, dx);
}

function resolveFromCell(
  _world: World,
  cell: number,
  reason: ArrivalSpawnReason,
  debug: string,
  fallback: boolean,
  preferredLiftDirection?: LiftDirection,
): ArrivalSpawnResolution {
  const x = cell % W;
  const y = (cell / W) | 0;
  return {
    x: x + 0.5,
    y: y + 0.5,
    reason,
    fallback,
    debug,
    preferredLiftDirection,
    spawnCell: cell,
  };
}

function resolveFromCandidate(
  world: World,
  candidate: ArrivalCandidate,
  reason: ArrivalSpawnReason,
  debug: string,
  fallback: boolean,
  preferredLiftDirection?: LiftDirection,
): ArrivalSpawnResolution {
  const spawnCell = world.idx(candidate.x, candidate.y);
  return {
    x: candidate.x + 0.5,
    y: candidate.y + 0.5,
    angle: candidateAngle(world, candidate.x, candidate.y, candidate.anchorX, candidate.anchorY),
    reason,
    fallback,
    debug,
    preferredLiftDirection,
    liftDirection: candidate.liftDirection,
    anchorX: candidate.anchorX,
    anchorY: candidate.anchorY,
    spawnCell,
    anchorCell: candidate.anchorCell,
  };
}

function searchArrivalAnchors(
  world: World,
  reachable: Uint8Array | null,
  referenceX: number,
  referenceY: number,
  direction?: LiftDirection,
): AnchorSearch {
  let best: ArrivalCandidate | null = null;
  const out: AnchorSearch = { candidate: null, anchors: 0, passableAdjacent: 0, unreachableAdjacent: 0 };

  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.LIFT) continue;
    const liftDirection = world.liftDir[i] as LiftDirection;
    if (direction !== undefined && liftDirection !== direction) continue;

    out.anchors++;
    const anchorX = i % W;
    const anchorY = (i / W) | 0;

    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const x = world.wrap(anchorX + dx);
      const y = world.wrap(anchorY + dy);
      const ci = world.idx(x, y);
      if (!passableArrivalCell(world, x, y)) continue;
      out.passableAdjacent++;
      if (reachable && !reachable[ci]) {
        out.unreachableAdjacent++;
        continue;
      }

      const anchorD2 = world.dist2(referenceX, referenceY, anchorX + 0.5, anchorY + 0.5);
      const spawnD2 = world.dist2(referenceX, referenceY, x + 0.5, y + 0.5);
      const score = anchorD2 * 4 + spawnD2;
      if (!best || score < best.score) {
        best = { x, y, anchorX, anchorY, anchorCell: i, liftDirection, kind: 'lift', score };
      }
    }
  }

  out.candidate = best;
  return out;
}

export function resolveArrivalSpawn(world: World, options: ArrivalSpawnOptions): ArrivalSpawnResolution {
  const radius = options.searchRadius ?? 48;
  const fallbackX = Number.isFinite(options.fallbackX) ? options.fallbackX : W / 2 + 0.5;
  const fallbackY = Number.isFinite(options.fallbackY) ? options.fallbackY : W / 2 + 0.5;
  const referenceX = finiteNumber(options.referenceX) ?? fallbackX;
  const referenceY = finiteNumber(options.referenceY) ?? fallbackY;
  const reachable = reachableArrivalCells(world, fallbackX, fallbackY, radius);
  const preferred = options.preferredLiftDirection;

  if (preferred !== undefined) {
    const match = searchArrivalAnchors(world, reachable, referenceX, referenceY, preferred);
    if (match.candidate) {
      return resolveFromCandidate(
        world,
        match.candidate,
        'matched_lift',
        `matched ${liftDirectionName(preferred)} ${match.candidate.kind}`,
        false,
        preferred,
      );
    }
  }

  const any = searchArrivalAnchors(world, reachable, referenceX, referenceY);
  if (any.candidate) {
    return resolveFromCandidate(
      world,
      any.candidate,
      'fallback_any_lift',
      `no reachable ${liftDirectionName(preferred)} lift; used ${liftDirectionName(any.candidate.liftDirection)} ${any.candidate.kind}`,
      true,
      preferred,
    );
  }

  const savedX = finiteNumber(options.referenceX);
  const savedY = finiteNumber(options.referenceY);
  if (savedX !== undefined && savedY !== undefined) {
    const sx = world.wrap(Math.floor(savedX));
    const sy = world.wrap(Math.floor(savedY));
    if (passableArrivalCell(world, sx, sy)) {
      return resolveFromCell(
        world,
        world.idx(sx, sy),
        'fallback_same_xy',
        'no lift anchors; used same cell near saved xy',
        true,
        preferred,
      );
    }
    const nearSaved = nearestPassableCell(world, savedX, savedY, radius);
    if (nearSaved >= 0) {
      return resolveFromCell(
        world,
        nearSaved,
        'fallback_near_same_xy',
        'no lift anchors; used nearest passable cell near saved xy',
        true,
        preferred,
      );
    }
  }

  const fx = world.wrap(Math.floor(fallbackX));
  const fy = world.wrap(Math.floor(fallbackY));
  if (passableArrivalCell(world, fx, fy)) {
    return resolveFromCell(
      world,
      world.idx(fx, fy),
      'fallback_generator_spawn',
      'no lift anchors; used generator spawn',
      true,
      preferred,
    );
  }
  const nearFallback = nearestPassableCell(world, fallbackX, fallbackY, radius);
  if (nearFallback >= 0) {
    return resolveFromCell(
      world,
      nearFallback,
      'fallback_near_generator_spawn',
      'no lift anchors; used nearest passable cell near generator spawn',
      true,
      preferred,
    );
  }
  const first = findFirstPassableCell(world);
  if (first >= 0) {
    return resolveFromCell(
      world,
      first,
      'fallback_first_passable',
      'no lift anchors or generator spawn; used first passable cell',
      true,
      preferred,
    );
  }

  const forcedX = world.wrap(Math.floor(fallbackX));
  const forcedY = world.wrap(Math.floor(fallbackY));
  return resolveFromCell(
    world,
    world.idx(forcedX, forcedY),
    'fallback_forced_generator_spawn',
    'no passable cells found; forced generator spawn cell',
    true,
    preferred,
  );
}

/* ── Reachable placement map for generation-time content drops ── */
export type WalkablePlacementBias = 'any' | 'near' | 'far' | 'door';

export interface WalkablePlacementMap {
  reachable: Uint8Array;
  doorAdjacent: Uint8Array;
  candidates: number[];
  doorCandidates: number[];
  byRoom: Map<number, number[]>;
  seedIdx: number;
}

export interface WalkablePlacementPickOptions {
  centerX?: number;
  centerY?: number;
  minRadius?: number;
  maxRadius?: number;
  minDist2?: number;
  maxDist2?: number;
  roomId?: number;
  requireEmptyFeature?: boolean;
  allowWater?: boolean;
  doorAdjacent?: boolean;
  bias?: WalkablePlacementBias;
  avoidCells?: ReadonlySet<number>;
  attempts?: number;
}

function isPlacementTraversalCell(world: World, ci: number): boolean {
  const c = world.cells[ci];
  return c === Cell.FLOOR || c === Cell.WATER || c === Cell.DOOR;
}

export function isProtectedPlacementCell(world: World, ci: number): boolean {
  return world.cells[ci] === Cell.LIFT ||
    world.features[ci] === Feature.LIFT_BUTTON ||
    world.hermoWall[ci] !== 0 ||
    world.aptMask[ci] !== 0 ||
    world.doors.has(ci) ||
    world.containerMap.has(ci);
}

export function isWalkablePlacementCell(world: World, ci: number): boolean {
  const c = world.cells[ci];
  return (c === Cell.FLOOR || c === Cell.WATER) && !isProtectedPlacementCell(world, ci);
}

function findPlacementSeed(world: World, spawnX: number, spawnY: number): number {
  const sx = Math.floor(spawnX);
  const sy = Math.floor(spawnY);
  const start = world.idx(sx, sy);
  if (isPlacementTraversalCell(world, start)) return start;

  for (let r = 1; r <= 64; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const ci = world.idx(sx + dx, sy + dy);
        if (isPlacementTraversalCell(world, ci)) return ci;
      }
    }
  }

  for (let i = 0; i < W * W; i++) {
    if (isPlacementTraversalCell(world, i)) return i;
  }
  return start;
}

function markDoorAdjacent(world: World, out: Uint8Array): void {
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] !== Cell.DOOR) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (world.cells[ni] === Cell.FLOOR || world.cells[ni] === Cell.WATER) out[ni] = 1;
    }
  }
}

export function buildWalkablePlacementMap(world: World, spawnX: number, spawnY: number): WalkablePlacementMap {
  const n = W * W;
  const reachable = new Uint8Array(n);
  const doorAdjacent = new Uint8Array(n);
  const candidates: number[] = [];
  const doorCandidates: number[] = [];
  const byRoom = new Map<number, number[]>();
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seedIdx = findPlacementSeed(world, spawnX, spawnY);

  reachable[seedIdx] = 1;
  queue[tail++] = seedIdx;
  while (head < tail) {
    const ci = queue[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
      const ni = world.idx(x + dx, y + dy);
      if (reachable[ni] || !isPlacementTraversalCell(world, ni)) continue;
      reachable[ni] = 1;
      queue[tail++] = ni;
    }
  }

  markDoorAdjacent(world, doorAdjacent);

  for (let i = 0; i < n; i++) {
    if (!reachable[i] || !isWalkablePlacementCell(world, i)) continue;
    candidates.push(i);
    if (doorAdjacent[i]) doorCandidates.push(i);
    const roomId = world.roomMap[i];
    if (roomId >= 0) {
      const roomCells = byRoom.get(roomId);
      if (roomCells) roomCells.push(i);
      else byRoom.set(roomId, [i]);
    }
  }

  return { reachable, doorAdjacent, candidates, doorCandidates, byRoom, seedIdx };
}

export function isValidWalkablePlacementCell(
  world: World,
  placement: WalkablePlacementMap,
  ci: number,
  opts: WalkablePlacementPickOptions = {},
): boolean {
  if (!placement.reachable[ci] || !isWalkablePlacementCell(world, ci)) return false;
  if (opts.allowWater === false && world.cells[ci] === Cell.WATER) return false;
  if (opts.requireEmptyFeature && world.features[ci] !== Feature.NONE) return false;
  if (opts.roomId !== undefined && world.roomMap[ci] !== opts.roomId) return false;
  if (opts.doorAdjacent && !placement.doorAdjacent[ci]) return false;
  if (opts.avoidCells?.has(ci)) return false;

  const hasCenter = opts.centerX !== undefined && opts.centerY !== undefined;
  if (hasCenter) {
    const x = ci % W;
    const y = (ci / W) | 0;
    const d2 = world.dist2(opts.centerX!, opts.centerY!, x + 0.5, y + 0.5);
    const minD2 = opts.minDist2 ?? (opts.minRadius !== undefined ? opts.minRadius * opts.minRadius : undefined);
    const maxD2 = opts.maxDist2 ?? (opts.maxRadius !== undefined ? opts.maxRadius * opts.maxRadius : undefined);
    if (minD2 !== undefined && d2 < minD2) return false;
    if (maxD2 !== undefined && d2 > maxD2) return false;
  }

  return true;
}

function placementScore(world: World, placement: WalkablePlacementMap, ci: number, opts: WalkablePlacementPickOptions): number {
  const bias = opts.bias ?? 'any';
  if (bias === 'door') return placement.doorAdjacent[ci] ? 0 : 1;
  if ((bias === 'near' || bias === 'far') && opts.centerX !== undefined && opts.centerY !== undefined) {
    const x = ci % W;
    const y = (ci / W) | 0;
    const d2 = world.dist2(opts.centerX, opts.centerY, x + 0.5, y + 0.5);
    return bias === 'near' ? d2 : -d2;
  }
  return 0;
}

function placementSource(placement: WalkablePlacementMap, opts: WalkablePlacementPickOptions): readonly number[] {
  if (opts.roomId !== undefined) return placement.byRoom.get(opts.roomId) ?? [];
  if (opts.doorAdjacent) return placement.doorCandidates;
  return placement.candidates;
}

export function pickWalkablePlacement(
  world: World,
  placement: WalkablePlacementMap,
  opts: WalkablePlacementPickOptions = {},
): { x: number; y: number } | null {
  const source = placementSource(placement, opts);
  if (source.length === 0) return null;
  const bias = opts.bias ?? 'any';
  const attempts = opts.attempts ?? (opts.roomId !== undefined ? 48 : 96);
  let best = -1;
  let bestScore = Infinity;

  for (let a = 0; a < attempts; a++) {
    const ci = source[rng(0, source.length - 1)];
    if (!isValidWalkablePlacementCell(world, placement, ci, opts)) continue;
    if (bias === 'any') return { x: ci % W, y: (ci / W) | 0 };
    const score = placementScore(world, placement, ci, opts);
    if (score < bestScore) {
      bestScore = score;
      best = ci;
    }
  }

  if (best >= 0) return { x: best % W, y: (best / W) | 0 };

  for (const ci of source) {
    if (!isValidWalkablePlacementCell(world, placement, ci, opts)) continue;
    if (bias === 'any') return { x: ci % W, y: (ci / W) | 0 };
    const score = placementScore(world, placement, ci, opts);
    if (score < bestScore) {
      bestScore = score;
      best = ci;
    }
  }

  return best >= 0 ? { x: best % W, y: (best / W) | 0 } : null;
}

/* ── Protect room with aptMask + set wall/floor textures ─────── */
export function protectRoom(world: World, rx: number, ry: number, w: number, h: number, wallTex: Tex, floorTex: Tex): void {
  for (let dy = -1; dy <= h; dy++)
    for (let dx = -1; dx <= w; dx++) {
      const ci = world.idx(rx + dx, ry + dy);
      world.aptMask[ci] = 1;
      if (world.cells[ci] === Cell.WALL) world.wallTex[ci] = wallTex;
    }
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++)
      world.floorTex[world.idx(rx + dx, ry + dy)] = floorTex;
}

/* ── Punch through aptMask border walls to connect room to maze  */
export function connectProtectedRoom(world: World, rx: number, ry: number, w: number, h: number): void {
  // Phase 1: find border wall cells adjacent to non-protected FLOOR (maze passages)
  const openings: number[] = [];
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      if (dx >= 0 && dx < w && dy >= 0 && dy < h) continue; // skip interior
      const bx = world.wrap(rx + dx);
      const by = world.wrap(ry + dy);
      const bi = world.idx(bx, by);
      if (world.cells[bi] !== Cell.WALL) continue;
      for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const ni = world.idx(world.wrap(bx + ox), world.wrap(by + oy));
        if (world.cells[ni] === Cell.FLOOR && !world.aptMask[ni]) { openings.push(bi); break; }
      }
    }
  }
  if (openings.length > 0) {
    const bi = openings[rng(0, openings.length - 1)];
    world.cells[bi] = Cell.FLOOR;
    world.aptMask[bi] = 0;
    return;
  }

  // Phase 2: walk outward from each side until hitting maze floor
  const midX = rx + Math.floor(w / 2), midY = ry + Math.floor(h / 2);
  const probes: [number, number, number, number][] = [
    [midX, ry - 1, 0, -1], [midX, ry + h, 0, 1],
    [rx - 1, midY, -1, 0], [rx + w, midY, 1, 0],
  ];
  let bestPath: number[] = [], bestLen = Infinity;
  for (const [sx, sy, ddx, ddy] of probes) {
    const path: number[] = [];
    let cx = world.wrap(sx), cy = world.wrap(sy);
    for (let s = 0; s < 30; s++) {
      const ci = world.idx(cx, cy);
      if (world.cells[ci] === Cell.FLOOR && !world.aptMask[ci]) {
        if (path.length < bestLen) { bestLen = path.length; bestPath = [...path]; }
        break;
      }
      path.push(ci);
      cx = world.wrap(cx + ddx);
      cy = world.wrap(cy + ddy);
    }
  }
  for (const ci of bestPath) { world.cells[ci] = Cell.FLOOR; world.aptMask[ci] = 0; }
}

/* ── Find clear rectangular area (all WALL, no aptMask) ──────── */
export function findClearArea(
  world: World, cx: number, cy: number, w: number, h: number,
  minDist: number, maxDist: number,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 400; attempt++) {
    const angle = (rng(0, 10000) / 10000) * Math.PI * 2;
    const lo = attempt < 200 ? minDist : 0;
    const hi = attempt < 200 ? maxDist : W / 4;
    const dist = lo + (rng(0, 10000) / 10000) * (hi - lo);
    const tx = (cx + Math.round(Math.cos(angle) * dist) + W) % W;
    const ty = (cy + Math.round(Math.sin(angle) * dist) + W) % W;
    let ok = true;
    for (let dy = -1; dy <= h && ok; dy++)
      for (let dx = -1; dx <= w && ok; dx++) {
        const ci = world.idx((tx + dx + W) % W, (ty + dy + W) % W);
        if (world.cells[ci] !== Cell.WALL || world.aptMask[ci]) ok = false;
      }
    if (ok) return { x: tx, y: ty };
  }
  return null;
}
function hash32Corridor(v: number): number {
  v |= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

export function carveOrganicCorridor(world: World, ax: number, ay: number, bx: number, by: number, seed: number, force = false): void {
  // Reusable step function from carveCorridor
  function step(x: number, y: number, dirX: number, dirY: number): void {
    const i = world.idx(x, y);
    if (!force && world.aptMask[i]) return;
    if (world.cells[i] === Cell.FLOOR || world.cells[i] === Cell.DOOR) return;
    
    // If forcing through hermetic walls or apartments, we probably want doors
    if (force && (world.hermoWall[i] || world.aptMask[i])) {
      world.aptMask[i] = 0;
      world.cells[i] = Cell.DOOR;
      if (!world.doors.has(i)) {
        world.doors.set(i, { idx: i, state: DoorState.CLOSED, roomA: -1, roomB: -1, keyId: '', timer: 0 });
      }
      return;
    }

    if (world.cells[i] !== Cell.WALL) return;

    let crossingRoom = -1;
    let alongsideRoom = -1;

    const leftX = x === 0 ? W - 1 : x - 1;
    const rightX = x === W - 1 ? 0 : x + 1;
    const upY = y === 0 ? W - 1 : y - 1;
    const downY = y === W - 1 ? 0 : y + 1;

    const yW = y * W;
    const rightI = yW + rightX;
    const leftI = yW + leftX;
    const downI = downY * W + x;
    const upI = upY * W + x;

    if (world.roomMap[rightI] >= 0) {
      if (dirX !== 0) crossingRoom = world.roomMap[rightI];
      else alongsideRoom = world.roomMap[rightI];
    }
    if (world.roomMap[leftI] >= 0) {
      if (-dirX !== 0) crossingRoom = world.roomMap[leftI];
      else alongsideRoom = world.roomMap[leftI];
    }
    if (world.roomMap[downI] >= 0) {
      if (dirY !== 0) crossingRoom = world.roomMap[downI];
      else alongsideRoom = world.roomMap[downI];
    }
    if (world.roomMap[upI] >= 0) {
      if (-dirY !== 0) crossingRoom = world.roomMap[upI];
      else alongsideRoom = world.roomMap[upI];
    }

    if (crossingRoom >= 0) {
      let nearbyDoor = false;
      if (world.cells[rightI] === Cell.DOOR) {
        const d = world.doors.get(rightI);
        if (d && (d.roomA === crossingRoom || d.roomB === crossingRoom)) nearbyDoor = true;
      }
      if (!nearbyDoor && world.cells[leftI] === Cell.DOOR) {
        const d = world.doors.get(leftI);
        if (d && (d.roomA === crossingRoom || d.roomB === crossingRoom)) nearbyDoor = true;
      }
      if (!nearbyDoor && world.cells[downI] === Cell.DOOR) {
        const d = world.doors.get(downI);
        if (d && (d.roomA === crossingRoom || d.roomB === crossingRoom)) nearbyDoor = true;
      }
      if (!nearbyDoor && world.cells[upI] === Cell.DOOR) {
        const d = world.doors.get(upI);
        if (d && (d.roomA === crossingRoom || d.roomB === crossingRoom)) nearbyDoor = true;
      }

      if (nearbyDoor) {
        world.cells[i] = Cell.FLOOR;
      } else {
        world.cells[i] = Cell.DOOR;
        if (!world.doors.has(i)) {
          world.doors.set(i, {
            idx: i, state: DoorState.CLOSED,
            roomA: crossingRoom, roomB: -1, keyId: '', timer: 0,
          });
          const room = world.rooms[crossingRoom];
          if (room) room.doors.push(i);
        }
      }
    } else if (alongsideRoom >= 0) {
      world.cells[i] = Cell.FLOOR;
    } else {
      world.cells[i] = Cell.FLOOR;
    }
  }

  function carveSegment(x0: number, y0: number, x1: number, y1: number, depth: number): void {
    const ddx = world.delta(x0, x1);
    const ddy = world.delta(y0, y1);
    const dist = Math.abs(ddx) + Math.abs(ddy);

    if (dist <= 4 || depth >= 4) {
      // Small segment: simple Manhattan carve
      const stepX = ddx > 0 ? 1 : (ddx < 0 ? -1 : 0);
      const stepY = ddy > 0 ? 1 : (ddy < 0 ? -1 : 0);
      const horizFirst = (hash32Corridor(seed ^ x0 ^ y1 ^ depth) & 1) === 0;

      let cx = x0, cy = y0;
      if (horizFirst) {
        for (let i = 0; i <= Math.abs(ddx); i++) {
          step(cx, cy, stepX, 0);
          if (i < Math.abs(ddx)) cx = world.wrap(cx + stepX);
        }
        for (let i = 0; i <= Math.abs(ddy); i++) {
          step(cx, cy, 0, stepY);
          if (i < Math.abs(ddy)) cy = world.wrap(cy + stepY);
        }
      } else {
        for (let i = 0; i <= Math.abs(ddy); i++) {
          step(cx, cy, 0, stepY);
          if (i < Math.abs(ddy)) cy = world.wrap(cy + stepY);
        }
        for (let i = 0; i <= Math.abs(ddx); i++) {
          step(cx, cy, stepX, 0);
          if (i < Math.abs(ddx)) cx = world.wrap(cx + stepX);
        }
      }
      return;
    }

    // Midpoint displacement
    const midX = world.wrap(x0 + Math.floor(ddx / 2));
    const midY = world.wrap(y0 + Math.floor(ddy / 2));

    const h = hash32Corridor(seed ^ midX ^ midY ^ depth);
    // Jitter by up to dist/4
    const jitterMax = Math.max(1, Math.floor(dist / 4));
    const jitter = (h % (jitterMax * 2 + 1)) - jitterMax;

    let jx = midX, jy = midY;
    if (Math.abs(ddx) > Math.abs(ddy)) {
      jy = world.wrap(midY + jitter);
    } else {
      jx = world.wrap(midX + jitter);
    }

    carveSegment(x0, y0, jx, jy, depth + 1);
    carveSegment(jx, jy, x1, y1, depth + 1);
  }

  carveSegment(ax, ay, bx, by, 0);
}

/* ── 1-wide L-corridor with auto-doors at room walls ─────────── */
export function carveCorridor(world: World, ax: number, ay: number, bx: number, by: number): void {
  const ddx = world.delta(ax, bx);
  const ddy = world.delta(ay, by);
  const stepX = ddx > 0 ? 1 : -1;
  const stepY = ddy > 0 ? 1 : -1;
  const horizFirst = rng(0, 1000) < 500;
  let cx = ax, cy = ay;

  // dirX/dirY: current movement direction of the corridor leg.
  // Used to distinguish "crossing" a room wall (perpendicular entry)
  // from "running alongside" a room wall (parallel), which previously
  // created the repeating door-wall-door-wall "comb" pattern.
  function step(x: number, y: number, dirX: number, dirY: number): void {
    const i = world.idx(x, y);
    if (world.aptMask[i]) return;  // never carve through apartment cells
    if (world.cells[i] === Cell.FLOOR || world.cells[i] === Cell.DOOR) return;
    if (world.cells[i] !== Cell.WALL) return;

    // Find adjacent rooms, distinguishing crossing vs alongside
    let crossingRoom = -1;   // room in movement direction (corridor enters room)
    let alongsideRoom = -1;  // room perpendicular to movement (corridor runs along wall)

    const leftX = x === 0 ? W - 1 : x - 1;
    const rightX = x === W - 1 ? 0 : x + 1;
    const upY = y === 0 ? W - 1 : y - 1;
    const downY = y === W - 1 ? 0 : y + 1;

    const yW = y * W;
    const rightI = yW + rightX;
    const leftI = yW + leftX;
    const downI = downY * W + x;
    const upI = upY * W + x;

    if (world.roomMap[rightI] >= 0) {
      if (dirX !== 0) crossingRoom = world.roomMap[rightI];
      else alongsideRoom = world.roomMap[rightI];
    }
    if (world.roomMap[leftI] >= 0) {
      if (-dirX !== 0) crossingRoom = world.roomMap[leftI];
      else alongsideRoom = world.roomMap[leftI];
    }
    if (world.roomMap[downI] >= 0) {
      if (dirY !== 0) crossingRoom = world.roomMap[downI];
      else alongsideRoom = world.roomMap[downI];
    }
    if (world.roomMap[upI] >= 0) {
      if (-dirY !== 0) crossingRoom = world.roomMap[upI];
      else alongsideRoom = world.roomMap[upI];
    }

    if (crossingRoom >= 0) {
      // Corridor crosses a room wall — place a door (if none nearby)
      let nearbyDoor = false;
      if (world.cells[rightI] === Cell.DOOR) {
        const d = world.doors.get(rightI);
        if (d && (d.roomA === crossingRoom || d.roomB === crossingRoom)) nearbyDoor = true;
      }
      if (!nearbyDoor && world.cells[leftI] === Cell.DOOR) {
        const d = world.doors.get(leftI);
        if (d && (d.roomA === crossingRoom || d.roomB === crossingRoom)) nearbyDoor = true;
      }
      if (!nearbyDoor && world.cells[downI] === Cell.DOOR) {
        const d = world.doors.get(downI);
        if (d && (d.roomA === crossingRoom || d.roomB === crossingRoom)) nearbyDoor = true;
      }
      if (!nearbyDoor && world.cells[upI] === Cell.DOOR) {
        const d = world.doors.get(upI);
        if (d && (d.roomA === crossingRoom || d.roomB === crossingRoom)) nearbyDoor = true;
      }

      if (nearbyDoor) {
        // Don't place another door, but open the wall so the corridor
        // connects to the existing nearby door instead of dead-ending
        world.cells[i] = Cell.FLOOR;
      } else {
        world.cells[i] = Cell.DOOR;
        if (!world.doors.has(i)) {
          world.doors.set(i, {
            idx: i, state: DoorState.CLOSED,
            roomA: crossingRoom, roomB: -1, keyId: '', timer: 0,
          });
          const room = world.rooms[crossingRoom];
          if (room) room.doors.push(i);
        }
      }
    } else if (alongsideRoom >= 0) {
      // Corridor runs alongside a room wall — keep corridor flowing,
      // don't place doors or leave wall gaps (eliminates "comb" pattern)
      world.cells[i] = Cell.FLOOR;
    } else {
      world.cells[i] = Cell.FLOOR;
    }
  }

  if (horizFirst) {
    for (let i = 0; i <= Math.abs(ddx); i++) {
      step(cx, cy, stepX, 0);
      if (i < Math.abs(ddx)) cx = world.wrap(cx + stepX);
    }
    for (let i = 0; i <= Math.abs(ddy); i++) {
      step(cx, cy, 0, stepY);
      if (i < Math.abs(ddy)) cy = world.wrap(cy + stepY);
    }
  } else {
    for (let i = 0; i <= Math.abs(ddy); i++) {
      step(cx, cy, 0, stepY);
      if (i < Math.abs(ddy)) cy = world.wrap(cy + stepY);
    }
    for (let i = 0; i <= Math.abs(ddx); i++) {
      step(cx, cy, stepX, 0);
      if (i < Math.abs(ddx)) cx = world.wrap(cx + stepX);
    }
  }
}

/* ── Find exit point from room wall toward a target ──────────── */
export function roomExit(world: World, room: Room, tx: number, ty: number):
    { wx: number; wy: number; ox: number; oy: number } {
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const dx = world.delta(cx, tx);
  const dy = world.delta(cy, ty);

  if (Math.abs(dx) >= Math.abs(dy)) {
    const ey = world.wrap(room.y + rng(0, room.h - 1));
    if (dx >= 0) {
      const wx = world.wrap(room.x + room.w);
      return { wx, wy: ey, ox: world.wrap(wx + 1), oy: ey };
    } else {
      const wx = world.wrap(room.x - 1);
      return { wx, wy: ey, ox: world.wrap(wx - 1), oy: ey };
    }
  } else {
    const ex = world.wrap(room.x + rng(0, room.w - 1));
    if (dy >= 0) {
      const wy = world.wrap(room.y + room.h);
      return { wx: ex, wy, ox: ex, oy: world.wrap(wy + 1) };
    } else {
      const wy = world.wrap(room.y - 1);
      return { wx: ex, wy, ox: ex, oy: world.wrap(wy - 1) };
    }
  }
}

/* ── Place door at a specific wall cell ──────────────────────── */
export function placeDoorAt(world: World, wx: number, wy: number, roomId: number): void {
  const i = world.idx(wx, wy);
  if (world.aptMask[i]) return;  // never punch doors through apartment walls
  if (world.cells[i] === Cell.DOOR) return;
  if (world.cells[i] !== Cell.WALL) return;
  world.cells[i] = Cell.DOOR;
  if (!world.doors.has(i)) {
    world.doors.set(i, {
      idx: i, state: DoorState.CLOSED,
      roomA: roomId, roomB: -1, keyId: '', timer: 0,
    });
    const room = world.rooms[roomId];
    if (room) room.doors.push(i);
  }
}

/* ── Connect rooms via Prim's MST ────────────────────────────── */
export function connectRoomsMST(world: World, rooms: Room[]): void {
  const n = rooms.length;
  if (n < 2) return;

  const inMST = new Uint8Array(n);
  const minDist = new Float64Array(n).fill(Infinity);
  const minFrom = new Int32Array(n).fill(-1);

  inMST[0] = 1;
  const cx0 = rooms[0].x + rooms[0].w / 2;
  const cy0 = rooms[0].y + rooms[0].h / 2;
  for (let j = 1; j < n; j++) {
    minDist[j] = world.dist(cx0, cy0, rooms[j].x + rooms[j].w / 2, rooms[j].y + rooms[j].h / 2);
    minFrom[j] = 0;
  }

  const mstEdges: [number, number][] = [];
  for (let iter = 0; iter < n - 1; iter++) {
    let best = Infinity;
    let bestIdx = -1;
    for (let j = 0; j < n; j++) {
      if (!inMST[j] && minDist[j] < best) {
        best = minDist[j];
        bestIdx = j;
      }
    }
    if (bestIdx < 0) break;

    inMST[bestIdx] = 1;
    mstEdges.push([minFrom[bestIdx], bestIdx]);

    const cxB = rooms[bestIdx].x + rooms[bestIdx].w / 2;
    const cyB = rooms[bestIdx].y + rooms[bestIdx].h / 2;
    for (let j = 0; j < n; j++) {
      if (inMST[j]) continue;
      const d = world.dist(cxB, cyB, rooms[j].x + rooms[j].w / 2, rooms[j].y + rooms[j].h / 2);
      if (d < minDist[j]) {
        minDist[j] = d;
        minFrom[j] = bestIdx;
      }
    }
  }

  for (const [i, j] of mstEdges) {
    const a = rooms[i], b = rooms[j];
    const exitA = roomExit(world, a, b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2));
    const exitB = roomExit(world, b, a.x + Math.floor(a.w / 2), a.y + Math.floor(a.h / 2));
    placeDoorAt(world, exitA.wx, exitA.wy, a.id);
    placeDoorAt(world, exitB.wx, exitB.wy, b.id);
    carveOrganicCorridor(world, exitA.ox, exitA.oy, exitB.ox, exitB.oy, a.id ^ b.id ^ 0x629A);
  }

  const extra = Math.floor(n * 0.25);
  for (let k = 0; k < extra; k++) {
    const ai = rng(0, n - 1), bi = rng(0, n - 1);
    if (ai !== bi) {
      const a = rooms[ai], b = rooms[bi];
      const exitA = roomExit(world, a, b.x + Math.floor(b.w / 2), b.y + Math.floor(b.h / 2));
      const exitB = roomExit(world, b, a.x + Math.floor(a.w / 2), a.y + Math.floor(a.h / 2));
      placeDoorAt(world, exitA.wx, exitA.wy, a.id);
      placeDoorAt(world, exitB.wx, exitB.wy, b.id);
      carveOrganicCorridor(world, exitA.ox, exitA.oy, exitB.ox, exitB.oy, a.id ^ b.id ^ 0x629A);
    }
  }
}

/* ── Room overlap check ──────────────────────────────────────── */
export function canPlaceRoom(world: World, x: number, y: number, w: number, h: number): boolean {
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const i = world.idx(world.wrap(x + dx), world.wrap(y + dy));
      if (world.cells[i] !== Cell.WALL || world.aptMask[i]) return false;
    }
  }
  return true;
}

/* ── Stamp a wall-enclosed room ──────────────────────────────── */
export function stampRoom(world: World, id: number, type: RoomType, x: number, y: number, w: number, h: number, aptId: number): Room {
  const def = ROOM_DEFS[type];
  const room: Room = {
    id, type, x: world.wrap(x), y: world.wrap(y), w, h,
    doors: [], sealed: false,
    name: `${def.name} #${id}`,
    apartmentId: aptId,
    wallTex: def.wallTex,
    floorTex: def.floorTex,
  };
  for (let dy = -1; dy <= h; dy++) {
    for (let dx = -1; dx <= w; dx++) {
      const i = world.idx(room.x + dx, room.y + dy);
      world.cells[i] = Cell.WALL;
      world.wallTex[i] = room.wallTex;
      world.roomMap[i] = -1;
    }
  }
  world.carveRect(room.x, room.y, w, h, id);
  world.rooms[id] = room;
  return room;
}

/* ── Place a door between two adjacent rooms (shared wall) ───── */
export function placeDoor(world: World, a: Room, b: Room, keyId: string, hermetic: boolean): void {
  const candidates: number[] = [];
  for (let dy = -1; dy <= a.h; dy++) {
    for (let dx = -1; dx <= a.w; dx++) {
      if (dx >= 0 && dx < a.w && dy >= 0 && dy < a.h) continue;
      const wx = world.wrap(a.x + dx);
      const wy = world.wrap(a.y + dy);
      const ci = world.idx(wx, wy);
      if (world.cells[ci] !== Cell.WALL) continue;
      for (const [ddx, ddy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const ni = world.idx(wx + ddx, wy + ddy);
        if (world.roomMap[ni] !== b.id) continue;
        const oi = world.idx(wx - ddx, wy - ddy);
        if (world.roomMap[oi] !== a.id) continue;
        candidates.push(ci);
        break;
      }
    }
  }
  if (candidates.length === 0) return;

  const doorIdx = pick(candidates);
  world.cells[doorIdx] = Cell.DOOR;
  world.doors.set(doorIdx, {
    idx: doorIdx,
    state: hermetic ? DoorState.HERMETIC_OPEN : (keyId ? DoorState.LOCKED : DoorState.CLOSED),
    roomA: a.id, roomB: b.id, keyId, timer: 0,
  });
  a.doors.push(doorIdx);
  b.doors.push(doorIdx);
}

/* ── Room decorations ────────────────────────────────────────── */
export function decorateRoom(world: World, room: Room): void {
  const { w, h, type } = room;
  function placeWall(dx: number, dy: number): void {
    const ci = world.idx(world.wrap(room.x + dx), world.wrap(room.y + dy));
    if (world.cells[ci] === Cell.FLOOR) {
      world.cells[ci] = Cell.WALL;
      world.wallTex[ci] = room.wallTex;
    }
  }

  if (type === RoomType.COMMON) {
    const decor = rng(0, 4);
    if (decor === 0 && w >= 8 && h >= 8) {
      const ox = Math.floor(w / 4), oy = Math.floor(h / 4);
      placeWall(ox, oy); placeWall(w - 1 - ox, oy);
      placeWall(ox, h - 1 - oy); placeWall(w - 1 - ox, h - 1 - oy);
    } else if (decor === 1 && w >= 6 && h >= 6) {
      const c1 = Math.floor(w / 3), c2 = w - 1 - c1;
      for (let dy = 2; dy < h - 1; dy += 2) { placeWall(c1, dy); placeWall(c2, dy); }
    } else if (decor === 2 && w >= 10 && h >= 10) {
      if (rng(0, 1000) < 500) {
        const wy = Math.floor(h / 2), gap = Math.floor(w / 2);
        for (let dx = 2; dx < w - 2; dx++) { if (Math.abs(dx - gap) > 1) placeWall(dx, wy); }
      } else {
        const wx = Math.floor(w / 2), gap = Math.floor(h / 2);
        for (let dy = 2; dy < h - 2; dy++) { if (Math.abs(dy - gap) > 1) placeWall(wx, dy); }
      }
    } else if (decor === 3 && w >= 6 && h >= 6) {
      placeColumns(world, room);
    } else {
      const np = rng(2, Math.min(6, Math.floor(w * h / 20)));
      for (let i = 0; i < np; i++) placeWall(rng(2, Math.max(2, w - 3)), rng(2, Math.max(2, h - 3)));
    }
  } else if (type === RoomType.CORRIDOR && Math.max(w, h) >= 8) {
    if (w > h) {
      const my = Math.floor(h / 2);
      for (let dx = 3; dx < w - 2; dx += 3) placeWall(dx, my);
    } else {
      const mx = Math.floor(w / 2);
      for (let dy = 3; dy < h - 2; dy += 3) placeWall(mx, dy);
    }
  } else if (type === RoomType.PRODUCTION && w >= 6 && h >= 6) {
    for (let dy = 2; dy < h - 2; dy += 4)
      for (let dx = 2; dx < w - 2; dx += 4) placeWall(dx, dy);
  }
}

export function placeColumns(world: World, room: Room): void {
  const spacing = rng(3, 4);
  for (let dy = spacing; dy < room.h - 1; dy += spacing) {
    for (let dx = spacing; dx < room.w - 1; dx += spacing) {
      const ci = world.idx(world.wrap(room.x + dx), world.wrap(room.y + dy));
      if (world.cells[ci] === Cell.FLOOR) {
        world.cells[ci] = Cell.WALL;
        world.wallTex[ci] = room.wallTex;
      }
    }
  }
}

/* ═════════════════════════════════════════════════════════════════
   shapeRoom — reshape a rectangular room's interior into an
   interesting symmetric shape. The bounding-box walls stay; FLOOR
   cells outside the shape become WALL. Applied to volatile rooms
   only (apartments keep their rectangles).

   Shape types (all symmetric on at least one axis):
   0 = rectangle (no change)
   1 = ellipse (symmetric on both axes)
   2 = diamond (symmetric on both axes)
   3 = cross/plus (symmetric on both axes)
   4 = semicircle (symmetric on one axis)
   5 = hexagon (symmetric on both axes)
   6 = capsule (symmetric on both axes)
   7 = chevron (symmetric on one axis)
   ═════════════════════════════════════════════════════════════════ */
const NUM_SHAPES = 8;
export function shapeRoom(world: World, room: Room): void {
  const { w, h } = room;
  if (w < 4 || h < 4) return; // too small to reshape

  const shape = rng(0, NUM_SHAPES - 1);
  if (shape === 0) return; // rectangle — keep as is

  const rx = (w - 1) / 2;
  const ry = (h - 1) / 2;
  const cx = rx; // local center
  const cy = ry;

  function inside(dx: number, dy: number): boolean {
    const nx = dx - cx; // offset from center
    const ny = dy - cy;
    switch (shape) {
      case 1: { // ellipse
        return (nx * nx) / (rx * rx) + (ny * ny) / (ry * ry) <= 1.0;
      }
      case 2: { // diamond
        return Math.abs(nx) / rx + Math.abs(ny) / ry <= 1.0;
      }
      case 3: { // cross
        const armW = rx * 0.38;
        const armH = ry * 0.38;
        return Math.abs(ny) <= armH || Math.abs(nx) <= armW;
      }
      case 4: { // semicircle (flat on one side)
        if (w >= h) { // horizontal: flat left
          return (nx >= 0)
            ? (nx * nx) / (rx * rx) + (ny * ny) / (ry * ry) <= 1.0
            : Math.abs(ny) <= ry;
        } else { // vertical: flat top
          return (ny >= 0)
            ? (nx * nx) / (rx * rx) + (ny * ny) / (ry * ry) <= 1.0
            : Math.abs(nx) <= rx;
        }
      }
      case 5: { // hexagon
        const t = 1.0 - Math.abs(ny) / ry * 0.5;
        return Math.abs(nx) <= rx * t;
      }
      case 6: { // capsule (rect + semicircle ends)
        if (w >= h) {
          const half = Math.max(0, rx - ry);
          const ex = Math.max(0, Math.abs(nx) - half);
          return ex * ex + ny * ny <= ry * ry;
        } else {
          const half = Math.max(0, ry - rx);
          const ey = Math.max(0, Math.abs(ny) - half);
          return nx * nx + ey * ey <= rx * rx;
        }
      }
      case 7: { // chevron/arrow pointing right or down
        const t = 1.0 - Math.abs(ny) / ry;
        return Math.abs(nx) <= Math.max(1, rx * t);
      }
      default: return true;
    }
  }

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      // Keep 1-cell border so door connections stay valid
      if (dx === 0 || dx === w - 1 || dy === 0 || dy === h - 1) continue;
      if (inside(dx, dy)) continue;
      const i = world.idx(world.wrap(room.x + dx), world.wrap(room.y + dy));
      if (world.cells[i] !== Cell.FLOOR || world.aptMask[i]) continue;
      world.cells[i] = Cell.WALL;
      world.wallTex[i] = room.wallTex;
      world.roomMap[i] = -1;
    }
  }
}

export function placeAbyssPits(world: World): void {
  for (let i = 0; i < 200; i++) {
    const px = rng(0, W - 1), py = rng(0, W - 1);
    const pw = rng(2, 6), ph = rng(2, 6);
    let ok = true;
    for (let dy = -1; dy <= ph && ok; dy++)
      for (let dx = -1; dx <= pw && ok; dx++) {
        const ai = world.idx(px + dx, py + dy);
        if (world.cells[ai] !== Cell.WALL || world.aptMask[ai]) ok = false;
      }
    if (!ok) continue;
    for (let dy = 0; dy < ph; dy++)
      for (let dx = 0; dx < pw; dx++)
        world.cells[world.idx(px + dx, py + dy)] = Cell.ABYSS;
  }
}

/* ── Connect a room to nearest existing walkable space ───────── */
export function connectToNetwork(world: World, room: Room): void {
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
      const wx = world.wrap(room.x + dx);
      const wy = world.wrap(room.y + dy);
      const ci = world.idx(wx, wy);
      if (world.cells[ci] !== Cell.WALL || world.aptMask[ci]) continue;

      for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = world.wrap(wx + ox), ny = world.wrap(wy + oy);
        const ni = world.idx(nx, ny);
        if (world.cells[ni] !== Cell.FLOOR && world.cells[ni] !== Cell.DOOR) continue;
        if (world.roomMap[ni] === room.id) continue;
        if (world.aptMask[ni]) continue;
        const ix = world.wrap(wx - ox), iy = world.wrap(wy - oy);
        if (world.roomMap[world.idx(ix, iy)] !== room.id) continue;
        placeDoorAt(world, wx, wy, room.id);
        return;
      }
    }
  }

  const sides = shuffle([0, 1, 2, 3]);
  for (const side of sides) {
    let sx: number, sy: number, sdx: number, sdy: number;
    if (side === 0) {
      sx = world.wrap(room.x + rng(0, room.w - 1));
      sy = world.wrap(room.y - 1); sdx = 0; sdy = -1;
    } else if (side === 1) {
      sx = world.wrap(room.x + rng(0, room.w - 1));
      sy = world.wrap(room.y + room.h); sdx = 0; sdy = 1;
    } else if (side === 2) {
      sx = world.wrap(room.x - 1);
      sy = world.wrap(room.y + rng(0, room.h - 1)); sdx = -1; sdy = 0;
    } else {
      sx = world.wrap(room.x + room.w);
      sy = world.wrap(room.y + rng(0, room.h - 1)); sdx = 1; sdy = 0;
    }
    let ex = world.wrap(sx + sdx), ey = world.wrap(sy + sdy);
    const carved: number[] = [];
    let connected = false;
    for (let d = 0; d < 40; d++) {
      const fi = world.idx(ex, ey);
      if (world.aptMask[fi]) break;
      if (world.cells[fi] === Cell.FLOOR || world.cells[fi] === Cell.DOOR) { connected = true; break; }
      if (world.cells[fi] === Cell.WALL) {
        let adj = -1;
        for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const ni = world.idx(world.wrap(ex + ox), world.wrap(ey + oy));
          if (world.roomMap[ni] >= 0 && world.roomMap[ni] !== room.id) { adj = world.roomMap[ni]; break; }
        }
        if (adj >= 0) {
          placeDoorAt(world, ex, ey, adj);
          connected = true;
          break;
        }
        carved.push(fi);
      }
      ex = world.wrap(ex + sdx);
      ey = world.wrap(ey + sdy);
    }
    if (connected) {
      placeDoorAt(world, sx, sy, room.id);
      for (const ci of carved) world.cells[ci] = Cell.FLOOR;
      return;
    }
  }
}

export function isConnectivityWalkable(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  return cell === Cell.FLOOR || cell === Cell.DOOR || cell === Cell.WATER;
}

/* ── Percolation: ensure entire world is one connected graph ── */
export function ensureConnectivity(world: World, spawnX: number, spawnY: number): void {
  const N = W * W;
  const dirs: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]];
  const si = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  if (!isConnectivityWalkable(world, si)) return;

  for (let pass = 0; pass < 4; pass++) {
    const label = new Int32Array(N).fill(-1);

    label[si] = 0;
    const bfsQ: number[] = [si];
    let bh = 0;
    while (bh < bfsQ.length) {
      const ci = bfsQ[bh++];
      const cx = ci % W, cy = (ci / W) | 0;
      for (const [dx, dy] of dirs) {
        const ni = world.idx(cx + dx, cy + dy);
        if (label[ni] < 0 && isConnectivityWalkable(world, ni)) {
          label[ni] = 0;
          bfsQ.push(ni);
        }
      }
    }

    const mainCells: [number, number][] = [];
    const mstep = Math.max(1, bfsQ.length >> 10);
    for (let i = 0; i < bfsQ.length; i += mstep) {
      mainCells.push([bfsQ[i] % W, (bfsQ[i] / W) | 0]);
    }

    let compId = 1;
    for (let i = 0; i < N; i++) {
      if (label[i] >= 0) continue;
      if (!isConnectivityWalkable(world, i)) continue;

      const comp: number[] = [i];
      label[i] = compId;
      let ch = 0;
      while (ch < comp.length) {
        const ci = comp[ch++];
        const cx = ci % W, cy = (ci / W) | 0;
        for (const [dx, dy] of dirs) {
          const ni = world.idx(cx + dx, cy + dy);
          if (label[ni] < 0 && isConnectivityWalkable(world, ni)) {
            label[ni] = compId;
            comp.push(ni);
          }
        }
      }
      compId++;

      let bestD = Infinity, srcX = 0, srcY = 0, dstX = 0, dstY = 0;
      const step = Math.max(1, comp.length >> 2);
      for (let c = 0; c < comp.length; c += step) {
        const cx = comp[c] % W, cy = (comp[c] / W) | 0;
        for (const [mx, my] of mainCells) {
          const d = Math.abs(world.delta(cx, mx)) + Math.abs(world.delta(cy, my));
          if (d < bestD) { bestD = d; srcX = cx; srcY = cy; dstX = mx; dstY = my; }
        }
      }

      carveCorridor(world, srcX, srcY, dstX, dstY);

      for (const ci of comp) label[ci] = 0;
      const re: number[] = [world.idx(srcX, srcY), world.idx(dstX, dstY)];
      for (const seed of re) {
        if (label[seed] === 0) continue;
        label[seed] = 0;
        const rq = [seed];
        let rh = 0;
        while (rh < rq.length) {
          const ci = rq[rh++];
          const cx = ci % W, cy = (ci / W) | 0;
          for (const [dx, dy] of dirs) {
            const ni = world.idx(cx + dx, cy + dy);
            if (label[ni] !== 0 && isConnectivityWalkable(world, ni)) {
              label[ni] = 0;
              rq.push(ni);
            }
          }
        }
      }
      mainCells.push([srcX, srcY]);
    }

    if (compId === 1) break; // fully connected — done
  }
}

/* ── Ensure every permanent room is reachable from the maze ───── */
/*   Runs after the volatile maze is fully built.  BFS from the   */
/*   maze graph, then for each isolated permanent room places a   */
/*   DOOR on its perimeter and carves a corridor outward.         */
function getInitialReachabilitySeed(world: World): number {
  for (let i = 0; i < W * W; i++) {
    if (!world.aptMask[i] && (world.cells[i] === Cell.FLOOR || world.cells[i] === Cell.DOOR)) {
      return i;
    }
  }
  return -1;
}

function updateReachability(world: World, seed: number, vis: Uint8Array, q: number[], startIndex: number = 0): void {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  if (!vis[seed] && (world.cells[seed] === Cell.FLOOR || world.cells[seed] === Cell.DOOR)) {
    vis[seed] = 1;
    q.push(seed);
  }
  let h = startIndex;
  while (h < q.length) {
    const ci = q[h++];
    const cx = ci % W, cy = (ci / W) | 0;
    for (const [dx, dy] of dirs) {
      const ni = world.idx(cx + dx, cy + dy);
      if (!vis[ni] && (world.cells[ni] === Cell.FLOOR || world.cells[ni] === Cell.DOOR)) {
        vis[ni] = 1;
        q.push(ni);
      }
    }
  }
}

function isRoomReachable(world: World, room: Room, vis: Uint8Array): boolean {
  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      if (vis[world.idx(room.x + dx, room.y + dy)]) {
        return true;
      }
    }
  }
  return false;
}

interface DoorLocation {
  wi: number; // Wall index
  ox: number; // Outside x
  oy: number; // Outside y
}

function findBestDoorLocation(world: World, room: Room, samples: number[]): DoorLocation | null {
  let bestD = Infinity;
  let bestLoc: DoorLocation | null = null;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;

      const wx = world.wrap(room.x + dx);
      const wy = world.wrap(room.y + dy);
      const wi = world.idx(wx, wy);

      if (world.cells[wi] !== Cell.WALL) continue;

      for (const [ddx, ddy] of dirs) {
        // Inside neighbour must belong to this room
        const ix = world.wrap(wx - ddx);
        const iy = world.wrap(wy - ddy);
        if (world.roomMap[world.idx(ix, iy)] !== room.id) continue;

        // Outside neighbour must not be aptMask (another protected room)
        const ox = world.wrap(wx + ddx);
        const oy = world.wrap(wy + ddy);
        if (world.aptMask[world.idx(ox, oy)]) continue;

        // Flanking cells must be walls (wall-door-wall pattern)
        const f1 = world.cells[world.idx(world.wrap(wx + ddy), world.wrap(wy + ddx))];
        const f2 = world.cells[world.idx(world.wrap(wx - ddy), world.wrap(wy - ddx))];
        if (f1 !== Cell.WALL || f2 !== Cell.WALL) continue;

        // Manhattan distance to nearest reachable sample
        for (const si of samples) {
          const d = Math.abs(world.delta(ox, si % W)) + Math.abs(world.delta(oy, (si / W) | 0));
          if (d < bestD) {
            bestD = d;
            bestLoc = { wi, ox, oy };
          }
        }
      }
    }
  }

  return bestLoc;
}

export function ensurePermanentRoomAccess(world: World): void {
  const seed = getInitialReachabilitySeed(world);
  if (seed < 0) return;

  const vis = new Uint8Array(W * W);
  const q: number[] = [];
  updateReachability(world, seed, vis, q);

  /* Sparse sample of reachable cells for nearest-neighbour queries */
  const sStep = Math.max(1, q.length >> 10);
  const samples: number[] = [];
  for (let i = 0; i < q.length; i += sStep) samples.push(q[i]);

  for (let ri = 0; ri < world.apartmentRoomCount; ri++) {
    const room = world.rooms[ri];
    if (!room || room.sealed) continue;

    if (isRoomReachable(world, room, vis)) continue;

    const loc = findBestDoorLocation(world, room, samples);
    if (!loc) continue;

    /* Place door on the wall ring */
    world.cells[loc.wi] = Cell.DOOR;
    world.doors.set(loc.wi, {
      idx: loc.wi, state: DoorState.HERMETIC_OPEN,
      roomA: room.id, roomB: -1, keyId: '', timer: 0,
    });
    room.doors.push(loc.wi);

    /* Nearest reachable target for corridor */
    let tgtX = 0, tgtY = 0, tgtD = Infinity;
    for (const si of samples) {
      const sx = si % W, sy = (si / W) | 0;
      const d = Math.abs(world.delta(loc.ox, sx)) + Math.abs(world.delta(loc.oy, sy));
      if (d < tgtD) {
        tgtD = d;
        tgtX = sx;
        tgtY = sy;
      }
    }

    /* Carve corridor from outside the door to the maze */
    carveCorridor(world, loc.ox, loc.oy, tgtX, tgtY);

    /* Update reachability so subsequent rooms benefit */
    const doorOut = world.idx(loc.ox, loc.oy);
    updateReachability(world, doorOut, vis, q, q.length);
  }
}

/* ── Repair room walls: seal breaches in APARTMENT perimeters only ── */
export function repairRoomWalls(world: World): void {
  const aptCount = world.apartmentRoomCount;
  for (let i = 0; i < aptCount; i++) {
    const room = world.rooms[i];
    if (!room) continue;
    // Scan the 1-cell wall ring around the room
    for (let dy = -1; dy <= room.h; dy++) {
      for (let dx = -1; dx <= room.w; dx++) {
        // Skip interior cells
        if (dx >= 0 && dx < room.w && dy >= 0 && dy < room.h) continue;
        const wx = world.wrap(room.x + dx);
        const wy = world.wrap(room.y + dy);
        const ci = world.idx(wx, wy);
        // If a perimeter cell became FLOOR, restore it to WALL
        // Skip cells intentionally assigned to a room (hand-crafted passages)
        if (world.cells[ci] === Cell.FLOOR && world.roomMap[ci] < 0) {
          world.cells[ci] = Cell.WALL;
          world.wallTex[ci] = room.wallTex;
        }
      }
    }
  }
}



/* ── Sanitize doors: validate APARTMENT doors only ───────────── */
export function sanitizeDoors(world: World): void {
  const walkable = (c: number) => c === Cell.FLOOR || c === Cell.DOOR || c === Cell.WATER;

  for (let pass = 0; pass < 3; pass++) {
    const toRemove: number[] = [];
    for (const [idx, door] of world.doors) {
      const x = idx % W, y = (idx / W) | 0;
      if (world.cells[idx] !== Cell.DOOR) { toRemove.push(idx); continue; }

      const l = world.cells[world.idx(x - 1, y)];
      const r = world.cells[world.idx(x + 1, y)];
      const u = world.cells[world.idx(x, y - 1)];
      const d = world.cells[world.idx(x, y + 1)];

      const wallH = (l === Cell.WALL ? 1 : 0) + (r === Cell.WALL ? 1 : 0);
      const wallV = (u === Cell.WALL ? 1 : 0) + (d === Cell.WALL ? 1 : 0);
      if (wallH < 2 && wallV < 2) { toRemove.push(idx); continue; }

      // Pass-through must have walkable on both sides
      if (wallH >= 2) {
        if (!walkable(u) || !walkable(d)) { toRemove.push(idx); continue; }
      } else {
        if (!walkable(l) || !walkable(r)) { toRemove.push(idx); continue; }
      }

      void door; // used
    }
    if (toRemove.length === 0) break;
    for (const i of toRemove) {
      // Apartment doors become WALL, non-apartment become FLOOR
      world.cells[i] = world.aptMask[i] ? Cell.WALL : Cell.FLOOR;
      world.removeDoorAt(i);
    }
  }
}



/* ── Remove 1-cell dead-end floor pockets ────────────────────── */
export function pruneDeadEnds(world: World): void {
  const dirs: [number, number][] = [[1,0],[-1,0],[0,1],[0,-1]];
  const walk = (ni: number) =>
    world.cells[ni] === Cell.FLOOR || world.cells[ni] === Cell.DOOR;

  for (let pass = 0; pass < 40; pass++) {
    let changed = 0;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (world.cells[i] !== Cell.FLOOR) continue;
        if (world.roomMap[i] >= 0) continue;

        let solidN = 0;
        for (const [dx, dy] of dirs) {
          if (!walk(world.idx(x + dx, y + dy))) solidN++;
        }
        if (solidN >= 3) {
          world.cells[i] = Cell.WALL;
          world.features[i] = 0;
          changed++;
        }
      }
    }
    if (changed === 0) break;
  }
}

/* ── Open volatile doors: convert non-apartment doors to FLOOR ── */
export function openVolatileDoors(world: World): void {
  const toOpen: number[] = [];
  for (const [idx, door] of world.doors) {
    if (world.aptMask[idx]) continue;
    const rA = door.roomA >= 0 ? world.rooms[door.roomA] : null;
    const rB = door.roomB >= 0 ? world.rooms[door.roomB] : null;
    if (rA && rA.apartmentId >= 0) continue;
    if (rB && rB.apartmentId >= 0) continue;
    toOpen.push(idx);
  }
  for (const idx of toOpen) {
    world.cells[idx] = Cell.FLOOR;
    world.removeDoorAt(idx);
  }
}

/* ── Weighted random pick ────────────────────────────────────── */
export function weightedPick<T extends { spawnW: number }>(defs: T[]): T | null {
  const total = defs.reduce((s, d) => s + d.spawnW, 0);
  if (total <= 0) return null;
  let r = (rng(0, 10000) / 10000) * total;
  for (const d of defs) { r -= d.spawnW; if (r <= 0) return d; }
  return defs[defs.length - 1];
}

const CARDINAL_DIRS = [[1,0],[-1,0],[0,1],[0,-1]] as const;
const LIFT_CONNECTOR_MAX = 96;

interface ReachableSet {
  cells: Int32Array;
  count: number;
  seen: Uint8Array;
}

function isLiftWalkable(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR;
}

function findNearestLiftWalkable(world: World, x: number, y: number, radius: number): number {
  const start = world.idx(x, y);
  if (isLiftWalkable(world, start)) return start;
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const idx = world.idx(x + dx, y + dy);
        if (isLiftWalkable(world, idx)) return idx;
      }
    }
  }
  return -1;
}

function collectReachable(world: World, startIdx: number): ReachableSet {
  const seen = new Uint8Array(W * W);
  const cells = new Int32Array(W * W);
  if (startIdx < 0 || !isLiftWalkable(world, startIdx)) return { cells, count: 0, seen };

  let head = 0;
  let tail = 0;
  seen[startIdx] = 1;
  cells[tail++] = startIdx;
  while (head < tail) {
    const ci = cells[head++];
    const x = ci % W;
    const y = (ci / W) | 0;
    for (const [dx, dy] of CARDINAL_DIRS) {
      const ni = world.idx(x + dx, y + dy);
      if (seen[ni] || !isLiftWalkable(world, ni)) continue;
      seen[ni] = 1;
      cells[tail++] = ni;
    }
  }
  return { cells, count: tail, seen };
}

function reachableFromPoint(world: World, x: number, y: number): ReachableSet {
  return collectReachable(world, findNearestLiftWalkable(world, Math.floor(x), Math.floor(y), 64));
}

function firstWalkableComponent(world: World): ReachableSet {
  for (let i = 0; i < W * W; i++) {
    if (isLiftWalkable(world, i)) return collectReachable(world, i);
  }
  return collectReachable(world, -1);
}

function canCarveLiftConnectorCell(world: World, idx: number): boolean {
  return !world.aptMask[idx] && !world.hermoWall[idx] && world.cells[idx] !== Cell.LIFT;
}

function clearDoorAt(world: World, idx: number): void {
  world.removeDoorAt(idx);
}

function setConnectorFloor(world: World, idx: number, floorTex: Tex): boolean {
  if (!canCarveLiftConnectorCell(world, idx)) return false;
  if (world.cells[idx] === Cell.DOOR) clearDoorAt(world, idx);
  if (world.cells[idx] !== Cell.FLOOR && world.cells[idx] !== Cell.WATER) {
    world.cells[idx] = Cell.FLOOR;
    world.floorTex[idx] = floorTex;
    world.roomMap[idx] = -1;
    world.features[idx] = Feature.NONE;
  }
  return true;
}

function carveBoundedLiftConnector(world: World, fromIdx: number, toIdx: number, floorTex: Tex): boolean {
  const ax = fromIdx % W;
  const ay = (fromIdx / W) | 0;
  const bx = toIdx % W;
  const by = (toIdx / W) | 0;
  const dx = world.delta(ax, bx);
  const dy = world.delta(ay, by);
  if (Math.abs(dx) + Math.abs(dy) > LIFT_CONNECTOR_MAX) return false;

  const touched: number[] = [];
  let x = ax;
  let y = ay;
  const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;

  for (let s = 0; s < Math.abs(dx); s++) {
    const idx = world.idx(x, y);
    if (!canCarveLiftConnectorCell(world, idx)) return false;
    touched.push(idx);
    x = world.wrap(x + stepX);
  }
  for (let s = 0; s < Math.abs(dy); s++) {
    const idx = world.idx(x, y);
    if (!canCarveLiftConnectorCell(world, idx)) return false;
    touched.push(idx);
    y = world.wrap(y + stepY);
  }
  const last = world.idx(x, y);
  if (!canCarveLiftConnectorCell(world, last)) return false;
  touched.push(last);

  for (const idx of touched) setConnectorFloor(world, idx, floorTex);
  return true;
}

function nearestReachableCell(world: World, fromIdx: number, reachable: ReachableSet, maxDist: number): number {
  const fx = fromIdx % W;
  const fy = (fromIdx / W) | 0;
  let best = -1;
  let bestD = maxDist + 1;
  const step = Math.max(1, reachable.count >> 11);
  for (let i = 0; i < reachable.count; i += step) {
    const ci = reachable.cells[i];
    const d = Math.abs(world.delta(fx, ci % W)) + Math.abs(world.delta(fy, (ci / W) | 0));
    if (d < bestD) {
      bestD = d;
      best = ci;
    }
  }
  return bestD <= maxDist ? best : -1;
}

function routeLiftAccessReachable(world: World, liftIdx: number, reachable: ReachableSet): boolean {
  const x = liftIdx % W;
  const y = (liftIdx / W) | 0;
  for (const [dx, dy] of CARDINAL_DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (reachable.seen[ni] && isLiftWalkable(world, ni)) return true;
  }
  return false;
}

function reachableAdjacentLiftCell(world: World, liftIdx: number, reachable: ReachableSet): number {
  const x = liftIdx % W;
  const y = (liftIdx / W) | 0;
  for (const [dx, dy] of CARDINAL_DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (reachable.seen[ni] && isLiftWalkable(world, ni)) return ni;
  }
  return -1;
}

function clearAdjacentLiftButtons(world: World, liftIdx: number): void {
  const x = liftIdx % W;
  const y = (liftIdx / W) | 0;
  for (const [dx, dy] of CARDINAL_DIRS) {
    const idx = world.idx(x + dx, y + dy);
    if (world.features[idx] !== Feature.LIFT_BUTTON) continue;
    world.features[idx] = Feature.NONE;
    world.liftDir[idx] = LiftDirection.DOWN;
  }
}

function adjacentToLift(world: World, idx: number): boolean {
  const x = idx % W;
  const y = (idx / W) | 0;
  for (const [dx, dy] of CARDINAL_DIRS) {
    if (world.cells[world.idx(x + dx, y + dy)] === Cell.LIFT) return true;
  }
  return false;
}

function ensureLiftAccess(world: World, liftIdx: number, reachable: ReachableSet): boolean {
  clearAdjacentLiftButtons(world, liftIdx);
  if (routeLiftAccessReachable(world, liftIdx, reachable)) return true;
  const adj = reachableAdjacentLiftCell(world, liftIdx, reachable);
  return adj >= 0;
}

function adjacentLiftAccess(world: World, liftIdx: number, floorTex: Tex): number {
  const x = liftIdx % W;
  const y = (liftIdx / W) | 0;
  for (const [dx, dy] of CARDINAL_DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (isLiftWalkable(world, ni)) return ni;
  }
  for (const [dx, dy] of CARDINAL_DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (setConnectorFloor(world, ni, floorTex)) return ni;
  }
  return -1;
}

function setLiftCell(world: World, idx: number, direction: LiftDirection): void {
  if (world.cells[idx] === Cell.DOOR) clearDoorAt(world, idx);
  world.cells[idx] = Cell.LIFT;
  world.roomMap[idx] = -1;
  world.wallTex[idx] = Tex.LIFT_DOOR;
  world.features[idx] = Feature.NONE;
  world.liftDir[idx] = direction;
}

function demoteLiftCell(world: World, idx: number, floorTex: Tex): void {
  clearAdjacentLiftButtons(world, idx);
  world.cells[idx] = Cell.FLOOR;
  world.roomMap[idx] = -1;
  world.floorTex[idx] = floorTex;
  world.wallTex[idx] = Tex.CONCRETE;
  world.features[idx] = Feature.NONE;
}

function canPlaceReachableLift(world: World, idx: number, reachable: ReachableSet): number {
  if (!reachable.seen[idx] || world.cells[idx] !== Cell.FLOOR || world.roomMap[idx] >= 0) return -1;
  if (world.aptMask[idx] || world.hermoWall[idx] || world.features[idx] !== Feature.NONE || world.containerMap.has(idx)) return -1;
  const x = idx % W;
  const y = (idx / W) | 0;
  let adj = 0;
  let access = -1;
  for (const [dx, dy] of CARDINAL_DIRS) {
    const ni = world.idx(x + dx, y + dy);
    if (!reachable.seen[ni] || world.cells[ni] !== Cell.FLOOR || world.containerMap.has(ni)) continue;
    adj++;
    if (world.features[ni] === Feature.NONE || world.features[ni] === Feature.LIFT_BUTTON) access = ni;
  }
  return adj >= 2 ? access : -1;
}

function placeReachableLift(world: World, reachable: ReachableSet, direction: LiftDirection, blockedIdx = -1): boolean {
  if (reachable.count <= 0) return false;
  const start = direction === LiftDirection.UP
    ? Math.floor(reachable.count * 0.37)
    : Math.floor(reachable.count * 0.63);
  for (let n = 0; n < reachable.count; n++) {
    const idx = reachable.cells[(start + n) % reachable.count];
    if (idx === blockedIdx) continue;
    const access = canPlaceReachableLift(world, idx, reachable);
    if (access < 0) continue;
    setLiftCell(world, idx, direction);
    world.features[access] = Feature.NONE;
    world.liftDir[access] = LiftDirection.DOWN;
    return true;
  }
  return false;
}

function ensureExistingLiftReachable(
  world: World,
  liftIdx: number,
  reachable: ReachableSet,
  floorTex: Tex,
): boolean {
  if (ensureLiftAccess(world, liftIdx, reachable)) return true;
  const access = adjacentLiftAccess(world, liftIdx, floorTex);
  if (access < 0) return false;
  const target = nearestReachableCell(world, access, reachable, LIFT_CONNECTOR_MAX);
  if (target < 0 || !carveBoundedLiftConnector(world, access, target, floorTex)) return false;
  const updated = collectReachable(world, target);
  return ensureLiftAccess(world, liftIdx, updated);
}

function directionExpected(direction: LiftDirection, expected: readonly LiftDirection[]): boolean {
  return expected.includes(direction);
}

function cleanUnexpectedRouteLifts(world: World, expected: readonly LiftDirection[], floorTex: Tex): void {
  for (let i = 0; i < W * W; i++) {
    if (world.cells[i] === Cell.LIFT && !directionExpected(world.liftDir[i] as LiftDirection, expected)) {
      demoteLiftCell(world, i, floorTex);
    }
    if (world.features[i] === Feature.LIFT_BUTTON && !directionExpected(world.liftDir[i] as LiftDirection, expected)) {
      world.features[i] = Feature.NONE;
    } else if (world.features[i] === Feature.LIFT_BUTTON && adjacentToLift(world, i)) {
      world.features[i] = Feature.NONE;
    }
  }
}

export function routeLiftDirections(z: number, minZ: number, maxZ: number): LiftDirection[] {
  const directions: LiftDirection[] = [];
  if (z > minZ) directions.push(LiftDirection.DOWN);
  if (z < maxZ) directions.push(LiftDirection.UP);
  return directions;
}

export function ensureReachableRouteLifts(
  world: World,
  spawnX: number,
  spawnY: number,
  expectedDirections: readonly LiftDirection[],
  floorTex: Tex = Tex.F_CONCRETE,
): void {
  const expected = Array.from(new Set(expectedDirections));
  cleanUnexpectedRouteLifts(world, expected, floorTex);
  const spawnIdx = world.idx(Math.floor(spawnX), Math.floor(spawnY));
  let reachable = reachableFromPoint(world, spawnX, spawnY);

  for (const direction of expected) {
    let usable = 0;
    for (let i = 0; i < W * W; i++) {
      if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
      if (!ensureExistingLiftReachable(world, i, reachable, floorTex)) {
        demoteLiftCell(world, i, floorTex);
        continue;
      }
      reachable = reachableFromPoint(world, spawnX, spawnY);
      if (routeLiftAccessReachable(world, i, reachable)) usable++;
    }
    if (usable === 0 && placeReachableLift(world, reachable, direction, spawnIdx)) {
      reachable = reachableFromPoint(world, spawnX, spawnY);
    }
  }
}

/* ── Place lift cells in corridors ───────────────────────────── */
export function placeLifts(
  world: World,
  count: number,
  direction: LiftDirection = LiftDirection.DOWN,
  origin?: { x: number; y: number },
): void {
  let placed = 0;
  const reachable = origin ? reachableFromPoint(world, origin.x, origin.y) : firstWalkableComponent(world);
  const blockedIdx = origin ? world.idx(Math.floor(origin.x), Math.floor(origin.y)) : -1;
  for (let attempt = 0; attempt < 4000 && placed < count; attempt++) {
    const ci = reachable.count > 0
      ? reachable.cells[rng(0, reachable.count - 1)]
      : world.idx(rng(20, W - 20), rng(20, W - 20));
    if (ci === blockedIdx) continue;
    const access = canPlaceReachableLift(world, ci, reachable);
    if (access < 0) continue;
    setLiftCell(world, ci, direction);
    world.features[access] = Feature.NONE;
    world.liftDir[access] = LiftDirection.DOWN;
    placed++;
  }
}

/* ── Zone generation: 64 organic macro-regions ~128×128 ──────── */
const ZONE_GRID = 8;  // 8×8 = 64 zones
const ZONE_CELL = Math.floor(W / ZONE_GRID); // ~128

export function generateZones(world: World): void {
  const zones: Zone[] = [];

  // Create 64 zones with organic jittered centers
  for (let zy = 0; zy < ZONE_GRID; zy++) {
    for (let zx = 0; zx < ZONE_GRID; zx++) {
      const id = zy * ZONE_GRID + zx;
      const cx = world.wrap(zx * ZONE_CELL + Math.floor(ZONE_CELL / 2) + rng(-20, 20));
      const cy = world.wrap(zy * ZONE_CELL + Math.floor(ZONE_CELL / 2) + rng(-20, 20));

      // Faction distribution: 30% citizen, 20% liquidator, 20% cultist, 15% wild, 15% samosbor-free
      const roll = rng(0, 10000) / 10000;
      let faction: ZoneFaction;
      if (roll < 0.30) faction = ZoneFaction.CITIZEN;
      else if (roll < 0.50) faction = ZoneFaction.LIQUIDATOR;
      else if (roll < 0.70) faction = ZoneFaction.CULTIST;
      else if (roll < 0.85) faction = ZoneFaction.WILD;
      else faction = ZoneFaction.CITIZEN; // remaining goes to citizens
      // No SAMOSBOR zones initially

      zones.push({
        id, cx, cy,
        faction,
        hasLift: rng(0, 100) < 10,
        fogged: false,
        level: 1, // computed later per floor via assignZoneLevels
        hqRoomId: -1,
      });
    }
  }

  // Snake (boustrophedon) traversal: row 0 L→R, row 1 R→L, …
  // Use original grid position (from id) to avoid jitter-induced row/col swaps
  zones.sort((a, b) => {
    const agy = Math.floor(a.id / ZONE_GRID);
    const bgy = Math.floor(b.id / ZONE_GRID);
    if (agy !== bgy) return agy - bgy;
    const agx = a.id % ZONE_GRID;
    const bgx = b.id % ZONE_GRID;
    return (agy % 2 === 0) ? agx - bgx : bgx - agx;
  });
  // Reassign IDs to match new order
  for (let i = 0; i < zones.length; i++) zones[i].id = i;

  // Voronoi assignment: each cell → nearest zone center
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let bestD = Infinity;
      let bestZ = 0;
      for (let z = 0; z < zones.length; z++) {
        const dx = world.delta(x, zones[z].cx);
        const dy = world.delta(y, zones[z].cy);
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestZ = z; }
      }
      world.zoneMap[y * W + x] = bestZ;
    }
  }

  world.zones = zones;
}

/* ── Place шлюзы (airlocks) at zone boundaries + corridors ──── */
// Pattern: DOOR — FLOOR — DOOR (3 cells in a corridor)
export function placeAirlocks(world: World): void {
  const used = new Set<number>(); // avoid duplicate / too-close airlocks

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const mi = y * W + x; // middle cell
      if (world.cells[mi] !== Cell.FLOOR) continue;
      if (world.aptMask[mi]) continue;

      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        // prev and next along direction
        const px = world.wrap(x - dx), py = world.wrap(y - dy);
        const nx = world.wrap(x + dx), ny = world.wrap(y + dy);
        const pi = world.idx(px, py);
        const ni = world.idx(nx, ny);

        if (world.cells[pi] !== Cell.FLOOR || world.aptMask[pi]) continue;
        if (world.cells[ni] !== Cell.FLOOR || world.aptMask[ni]) continue;

        // Zone boundary OR 1% chance in any corridor (rare inter-room airlocks)
        const crossesZone = world.zoneMap[pi] !== world.zoneMap[ni];
        if (!crossesZone && rng(0, 100) > 1) continue;

        // Corridor check: perpendicular walls on all 3 cells
        let corridor = true;
        for (const [cx, cy] of [[px, py], [x, y], [nx, ny]]) {
          const wp = world.idx(world.wrap(cx + dy), world.wrap(cy + dx));
          const wn = world.idx(world.wrap(cx - dy), world.wrap(cy - dx));
          if (world.cells[wp] !== Cell.WALL || world.cells[wn] !== Cell.WALL) {
            corridor = false; break;
          }
        }
        if (!corridor) continue;

        // Anti-clustering (tighter for zone boundaries, wider for random)
        if (used.has(pi) || used.has(mi) || used.has(ni)) continue;

        // No existing doors nearby
        let tooClose = false;
        for (const [ox, oy] of [[2,0],[-2,0],[0,2],[0,-2]]) {
          const ci = world.idx(world.wrap(x + ox), world.wrap(y + oy));
          if (world.cells[ci] === Cell.DOOR) { tooClose = true; break; }
        }
        if (tooClose) continue;

        // Place: prev=DOOR, middle stays FLOOR, next=DOOR
        world.cells[pi] = Cell.DOOR;
        world.doors.set(pi, {
          idx: pi, state: DoorState.CLOSED,
          roomA: -1, roomB: -1, keyId: '', timer: 0,
        });
        world.cells[ni] = Cell.DOOR;
        world.doors.set(ni, {
          idx: ni, state: DoorState.CLOSED,
          roomA: -1, roomB: -1, keyId: '', timer: 0,
        });

        // Mark area as used (prevent consecutive airlocks)
        for (let r = -3; r <= 3; r++) {
          used.add(world.idx(world.wrap(x + r * dx), world.wrap(y + r * dy)));
        }
      }
    }
  }
}

/* ── Punch thin walls to create shortcut loops ───────────────── */
export function punchThinWalls(world: World, chance: number = 0.12): void {
  const dirs: [number, number][] = [[1,0],[0,1]];
  const walk = (c: number) => c === Cell.FLOOR || c === Cell.DOOR;
  const punched = new Set<number>();

  for (let y = 1; y < W - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const mi = y * W + x;
      if (world.cells[mi] !== Cell.WALL) continue;
      if (world.aptMask[mi]) continue;
      if (world.roomMap[mi] >= 0) continue;

      for (const [dx, dy] of dirs) {
        const ai = world.idx(world.wrap(x - dx), world.wrap(y - dy));
        const bi = world.idx(world.wrap(x + dx), world.wrap(y + dy));
        if (!walk(world.cells[ai]) || !walk(world.cells[bi])) continue;
        if (world.aptMask[ai] || world.aptMask[bi]) continue;

        // Flanking cells must be walls (maintain wall-gap-wall pattern)
        const f1 = world.idx(world.wrap(x + dy), world.wrap(y + dx));
        const f2 = world.idx(world.wrap(x - dy), world.wrap(y - dx));
        if (world.cells[f1] !== Cell.WALL || world.cells[f2] !== Cell.WALL) continue;

        // Anti-clustering: skip if a nearby cell was already punched
        let nearby = false;
        for (const [ox, oy] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]) {
          if (punched.has(world.idx(world.wrap(x + ox), world.wrap(y + oy)))) { nearby = true; break; }
        }
        if (nearby) continue;

        if ((rng(0, 10000) / 10000) < chance) {
          world.cells[mi] = Cell.FLOOR;
          punched.add(mi);
        }
      }
    }
  }
}

/* ── Stamp HQ rooms for each zone ─────────────────────────────── */
const HQ_W = 7, HQ_H = 7;
const ZONE_FACTION_TEX: Record<ZoneFaction, Tex> = {
  [ZoneFaction.CITIZEN]:    Tex.PANEL,
  [ZoneFaction.LIQUIDATOR]: Tex.METAL,
  [ZoneFaction.CULTIST]:    Tex.DARK,
  [ZoneFaction.WILD]:       Tex.ROTTEN,
  [ZoneFaction.SAMOSBOR]:   Tex.CONCRETE,
  [ZoneFaction.SCIENTIST]:  Tex.BRICK,
};

export function stampHQRooms(world: World): void {
  for (const zone of world.zones) {
    if (zone.faction === ZoneFaction.SAMOSBOR) continue;

    // Find a valid spot near zone center for a 7×7 room
    let placed = false;
    for (let attempt = 0; attempt < 20 && !placed; attempt++) {
      const rx = world.wrap(zone.cx + rng(-15, 15));
      const ry = world.wrap(zone.cy + rng(-15, 15));

      // Check area is all walls (not yet carved)
      let ok = true;
      for (let dy = -1; dy <= HQ_H && ok; dy++) {
        for (let dx = -1; dx <= HQ_W && ok; dx++) {
          const ci = world.idx(rx + dx, ry + dy);
          if (world.aptMask[ci]) ok = false;
          if (world.cells[ci] !== Cell.WALL) ok = false;
        }
      }
      if (!ok) continue;

      // Stamp HQ room
      const roomId = world.rooms.length;
      const room = stampRoom(world, roomId, RoomType.HQ, rx, ry, HQ_W, HQ_H, -1);
      room.name = `Штаб зоны ${zone.id + 1}`;
      room.wallTex = ZONE_FACTION_TEX[zone.faction] ?? Tex.METAL;
      // Apply wall/floor texture to all cells in the room
      for (let dy = -1; dy <= HQ_H; dy++) {
        for (let dx = -1; dx <= HQ_W; dx++) {
          const ci = world.idx(rx + dx, ry + dy);
          world.wallTex[ci] = room.wallTex;
          if (dx >= 0 && dx < HQ_W && dy >= 0 && dy < HQ_H) {
            world.floorTex[ci] = Tex.F_CONCRETE;
          }
        }
      }

      // Add lamp in center
      world.features[world.idx(rx + 3, ry + 3)] = Feature.LAMP;

      // Place door on south wall
      const doorX = rx + Math.floor(HQ_W / 2);
      const doorY = world.wrap(ry + HQ_H);
      const doorI = world.idx(doorX, doorY);
      world.cells[doorI] = Cell.DOOR;
      world.doors.set(doorI, {
        idx: doorI, state: DoorState.CLOSED,
        roomA: roomId, roomB: -1, keyId: '', timer: 0,
      });
      room.doors.push(doorI);

      zone.hqRoomId = roomId;
      placed = true;
    }
  }
}
