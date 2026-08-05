import { Cell, Feature, Tex, type Room } from '../../core/types';
import {
  isProtectedCell,
  isWalkableCell,
  roomCenter,
  type ProceduralAnomalyGenContext,
} from './common';

const SECTION_SHIFT_TAG = '[section_shift:';

function candidateScore(ctx: ProceduralAnomalyGenContext, room: Room): number {
  if (room.w < 7 || room.h < 7 || room.sealed) return -1;
  const c = roomCenter(room);
  const d2 = ctx.world.dist2(ctx.spawnX + 0.5, ctx.spawnY + 0.5, c.x + 0.5, c.y + 0.5);
  return d2 + room.w * room.h * 2;
}

function usableInterior(ctx: ProceduralAnomalyGenContext, room: Room): number {
  let count = 0;
  const maxW = Math.min(room.w - 2, 26);
  const maxH = Math.min(room.h - 2, 22);
  for (let dy = 1; dy <= maxH; dy++) {
    for (let dx = 1; dx <= maxW; dx++) {
      const ci = ctx.world.idx(room.x + dx, room.y + dy);
      if (ctx.world.roomMap[ci] !== room.id) continue;
      if (isWalkableCell(ctx.world, ci)) count++;
    }
  }
  return count;
}

function paintRoomBand(ctx: ProceduralAnomalyGenContext, room: Room, phase: number): boolean {
  const world = ctx.world;
  const maxW = Math.min(room.w - 2, 30);
  const maxH = Math.min(room.h - 2, 24);
  const controlDx = Math.max(2, Math.min(maxW - 1, Math.floor(maxW / 2)));
  const controlDy = Math.max(2, Math.min(maxH - 1, Math.floor(maxH / 2)));
  let marked = 0;
  let apparatus = -1;
  for (let dy = 1; dy <= maxH; dy++) {
    for (let dx = 1; dx <= maxW; dx++) {
      const x = world.wrap(room.x + dx);
      const y = world.wrap(room.y + dy);
      const ci = world.idx(x, y);
      if (world.roomMap[ci] !== room.id || isProtectedCell(world, ci)) continue;
      if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) continue;
      if (((dx + phase * 3) % 6) === 0 || ((dy + phase * 2) % 7) === 0 || dx === controlDx || dy === controlDy) {
        world.floorTex[ci] = Tex.F_TILE;
        world.fog[ci] = Math.max(world.fog[ci], 30 + phase * 8);
        marked++;
      }
      if (dx === controlDx && dy === controlDy) apparatus = ci;
      else if (apparatus < 0 && dx > 2 && dy > 2 && dx < maxW - 1 && dy < maxH - 1) apparatus = ci;
    }
  }
  if (marked <= 20 || apparatus < 0) return false;
  world.features[apparatus] = Feature.APPARATUS;
  room.name = `${room.name} ${SECTION_SHIFT_TAG}${room.x + 1},${room.y + 1},${maxW},${maxH},${phase}]`;
  return true;
}

export function applySectionShift(ctx: ProceduralAnomalyGenContext): void {
  const candidates = ctx.rooms
    .map(room => ({ room, score: candidateScore(ctx, room), usable: usableInterior(ctx, room) }))
    .filter(v => v.score > 0 && v.usable > 42)
    .sort((a, b) => b.score - a.score || b.usable - a.usable);

  let placed = 0;
  const target = Math.min(4, 1 + ctx.spec.danger);
  for (const candidate of candidates.slice(0, 16)) {
    if (paintRoomBand(ctx, candidate.room, placed % 3)) placed++;
    if (placed >= target) break;
  }
  if (placed > 0) {
    ctx.world.markFloorTexDirty();
    ctx.world.markFogDirty();
  }
}
