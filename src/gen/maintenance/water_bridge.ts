/* ── Сухой мост над водой — shooter/eel counterplay set piece ── */

import {
  Cell, ContainerKind, Faction, Feature, FloorLevel, MonsterKind, RoomType, Tex,
  EntityType, AIGoal,
  type Entity, type Room, type WorldContainer,
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
import { Spr } from '../../render/sprite_index';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx, findMaintArea, openTile, setFeature, setWater,
  stampMaintRoom,
} from './content_helpers';

const BRIDGE_W = 31;
const BRIDGE_H = 15;

function nextContainerId(ctx: MaintContentCtx): number {
  let id = ctx.world.containers.length + 1;
  while (ctx.world.containerById.has(id) || ctx.world.containers.some(c => c.id === id)) id++;
  return id;
}

function addBridgeContainer(
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

function setPipeBlock(ctx: MaintContentCtx, x: number, y: number): void {
  const ci = ctx.world.idx(x, y);
  if (ctx.world.cells[ci] === Cell.LIFT) return;
  ctx.world.cells[ci] = Cell.WALL;
  ctx.world.wallTex[ci] = Tex.PIPE;
  ctx.world.roomMap[ci] = -1;
  ctx.world.features[ci] = Feature.NONE;
}

function dropAt(ctx: MaintContentCtx, x: number, y: number, defId: string, count = 1): void {
  if (ctx.world.solid(x, y)) return;
  ctx.entities.push({
    id: ctx.nextId.v++, type: EntityType.ITEM_DROP,
    x: x + 0.5, y: y + 0.5,
    angle: 0, pitch: 0,
    alive: true, speed: 0, sprite: Spr.ITEM_DROP,
    inventory: [{ defId, count }],
  });
}

function spawnBridgeMonster(ctx: MaintContentCtx, kind: MonsterKind, x: number, y: number, waterOnly = false): void {
  const ci = ctx.world.idx(x, y);
  if (waterOnly ? ctx.world.cells[ci] !== Cell.WATER : ctx.world.solid(x, y)) return;

  const def = MONSTERS[kind];
  if (!def) return;
  const zid = ctx.world.zoneMap[ci];
  const zoneLevel = (zid >= 0 && ctx.world.zones[zid]) ? (ctx.world.zones[zid].level ?? 5) : 5;
  const hp = scaleMonsterHp(def.hp, zoneLevel);
  const monster: Entity = {
    id: ctx.nextId.v++, type: EntityType.MONSTER,
    x: x + 0.5, y: y + 0.5,
    angle: Math.random() * Math.PI * 2, pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, zoneLevel),
    sprite: def.sprite,
    hp, maxHp: hp,
    monsterKind: kind,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(zoneLevel),
  };
  ctx.entities.push(monster);
}

export function generateWaterBridge(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, BRIDGE_W + 2, BRIDGE_H + 2, 90, 205);

  const room = stampMaintRoom(
    ctx.world, ctx.world.rooms.length, RoomType.CORRIDOR,
    pos.x, pos.y, BRIDGE_W, BRIDGE_H,
    'Сухой мост над угревым лотком',
    Tex.PIPE, Tex.F_CONCRETE,
  );

  const left = room.x + 2;
  const right = room.x + room.w - 3;
  const topWaterA = room.y + 4;
  const topWaterB = room.y + 6;
  const lowWaterA = room.y + 9;
  const lowWaterB = room.y + 11;

  for (let y = topWaterA; y <= topWaterB; y++) {
    for (let x = left; x <= right; x++) setWater(ctx.world, x, y);
  }
  for (let y = lowWaterA; y <= lowWaterB; y++) {
    for (let x = left; x <= right; x++) setWater(ctx.world, x, y);
  }

  for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
    openTile(ctx.world, x, room.y + 2);
    openTile(ctx.world, x, room.y + 7);
    openTile(ctx.world, x, room.y + 8);
    openTile(ctx.world, x, room.y + room.h - 3);
  }
  for (let y = room.y + 2; y < room.y + room.h - 2; y++) {
    openTile(ctx.world, room.x + 1, y);
    openTile(ctx.world, room.x + room.w - 2, y);
  }
  for (const x of [room.x + 7, room.x + 15, room.x + 23]) {
    for (let y = room.y + 3; y <= room.y + 12; y++) openTile(ctx.world, x, y);
  }

  for (const [x, y] of [
    [room.x + 11, room.y + 7], [room.x + 12, room.y + 7],
    [room.x + 19, room.y + 8], [room.x + 20, room.y + 8],
    [room.x + 7, room.y + 3], [room.x + 23, room.y + 12],
  ] as const) setPipeBlock(ctx, x, y);

  setFeature(ctx.world, room.x + 3, room.y + 2, Feature.APPARATUS);
  setFeature(ctx.world, room.x + 4, room.y + 2, Feature.LAMP);
  setFeature(ctx.world, room.x + 7, room.y + 7, Feature.LAMP);
  setFeature(ctx.world, room.x + 15, room.y + 7, Feature.LAMP);
  setFeature(ctx.world, room.x + 23, room.y + 8, Feature.LAMP);
  setFeature(ctx.world, room.x + room.w - 5, room.y + room.h - 3, Feature.SHELF);
  setFeature(ctx.world, room.x + room.w - 3, room.y + 3, Feature.MACHINE);

  addBridgeContainer(ctx, room, room.x + room.w - 5, room.y + room.h - 3, {
    kind: ContainerKind.TOOL_LOCKER,
    name: 'Маршрутный ящик сухого моста',
    inventory: [
      { defId: 'diver_route_tag', count: 1 },
      { defId: 'ammo_harpoon', count: 3 },
      { defId: 'filtered_water', count: 2 },
      { defId: 'bandage', count: 1 },
      {
        defId: 'note',
        count: 1,
        data: 'Бирку снимать после перехода: сухие лампы ведут по кромке, угорь теряет темп на бетоне.',
      },
    ],
    capacitySlots: 8,
    faction: Faction.LIQUIDATOR,
    access: 'public',
    discovered: true,
    tags: ['maintenance', 'water_bridge', 'diver', 'route_tag', 'eel_counterplay', 'contract'],
  });

  dropAt(ctx, room.x + 3, room.y + 2, 'note');
  dropAt(ctx, room.x + room.w - 4, room.y + room.h - 3, 'ammo_9mm', 12);

  spawnBridgeMonster(ctx, MonsterKind.TUBE_EEL, room.x + 10, room.y + 5, true);
  spawnBridgeMonster(ctx, MonsterKind.TUBE_EEL, room.x + 21, room.y + 10, true);
  spawnBridgeMonster(ctx, MonsterKind.EYE, room.x + room.w - 6, room.y + 7);
}
