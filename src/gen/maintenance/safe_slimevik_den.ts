/* ── Safe Slimevik den: barterable slime scavenger POI ───────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal,
  Cell,
  EntityType,
  Feature,
  Faction,
  MonsterKind,
  Occupation,
  RoomType,
  Tex,
  type Entity,
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr, Spr } from '../../render/sprite_index';
import { registerCellHazardSite } from '../../systems/cell_hazards';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  dropItems,
  findMaintArea,
  setFeature,
  setWater,
  spawnAmbientNpc,
  stampMaintRoom,
  type MaintContentCtx,
} from './content_helpers';

const ROOM_W = 18;
const ROOM_H = 11;
const ROOM_NAME = 'Кормовая ванна слизневика';

function dropAt(ctx: MaintContentCtx, x: number, y: number, defId: string, data?: string): void {
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
    inventory: [{ defId, count: 1, data }],
  });
}

function stampFeedSlime(ctx: MaintContentCtx, roomId: number, x: number, y: number): number[] {
  const cells: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 5) continue;
      const wx = x + dx;
      const wy = y + dy;
      const ci = ctx.world.idx(wx, wy);
      if (ctx.world.cells[ci] !== Cell.FLOOR && ctx.world.cells[ci] !== Cell.WATER) continue;
      stampSurfaceSplat(ctx.world, wx, wy, 0.5, 0.5, 0.75, 125, 91_000 + roomId * 31 + cells.length, 44, 170, 126);
      cells.push(ci);
    }
  }
  return cells;
}

function spawnSafeSlimevik(ctx: MaintContentCtx, x: number, y: number): void {
  const def = MONSTERS[MonsterKind.SLIMEVIK];
  const ci = ctx.world.idx(x, y);
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && ctx.world.zones[zid]) ? (ctx.world.zones[zid].level ?? 2) : 2;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const slimevik: Entity = {
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: monsterSpr(MonsterKind.SLIMEVIK),
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.SLIMEVIK,
    attackCd: def.attackRate,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0, slimeTargetX: x - 2, slimeTargetY: y },
    rpg: randomRPG(zoneLevel),
  };
  ctx.entities.push(slimevik);
}

export function generateSafeSlimevikDen(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, ROOM_W + 2, ROOM_H + 2, 135, 270);
  const room = stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.PRODUCTION,
    pos.x,
    pos.y,
    ROOM_W,
    ROOM_H,
    ROOM_NAME,
    Tex.PIPE,
    Tex.F_CONCRETE,
  );

  for (let dx = 2; dx < room.w - 2; dx += 3) setFeature(ctx.world, room.x + dx, room.y + 1, Feature.LAMP);
  setFeature(ctx.world, room.x + 2, room.y + 2, Feature.DESK);
  setFeature(ctx.world, room.x + 3, room.y + 2, Feature.CHAIR);
  setFeature(ctx.world, room.x + room.w - 4, room.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, room.x + room.w - 3, room.y + 2, Feature.MACHINE);
  setFeature(ctx.world, room.x + 4, room.y + room.h - 3, Feature.SINK);

  for (let dx = 7; dx <= 12; dx++) {
    setWater(ctx.world, room.x + dx, room.y + 5);
    if (dx % 2 === 0) setWater(ctx.world, room.x + dx, room.y + 6);
  }

  const centerX = room.x + 9;
  const centerY = room.y + 5;
  const cells = stampFeedSlime(ctx, room.id, centerX, centerY);
  registerCellHazardSite(ctx.world, {
    id: `safe_slimevik_feed_${room.id}`,
    kind: 'slimevik_feed_slime',
    displayName: 'Кормовая слизь',
    cells,
    tags: ['slime', 'slimevik', 'sample', 'safe_den'],
    slowMult: 0.78,
    trappedMult: 0.48,
    stickAfter: 1.8,
    escapeSeconds: 1.4,
    npcEscapeSeconds: 2.8,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(centerX, centerY)],
    centerX: centerX + 0.5,
    centerY: centerY + 0.5,
    warning: 'Кормовая слизь держит обувь слабо. Слизневик может слизать её за еду или лекарство.',
    warningColor: '#8c7',
  });

  dropItems(ctx, room, ['bread', 'water', 'pills', 'filter_layer', 'nii_sample_container']);
  dropAt(ctx, room.x + 2, room.y + 3, 'note', 'Полевой журнал: слизневика не стрелять. Еда или лекарство - обмен; фильтр и тара - дистанция. Прижатие без защиты даёт липкий ПСИ-шум.');
  dropAt(ctx, room.x + 12, room.y + 5, 'slime_sample_brown', 'Отмеченная кормовая проба: безопаснее после бартера со слизневиком.');

  spawnSafeSlimevik(ctx, room.x + 14, room.y + 6);
  spawnAmbientNpc(
    ctx,
    'Лида Кормовая',
    Faction.SCIENTIST,
    Occupation.SCIENTIST,
    room.x + 3,
    room.y + room.h - 3,
    [{ defId: 'filter_layer', count: 1 }, { defId: 'bread', count: 1 }],
  );
}
