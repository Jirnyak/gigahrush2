import { stampSurfaceSplat } from '../../systems/surface_marks';
import { registerRouteCue } from '../../systems/route_cues';
import { canSpawnEntityType } from '../../systems/entity_limits';
import { Cell, EntityType, Feature, RoomType, Tex, type Room } from '../../core/types';
import { Spr } from '../../render/sprite_index';
import {
  isWalkableCell,
  roomCell,
  roomCenter,
  type ProceduralAnomalyGenContext,
} from './common';

const LEFT_LOOT = ['inspection_mirror', 'seal_wax', 'blank_form', 'water_coupon'] as const;
const RIGHT_LOOT = ['fake_pass', 'bleached_document', 'filter_receipt', 'container_key_label'] as const;

type Axis = 'x' | 'y';
type Point = { x: number; y: number };

interface MirrorPair {
  a: Room;
  b: Room;
}

interface MirrorPairDecoration {
  screenA: Point | null;
  screenB: Point | null;
  lightA: Point | null;
  lightB: Point | null;
}

function hash32(v: number): number {
  let x = v | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function mirrorCoord(v: number, axis: number): number {
  return (axis * 2 - v + 1024) & 1023;
}

function mirroredCenter(room: Room, axis: Axis, axisValue: number): { x: number; y: number } {
  const center = roomCenter(room);
  return axis === 'x'
    ? { x: mirrorCoord(center.x, axisValue), y: center.y }
    : { x: center.x, y: mirrorCoord(center.y, axisValue) };
}

function sortedRooms(ctx: ProceduralAnomalyGenContext): Room[] {
  return [...ctx.rooms]
    .filter(room => (
      room.type !== RoomType.CORRIDOR &&
      room.w >= 5 &&
      room.h >= 5 &&
      ctx.world.dist2(ctx.spawnX, ctx.spawnY, roomCenter(room).x, roomCenter(room).y) > 48 * 48
    ))
    .sort((a, b) => hash32(ctx.spec.seed ^ (a.id * 0x9e3779b1)) - hash32(ctx.spec.seed ^ (b.id * 0x9e3779b1)));
}

function choosePairs(ctx: ProceduralAnomalyGenContext, axis: Axis, axisValue: number): MirrorPair[] {
  const rooms = sortedRooms(ctx);
  const used = new Set<number>();
  const pairs: MirrorPair[] = [];
  const target = Math.min(6 + ctx.spec.danger, 12);

  for (const room of rooms) {
    if (pairs.length >= target || used.has(room.id)) continue;
    const wanted = mirroredCenter(room, axis, axisValue);
    let best: Room | null = null;
    let bestD2 = 88 * 88;
    for (const other of rooms) {
      if (other.id === room.id || used.has(other.id)) continue;
      const c = roomCenter(other);
      const d2 = ctx.world.dist2(wanted.x, wanted.y, c.x, c.y);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = other;
      }
    }
    if (!best) continue;
    used.add(room.id);
    used.add(best.id);
    pairs.push({ a: room, b: best });
  }

  return pairs;
}

function pairCell(ctx: ProceduralAnomalyGenContext, pair: MirrorPair, axis: Axis, dx: number, dy: number, requireEmpty = true): [Point | null, Point | null] {
  const ax = Math.max(1, Math.min(pair.a.w - 2, dx));
  const ay = Math.max(1, Math.min(pair.a.h - 2, dy));
  const bx = axis === 'x' ? pair.b.w - 1 - Math.min(pair.b.w - 2, ax) : Math.min(pair.b.w - 2, ax);
  const by = axis === 'y' ? pair.b.h - 1 - Math.min(pair.b.h - 2, ay) : Math.min(pair.b.h - 2, ay);
  return [
    roomCell(ctx.world, pair.a, ax, ay, requireEmpty),
    roomCell(ctx.world, pair.b, bx, by, requireEmpty),
  ];
}

function setFeature(ctx: ProceduralAnomalyGenContext, ci: number, feature: Feature): void {
  ctx.world.features[ci] = feature;
  if (feature === Feature.SCREEN && !ctx.world.screenCells.includes(ci)) ctx.world.screenCells.push(ci);
}

function setMirrorFeature(ctx: ProceduralAnomalyGenContext, pos: Point | null, feature: Feature, seed: number): void {
  if (!pos) return;
  const ci = ctx.world.idx(pos.x, pos.y);
  if (!isWalkableCell(ctx.world, ci)) return;
  setFeature(ctx, ci, feature);
  ctx.world.floorTex[ci] = Tex.F_TILE;
  ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 22);
  if (feature === Feature.LAMP) ctx.world.light[ci] = Math.max(ctx.world.light[ci], 0.72);
  stampSurfaceSplat(ctx.world, pos.x, pos.y, 0.5, 0.5, 0.34, 0.58, seed ^ ci, 155, 205, 225, false);
}

function addMirrorTeleport(ctx: ProceduralAnomalyGenContext, a: Point | null, b: Point | null): void {
  if (!a || !b) return;
  const ai = ctx.world.idx(a.x, a.y);
  const bi = ctx.world.idx(b.x, b.y);
  if (!isWalkableCell(ctx.world, ai) || !isWalkableCell(ctx.world, bi)) return;
  if (ctx.world.anomalyTeleports.has(ai) || ctx.world.anomalyTeleports.has(bi)) return;
  ctx.world.anomalyTeleports.set(ai, bi);
  ctx.world.anomalyTeleports.set(bi, ai);
  setFeature(ctx, ai, Feature.SCREEN);
  setFeature(ctx, bi, Feature.SCREEN);
  ctx.world.floorTex[ai] = Tex.F_VOID;
  ctx.world.floorTex[bi] = Tex.F_VOID;
}

function addMirrorItemDrop(ctx: ProceduralAnomalyGenContext, pos: Point | null, defId: string): void {
  if (!pos || !canSpawnEntityType(ctx.entities, EntityType.ITEM_DROP)) return;
  const ci = ctx.world.idx(pos.x, pos.y);
  if (!isWalkableCell(ctx.world, ci)) return;
  ctx.entities.push({
    id: ctx.nextId.v++,
    type: EntityType.ITEM_DROP,
    x: pos.x + 0.5,
    y: pos.y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count: 1 }],
  });
}

function cuePoint(deco: MirrorPairDecoration, side: 'a' | 'b'): Point | null {
  return side === 'a'
    ? deco.screenA ?? deco.lightA
    : deco.screenB ?? deco.lightB;
}

function registerMirrorCue(ctx: ProceduralAnomalyGenContext, pair: MirrorPair, deco: MirrorPairDecoration, ordinal: number): boolean {
  const marker = cuePoint(deco, 'a');
  const target = cuePoint(deco, 'b');
  if (!marker || !target) return false;
  const markerCell = ctx.world.idx(marker.x, marker.y);
  registerRouteCue(ctx.world, {
    id: `procedural_${ctx.spec.key}_mirror_run_pair_${ordinal}`,
    x: marker.x + 0.5,
    y: marker.y + 0.5,
    targetX: target.x + 0.5,
    targetY: target.y + 0.5,
    floor: ctx.spec.baseFloor,
    roomId: pair.a.id,
    targetRoomId: pair.b.id,
    zoneId: ctx.world.zoneMap[markerCell],
    label: 'зеркальная пара',
    hint: 'две комнаты повторяют свет, экран и добычу',
    targetName: pair.b.name,
    color: '#9bdcff',
    tags: ['procedural_floor', 'mirror_run', 'duality', 'teleport', 'loot', 'route_pressure', ctx.spec.geometryId, ctx.spec.majorityId],
    toneSeed: (ctx.spec.seed ^ pair.a.id * 199 ^ pair.b.id * 331) >>> 0,
    radius: 12,
    targetRadius: 3,
    cooldownSec: 32,
    heardText: 'Экран показывает такую же комнату, только свет стоит с другой стороны.',
    followedText: 'Зеркальная пара сверена. Перескок здесь виден заранее, без угадывания координат.',
    ignoredText: 'Отраженная комната осталась за спиной. Маршрут не требует этого трюка.',
    routeGroup: {
      id: `mirror_run_${ctx.spec.key}_${ordinal}`,
      lead: 'экран и лампа повторяются в соседней версии комнаты',
      risk: 'перескок может сбить ориентацию',
      decision: 'сверить пару, использовать короткий ход или идти обычным маршрутом',
      reward: 'парная добыча и короткая проверка топологии',
      mapLabel: 'зеркальная пара',
      mapHint: 'видимая парная комната',
      logLine: 'Зеркальная проводка читается по одинаковым экранам, лампам и вещам.',
    },
  });
  return true;
}

function decoratePair(ctx: ProceduralAnomalyGenContext, pair: MirrorPair, axis: Axis, ordinal: number): MirrorPairDecoration {
  pair.a.name = `Зеркало ${ordinal + 1}A: ${pair.a.name}`;
  pair.b.name = `Зеркало ${ordinal + 1}B: ${pair.b.name}`;

  for (const room of [pair.a, pair.b]) {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        const x = ctx.world.wrap(room.x + dx);
        const y = ctx.world.wrap(room.y + dy);
        const ci = ctx.world.idx(x, y);
        if (ctx.world.roomMap[ci] !== room.id || (ctx.world.cells[ci] !== Cell.FLOOR && ctx.world.cells[ci] !== Cell.WATER)) continue;
        if (((axis === 'x' ? dx : dy) + ordinal) % 4 === 0) {
          ctx.world.floorTex[ci] = Tex.F_TILE;
          ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 12 + ordinal * 2);
        }
      }
    }
  }

  const [screenA, screenB] = pairCell(ctx, pair, axis, 1 + (ordinal % 3), 1 + ((ordinal * 2) % 3));
  setMirrorFeature(ctx, screenA, Feature.SCREEN, ctx.spec.seed + ordinal * 101);
  setMirrorFeature(ctx, screenB, Feature.SCREEN, ctx.spec.seed + ordinal * 103);

  const [lightA, lightB] = pairCell(ctx, pair, axis, pair.a.w - 2 - (ordinal % 3), pair.a.h - 2 - ((ordinal * 2) % 3));
  setMirrorFeature(ctx, lightA, Feature.LAMP, ctx.spec.seed + ordinal * 107);
  setMirrorFeature(ctx, lightB, Feature.LAMP, ctx.spec.seed + ordinal * 109);

  const [lootA, lootB] = pairCell(ctx, pair, axis, Math.floor(pair.a.w / 2), Math.floor(pair.a.h / 2), false);
  const leftReal = (hash32(ctx.spec.seed + ordinal) & 1) === 0;
  addMirrorItemDrop(ctx, lootA, leftReal ? LEFT_LOOT[ordinal % LEFT_LOOT.length] : RIGHT_LOOT[ordinal % RIGHT_LOOT.length]);
  addMirrorItemDrop(ctx, lootB, leftReal ? RIGHT_LOOT[(ordinal + 1) % RIGHT_LOOT.length] : LEFT_LOOT[(ordinal + 1) % LEFT_LOOT.length]);

  if (ordinal < 3) addMirrorTeleport(ctx, screenA, screenB);
  return { screenA, screenB, lightA, lightB };
}

function markAxis(ctx: ProceduralAnomalyGenContext, axis: Axis, axisValue: number): void {
  for (let d = -96; d <= 96; d += 3) {
    const x = axis === 'x' ? axisValue : axisValue + d;
    const y = axis === 'x' ? axisValue + d : axisValue;
    const ci = ctx.world.idx(x, y);
    if (!isWalkableCell(ctx.world, ci)) continue;
    ctx.world.floorTex[ci] = Tex.F_VOID;
    ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 34);
    if ((d & 15) === 0) stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.2, 0.5, ctx.spec.seed + d, 120, 185, 215, false);
  }
}

export function applyMirrorRun(ctx: ProceduralAnomalyGenContext): void {
  const axis: Axis = (ctx.spec.seed & 1) === 0 ? 'x' : 'y';
  const base = axis === 'x' ? Math.floor(ctx.spawnX) : Math.floor(ctx.spawnY);
  const axisValue = (base + 192 + (hash32(ctx.spec.seed) & 127)) & 1023;
  const pairs = choosePairs(ctx, axis, axisValue);
  if (pairs.length === 0) return;

  markAxis(ctx, axis, axisValue);
  let cueRegistered = false;
  for (let i = 0; i < pairs.length; i++) {
    const deco = decoratePair(ctx, pairs[i], axis, i);
    if (!cueRegistered) cueRegistered = registerMirrorCue(ctx, pairs[i], deco, i);
  }

  ctx.world.markFogDirty();
  ctx.world.markFloorTexDirty();
  ctx.world.markFeaturesDirty();
}
