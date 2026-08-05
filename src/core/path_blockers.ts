import { W } from './types';

export const PATH_BLOCKER_SUBDIV = 4;
export const PATH_BLOCKER_ROWS_PER_CELL = 4;
export const PATH_BLOCKER_BYTES_PER_CELL = PATH_BLOCKER_ROWS_PER_CELL;
export const EMPTY_PATH_BLOCKER_ROW = 0;

export interface PathBlockerWorldLike {
  pathBlockers: Uint8Array;
  pathBlockerVersion: number;
  pathBlockerDirtyVersion: number;
  wrap(v: number): number;
  idx(x: number, y: number): number;
}

function assertPathBlockerCell(cellIdx: number): number {
  const idx = Math.floor(cellIdx);
  if (!Number.isFinite(cellIdx) || idx !== cellIdx || idx < 0 || idx >= W * W) {
    throw new RangeError(`path blocker cell index out of range: ${cellIdx}`);
  }
  return idx;
}

function assertPathBlockerRow(row: number): number {
  const idx = Math.floor(row);
  if (!Number.isFinite(row) || idx !== row || idx < 0 || idx >= PATH_BLOCKER_ROWS_PER_CELL) {
    throw new RangeError(`path blocker row out of range: ${row}`);
  }
  return idx;
}

function assertPathBlockerMask(mask: number): number {
  const normalized = Math.floor(mask);
  if (!Number.isFinite(mask) || normalized !== mask || normalized < 0 || normalized > 0x0f) {
    throw new RangeError(`path blocker row mask out of nibble range: ${mask}`);
  }
  return normalized;
}

export function pathBlockerRowOffset(cellIdx: number, row: number): number {
  return assertPathBlockerCell(cellIdx) * PATH_BLOCKER_BYTES_PER_CELL + assertPathBlockerRow(row);
}

export function pathBlockerSubcell(v: number): number {
  if (!Number.isFinite(v)) throw new RangeError(`path blocker coordinate out of range: ${v}`);
  const base = Math.floor(v);
  const frac = v - base;
  return Math.max(0, Math.min(PATH_BLOCKER_SUBDIV - 1, Math.floor(frac * PATH_BLOCKER_SUBDIV)));
}

export function getPathBlockerRow(world: PathBlockerWorldLike, cellIdx: number, row: number): number {
  return world.pathBlockers[pathBlockerRowOffset(cellIdx, row)] ?? EMPTY_PATH_BLOCKER_ROW;
}

export function markPathBlockersDirty(world: PathBlockerWorldLike): void {
  world.pathBlockerVersion = (world.pathBlockerVersion + 1) | 0;
  world.pathBlockerDirtyVersion = world.pathBlockerVersion;
}

export function setPathBlockerRow(world: PathBlockerWorldLike, cellIdx: number, row: number, mask: number): boolean {
  const offset = pathBlockerRowOffset(cellIdx, row);
  const normalized = assertPathBlockerMask(mask);
  if (world.pathBlockers[offset] === normalized) return false;
  world.pathBlockers[offset] = normalized;
  markPathBlockersDirty(world);
  return true;
}

export function clearPathBlockersAtCell(world: PathBlockerWorldLike, cellIdx: number): boolean {
  const offset = pathBlockerRowOffset(cellIdx, 0);
  let changed = false;
  for (let row = 0; row < PATH_BLOCKER_ROWS_PER_CELL; row++) {
    if (world.pathBlockers[offset + row] === EMPTY_PATH_BLOCKER_ROW) continue;
    world.pathBlockers[offset + row] = EMPTY_PATH_BLOCKER_ROW;
    changed = true;
  }
  if (changed) markPathBlockersDirty(world);
  return changed;
}

export function clearAllPathBlockers(world: PathBlockerWorldLike): boolean {
  let changed = false;
  for (let i = 0; i < world.pathBlockers.length; i++) {
    if (world.pathBlockers[i] === EMPTY_PATH_BLOCKER_ROW) continue;
    changed = true;
    break;
  }
  if (!changed) return false;
  world.pathBlockers.fill(EMPTY_PATH_BLOCKER_ROW);
  markPathBlockersDirty(world);
  return true;
}

export function pathBlockedAt(world: PathBlockerWorldLike, x: number, y: number): boolean {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const cellX = fx & (W - 1);
  const cellY = fy & (W - 1);
  const col = ((x - fx) * PATH_BLOCKER_SUBDIV) | 0;
  const row = ((y - fy) * PATH_BLOCKER_SUBDIV) | 0;
  const cellIdx = cellY * W + cellX;
  const mask = world.pathBlockers[cellIdx * PATH_BLOCKER_BYTES_PER_CELL + row] ?? EMPTY_PATH_BLOCKER_ROW;
  return (mask & (1 << col)) !== 0;
}
