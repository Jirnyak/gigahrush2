import { Cell, Feature, W, type RoomType, type ZoneFaction } from '../core/types';
import type { World } from '../core/world';
import { territoryOwnerAtIndex } from '../systems/territory';

export interface PlacementFieldAnchor {
  x: number;
  y: number;
  radius: number;
  weight: number;
}

export interface PlacementFieldProfile {
  noiseScale: number;
  noiseStrength: number;
  roomWeights?: Partial<Record<RoomType, number>>;
  zoneWeights?: Partial<Record<ZoneFaction, number>>;
  openWeight?: number;
  smoothingPasses?: number;
  smoothingBlend?: number;
  anchors?: readonly PlacementFieldAnchor[];
  bucketSize?: number;
  maxPerBucket?: number;
  preferredTerritory?: ZoneFaction;
  preferredTerritoryShare?: number;
}

export type NaturalPopulationProfile = PlacementFieldProfile;

export interface PlacementField {
  readonly width: number;
  readonly cellVersion: number;
  readonly seed: number;
  readonly weights: Float32Array;
}

interface PopulationCellCache {
  cellVersion: number;
  cells: Int32Array;
}

interface PopulationStrata {
  cells: Int32Array;
  offsets: Int32Array;
  active: Int32Array;
  offset: number;
  step: number;
  jump: number;
}

const CELL_COUNT = W * W;
const CANDIDATE_TRIES = 6;
const cacheByWorld = new WeakMap<World, PopulationCellCache>();

export function sampleNaturalPopulationCells(
  world: World,
  count: number,
  profile: NaturalPopulationProfile,
  seed: number,
): number[] {
  return samplePlacementFieldCells(world, count, profile, seed);
}

export function samplePlacementFieldCells(
  world: World,
  count: number,
  profile: PlacementFieldProfile,
  seed: number,
): number[] {
  if (count <= 0) return [];
  const cells = populationCellCache(world).cells;
  if (cells.length === 0) return [];

  const field = createPlacementField(world, profile, seed);
  const out: number[] = [];
  const used = new Set<number>();
  const maxPerBucket = profile.maxPerBucket && profile.maxPerBucket > 0 ? Math.floor(profile.maxPerBucket) : 0;
  const bucketSize = Math.max(1, Math.floor(profile.bucketSize ?? 32));
  const bucketSide = Math.ceil(W / bucketSize);
  const bucketCounts = maxPerBucket > 0 ? new Int32Array(bucketSide * bucketSide) : undefined;

  let serial = 0;
  const appendSamples = (candidateCells: Int32Array, wanted: number, salt: number): void => {
    if (wanted <= 0 || candidateCells.length === 0) return;
    const strata = populationStrata(candidateCells, wanted, seed + salt);
    for (let i = 0; i < wanted; i++) {
      const cell = pickContextCell(world, candidateCells, strata, field.weights, seed + salt, serial++, used, bucketCounts, bucketSize, bucketSide, maxPerBucket);
      if (cell >= 0) {
        out.push(cell);
        used.add(cell);
        if (bucketCounts) bucketCounts[bucketIndexForCell(cell, bucketSize, bucketSide)]++;
      }
    }
  };

  const preferredShare = Math.max(0, Math.min(1, profile.preferredTerritoryShare ?? 0));
  if (preferredShare > 0 && profile.preferredTerritory !== undefined && hasCellTerritoryField(world)) {
    const preferred: number[] = [];
    for (const cell of cells) {
      if (territoryOwnerAtIndex(world, cell) === profile.preferredTerritory) preferred.push(cell);
    }
    appendSamples(Int32Array.from(preferred), Math.min(count, Math.floor(count * preferredShare)), 17);
  }

  const remaining = count - out.length;
  const strata = populationStrata(cells, remaining, seed);
  for (let i = 0; i < remaining; i++) {
    const cell = pickContextCell(world, cells, strata, field.weights, seed, serial++, used, bucketCounts, bucketSize, bucketSide, maxPerBucket);
    if (cell >= 0) {
      out.push(cell);
      used.add(cell);
      if (bucketCounts) bucketCounts[bucketIndexForCell(cell, bucketSize, bucketSide)]++;
    }
  }
  return out;
}

export function createPlacementField(world: World, profile: PlacementFieldProfile, seed: number): PlacementField {
  const weights = new Float32Array(CELL_COUNT);
  const useCellTerritory = hasCellTerritoryField(world);
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    if (isPopulationPlacementCandidateCell(world, cell)) weights[cell] = cellPlacementWeight(world, cell, profile, seed, useCellTerritory);
  }
  smoothPlacementField(world, weights, profile.smoothingPasses ?? 2, profile.smoothingBlend ?? 0.55);
  return { width: W, cellVersion: world.cellVersion, seed, weights };
}

export function isPopulationPlacementCandidateCell(world: World, cell: number): boolean {
  return world.cells[cell] === Cell.FLOOR &&
    world.features[cell] === Feature.NONE &&
    !world.containerMap.has(cell);
}

function populationCellCache(world: World): PopulationCellCache {
  const cached = cacheByWorld.get(world);
  if (cached && cached.cellVersion === world.cellVersion) return cached;

  const cells: number[] = [];
  for (let cell = 0; cell < CELL_COUNT; cell++) {
    if (isPopulationPlacementCandidateCell(world, cell)) cells.push(cell);
  }

  const cache: PopulationCellCache = {
    cellVersion: world.cellVersion,
    cells: Int32Array.from(cells),
  };
  cacheByWorld.set(world, cache);
  return cache;
}

function populationStrata(cells: Int32Array, count: number, seed: number): PopulationStrata {
  // Generator-only coverage strata: scatter order, not runtime spawn buckets or density caps.
  const maxCoverageSide = Math.max(1, W >> 5);
  const side = Math.max(1, Math.min(maxCoverageSide, Math.ceil(Math.sqrt(Math.min(count, cells.length)))));
  const strataCount = side * side;
  const counts = new Int32Array(strataCount);
  for (const cell of cells) counts[stratumForCell(cell, side)]++;

  const offsets = new Int32Array(strataCount + 1);
  let activeCount = 0;
  for (let i = 0; i < strataCount; i++) {
    offsets[i + 1] = offsets[i] + counts[i];
    if (counts[i] > 0) activeCount++;
  }

  const ordered = new Int32Array(cells.length);
  const write = offsets.slice(0, strataCount);
  for (const cell of cells) {
    const si = stratumForCell(cell, side);
    ordered[write[si]++] = cell;
  }

  const active = new Int32Array(activeCount);
  let ai = 0;
  for (let i = 0; i < strataCount; i++) {
    if (counts[i] > 0) active[ai++] = i;
  }

  return {
    cells: ordered,
    offsets,
    active,
    offset: Math.floor(hash3(seed, count, 5) * Math.max(1, activeCount)),
    step: coprimeStep(activeCount, seed + 17),
    jump: coprimeStep(activeCount, seed + 101),
  };
}

function stratumForCell(cell: number, side: number): number {
  const x = cell % W;
  const y = (cell / W) | 0;
  const sx = Math.min(side - 1, Math.floor(x * side / W));
  const sy = Math.min(side - 1, Math.floor(y * side / W));
  return sy * side + sx;
}

function pickContextCell(
  world: World,
  cells: Int32Array,
  strata: PopulationStrata,
  weights: Float32Array,
  seed: number,
  serial: number,
  used: Set<number>,
  bucketCounts?: Int32Array,
  bucketSize = 32,
  bucketSide = Math.ceil(W / bucketSize),
  maxPerBucket = 0,
): number {
  let bestCell = -1;
  let bestScore = -Infinity;
  const activeCount = strata.active.length;
  const base = activeCount > 0 ? (strata.offset + serial * strata.step) % activeCount : 0;
  const stratum = activeCount > 0 ? strata.active[base] : -1;
  for (let attempt = 0; attempt < CANDIDATE_TRIES && stratum >= 0; attempt++) {
    const cell = pickStratumCell(strata, stratum, seed, serial, attempt, used);
    if (cell < 0 || used.has(cell) || !isPopulationPlacementCandidateCell(world, cell) || bucketIsFull(cell, bucketCounts, bucketSize, bucketSide, maxPerBucket)) continue;
    const score = weights[cell] * (0.85 + hash3(cell, serial, seed) * 0.3);
    if (score > bestScore) {
      bestScore = score;
      bestCell = cell;
    }
  }

  if (bestCell >= 0) return bestCell;
  for (let attempt = 1; attempt < CANDIDATE_TRIES && activeCount > 0; attempt++) {
    const activeIndex = (base + attempt * strata.jump) % activeCount;
    const cell = pickStratumCell(strata, strata.active[activeIndex], seed, serial, attempt, used);
    if (cell >= 0 && !used.has(cell) && isPopulationPlacementCandidateCell(world, cell) && !bucketIsFull(cell, bucketCounts, bucketSize, bucketSide, maxPerBucket)) return cell;
  }
  const fallbackStart = Math.floor(hash3(seed, serial, 29) * cells.length);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[(fallbackStart + i) % cells.length];
    if (!used.has(cell) && isPopulationPlacementCandidateCell(world, cell) && !bucketIsFull(cell, bucketCounts, bucketSize, bucketSide, maxPerBucket)) return cell;
  }
  return -1;
}

function bucketIndexForCell(cell: number, bucketSize: number, bucketSide: number): number {
  const x = cell % W;
  const y = (cell / W) | 0;
  const bx = Math.min(bucketSide - 1, Math.floor(x / bucketSize));
  const by = Math.min(bucketSide - 1, Math.floor(y / bucketSize));
  return by * bucketSide + bx;
}

function bucketIsFull(
  cell: number,
  bucketCounts: Int32Array | undefined,
  bucketSize: number,
  bucketSide: number,
  maxPerBucket: number,
): boolean {
  if (!bucketCounts || maxPerBucket <= 0) return false;
  return bucketCounts[bucketIndexForCell(cell, bucketSize, bucketSide)] >= maxPerBucket;
}

function pickStratumCell(
  strata: PopulationStrata,
  stratum: number,
  seed: number,
  serial: number,
  attempt: number,
  used: Set<number>,
): number {
  const start = strata.offsets[stratum];
  const end = strata.offsets[stratum + 1];
  const length = end - start;
  const first = Math.floor(hash3(seed + stratum, serial, attempt) * length);
  const probeCount = Math.min(length, 8);
  for (let probe = 0; probe < probeCount; probe++) {
    const cell = strata.cells[start + ((first + probe) % length)];
    if (!used.has(cell)) return cell;
  }
  return -1;
}

function hasCellTerritoryField(world: World): boolean {
  for (let i = 0; i < world.factionControl.length; i += 257) {
    if (world.factionControl[i] !== 0) return true;
  }
  return false;
}

function cellPlacementWeight(world: World, cell: number, profile: PlacementFieldProfile, seed: number, useCellTerritory: boolean): number {
  const x = cell % W;
  const y = (cell / W) | 0;
  let score = profile.openWeight ?? 1;

  const roomId = world.roomMap[cell];
  if (roomId >= 0) {
    const room = world.rooms[roomId];
    if (room) score = profile.roomWeights?.[room.type] ?? 1;
  }

  const zone = world.zones[world.zoneMap[cell]];
  const owner = useCellTerritory ? territoryOwnerAtIndex(world, cell) : zone?.faction;
  if (owner !== undefined) score *= profile.zoneWeights?.[owner] ?? 1;

  const scale = Math.max(24, profile.noiseScale);
  const coarse = valueNoise(x + 0.5, y + 0.5, scale, seed);
  const fine = valueNoise(x + 0.5, y + 0.5, scale * 0.45, seed + 101);
  const n = coarse * 0.7 + fine * 0.3;
  score *= Math.max(0.25, 1 + (n * 2 - 1) * profile.noiseStrength);
  score *= anchorWeight(world, x + 0.5, y + 0.5, profile.anchors);

  return Math.max(0.01, score);
}

function anchorWeight(
  world: World,
  x: number,
  y: number,
  anchors: readonly PlacementFieldAnchor[] | undefined,
): number {
  if (!anchors || anchors.length === 0) return 1;
  let weight = 1;
  for (const anchor of anchors) {
    const radius = Math.max(1, anchor.radius);
    const d2 = world.dist2(x, y, anchor.x, anchor.y);
    if (d2 >= radius * radius) continue;
    const t = 1 - Math.sqrt(d2) / radius;
    const k = smooth(t);
    weight *= 1 + (anchor.weight - 1) * k;
  }
  return Math.max(0.01, weight);
}

function smoothPlacementField(world: World, weights: Float32Array, passes: number, blend: number): void {
  const passCount = Math.max(0, Math.floor(passes));
  if (passCount === 0 || blend <= 0) return;
  const mix = Math.min(1, blend);
  const keep = 1 - mix;
  const scratch = new Float32Array(CELL_COUNT);
  for (let pass = 0; pass < passCount; pass++) {
    for (let y = 0; y < W; y++) {
      const row = y * W;
      const up = ((y - 1 + W) & (W - 1)) * W;
      const down = ((y + 1) & (W - 1)) * W;
      for (let x = 0; x < W; x++) {
        const idx = row + x;
        if (!isPopulationPlacementCandidateCell(world, idx)) {
          scratch[idx] = 0;
          continue;
        }
        const leftX = (x - 1 + W) & (W - 1);
        const rightX = (x + 1) & (W - 1);
        let sum = weights[idx] * 4;
        let total = 4;
        const left = row + leftX;
        const right = row + rightX;
        const upIdx = up + x;
        const downIdx = down + x;
        if (isPopulationPlacementCandidateCell(world, left)) { sum += weights[left]; total++; }
        if (isPopulationPlacementCandidateCell(world, right)) { sum += weights[right]; total++; }
        if (isPopulationPlacementCandidateCell(world, upIdx)) { sum += weights[upIdx]; total++; }
        if (isPopulationPlacementCandidateCell(world, downIdx)) { sum += weights[downIdx]; total++; }
        scratch[idx] = weights[idx] * keep + (sum / total) * mix;
      }
    }
    weights.set(scratch);
  }
}

function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const period = Math.max(1, Math.round(W / scale));
  const actualScale = W / period;
  const gx = Math.floor(x / actualScale);
  const gy = Math.floor(y / actualScale);
  const fx = x / actualScale - gx;
  const fy = y / actualScale - gy;
  const x0 = wrapGrid(gx, period);
  const y0 = wrapGrid(gy, period);
  const x1 = wrapGrid(gx + 1, period);
  const y1 = wrapGrid(gy + 1, period);
  const sx = smooth(fx);
  const sy = smooth(fy);
  const a = lerp(hash3(x0, y0, seed), hash3(x1, y0, seed), sx);
  const b = lerp(hash3(x0, y1, seed), hash3(x1, y1, seed), sx);
  return lerp(a, b, sy);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrapGrid(v: number, period: number): number {
  return ((v % period) + period) % period;
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
