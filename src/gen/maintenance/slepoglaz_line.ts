/* -- Slepoglaz service corridor: long shot with side-step space -- */

import {
  AIGoal, EntityType, Feature, MonsterKind, RoomType, Tex, type Room,
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { monsterSpr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature, stampMaintRoom,
} from './content_helpers';

const ROOM_W = 48;
const ROOM_H = 15;

export function generateSlepoglazLine(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, ROOM_W, ROOM_H, 100, 210);
  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x, pos.y, ROOM_W, ROOM_H,
    'Коридор слепого прострела',
    Tex.METAL, Tex.F_CONCRETE,
  );

  dressSlepoglazLine(ctx, room);
  dropItems(ctx, room, ['noise_can', 'psi_dust', 'bandage']);
  spawnSlepoglaz(ctx, room, room.x + room.w - 5, room.y + Math.floor(room.h / 2));
}

function dressSlepoglazLine(ctx: MaintContentCtx, room: Room): void {
  const midY = room.y + Math.floor(room.h / 2);

  for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
    openTile(ctx.world, x, midY - 1);
    openTile(ctx.world, x, midY);
    openTile(ctx.world, x, midY + 1);
  }

  for (let x = room.x + 6; x < room.x + room.w - 7; x += 8) {
    setFeature(ctx.world, x, room.y + 3, Feature.MACHINE);
    setFeature(ctx.world, x + 2, room.y + 4, Feature.APPARATUS);
    setFeature(ctx.world, x, room.y + room.h - 4, Feature.SHELF);
    setFeature(ctx.world, x + 2, room.y + room.h - 5, Feature.MACHINE);
  }

  for (let i = 0; i < 18; i++) {
    const x = room.x + 5 + i * 2;
    const y = midY + (i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 1);
    stampMark(ctx.world, x, y, 0.5, 0.5, 0.18, MarkType.PSI, 128_000 + i * 29, 70, 210, 74, 125);
  }

  setFeature(ctx.world, room.x + 2, midY, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 3, midY, Feature.LAMP);
  setFeature(ctx.world, room.x + 4, room.y + 3, Feature.SHELF);
  setFeature(ctx.world, room.x + 4, room.y + room.h - 4, Feature.SHELF);
}

function spawnSlepoglaz(ctx: MaintContentCtx, room: Room, x: number, y: number): void {
  const def = MONSTERS[MonsterKind.SLEPOGLAZ];
  const ci = ctx.world.idx(x, y);
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = Math.max(4, zid >= 0 && ctx.world.zones[zid] ? ctx.world.zones[zid].level ?? 4 : 4);
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
    sprite: monsterSpr(MonsterKind.SLEPOGLAZ),
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.SLEPOGLAZ,
    attackCd: def.attackRate * 0.45,
    ai: { goal: AIGoal.WANDER, tx: room.x + 3, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  });
}
