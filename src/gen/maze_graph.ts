/* -- Coarse fair maze graphs for floor generation ---------------- */

import type { RandomSource } from '../core/rand';

export type MazeEdgeTag = 'backbone' | 'chord' | 'locked_optional' | 'reward_leaf';
export type MazeSeamAxis = 'x' | 'y';
export type MazeSelectionKind = 'newest' | 'oldest' | 'random';

export interface MazeSelectionWeights {
  newest?: number;
  oldest?: number;
  random?: number;
}

export interface MazeGraphNode {
  id: number;
  gx: number;
  gy: number;
  x: number;
  y: number;
  depth: number;
  centrality: number;
  degree: number;
  landmarkScore: number;
}

export interface MazeGraphEdge {
  a: number;
  b: number;
  tag: MazeEdgeTag;
  seamAxis?: MazeSeamAxis;
}

export interface MazeProtectedSeam {
  edgeIndex: number;
  a: number;
  b: number;
  axis: MazeSeamAxis;
}

export interface MazeGraph {
  width: number;
  height: number;
  nodes: MazeGraphNode[];
  edges: MazeGraphEdge[];
  startId: number;
  endId: number;
  landmarkIds: number[];
  landmarkSpacing: number;
  protectedSeams: MazeProtectedSeam[];
  loopCount: number;
  pathEntropy: number;
}

export interface MazeGraphValidation {
  connected: boolean;
  liftBackboneUngated: boolean;
  optionalLocksValid: boolean;
  seamMetadataValid: boolean;
  landmarkSpacing: number;
  errors: string[];
}

export interface MazeBaseOptions {
  width: number;
  height: number;
  originX: number;
  originY: number;
  cellSize: number;
  startGx?: number;
  startGy?: number;
  endGx?: number;
  endGy?: number;
  braidChance?: number;
  extraChordCount?: number;
  lockedChordChance?: number;
  rewardLeafChance?: number;
  landmarkCount?: number;
  rand?: RandomSource;
}

export interface GrowingTreeMazeOptions extends MazeBaseOptions {
  selectionWeights?: MazeSelectionWeights;
}

export interface WilsonMazeOptions extends MazeBaseOptions {}

interface MazeContext {
  width: number;
  height: number;
  n: number;
  startId: number;
  explicitEndId: number | undefined;
  originX: number;
  originY: number;
  cellSize: number;
}

const DEFAULT_SELECTION_WEIGHTS: Required<MazeSelectionWeights> = {
  newest: 0.62,
  oldest: 0.18,
  random: 0.2,
};

function clampInt(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(value)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function nodeId(width: number, gx: number, gy: number): number {
  return gy * width + gx;
}

function wrapGrid(value: number, size: number): number {
  return ((Math.floor(value) % size) + size) % size;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function pickIndex<T>(items: readonly T[], rand: RandomSource): number {
  return Math.min(items.length - 1, Math.floor(rand() * items.length));
}

function randomNodeId(count: number, rand: RandomSource): number {
  return Math.min(count - 1, Math.floor(rand() * count));
}

function normalizeContext(options: MazeBaseOptions): MazeContext {
  const width = Math.max(2, Math.floor(options.width));
  const height = Math.max(2, Math.floor(options.height));
  const startGx = clampInt(options.startGx ?? Math.floor(width / 2), 0, width - 1);
  const startGy = clampInt(options.startGy ?? Math.floor(height / 2), 0, height - 1);
  const explicitEndId = options.endGx === undefined && options.endGy === undefined
    ? undefined
    : nodeId(
      width,
      clampInt(options.endGx ?? startGx, 0, width - 1),
      clampInt(options.endGy ?? startGy, 0, height - 1),
    );
  return {
    width,
    height,
    n: width * height,
    startId: nodeId(width, startGx, startGy),
    explicitEndId,
    originX: Math.floor(options.originX),
    originY: Math.floor(options.originY),
    cellSize: Math.max(1, Math.floor(options.cellSize)),
  };
}

function neighbors(width: number, height: number, id: number): number[] {
  const gx = id % width;
  const gy = (id / width) | 0;
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (x: number, y: number): void => {
    const next = nodeId(width, wrapGrid(x, width), wrapGrid(y, height));
    if (next === id || seen.has(next)) return;
    seen.add(next);
    out.push(next);
  };
  push(gx - 1, gy);
  push(gx + 1, gy);
  push(gx, gy - 1);
  push(gx, gy + 1);
  return out;
}

function normalizeSelectionWeights(weights: MazeSelectionWeights | undefined): Required<MazeSelectionWeights> {
  const newest = Math.max(0, weights?.newest ?? DEFAULT_SELECTION_WEIGHTS.newest);
  const oldest = Math.max(0, weights?.oldest ?? DEFAULT_SELECTION_WEIGHTS.oldest);
  const random = Math.max(0, weights?.random ?? DEFAULT_SELECTION_WEIGHTS.random);
  if (newest + oldest + random <= 0) return { newest: 1, oldest: 0, random: 0 };
  return { newest, oldest, random };
}

function selectActive(active: readonly number[], rand: RandomSource, weights: Required<MazeSelectionWeights>): number {
  const total = weights.newest + weights.oldest + weights.random;
  const roll = rand() * total;
  if (roll < weights.newest) return active.length - 1;
  if (roll < weights.newest + weights.oldest) return 0;
  return pickIndex(active, rand);
}

function edgeSeamAxis(width: number, height: number, a: number, b: number): MazeSeamAxis | undefined {
  const ax = a % width;
  const ay = (a / width) | 0;
  const bx = b % width;
  const by = (b / width) | 0;
  if (ay === by && Math.abs(ax - bx) === width - 1) return 'x';
  if (ax === bx && Math.abs(ay - by) === height - 1) return 'y';
  return undefined;
}

function addEdge(
  edges: MazeGraphEdge[],
  edgeSet: Set<string>,
  width: number,
  height: number,
  a: number,
  b: number,
  tag: MazeEdgeTag,
): boolean {
  const key = edgeKey(a, b);
  if (edgeSet.has(key)) return false;
  edgeSet.add(key);
  const seamAxis = edgeSeamAxis(width, height, a, b);
  edges.push(seamAxis === undefined ? { a, b, tag } : { a, b, tag, seamAxis });
  return true;
}

function computeAdjacency(nodeCount: number, edges: readonly MazeGraphEdge[], skipEdgeIndex = -1): number[][] {
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  for (let i = 0; i < edges.length; i++) {
    if (i === skipEdgeIndex) continue;
    const edge = edges[i];
    adjacency[edge.a].push(edge.b);
    adjacency[edge.b].push(edge.a);
  }
  return adjacency;
}

function computeDepths(nodeCount: number, startId: number, edges: readonly MazeGraphEdge[]): Int32Array {
  const adjacency = computeAdjacency(nodeCount, edges);
  const depth = new Int32Array(nodeCount).fill(-1);
  const queue = new Int32Array(nodeCount);
  let head = 0;
  let tail = 0;
  depth[startId] = 0;
  queue[tail++] = startId;
  while (head < tail) {
    const id = queue[head++];
    for (const next of adjacency[id]) {
      if (depth[next] >= 0) continue;
      depth[next] = depth[id] + 1;
      queue[tail++] = next;
    }
  }
  return depth;
}

function reachableCount(nodeCount: number, startId: number, edges: readonly MazeGraphEdge[], skipEdgeIndex = -1): number {
  const adjacency = computeAdjacency(nodeCount, edges, skipEdgeIndex);
  const seen = new Uint8Array(nodeCount);
  const queue = new Int32Array(nodeCount);
  let head = 0;
  let tail = 0;
  seen[startId] = 1;
  queue[tail++] = startId;
  while (head < tail) {
    const id = queue[head++];
    for (const next of adjacency[id]) {
      if (seen[next]) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  return tail;
}

function startEndReachableWithoutLocks(graph: MazeGraph): boolean {
  const edges = graph.edges.filter(edge => edge.tag !== 'locked_optional');
  const depths = computeDepths(graph.nodes.length, graph.startId, edges);
  return depths[graph.endId] >= 0;
}

function torusManhattan(width: number, height: number, a: MazeGraphNode, b: MazeGraphNode): number {
  const dx = Math.abs(a.gx - b.gx);
  const dy = Math.abs(a.gy - b.gy);
  return Math.min(dx, width - dx) + Math.min(dy, height - dy);
}

function measureLandmarkSpacing(graph: Pick<MazeGraph, 'width' | 'height' | 'nodes' | 'landmarkIds'>): number {
  if (graph.landmarkIds.length < 2) return 0;
  let spacing = Number.POSITIVE_INFINITY;
  for (let i = 0; i < graph.landmarkIds.length; i++) {
    for (let j = i + 1; j < graph.landmarkIds.length; j++) {
      spacing = Math.min(
        spacing,
        torusManhattan(graph.width, graph.height, graph.nodes[graph.landmarkIds[i]], graph.nodes[graph.landmarkIds[j]]),
      );
    }
  }
  return Number.isFinite(spacing) ? spacing : 0;
}

function chooseLandmarks(
  width: number,
  height: number,
  nodes: readonly MazeGraphNode[],
  landmarkCount: number,
): number[] {
  const target = Math.max(0, Math.floor(landmarkCount));
  if (target === 0) return [];
  const scored = nodes
    .filter(node => node.degree > 1)
    .sort((a, b) => b.landmarkScore - a.landmarkScore);
  const out: number[] = [];
  const spacing = Math.max(2, Math.floor(Math.sqrt(nodes.length) / 4));
  for (const candidate of scored) {
    if (out.length >= target) break;
    const tooClose = out.some(id => torusManhattan(width, height, nodes[id], candidate) < spacing);
    if (!tooClose) out.push(candidate.id);
  }
  for (const candidate of scored) {
    if (out.length >= target) break;
    if (!out.includes(candidate.id)) out.push(candidate.id);
  }
  return out;
}

function applyBraidingAndTags(
  context: MazeContext,
  edges: MazeGraphEdge[],
  edgeSet: Set<string>,
  options: MazeBaseOptions,
  rand: RandomSource,
): void {
  const braidChance = clamp01(options.braidChance ?? 0.16);
  const degree = computeDegrees(context.n, edges);

  for (let id = 0; id < context.n; id++) {
    if (degree[id] > 1 || rand() > braidChance) continue;
    const candidates = neighbors(context.width, context.height, id).filter(next => !edgeSet.has(edgeKey(id, next)));
    if (candidates.length === 0) continue;
    const next = candidates[pickIndex(candidates, rand)];
    if (addEdge(edges, edgeSet, context.width, context.height, id, next, 'chord')) {
      degree[id]++;
      degree[next]++;
    }
  }

  const extraChordCount = Math.max(0, Math.floor(options.extraChordCount ?? context.n * braidChance * 0.035));
  for (let i = 0; i < extraChordCount; i++) {
    const id = randomNodeId(context.n, rand);
    const candidates = neighbors(context.width, context.height, id).filter(next => !edgeSet.has(edgeKey(id, next)));
    if (candidates.length === 0) continue;
    const next = candidates[pickIndex(candidates, rand)];
    if (addEdge(edges, edgeSet, context.width, context.height, id, next, 'chord')) {
      degree[id]++;
      degree[next]++;
    }
  }

  const lockedChordChance = clamp01(options.lockedChordChance ?? 0);
  const rewardLeafChance = clamp01(options.rewardLeafChance ?? 0.35);
  for (const edge of edges) {
    if (edge.tag === 'chord' && rand() < lockedChordChance) {
      edge.tag = 'locked_optional';
      continue;
    }
    const leafEdge = degree[edge.a] === 1 || degree[edge.b] === 1;
    const touchesAnchor = edge.a === context.startId
      || edge.b === context.startId
      || edge.a === context.explicitEndId
      || edge.b === context.explicitEndId;
    if (edge.tag === 'backbone' && leafEdge && !touchesAnchor && rand() < rewardLeafChance) {
      edge.tag = 'reward_leaf';
    }
  }
}

function computeDegrees(nodeCount: number, edges: readonly MazeGraphEdge[]): Int16Array {
  const degree = new Int16Array(nodeCount);
  for (const edge of edges) {
    degree[edge.a]++;
    degree[edge.b]++;
  }
  return degree;
}

function finalizeMazeGraph(
  context: MazeContext,
  edges: MazeGraphEdge[],
  options: MazeBaseOptions,
  rand: RandomSource,
): MazeGraph {
  const edgeSet = new Set(edges.map(edge => edgeKey(edge.a, edge.b)));
  applyBraidingAndTags(context, edges, edgeSet, options, rand);

  const degree = computeDegrees(context.n, edges);
  const depths = computeDepths(context.n, context.startId, edges);
  let endId = context.explicitEndId ?? context.startId;
  if (context.explicitEndId === undefined) {
    let maxDepth = 0;
    for (let id = 0; id < context.n; id++) {
      if (depths[id] > maxDepth) {
        maxDepth = depths[id];
        endId = id;
      }
    }
  }

  const cx = (context.width - 1) / 2;
  const cy = (context.height - 1) / 2;
  const maxCenterDist = Math.max(1, cx + cy);
  let maxDepth = 1;
  for (let i = 0; i < depths.length; i++) maxDepth = Math.max(maxDepth, depths[i]);
  const nodes: MazeGraphNode[] = [];
  for (let gy = 0; gy < context.height; gy++) {
    for (let gx = 0; gx < context.width; gx++) {
      const id = nodeId(context.width, gx, gy);
      const centerDist = Math.abs(gx - cx) + Math.abs(gy - cy);
      const depth = Math.max(0, depths[id]);
      const centrality = 1 - centerDist / maxCenterDist;
      const landmarkScore = depth / maxDepth * 100 + centrality * 28 + Math.min(3, degree[id]) * 6;
      nodes.push({
        id,
        gx,
        gy,
        x: Math.round(context.originX + gx * context.cellSize),
        y: Math.round(context.originY + gy * context.cellSize),
        depth,
        centrality,
        degree: degree[id],
        landmarkScore,
      });
    }
  }

  let pathEntropy = 0;
  for (const node of nodes) pathEntropy += Math.log2(Math.max(1, node.degree));
  pathEntropy = Math.round(pathEntropy * 1000 / nodes.length) / 1000;

  const protectedSeams: MazeProtectedSeam[] = [];
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
    const edge = edges[edgeIndex];
    if (edge.seamAxis === undefined) continue;
    protectedSeams.push({ edgeIndex, a: edge.a, b: edge.b, axis: edge.seamAxis });
  }

  const landmarkIds = chooseLandmarks(context.width, context.height, nodes, options.landmarkCount ?? 6);
  const graph: MazeGraph = {
    width: context.width,
    height: context.height,
    nodes,
    edges,
    startId: context.startId,
    endId,
    landmarkIds,
    landmarkSpacing: 0,
    protectedSeams,
    loopCount: Math.max(0, edges.length - nodes.length + 1),
    pathEntropy,
  };
  graph.landmarkSpacing = measureLandmarkSpacing(graph);
  return graph;
}

export function generateGrowingTreeMaze(options: GrowingTreeMazeOptions): MazeGraph {
  const rand = options.rand ?? Math.random;
  const context = normalizeContext(options);
  const weights = normalizeSelectionWeights(options.selectionWeights);
  const visited = new Uint8Array(context.n);
  const active: number[] = [context.startId];
  const edges: MazeGraphEdge[] = [];
  const edgeSet = new Set<string>();
  visited[context.startId] = 1;

  while (active.length > 0) {
    const activeIndex = selectActive(active, rand, weights);
    const id = active[activeIndex];
    const unvisited = neighbors(context.width, context.height, id).filter(next => visited[next] === 0);
    if (unvisited.length === 0) {
      const last = active.pop()!;
      if (activeIndex < active.length) {
        active[activeIndex] = last;
      }
      continue;
    }
    const next = unvisited[pickIndex(unvisited, rand)];
    visited[next] = 1;
    addEdge(edges, edgeSet, context.width, context.height, id, next, 'backbone');
    active.push(next);
  }

  return finalizeMazeGraph(context, edges, options, rand);
}

export function generateWilsonMaze(options: WilsonMazeOptions): MazeGraph {
  const rand = options.rand ?? Math.random;
  const context = normalizeContext(options);
  const visited = new Uint8Array(context.n);
  const edges: MazeGraphEdge[] = [];
  const edgeSet = new Set<string>();
  let remaining = context.n - 1;
  visited[context.startId] = 1;

  while (remaining > 0) {
    let walkStart = randomNodeId(context.n, rand);
    while (visited[walkStart]) walkStart = (walkStart + 1) % context.n;

    const path: number[] = [walkStart];
    const positions = new Map<number, number>([[walkStart, 0]]);
    let current = walkStart;
    while (!visited[current]) {
      const nextOptions = neighbors(context.width, context.height, current);
      const next = nextOptions[pickIndex(nextOptions, rand)];
      const existing = positions.get(next);
      if (existing !== undefined) {
        path.length = existing + 1;
        positions.clear();
        for (let i = 0; i < path.length; i++) positions.set(path[i], i);
      } else {
        path.push(next);
        positions.set(next, path.length - 1);
      }
      current = next;
    }

    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      addEdge(edges, edgeSet, context.width, context.height, a, b, 'backbone');
      if (!visited[a]) {
        visited[a] = 1;
        remaining--;
      }
    }
  }

  return finalizeMazeGraph(context, edges, options, rand);
}

export function validateMazeGraph(graph: MazeGraph): MazeGraphValidation {
  const errors: string[] = [];
  const nodeCount = graph.nodes.length;
  const connected = nodeCount > 0 && reachableCount(nodeCount, graph.startId, graph.edges) === nodeCount;
  if (!connected) errors.push('graph is disconnected');

  const liftBackboneUngated = connected && startEndReachableWithoutLocks(graph);
  if (!liftBackboneUngated) errors.push('start/end backbone is gated by optional locks');

  const degree = computeDegrees(nodeCount, graph.edges);
  let optionalLocksValid = true;
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i];
    if (edge.tag !== 'locked_optional') continue;
    const leafEdge = degree[edge.a] <= 1 || degree[edge.b] <= 1;
    const chordEdge = reachableCount(nodeCount, graph.startId, graph.edges, i) === nodeCount;
    if (!leafEdge && !chordEdge) {
      optionalLocksValid = false;
      errors.push(`optional lock on non-chord non-leaf edge ${edge.a}:${edge.b}`);
    }
  }

  let seamMetadataValid = true;
  const seamKeys = new Set<string>();
  for (const seam of graph.protectedSeams) {
    const edge = graph.edges[seam.edgeIndex];
    const valid = edge !== undefined
      && edge.a === seam.a
      && edge.b === seam.b
      && edge.seamAxis === seam.axis
      && edgeSeamAxis(graph.width, graph.height, edge.a, edge.b) === seam.axis;
    if (!valid) {
      seamMetadataValid = false;
      errors.push(`invalid protected seam metadata at edge ${seam.edgeIndex}`);
    } else {
      seamKeys.add(`${seam.edgeIndex}:${seam.axis}`);
    }
  }
  for (let i = 0; i < graph.edges.length; i++) {
    const axis = graph.edges[i].seamAxis;
    if (axis !== undefined && !seamKeys.has(`${i}:${axis}`)) {
      seamMetadataValid = false;
      errors.push(`missing protected seam metadata at edge ${i}`);
    }
  }

  const landmarkSpacing = measureLandmarkSpacing(graph);
  if (landmarkSpacing !== graph.landmarkSpacing) errors.push('landmark spacing metadata is stale');

  return {
    connected,
    liftBackboneUngated,
    optionalLocksValid,
    seamMetadataValid,
    landmarkSpacing,
    errors,
  };
}
