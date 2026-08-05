import { Cell, Feature, RoomType, Tex, W, type Room } from '../../core/types';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { canPlaceRoom, placeDoorAt, stampRoom } from '../shared';
import {
  addItemDrop,
  rebuildProceduralAnomalyPlacement,
  randomRoomCell,
  roomCell,
  type ProceduralAnomalyGenContext,
} from './common';

const CONVEYOR_ROOM_PREFIX = 'Сортировочный конвейер';
const CONVEYOR_ANNEX_PREFIX = 'Сортировочная станция';
const SORTER_LOOT = ['filter_layer', 'valve_tag', 'relay_diagram', 'duct_tape', 'forged_ration_card'];
const CONVEYOR_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

interface ConveyorAnnexAnchor {
  x: number;
  y: number;
  dir: 0 | 1 | 2 | 3;
  score: number;
}

export function applyConveyorSorter(ctx: ProceduralAnomalyGenContext): void {
  const annexCount = placeConveyorSortingAnnexes(ctx);
  if (annexCount > 0) rebuildProceduralAnomalyPlacement(ctx);

  const rooms = ctx.rooms.filter(room =>
    room.id !== 0 &&
    room.w >= 10 &&
    room.h >= 8 &&
    (room.type === RoomType.PRODUCTION || room.type === RoomType.CORRIDOR || room.type === RoomType.STORAGE || room.type === RoomType.COMMON)
  );
  const count = Math.min(8 + ctx.spec.danger, Math.max(2, 1 + ctx.spec.danger + Math.floor(annexCount / 4)), rooms.length);

  for (let i = 0; i < count; i++) {
    const room = rooms[(i * 5 + annexCount) % rooms.length];
    room.name = `${CONVEYOR_ROOM_PREFIX} ${i + 1}: ${room.name}`;
    drawConveyorLoop(ctx, room, i);

    const control = roomCell(ctx.world, room, 3, Math.max(1, Math.floor(room.h / 2) - 1), true) ??
      randomRoomCell(ctx.world, room, true);
    if (control) ctx.world.features[ctx.world.idx(control.x, control.y)] = Feature.APPARATUS;
    const receiver = roomCell(ctx.world, room, room.w - 4, Math.min(room.h - 2, Math.floor(room.h / 2) + 1), true) ??
      randomRoomCell(ctx.world, room, true);
    if (receiver) ctx.world.features[ctx.world.idx(receiver.x, receiver.y)] = Feature.SHELF;
    const loot = receiver ?? randomRoomCell(ctx.world, room);
    if (loot) addItemDrop(ctx, loot.x, loot.y, SORTER_LOOT[i % SORTER_LOOT.length], 1 + (ctx.spec.danger >= 4 ? 1 : 0));
  }
}

function hash01(seed: number, x: number, y: number, salt: number): number {
  let h = seed ^ Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x632b, 0xc2b2ae35) ^ Math.imul(salt + 0x27d4, 0x165667b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function nextRoomId(rooms: readonly Room[]): number {
  let id = rooms.length;
  const used = new Set(rooms.map(room => room.id));
  while (used.has(id)) id++;
  return id;
}

function sourceCellAllowsAnnex(ctx: ProceduralAnomalyGenContext, ci: number): boolean {
  if (ctx.world.cells[ci] !== Cell.FLOOR) return false;
  if (ctx.world.features[ci] === Feature.LIFT_BUTTON) return false;
  if (ctx.world.aptMask[ci] || ctx.world.containerMap.has(ci)) return false;
  const roomId = ctx.world.roomMap[ci];
  if (roomId < 0) return true;
  const room = ctx.world.rooms[roomId];
  return room?.type === RoomType.CORRIDOR ||
    room?.type === RoomType.COMMON ||
    room?.type === RoomType.STORAGE ||
    room?.type === RoomType.PRODUCTION ||
    room?.type === RoomType.OFFICE;
}

function collectConveyorAnnexAnchors(ctx: ProceduralAnomalyGenContext): ConveyorAnnexAnchor[] {
  const anchors: ConveyorAnnexAnchor[] = [];
  const step = ctx.spec.geometryId === 'admin_pockets' ? 2 : 3;
  for (let y = 14; y < W - 14; y += step) {
    for (let x = 14; x < W - 14; x += step) {
      const ci = ctx.world.idx(x, y);
      if (!sourceCellAllowsAnnex(ctx, ci)) continue;
      for (let dir = 0; dir < CONVEYOR_DIRS.length; dir++) {
        const [dx, dy] = CONVEYOR_DIRS[dir];
        const wallIdx = ctx.world.idx(x + dx, y + dy);
        if (ctx.world.cells[wallIdx] !== Cell.WALL || ctx.world.hermoWall[wallIdx] || ctx.world.aptMask[wallIdx]) continue;
        const openBack = ctx.world.cells[ctx.world.idx(x - dx, y - dy)] !== Cell.WALL;
        if (!openBack && hash01(ctx.spec.seed, x >> 2, y >> 2, dir + 0x751) < 0.35) continue;
        anchors.push({
          x,
          y,
          dir: dir as 0 | 1 | 2 | 3,
          score: hash01(ctx.spec.seed, x >> 1, y >> 1, dir + 0x507) + anchors.length * 1e-8,
        });
      }
    }
  }
  anchors.sort((a, b) => a.score - b.score);
  return anchors;
}

function conveyorAnnexType(serial: number): RoomType {
  const cycle = [
    RoomType.PRODUCTION,
    RoomType.STORAGE,
    RoomType.OFFICE,
    RoomType.STORAGE,
    RoomType.COMMON,
  ] as const;
  return cycle[serial % cycle.length];
}

function conveyorAnnexSize(type: RoomType, serial: number, admin: boolean): { w: number; h: number } {
  if (type === RoomType.PRODUCTION) return { w: 12 + (serial % 5), h: 8 + ((serial >>> 1) % 4) };
  if (type === RoomType.COMMON) return { w: 10 + (serial % 4), h: 7 + ((serial >>> 2) % 4) };
  if (type === RoomType.OFFICE) return { w: admin ? 9 + (serial % 4) : 8 + (serial % 4), h: 6 + ((serial >>> 2) % 3) };
  return { w: 8 + (serial % 5), h: 6 + ((serial >>> 1) % 3) };
}

function conveyorAnnexPosition(anchor: ConveyorAnnexAnchor, size: { w: number; h: number }): { x: number; y: number; doorX: number; doorY: number } {
  const [dx, dy] = CONVEYOR_DIRS[anchor.dir];
  if (dx > 0) return { x: anchor.x + 2, y: anchor.y - (size.h >> 1), doorX: anchor.x + 1, doorY: anchor.y };
  if (dx < 0) return { x: anchor.x - size.w - 1, y: anchor.y - (size.h >> 1), doorX: anchor.x - 1, doorY: anchor.y };
  if (dy > 0) return { x: anchor.x - (size.w >> 1), y: anchor.y + 2, doorX: anchor.x, doorY: anchor.y + 1 };
  return { x: anchor.x - (size.w >> 1), y: anchor.y - size.h - 1, doorX: anchor.x, doorY: anchor.y - 1 };
}

function decorateConveyorAnnex(ctx: ProceduralAnomalyGenContext, room: Room, type: RoomType, serial: number): void {
  room.name = type === RoomType.PRODUCTION
    ? `${CONVEYOR_ANNEX_PREFIX} ${serial + 1}: привод`
    : type === RoomType.STORAGE
      ? `${CONVEYOR_ANNEX_PREFIX} ${serial + 1}: бункер`
      : type === RoomType.OFFICE
        ? `${CONVEYOR_ANNEX_PREFIX} ${serial + 1}: журнал`
        : `${CONVEYOR_ANNEX_PREFIX} ${serial + 1}: очередь`;
  room.wallTex = type === RoomType.PRODUCTION ? Tex.METAL : Tex.MARBLE;
  room.floorTex = type === RoomType.PRODUCTION ? Tex.F_CONCRETE : Tex.F_MARBLE_TILE;
  for (let dy = -1; dy <= room.h; dy++) {
    for (let dx = -1; dx <= room.w; dx++) {
      const ci = ctx.world.idx(room.x + dx, room.y + dy);
      const interior = dx >= 0 && dx < room.w && dy >= 0 && dy < room.h;
      if (interior) ctx.world.floorTex[ci] = room.floorTex;
      else ctx.world.wallTex[ci] = room.wallTex;
    }
  }
  const cx = room.x + Math.floor(room.w / 2);
  const cy = room.y + Math.floor(room.h / 2);
  const center = ctx.world.idx(cx, cy);
  if (ctx.world.cells[center] === Cell.FLOOR) ctx.world.features[center] = type === RoomType.OFFICE ? Feature.SCREEN : Feature.MACHINE;
  const shelf = ctx.world.idx(room.x + Math.max(1, room.w - 2), cy);
  if (ctx.world.cells[shelf] === Cell.FLOOR && ctx.world.features[shelf] === Feature.NONE) ctx.world.features[shelf] = Feature.SHELF;
  drawConveyorLoop(ctx, room, serial + 31);
}

function placeConveyorSortingAnnexes(ctx: ProceduralAnomalyGenContext): number {
  const target = Math.min(
    56,
    12 +
      ctx.spec.danger * 5 +
      (ctx.spec.geometryId === 'admin_pockets' ? 18 : 0) +
      (ctx.spec.geometryId === 'communal_knots' ? 8 : 0),
  );
  const anchors = collectConveyorAnnexAnchors(ctx);
  let placed = 0;
  for (const anchor of anchors) {
    if (placed >= target) break;
    const type = conveyorAnnexType(placed);
    const size = conveyorAnnexSize(type, placed, ctx.spec.geometryId === 'admin_pockets');
    const pos = conveyorAnnexPosition(anchor, size);
    if (!canPlaceRoom(ctx.world, pos.x, pos.y, size.w, size.h)) continue;
    const room = stampRoom(ctx.world, nextRoomId(ctx.rooms), type, pos.x, pos.y, size.w, size.h, -1);
    ctx.rooms.push(room);
    decorateConveyorAnnex(ctx, room, type, placed);
    placeDoorAt(ctx.world, pos.doorX, pos.doorY, room.id);
    placed++;
  }
  if (placed > 0) {
    ctx.world.markCellsDirty();
    ctx.world.markWallTexDirty();
    ctx.world.markFloorTexDirty();
    ctx.world.markFeaturesDirty(true);
  }
  return placed;
}

function drawConveyorLoop(ctx: ProceduralAnomalyGenContext, room: { id: number; x: number; y: number; w: number; h: number }, order: number): void {
  const left = room.x + 2;
  const right = room.x + room.w - 3;
  const top = room.y + 2;
  const bottom = room.y + room.h - 3;
  const midX = room.x + Math.floor(room.w / 2);
  const midY = room.y + Math.floor(room.h / 2);
  const seed = ctx.spec.seed + room.id * 131 + order * 17;

  for (let x = left; x <= right; x++) {
    stampConveyorCell(ctx, x, top, seed + x, 65, 91, 96);
    stampConveyorCell(ctx, x, bottom, seed + x + 9000, 95, 79, 54);
  }
  for (let y = top; y <= bottom; y++) {
    stampConveyorCell(ctx, right, y, seed + y + 3000, 65, 91, 96);
    stampConveyorCell(ctx, left, y, seed + y + 6000, 95, 79, 54);
  }
  for (let x = left + 1; x <= right - 1; x++) {
    stampConveyorCell(ctx, x, midY, seed + x * 5 + 12000, 142, 126, 72);
  }
  for (let y = top + 1; y <= bottom - 1; y++) {
    stampConveyorCell(ctx, midX, y, seed + y * 7 + 15000, 74, 117, 134);
  }

  const center = { x: midX, y: midY };
  stampMark(ctx.world, center.x, center.y, 0.5, 0.5, 0.55, MarkType.BULLET, seed ^ 0x5a17, 180, 176, 132, 130);
}

function stampConveyorCell(ctx: ProceduralAnomalyGenContext, x: number, y: number, seed: number, r: number, g: number, b: number): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] !== Cell.FLOOR) return;
  stampMark(ctx.world, x, y, 0.5, 0.5, 0.18, MarkType.BULLET, seed, r, g, b, 120);
  if ((seed & 7) === 0 && ctx.world.features[ci] === Feature.NONE) ctx.world.features[ci] = Feature.MACHINE;
}
