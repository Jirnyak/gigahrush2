/* ── Brown slime cleanup: bounded residue room ───────────────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import { Cell, EntityType, Faction, Feature, Occupation, RoomType, Tex } from '../../core/types';
import { Spr } from '../../render/sprite_index';
import { registerCellHazardSite } from '../../systems/cell_hazards';
import {
  type MaintContentCtx, dropItems, findMaintArea, setFeature, setWater,
  spawnAmbientNpc, stampMaintRoom,
} from './content_helpers';

const ROOM_NAME = 'Сухой обход: коричневая слизь';
const BROWN_SAMPLE_ITEM = 'slime_sample_brown';
const BROWN_LABEL_ITEM = 'slime_age_label_brown';
const CLEANUP_ACT_ITEM = 'brown_slime_cleanup_act';
const ALKALI_POWDER_ITEM = 'alkali_powder';
const SLIME_SCRAPER_ITEM = 'slime_scraper';

function addResidueCell(ctx: MaintContentCtx, cells: number[], roomId: number, x: number, y: number): void {
  const ci = ctx.world.idx(x, y);
  if (!cells.includes(ci)) cells.push(ci);
  ctx.world.roomMap[ci] = roomId;
}

function stampResidue(ctx: MaintContentCtx, roomId: number, x: number, y: number, seed: number): number[] {
  const world = ctx.world;
  const cells: number[] = [];
  for (let i = 0; i < 5; i++) {
    const px = x + (i % 3) * 2;
    const py = y + Math.floor(i / 3) * 2;
    stampSurfaceSplat(world, px, py, 0.45 + (i % 2) * 0.18, 0.52, 0.55 + i * 0.08, 145, seed + i * 17, 74, 48, 24);
    addResidueCell(ctx, cells, roomId, px, py);
  }
  stampSurfaceSplat(world, x + 4, y + 2, 0.5, 0.5, 1.15, 185, seed + 101, 92, 55, 26);
  addResidueCell(ctx, cells, roomId, x + 4, y + 2);
  stampSurfaceSplat(world, x + 7, y + 4, 0.35, 0.65, 0.85, 165, seed + 131, 58, 38, 22);
  addResidueCell(ctx, cells, roomId, x + 7, y + 4);
  return cells;
}

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

export function generateBrownSlimeCleanup(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 17, 10, 48, 150);

  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y, 13, 8,
    ROOM_NAME,
    Tex.PIPE, Tex.F_CONCRETE,
  );

  setFeature(ctx.world, room.x + 1, room.y + 1, Feature.SINK);
  setFeature(ctx.world, room.x + 2, room.y + 1, Feature.SHELF);
  setFeature(ctx.world, room.x + room.w - 3, room.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, room.x + room.w - 3, room.y + room.h - 3, Feature.LAMP);
  setWater(ctx.world, room.x + room.w - 2, room.y + room.h - 2);
  const residueCells = stampResidue(ctx, room.id, room.x + 4, room.y + 3, room.id * 631 + 63);
  registerCellHazardSite(ctx.world, {
    id: `brown_slime_cleanup_${room.id}`,
    kind: 'brown_slime_residue',
    displayName: 'Коричневая слизь',
    cells: residueCells,
    tags: ['slime', 'brown_slime', 'cleanup', 'napalm'],
    slowMult: 0.72,
    trappedMult: 0.38,
    stickAfter: 1.4,
    escapeSeconds: 1.6,
    npcEscapeSeconds: 3.2,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(room.x + 6, room.y + 4)],
    centerX: room.x + 7.5,
    centerY: room.y + 4.5,
    warning: 'Токсичная коричневая слизь держит обувь и несёт запах в стояк. Скребок, чистящий комплект или огонь снимают пятно.',
  });

  dropItems(ctx, room, ['liquidator_rake', 'cleaning_kit', SLIME_SCRAPER_ITEM, ALKALI_POWDER_ITEM, 'gasmask_filter', 'filter_canister', 'filter_layer', 'wet_rag_bundle', 'decon_fluid', 'water', 'ammo_fuel']);
  dropAt(ctx, room.x + 2, room.y + 2, 'agnia_a130');
  dropAt(ctx, room.x + 3, room.y + 2, 'ammo_fuel');
  dropAt(ctx, room.x + 4, room.y + 2, 'ammo_fuel');
  dropAt(ctx, room.x + 5, room.y + 2, CLEANUP_ACT_ITEM, 2);
  dropAt(ctx, room.x + 6, room.y + 2, BROWN_LABEL_ITEM, 2,
    'Бирки первичного налёта: с ними коричневая проба выглядит как отчёт, а не как банка из-под кухни.');
  dropAt(ctx, room.x + 7, room.y + 3, BROWN_SAMPLE_ITEM, 1,
    'Пломба санобхода: коричневая проба после сухой зачистки.');
  dropAt(ctx, room.x + 6, room.y + 4, 'infected_mushroom', 2);
  dropAt(ctx, room.x + 8, room.y + 5, 'cloth_roll');
  dropAt(ctx, room.x + 10, room.y + 3, 'note', 1,
    'Памятка санпоста: коричневую слизь считать токсичной до акта и после акта руками не трогать. Скребок годится для края пятна; комплект быстрее, огонь быстрее комплекта, но бензин не выдаётся повторно. Жидкость и фильтры списывать по факту дыхания. Пробу в пломбе можно сдать Боковой, прожечь в печи с щёлочной присыпкой или продать без журнала.');
  spawnAmbientNpc(
    ctx, 'Трофим Санобход', Faction.CITIZEN, Occupation.LOCKSMITH,
    room.x + 2, room.y + room.h - 2,
    [{ defId: SLIME_SCRAPER_ITEM, count: 1 }, { defId: 'cleaning_kit', count: 1 }, { defId: 'ammo_fuel', count: 1 }, { defId: 'water_coupon', count: 1 }],
  );
}
