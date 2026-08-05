import { W } from '../core/types';
import type { World } from '../core/world';

export type LocalHitAxis = 'x' | 'y' | 'inside';

export interface LocalSolidHit {
  t: number;
  x: number;
  y: number;
  cellX: number;
  cellY: number;
  cellIdx: number;
  axis: LocalHitAxis;
  stepX: -1 | 0 | 1;
  stepY: -1 | 0 | 1;
  u: number;
}

const EPS = 1e-9;

export function wrapWorld(v: number): number {
  return ((v % W) + W) % W;
}

export function fracWorld(v: number): number {
  return ((v % 1) + 1) % 1;
}

export function traceFirstSolidCell(
  world: World,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
): LocalSolidHit | null {
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return null;

  let cellX = world.wrap(Math.floor(x0));
  let cellY = world.wrap(Math.floor(y0));
  const startIdx = world.idx(cellX, cellY);
  if (world.solid(cellX, cellY)) {
    return hitAt(0, x0, y0, cellX, cellY, startIdx, 'inside', 0, 0);
  }

  const stepX: -1 | 0 | 1 = dx > EPS ? 1 : dx < -EPS ? -1 : 0;
  const stepY: -1 | 0 | 1 = dy > EPS ? 1 : dy < -EPS ? -1 : 0;
  let tMaxX = Number.POSITIVE_INFINITY;
  let tMaxY = Number.POSITIVE_INFINITY;
  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy);

  if (stepX !== 0) {
    const boundaryX = stepX > 0 ? Math.floor(x0) + 1 : Math.floor(x0);
    tMaxX = (boundaryX - x0) / dx;
    if (tMaxX < EPS) tMaxX += tDeltaX;
  }
  if (stepY !== 0) {
    const boundaryY = stepY > 0 ? Math.floor(y0) + 1 : Math.floor(y0);
    tMaxY = (boundaryY - y0) / dy;
    if (tMaxY < EPS) tMaxY += tDeltaY;
  }

  let guard = 0;
  const maxSteps = Math.min(W * 2, Math.ceil(Math.abs(dx) + Math.abs(dy)) + 4);
  while (guard++ < maxSteps) {
    let t: number;
    let axis: LocalHitAxis;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      axis = 'x';
      cellX = world.wrap(cellX + stepX);
      tMaxX += tDeltaX;
    } else {
      t = tMaxY;
      axis = 'y';
      cellY = world.wrap(cellY + stepY);
      tMaxY += tDeltaY;
    }
    if (t > 1 + EPS) break;
    const hitX = wrapWorld(x0 + dx * Math.max(0, Math.min(1, t)));
    const hitY = wrapWorld(y0 + dy * Math.max(0, Math.min(1, t)));
    const idx = world.idx(cellX, cellY);
    if (world.solid(cellX, cellY)) {
      return hitAt(Math.max(0, Math.min(1, t)), hitX, hitY, cellX, cellY, idx, axis, stepX, stepY);
    }
  }
  return null;
}

function hitAt(
  t: number,
  x: number,
  y: number,
  cellX: number,
  cellY: number,
  cellIdx: number,
  axis: LocalHitAxis,
  stepX: -1 | 0 | 1,
  stepY: -1 | 0 | 1,
): LocalSolidHit {
  const u = axis === 'x' ? fracWorld(y) : fracWorld(x);
  return {
    t,
    x: wrapWorld(x),
    y: wrapWorld(y),
    cellX,
    cellY,
    cellIdx,
    axis,
    stepX: axis === 'x' ? stepX : 0,
    stepY: axis === 'y' ? stepY : 0,
    u,
  };
}
