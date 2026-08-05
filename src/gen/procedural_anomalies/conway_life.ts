import { stampSurfaceSplat } from '../../systems/surface_marks';
import { Cell, Feature, RoomType, Tex } from '../../core/types';
import type { Room } from '../../core/types';
import { registerRouteCue } from '../../systems/route_cues';
import {
  isProtectedCell,
  roomCell,
  roomCenter,
  type ProceduralAnomalyGenContext,
} from './common';

export const CONWAY_LIFE_ROOM_PREFIX = 'Игра жизнь:';

function hash32(v: number): number {
  v |= 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x7feb352d);
  v ^= v >>> 15;
  v = Math.imul(v, 0x846ca68b);
  v ^= v >>> 16;
  return v >>> 0;
}

function nearDoor(ctx: ProceduralAnomalyGenContext, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (ctx.world.doors.has(ctx.world.idx(x + dx, y + dy))) return true;
    }
  }
  return false;
}

function isMutableLifeCell(ctx: ProceduralAnomalyGenContext, room: Room, x: number, y: number): boolean {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.roomMap[ci] !== room.id) return false;
  if (ctx.world.cells[ci] !== Cell.FLOOR && ctx.world.cells[ci] !== Cell.WALL) return false;
  if (isProtectedCell(ctx.world, ci)) return false;
  if (nearDoor(ctx, x, y)) return false;
  if (ctx.world.features[ci] !== Feature.NONE && ctx.world.features[ci] !== Feature.LAMP) return false;
  if (ctx.world.dist2(ctx.spawnX, ctx.spawnY, x + 0.5, y + 0.5) < 12 * 12) return false;
  for (const e of ctx.entities) {
    if (!e.alive) continue;
    if (ctx.world.dist2(e.x, e.y, x + 0.5, y + 0.5) < 2.25) return false;
  }
  return true;
}

function seedAlive(dx: number, dy: number, room: Room, seed: number): boolean {
  const edge = dx <= 2 || dy <= 2 || dx >= room.w - 3 || dy >= room.h - 3;
  const h = hash32((dx * 73856093) ^ (dy * 19349663) ^ (room.id * 83492791) ^ seed);
  if (edge) return (h & 15) === 0;
  if ((dx + seed) % 11 === 0 && dy > 3 && dy < room.h - 4) return (h % 100) < 38;
  if ((dy + room.id) % 13 === 0 && dx > 3 && dx < room.w - 4) return (h % 100) < 34;
  return (h % 100) < 24;
}

function addLifeGlider(ctx: ProceduralAnomalyGenContext, room: Room, ox: number, oy: number): void {
  const pts = [
    [1, 0], [2, 1], [0, 2], [1, 2], [2, 2],
  ];
  for (const [dx, dy] of pts) {
    const x = ctx.world.wrap(room.x + ox + dx);
    const y = ctx.world.wrap(room.y + oy + dy);
    if (!isMutableLifeCell(ctx, room, x, y)) continue;
    const ci = ctx.world.idx(x, y);
    ctx.world.cells[ci] = Cell.WALL;
    ctx.world.wallTex[ci] = Tex.DARK;
    ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 34);
  }
}

function registerConwayCue(ctx: ProceduralAnomalyGenContext, room: Room, arenaIndex: number, target: { x: number; y: number }): void {
  const c = roomCenter(room);
  registerRouteCue(ctx.world, {
    id: `procedural_${ctx.spec.key}_conway_life_${arenaIndex}`,
    x: c.x + 0.5,
    y: c.y + 0.5,
    targetX: target.x + 0.5,
    targetY: target.y + 0.5,
    floor: ctx.spec.baseFloor,
    roomId: room.id,
    targetRoomId: room.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(c.x, c.y)],
    label: 'игра жизнь',
    hint: 'поле клеток растет стенами; аппарат в центре дает окно управления',
    targetName: 'аппарат клеточного поля',
    color: '#6ee0b6',
    tags: ['procedural_floor', 'conway_life', 'cellular', 'visible_anomaly', 'route_pressure', ctx.spec.geometryId, ctx.spec.majorityId],
    toneSeed: (ctx.spec.seed ^ room.id * 4099 ^ arenaIndex * 131) >>> 0,
    radius: 14,
    targetRadius: 4,
    cooldownSec: 50,
    heardText: 'Рядом щелкает клеточное поле: стены рождаются и умирают по такту.',
    followedText: 'Клеточное поле открыло центральный аппарат между живыми стенами.',
    ignoredText: 'Клеточное поле осталось работать за соседней перегородкой.',
  });
}

function findLifeControlCell(ctx: ProceduralAnomalyGenContext, room: Room): { x: number; y: number } | null {
  const preferredX = Math.floor(room.w / 2);
  const preferredY = Math.floor(room.h / 2);
  const direct = roomCell(ctx.world, room, preferredX, preferredY, true);
  if (direct) return direct;
  let best: { x: number; y: number } | null = null;
  let bestD2 = Infinity;
  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const x = ctx.world.wrap(room.x + dx);
      const y = ctx.world.wrap(room.y + dy);
      const ci = ctx.world.idx(x, y);
      if (ctx.world.roomMap[ci] !== room.id) continue;
      if (ctx.world.cells[ci] !== Cell.FLOOR && ctx.world.cells[ci] !== Cell.WALL) continue;
      if (isProtectedCell(ctx.world, ci) || nearDoor(ctx, x, y)) continue;
      if (ctx.world.features[ci] !== Feature.NONE && ctx.world.features[ci] !== Feature.LAMP) continue;
      const d2 = (dx - preferredX) * (dx - preferredX) + (dy - preferredY) * (dy - preferredY);
      if (d2 < bestD2) {
        best = { x, y };
        bestD2 = d2;
      }
    }
  }
  return best;
}

function applyArena(ctx: ProceduralAnomalyGenContext, room: Room, arenaIndex: number): void {
  room.name = `${CONWAY_LIFE_ROOM_PREFIX} арена ${arenaIndex}; комната ${room.id}`;
  room.wallTex = Tex.DARK;
  room.floorTex = Tex.F_CONCRETE;

  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      const x = ctx.world.wrap(room.x + dx);
      const y = ctx.world.wrap(room.y + dy);
      const ci = ctx.world.idx(x, y);
      if (!isMutableLifeCell(ctx, room, x, y)) continue;
      ctx.world.floorTex[ci] = Tex.F_CONCRETE;
      if (seedAlive(dx, dy, room, ctx.spec.seed + arenaIndex * 101)) {
        ctx.world.cells[ci] = Cell.WALL;
        ctx.world.wallTex[ci] = Tex.DARK;
      } else {
        ctx.world.cells[ci] = Cell.FLOOR;
      }
      if ((dx + dy + arenaIndex) % 7 === 0) {
        stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.16, 0.34, ctx.spec.seed + room.id * 97 + dx * 13 + dy, 38, 35, 42, false);
      }
      ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 12);
    }
  }

  if (room.w >= 12 && room.h >= 12) {
    addLifeGlider(ctx, room, 3, 3);
    addLifeGlider(ctx, room, Math.max(3, room.w - 7), Math.max(3, room.h - 7));
  }

  const control = findLifeControlCell(ctx, room);
  if (control) {
    const ci = ctx.world.idx(control.x, control.y);
    ctx.world.cells[ci] = Cell.FLOOR;
    ctx.world.features[ci] = Feature.APPARATUS;
    ctx.world.floorTex[ci] = Tex.F_VOID;
    ctx.world.fog[ci] = 0;
    stampSurfaceSplat(ctx.world, control.x, control.y, 0.5, 0.5, 0.72, 0.6, ctx.spec.seed + room.id * 331, 30, 210, 160, false);
    registerConwayCue(ctx, room, arenaIndex, control);
  } else {
    const c = roomCenter(room);
    registerConwayCue(ctx, room, arenaIndex, c);
  }

  ctx.world.markWallTexDirty();
  ctx.world.markFloorTexDirty();
  ctx.world.markFogDirty();
}

function candidateRooms(ctx: ProceduralAnomalyGenContext): Room[] {
  return ctx.rooms.filter(room => {
    if (room.type === RoomType.CORRIDOR) return false;
    if (room.w < 12 || room.h < 12 || room.w > 48 || room.h > 48) return false;
    const c = roomCenter(room);
    if (ctx.world.dist2(ctx.spawnX, ctx.spawnY, c.x, c.y) < 18 * 18) return false;
    return true;
  }).sort((a, b) => {
    const ac = roomCenter(a);
    const bc = roomCenter(b);
    const ideal = 42 + ctx.spec.danger * 8;
    const ad = Math.abs(Math.sqrt(ctx.world.dist2(ctx.spawnX, ctx.spawnY, ac.x, ac.y)) - ideal);
    const bd = Math.abs(Math.sqrt(ctx.world.dist2(ctx.spawnX, ctx.spawnY, bc.x, bc.y)) - ideal);
    if (Math.abs(ad - bd) > 4) return ad - bd;
    const orderA = hash32(ctx.spec.seed ^ Math.imul(a.id + 1, 0x9e3779b1) ^ Math.imul(a.w * 31 + a.h, 0x85ebca6b));
    const orderB = hash32(ctx.spec.seed ^ Math.imul(b.id + 1, 0x9e3779b1) ^ Math.imul(b.w * 31 + b.h, 0x85ebca6b));
    return orderA - orderB;
  });
}

export function applyConwayLife(ctx: ProceduralAnomalyGenContext): void {
  const candidates = candidateRooms(ctx);
  if (candidates.length === 0) return;

  const arenas = Math.min(candidates.length, ctx.spec.danger >= 5 ? 4 : ctx.spec.danger >= 4 ? 3 : 2);
  for (let i = 0; i < arenas; i++) {
    applyArena(ctx, candidates[i], i + 1);
  }
}
