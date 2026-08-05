/* -- Generation-time geometry quality metrics -------------------- */

import { Cell, DoorState, LiftDirection, W } from '../core/types';
import type { World } from '../core/world';
import type { FloorGeometryId } from '../data/procedural_floors';

export type GeometryMetricsId = FloorGeometryId | string;
export type GeometryGenerationTimeBucket = 'unknown' | 'instant' | 'fast' | 'normal' | 'slow' | 'very_slow';

export interface GeometryAnchor {
  id?: string;
  x?: number;
  y?: number;
  idx?: number;
}

export interface GeometryProtectedSnapshot {
  indices: Int32Array;
  cells: Uint8Array;
  roomMap: Int16Array;
  wallTex: Uint8Array;
  floorTex: Uint8Array;
  features: Uint8Array;
}

export interface GeometryMetricsOptions {
  id?: GeometryMetricsId;
  spawn?: GeometryAnchor;
  anchors?: readonly GeometryAnchor[];
  protectedMask?: Uint8Array;
  protectedSnapshot?: GeometryProtectedSnapshot;
  coarseSize?: 16 | 32 | 64 | 128;
  densityBucketSize?: number;
  losSampleCount?: number;
  losMaxDistance?: number;
  generationMs?: number;
}

export interface GeometryLiftPathMetrics {
  up: number;
  down: number;
}

export interface GeometryRoomReachabilityMetrics {
  total: number;
  reachable: number;
  unreachable: number;
  unreachableRoomIds: number[];
}

export interface GeometryGraphMetrics {
  size: number;
  nodeCount: number;
  edgeCount: number;
  componentCount: number;
  loopCount: number;
  pathEntropy: number;
  maxDegree: number;
  isolatedCount: number;
}

export interface GeometryLosMetrics {
  samples: number;
  rays: number;
  maxDistance: number;
  p95: number;
  p99: number;
}

export interface GeometryDensityMetrics {
  bucketSize: number;
  gridSize: number;
  max: number;
  maxRatio: number;
  x: number;
  y: number;
}

export interface GeometryProtectedMetrics {
  protectedCells: number;
  mutationCount: number;
}

export interface GeometryTorusSeamMetrics {
  ok: boolean;
  indexWrapOk: boolean;
  horizontalPassablePairs: number;
  verticalPassablePairs: number;
  mismatchedReachabilityPairs: number;
}

export interface GeometryGenerationTimeMetrics {
  ms: number;
  bucket: GeometryGenerationTimeBucket;
}

export interface GeometryAnchorDistance {
  id: string;
  idx: number;
  pathLength: number;
}

export interface GeometryMetrics {
  id: GeometryMetricsId;
  cellCount: number;
  passableCount: number;
  reachableCount: number;
  reachableRatio: number;
  spawnIdx: number;
  liftPathLength: GeometryLiftPathMetrics;
  nonSealedRoomReachability: GeometryRoomReachabilityMetrics;
  ordinaryChokeSeverity: number;
  coarseGraph: GeometryGraphMetrics;
  los: GeometryLosMetrics;
  density: GeometryDensityMetrics;
  protected: GeometryProtectedMetrics;
  torusSeam: GeometryTorusSeamMetrics;
  generationTime: GeometryGenerationTimeMetrics;
  anchorDistances: GeometryAnchorDistance[];

  /* Backward-compatible summary fields for early geometry agents. */
  landmarkCount: number;
  pathEntropy: number;
  loopCount: number;
  nodeCount: number;
  edgeCount: number;
}

const ORTHO_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const COARSE_RIGHT = 1 << 0;
const COARSE_LEFT = 1 << 1;
const COARSE_DOWN = 1 << 2;
const COARSE_UP = 1 << 3;
const LOS_DIRS = [
  [1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239],
  [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827],
  [-1, 0], [-0.9239, -0.3827], [-0.7071, -0.7071], [-0.3827, -0.9239],
  [0, -1], [0.3827, -0.9239], [0.7071, -0.7071], [0.9239, -0.3827],
] as const;

const metricsByWorld = new WeakMap<World, GeometryMetrics[]>();

export function recordGeometryMetrics(world: World, metrics: GeometryMetrics): void {
  const entries = metricsByWorld.get(world) ?? [];
  const existing = entries.findIndex(entry => entry.id === metrics.id);
  if (existing >= 0) entries[existing] = metrics;
  else entries.push(metrics);
  metricsByWorld.set(world, entries);
}

export function getGeometryMetrics(world: World, id?: GeometryMetricsId): readonly GeometryMetrics[] {
  const entries = metricsByWorld.get(world) ?? [];
  return id === undefined ? entries : entries.filter(entry => entry.id === id);
}

export function createGeometryProtectedSnapshot(world: World, protectedMask: Uint8Array = world.aptMask): GeometryProtectedSnapshot {
  assertWorldMaskLength(protectedMask, 'protectedMask');
  let protectedCells = 0;
  for (let i = 0; i < protectedMask.length; i++) {
    if (protectedMask[i]) protectedCells++;
  }

  const indices = new Int32Array(protectedCells);
  const cells = new Uint8Array(protectedCells);
  const roomMap = new Int16Array(protectedCells);
  const wallTex = new Uint8Array(protectedCells);
  const floorTex = new Uint8Array(protectedCells);
  const features = new Uint8Array(protectedCells);
  let out = 0;
  for (let i = 0; i < protectedMask.length; i++) {
    if (!protectedMask[i]) continue;
    indices[out] = i;
    cells[out] = world.cells[i];
    roomMap[out] = world.roomMap[i];
    wallTex[out] = world.wallTex[i];
    floorTex[out] = world.floorTex[i];
    features[out] = world.features[i];
    out++;
  }
  return { indices, cells, roomMap, wallTex, floorTex, features };
}

export function measureGeometryMetrics(world: World, options: GeometryMetricsOptions = {}): GeometryMetrics {
  if (options.protectedMask) assertWorldMaskLength(options.protectedMask, 'protectedMask');
  if (options.protectedSnapshot) assertProtectedSnapshot(options.protectedSnapshot);

  const spawnIdx = resolveAnchorIndex(world, options.spawn) ?? findFirstPassableCell(world);
  const reachability = computeReachability(world, spawnIdx);
  const roomReachability = measureRoomReachability(world, reachability.reachable);
  const coarseGraph = measureCoarseGraph(world, options.coarseSize ?? 64);
  const los = measureLos(world, reachability.reachable, spawnIdx, options);
  const density = measureDensity(world, options.densityBucketSize ?? 32);
  const protectedMetrics = measureProtectedCells(world, options.protectedMask, options.protectedSnapshot);
  const torusSeam = measureTorusSeams(world, reachability.reachable);
  const generationTime = describeGenerationTime(options.generationMs);
  const liftPathLength = measureLiftPaths(world, reachability.distance);
  const anchorDistances = measureAnchorDistances(world, reachability.distance, options.anchors);
  const passableCount = reachability.passableCount;
  const reachableCount = reachability.reachableCount;
  const reachableRatio = passableCount === 0 ? 0 : round3(reachableCount / passableCount);
  const ordinaryChokeSeverity = measureOrdinaryChokeSeverity(world, reachability.reachable, reachableCount);

  return {
    id: options.id ?? 'world',
    cellCount: W * W,
    passableCount,
    reachableCount,
    reachableRatio,
    spawnIdx,
    liftPathLength,
    nonSealedRoomReachability: roomReachability,
    ordinaryChokeSeverity,
    coarseGraph,
    los,
    density,
    protected: protectedMetrics,
    torusSeam,
    generationTime,
    anchorDistances,
    landmarkCount: anchorDistances.length,
    pathEntropy: coarseGraph.pathEntropy,
    loopCount: coarseGraph.loopCount,
    nodeCount: coarseGraph.nodeCount,
    edgeCount: coarseGraph.edgeCount,
  };
}

export function measureAndRecordGeometryMetrics(world: World, options: GeometryMetricsOptions = {}): GeometryMetrics {
  const metrics = measureGeometryMetrics(world, options);
  recordGeometryMetrics(world, metrics);
  return metrics;
}

export function describeGenerationTime(generationMs: number | undefined): GeometryGenerationTimeMetrics {
  if (generationMs === undefined || !Number.isFinite(generationMs) || generationMs < 0) {
    return { ms: -1, bucket: 'unknown' };
  }
  const ms = Math.round(generationMs * 10) / 10;
  if (ms < 10) return { ms, bucket: 'instant' };
  if (ms < 60) return { ms, bucket: 'fast' };
  if (ms < 220) return { ms, bucket: 'normal' };
  if (ms < 750) return { ms, bucket: 'slow' };
  return { ms, bucket: 'very_slow' };
}

function computeReachability(world: World, startIdx: number): {
  reachable: Uint8Array;
  distance: Int32Array;
  passableCount: number;
  reachableCount: number;
} {
  const total = W * W;
  const reachable = new Uint8Array(total);
  const distance = new Int32Array(total);
  distance.fill(-1);

  let passableCount = 0;
  for (let i = 0; i < total; i++) {
    if (metricWalkable(world, i)) passableCount++;
  }

  if (startIdx < 0 || !metricWalkable(world, startIdx)) {
    return { reachable, distance, passableCount, reachableCount: 0 };
  }

  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  let reachableCount = 1;
  reachable[startIdx] = 1;
  distance[startIdx] = 0;
  queue[tail++] = startIdx;

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % W;
    const y = (idx / W) | 0;
    const nextDistance = distance[idx] + 1;
    for (const [dx, dy] of ORTHO_DIRS) {
      const next = world.idx(x + dx, y + dy);
      if (reachable[next] || !metricWalkable(world, next)) continue;
      reachable[next] = 1;
      distance[next] = nextDistance;
      queue[tail++] = next;
      reachableCount++;
    }
  }

  return { reachable, distance, passableCount, reachableCount };
}

function metricWalkable(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  return cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR;
}

function metricLosBlocked(world: World, idx: number): boolean {
  const cell = world.cells[idx];
  if (cell === Cell.FLOOR || cell === Cell.WATER) return false;
  if (cell !== Cell.DOOR) return true;
  const door = world.doors.get(idx);
  return door?.state !== DoorState.OPEN && door?.state !== DoorState.HERMETIC_OPEN;
}

function findFirstPassableCell(world: World): number {
  for (let i = 0; i < world.cells.length; i++) {
    if (metricWalkable(world, i)) return i;
  }
  return -1;
}

function resolveAnchorIndex(world: World, anchor: GeometryAnchor | undefined): number | undefined {
  if (!anchor) return undefined;
  if (anchor.idx !== undefined) return wrapIndex(anchor.idx);
  if (anchor.x === undefined || anchor.y === undefined) return undefined;
  return world.idx(Math.floor(anchor.x), Math.floor(anchor.y));
}

function measureLiftPaths(world: World, distance: Int32Array): GeometryLiftPathMetrics {
  return {
    up: shortestDistanceToLift(world, distance, LiftDirection.UP),
    down: shortestDistanceToLift(world, distance, LiftDirection.DOWN),
  };
}

function shortestDistanceToLift(world: World, distance: Int32Array, direction: LiftDirection): number {
  let best = -1;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== Cell.LIFT || world.liftDir[i] !== direction) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      const neighbor = world.idx(x + dx, y + dy);
      const d = distance[neighbor];
      if (d < 0) continue;
      const pathLength = d + 1;
      if (best < 0 || pathLength < best) best = pathLength;
    }
  }
  return best;
}

function measureAnchorDistances(
  world: World,
  distance: Int32Array,
  anchors: readonly GeometryAnchor[] | undefined,
): GeometryAnchorDistance[] {
  if (!anchors || anchors.length === 0) return [];
  const out: GeometryAnchorDistance[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const idx = resolveAnchorIndex(world, anchors[i]);
    if (idx === undefined) continue;
    out.push({
      id: anchors[i].id ?? `anchor_${i}`,
      idx,
      pathLength: distance[idx] ?? -1,
    });
  }
  return out;
}

function measureRoomReachability(world: World, reachable: Uint8Array): GeometryRoomReachabilityMetrics {
  const roomCount = world.rooms.length;
  const roomHasReachableCell = new Uint8Array(roomCount);
  for (let i = 0; i < world.roomMap.length; i++) {
    if (!reachable[i]) continue;
    const roomId = world.roomMap[i];
    if (roomId >= 0 && roomId < roomCount) roomHasReachableCell[roomId] = 1;
  }

  let total = 0;
  let reachableRooms = 0;
  const unreachableRoomIds: number[] = [];
  for (const room of world.rooms) {
    if (!room || room.sealed) continue;
    total++;
    if (roomHasReachableCell[room.id]) reachableRooms++;
    else unreachableRoomIds.push(room.id);
  }
  return {
    total,
    reachable: reachableRooms,
    unreachable: unreachableRoomIds.length,
    unreachableRoomIds: unreachableRoomIds.slice(0, 32),
  };
}

function measureOrdinaryChokeSeverity(world: World, reachable: Uint8Array, reachableCount: number): number {
  if (reachableCount === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < reachable.length; i++) {
    if (!reachable[i]) continue;
    const x = i % W;
    const y = (i / W) | 0;
    let degree = 0;
    for (const [dx, dy] of ORTHO_DIRS) {
      if (metricWalkable(world, world.idx(x + dx, y + dy))) degree++;
    }
    if (degree <= 1) weighted += 2;
    else if (degree === 2) weighted += 0.55;
    else if (degree === 3) weighted += 0.08;
  }
  return round3(Math.min(1, weighted / Math.max(1, reachableCount * 2)));
}

function measureCoarseGraph(world: World, size: 16 | 32 | 64 | 128): GeometryGraphMetrics {
  const cellSize = W / size;
  const total = size * size;
  const nodes = new Uint8Array(total);
  const degree = new Uint8Array(total);
  const minPassable = Math.max(1, Math.floor(cellSize * cellSize * 0.02));

  let nodeCount = 0;
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      let passable = 0;
      const x0 = gx * cellSize;
      const y0 = gy * cellSize;
      for (let y = 0; y < cellSize; y++) {
        for (let x = 0; x < cellSize; x++) {
          if (metricWalkable(world, world.idx(x0 + x, y0 + y))) passable++;
        }
      }
      const gi = gy * size + gx;
      if (passable >= minPassable) {
        nodes[gi] = 1;
        nodeCount++;
      }
    }
  }

  let edgeCount = 0;
  const adjacency = new Uint8Array(total);
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const gi = gy * size + gx;
      if (!nodes[gi]) continue;
      const right = gy * size + ((gx + 1) % size);
      if (nodes[right] && coarseBoundaryTouches(world, size, gx, gy, 1, 0)) {
        edgeCount++;
        degree[gi]++;
        degree[right]++;
        adjacency[gi] |= COARSE_RIGHT;
        adjacency[right] |= COARSE_LEFT;
      }
      const down = ((gy + 1) % size) * size + gx;
      if (nodes[down] && coarseBoundaryTouches(world, size, gx, gy, 0, 1)) {
        edgeCount++;
        degree[gi]++;
        degree[down]++;
        adjacency[gi] |= COARSE_DOWN;
        adjacency[down] |= COARSE_UP;
      }
    }
  }

  const componentCount = countCoarseComponents(size, nodes, adjacency);
  let isolatedCount = 0;
  let maxDegree = 0;
  let pathEntropy = 0;
  for (let i = 0; i < total; i++) {
    if (!nodes[i]) continue;
    const d = degree[i];
    if (d === 0) isolatedCount++;
    if (d > maxDegree) maxDegree = d;
    pathEntropy += Math.log2(Math.max(1, d));
  }
  pathEntropy = nodeCount === 0 ? 0 : round3(pathEntropy / nodeCount);

  return {
    size,
    nodeCount,
    edgeCount,
    componentCount,
    loopCount: Math.max(0, edgeCount - nodeCount + componentCount),
    pathEntropy,
    maxDegree,
    isolatedCount,
  };
}

function coarseBoundaryTouches(world: World, size: number, gx: number, gy: number, stepX: 0 | 1, _stepY: 0 | 1): boolean {
  const cellSize = W / size;
  const x0 = gx * cellSize;
  const y0 = gy * cellSize;
  if (stepX) {
    const x = x0 + cellSize - 1;
    for (let y = 0; y < cellSize; y++) {
      if (metricWalkable(world, world.idx(x, y0 + y)) && metricWalkable(world, world.idx(x + 1, y0 + y))) return true;
    }
    return false;
  }
  const y = y0 + cellSize - 1;
  for (let x = 0; x < cellSize; x++) {
    if (metricWalkable(world, world.idx(x0 + x, y)) && metricWalkable(world, world.idx(x0 + x, y + 1))) return true;
  }
  return false;
}

function countCoarseComponents(size: number, nodes: Uint8Array, adjacency: Uint8Array): number {
  const total = size * size;
  const seen = new Uint8Array(total);
  const queue = new Int32Array(total);
  let components = 0;
  for (let start = 0; start < total; start++) {
    if (!nodes[start] || seen[start]) continue;
    components++;
    let head = 0;
    let tail = 0;
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const idx = queue[head++];
      const gx = idx % size;
      const gy = (idx / size) | 0;
      const mask = adjacency[idx];
      if (mask & COARSE_RIGHT) tail = enqueueCoarse(gy * size + ((gx + 1) % size), nodes, seen, queue, tail);
      if (mask & COARSE_LEFT) tail = enqueueCoarse(gy * size + ((gx + size - 1) % size), nodes, seen, queue, tail);
      if (mask & COARSE_DOWN) tail = enqueueCoarse(((gy + 1) % size) * size + gx, nodes, seen, queue, tail);
      if (mask & COARSE_UP) tail = enqueueCoarse(((gy + size - 1) % size) * size + gx, nodes, seen, queue, tail);
    }
  }
  return components;
}

function enqueueCoarse(index: number, nodes: Uint8Array, seen: Uint8Array, queue: Int32Array, tail: number): number {
  if (!nodes[index] || seen[index]) return tail;
  seen[index] = 1;
  queue[tail] = index;
  return tail + 1;
}

function measureLos(world: World, reachable: Uint8Array, spawnIdx: number, options: GeometryMetricsOptions): GeometryLosMetrics {
  const sampleTarget = Math.max(1, Math.min(512, Math.floor(options.losSampleCount ?? 160)));
  const maxDistance = Math.max(8, Math.min(256, Math.floor(options.losMaxDistance ?? 96)));
  const sampleIdxs = new Int32Array(sampleTarget);
  let sampleCount = 0;

  if (spawnIdx >= 0 && reachable[spawnIdx]) sampleIdxs[sampleCount++] = spawnIdx;
  let reachableTotal = 0;
  for (let i = 0; i < reachable.length; i++) {
    if (reachable[i]) reachableTotal++;
  }
  const stride = Math.max(1, Math.floor(reachableTotal / sampleTarget));
  let reachableSeen = 0;
  for (let i = 0; i < reachable.length && sampleCount < sampleTarget; i++) {
    if (!reachable[i]) continue;
    reachableSeen++;
    if (reachableSeen % stride !== 0) continue;
    if (i === spawnIdx) continue;
    sampleIdxs[sampleCount++] = i;
  }

  if (sampleCount === 0) {
    return { samples: 0, rays: 0, maxDistance, p95: 0, p99: 0 };
  }

  const rayDistances = new Float32Array(sampleCount * LOS_DIRS.length);
  let rays = 0;
  for (let s = 0; s < sampleCount; s++) {
    const idx = sampleIdxs[s];
    const sx = idx % W;
    const sy = (idx / W) | 0;
    for (const [dx, dy] of LOS_DIRS) {
      rayDistances[rays++] = castLos(world, sx + 0.5, sy + 0.5, dx, dy, maxDistance);
    }
  }

  const sorted = rayDistances.slice(0, rays).sort();
  return {
    samples: sampleCount,
    rays,
    maxDistance,
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function castLos(world: World, startX: number, startY: number, dx: number, dy: number, maxDistance: number): number {
  let last = 0;
  for (let step = 1; step <= maxDistance; step++) {
    const x = Math.floor(startX + dx * step);
    const y = Math.floor(startY + dy * step);
    const idx = world.idx(x, y);
    if (metricLosBlocked(world, idx)) return last;
    last = step;
  }
  return maxDistance;
}

function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return Math.round(sorted[idx] * 10) / 10;
}

function measureDensity(world: World, bucketSizeOption: number): GeometryDensityMetrics {
  const bucketSize = clampInt(bucketSizeOption, 4, 128);
  const gridSize = Math.ceil(W / bucketSize);
  const counts = new Uint32Array(gridSize * gridSize);
  let max = 0;
  let maxIndex = 0;
  for (let y = 0; y < W; y++) {
    const by = Math.min(gridSize - 1, Math.floor(y / bucketSize));
    for (let x = 0; x < W; x++) {
      const idx = world.idx(x, y);
      if (!metricWalkable(world, idx)) continue;
      const bx = Math.min(gridSize - 1, Math.floor(x / bucketSize));
      const bi = by * gridSize + bx;
      const next = ++counts[bi];
      if (next > max) {
        max = next;
        maxIndex = bi;
      }
    }
  }
  const maxBucketCells = bucketSize * bucketSize;
  return {
    bucketSize,
    gridSize,
    max,
    maxRatio: round3(max / maxBucketCells),
    x: (maxIndex % gridSize) * bucketSize,
    y: ((maxIndex / gridSize) | 0) * bucketSize,
  };
}

function measureProtectedCells(
  world: World,
  protectedMask: Uint8Array | undefined,
  snapshot: GeometryProtectedSnapshot | undefined,
): GeometryProtectedMetrics {
  let protectedCells = 0;
  if (protectedMask) {
    for (let i = 0; i < protectedMask.length; i++) {
      if (protectedMask[i]) protectedCells++;
    }
  } else if (snapshot) {
    protectedCells = snapshot.indices.length;
  }

  let mutationCount = 0;
  if (snapshot) {
    for (let i = 0; i < snapshot.indices.length; i++) {
      const idx = snapshot.indices[i];
      if (
        world.cells[idx] !== snapshot.cells[i]
        || world.roomMap[idx] !== snapshot.roomMap[i]
        || world.wallTex[idx] !== snapshot.wallTex[i]
        || world.floorTex[idx] !== snapshot.floorTex[i]
        || world.features[idx] !== snapshot.features[i]
      ) mutationCount++;
    }
  }

  return { protectedCells, mutationCount };
}

function measureTorusSeams(world: World, reachable: Uint8Array): GeometryTorusSeamMetrics {
  const indexWrapOk = world.idx(-1, 0) === world.idx(W - 1, 0)
    && world.idx(W, 0) === world.idx(0, 0)
    && world.idx(0, -1) === world.idx(0, W - 1)
    && world.idx(0, W) === world.idx(0, 0);
  let horizontalPassablePairs = 0;
  let verticalPassablePairs = 0;
  let mismatchedReachabilityPairs = 0;

  for (let y = 0; y < W; y++) {
    const a = world.idx(0, y);
    const b = world.idx(W - 1, y);
    if (metricWalkable(world, a) && metricWalkable(world, b)) {
      horizontalPassablePairs++;
      if (reachable[a] !== reachable[b]) mismatchedReachabilityPairs++;
    }
  }
  for (let x = 0; x < W; x++) {
    const a = world.idx(x, 0);
    const b = world.idx(x, W - 1);
    if (metricWalkable(world, a) && metricWalkable(world, b)) {
      verticalPassablePairs++;
      if (reachable[a] !== reachable[b]) mismatchedReachabilityPairs++;
    }
  }

  return {
    ok: indexWrapOk && mismatchedReachabilityPairs === 0,
    indexWrapOk,
    horizontalPassablePairs,
    verticalPassablePairs,
    mismatchedReachabilityPairs,
  };
}

function wrapIndex(idx: number): number {
  const total = W * W;
  const value = Math.floor(idx);
  return ((value % total) + total) % total;
}

function assertWorldMaskLength(mask: Uint8Array, label: string): void {
  if (mask.length !== W * W) throw new Error(`${label} length ${mask.length} does not match world cell count ${W * W}`);
}

function assertProtectedSnapshot(snapshot: GeometryProtectedSnapshot): void {
  const length = snapshot.indices.length;
  if (
    snapshot.cells.length !== length
    || snapshot.roomMap.length !== length
    || snapshot.wallTex.length !== length
    || snapshot.floorTex.length !== length
    || snapshot.features.length !== length
  ) throw new Error('protected snapshot arrays must have matching lengths');
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(value)));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
