/* -- Shared local terrain checks for monster ecology ------------ */

import { Cell, Feature, Tex, W, type Entity } from '../core/types';
import type { World } from '../core/world';

export interface WetConnection {
  cells: number;
  waterCells: number;
  distance: number;
}

let wetVisitId = 1;
const wetVisited = new Uint32Array(W * W);
const wetQueue = new Int32Array(512);

export function wetWaterCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  return world.cells[ci] === Cell.WATER || world.floorTex[ci] === Tex.F_WATER;
}

export function wetTerrainCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  if (world.cells[ci] === Cell.WATER || world.floorTex[ci] === Tex.F_WATER) return true;
  const feature = world.features[ci] as Feature;
  return feature === Feature.SINK || feature === Feature.TOILET;
}

export function drainLineCell(world: World, x: number, y: number): boolean {
  if (wetTerrainCell(world, x, y)) return true;
  return wetWaterCell(world, x - 1, y) ||
    wetWaterCell(world, x + 1, y) ||
    wetWaterCell(world, x, y - 1) ||
    wetWaterCell(world, x, y + 1);
}

export function dryConcreteCell(world: World, x: number, y: number): boolean {
  const ci = world.idx(x, y);
  return world.cells[ci] === Cell.FLOOR && !wetTerrainCell(world, x, y);
}

export function wetTerrainAtEntity(world: World, e: Entity): boolean {
  return wetTerrainCell(world, Math.floor(e.x), Math.floor(e.y));
}

export function findLocalWetAnchor(
  world: World,
  actor: Entity,
  offsets: readonly (readonly [number, number])[],
): { x: number; y: number } | undefined {
  const baseX = Math.floor(actor.x);
  const baseY = Math.floor(actor.y);
  for (const [dx, dy] of offsets) {
    const x = world.wrap(baseX + dx);
    const y = world.wrap(baseY + dy);
    if (!wetTerrainCell(world, x, y) || world.solid(x, y)) continue;
    const cell = world.cells[world.idx(x, y)];
    if (cell === Cell.FLOOR || cell === Cell.WATER || cell === Cell.DOOR || cell === Cell.LIFT) return { x, y };
  }
  return undefined;
}

export function getBoundedWetConnection(
  world: World,
  from: Entity,
  to: Entity,
  maxCells: number,
  maxDist: number,
): WetConnection | undefined {
  if (maxCells <= 0 || maxDist <= 0) return undefined;
  const maxDistSq = maxDist * maxDist;
  if (world.dist2(from.x, from.y, to.x, to.y) > maxDistSq) return undefined;

  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  const tx = Math.floor(to.x);
  const ty = Math.floor(to.y);
  if (!wetTerrainCell(world, sx, sy) || !wetTerrainCell(world, tx, ty)) return undefined;

  const targetIdx = world.idx(tx, ty);
  const scanId = ++wetVisitId || 1;
  if (scanId === 1) wetVisited.fill(0);
  const cap = Math.min(maxCells, wetQueue.length);

  let head = 0;
  let tail = 0;
  let waterCells = 0;
  const startIdx = world.idx(sx, sy);
  wetVisited[startIdx] = scanId;
  wetQueue[tail++] = startIdx;

  while (head < tail && head < cap) {
    const ci = wetQueue[head++];
    const x = ci & (W - 1);
    const y = (ci / W) | 0;
    if (wetWaterCell(world, x, y)) waterCells++;
    if (ci === targetIdx) {
      const dx = world.delta(from.x, to.x);
      const dy = world.delta(from.y, to.y);
      return { cells: head, waterCells, distance: Math.sqrt(dx * dx + dy * dy) };
    }

    for (let dir = 0; dir < 4; dir++) {
      const nx = world.wrap(x + (dir === 0 ? 1 : dir === 1 ? -1 : 0));
      const ny = world.wrap(y + (dir === 2 ? 1 : dir === 3 ? -1 : 0));
      const ni = world.idx(nx, ny);
      if (wetVisited[ni] === scanId) continue;
      if (!wetTerrainCell(world, nx, ny) || world.solid(nx, ny)) continue;
      wetVisited[ni] = scanId;
      if (tail < cap) wetQueue[tail++] = ni;
    }
  }

  return undefined;
}
