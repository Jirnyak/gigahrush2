/* -- Vodyanoy Koshmar pump room: connected and broken wet lines -- */

import {
  AIGoal, Cell, EntityType, Feature, MonsterKind, RoomType, Tex, type Room,
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { monsterSpr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  dropItems,
  findMaintArea,
  openTile,
  setFeature,
  setWater,
  stampMaintRoom,
  type MaintContentCtx,
} from './content_helpers';

const ROOM_W = 42;
const ROOM_H = 19;

export function generateVodyanoyKoshmarLine(ctx: MaintContentCtx): void {
  const area = findMaintArea(ctx.world, ctx.spawnX, ctx.spawnY, ROOM_W, ROOM_H, 92, 225);
  const room = stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.PRODUCTION,
    area.x,
    area.y,
    ROOM_W,
    ROOM_H,
    'Насосная с отражением под полом',
    Tex.PIPE,
    Tex.F_CONCRETE,
  );

  dressVodyanoyPumpRoom(ctx, room);
  spawnVodyanoyKoshmar(ctx, room, room.x + 7, room.y + Math.floor(room.h / 2));
  dropItems(ctx, room, ['metal_water', 'psi_dust', 'bandage']);
}

function dressVodyanoyPumpRoom(ctx: MaintContentCtx, room: Room): void {
  const midY = room.y + Math.floor(room.h / 2);
  const lineStart = room.x + 5;
  const lineEnd = room.x + room.w - 6;

  for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
    openTile(ctx.world, x, midY - 4);
    openTile(ctx.world, x, midY - 2);
    openTile(ctx.world, x, midY + 2);
    openTile(ctx.world, x, midY + 4);
    if (x >= lineStart && x <= lineEnd) setWater(ctx.world, x, midY);
  }

  for (let x = room.x + 7; x < room.x + room.w - 8; x += 7) {
    setFeature(ctx.world, x, midY - 3, Feature.MACHINE);
    setFeature(ctx.world, x + 2, midY + 3, Feature.APPARATUS);
    stampMark(ctx.world, x, midY, 0.5, 0.5, 0.24, MarkType.PSI, 174_000 + x, 56, 132, 138, 140);
  }

  const breakerX = room.x + Math.floor(room.w * 0.58);
  for (let y = midY - 1; y <= midY + 1; y++) {
    const ci = ctx.world.idx(breakerX, y);
    if (ctx.world.cells[ci] !== Cell.LIFT) {
      ctx.world.cells[ci] = Cell.FLOOR;
      ctx.world.floorTex[ci] = Tex.F_CONCRETE;
    }
  }

  for (let x = room.x + 10; x <= room.x + 16; x++) {
    setWater(ctx.world, x, midY + 6);
    stampMark(ctx.world, x, midY + 6, 0.5, 0.5, 0.18, MarkType.DRIP, 175_000 + x, 45, 96, 104, 120);
  }

  setFeature(ctx.world, room.x + 3, midY, Feature.SINK);
  setFeature(ctx.world, room.x + room.w - 4, midY, Feature.SINK);
  setFeature(ctx.world, breakerX, midY - 2, Feature.LAMP);
  setFeature(ctx.world, breakerX, midY + 2, Feature.LAMP);
}

function spawnVodyanoyKoshmar(ctx: MaintContentCtx, room: Room, x: number, y: number): void {
  const def = MONSTERS[MonsterKind.VODYANOY_KOSHMAR];
  const ci = ctx.world.idx(x, y);
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = Math.max(4, zid >= 0 && ctx.world.zones[zid] ? ctx.world.zones[zid].level ?? 4 : 4);
  const hp = scaleMonsterHp(def.hp, zoneLevel);

  ctx.entities.push({
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.VODYANOY_KOSHMAR),
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.VODYANOY_KOSHMAR,
    attackCd: def.attackRate * 0.5,
    ai: { goal: AIGoal.WANDER, tx: room.x + room.w - 6, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  });
}
