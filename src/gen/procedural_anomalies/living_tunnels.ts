import { stampSurfaceSplat } from '../../systems/surface_marks';
import { W, Cell, Feature, Tex, type Room } from '../../core/types';
import {
  addItemDrop,
  randomRoomCell,
  roomCenter,
  type ProceduralAnomalyGenContext,
} from './common';

const LIVING_TUNNEL_ROOM_PREFIX = 'Живые тоннели:';
const LIVING_TUNNEL_TAG = '[living_tunnel:';
const ROUTE_ANCHOR_PROTECT_RADIUS = 3;
const CAPILLARY_DIRS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
] as const;

function hash32(v: number): number {
  v |= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

function candidateRooms(ctx: ProceduralAnomalyGenContext): Room[] {
  return ctx.rooms.filter(room => {
    if (room.id === 0 || room.sealed || room.w < 5 || room.h < 5) return false;
    const c = roomCenter(room);
    return ctx.world.dist2(ctx.spawnX, ctx.spawnY, c.x + 0.5, c.y + 0.5) > 44 * 44;
  });
}

function roomOrder(seed: number, room: Room): number {
  return hash32(seed ^ Math.imul(room.id + 1, 0x9e3779b1) ^ Math.imul(room.w + room.h, 0x85ebca6b));
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

function mutableCapillaryCell(ctx: ProceduralAnomalyGenContext, ci: number): boolean {
  const cell = ctx.world.cells[ci] as Cell;
  if (cell === Cell.LIFT || cell === Cell.DOOR || cell === Cell.ABYSS) return false;
  if (routeAnchorNearby(ctx, ci)) return false;
  if (ctx.world.hermoWall[ci] !== 0 || ctx.world.aptMask[ci] !== 0 || ctx.world.doors.has(ci) || ctx.world.containerMap.has(ci)) return false;
  const feature = ctx.world.features[ci] as Feature;
  if (feature === Feature.LIFT_BUTTON || feature === Feature.SCREEN || feature === Feature.APPARATUS) return false;
  if (feature !== Feature.NONE && feature !== Feature.LAMP) return false;
  return cell === Cell.FLOOR || cell === Cell.WALL || cell === Cell.WATER;
}

function selectRootRooms(ctx: ProceduralAnomalyGenContext, target: number): Room[] {
  const ordered = candidateRooms(ctx).sort((a, b) => roomOrder(ctx.spec.seed, a) - roomOrder(ctx.spec.seed, b));
  const picked: Room[] = [];
  const minDist2 = (82 + ctx.spec.danger * 7) ** 2;

  for (let pass = 0; pass < 2 && picked.length < target; pass++) {
    for (const room of ordered) {
      if (picked.includes(room)) continue;
      const c = roomCenter(room);
      if (pass === 0 && picked.some(prev => {
        const pc = roomCenter(prev);
        return ctx.world.dist2(c.x, c.y, pc.x, pc.y) < minDist2;
      })) continue;
      picked.push(room);
      if (picked.length >= target) break;
    }
  }

  return picked;
}

function stampCapillaryCell(ctx: ProceduralAnomalyGenContext, x: number, y: number, seed: number, step: number): boolean {
  const ci = ctx.world.idx(x, y);
  if (!mutableCapillaryCell(ctx, ci)) return false;
  if (ctx.world.cells[ci] === Cell.WALL) ctx.world.roomMap[ci] = -1;
  ctx.world.cells[ci] = Cell.FLOOR;
  if (ctx.world.features[ci] === Feature.LAMP) ctx.world.features[ci] = Feature.NONE;
  ctx.world.floorTex[ci] = Tex.F_GUT;
  ctx.world.wallTex[ci] = Tex.GUT;
  ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 18 + ((seed + step) & 15));
  if ((step & 1) === 0) {
    stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.24, 0.42, seed ^ step * 97, 104, 154, 116, false);
  }
  return true;
}

function stampCapillaryBuds(ctx: ProceduralAnomalyGenContext, pos: { x: number; y: number }, seed: number): number {
  let changed = 0;
  const armCount = Math.min(7, 3 + ctx.spec.danger + (seed & 1));
  for (let arm = 0; arm < armCount; arm++) {
    let x = pos.x;
    let y = pos.y;
    let dir = (hash32(seed ^ arm * 0x9e37) & 3);
    const len = 4 + (hash32(seed ^ arm * 0x51ed) % (4 + ctx.spec.danger * 2));
    for (let step = 1; step <= len; step++) {
      const turn = hash32(seed ^ arm * 0x45d9f3b ^ step * 0x27d4eb2d);
      if ((turn & 7) === 0) dir = (dir + ((turn & 8) ? 1 : 3)) & 3;
      const d = CAPILLARY_DIRS[dir];
      x = ctx.world.wrap(x + d.x);
      y = ctx.world.wrap(y + d.y);
      if (!stampCapillaryCell(ctx, x, y, seed ^ arm * 193, step)) break;
      changed++;
      if ((step % 4) === 0) {
        const side = CAPILLARY_DIRS[(dir + ((turn & 16) ? 1 : 3)) & 3];
        if (stampCapillaryCell(ctx, x + side.x, y + side.y, seed ^ arm * 313, step + 31)) changed++;
      }
    }
  }
  return changed;
}

function markRoot(ctx: ProceduralAnomalyGenContext, room: Room, placed: number): boolean {
  const pos = randomRoomCell(ctx.world, room, true);
  if (!pos) return false;
  for (const entity of ctx.entities) {
    if (entity.alive && ctx.world.dist2(entity.x, entity.y, pos.x + 0.5, pos.y + 0.5) < 2.25) return false;
  }
  const ci = ctx.world.idx(pos.x, pos.y);
  if (ctx.world.features[ci] !== Feature.NONE) return false;
  if (routeAnchorNearby(ctx, ci)) return false;

  const seed = hash32(ctx.spec.seed ^ Math.imul(room.id + 11, 0x45d9f3b) ^ Math.imul(placed + 1, 0x27d4eb2d));
  const maxLen = 52 + ctx.spec.danger * 18 + (placed % 3) * 9;
  ctx.world.features[ci] = Feature.APPARATUS;
  ctx.world.floorTex[ci] = Tex.F_GUT;
  ctx.world.wallTex[ci] = Tex.GUT;
  ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 32);
  ctx.world.light[ci] = Math.max(ctx.world.light[ci], 0.58);
  stampSurfaceSplat(ctx.world, pos.x, pos.y, 0.5, 0.5, 0.82, 0.66, seed, 58, 170, 126, false);
  const capillaries = stampCapillaryBuds(ctx, pos, seed);
  if (capillaries > 0) {
    stampSurfaceSplat(ctx.world, pos.x, pos.y, 0.5, 0.5, 0.44, 0.48, seed ^ capillaries, 158, 176, 148, false);
  }

  const prefix = room.name.startsWith(LIVING_TUNNEL_ROOM_PREFIX) ? room.name : `${LIVING_TUNNEL_ROOM_PREFIX} ${room.name}`;
  room.name = `${prefix} ${LIVING_TUNNEL_TAG}${pos.x},${pos.y},${seed},${maxLen}]`;

  if (placed === 0) addItemDrop(ctx, pos.x + 2, pos.y, 'sealant_tube', 1);
  else if (placed === 1 && ctx.spec.danger >= 3) addItemDrop(ctx, pos.x - 2, pos.y, 'relay_diagram', 1);
  return true;
}

export function applyLivingTunnels(ctx: ProceduralAnomalyGenContext): void {
  const target = 4 + ctx.spec.danger * 2;
  const rooms = selectRootRooms(ctx, target);
  let placed = 0;

  for (const room of rooms) {
    if (!markRoot(ctx, room, placed)) continue;
    placed++;
    if (placed >= target) break;
  }

  if (placed > 0) {
    ctx.world.markFloorTexDirty();
    ctx.world.markWallTexDirty();
    ctx.world.markFeaturesDirty(true);
    ctx.world.markFogDirty();
  }
}
