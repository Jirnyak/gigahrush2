/* ── Ржавник: стеллаж ровного металла ─────────────────────────── */

import {
  AIGoal, EntityType, Feature, MonsterKind, RoomType, Tex,
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { Spr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, findMaintArea, openTile, setFeature, stampMaintRoom,
} from './content_helpers';

function dropAt(ctx: MaintContentCtx, x: number, y: number, defId: string): void {
  ctx.entities.push({
    id: ctx.nextId.v++,
    type: EntityType.ITEM_DROP,
    x: x + 0.5,
    y: y + 0.5,
    angle: 0,
    pitch: 0,
    alive: true,
    speed: 0,
    sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count: 1 }],
  });
}

function markStraightRods(ctx: MaintContentCtx, x: number, y: number, n: number): void {
  stampMark(ctx.world, x, y, 0.5, 0.5, 0.24, MarkType.BULLET, 178_000 + n * 19, 164, 84, 32, 150);
  stampMark(ctx.world, x + 1, y, 0.5, 0.5, 0.2, MarkType.BULLET, 178_700 + n * 23, 190, 170, 132, 115);
}

function spawnRzhavnik(ctx: MaintContentCtx, x: number, y: number): void {
  const def = MONSTERS[MonsterKind.RZHAVNIK];
  const ci = ctx.world.idx(x, y);
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = Math.max(3, zid >= 0 && ctx.world.zones[zid] ? ctx.world.zones[zid].level ?? 3 : 3);
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  ctx.entities.push({
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: def.sprite,
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.RZHAVNIK,
    attackCd: 0,
    ai: { goal: AIGoal.IDLE, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0, scrapWake: 0 },
    rpg: randomRPG(zoneLevel),
    spriteScale: 0.62,
  });
}

export function generateRzhavnikShelf(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 20, 9, 34, 160);
  const room = stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.STORAGE,
    pos.x,
    pos.y,
    20,
    9,
    'Стеллаж ровного металла',
    Tex.METAL,
    Tex.F_CONCRETE,
  );

  const midY = room.y + Math.floor(room.h / 2);
  for (let x = room.x + 1; x < room.x + room.w - 1; x++) openTile(ctx.world, x, midY);
  for (let x = room.x + 2; x < room.x + room.w - 2; x += 2) {
    setFeature(ctx.world, x, room.y + 2, Feature.SHELF);
    setFeature(ctx.world, x + 1, room.y + room.h - 3, Feature.SHELF);
  }
  setFeature(ctx.world, room.x + room.w - 3, midY, Feature.LAMP);
  setFeature(ctx.world, room.x + 3, midY, Feature.APPARATUS);

  for (let i = 0; i < 6; i++) markStraightRods(ctx, room.x + 5 + i * 2, room.y + 3 + (i & 1), i);
  dropAt(ctx, room.x + 5, room.y + 5, 'wire_coil');
  dropAt(ctx, room.x + 12, room.y + 5, 'metal_sheet');
  dropAt(ctx, room.x + 15, room.y + 3, 'rebar');
  spawnRzhavnik(ctx, room.x + 8, room.y + 3);
}
