import { Cell, Feature, W, type WorldContainer } from '../core/types';
import type { World } from '../core/world';
import {
  PATH_BLOCKER_ROWS_PER_CELL,
  PATH_BLOCKER_SUBDIV,
  clearAllPathBlockers,
  clearPathBlockersAtCell,
  getPathBlockerRow,
  setPathBlockerRow,
} from '../core/path_blockers';
import {
  pathBlockerDefById,
  pathBlockerIdForContainerKind,
  pathBlockerIdForFeature,
  type PathBlockerDef,
  type PathBlockerShape,
} from '../data/path_blockers';

export const HUMAN_BLOCKER_INFLATE = 0.18;
const SPAWN_CLEAR_RADIUS = 1;
const THRESHOLD_DIRS = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function assertCellIdx(cellIdx: number): number {
  const idx = Math.floor(cellIdx);
  if (!Number.isFinite(cellIdx) || idx !== cellIdx || idx < 0 || idx >= W * W) {
    throw new RangeError(`path blocker cell index out of range: ${cellIdx}`);
  }
  return idx;
}

export function pathBlockerCellCanBeStamped(world: World, cellIdx: number): boolean {
  const idx = assertCellIdx(cellIdx);
  if (world.cells[idx] !== Cell.FLOOR) return false;
  if (world.hermoWall[idx] || world.doors.has(idx)) return false;
  if (world.features[idx] === Feature.LIFT_BUTTON) return false;
  const x = idx % W;
  const y = (idx / W) | 0;
  for (const [dx, dy] of THRESHOLD_DIRS) {
    const near = world.idx(x + dx, y + dy);
    if (world.cells[near] === Cell.DOOR || world.cells[near] === Cell.LIFT || world.doors.has(near)) return false;
  }
  return true;
}

function rectContains(shape: Extract<PathBlockerShape, { kind: 'rect' }>, px: number, py: number, inflate: number): boolean {
  const halfW = shape.w * 0.5 + inflate;
  const halfH = shape.h * 0.5 + inflate;
  return Math.abs(px - shape.cx) <= halfW && Math.abs(py - shape.cy) <= halfH;
}

function circleContains(shape: Extract<PathBlockerShape, { kind: 'circle' }>, px: number, py: number, inflate: number): boolean {
  const dx = px - shape.cx;
  const dy = py - shape.cy;
  const r = shape.r + inflate;
  return dx * dx + dy * dy <= r * r;
}

function lineContains(shape: Extract<PathBlockerShape, { kind: 'line' }>, px: number, py: number, inflate: number): boolean {
  const vx = shape.x1 - shape.x0;
  const vy = shape.y1 - shape.y0;
  const wx = px - shape.x0;
  const wy = py - shape.y0;
  const len2 = vx * vx + vy * vy;
  const t = len2 <= 1e-9 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const cx = shape.x0 + vx * t;
  const cy = shape.y0 + vy * t;
  const dx = px - cx;
  const dy = py - cy;
  const radius = shape.width * 0.5 + inflate;
  return dx * dx + dy * dy <= radius * radius;
}

function shapeContains(shape: PathBlockerShape, px: number, py: number, inflate: number): boolean {
  switch (shape.kind) {
    case 'rect': return rectContains(shape, px, py, inflate);
    case 'circle': return circleContains(shape, px, py, inflate);
    case 'line': return lineContains(shape, px, py, inflate);
  }
}

function rowMaskForDef(def: PathBlockerDef, row: number): number {
  const py = (row + 0.5) / PATH_BLOCKER_SUBDIV;
  const inflate = def.inflateForHuman === false ? 0 : HUMAN_BLOCKER_INFLATE;
  let mask = 0;
  for (let sx = 0; sx < PATH_BLOCKER_SUBDIV; sx++) {
    const px = (sx + 0.5) / PATH_BLOCKER_SUBDIV;
    for (const shape of def.shapes) {
      if (!shapeContains(shape, px, py, inflate)) continue;
      mask |= 1 << sx;
      break;
    }
  }
  return mask;
}

export function stampPathBlocker(_world: World, cellIdx: number, defId: string, _seed?: number): boolean {
  const def = pathBlockerDefById(defId);
  if (!def) throw new Error(`unknown path blocker def: ${defId}`);
  return stampPathBlockerDef(_world, cellIdx, def);
}

export function stampPathBlockerDef(world: World, cellIdx: number, def: PathBlockerDef): boolean {
  const idx = assertCellIdx(cellIdx);
  if (!pathBlockerCellCanBeStamped(world, idx)) return false;
  let changed = false;
  for (let row = 0; row < PATH_BLOCKER_ROWS_PER_CELL; row++) {
    const mask = rowMaskForDef(def, row);
    if (mask === 0) continue;
    const next = getPathBlockerRow(world, idx, row) | mask;
    if (setPathBlockerRow(world, idx, row, next)) changed = true;
  }
  return changed;
}

export function stampFeaturePathBlocker(world: World, cellIdx: number, feature: Feature): boolean {
  const defId = pathBlockerIdForFeature(feature);
  return defId ? stampPathBlocker(world, cellIdx, defId) : false;
}

export function stampContainerPathBlocker(world: World, container: WorldContainer): boolean {
  const defId = pathBlockerIdForContainerKind(container.kind);
  return defId ? stampPathBlocker(world, world.idx(container.x, container.y), defId) : false;
}

export function clearPathBlockerRegion(world: World, x: number, y: number, w: number, h: number): number {
  const width = Math.max(0, Math.floor(w));
  const height = Math.max(0, Math.floor(h));
  let changed = 0;
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (clearPathBlockersAtCell(world, world.idx(x + dx, y + dy))) changed++;
    }
  }
  return changed;
}

function normalizedCellList(cells: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of cells) {
    const idx = Math.floor(raw);
    if (!Number.isFinite(raw) || idx !== raw || idx < 0 || idx >= W * W || seen.has(idx)) continue;
    seen.add(idx);
    out.push(idx);
  }
  return out;
}

export function rebuildPathBlockersFromWorldObjects(world: World, _seed?: number, cells?: readonly number[]): number {
  let stamped = 0;
  if (cells) {
    const list = normalizedCellList(cells);
    const cellSet = new Set(list);
    for (const idx of list) clearPathBlockersAtCell(world, idx);
    for (const idx of list) {
      const feature = world.features[idx] as Feature;
      if (feature !== Feature.NONE && stampFeaturePathBlocker(world, idx, feature)) stamped++;
    }
    for (const container of world.containers) {
      if (!cellSet.has(world.idx(container.x, container.y))) continue;
      if (stampContainerPathBlocker(world, container)) stamped++;
    }
    return stamped;
  }

  clearAllPathBlockers(world);
  for (let idx = 0; idx < W * W; idx++) {
    const feature = world.features[idx] as Feature;
    if (feature === Feature.NONE) continue;
    if (stampFeaturePathBlocker(world, idx, feature)) stamped++;
  }
  for (const container of world.containers) {
    if (stampContainerPathBlocker(world, container)) stamped++;
  }
  return stamped;
}

export function rebuildGeneratedFloorPathBlockers(world: World, seed: number, spawnX: number, spawnY: number): number {
  world.rebuildContainerMap();
  const stamped = rebuildPathBlockersFromWorldObjects(world, seed);
  const sx = Math.floor(spawnX) - SPAWN_CLEAR_RADIUS;
  const sy = Math.floor(spawnY) - SPAWN_CLEAR_RADIUS;
  clearPathBlockerRegion(world, sx, sy, SPAWN_CLEAR_RADIUS * 2 + 1, SPAWN_CLEAR_RADIUS * 2 + 1);
  return stamped;
}
