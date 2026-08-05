import { Cell, Feature, W } from '../core/types';
import type { World } from '../core/world';

export type ProxyGridSize = 16 | 32 | 64 | 128 | 256;

export interface ProxyGrid {
  readonly size: ProxyGridSize;
  readonly cellSize: number;
  readonly seed: number;
  readonly values: Float32Array;
}

export interface ProxyCoord {
  x: number;
  y: number;
  index: number;
}

export interface WorldProxyCoord extends ProxyCoord {
  worldX: number;
  worldY: number;
  localX: number;
  localY: number;
}

export interface ProxyWorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ProxySampleOptions {
  salt?: number;
  minValue?: number;
  protectedProxyMask?: Uint8Array;
  allowed?: (index: number, x: number, y: number, value: number) => boolean;
}

export interface ProxyRasterPatch {
  cell?: Cell;
  roomId?: number;
  wallTex?: number;
  floorTex?: number;
  feature?: number;
  fog?: number;
  zoneId?: number;
  factionControl?: number;
}

export interface ProxyRasterOptions {
  protectedProxyMask?: Uint8Array;
  protectedWorldMask?: Uint8Array;
  markDirty?: boolean;
}

export interface ProxyRasterResult {
  stampedProxyCells: number;
  skippedProxyCells: number;
  stampedWorldCells: number;
  skippedWorldCells: number;
  changedWorldCells: number;
}

export interface ProxyDescriptorOptions {
  cells?: readonly number[];
  protectedProxyMask?: Uint8Array;
  protectedWorldMask?: Uint8Array;
}

export interface ProxyCellDescriptor extends ProxyCoord, ProxyWorldRect {
  floorCells: number;
  wallCells: number;
  doorCells: number;
  waterCells: number;
  liftCells: number;
  abyssCells: number;
  protectedCells: number;
  protectedProxy: boolean;
  dominantCell: Cell;
  dominantRoomId: number;
  dominantWallTex: number;
  dominantFloorTex: number;
  dominantFeature: number;
  averageFog: number;
  passableRatio: number;
  protectedRatio: number;
}

interface RasterDirtyFlags {
  cells: boolean;
  wallTex: boolean;
  floorTex: boolean;
  feature: boolean;
  featureLights: boolean;
  fog: boolean;
}

const SUPPORTED_PROXY_SIZES = new Set<number>([16, 32, 64, 128, 256]);

export function createProxyGrid(size: ProxyGridSize, seed = 1, values?: ArrayLike<number>): ProxyGrid {
  assertProxyGridSize(size);
  const count = size * size;
  const gridValues = new Float32Array(count);
  if (values !== undefined) {
    if (values.length !== count) throw new Error(`proxy grid values length ${values.length} does not match ${count}`);
    for (let i = 0; i < count; i++) gridValues[i] = values[i];
  }
  return {
    size,
    cellSize: W / size,
    seed: seed >>> 0,
    values: gridValues,
  };
}

export function createProxyMask(grid: ProxyGrid, fill = 0): Uint8Array {
  return new Uint8Array(grid.size * grid.size).fill(fill ? 1 : 0);
}

export function wrapProxyCoord(grid: ProxyGrid, value: number): number {
  const v = Math.floor(value);
  return ((v % grid.size) + grid.size) % grid.size;
}

export function proxyIndex(grid: ProxyGrid, x: number, y: number): number {
  return wrapProxyCoord(grid, y) * grid.size + wrapProxyCoord(grid, x);
}

export function proxyCoord(grid: ProxyGrid, index: number): ProxyCoord {
  const i = wrapProxyIndex(grid, index);
  return { x: i % grid.size, y: (i / grid.size) | 0, index: i };
}

export function proxyToWorldRect(grid: ProxyGrid, x: number, y: number): ProxyWorldRect {
  const px = wrapProxyCoord(grid, x);
  const py = wrapProxyCoord(grid, y);
  return {
    x: px * grid.cellSize,
    y: py * grid.cellSize,
    w: grid.cellSize,
    h: grid.cellSize,
  };
}

export function proxyCellCenter(grid: ProxyGrid, x: number, y: number): { x: number; y: number } {
  const rect = proxyToWorldRect(grid, x, y);
  return { x: rect.x + rect.w * 0.5, y: rect.y + rect.h * 0.5 };
}

export function worldToProxy(grid: ProxyGrid, worldX: number, worldY: number): WorldProxyCoord {
  const wx = wrapWorldCoord(worldX);
  const wy = wrapWorldCoord(worldY);
  const x = Math.floor(wx / grid.cellSize);
  const y = Math.floor(wy / grid.cellSize);
  return {
    x,
    y,
    index: y * grid.size + x,
    worldX: wx,
    worldY: wy,
    localX: wx - x * grid.cellSize,
    localY: wy - y * grid.cellSize,
  };
}

export function proxySample01(grid: ProxyGrid, x: number, y: number, salt = 0): number {
  return hashU32(wrapProxyCoord(grid, x), wrapProxyCoord(grid, y), grid.seed, salt | 0) / 4294967296;
}

export function fillProxyGridDeterministic(grid: ProxyGrid, salt = 0): ProxyGrid {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      grid.values[y * grid.size + x] = proxySample01(grid, x, y, salt);
    }
  }
  return grid;
}

export function sampleProxyCells(grid: ProxyGrid, count: number, options: ProxySampleOptions = {}): number[] {
  const target = Math.max(0, Math.floor(count));
  if (target === 0) return [];
  const total = grid.size * grid.size;
  assertProxyMaskLength(grid, options.protectedProxyMask);

  const out: number[] = [];
  const salt = options.salt ?? 0;
  const start = Math.floor((hashU32(grid.seed, salt | 0, target, 0x51f15e) / 4294967296) * total);
  const step = coprimeStep(total, hashU32(grid.seed, salt | 0, target, 0xa11ce));
  for (let probe = 0; probe < total && out.length < target; probe++) {
    const index = (start + probe * step) % total;
    if (proxySampleAllowed(grid, index, options)) out.push(index);
  }
  return out;
}

export function stampProxyCell(
  world: World,
  grid: ProxyGrid,
  x: number,
  y: number,
  patch: ProxyRasterPatch,
  options: ProxyRasterOptions = {},
): ProxyRasterResult {
  return stampProxyCells(world, grid, [proxyIndex(grid, x, y)], patch, options);
}

export function stampProxyRect(
  world: World,
  grid: ProxyGrid,
  x: number,
  y: number,
  w: number,
  h: number,
  patch: ProxyRasterPatch,
  options: ProxyRasterOptions = {},
): ProxyRasterResult {
  const width = Math.max(0, Math.min(grid.size, Math.floor(w)));
  const height = Math.max(0, Math.min(grid.size, Math.floor(h)));
  if (width === 0 || height === 0) return emptyRasterResult();

  const cells: number[] = [];
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      cells.push(proxyIndex(grid, x + dx, y + dy));
    }
  }
  return stampProxyCells(world, grid, cells, patch, options);
}

export function stampProxyCells(
  world: World,
  grid: ProxyGrid,
  cells: readonly number[],
  patch: ProxyRasterPatch,
  options: ProxyRasterOptions = {},
): ProxyRasterResult {
  assertProxyMaskLength(grid, options.protectedProxyMask);
  assertWorldMaskLength(options.protectedWorldMask);

  const result = emptyRasterResult();
  const dirty: RasterDirtyFlags = { cells: false, wallTex: false, floorTex: false, feature: false, featureLights: false, fog: false };
  const seen = new Set<number>();

  for (const rawIndex of cells) {
    const index = wrapProxyIndex(grid, rawIndex);
    if (seen.has(index)) continue;
    seen.add(index);

    if (options.protectedProxyMask?.[index]) {
      result.skippedProxyCells++;
      continue;
    }

    result.stampedProxyCells++;
    const { x, y } = proxyCoord(grid, index);
    const rect = proxyToWorldRect(grid, x, y);
    stampWorldRect(world, rect, patch, options, result, dirty);
  }

  if (options.markDirty !== false) markDirty(world, dirty);
  return result;
}

export function extractProxyDescriptors(
  world: World,
  grid: ProxyGrid,
  options: ProxyDescriptorOptions = {},
): ProxyCellDescriptor[] {
  assertProxyMaskLength(grid, options.protectedProxyMask);
  assertWorldMaskLength(options.protectedWorldMask);

  const total = grid.size * grid.size;
  const descriptors: ProxyCellDescriptor[] = [];
  const cells = options.cells ?? range(total);
  for (const rawIndex of cells) {
    const coord = proxyCoord(grid, rawIndex);
    const rect = proxyToWorldRect(grid, coord.x, coord.y);
    descriptors.push(extractProxyDescriptor(world, coord, rect, options));
  }
  return descriptors;
}

function extractProxyDescriptor(
  world: World,
  coord: ProxyCoord,
  rect: ProxyWorldRect,
  options: ProxyDescriptorOptions,
): ProxyCellDescriptor {
  const cellCounts = new Int32Array(6);
  const wallTexCounts = new Int32Array(256);
  const floorTexCounts = new Int32Array(256);
  const featureCounts = new Int32Array(256);
  const roomCounts = new Map<number, number>();
  const area = rect.w * rect.h;
  let protectedCells = 0;
  let fogSum = 0;

  for (let dy = 0; dy < rect.h; dy++) {
    const wy = rect.y + dy;
    for (let dx = 0; dx < rect.w; dx++) {
      const wx = rect.x + dx;
      const wi = world.idx(wx, wy);
      const cell = world.cells[wi];
      if (cell < cellCounts.length) cellCounts[cell]++;
      wallTexCounts[world.wallTex[wi]]++;
      floorTexCounts[world.floorTex[wi]]++;
      featureCounts[world.features[wi]]++;
      fogSum += world.fog[wi];
      const roomId = world.roomMap[wi];
      roomCounts.set(roomId, (roomCounts.get(roomId) ?? 0) + 1);
      if (options.protectedWorldMask?.[wi]) protectedCells++;
    }
  }

  const protectedProxy = !!options.protectedProxyMask?.[coord.index];
  if (protectedProxy) protectedCells = area;

  const floorCells = cellCounts[Cell.FLOOR];
  const doorCells = cellCounts[Cell.DOOR];
  const waterCells = cellCounts[Cell.WATER];
  return {
    ...coord,
    ...rect,
    floorCells,
    wallCells: cellCounts[Cell.WALL],
    doorCells,
    waterCells,
    liftCells: cellCounts[Cell.LIFT],
    abyssCells: cellCounts[Cell.ABYSS],
    protectedCells,
    protectedProxy,
    dominantCell: modeIndex(cellCounts) as Cell,
    dominantRoomId: modeMap(roomCounts),
    dominantWallTex: modeIndex(wallTexCounts),
    dominantFloorTex: modeIndex(floorTexCounts),
    dominantFeature: modeIndex(featureCounts),
    averageFog: fogSum / area,
    passableRatio: (floorCells + doorCells + waterCells) / area,
    protectedRatio: protectedCells / area,
  };
}

function stampWorldRect(
  world: World,
  rect: ProxyWorldRect,
  patch: ProxyRasterPatch,
  options: ProxyRasterOptions,
  result: ProxyRasterResult,
  dirty: RasterDirtyFlags,
): void {
  for (let dy = 0; dy < rect.h; dy++) {
    const wy = rect.y + dy;
    for (let dx = 0; dx < rect.w; dx++) {
      const wx = rect.x + dx;
      const wi = world.idx(wx, wy);
      if (options.protectedWorldMask?.[wi]) {
        result.skippedWorldCells++;
        continue;
      }

      result.stampedWorldCells++;
      if (applyRasterPatch(world, wi, patch, dirty)) result.changedWorldCells++;
    }
  }
}

function applyRasterPatch(world: World, index: number, patch: ProxyRasterPatch, dirty: RasterDirtyFlags): boolean {
  let changed = false;
  if (patch.cell !== undefined && world.cells[index] !== patch.cell) {
    world.cells[index] = patch.cell;
    dirty.cells = true;
    changed = true;
  }
  if (patch.roomId !== undefined && world.roomMap[index] !== patch.roomId) {
    world.roomMap[index] = patch.roomId;
    changed = true;
  }
  if (patch.wallTex !== undefined && world.wallTex[index] !== patch.wallTex) {
    world.wallTex[index] = patch.wallTex;
    dirty.wallTex = true;
    changed = true;
  }
  if (patch.floorTex !== undefined && world.floorTex[index] !== patch.floorTex) {
    world.floorTex[index] = patch.floorTex;
    dirty.floorTex = true;
    changed = true;
  }
  if (patch.feature !== undefined) {
    const oldFeature = world.features[index];
    const nextFeature = clampByte(patch.feature);
    if (setFeatureRaw(world, index, nextFeature)) {
      dirty.feature = true;
      if (isLightFeature(oldFeature) || isLightFeature(nextFeature)) dirty.featureLights = true;
      changed = true;
    }
  }
  if (patch.fog !== undefined) {
    const fog = clampByte(patch.fog);
    if (world.fog[index] !== fog) {
      world.fog[index] = fog;
      dirty.fog = true;
      changed = true;
    }
  }
  if (patch.zoneId !== undefined) {
    const zoneId = clampByte(patch.zoneId);
    if (world.zoneMap[index] !== zoneId) {
      world.zoneMap[index] = zoneId;
      changed = true;
    }
  }
  if (patch.factionControl !== undefined) {
    const faction = clampByte(patch.factionControl);
    if (world.factionControl[index] !== faction) {
      world.factionControl[index] = faction;
      changed = true;
    }
  }
  return changed;
}

function setFeatureRaw(world: World, index: number, feature: number): boolean {
  const old = world.features[index];
  const next = feature;
  if (old === next) return false;
  world.features[index] = next;
  if (old === Feature.SCREEN && next !== Feature.SCREEN) world.screenCells = world.screenCells.filter(i => i !== index);
  if (next === Feature.SCREEN && !world.screenCells.includes(index)) world.screenCells.push(index);
  if (old === Feature.SLIDE && next !== Feature.SLIDE) world.slideCells = world.slideCells.filter(i => i !== index);
  if (next === Feature.SLIDE && !world.slideCells.includes(index)) world.slideCells.push(index);
  return true;
}

function isLightFeature(feature: number): boolean {
  return feature === Feature.LAMP || feature === Feature.CANDLE;
}

function proxySampleAllowed(grid: ProxyGrid, index: number, options: ProxySampleOptions): boolean {
  if (options.protectedProxyMask?.[index]) return false;
  const value = grid.values[index];
  if (options.minValue !== undefined && value < options.minValue) return false;
  if (!options.allowed) return true;
  const { x, y } = proxyCoord(grid, index);
  return options.allowed(index, x, y, value);
}

function assertProxyGridSize(size: number): asserts size is ProxyGridSize {
  if (!SUPPORTED_PROXY_SIZES.has(size)) throw new Error(`unsupported proxy grid size ${size}`);
  if (W % size !== 0) throw new Error(`proxy grid size ${size} must divide world size ${W}`);
}

function assertProxyMaskLength(grid: ProxyGrid, mask: Uint8Array | undefined): void {
  if (mask !== undefined && mask.length !== grid.size * grid.size) {
    throw new Error(`proxy mask length ${mask.length} does not match ${grid.size * grid.size}`);
  }
}

function assertWorldMaskLength(mask: Uint8Array | undefined): void {
  if (mask !== undefined && mask.length !== W * W) throw new Error(`world mask length ${mask.length} does not match ${W * W}`);
}

function wrapProxyIndex(grid: ProxyGrid, index: number): number {
  const total = grid.size * grid.size;
  const i = Math.floor(index);
  return ((i % total) + total) % total;
}

function wrapWorldCoord(value: number): number {
  const v = Math.floor(value);
  return ((v % W) + W) % W;
}

function clampByte(value: number): number {
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return value | 0;
}

function emptyRasterResult(): ProxyRasterResult {
  return {
    stampedProxyCells: 0,
    skippedProxyCells: 0,
    stampedWorldCells: 0,
    skippedWorldCells: 0,
    changedWorldCells: 0,
  };
}

function markDirty(world: World, dirty: RasterDirtyFlags): void {
  if (dirty.cells) world.markCellsDirty();
  if (dirty.wallTex) world.markWallTexDirty();
  if (dirty.floorTex) world.markFloorTexDirty();
  if (dirty.feature) world.markFeaturesDirty(dirty.featureLights);
  if (dirty.fog) world.markFogDirty();
}

function range(count: number): number[] {
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = i;
  return out;
}

function modeIndex(counts: Int32Array): number {
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > bestCount) {
      best = i;
      bestCount = counts[i];
    }
  }
  return best;
}

function modeMap(counts: Map<number, number>): number {
  let best = -1;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function coprimeStep(count: number, seed: number): number {
  if (count <= 1) return 1;
  let step = 1 + (seed % (count - 1));
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

function hashU32(a: number, b: number, c: number, d: number): number {
  let n = Math.imul(a | 0, 374761393) ^
    Math.imul(b | 0, 668265263) ^
    Math.imul(c | 0, 1274126177) ^
    Math.imul(d | 0, 2246822519);
  n = Math.imul(n ^ (n >>> 15), 2246822519);
  n = Math.imul(n ^ (n >>> 13), 3266489917);
  return (n ^ (n >>> 16)) >>> 0;
}
