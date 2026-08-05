import { stampSurfaceSplat } from '../../systems/surface_marks';
import { Cell, Feature, RoomType, Tex } from '../../core/types';
import {
  addItemDrop,
  chance,
  irng,
  isProtectedCell,
  pick,
  randomRoomCell,
  roomCell,
  roomCenter,
  type ProceduralAnomalyGenContext,
} from './common';

export const RADIO_CHESS_ROOM_PREFIX = 'Радио-шахматы';

function markBoardCell(ctx: ProceduralAnomalyGenContext, x: number, y: number, seed: number): void {
  const { world } = ctx;
  const ci = world.idx(x, y);
  if (world.cells[ci] !== Cell.FLOOR && world.cells[ci] !== Cell.WATER) return;
  if (isProtectedCell(world, ci)) return;

  const light = ((x + y + seed) & 1) === 0 ? 0.22 : 0.08;
  world.light[ci] = Math.max(world.light[ci], light);
  if (((x ^ y ^ seed) & 3) === 0) world.floorTex[ci] = Tex.F_TILE;
  if (((x * 31 + y * 17 + seed) & 15) === 0) {
    stampSurfaceSplat(world, x, y, 0.5, 0.5, 0.18, 0.34, seed + x * 13 + y * 19, 190, 190, 125, false);
  }
}

function stampBoardRoom(ctx: ProceduralAnomalyGenContext, roomIndex: number): void {
  const { world, rooms, spec } = ctx;
  const room = rooms[roomIndex];
  room.name = `${RADIO_CHESS_ROOM_PREFIX}: доска ${room.id}`;
  room.floorTex = Tex.F_TILE;

  for (let dy = 0; dy < room.h; dy++) {
    for (let dx = 0; dx < room.w; dx++) {
      markBoardCell(ctx, room.x + dx, room.y + dy, spec.seed + room.id * 97);
    }
  }

  const center = roomCenter(room);
  const beacon = roomCell(world, room, Math.floor(room.w / 2), Math.floor(room.h / 2), true) ??
    randomRoomCell(world, room, true) ??
    center;
  const bi = world.idx(beacon.x, beacon.y);
  world.features[bi] = Feature.APPARATUS;
  world.light[bi] = Math.max(world.light[bi], 0.85);
  stampSurfaceSplat(world, beacon.x, beacon.y, 0.5, 0.5, 0.72, 0.7, spec.seed + 6100 + room.id, 210, 185, 70, false);

  if (chance(0.7)) addItemDrop(ctx, beacon.x + irng(-1, 1), beacon.y + irng(-1, 1), pick(['radio', 'wire_coil', 'circuit_board']), 1);
}

function placeSafeBench(ctx: ProceduralAnomalyGenContext, boardRoomIds: Set<number>): void {
  const candidates = ctx.rooms.filter(room => (
    !boardRoomIds.has(room.id) &&
    room.type !== RoomType.CORRIDOR &&
    room.w >= 5 &&
    room.h >= 5
  ));
  if (candidates.length === 0) return;
  const room = pick(candidates);
  const pos = randomRoomCell(ctx.world, room, true);
  if (!pos) return;
  const ci = ctx.world.idx(pos.x, pos.y);
  ctx.world.features[ci] = Feature.CHAIR;
  ctx.world.light[ci] = Math.max(ctx.world.light[ci], 0.45);
  stampSurfaceSplat(ctx.world, pos.x, pos.y, 0.5, 0.5, 0.34, 0.42, ctx.spec.seed + room.id * 131, 90, 145, 170, false);
}

function boardCandidates(ctx: ProceduralAnomalyGenContext): number[] {
  const out: number[] = [];
  for (let i = 0; i < ctx.rooms.length; i++) {
    const room = ctx.rooms[i];
    if (room.w < 8 || room.h < 8) continue;
    if (room.type === RoomType.BATHROOM || room.type === RoomType.KITCHEN) continue;
    const c = roomCenter(room);
    if (ctx.world.dist2(ctx.spawnX, ctx.spawnY, c.x + 0.5, c.y + 0.5) < 34 * 34) continue;
    out.push(i);
  }
  return out;
}

export function applyRadioChess(ctx: ProceduralAnomalyGenContext): void {
  const candidates = boardCandidates(ctx);
  if (candidates.length === 0) return;

  const target = Math.min(candidates.length, 2 + Math.floor(ctx.spec.danger / 2));
  const used = new Set<number>();
  for (let i = 0; i < target; i++) {
    let picked = pick(candidates);
    for (let guard = 0; guard < 16 && used.has(picked); guard++) picked = pick(candidates);
    if (used.has(picked)) continue;
    used.add(picked);
    stampBoardRoom(ctx, picked);
  }

  const boardRoomIds = new Set<number>();
  for (const idx of used) boardRoomIds.add(ctx.rooms[idx].id);
  for (let i = 0; i < Math.min(3, 1 + ctx.spec.danger); i++) placeSafeBench(ctx, boardRoomIds);
}
