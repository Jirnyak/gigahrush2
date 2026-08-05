import { Cell, Feature, RoomType, Tex, type Room } from '../../core/types';
import { registerRouteCue } from '../../systems/route_cues';
import { MarkType, stampMark } from '../../systems/surface_marks';
import {
  addItemDrop,
  randomRoomCell,
  roomCell,
  roomCenter,
  type ProceduralAnomalyGenContext,
} from './common';

const AMNESIA_ROOM_PREFIX = 'Амнезийная зона';
const MEMORY_LOOT = ['cloth_roll', 'cleaning_kit', 'relay_diagram', 'inspection_mirror'];
const PRESSURE_CORRIDOR_TAG = '[cement_pressure]';

function markPressureCorridor(ctx: ProceduralAnomalyGenContext, room: Room, order: number): { x: number; y: number } | null {
  let first: { x: number; y: number } | null = null;
  let painted = 0;
  const stride = room.type === RoomType.CORRIDOR ? 2 : 3;
  const cap = room.type === RoomType.CORRIDOR ? 92 : 56;
  for (let dy = 1; dy < room.h - 1 && painted < cap; dy += stride) {
    for (let dx = 1 + ((dy + order) & 1); dx < room.w - 1 && painted < cap; dx += stride) {
      const pos = roomCell(ctx.world, room, dx, dy);
      if (!pos) continue;
      const ci = ctx.world.idx(pos.x, pos.y);
      if (ctx.world.cells[ci] !== Cell.FLOOR && ctx.world.cells[ci] !== Cell.WATER) continue;
      if (!ctx.placement.reachable[ci]) continue;
      ctx.world.floorTex[ci] = Tex.F_CONCRETE;
      ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 20 + ctx.spec.danger * 7);
      stampMark(
        ctx.world,
        pos.x,
        pos.y,
        0.5,
        0.5,
        room.type === RoomType.CORRIDOR ? 0.3 : 0.24,
        MarkType.SCORCH,
        ctx.spec.seed ^ (room.id * 4099) ^ (order * 277) ^ painted,
        39,
        36,
        31,
        105,
      );
      if (!first) first = pos;
      painted++;
    }
  }
  if (painted > 0 && !room.name.includes(PRESSURE_CORRIDOR_TAG)) room.name = `${room.name} ${PRESSURE_CORRIDOR_TAG}`;
  return first;
}

function pressureCorridorRooms(ctx: ProceduralAnomalyGenContext): Room[] {
  return ctx.rooms
    .filter(room => {
      if (room.id === 0 || room.sealed || room.w < 4 || room.h < 4) return false;
      if (room.type !== RoomType.CORRIDOR && room.type !== RoomType.COMMON) return false;
      if (!ctx.placement.byRoom.has(room.id)) return false;
      const c = roomCenter(room);
      return ctx.world.dist2(ctx.spawnX, ctx.spawnY, c.x + 0.5, c.y + 0.5) > 32 * 32;
    })
    .sort((a, b) => {
      const ac = roomCenter(a);
      const bc = roomCenter(b);
      const typeScore = (b.type === RoomType.CORRIDOR ? 1 : 0) - (a.type === RoomType.CORRIDOR ? 1 : 0);
      if (typeScore !== 0) return typeScore;
      return ctx.world.dist2(ctx.spawnX, ctx.spawnY, bc.x, bc.y) - ctx.world.dist2(ctx.spawnX, ctx.spawnY, ac.x, ac.y);
    });
}

function registerCementMemoryCue(
  ctx: ProceduralAnomalyGenContext,
  marker: { room: Room; x: number; y: number } | null,
  target: { room: Room; x: number; y: number } | null,
): void {
  if (!marker || !target) return;
  registerRouteCue(ctx.world, {
    id: `procedural_${ctx.spec.key}_cement_memory`,
    x: marker.x + 0.5,
    y: marker.y + 0.5,
    targetX: target.x + 0.5,
    targetY: target.y + 0.5,
    floor: ctx.spec.baseFloor,
    roomId: marker.room.id,
    targetRoomId: target.room.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(marker.x, marker.y)],
    label: 'цементная память',
    hint: 'старые шаги твердеют за спиной',
    targetName: 'следовой коридор',
    color: '#c9b98a',
    tags: ['procedural_floor', 'route_pressure', 'cement_memory', 'trail_scar', 'no_backtracking', ctx.spec.geometryId, ctx.spec.majorityId],
    toneSeed: (ctx.spec.seed ^ (marker.room.id * 811) ^ (target.room.id * 1319)) >>> 0,
    radius: 10,
    targetRadius: 3,
    cooldownSec: 28,
    heardText: 'Под подошвами хрустит старый маршрут. HUD отметил коридор, где обратный ход станет болью.',
    followedText: 'Следовой коридор показал правило этажа: назад идти можно, но цемент запоминает.',
    ignoredText: 'Цементная память осталась сбоку. Следы всё равно сохнут где-то за спиной.',
  });
}

export function applyCementMemory(ctx: ProceduralAnomalyGenContext): void {
  const rooms = ctx.rooms
    .filter(room => room.id !== 0 && room.w >= 7 && room.h >= 7)
    .sort((a, b) => {
      const ac = roomCenter(a);
      const bc = roomCenter(b);
      return ctx.world.dist2(ctx.spawnX, ctx.spawnY, bc.x, bc.y) - ctx.world.dist2(ctx.spawnX, ctx.spawnY, ac.x, ac.y);
    });
  const count = Math.min(4, Math.max(2, 1 + ctx.spec.danger), rooms.length);
  let firstPanel: { room: Room; x: number; y: number } | null = null;

  for (let i = 0; i < count; i++) {
    const room = rooms[(i * 3) % rooms.length];
    room.name = `${AMNESIA_ROOM_PREFIX} ${i + 1}: ${room.name}`;
    const center = roomCenter(room);

    for (let n = 0; n < 10; n++) {
      const pos = randomRoomCell(ctx.world, room);
      if (!pos) continue;
      stampMark(ctx.world, pos.x, pos.y, 0.5, 0.5, 0.24, MarkType.SCORCH, ctx.spec.seed + room.id * 37 + n, 74, 72, 64, 95);
    }

    const panel = randomRoomCell(ctx.world, room, true);
    if (panel) {
      ctx.world.features[ctx.world.idx(panel.x, panel.y)] = Feature.APPARATUS;
      if (!firstPanel) firstPanel = { room, x: panel.x, y: panel.y };
    }
    if (i < MEMORY_LOOT.length) {
      const loot = randomRoomCell(ctx.world, room);
      if (loot) addItemDrop(ctx, loot.x, loot.y, MEMORY_LOOT[i], 1);
    }
    stampMark(ctx.world, center.x, center.y, 0.5, 0.5, Math.min(1.6, Math.max(room.w, room.h) / 14), MarkType.PSI, ctx.spec.seed ^ (room.id * 101), 165, 170, 150, 70);
  }

  let firstPressure: { room: Room; x: number; y: number } | null = null;
  const pressureRooms = pressureCorridorRooms(ctx);
  const pressureCount = Math.min(6, Math.max(2, ctx.spec.danger + 1), pressureRooms.length);
  for (let i = 0; i < pressureCount; i++) {
    const room = pressureRooms[i];
    const pos = markPressureCorridor(ctx, room, i);
    if (pos && !firstPressure) firstPressure = { room, x: pos.x, y: pos.y };
  }

  if (firstPressure) {
    ctx.world.markFloorTexDirty();
    ctx.world.markFogDirty();
  }
  registerCementMemoryCue(ctx, firstPanel, firstPressure);
}
