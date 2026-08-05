/* -- Monster_06 Kabelnik: visible industrial tether/trap room -- */

import {
  AIGoal, Cell, EntityType, Feature, MonsterKind, RoomType, Tex,
  type Entity,
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
import { MarkType, stampMark } from '../../systems/surface_marks';
import { Spr } from '../../render/sprite_index';
import { registerCellHazardSite } from '../../systems/cell_hazards';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, findMaintArea, setFeature, stampMaintRoom,
} from './content_helpers';

const ROOM_NAME = 'Кабельный пролет 06: линия под током';
const HAZARD_KIND = 'kabelnik';
const HAZARD_ID = 'monster_06_kabelnik_tether';

function dropAt(ctx: MaintContentCtx, x: number, y: number, defId: string, count = 1, data?: unknown): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] === Cell.WALL || ctx.world.cells[ci] === Cell.LIFT) return;
  ctx.entities.push({
    id: ctx.nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5, angle: 0, pitch: 0,
    alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count, data }],
  });
}

function setPipeBlock(ctx: MaintContentCtx, x: number, y: number): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] === Cell.LIFT) return;
  ctx.world.cells[ci] = Cell.WALL;
  ctx.world.wallTex[ci] = Tex.PIPE;
  ctx.world.features[ci] = Feature.NONE;
  ctx.world.roomMap[ci] = -1;
}

function markCableCell(ctx: MaintContentCtx, x: number, y: number, n: number): number {
  const ci = ctx.world.idx(x, y);
  stampMark(ctx.world, x, y, 0.5, 0.5, 0.34, MarkType.PSI, 60_600 + n * 41, 68, 202, 255, 225);
  stampMark(ctx.world, x, y, 0.5, 0.5, 0.18, MarkType.SCORCH, 61_600 + n * 43, 20, 24, 30, 155);
  ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], 36);
  return ci;
}

function markCableGlow(ctx: MaintContentCtx, x: number, y: number): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ci = ctx.world.idx(x + dx, y + dy);
      if (ctx.world.cells[ci] !== Cell.FLOOR) continue;
      ctx.world.fog[ci] = Math.max(ctx.world.fog[ci], dx === 0 && dy === 0 ? 42 : 14);
    }
  }
}

function spawnKabelnik(ctx: MaintContentCtx, x: number, y: number): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.solid(x, y)) return;
  const def = MONSTERS[MonsterKind.LAMPOVY];
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && ctx.world.zones[zid]) ? (ctx.world.zones[zid].level ?? 5) : 5;
  const hp = Math.round(scaleMonsterHp(def.hp, zoneLevel) * 1.55);
  const monster: Entity = {
    id: ctx.nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: -Math.PI, pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel) * 0.92,
    sprite: def.sprite,
    hp, maxHp: hp,
    name: 'Кабельник',
    monsterKind: MonsterKind.LAMPOVY,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x - 4, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
    spriteScale: 1.12,
  };
  ctx.entities.push(monster);
}

export function generateKabelnik(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 31, 17, 100, 230);

  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y, 27, 13,
    ROOM_NAME,
    Tex.PIPE, Tex.F_CONCRETE,
  );

  for (let x = room.x + 6; x <= room.x + room.w - 7; x++) {
    setPipeBlock(ctx, x, room.y + 4);
    setPipeBlock(ctx, x, room.y + 8);
  }

  setFeature(ctx.world, room.x + 4, room.y + 6, Feature.APPARATUS);
  setFeature(ctx.world, room.x + room.w - 5, room.y + 6, Feature.APPARATUS);
  setFeature(ctx.world, room.x + 4, room.y + 5, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 5, room.y + 5, Feature.LAMP);
  setFeature(ctx.world, room.x + 13, room.y + 5, Feature.LAMP);
  setFeature(ctx.world, room.x + 3, room.y + 3, Feature.SCREEN);
  setFeature(ctx.world, room.x + room.w - 4, room.y + 9, Feature.MACHINE);
  setFeature(ctx.world, room.x + room.w - 3, room.y + 3, Feature.SHELF);
  ctx.world.wallTex[ctx.world.idx(room.x + 3, room.y - 1)] = Tex.SCREEN_BASE + 20;

  const cableCells: number[] = [];
  const cableY = room.y + 6;
  for (let x = room.x + 5; x <= room.x + room.w - 6; x++) {
    cableCells.push(markCableCell(ctx, x, cableY, cableCells.length));
    markCableGlow(ctx, x, cableY);
    if (x % 3 === 0) {
      stampMark(ctx.world, x, cableY, 0.5, 0.5, 0.22, MarkType.BULLET, 62_600 + x, 210, 235, 255, 180);
    }
  }
  ctx.world.markFogDirty();

  const zoneId = ctx.world.zoneMap[ctx.world.idx(room.x + 13, cableY)];
  registerCellHazardSite(ctx.world, {
    id: `${HAZARD_ID}_${room.id}`,
    kind: HAZARD_KIND,
    displayName: 'Кабельная петля',
    cells: cableCells,
    tags: ['monster', 'tether', 'electric', 'industrial', 'maintenance'],
    slowMult: 0.42,
    trappedMult: 0.11,
    stickAfter: 0.45,
    escapeSeconds: 2.2,
    npcEscapeSeconds: 4.6,
    roomId: room.id,
    zoneId,
    centerX: room.x + 13.5,
    centerY: cableY + 0.5,
    warning: 'Искрящий кабель стягивает шаг. Обойдите по верхнему или нижнему лотку, выжгите огнем или режьте чистящим комплектом.',
  });

  dropAt(ctx, room.x + 2, room.y + 2, 'cleaning_kit');
  dropAt(ctx, room.x + 3, room.y + 10, 'rubber_strip', 2);
  dropAt(ctx, room.x + 3, room.y + 2, 'note', 1,
    'Журнал обходчика: Кабельник держит прямую линию. Видишь голубую искру - не шагай через нее. Верхний и нижний лоток сухие; кабель снимается чистящим комплектом или огнем.');
  dropAt(ctx, room.x + room.w - 4, room.y + 2, 'wire_coil');
  dropAt(ctx, room.x + room.w - 3, room.y + 6, 'fuse');
  dropAt(ctx, room.x + room.w - 4, room.y + room.h - 3, 'circuit_board');
  dropAt(ctx, room.x + room.w - 6, room.y + room.h - 3, 'ammo_energy');

  spawnKabelnik(ctx, room.x + room.w - 8, room.y + 7);
}
