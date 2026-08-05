/* -- Trubnyy Avtomat wet service line --------------------------- */

import {
  AIGoal, Cell, EntityType, Feature, MonsterKind, RoomType, Tex,
  type Entity,
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
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

const ROOM_W = 38;
const ROOM_H = 15;

function spawnTrubnyyAvtomat(ctx: MaintContentCtx, x: number, y: number, faceX: number): void {
  const def = MONSTERS[MonsterKind.TRUBNYY_AVTOMAT];
  const ci = ctx.world.idx(x, y);
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && ctx.world.zones[zid]) ? (ctx.world.zones[zid].level ?? 5) : 5;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const monster: Entity = {
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.atan2(0, faceX - x),
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.TRUBNYY_AVTOMAT),
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.TRUBNYY_AVTOMAT,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: faceX, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  ctx.entities.push(monster);
}

export function generateTrubnyyAvtomatLine(ctx: MaintContentCtx): void {
  const area = findMaintArea(ctx.world, ctx.spawnX, ctx.spawnY, ROOM_W, ROOM_H, 88, 210);
  const room = stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.PRODUCTION,
    area.x,
    area.y,
    ROOM_W,
    ROOM_H,
    'Трубный автомат: мокрая сервисная линия',
    Tex.PIPE,
    Tex.F_CONCRETE,
  );

  const y = room.y + Math.floor(room.h / 2);
  const startX = room.x + 10;
  const endX = room.x + room.w - 5;

  for (let x = room.x + 2; x < room.x + room.w - 2; x++) {
    openTile(ctx.world, x, y - 4, Tex.F_CONCRETE);
    openTile(ctx.world, x, y + 4, Tex.F_CONCRETE);
    if (x >= startX && x <= endX) setWater(ctx.world, x, y);
  }

  for (let x = room.x + 4; x < room.x + room.w - 4; x += 5) {
    setFeature(ctx.world, x, y - 3, Feature.MACHINE);
    setFeature(ctx.world, x + 2, y + 3, Feature.APPARATUS);
  }
  setFeature(ctx.world, room.x + 5, y, Feature.MACHINE);
  setFeature(ctx.world, room.x + room.w - 4, y, Feature.SCREEN);

  const dryPedestal = room.x + 6;
  const pedestalIdx = ctx.world.idx(dryPedestal, y);
  if (ctx.world.cells[pedestalIdx] !== Cell.LIFT) {
    ctx.world.cells[pedestalIdx] = Cell.FLOOR;
    ctx.world.floorTex[pedestalIdx] = Tex.F_CONCRETE;
  }

  spawnTrubnyyAvtomat(ctx, dryPedestal, y, endX);
  dropItems(ctx, room, ['ammo_energy', 'circuit_board', 'manometer']);
}
