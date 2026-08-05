import { Cell, Feature, Tex } from '../../core/types';
import { registerRouteCue } from '../../systems/route_cues';
import {
  addItemDrop,
  isProtectedCell,
  isWalkableCell,
  roomCenter,
  type ProceduralAnomalyGenContext,
} from './common';

const WALL_SNAKE_TAG = '[wall_snake:';
const WALL_SNAKE_RE = /\[wall_snake:(-?\d+),(-?\d+),(\d+),(\d+)\]/g;

function snakeRoomScore(ctx: ProceduralAnomalyGenContext, roomId: number): number {
  const room = ctx.rooms[roomId];
  if (!room || room.w < 8 || room.h < 8 || room.sealed) return -1;
  const c = roomCenter(room);
  const d2 = ctx.world.dist2(ctx.spawnX + 0.5, ctx.spawnY + 0.5, c.x + 0.5, c.y + 0.5);
  if (d2 < 18 * 18) return -1;
  const distance = Math.sqrt(d2);
  const idealDistance = 34 + ctx.spec.danger * 9;
  const proximityScore = 20_000 - Math.abs(distance - idealDistance) * 180;
  return proximityScore + room.w * room.h * 6;
}

function perimeterIsUsable(ctx: ProceduralAnomalyGenContext, x0: number, y0: number, w: number, h: number): boolean {
  const world = ctx.world;
  let usable = 0;
  const need = Math.max(18, Math.min(56, (w + h) * 2 - 8));
  for (let i = 0; i < need; i++) {
    const p = perimeterPoint(world, x0, y0, w, h, i);
    const ci = world.idx(p.x, p.y);
    if (!isWalkableCell(world, ci)) return false;
    if (world.dist2(ctx.spawnX + 0.5, ctx.spawnY + 0.5, p.x + 0.5, p.y + 0.5) < 18 * 18) return false;
    usable++;
  }
  return usable >= need;
}

function perimeterPoint(world: ProceduralAnomalyGenContext['world'], x0: number, y0: number, w: number, h: number, step: number): { x: number; y: number } {
  const len = Math.max(1, (w + h) * 2 - 4);
  let t = ((step % len) + len) % len;
  if (t < w) return { x: world.wrap(x0 + t), y: world.wrap(y0) };
  t -= w;
  if (t < h - 1) return { x: world.wrap(x0 + w - 1), y: world.wrap(y0 + 1 + t) };
  t -= h - 1;
  if (t < w - 1) return { x: world.wrap(x0 + w - 2 - t), y: world.wrap(y0 + h - 1) };
  t -= w - 1;
  return { x: world.wrap(x0), y: world.wrap(y0 + h - 2 - t) };
}

function registerWallSnakeCue(ctx: ProceduralAnomalyGenContext, roomId: number, head: { x: number; y: number }, bait: { x: number; y: number }): void {
  registerRouteCue(ctx.world, {
    id: `procedural_${ctx.spec.key}_wall_snake`,
    x: head.x + 0.5,
    y: head.y + 0.5,
    targetX: bait.x + 0.5,
    targetY: bait.y + 0.5,
    floor: ctx.spec.baseFloor,
    roomId,
    targetRoomId: roomId,
    zoneId: ctx.world.zoneMap[ctx.world.idx(head.x, head.y)],
    label: 'змейка стен',
    hint: 'стена ходит по периметру; добыча лежит на другой стороне петли',
    targetName: 'приманка в петле',
    color: '#f6c267',
    tags: ['procedural_floor', 'wall_snake', 'moving_walls', 'visible_anomaly', 'route_pressure', ctx.spec.geometryId, ctx.spec.majorityId],
    toneSeed: (ctx.spec.seed ^ roomId * 977 ^ 0x51a4e) >>> 0,
    radius: 12,
    targetRadius: 4,
    cooldownSec: 45,
    heardText: 'На карте рядом ползет прямоугольная стеновая змейка.',
    followedText: 'Змейка прошла мимо, оставив короткое окно к приманке.',
    ignoredText: 'Змейка продолжила перетирать периметр где-то за дверями.',
  });
}

export function applyWallSnake(ctx: ProceduralAnomalyGenContext): void {
  const order = ctx.rooms
    .map((room, i) => ({ i, score: snakeRoomScore(ctx, i), area: room.w * room.h }))
    .filter(v => v.score > 0)
    .sort((a, b) => b.score - a.score || b.area - a.area);

  for (const entry of order.slice(0, 18)) {
    const room = ctx.rooms[entry.i];
    const x0 = room.x + 1;
    const y0 = room.y + 1;
    const w = Math.min(room.w - 2, 28 + ctx.spec.danger * 4);
    const h = Math.min(room.h - 2, 18 + ctx.spec.danger * 3);
    if (w < 7 || h < 7 || !perimeterIsUsable(ctx, x0, y0, w, h)) continue;

    const head = perimeterPoint(ctx.world, x0, y0, w, h, 0);
    const headIdx = ctx.world.idx(head.x, head.y);
    if (isProtectedCell(ctx.world, headIdx)) continue;
    ctx.world.features[headIdx] = Feature.SCREEN;

    const bait = perimeterPoint(ctx.world, x0, y0, w, h, Math.floor((w + h) * 0.8));
    addItemDrop(ctx, bait.x, bait.y, 'gear', 1);
    registerWallSnakeCue(ctx, room.id, head, bait);

    const maxPaint = Math.min(160, (w + h) * 2 - 4);
    for (let step = 0; step < maxPaint; step += 2) {
      const p = perimeterPoint(ctx.world, x0, y0, w, h, step);
      const ci = ctx.world.idx(p.x, p.y);
      if (ctx.world.cells[ci] !== Cell.FLOOR && ctx.world.cells[ci] !== Cell.WATER) continue;
      ctx.world.floorTex[ci] = Tex.F_CONCRETE;
      ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 22);
    }
    ctx.world.markFloorTexDirty();
    ctx.world.markFogDirty();

    room.name = `${room.name} ${WALL_SNAKE_TAG}${x0},${y0},${w},${h}]`;
    return;
  }

  for (const room of ctx.rooms) {
    WALL_SNAKE_RE.lastIndex = 0;
    const match = WALL_SNAKE_RE.exec(room.name);
    if (!match) continue;
    const x0 = Number(match[1]);
    const y0 = Number(match[2]);
    const w = Number(match[3]);
    const h = Number(match[4]);
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || w < 7 || h < 7) continue;
    const head = perimeterPoint(ctx.world, x0, y0, w, h, 0);
    const bait = perimeterPoint(ctx.world, x0, y0, w, h, Math.floor((w + h) * 0.8));
    const headIdx = ctx.world.idx(head.x, head.y);
    const baitIdx = ctx.world.idx(bait.x, bait.y);
    if (isProtectedCell(ctx.world, headIdx) || isProtectedCell(ctx.world, baitIdx)) continue;
    if (!isWalkableCell(ctx.world, baitIdx)) continue;
    ctx.world.features[headIdx] = Feature.SCREEN;
    addItemDrop(ctx, bait.x, bait.y, 'gear', 1);
    registerWallSnakeCue(ctx, room.id, head, bait);
    ctx.world.markFeaturesDirty(true);
    return;
  }
}
