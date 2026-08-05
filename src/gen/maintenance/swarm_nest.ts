/* ── Swarm nest: vent source with seal/burn counterplay ─────── */

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
} from '../../core/types';
import { MONSTERS } from '../../entities/monster';
import { monsterSpr } from '../../render/sprite_index';
import {
  SWARM_BODY_STAGE,
  createSwarmSourceEntity,
  registerSwarmNestSource,
} from '../../systems/swarm_nests';
import { randomRPG, scaleMonsterHp, scaleMonsterSpeed } from '../../systems/rpg';
import {
  type MaintContentCtx,
  dropItems,
  findMaintArea,
  openTile,
  setFeature,
  stampMaintRoom,
} from './content_helpers';

export const SWARM_NEST_ID = 'maintenance_swarm_nest';

function stampCrumbs(ctx: MaintContentCtx, x: number, y: number, seed: number): void {
  stampSurfaceSplat(ctx.world, x, y, 0.5, 0.5, 0.42, 0.32, 91_000 + seed * 17, 34, 20, 10, false);
  stampSurfaceSplat(ctx.world, x, y, 0.34, 0.58, 0.18, 0.14, 91_400 + seed * 19, 116, 74, 20, false);
}

function spawnDormantBody(ctx: MaintContentCtx, x: number, y: number, level: number): Entity {
  const def = MONSTERS[MonsterKind.SWARM];
  const hp = scaleMonsterHp(def.hp, level);
  const body: Entity = {
    id: ctx.nextId.v++,
    type: EntityType.MONSTER,
    x: x + 0.5,
    y: y + 0.5,
    angle: Math.PI * 0.5,
    pitch: 0,
    alive: true,
    speed: scaleMonsterSpeed(def.speed, level),
    sprite: monsterSpr(MonsterKind.SWARM),
    hp,
    maxHp: hp,
    monsterKind: MonsterKind.SWARM,
    monsterStage: SWARM_BODY_STAGE,
    attackCd: 0,
    ai: { goal: AIGoal.WANDER, tx: x, ty: y, path: [], pi: 0, stuck: 0, timer: 0 },
    rpg: randomRPG(level),
    spriteScale: 0.82,
  };
  ctx.entities.push(body);
  return body;
}

export function generateSwarmNest(ctx: MaintContentCtx): void {
  const cx = Math.floor(ctx.spawnX);
  const cy = Math.floor(ctx.spawnY);
  const pos = findMaintArea(ctx.world, cx, cy, 26, 15, 52, 170);

  const room = stampMaintRoom(
    ctx.world,
    ctx.world.rooms.length,
    RoomType.PRODUCTION,
    pos.x,
    pos.y,
    26,
    15,
    'Вентиляционная матка роя',
    Tex.PIPE,
    Tex.F_CONCRETE,
  );

  const midX = room.x + Math.floor(room.w / 2);
  const midY = room.y + Math.floor(room.h / 2);
  for (let y = room.y + 1; y < room.y + room.h - 1; y++) {
    for (let x = room.x + 1; x < room.x + room.w - 1; x++) {
      const edge = x === room.x + 1 || x === room.x + room.w - 2 || y === room.y + 1 || y === room.y + room.h - 2;
      if (edge && ((x + y) & 3) === 0) setFeature(ctx.world, x, y, Feature.APPARATUS);
      if (!edge && ((x * 31 + y * 17) & 15) === 0) stampCrumbs(ctx, x, y, x + y);
    }
  }

  for (let x = room.x + 2; x < room.x + room.w - 2; x++) {
    openTile(ctx.world, x, midY, Tex.F_CONCRETE);
  }
  for (let y = room.y + 2; y < room.y + room.h - 2; y++) {
    openTile(ctx.world, midX, y, Tex.F_CONCRETE);
  }

  const ventX = midX;
  const ventY = room.y + 2;
  const ventCell = ctx.world.idx(ventX, ventY);
  ctx.world.cells[ventCell] = Cell.FLOOR;
  ctx.world.floorTex[ventCell] = Tex.F_ABYSS;
  ctx.world.features[ventCell] = Feature.APPARATUS;
  stampCrumbs(ctx, ventX, ventY, 101);

  const zid = ctx.world.zoneMap[ctx.world.idx(midX, midY)];
  const level = zid >= 0 && ctx.world.zones[zid] ? Math.max(1, ctx.world.zones[zid].level ?? 3) : 3;
  const source = createSwarmSourceEntity(ctx.nextId.v++, ventX + 0.5, ventY + 0.5, level);
  ctx.entities.push(source);

  registerSwarmNestSource(ctx.world, {
    id: SWARM_NEST_ID,
    x: source.x,
    y: source.y,
    sourceEntityId: source.id,
    roomId: room.id,
    zoneId: zid >= 0 ? zid : undefined,
    activationRadius: 38,
    spawnRadius: 5,
    maxChildren: 10,
    spawnCooldown: 2.4,
  });

  spawnDormantBody(ctx, midX - 3, midY, level);
  spawnDormantBody(ctx, midX + 3, midY + 1, level);
  dropItems(ctx, room, ['duct_tape', 'sealant_tube', 'rawmeat', 'ammo_fuel']);
}
