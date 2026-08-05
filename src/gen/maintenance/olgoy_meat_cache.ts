/* Olgoy meat cache: feed/flee collector worm encounter. */

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

const ROOM_W = 30;
const ROOM_H = 15;

function spawnOlgoy(ctx: MaintContentCtx, x: number, y: number, tx: number, ty: number): void {
  const def = MONSTERS[MonsterKind.OLGOY];
  const ci = ctx.world.idx(x, y);
  const zoneLevel = ctx.world.zones[ctx.world.zoneMap[ci]]?.level ?? 5;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const dx = tx - x;
  const dy = ty - y;

  const monster: Entity = {
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.atan2(dy, dx),
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.OLGOY),
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.OLGOY,
    attackCd: def.attackRate * 0.35,
    ai: { goal: AIGoal.WANDER, tx, ty, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  ctx.entities.push(monster);
}

export function generateOlgoyMeatCache(ctx: MaintContentCtx): void {
  const area = findMaintArea(ctx.world, ctx.spawnX, ctx.spawnY, ROOM_W, ROOM_H, 118, 255);
  const room = stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.STORAGE,
    area.x,
    area.y,
    ROOM_W,
    ROOM_H,
    'Мясной сборник коллектора',
    Tex.PIPE,
    Tex.F_CONCRETE,
  );

  const midY = room.y + Math.floor(room.h / 2);
  const waterY = midY + 3;
  for (let x = room.x + 2; x < room.x + room.w - 2; x++) {
    openTile(ctx.world, x, midY - 4, Tex.F_CONCRETE);
    openTile(ctx.world, x, midY - 1, Tex.F_CONCRETE);
    setWater(ctx.world, x, waterY);
    if (x > room.x + 5 && x < room.x + room.w - 6 && x % 2 === 0) setWater(ctx.world, x, waterY - 1);
  }

  for (let x = room.x + 4; x < room.x + room.w - 4; x += 5) {
    setFeature(ctx.world, x, midY - 4, Feature.SHELF);
    setFeature(ctx.world, x + 2, midY - 1, Feature.APPARATUS);
  }
  setFeature(ctx.world, room.x + 3, midY - 1, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 4, midY - 1, Feature.MACHINE);
  setFeature(ctx.world, room.x + Math.floor(room.w / 2), waterY, Feature.SINK);

  const dryBaitX = room.x + 6;
  const dryBaitY = midY - 4;
  const dryIdx = ctx.world.idx(dryBaitX, dryBaitY);
  if (ctx.world.cells[dryIdx] !== Cell.LIFT) {
    ctx.world.cells[dryIdx] = Cell.FLOOR;
    ctx.world.floorTex[dryIdx] = Tex.F_CONCRETE;
  }

  dropItems(ctx, room, ['rawmeat', 'rawmeat', 'govnyak_roll', 'bandage', 'harpoon_gun', 'ammo_harpoon']);
  spawnOlgoy(ctx, room.x + Math.floor(room.w / 2), waterY, dryBaitX, dryBaitY);
}
