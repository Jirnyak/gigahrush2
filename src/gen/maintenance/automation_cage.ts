/* ── Клеть автоматики — Maintenance robot/light encounter ────── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import { Cell, Feature, MonsterKind, RoomType, Tex } from '../../core/types';
import {
  type MaintContentCtx, dropItems, findMaintArea, setFeature,
  spawnMonstersNear, stampMaintRoom,
} from './content_helpers';

export function generateAutomationCage(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 18, 11, 135, 280);
  const cage = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.PRODUCTION,
    pos.x, pos.y, 16, 10,
    'Клеть автоматики: плазменный пост',
    Tex.METAL, Tex.F_CONCRETE,
  );

  const fenceX = cage.x + 7;
  for (let dy = 1; dy < cage.h - 1; dy++) {
    if (dy === 3 || dy === 6) continue;
    const ci = ctx.world.idx(fenceX, cage.y + dy);
    if (ctx.world.cells[ci] !== Cell.FLOOR) continue;
    ctx.world.cells[ci] = Cell.WALL;
    ctx.world.wallTex[ci] = Tex.METAL;
    ctx.world.roomMap[ci] = -1;
    ctx.world.features[ci] = Feature.NONE;
  }

  for (let dx = 2; dx < cage.w - 2; dx += 3) {
    setFeature(ctx.world, cage.x + dx, cage.y + 2, Feature.MACHINE);
    setFeature(ctx.world, cage.x + dx, cage.y + cage.h - 3, Feature.APPARATUS);
  }
  setFeature(ctx.world, cage.x + 1, cage.y + 1, Feature.LAMP);
  setFeature(ctx.world, cage.x + cage.w - 2, cage.y + 1, Feature.LAMP);
  setFeature(ctx.world, cage.x + cage.w - 2, cage.y + cage.h - 2, Feature.SCREEN);
  ctx.world.wallTex[ctx.world.idx(cage.x + Math.floor(cage.w / 2), cage.y - 1)] = Tex.SCREEN_BASE + 18;
  stampSurfaceSplat(ctx.world, cage.x + 11, cage.y + 5, 0.5, 0.5, 5, 0.45, 35037, 35, 95, 130, false);

  dropItems(ctx, cage, ['circuit_board', 'fuse', 'ammo_energy', 'lamp_bulb', 'relay_diagram']);
  spawnMonstersNear(ctx, cage.x + 12, cage.y + 5, [
    MonsterKind.ROBOT, MonsterKind.LAMPOVY,
  ], 2, 5);
}
