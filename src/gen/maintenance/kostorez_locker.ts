/* ── Разрезочная бронелистов: bounded Kostorez encounter ─────── */

import {
  AIGoal, Cell, EntityType, Feature, MonsterKind, RoomType, Tex,
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import { MarkType, stampMark } from '../../systems/surface_marks';
import {
  type MaintContentCtx, dropItems, findMaintArea, openTile, setFeature, stampMaintRoom,
} from './content_helpers';

export function generateKostorezLocker(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 22, 11, 80, 170);

  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y, 22, 11,
    'Разрезочная бронелистов',
    Tex.METAL, Tex.F_CONCRETE,
  );

  const midY = room.y + Math.floor(room.h / 2);
  for (let x = room.x + 1; x < room.x + room.w - 1; x++) openTile(ctx.world, x, midY);

  for (let dx = 2; dx < room.w - 2; dx += 4) {
    setFeature(ctx.world, room.x + dx, room.y + 2, Feature.APPARATUS);
    setFeature(ctx.world, room.x + dx, room.y + room.h - 3, Feature.MACHINE);
  }
  setFeature(ctx.world, room.x + 2, midY, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 3, midY, Feature.LAMP);
  setFeature(ctx.world, room.x + 4, room.y + 3, Feature.SHELF);
  setFeature(ctx.world, room.x + 5, room.y + room.h - 4, Feature.SHELF);

  for (const [px, py] of [
    [room.x + 9, room.y + 3],
    [room.x + 9, room.y + 4],
    [room.x + 13, room.y + room.h - 5],
    [room.x + 13, room.y + room.h - 4],
  ] as const) {
    const ci = ctx.world.idx(px, py);
    ctx.world.cells[ci] = Cell.WALL;
    ctx.world.wallTex[ci] = Tex.METAL;
  }

  for (let i = 0; i < 7; i++) {
    const x = room.x + 4 + i * 2;
    const y = room.y + 3 + (i % 3);
    stampMark(ctx.world, x, y, 0.5, 0.5, 0.23, MarkType.BULLET, 112_000 + i * 17, 190, 185, 160, 150);
  }
  stampMark(ctx.world, room.x + room.w - 5, midY, 0.5, 0.5, 0.55, MarkType.SPLAT, 112_900, 105, 12, 12, 150);

  dropItems(ctx, room, ['metal_sheet', 'ammo_shells', 'ammo_shells', 'bandage']);
  spawnKostorez(ctx, room.x + room.w - 5, midY);
}

function spawnKostorez(ctx: MaintContentCtx, x: number, y: number): void {
  const def = MONSTERS[MonsterKind.KOSTOREZ];
  const ci = ctx.world.idx(x, y);
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = Math.max(5, zid >= 0 && ctx.world.zones[zid] ? ctx.world.zones[zid].level ?? 5 : 5);
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
    monsterKind: MonsterKind.KOSTOREZ,
    attackCd: def.attackRate * 0.6,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  });
}
