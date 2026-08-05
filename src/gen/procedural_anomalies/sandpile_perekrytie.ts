import { stampSurfaceSplat } from '../../systems/surface_marks';
import { W, Cell, Feature, Tex, type Room } from '../../core/types';
import {
  addItemDrop,
  isProtectedCell,
  isWalkableCell,
  roomCenter,
  type ProceduralAnomalyGenContext,
} from './common';

export const SANDPILE_PEREKRYTIE_TAG = '[sandpile_perekrytie:';

const MAX_ARENA_W = 28;
const MAX_ARENA_H = 22;
const MIN_ARENA_W = 12;
const MIN_ARENA_H = 10;
const ROUTE_ANCHOR_PROTECT_RADIUS = 3;

function hash32(v: number): number {
  v |= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

function localIndex(w: number, lx: number, ly: number): number {
  return ly * w + lx;
}

function sample01(seed: number, lx: number, ly: number): number {
  return hash32(seed ^ Math.imul(lx + 37, 0x9e3779b1) ^ Math.imul(ly + 17, 0x85ebca6b)) / 4294967296;
}

function buildSandpileStress(w: number, h: number, seed: number): Uint8Array {
  const values = new Uint8Array(w * h);
  const topples = new Uint8Array(w * h);
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const maxRadius = Math.max(1, Math.min(w, h) * 0.5);

  for (let ly = 1; ly < h - 1; ly++) {
    for (let lx = 1; lx < w - 1; lx++) {
      const radial = Math.max(0, 3 - Math.floor(Math.hypot(lx - cx, ly - cy) / maxRadius * 4));
      values[localIndex(w, lx, ly)] = 1 + Math.floor(sample01(seed, lx, ly) * 5) + radial;
    }
  }

  const piles = [
    [Math.floor(cx), Math.floor(cy), 18],
    [Math.max(2, Math.floor(w * 0.3)), Math.max(2, Math.floor(h * 0.38)), 9],
    [Math.min(w - 3, Math.floor(w * 0.72)), Math.min(h - 3, Math.floor(h * 0.66)), 9],
  ] as const;
  for (const [lx, ly, grains] of piles) values[localIndex(w, lx, ly)] += grains;

  for (let pass = 0; pass < 128; pass++) {
    let changed = false;
    for (let ly = 1; ly < h - 1; ly++) {
      for (let lx = 1; lx < w - 1; lx++) {
        const i = localIndex(w, lx, ly);
        if (values[i] < 4) continue;
        values[i] -= 4;
        topples[i] = Math.min(15, topples[i] + 1);
        values[localIndex(w, lx + 1, ly)]++;
        values[localIndex(w, lx - 1, ly)]++;
        values[localIndex(w, lx, ly + 1)]++;
        values[localIndex(w, lx, ly - 1)]++;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const stress = new Uint8Array(w * h);
  for (let i = 0; i < stress.length; i++) stress[i] = Math.min(15, values[i] + topples[i] * 2);
  return stress;
}

function routeAnchorNearby(ctx: ProceduralAnomalyGenContext, ci: number): boolean {
  const x = ci % W;
  const y = (ci / W) | 0;
  for (let dy = -ROUTE_ANCHOR_PROTECT_RADIUS; dy <= ROUTE_ANCHOR_PROTECT_RADIUS; dy++) {
    for (let dx = -ROUTE_ANCHOR_PROTECT_RADIUS; dx <= ROUTE_ANCHOR_PROTECT_RADIUS; dx++) {
      const ni = ctx.world.idx(x + dx, y + dy);
      if (ctx.world.cells[ni] === Cell.LIFT || ctx.world.features[ni] === Feature.LIFT_BUTTON) return true;
    }
  }
  return false;
}

function roomUsableCells(ctx: ProceduralAnomalyGenContext, room: Room): number {
  let count = 0;
  const x0 = room.x + 2;
  const y0 = room.y + 2;
  const w = Math.min(MAX_ARENA_W, room.w - 4);
  const h = Math.min(MAX_ARENA_H, room.h - 4);
  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx < w; lx++) {
      const ci = ctx.world.idx(x0 + lx, y0 + ly);
      if (ctx.world.roomMap[ci] !== room.id || isProtectedCell(ctx.world, ci) || routeAnchorNearby(ctx, ci)) continue;
      if (isWalkableCell(ctx.world, ci)) count++;
    }
  }
  return count;
}

function candidateScore(ctx: ProceduralAnomalyGenContext, room: Room): number {
  if (room.sealed || room.w < MIN_ARENA_W + 4 || room.h < MIN_ARENA_H + 4) return -1;
  const center = roomCenter(room);
  const d2 = ctx.world.dist2(ctx.spawnX, ctx.spawnY, center.x + 0.5, center.y + 0.5);
  if (d2 < 42 * 42) return -1;
  const usable = roomUsableCells(ctx, room);
  if (usable < MIN_ARENA_W * MIN_ARENA_H * 0.7) return -1;
  return d2 + usable * 3 + room.w * room.h;
}

function arenaRect(room: Room): { x: number; y: number; w: number; h: number } {
  const w = Math.max(MIN_ARENA_W, Math.min(MAX_ARENA_W, room.w - 4));
  const h = Math.max(MIN_ARENA_H, Math.min(MAX_ARENA_H, room.h - 4));
  return {
    x: room.x + Math.max(2, Math.floor((room.w - w) / 2)),
    y: room.y + Math.max(2, Math.floor((room.h - h) / 2)),
    w,
    h,
  };
}

function isRim(lx: number, ly: number, w: number, h: number): boolean {
  return lx === 0 || ly === 0 || lx === w - 1 || ly === h - 1;
}

function isSeam(lx: number, ly: number, w: number, h: number, orientation: number): boolean {
  if (orientation === 0) return lx === Math.floor(w / 2) && ly >= 2 && ly <= h - 3;
  return ly === Math.floor(h / 2) && lx >= 2 && lx <= w - 3;
}

function paintArena(ctx: ProceduralAnomalyGenContext, room: Room, placed: number): boolean {
  const world = ctx.world;
  const rect = arenaRect(room);
  const orientation = rect.w >= rect.h ? 0 : 1;
  const seed = hash32(ctx.spec.seed ^ Math.imul(room.id + 1, 0x45d9f3b) ^ Math.imul(placed + 1, 0x27d4eb2d));
  const stress = buildSandpileStress(rect.w, rect.h, seed);
  const controlX = orientation === 0 ? 1 : Math.max(2, Math.floor(rect.w / 2));
  const controlY = orientation === 0 ? Math.max(2, Math.floor(rect.h / 2)) : 1;
  const controlIdx = world.idx(rect.x + controlX, rect.y + controlY);
  let cracks = 0;
  let seamCells = 0;

  for (let ly = 0; ly < rect.h; ly++) {
    for (let lx = 0; lx < rect.w; lx++) {
      const x = world.wrap(rect.x + lx);
      const y = world.wrap(rect.y + ly);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id || isProtectedCell(world, ci) || routeAnchorNearby(ctx, ci)) continue;
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;

      if (isRim(lx, ly, rect.w, rect.h)) {
        world.floorTex[ci] = Tex.F_TILE;
        world.fog[ci] = Math.max(world.fog[ci], 12);
        continue;
      }

      if (isSeam(lx, ly, rect.w, rect.h, orientation)) {
        world.cells[ci] = Cell.WALL;
        world.wallTex[ci] = Tex.CONCRETE;
        world.floorTex[ci] = Tex.F_TILE;
        world.fog[ci] = Math.max(world.fog[ci], 38);
        seamCells++;
        continue;
      }

      const s = stress[localIndex(rect.w, lx, ly)];
      if (s >= 5 || ((lx + ly + seed) % 11) === 0) {
        world.floorTex[ci] = s >= 8 ? Tex.F_GUT : Tex.F_CONCRETE;
        world.fog[ci] = Math.max(world.fog[ci], 26 + Math.min(30, s * 4));
        if ((cracks & 3) === 0) stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.28, 0.48, seed ^ ci, 92, 80, 66, false);
        cracks++;
      }
    }
  }

  if (cracks < 24 || seamCells < 6 || world.features[controlIdx] !== Feature.NONE) return false;
  world.features[controlIdx] = Feature.APPARATUS;
  world.light[controlIdx] = Math.max(world.light[controlIdx], 0.54);
  const prefix = room.name.startsWith('Песчаное перекрытие:') ? room.name : `Песчаное перекрытие: ${room.name}`;
  room.name = `${prefix} ${SANDPILE_PEREKRYTIE_TAG}${rect.x},${rect.y},${rect.w},${rect.h},${seed},${orientation},${controlX},${controlY}]`;

  if (placed === 0) {
    addItemDrop(ctx, rect.x + controlX + 1, rect.y + controlY, 'metal_sheet', 1);
    addItemDrop(ctx, rect.x + controlX, rect.y + controlY + 1, 'sealant_tube', 1);
  } else if (ctx.spec.danger >= 4) {
    addItemDrop(ctx, rect.x + controlX + 1, rect.y + controlY, 'pressure_logbook', 1);
  }
  return true;
}

export function applySandpilePerekrytie(ctx: ProceduralAnomalyGenContext): void {
  const candidates = ctx.rooms
    .map(room => ({ room, score: candidateScore(ctx, room) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  let placed = 0;
  const target = ctx.spec.danger >= 4 ? 2 : 1;
  for (const candidate of candidates.slice(0, 18)) {
    if (paintArena(ctx, candidate.room, placed)) placed++;
    if (placed >= target) break;
  }

  if (placed > 0) {
    ctx.world.markCellsDirty();
    ctx.world.markWallTexDirty();
    ctx.world.markFloorTexDirty();
    ctx.world.markFeaturesDirty(true);
    ctx.world.markFogDirty();
  }
}
