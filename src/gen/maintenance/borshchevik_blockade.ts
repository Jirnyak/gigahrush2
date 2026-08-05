/* ── Borshchevik blockade: rooted plant corridor with bypass ─── */

import { stampSurfaceSplat } from '../../systems/surface_marks';
import {
  AIGoal,
  Cell,
  EntityType,
  Feature,
  MonsterKind,
  RoomType,
  Tex,
  type Entity,
  type Room,
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import { registerBorshchevikRootSite } from '../../systems/borshchevik';
import { registerCellHazardSite } from '../../systems/cell_hazards';
import { randomRPG } from '../../systems/rpg';
import {
  type MaintContentCtx,
  dropItems,
  findMaintArea,
  openTile,
  setFeature,
  stampMaintRoom,
} from './content_helpers';

export const BORSHCHEVIK_BLOCKADE_ID = 'maintenance_borshchevik_blockade';

function paintSap(ctx: MaintContentCtx, x: number, y: number, n: number): number {
  const cell = ctx.world.idx(x, y);
  stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.58, 0.72, 72_000 + n * 53, 194, 210, 52, false);
  stampSurfaceSplat(ctx.world, x, y, 0.38, 0.62, 0.28, 0.46, 73_000 + n * 47, 88, 132, 50, false);
  return cell;
}

function spawnBorshchevik(ctx: MaintContentCtx, x: number, y: number): Entity {
  const def = MONSTERS[MonsterKind.BORSHCHEVIK];
  const zid = ctx.world.zoneMap[ctx.world.idx(x, y)];
  const zoneLevel = zid >= 0 && ctx.world.zones[zid] ? ctx.world.zones[zid].level : 3;
  const hp = Math.round(def.hp * (0.9 + zoneLevel * 0.1));
  const plant: Entity = {
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI,
    pitch: 0,
    alive: true,
    speed: def.speed,
    sprite: monsterSpr(MonsterKind.BORSHCHEVIK),
    hp,
    maxHp: hp,
    name: 'Борщевик',
    monsterKind: MonsterKind.BORSHCHEVIK,
    attackCd: 0,
    ai: { goal: AIGoal.IDLE, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(Math.max(1, zoneLevel)),
    spriteScale: 1.18,
  };
  ctx.entities.push(plant);
  return plant;
}

function connectBypass(ctx: MaintContentCtx, block: Room, bypass: Room, x: number): void {
  for (let y = block.y + block.h - 1; y <= bypass.y; y++) {
    openTile(ctx.world, x, y, Tex.F_CONCRETE);
    ctx.world.roomMap[ctx.world.idx(x, y)] = -1;
  }
}

export function generateBorshchevikBlockade(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 30, 18, 90, 190);

  const block = stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.CORRIDOR,
    pos.x,
    pos.y,
    26,
    8,
    'Борщевик: сервисный коридор с зонтиками',
    Tex.PIPE,
    Tex.F_CONCRETE,
  );
  const bypass = stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.STORAGE,
    pos.x,
    pos.y + 9,
    26,
    8,
    'Борщевик: сухой обход борщеводов',
    Tex.CONCRETE,
    Tex.F_CONCRETE,
  );

  connectBypass(ctx, block, bypass, block.x + 2);
  connectBypass(ctx, block, bypass, block.x + block.w - 3);

  const weakX = block.x + Math.floor(block.w / 2);
  const weakY = block.y + block.h;
  const weakCell = ctx.world.idx(weakX, weakY);
  ctx.world.cells[weakCell] = Cell.WALL;
  ctx.world.wallTex[weakCell] = Tex.CONCRETE;
  ctx.world.features[weakCell] = Feature.NONE;
  ctx.world.roomMap[weakCell] = -1;

  for (let dx = 3; dx < block.w - 3; dx += 5) setFeature(ctx.world, block.x + dx, block.y + 1, Feature.LAMP);
  for (let dx = 2; dx < bypass.w - 2; dx += 4) setFeature(ctx.world, bypass.x + dx, bypass.y + 2, Feature.SHELF);
  setFeature(ctx.world, bypass.x + 3, bypass.y + bypass.h - 3, Feature.APPARATUS);
  setFeature(ctx.world, bypass.x + bypass.w - 4, bypass.y + bypass.h - 3, Feature.MACHINE);

  const mid = block.x + Math.floor(block.w / 2);
  const sapCells: number[] = [];
  for (let y = block.y + 2; y <= block.y + 5; y++) {
    for (let x = mid - 3; x <= mid + 3; x++) {
      sapCells.push(paintSap(ctx, x, y, sapCells.length));
    }
  }

  const plants = [
    spawnBorshchevik(ctx, mid, block.y + 3),
    spawnBorshchevik(ctx, mid - 2, block.y + 5),
    spawnBorshchevik(ctx, mid + 2, block.y + 5),
  ];

  registerCellHazardSite(ctx.world, {
    id: `${BORSHCHEVIK_BLOCKADE_ID}_sap`,
    kind: 'borshchevik_sap',
    displayName: 'Сок борщевика',
    cells: sapCells,
    tags: ['plant', 'borshchevik', 'sap', 'seed', 'maintenance'],
    sticky: false,
    slowMult: 0.5,
    playerDamagePerSecond: 1.8,
    monsterDamagePerSecond: 0.45,
    roomId: block.id,
    zoneId: ctx.world.zoneMap[ctx.world.idx(mid, block.y + 4)],
    centerX: mid + 0.5,
    centerY: block.y + 4.5,
    warning: 'Сок борщевика жжет кожу. Рубите стебли, жгите издали или идите сухим обходом.',
    warningColor: '#df6',
  });

  registerBorshchevikRootSite(ctx.world, {
    id: `${BORSHCHEVIK_BLOCKADE_ID}_roots`,
    plantIds: plants.map(plant => plant.id),
    weakCells: [weakCell],
    roomId: block.id,
    zoneId: ctx.world.zoneMap[weakCell],
    centerX: weakX + 0.5,
    centerY: weakY + 0.5,
  });

  dropItems(ctx, bypass, ['fire_hook', 'axe', 'flamethrower', 'ammo_fuel', 'antifungal_ointment', 'gasmask_filter']);
}
