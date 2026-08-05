/* ── Второй затопленный тайник водолазов ─────────────────────── */

import {
  ContainerKind,
  Faction,
  Feature,
  FloorLevel,
  MonsterKind,
  RoomType,
  Tex,
  type Room,
  type WorldContainer,
} from '../../core/types';
import {
  type MaintContentCtx, dropItems, findMaintArea, setFeature, setWater,
  spawnMonstersNear, stampMaintRoom,
} from './content_helpers';

function nextContainerId(ctx: MaintContentCtx): number {
  let id = ctx.world.containers.length + 1;
  while (ctx.world.containerById.has(id) || ctx.world.containers.some(c => c.id === id)) id++;
  return id;
}

function addDiverPrepLocker(
  ctx: MaintContentCtx,
  room: Room,
  x: number,
  y: number,
  container: Omit<WorldContainer, 'id' | 'x' | 'y' | 'floor' | 'roomId' | 'zoneId'>,
): void {
  const wx = ctx.world.wrap(x);
  const wy = ctx.world.wrap(y);
  const ci = ctx.world.idx(wx, wy);
  ctx.world.addContainer({
    id: nextContainerId(ctx),
    x: wx,
    y: wy,
    floor: FloorLevel.MAINTENANCE,
    roomId: room.id,
    zoneId: ctx.world.zoneMap[ci],
    ...container,
  });
  setFeature(ctx.world, wx, wy, Feature.SHELF);
}

export function generateDiverCache(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 11, 9, 85, 190);

  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.STORAGE,
    pos.x, pos.y, 9, 7,
    'Затопленный тайник водолазов: давление ноль',
    Tex.PIPE, Tex.F_WATER,
  );

  for (let dy = 1; dy < room.h - 1; dy++) {
    for (let dx = 1; dx < room.w - 1; dx++) {
      if (dx === 4 && dy >= 2 && dy <= 4) continue;
      if ((dx + dy) % 2 === 0) setWater(ctx.world, room.x + dx, room.y + dy);
    }
  }
  setFeature(ctx.world, room.x + 1, room.y + 1, Feature.LAMP);
  setFeature(ctx.world, room.x + 4, room.y + 3, Feature.SHELF);
  setFeature(ctx.world, room.x + 6, room.y + 2, Feature.APPARATUS);

  addDiverPrepLocker(ctx, room, room.x + 4, room.y + 3, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Сухой ящик водолазов: мостовой комплект',
    inventory: [
      { defId: 'harpoon_gun', count: 1 },
      { defId: 'ammo_harpoon', count: 4 },
      { defId: 'gasmask_filter', count: 1 },
      { defId: 'rawmeat', count: 3 },
      { defId: 'filtered_water', count: 1 },
      {
        defId: 'note',
        count: 1,
        data: 'Мостовой комплект: держаться сухой кромки, угря не добивать в воде, бирку маршрута снять с дальнего ящика.',
      },
    ],
    capacitySlots: 9,
    faction: Faction.LIQUIDATOR,
    access: 'public',
    discovered: true,
    tags: ['maintenance', 'diver_cache', 'water_bridge', 'prep', 'eel_counterplay'],
  });

  dropItems(ctx, room, [
    'flashlight', 'water', 'water', 'bandage', 'ammo_shells',
    'knife', 'rawmeat', 'note',
  ]);

  spawnMonstersNear(ctx, room.x + 4, room.y + 3, [
    MonsterKind.POLZUN, MonsterKind.SBORKA, MonsterKind.TVAR,
  ], 3, 8);
}
