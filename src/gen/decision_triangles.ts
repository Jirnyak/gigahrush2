import { Cell, W, type RoomType, type ZoneFaction } from '../core/types';
import type { World } from '../core/world';

export type DecisionTriangleRole = 'risk' | 'reward' | 'escape';

export type DecisionPointInput = number | { x: number; y: number };

export interface DecisionDistanceBand {
  min: number;
  max: number;
  ideal?: number;
  score?: number;
  outsidePenalty?: number;
}

export interface DecisionVisibilityCue {
  at: DecisionPointInput;
  radius: number;
  weight?: number;
  roles?: readonly DecisionTriangleRole[];
}

export interface DecisionSpawnAvoidance {
  at: DecisionPointInput;
  radius: number;
  penalty?: number;
}

export interface DecisionTriangleRoleProfile {
  baseScore?: number;
  roomWeights?: Partial<Record<RoomType, number>>;
  zoneWeights?: Partial<Record<ZoneFaction, number>>;
  distanceBand?: DecisionDistanceBand;
  visibilityWeight?: number;
  exitTargetBand?: DecisionDistanceBand;
  exitWeight?: number;
}

export type DecisionCellMask = Uint8Array | Set<number> | ((cell: number) => boolean);

export interface DecisionTriangleOptions {
  candidates: readonly number[];
  poi: DecisionPointInput;
  seed?: number;
  sampleCount?: number;
  sampleBucketSize?: number;
  maxSamplesPerBucket?: number;
  minSeparation?: number;
  spacingWeight?: number;
  protectedMask?: DecisionCellMask;
  escapeReachable?: DecisionCellMask;
  visibilityCues?: readonly DecisionVisibilityCue[];
  exitTargets?: readonly number[];
  spawn?: DecisionSpawnAvoidance;
  roles?: Partial<Record<DecisionTriangleRole, DecisionTriangleRoleProfile>>;
}

export interface DecisionTrianglePoint {
  role: DecisionTriangleRole;
  cell: number;
  x: number;
  y: number;
  score: number;
}

export interface DecisionTrianglePlacement {
  risk: DecisionTrianglePoint;
  reward: DecisionTrianglePoint;
  escape: DecisionTrianglePoint;
  points: readonly DecisionTrianglePoint[];
  sampled: number;
  bucketSize: number;
  seed: number;
}

interface ScoredDecisionCell {
  cell: number;
  score: number;
  bucketLoad: number;
}

const ROLES: readonly DecisionTriangleRole[] = ['risk', 'reward', 'escape'];
const MIN_SAMPLE_COUNT = 100;
const MAX_SAMPLE_COUNT = 300;
const DEFAULT_SAMPLE_COUNT = 192;
const DEFAULT_BUCKET_SIZE = 32;
const DEFAULT_MAX_SAMPLES_PER_BUCKET = 12;
const DEFAULT_MIN_SEPARATION = 8;

const DEFAULT_DISTANCE_BANDS: Record<DecisionTriangleRole, DecisionDistanceBand> = {
  risk: { min: 7, max: 28, ideal: 15, score: 4, outsidePenalty: 5 },
  reward: { min: 3, max: 22, ideal: 9, score: 4, outsidePenalty: 4 },
  escape: { min: 12, max: 44, ideal: 26, score: 4, outsidePenalty: 4 },
};

const DEFAULT_EXIT_BAND: DecisionDistanceBand = {
  min: 1,
  max: 48,
  ideal: 8,
  score: 5,
  outsidePenalty: 8,
};

export function placeDecisionTriangle(world: World, options: DecisionTriangleOptions): DecisionTrianglePlacement | null {
  const seed = options.seed ?? 0;
  const bucketSize = Math.max(1, Math.floor(options.sampleBucketSize ?? DEFAULT_BUCKET_SIZE));
  const sampled = sampleDecisionCandidates(world, options, seed, bucketSize);
  if (sampled.cells.length < ROLES.length) return null;

  const poi = normalizeDecisionPoint(world, options.poi);
  const scored: Record<DecisionTriangleRole, ScoredDecisionCell[]> = {
    risk: [],
    reward: [],
    escape: [],
  };

  for (const cell of sampled.cells) {
    for (const role of ROLES) {
      if (role === 'escape' && !isEscapeCandidate(world, cell, options)) continue;
      const score = scoreDecisionCandidate(world, cell, role, poi, options, sampled.bucketLoads, bucketSize);
      if (Number.isFinite(score)) scored[role].push({ cell, score, bucketLoad: sampled.bucketLoads[bucketIndexForCell(cell, bucketSize)] ?? 0 });
    }
  }

  const selected: DecisionTrianglePoint[] = [];
  const minSeparation = Math.max(1, options.minSeparation ?? DEFAULT_MIN_SEPARATION);
  const spacingWeight = Math.max(0, options.spacingWeight ?? 1.5);
  for (const role of ROLES) {
    scored[role].sort((a, b) => b.score - a.score);
    const point = selectDecisionPoint(world, role, scored[role], selected, minSeparation, spacingWeight);
    if (!point) return null;
    selected.push(point);
  }

  const [risk, reward, escape] = selected as [DecisionTrianglePoint, DecisionTrianglePoint, DecisionTrianglePoint];
  if (risk.cell === reward.cell || risk.cell === escape.cell || reward.cell === escape.cell) return null;
  if (!isEscapeCandidate(world, escape.cell, options)) return null;

  return {
    risk,
    reward,
    escape,
    points: selected,
    sampled: sampled.cells.length,
    bucketSize,
    seed,
  };
}

export function isDecisionTriangleCandidateCell(world: World, cell: number, protectedMask?: DecisionCellMask): boolean {
  if (cell < 0 || cell >= W * W) return false;
  if (world.aptMask[cell]) return false;
  if (maskHas(protectedMask, cell)) return false;
  const cellType = world.cells[cell];
  return cellType === Cell.FLOOR || cellType === Cell.WATER || cellType === Cell.DOOR;
}

function sampleDecisionCandidates(
  world: World,
  options: DecisionTriangleOptions,
  seed: number,
  bucketSize: number,
): { cells: number[]; bucketLoads: Int16Array } {
  const sampleTarget = sampleTargetCount(options.sampleCount, options.candidates.length);
  const bucketSide = Math.ceil(W / bucketSize);
  const bucketLoads = new Int16Array(bucketSide * bucketSide);
  const maxPerBucket = Math.max(1, Math.floor(options.maxSamplesPerBucket ?? DEFAULT_MAX_SAMPLES_PER_BUCKET));
  const cells: number[] = [];
  const used = new Set<number>();
  const total = options.candidates.length;
  if (total === 0 || sampleTarget === 0) return { cells, bucketLoads };

  const start = Math.floor(hash3(seed, total, 11) * total);
  const step = coprimeStep(total, seed + 17);
  for (let probe = 0; probe < total && cells.length < sampleTarget; probe++) {
    const candidate = options.candidates[(start + probe * step) % total];
    if (used.has(candidate)) continue;
    if (!isDecisionTriangleCandidateCell(world, candidate, options.protectedMask)) continue;
    const bucket = bucketIndexForCell(candidate, bucketSize);
    if (bucketLoads[bucket] >= maxPerBucket) continue;
    cells.push(candidate);
    used.add(candidate);
    bucketLoads[bucket]++;
  }

  return { cells, bucketLoads };
}

function sampleTargetCount(requested: number | undefined, total: number): number {
  if (total <= 0) return 0;
  if (total <= MIN_SAMPLE_COUNT) return total;
  const count = Math.floor(requested ?? DEFAULT_SAMPLE_COUNT);
  return Math.min(total, Math.max(MIN_SAMPLE_COUNT, Math.min(MAX_SAMPLE_COUNT, count)));
}

function scoreDecisionCandidate(
  world: World,
  cell: number,
  role: DecisionTriangleRole,
  poi: { x: number; y: number },
  options: DecisionTriangleOptions,
  bucketLoads: Int16Array,
  bucketSize: number,
): number {
  if (!isDecisionTriangleCandidateCell(world, cell, options.protectedMask)) return -Infinity;
  const profile = options.roles?.[role];
  const x = (cell % W) + 0.5;
  const y = ((cell / W) | 0) + 0.5;

  let score = profile?.baseScore ?? 0;
  score += roomMatchScore(world, cell, profile);
  score += zoneMatchScore(world, cell, profile);
  score += distanceBandScore(world.dist(x, y, poi.x, poi.y), profile?.distanceBand ?? DEFAULT_DISTANCE_BANDS[role]);
  score += visibilityCueScore(world, x, y, role, profile, options.visibilityCues);
  if (role === 'escape') score += exitTargetScore(world, x, y, profile, options.exitTargets);
  score -= spawnCampingPenalty(world, x, y, options.spawn);
  score -= Math.max(0, bucketLoads[bucketIndexForCell(cell, bucketSize)] - 3) * 0.05;
  return score;
}

function roomMatchScore(world: World, cell: number, profile: DecisionTriangleRoleProfile | undefined): number {
  const roomId = world.roomMap[cell];
  if (roomId < 0) return 0;
  const room = world.rooms[roomId];
  return room ? profile?.roomWeights?.[room.type] ?? 0 : 0;
}

function zoneMatchScore(world: World, cell: number, profile: DecisionTriangleRoleProfile | undefined): number {
  const zone = world.zones[world.zoneMap[cell]];
  return zone ? profile?.zoneWeights?.[zone.faction] ?? 0 : 0;
}

function distanceBandScore(distance: number, band: DecisionDistanceBand): number {
  const min = Math.max(0, band.min);
  const max = Math.max(min + 0.001, band.max);
  const ideal = Math.max(min, Math.min(max, band.ideal ?? (min + max) * 0.5));
  const peak = band.score ?? 1;
  if (distance < min) return -((band.outsidePenalty ?? peak) * (min - distance) / Math.max(1, min));
  if (distance > max) return -((band.outsidePenalty ?? peak) * Math.min(2, (distance - max) / Math.max(1, max - min)));
  const span = distance <= ideal ? Math.max(1, ideal - min) : Math.max(1, max - ideal);
  return peak * (1 - Math.abs(distance - ideal) / span);
}

function visibilityCueScore(
  world: World,
  x: number,
  y: number,
  role: DecisionTriangleRole,
  profile: DecisionTriangleRoleProfile | undefined,
  cues: readonly DecisionVisibilityCue[] | undefined,
): number {
  if (!cues || cues.length === 0) return 0;
  let score = 0;
  for (const cue of cues) {
    if (cue.roles && !cue.roles.includes(role)) continue;
    const at = normalizeDecisionPoint(world, cue.at);
    const radius = Math.max(1, cue.radius);
    const d2 = world.dist2(x, y, at.x, at.y);
    if (d2 >= radius * radius) continue;
    const t = 1 - Math.sqrt(d2) / radius;
    score += (cue.weight ?? 1) * (profile?.visibilityWeight ?? 1) * smooth(t);
  }
  return score;
}

function exitTargetScore(
  world: World,
  x: number,
  y: number,
  profile: DecisionTriangleRoleProfile | undefined,
  targets: readonly number[] | undefined,
): number {
  if (!targets || targets.length === 0) return 0;
  const band = profile?.exitTargetBand ?? DEFAULT_EXIT_BAND;
  let best = Infinity;
  for (const cell of targets) {
    const tx = (cell % W) + 0.5;
    const ty = ((cell / W) | 0) + 0.5;
    const d = world.dist(x, y, tx, ty);
    if (d < best) best = d;
  }
  return distanceBandScore(best, band) * (profile?.exitWeight ?? 1);
}

function spawnCampingPenalty(world: World, x: number, y: number, spawn: DecisionSpawnAvoidance | undefined): number {
  if (!spawn) return 0;
  const at = normalizeDecisionPoint(world, spawn.at);
  const radius = Math.max(1, spawn.radius);
  const d2 = world.dist2(x, y, at.x, at.y);
  if (d2 >= radius * radius) return 0;
  const t = 1 - Math.sqrt(d2) / radius;
  return (spawn.penalty ?? 8) * smooth(t);
}

function isEscapeCandidate(world: World, cell: number, options: DecisionTriangleOptions): boolean {
  if (!isDecisionTriangleCandidateCell(world, cell, options.protectedMask)) return false;
  if (options.escapeReachable && !maskHas(options.escapeReachable, cell)) return false;
  const targets = options.exitTargets;
  if (!targets || targets.length === 0) return true;
  const profile = options.roles?.escape;
  const band = profile?.exitTargetBand ?? DEFAULT_EXIT_BAND;
  const x = (cell % W) + 0.5;
  const y = ((cell / W) | 0) + 0.5;
  const max2 = band.max * band.max;
  for (const target of targets) {
    const tx = (target % W) + 0.5;
    const ty = ((target / W) | 0) + 0.5;
    if (world.dist2(x, y, tx, ty) <= max2) return true;
  }
  return false;
}

function selectDecisionPoint(
  world: World,
  role: DecisionTriangleRole,
  candidates: readonly ScoredDecisionCell[],
  selected: readonly DecisionTrianglePoint[],
  minSeparation: number,
  spacingWeight: number,
): DecisionTrianglePoint | null {
  let best: DecisionTrianglePoint | null = null;
  let bestScore = -Infinity;
  const minSeparation2 = minSeparation * minSeparation;
  for (let pass = 0; pass < 2; pass++) {
    for (const candidate of candidates) {
      if (selected.some(point => point.cell === candidate.cell)) continue;
      const spacing = spacingScore(world, candidate.cell, selected, minSeparation, spacingWeight);
      if (pass === 0 && selected.length > 0 && nearestSelectedDist2(world, candidate.cell, selected) < minSeparation2) continue;
      const score = candidate.score + spacing - Math.max(0, candidate.bucketLoad - 4) * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = {
          role,
          cell: candidate.cell,
          x: (candidate.cell % W) + 0.5,
          y: ((candidate.cell / W) | 0) + 0.5,
          score,
        };
      }
    }
    if (best) return best;
  }
  return null;
}

function spacingScore(
  world: World,
  cell: number,
  selected: readonly DecisionTrianglePoint[],
  minSeparation: number,
  spacingWeight: number,
): number {
  if (selected.length === 0 || spacingWeight === 0) return 0;
  const dist = Math.sqrt(nearestSelectedDist2(world, cell, selected));
  if (dist <= 0) return -1_000_000;
  if (dist < minSeparation) return -spacingWeight * (minSeparation - dist) * 2;
  return spacingWeight * Math.min(4, dist / minSeparation);
}

function nearestSelectedDist2(world: World, cell: number, selected: readonly DecisionTrianglePoint[]): number {
  if (selected.length === 0) return Infinity;
  const x = (cell % W) + 0.5;
  const y = ((cell / W) | 0) + 0.5;
  let best = Infinity;
  for (const point of selected) {
    const d2 = world.dist2(x, y, point.x, point.y);
    if (d2 < best) best = d2;
  }
  return best;
}

function normalizeDecisionPoint(world: World, point: DecisionPointInput): { x: number; y: number } {
  if (typeof point === 'number') {
    return {
      x: (point % W) + 0.5,
      y: ((point / W) | 0) + 0.5,
    };
  }
  return {
    x: world.wrap(Math.floor(point.x)) + 0.5,
    y: world.wrap(Math.floor(point.y)) + 0.5,
  };
}

function maskHas(mask: DecisionCellMask | undefined, cell: number): boolean {
  if (!mask) return false;
  if (mask instanceof Uint8Array) return mask[cell] !== 0;
  if (mask instanceof Set) return mask.has(cell);
  return mask(cell);
}

function bucketIndexForCell(cell: number, bucketSize: number): number {
  const side = Math.ceil(W / bucketSize);
  const x = cell % W;
  const y = (cell / W) | 0;
  const bx = Math.min(side - 1, Math.floor(x / bucketSize));
  const by = Math.min(side - 1, Math.floor(y / bucketSize));
  return by * side + bx;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function coprimeStep(count: number, seed: number): number {
  if (count <= 1) return 1;
  let step = 1 + Math.floor(hash3(seed, count, 71) * (count - 1));
  while (gcd(step, count) !== 1) step = step % (count - 1) + 1;
  return step;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

function hash3(a: number, b: number, c: number): number {
  let n = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 0xffffffff;
}
