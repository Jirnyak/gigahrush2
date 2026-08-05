/* ── AG64 green acid slime room — explicit pickup risk, no sim ── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  Cell, EntityType, Feature, MonsterKind, RoomType, Tex,
} from '../../core/types';
import { Spr } from '../../render/sprite_index';
import {
  type MaintContentCtx, findMaintArea, setFeature, setWater,
  spawnMonstersNear, stampMaintRoom,
} from './content_helpers';

interface GreenAcidDropData {
  ag64GreenAcid: true;
  organicRisk?: boolean;
  sample?: boolean;
}

const ROOM_W = 22;
const ROOM_H = 11;
const GREEN_SAMPLE_ITEM = 'slime_sample_green';

function acidRisk(): GreenAcidDropData {
  return { ag64GreenAcid: true, organicRisk: true };
}

function acidSample(): GreenAcidDropData {
  return { ag64GreenAcid: true, organicRisk: true, sample: true };
}

function dropAt(ctx: MaintContentCtx, x: number, y: number, defId: string, data?: unknown): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] === Cell.WALL || ctx.world.cells[ci] === Cell.LIFT) return;
  ctx.entities.push({
    id: ctx.nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5, angle: 0, pitch: 0,
    alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count: 1, data }],
  });
}

function stainAcid(ctx: MaintContentCtx, x: number, y: number, seed: number): void {
  setWater(ctx.world, x, y);
  stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.52 + (seed % 3) * 0.08, 215, 64_000 + seed, 58, 235, 42);
}

function markWarningSmears(ctx: MaintContentCtx, x: number, y: number): void {
  stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 2.8, 120, 64_700, 30, 160, 46, false);
  stampSurfaceSplat(ctx.world, x + 3, y + 1, 0.4, 0.5, 1.6, 150, 64_701, 75, 245, 50, true);
  stampSurfaceSplat(ctx.world, x - 4, y - 1, 0.5, 0.5, 1.4, 130, 64_702, 80, 210, 45, true);
}

export function generateGreenAcidRoom(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, ROOM_W + 2, ROOM_H + 2, 95, 230);

  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y, ROOM_W, ROOM_H,
    'НИИ Слизи: зелёная кислотная проба',
    Tex.PIPE, Tex.F_CONCRETE,
  );

  for (let dx = 1; dx < room.w - 1; dx++) {
    if (dx % 4 === 1) setFeature(ctx.world, room.x + dx, room.y + 1, Feature.LAMP);
    if (dx % 5 === 2) setFeature(ctx.world, room.x + dx, room.y + room.h - 2, Feature.SHELF);
  }

  setFeature(ctx.world, room.x + 3, room.y + 5, Feature.MACHINE);
  setFeature(ctx.world, room.x + 4, room.y + 5, Feature.APPARATUS);
  setFeature(ctx.world, room.x + room.w - 4, room.y + 5, Feature.MACHINE);
  setFeature(ctx.world, room.x + room.w - 5, room.y + 5, Feature.APPARATUS);
  setFeature(ctx.world, room.x + 2, room.y + 2, Feature.DESK);
  setFeature(ctx.world, room.x + 3, room.y + 2, Feature.CHAIR);

  let seed = 0;
  for (let dy = 4; dy <= 7; dy++) {
    for (let dx = 6; dx <= 15; dx++) {
      const edge = dx === 6 || dx === 15 || dy === 4 || dy === 7;
      if (!edge || (dx + dy) % 2 === 0) stainAcid(ctx, room.x + dx, room.y + dy, seed++);
    }
  }
  for (const [dx, dy] of [[7, 3], [12, 3], [16, 6], [5, 8], [10, 8], [14, 8]] as const) {
    stainAcid(ctx, room.x + dx, room.y + dy, seed++);
  }
  markWarningSmears(ctx, room.x + 11, room.y + 5);

  dropAt(ctx, room.x + 2, room.y + 2, 'note',
    'Журнал НИИ Слизи, ОВС: зелёная проба ест органику и ткань. Брать через фильтрующий слой или санитарные щипцы; без них повторная попытка испортит добычу и форму 728/01-Д.');
  dropAt(ctx, room.x + 4, room.y + 2, 'filter_layer');
  dropAt(ctx, room.x + 5, room.y + 2, 'filter_layer');
  dropAt(ctx, room.x + 6, room.y + 2, 'rubber_strip');
  dropAt(ctx, room.x + 16, room.y + 5, 'acid_bottle', acidSample());
  dropAt(ctx, room.x + 17, room.y + 5, GREEN_SAMPLE_ITEM, acidSample());

  dropAt(ctx, room.x + 8, room.y + 5, 'rawmeat', acidRisk());
  dropAt(ctx, room.x + 10, room.y + 6, 'mushroom_mass', acidRisk());
  dropAt(ctx, room.x + 12, room.y + 5, 'green_briquette', acidRisk());
  dropAt(ctx, room.x + 14, room.y + 6, 'cloth_roll', acidRisk());
  dropAt(ctx, room.x + 18, room.y + 8, 'filtered_water');
  dropAt(ctx, room.x + 19, room.y + 8, 'psi_dust');

  spawnMonstersNear(ctx, room.x + 12, room.y + 6, [
    MonsterKind.POLZUN, MonsterKind.TUBE_EEL, MonsterKind.EYE,
  ], 5, 12);
}
